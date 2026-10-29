import { randomUUID } from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../config';
import { prisma } from '../db';
import { buildConversationContext } from '../conversation/services/context.service';
import { endConversation } from '../conversation/services/conversation.service';
import { consumeVoiceTicket } from './tickets';
import { AcousticAnalyzer } from './acoustic';
import { DeepgramStream, streamLisa, warmLisa, type LlmMessage } from './providers';
import { assessStudentUtterance, checkLisaSegment } from './safety-classifier';
import { POLICY_VERSION, triageStableUtterance, turnLanguage, type Review, type Triage } from './policy';
import { TurnTrace } from './trace';
import { createTtsSession, type TtsSession } from './tts-session';
import { BargeInDetector } from './turn-taking';
import { TurnRunner } from './turn';

type Auth = { userId: string; conversationId: string; sessionId: string; transcriptConsent: boolean };
type ClientEvent = { type?: string; generationId?: string; segmentIndex?: number; ticket?: string; format?: unknown; v?: number };
type State = 'connecting' | 'listening' | 'user_speaking' | 'endpointing' | 'generating' | 'playing' | 'interrupted' | 'ending' | 'closed';
type TurnOutput = { id: string; segments: string[]; delivered: Set<number>; messageId: string | null };

const active = new Set<VoiceSession>();
let admitting = 0;

/** Bounds concurrent async output audits per session. */
class Limiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async run<T>(task: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active++;
    try { return await task(); } finally { this.active--; this.waiting.shift()?.(); }
  }
}

const wss = new WebSocketServer({ port: config.voicePort, path: '/voice', maxPayload: 8192 });

