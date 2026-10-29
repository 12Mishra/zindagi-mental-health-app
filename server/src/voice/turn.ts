import { ClauseChunker } from './clause-chunker';
import {
  RESPONSE_UNAVAILABLE, SAFETY_CLARIFICATION, URGENT_SUPPORT, isServiceMessage, reviewLisaSegment,
  type PolicyText, type Review, type Triage, type TurnLanguage,
} from './policy';
import type { LlmUsage } from './providers';
import { ReleaseGate } from './release-gate';
import { SpeechPipeline, type Synthesize } from './speech-pipeline';
import type { TurnTrace } from './trace';

export type LlmHooks = { onRequestSent: () => void; onUsage: (usage: LlmUsage) => void };

export type TurnDeps = {
  streamLlm: (signal: AbortSignal, hooks: LlmHooks) => AsyncIterable<string>;
  /** Structured LLM triage of the student utterance (never throws; failure is UNKNOWN). */
  triage: (signal: AbortSignal) => Promise<Triage>;
  /** Async LLM audit of one released clause. */
  review: (text: string) => Promise<Review>;
  synthesize: Synthesize;
  emit: (type: string, extra?: Record<string, unknown>) => void;
  /** Sends one binary PCM frame; may throw on backpressure. */
  sendAudio: (pcm: Buffer) => void;
  /** False once a newer generation started; late work is dropped. */
  isCurrent: () => boolean;
  playing?: () => void;
  triaged?: (triage: Triage) => void;
  reviewed?: (segmentIndex: number, review: Review) => void;
};

export type TurnOptions = {
  language: TurnLanguage;
  regex: Triage;
  gateMs: number;
  outputReview: 'async' | 'off';
  signal: AbortSignal;
  trace: TurnTrace;
};

const FORMAT = { encoding: 'pcm_s16le', sampleRate: 24000, channels: 1 };
const LOW: Triage = { level: 'LOW', action: 'continue' };

/**
 * One student turn on the hot path: regex triage → (LLM triage ∥ Lisa stream → clause chunker → release gate)
 * → sync regex review → TTS, with async output audits. Only the regex and the bounded gate wait sit between
 * the end of speech and the first audio.
 */
export class TurnRunner {
  readonly segments: string[] = [];
  generated = '';
  llmChars = 0;
  ttsChars = 0;
  audioBytes = 0;
  usage: LlmUsage | null = null;
  /** Set when a review blocked Lisa's output (sync regex or async audit). */
  blocked = false;
  /** Final triage for the turn, once known. */
  triage: Triage | null = null;
  private readonly llmAbort = new AbortController();
  private pipeline: SpeechPipeline;
  private gate: ReleaseGate<string> | null = null;
  private readonly audits = new Set<Promise<void>>();
  private triageBlock: Triage | null = null;

  constructor(private readonly deps: TurnDeps, private readonly options: TurnOptions) {
    const abort = () => this.llmAbort.abort();
    if (options.signal.aborted) abort(); else options.signal.addEventListener('abort', abort, { once: true });
    this.pipeline = this.createPipeline();
  }

  private get live() { return !this.options.signal.aborted && this.deps.isCurrent(); }

  async run() {
    const { regex } = this.options;
    try {
      if (regex.level !== 'LOW') await this.runFixed(regex);
      else await this.runLisa();
    } catch (error) {
      if (!this.live) return;
      // Error codes only (e.g. llm_http_400, tts_disconnected); never transcript text.
      console.warn(`[turn] ${this.options.trace.turnId} failed: ${error instanceof Error ? error.message : 'unknown'}`);
      this.gate?.close();
      this.llmAbort.abort();
      this.pipeline.cancel();
      this.deps.emit('error', { code: 'generation_failed', recoverable: true, message: 'generation failed' });
      if (!this.segments.length) await this.speakFixed(RESPONSE_UNAVAILABLE).catch(() => {});
    } finally {
      await Promise.allSettled([...this.audits]);
    }
  }

  /** Regex said URGENT/UNKNOWN: speak the fixed message at once, no Lisa generation; LLM triage only for the record. */
  private async runFixed(regex: Triage) {
    this.deps.emit('risk', { level: regex.level, action: regex.action, provisional: true });
    this.speak(regex.level === 'URGENT' ? URGENT_SUPPORT : SAFETY_CLARIFICATION, true);
    const triage = await this.resolveTriage();
    // An uncertain regex match that the LLM confirms as urgent also gets the support message.
    if (triage && regex.level !== 'URGENT' && triage.level === 'URGENT' && this.live) this.speak(URGENT_SUPPORT, true);
    await this.pipeline.finish();
  }

  private async runLisa() {
    const { trace, gateMs } = this.options;
    this.gate = new ReleaseGate<string>({
      regexLevel: 'LOW', timeoutMs: gateMs,
      release: clause => this.release(clause),
      block: (triage, late) => {
        this.triageBlock = triage;
        this.llmAbort.abort();
        if (late) this.cut();
      },
      opened: () => trace.mark('gateReleased'),
    });
    const gate = this.gate;
    this.deps.emit('processing', { stage: 'lisa_generation' });
    const triage = this.resolveTriage().then(result => {
      if (result) gate.settle(result); else gate.close();
    });
    const producer = this.produce(gate).catch(error => { if (!this.llmAbort.signal.aborted) throw error; });
    await Promise.all([producer, triage]);
    await this.pipeline.finish();
    if (this.triageBlock && this.live) {
      this.pipeline = this.createPipeline();
      this.speak(this.triageBlock.level === 'URGENT' ? URGENT_SUPPORT : SAFETY_CLARIFICATION, true);
      await this.pipeline.finish();
    }
  }

