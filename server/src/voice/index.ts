import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from '../config';
import { prisma } from '../db';
import { buildConversationContext } from '../conversation/services/context.service';
import { endConversation } from '../conversation/services/conversation.service';
import { consumeVoiceTicket } from './tickets';
import { AcousticAnalyzer } from './acoustic';
import { DeepgramStream, streamLisa, streamSarvamPcm, type LlmMessage } from './providers';
import { assessStudentUtterance, checkLisaSegment } from './safety-classifier';
import {
  POLICY_VERSION, RESPONSE_UNAVAILABLE, SAFETY_CLARIFICATION, URGENT_SUPPORT,
  triageStableUtterance, type Triage,
} from './policy';

type Auth = { userId: string; conversationId: string; sessionId: string; transcriptConsent: boolean };
type ClientEvent = { type?: string; generationId?: string; segmentIndex?: number; ticket?: string; format?: unknown; v?: number };
type State = 'connecting' | 'listening' | 'user_speaking' | 'endpointing' | 'generating' | 'playing' | 'interrupted' | 'ending' | 'closed';
type TurnMetrics = { speechEndAt: number; firstTokenAt: number | null; firstAudioAt: number | null;
  inputTokensEstimate: number; llmChars: number; ttsChars: number; audioBytes: number };
type TurnOutput = { id: string; segments: string[]; delivered: Set<number>; messageId: string | null };

const active = new Set<VoiceSession>();
let admitting = 0;
const wss = new WebSocketServer({ port: config.voicePort, path: '/voice', maxPayload: 8192 });