class VoiceSession {
  readonly id = randomUUID();
  private auth: Auth | null = null;
  private stt: DeepgramStream | null = null;
  private tts: TtsSession | null = null;
  private readonly bargeIn = new BargeInDetector(config.bargeInMinWords);
  private readonly reviews = new Limiter(2);
  private acoustic: AcousticAnalyzer | null = null;
  private handshaking = false;
  private lastPartialCheck = 0;
  private state: State = 'connecting';
  private seq = 0;
  private turn = 0;
  private generation = 0;
  private generationId = '';
  private abort: AbortController | null = null;
  private pendingTasks = new Set<Promise<void>>();
  private commitTail: Promise<void> = Promise.resolve();
  private history: LlmMessage[] = [];
  private systemPrompt = '';
  private muted = false;
  private lastActivity = Date.now();
  private output: TurnOutput | null = null;
  private lastTurnId = '';
  private startedAt = Date.now();
  private lastAuthCheck = Date.now();
  private checkingAuth = false;
  private timer = setInterval(() => this.checkLifetime(), 5000);

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (data, isBinary) => { void this.receive(data, isBinary); });
    socket.on('close', () => { void this.end(true); });
    socket.on('error', () => { void this.end(true); });
    setTimeout(() => { if (this.state === 'connecting') this.fail('handshake_timeout', false); }, 5000);
  }

  private event(type: string, extra: Record<string, unknown> = {}) {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({
      v: 1, type, conversationId: this.auth?.conversationId ?? null, sessionId: this.id,
      turnId: this.lastTurnId || null, generationId: this.generationId || null,
      seq: ++this.seq, at: Date.now(), ...extra,
    }));
  }

  private fail(code: string, recoverable: boolean) {
    this.event('error', { code, recoverable, message: code.replace(/_/g, ' ') });
    if (!recoverable) void this.end();
  }

  private async receive(raw: WebSocket.RawData, isBinary: boolean) {
    this.lastActivity = Date.now();
    if (isBinary) {
      const frame = Buffer.from(raw as Buffer);
      if (!this.auth || this.state === 'ending' || this.state === 'closed' || this.muted) return;
      if (frame.length < 2 || frame.length > 3200 || frame.length % 2) { this.fail('invalid_audio_frame', false); return; }
      this.acoustic?.add(frame);
      if (!this.stt?.send(frame)) this.fail('audio_backpressure', false);
      return;
    }
    let data: ClientEvent;
    try { data = JSON.parse(raw.toString()); } catch { this.fail('invalid_control', false); return; }
    if (data.v !== 1) { this.fail('unsupported_protocol', false); return; }
    if (this.state === 'connecting') {
      const format = data.format as Record<string, unknown> | null;
      if (this.handshaking || data.type !== 'hello' || typeof data.ticket !== 'string' ||
          !format || format.encoding !== 'pcm_s16le' || format.sampleRate !== 16000 ||
          format.channels !== 1 || format.frameMs !== 20) {
        this.fail('invalid_hello', false); return;
      }
      this.handshaking = true;
      await this.hello(data.ticket);
      return;
    }
    if (!this.auth) return;
    if (data.type === 'mute') this.muted = true;
    else if (data.type === 'unmute') this.muted = false;
    else if (data.type === 'interrupt') this.cancelGeneration();
    else if (data.type === 'playback_progress') await this.playbackProgress(data);
    else if (data.type === 'end') await this.end();
    else this.fail('unknown_control', true);
  }

  private async hello(ticket: string) {
    if (active.size + admitting >= config.voiceMaxConversations) { this.fail('capacity_reached', false); return; }
    admitting++;
    try {
      const auth = await consumeVoiceTicket(ticket);
      if (!auth) { this.fail('invalid_ticket', false); return; }
      if (!config.deepgramApiKey || !config.sarvamApiKey || !config.voiceLlmBaseUrl || !config.voiceLlmModel ||
          !config.voiceSafetyBaseUrl || !config.voiceSafetyModel) {
        this.fail('provider_not_configured', false); return;
      }
      this.auth = auth;
      const context = await buildConversationContext(auth.userId, auth.conversationId);
      this.systemPrompt = context.systemPrompt;
      this.history = context.messages.filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })).slice(-20);
      this.stt = new DeepgramStream({
        speechStart: () => this.onSpeechStart(),
        partial: text => this.onPartial(text),
        final: text => this.onFinal(text),
        error: code => { if (this.state !== 'ending' && this.state !== 'closed') this.fail(code, false); },
      });
      this.tts = createTtsSession();
      // TTS socket opens in parallel with STT; a failure here is retried lazily on the first clause.
      const ttsOpen = this.tts.open().catch(() => console.warn(`[voice] ${this.id} tts_open_failed`));
      await Promise.all([this.stt.connect(), ttsOpen]);
      this.acoustic = new AcousticAnalyzer(value => this.event('acoustic', value));
      active.add(this);
      this.state = 'listening';
      this.startedAt = Date.now();
      this.event('ready', { format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
        playback: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 }, model: config.voiceLlmModel });
      if (config.voiceLlmWarmup) void warmLisa();
    } catch { this.fail('voice_start_failed', false); }
    finally { admitting--; }
  }

  private get speaking() { return this.state === 'generating' || this.state === 'playing'; }

  private onPartial(text: string) {
    this.event('transcript_partial', { text });
    if (this.speaking && this.bargeIn.partial(text)) this.cancelGeneration();
    if (Date.now() - this.lastPartialCheck < 250) return;
    this.lastPartialCheck = Date.now();
    const provisional = triageStableUtterance(text);
    if (provisional.level === 'URGENT') {
      if (this.speaking) this.cancelGeneration();
      this.event('risk', { level: 'URGENT', provisional: true, action: provisional.action, policyVersion: POLICY_VERSION });
    }
  }

  /** VAD only: reported to the client, but never interrupts Lisa (it fires on echo and noise). */
  private onSpeechStart() {
    if (this.state === 'ending' || this.state === 'closed') return;
    if (!this.speaking) this.state = 'user_speaking';
    this.event('speech_start');
  }

  private onFinal(text: string) {
    if (!this.auth || this.state === 'ending' || this.state === 'closed') return;
    const trace = new TurnTrace('');
    this.cancelGeneration();
    this.state = 'endpointing';
    const turnId = `${this.id}-${++this.turn}`;
    this.lastTurnId = turnId;
    this.event('speech_end');
    this.event('transcript_final', { text });
    const regex = triageStableUtterance(text);
    trace.mark('triageRegexDone');
    this.state = 'generating';
    const generation = ++this.generation;
    this.generationId = randomUUID();
    this.abort = new AbortController();
    this.bargeIn.arm();
    const output: TurnOutput = { id: this.generationId, segments: [], delivered: new Set(), messageId: null };
    this.output = output;
    this.history.push({ role: 'user', content: text });
    this.history = this.history.slice(-20);
    const history = [...this.history];
    // Persisting the user row runs in parallel; it is only awaited before writing the assistant row.
    const commit = this.commitTail.then(() => this.persistUser(text, turnId));
    this.commitTail = commit.then(() => {}, () => {});
    const task = this.respond({ text, turnId, generation, output, history, commit, regex,
      signal: this.abort.signal, trace: trace.withTurnId(turnId) }).catch(() => {
      this.fail('turn_internal_error', true);
    }).finally(() => {
      if (this.generation === generation && this.state !== 'ending' && this.state !== 'closed') this.state = 'listening';
      this.pendingTasks.delete(task);
    });
    this.pendingTasks.add(task);
  }

  /** The single cancellation path (barge-in, client interrupt, new turn): abort LLM/triage/TTS and drop late events. */
  private cancelGeneration() {
    this.abort?.abort();
    this.abort = null;
    this.generation++;
    this.bargeIn.disarm();
    if (this.speaking) {
      this.tts?.cancel();
      this.state = 'interrupted';
      this.event('interrupted');
    }
  }

  private async persistUser(text: string, turnId: string) {
    if (!this.auth?.transcriptConsent) return 0;
    const auth = this.auth;
    return prisma.$transaction(async tx => {
      const updated = await tx.conversation.update({
        where: { id: auth.conversationId, userId: auth.userId, status: 'ACTIVE' },
        data: { nextTurnNumber: { increment: 2 } }, select: { nextTurnNumber: true },
      });
      const userTurn = updated.nextTurnNumber - 2;
      await tx.message.create({ data: { conversationId: auth.conversationId, role: 'USER', content: text, turnNumber: userTurn, clientTurnId: turnId } });
      return userTurn + 1;
    });
  }

  private async respond(turn: { text: string; turnId: string; generation: number; output: TurnOutput;
    history: LlmMessage[]; commit: Promise<number>; regex: Triage; signal: AbortSignal; trace: TurnTrace }) {
    if (!this.auth || !this.tts) return;
    const auth = this.auth;
    const tts = this.tts;
    const { text, turnId, generation, output, history, signal, trace } = turn;
    const language = turnLanguage(text);
    tts.setVoice({ languageCode: language === 'hi' ? 'hi-IN' : 'en-IN', speaker: config.ttsSpeaker });
    const ids = { turnId, generationId: output.id };
    const current = () => generation === this.generation;
    const messages: LlmMessage[] = [{ role: 'system', content: this.systemPrompt }, ...history];
    const recent = history.filter(message => message.role === 'user').slice(-3, -1).map(message => message.content);
    const runner = new TurnRunner({
      streamLlm: (llmSignal, hooks) => streamLisa(messages, llmSignal, hooks),
      triage: triageSignal => assessStudentUtterance(text, triageSignal, recent),
      review: clause => this.reviews.run(() => checkLisaSegment(clause, { level: 'LOW', action: 'continue' }, undefined, text)),
      synthesize: (clause, index, onChunk, ttsSignal) => tts.speak(clause, index, onChunk, ttsSignal),
      emit: (type, extra = {}) => {
        if (!current() && type !== 'risk') return;
        this.event(type, { ...ids, ...(type === 'risk' ? { policyVersion: POLICY_VERSION } : {}), ...extra });
      },
      sendAudio: pcm => {
        if (this.socket.readyState !== WebSocket.OPEN) return;
        if (this.socket.bufferedAmount > 64 * 1024) throw new Error('playback_backpressure');
        this.socket.send(pcm, { binary: true });
      },
      isCurrent: current,
      playing: () => { if (current()) this.state = 'playing'; },
      triaged: triage => this.persistRisk(auth, turnId, triage),
      reviewed: (segmentIndex, review) => this.persistReview(auth, output.id, segmentIndex, review),
    }, { language, regex: turn.regex, gateMs: config.voiceTriageGateMs, outputReview: config.voiceOutputReview, signal, trace });
    output.segments = runner.segments;
    try {
      await runner.run();
      if (!signal.aborted && current()) this.history.push({ role: 'assistant', content: output.segments.join(' ') });
    } finally {
      this.emitTurnMetrics(runner, trace, output.id, signal.aborted);
      await this.persistAssistant(auth, turn.commit, turnId, output, signal.aborted || runner.blocked);
    }
  }

  private emitTurnMetrics(runner: TurnRunner, trace: TurnTrace, generationId: string, interrupted: boolean) {
    const stages = trace.stages();
    const inputTokensEstimate = Math.ceil((this.systemPrompt.length + this.history.reduce((n, m) => n + m.content.length, 0)) / 4);
    const inputTokens = runner.usage?.promptTokens ?? inputTokensEstimate;
    const outputTokens = runner.usage?.completionTokens ?? Math.ceil(runner.llmChars / 4);
    this.event('turn_metrics', {
      generationId, turnId: trace.turnId, stages,
      speechEndToFirstTokenMs: stages.llmFirstToken, speechEndToFirstAudioChunkMs: stages.firstAudioSent,
      generatedChars: runner.generated.length, ttsChars: runner.ttsChars, audioBytes: runner.audioBytes,
      inputTokensEstimate, outputTokensEstimate: Math.ceil(runner.llmChars / 4),
      usage: runner.usage, estimatedLlmAndTtsCostUsd: Number((
        inputTokens * config.costLlmInputUsdPerMillionTokens / 1_000_000 +
        outputTokens * config.costLlmOutputUsdPerMillionTokens / 1_000_000 +
        runner.ttsChars * config.costTtsUsdPer1000Chars / 1000
      ).toFixed(6)), estimateOnly: runner.usage === null,
      interrupted,
    });
    console.log(trace.logLine());
  }

  private persistRisk(auth: Auth, turnId: string, triage: Triage) {
    if (!auth.transcriptConsent) return;
    void prisma.riskEvent.create({ data: {
      conversationId: auth.conversationId, turnId, level: triage.level, evidence: triage.evidence,
      action: triage.action, policyVersion: POLICY_VERSION,
    } }).catch(() => console.warn(`[voice] ${this.id} risk_persist_failed`));
  }

  private persistReview(auth: Auth, generationId: string, segmentIndex: number, review: Review) {
    if (!auth.transcriptConsent) return;
    void prisma.responseReview.create({ data: {
      conversationId: auth.conversationId, generationId, segmentIndex,
      decision: review.decision, reasonCode: review.reasonCode, policyVersion: POLICY_VERSION,
    } }).catch(() => console.warn(`[voice] ${this.id} review_persist_failed`));
  }

  private async persistAssistant(auth: Auth, commit: Promise<number>, turnId: string, output: TurnOutput, interrupted: boolean) {
    const content = output.segments.join(' ').slice(0, 1600);
    if (!auth.transcriptConsent || !content.trim()) return;
    const assistantTurn = await commit.catch(() => 0);
    if (assistantTurn <= 0) return;
    const status = () => interrupted ? 'INTERRUPTED'
      : output.delivered.size === output.segments.length && output.segments.length > 0 ? 'DELIVERED' : 'PENDING';
    const row = await prisma.$transaction(async tx => {
      await tx.conversation.update({
        where: { id: auth.conversationId, status: 'ACTIVE' }, data: { updatedAt: new Date() },
      });
      return tx.message.create({ data: {
        conversationId: auth.conversationId, role: 'ASSISTANT', content,
        deliveredContent: this.deliveredText(output), deliveryStatus: status(), turnNumber: assistantTurn, clientTurnId: turnId,
      } });
    }).catch(() => null);
    if (!row) return;
    output.messageId = row.id;
    if (output.delivered.size) await prisma.message.updateMany({
      where: { id: row.id, conversationId: auth.conversationId },
      data: { deliveredContent: this.deliveredText(output), deliveryStatus: status() },
    });
  }

  private deliveredText(output: TurnOutput) { return output.segments.filter((_, index) => output.delivered.has(index)).join(' '); }

  private async playbackProgress(data: ClientEvent) {
    const output = this.output;
    if (!this.auth || !output || data.generationId !== output.id || !Number.isSafeInteger(data.segmentIndex) ||
        data.segmentIndex! < 0 || data.segmentIndex! >= output.segments.length) return;
    output.delivered.add(data.segmentIndex!);
    if (output.messageId && this.auth.transcriptConsent) await prisma.message.updateMany({
      where: { id: output.messageId, conversationId: this.auth.conversationId },
      data: { deliveredContent: this.deliveredText(output), deliveryStatus: output.delivered.size === output.segments.length ? 'DELIVERED' : 'PENDING' },
    });
  }

  private checkLifetime() {
    if (this.state === 'ending' || this.state === 'closed') return;
    if (Date.now() - this.lastActivity > 60_000) this.fail('idle_timeout', false);
    if (Date.now() - this.startedAt > config.voiceMaxSessionMinutes * 60_000) this.fail('session_time_limit', false);
    if (this.auth && !this.checkingAuth && Date.now() - this.lastAuthCheck > 30_000) {
      this.checkingAuth = true;
      this.lastAuthCheck = Date.now();
      void this.revalidateAuth().finally(() => { this.checkingAuth = false; });
    }
  }

  private async revalidateAuth() {
    if (!this.auth || this.state === 'ending' || this.state === 'closed') return;
    try {
      const [session, conversation] = await Promise.all([
        prisma.session.findUnique({ where: { id: this.auth.sessionId },
          select: { revokedAt: true, expiresAt: true, userId: true } }),
        prisma.conversation.findFirst({ where: { id: this.auth.conversationId,
          userId: this.auth.userId, status: 'ACTIVE' }, select: { id: true } }),
      ]);
      if (!session || session.revokedAt || session.expiresAt <= new Date() ||
          session.userId !== this.auth.userId || !conversation) this.fail('auth_expired', false);
    } catch { this.fail('auth_check_failed', false); }
  }

  private async end(disconnected = false) {
    if (this.state === 'ending' || this.state === 'closed') return;
    this.state = 'ending';
    this.abort?.abort();
    this.stt?.close();
    this.tts?.close();
    this.acoustic?.close();
    await Promise.allSettled([...this.pendingTasks]);
    let summaryStatus = 'none';
    if (this.auth) {
      try { summaryStatus = (await endConversation(this.auth.conversationId, this.auth.userId)).summaryStatus; }
      catch { summaryStatus = 'error'; }
    }
    if (!disconnected) {
      const durationMinutes = Math.max(0, (Date.now() - this.startedAt) / 60_000);
      this.event('session_end', { summaryStatus, sttConnectionMinutesEstimate: Number(durationMinutes.toFixed(3)),
        estimatedSttCostUsd: Number((durationMinutes * config.costSttUsdPerMinute).toFixed(6)),
        estimateOnly: true });
    }
    active.delete(this);
    clearInterval(this.timer);
    this.state = 'closed';
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }
}

wss.on('connection', (socket, request) => {
  const origin = request.headers.origin;
  if (origin && !config.voiceAllowedOrigins.includes(origin)) {
    socket.close(1008, 'origin_not_allowed'); return;
  }
  new VoiceSession(socket);
});

console.log(`Voice service listening on port ${config.voicePort}; max active sessions ${config.voiceMaxConversations}`);