  private async produce(gate: ReleaseGate<string>) {
    const { trace } = this.options;
    const chunker = new ClauseChunker();
    const push = (clauses: string[]) => {
      for (const clause of clauses) { trace.mark('firstClauseReady'); gate.push(clause); }
    };
    const hooks: LlmHooks = { onRequestSent: () => trace.mark('llmRequestSent'), onUsage: usage => { this.usage = usage; } };
    for await (const token of this.deps.streamLlm(this.llmAbort.signal, hooks)) {
      if (this.llmAbort.signal.aborted) return;
      trace.mark('llmFirstToken');
      this.llmChars += token.length;
      this.generated += token;
      if (this.generated.length > 1600) throw new Error('response_too_long');
      push(chunker.push(token));
    }
    if (!this.llmAbort.signal.aborted) push(chunker.flush());
  }

  /** Runs the LLM triage and records it; null when the turn was cancelled meanwhile. */
  private async resolveTriage() {
    const triage = await this.deps.triage(this.options.signal);
    this.options.trace.mark('triageLlmDone');
    if (this.options.signal.aborted) return null;
    this.triage = triage;
    this.deps.emit('risk', { level: triage.level, action: triage.action });
    this.deps.triaged?.(triage);
    return triage;
  }

  /** Gate released a clause: synchronous regex review, then TTS, then async audit. */
  private release(clause: string) {
    if (!this.live || this.pipeline.cancelled) return;
    const review = reviewLisaSegment(clause, LOW);
    if (review.decision !== 'ALLOW') {
      this.blocked = true;
      this.llmAbort.abort();
      this.gate?.close();
      this.deps.reviewed?.(this.segments.length, review);
      this.deps.emit('error', { code: 'response_blocked', recoverable: true, message: 'response blocked' });
      if (!this.segments.length) this.speak(RESPONSE_UNAVAILABLE, true);
      return;
    }
    const index = this.speak(clause, false);
    if (this.options.outputReview === 'async') this.audit(clause, index);
  }

  private audit(clause: string, segmentIndex: number) {
    const task = this.deps.review(clause).then(review => {
      this.options.trace.reviewDone(segmentIndex);
      this.deps.reviewed?.(segmentIndex, review);
      if (review.decision === 'BLOCK' && !this.blocked && this.live) {
        this.blocked = true;
        this.deps.emit('error', { code: 'response_blocked', recoverable: true, message: 'response blocked' });
        this.cut();
      } else if (review.decision === 'UNKNOWN') {
        console.warn(`[review] ${this.options.trace.turnId} segment=${segmentIndex} ${review.reasonCode}`);
      }
    }).catch(() => {}).finally(() => { this.audits.delete(task); });
    this.audits.add(task);
  }

  /** Stop unchecked audio now: abort generation and synthesis, drop late chunks, tell the client to flush playback. */
  private cut() {
    this.llmAbort.abort();
    this.gate?.close();
    if (this.pipeline.cancelled) return;
    this.pipeline.cancel();
    this.deps.emit('interrupted', { reason: 'safety' });
  }

  private speakFixed(message: PolicyText) {
    this.pipeline = this.createPipeline();
    this.speak(message, true);
    return this.pipeline.finish();
  }

  private speak(text: string | PolicyText, fixed: boolean) {
    const value = typeof text === 'string' ? text : text[this.options.language];
    const segmentIndex = this.segments.length;
    this.segments.push(value);
    if (fixed) this.deps.reviewed?.(segmentIndex, { decision: 'ALLOW', reasonCode: 'fixed_safety_response' });
    this.deps.emit('response_text', { text: value, segmentIndex, serviceMessage: isServiceMessage(value) });
    this.pipeline.push(value, segmentIndex);
    return segmentIndex;
  }

  private createPipeline(): SpeechPipeline {
    const { trace, signal } = this.options;
    let pipeline: SpeechPipeline;
    const stale = () => !this.live || pipeline.cancelled;
    pipeline = new SpeechPipeline((text, index, onChunk, synthSignal) => {
      trace.mark('ttsRequestSent');
      return this.deps.synthesize(text, index, pcm => { trace.mark('ttsFirstByte'); onChunk(pcm); }, synthSignal);
    }, {
      start: segmentIndex => {
        if (stale()) return;
        this.deps.playing?.();
        this.deps.emit('audio_start', { segmentIndex, format: FORMAT });
      },
      chunk: (segmentIndex, chunkIndex, pcm) => {
        if (stale()) return;
        this.deps.emit('audio_chunk', { segmentIndex, chunkIndex, byteLength: pcm.length });
        this.deps.sendAudio(pcm);
        this.audioBytes += pcm.length;
        trace.mark('firstAudioSent');
        trace.markLast('lastAudioSent');
      },
      end: (segmentIndex, text) => {
        if (stale()) return;
        this.ttsChars += text.length;
        this.deps.emit('audio_end', { segmentIndex });
      },
    }, signal);
    return pipeline;
  }
}