class VoiceSession {
  readonly id = randomUUID();
  private auth: Auth | null = null;
  private stt: DeepgramStream | null = null;
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
    else if (data.type === 'interrupt') this.interrupt();
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
      if (!config.deepgramApiKey || !config.sarvamApiKey || !config.voiceLlmBaseUrl || !config.voiceLlmModel || !config.voiceSafetyModel) {
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
      await this.stt.connect();
      this.acoustic = new AcousticAnalyzer(value => this.event('acoustic', value));
      active.add(this);
      this.state = 'listening';
      this.startedAt = Date.now();
      this.event('ready', { format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1 },
        playback: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 }, model: config.voiceLlmModel });
    } catch { this.fail('voice_start_failed', false); }
    finally { admitting--; }
  }

  private onPartial(text: string) {
    this.event('transcript_partial', { text });
    if (Date.now() - this.lastPartialCheck < 250) return;
    this.lastPartialCheck = Date.now();
    const provisional = triageStableUtterance(text);
    if (provisional.level === 'URGENT') {
      if (this.state === 'generating' || this.state === 'playing') this.interrupt();
      this.event('risk', { level: 'URGENT', provisional: true, action: provisional.action, policyVersion: POLICY_VERSION });
    }
  }

  private onSpeechStart() {
    if (this.state === 'ending' || this.state === 'closed') return;
    if (this.state === 'generating' || this.state === 'playing') this.interrupt();
    this.state = 'user_speaking';
    this.event('speech_start');
  }

  private onFinal(text: string) {
    if (!this.auth || this.state === 'ending' || this.state === 'closed') return;
    if (this.state === 'generating' || this.state === 'playing') this.interrupt();
    this.state = 'endpointing';
    const turnId = `${this.id}-${++this.turn}`;
    this.lastTurnId = turnId;
    this.event('speech_end');
    this.event('transcript_final', { text });
    this.interrupt(false);
    this.state = 'generating';
    const generation = ++this.generation;
    this.generationId = randomUUID();
    this.abort = new AbortController();
    const output: TurnOutput = { id: this.generationId, segments: [], delivered: new Set(), messageId: null };
    this.output = output;
    this.history.push({ role: 'user', content: text });
    this.history = this.history.slice(-20);
    const history = [...this.history];
    const commit = this.commitTail.then(() => this.persistUser(text, turnId));
    this.commitTail = commit.then(() => {}, () => {});
    const task = this.respond(text, turnId, generation, output, history, commit,
      this.abort.signal, performance.now()).catch(() => {
      this.fail('turn_internal_error', true);
    }).finally(() => {
      if (this.generation === generation && this.state !== 'ending' && this.state !== 'closed') this.state = 'listening';
      this.pendingTasks.delete(task);
    });
    this.pendingTasks.add(task);
  }

  private interrupt(announce = true) {
    this.abort?.abort();
    this.abort = null;
    this.generation++;
    if (this.state === 'generating' || this.state === 'playing') {
      this.state = 'interrupted';
      if (announce) this.event('interrupted');
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

  private async respond(text: string, turnId: string, generation: number, output: TurnOutput,
    history: LlmMessage[], commit: Promise<number>, signal: AbortSignal, speechEndAt: number) {
    if (!this.auth) return;
    const auth = this.auth;
    const responseId = output.id;
    let assistantTurn = 0;
    let generated = '';
    let blocked = false;
    const metrics: TurnMetrics = { speechEndAt, firstTokenAt: null, firstAudioAt: null,
      inputTokensEstimate: 0, llmChars: 0, ttsChars: 0, audioBytes: 0 };
    try {
      const [triage, committedTurn] = await Promise.all([
        assessStudentUtterance(text, signal,
          history.filter(message => message.role === 'user').slice(-3, -1).map(message => message.content)),
        commit,
      ]);
      assistantTurn = committedTurn;
      this.event('risk', { turnId, generationId: responseId, level: triage.level,
        action: triage.action, policyVersion: POLICY_VERSION });
      if (auth.transcriptConsent) await prisma.riskEvent.create({ data: {
        conversationId: auth.conversationId, turnId, level: triage.level, evidence: triage.evidence,
        action: triage.action, policyVersion: POLICY_VERSION,
      } });
      if (signal.aborted || generation !== this.generation) return;
      if (triage.level !== 'LOW') {
        generated = triage.level === 'URGENT' ? URGENT_SUPPORT : SAFETY_CLARIFICATION;
        await this.speak(generated, 0, output, generation, signal, triage, true, metrics, text);
      } else {
        metrics.inputTokensEstimate = Math.ceil((this.systemPrompt.length +
          history.reduce((n, m) => n + m.content.length, 0)) / 4);
        let pending = '';
        for await (const token of streamLisa([{ role: 'system', content: this.systemPrompt }, ...history], signal)) {
          if (signal.aborted || generation !== this.generation) return;
          if (metrics.firstTokenAt === null) metrics.firstTokenAt = performance.now();
          metrics.llmChars += token.length;
          generated += token;
          pending += token;
          if (generated.length > 1600) throw new Error('response_too_long');
          let split = pending.search(/[.!?।]\s/u);
          if (split >= 18) split += 1;
          else if (pending.length >= 120) split = pending.lastIndexOf(' ', 120);
          else split = -1;
          if (split >= 18) {
            const clause = pending.slice(0, split).trim();
            pending = pending.slice(split).trimStart();
            await this.speak(clause, output.segments.length, output, generation, signal, triage, false, metrics, text);
          }
        }
        if (pending.trim() && !signal.aborted && generation === this.generation) {
          await this.speak(pending.trim(), output.segments.length, output, generation, signal, triage, false, metrics, text);
        }
      }
      if (!signal.aborted && generation === this.generation) this.history.push({ role: 'assistant', content: output.segments.join(' ') });
    } catch (error) {
      if (!signal.aborted) {
        blocked = error instanceof Error && error.message === 'response_blocked';
        this.fail(blocked ? 'response_blocked' : 'generation_failed', true);
        if (blocked && generation === this.generation) this.event('response_text', { text: RESPONSE_UNAVAILABLE, segmentIndex: output.segments.length, serviceMessage: true });
      }
    } finally {
      this.event('turn_metrics', {
        generationId: responseId, turnId,
        speechEndToFirstTokenMs: metrics.firstTokenAt === null ? null : Math.round(metrics.firstTokenAt - metrics.speechEndAt),
        speechEndToFirstAudioChunkMs: metrics.firstAudioAt === null ? null : Math.round(metrics.firstAudioAt - metrics.speechEndAt),
        generatedChars: generated.length, ttsChars: metrics.ttsChars, audioBytes: metrics.audioBytes,
        inputTokensEstimate: metrics.inputTokensEstimate,
        outputTokensEstimate: Math.ceil(metrics.llmChars / 4),
        estimatedLlmAndTtsCostUsd: Number((
          metrics.inputTokensEstimate * config.costLlmInputUsdPerMillionTokens / 1_000_000 +
          Math.ceil(metrics.llmChars / 4) * config.costLlmOutputUsdPerMillionTokens / 1_000_000 +
          metrics.ttsChars * config.costTtsUsdPer1000Chars / 1000
        ).toFixed(6)), estimateOnly: true,
        interrupted: signal.aborted,
      });
      if (auth.transcriptConsent && assistantTurn > 0 && generated.trim()) {
        const deliveredContent = this.deliveredText(output);
        const status = signal.aborted || blocked ? 'INTERRUPTED'
          : output.delivered.size === output.segments.length && output.segments.length > 0 ? 'DELIVERED' : 'PENDING';
        const row = await prisma.$transaction(async tx => {
          await tx.conversation.update({
            where: { id: auth.conversationId, status: 'ACTIVE' }, data: { updatedAt: new Date() },
          });
          return tx.message.create({ data: {
            conversationId: auth.conversationId, role: 'ASSISTANT', content: generated.slice(0, 1600),
            deliveredContent, deliveryStatus: status, turnNumber: assistantTurn, clientTurnId: turnId,
          } });
        }).catch(() => null);
        if (row) {
          output.messageId = row.id;
          if (output.delivered.size) await prisma.message.updateMany({
            where: { id: row.id, conversationId: auth.conversationId },
            data: { deliveredContent: this.deliveredText(output),
              deliveryStatus: signal.aborted || blocked ? 'INTERRUPTED' :
                output.delivered.size === output.segments.length ? 'DELIVERED' : 'PENDING' },
          });
        }
      }
    }
  }

  private async speak(text: string, segmentIndex: number, output: TurnOutput, generation: number,
    signal: AbortSignal, triage: Triage, policyResponse: boolean, metrics: TurnMetrics, studentUtterance: string) {
    if (!this.auth || signal.aborted || generation !== this.generation) return;
    const allowedPolicyText = text === URGENT_SUPPORT || text === SAFETY_CLARIFICATION;
    const review = policyResponse && allowedPolicyText
      ? { decision: 'ALLOW' as const, reasonCode: 'fixed_safety_response' }
      : await checkLisaSegment(text, triage, signal, studentUtterance);
    if (this.auth.transcriptConsent) await prisma.responseReview.create({ data: {
      conversationId: this.auth.conversationId, generationId: output.id, segmentIndex,
      decision: review.decision, reasonCode: review.reasonCode, policyVersion: POLICY_VERSION,
    } });
    if (review.decision !== 'ALLOW') throw new Error('response_blocked');
    if (signal.aborted || generation !== this.generation) return;
    output.segments.push(text);
    this.event('response_text', { text, segmentIndex });
    let chunkIndex = 0;
    await streamSarvamPcm(text, signal, chunk => {
      if (signal.aborted || generation !== this.generation || this.socket.readyState !== WebSocket.OPEN) return;
      if (this.socket.bufferedAmount > 64 * 1024) throw new Error('playback_backpressure');
      if (chunkIndex === 0) {
        if (metrics.firstAudioAt === null) metrics.firstAudioAt = performance.now();
        this.state = 'playing';
        this.event('audio_start', { segmentIndex, format: { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 } });
      }
      this.event('audio_chunk', { segmentIndex, chunkIndex: chunkIndex++, byteLength: chunk.length });
      this.socket.send(chunk, { binary: true });
      metrics.audioBytes += chunk.length;
    });
    if (!chunkIndex && !signal.aborted) throw new Error('tts_empty_audio');
    if (chunkIndex) metrics.ttsChars += text.length;
    if (!signal.aborted && generation === this.generation) this.event('audio_end', { segmentIndex });
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
