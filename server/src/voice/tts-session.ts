import WebSocket from 'ws';
import { config } from '../config';
import { PcmAligner, streamSarvamPcm, type TtsVoice } from './providers';

export interface TtsSession {
  open(): Promise<void>;
  /** Voice for the following `speak` calls; chosen once per student turn. */
  setVoice(voice: TtsVoice): void;
  speak(text: string, segmentIndex: number, onChunk: (pcm: Buffer) => void, signal: AbortSignal): Promise<void>;
  /** Barge-in: stop all in-flight synthesis. Pending `speak` calls resolve without further audio. */
  cancel(): void;
  close(): void;
}

type Job = { aligner: PcmAligner; resolve: () => void; reject: (error: Error) => void };

/**
 * Persistent Sarvam Bulbul v3 streaming socket, PCM16 24 kHz mono.
 * Protocol: https://docs.sarvam.ai/api-reference/text-to-speech/stream and
 * https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/streaming-api/web-socket
 * - `config` must be the first message; sending it again mid-socket switches language (verified against the live API).
 * - Each `text` + `flush` yields audio messages followed by one `event` with `event_type: "final"` when
 *   `send_completion_event=true`, so pipelined clauses are matched to audio in FIFO order.
 * - There is no server-side cancel message, so `cancel()` closes the socket and reopens it in the background.
 * - Idle sockets close after ~1 minute, so a ping is sent periodically.
 */
export class SarvamWsTtsSession implements TtsSession {
  private socket: WebSocket | null = null;
  private opening: Promise<void> | null = null;
  private jobs: Job[] = [];
  private voice: TtsVoice = { languageCode: 'en-IN', speaker: config.ttsSpeaker };
  private configuredVoice = '';
  private ping: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(private readonly endpoint = 'wss://api.sarvam.ai/text-to-speech/ws', private readonly pingMs = 20_000) {}

  setVoice(voice: TtsVoice) { this.voice = voice; }

  open(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('tts_closed'));
    if (this.socket?.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.opening) return this.opening;
    if (!config.sarvamApiKey) return Promise.reject(new Error('tts_not_configured'));
    const url = new URL(this.endpoint);
    url.searchParams.set('model', 'bulbul:v3');
    url.searchParams.set('send_completion_event', 'true');
    const socket = new WebSocket(url, { headers: { 'Api-Subscription-Key': config.sarvamApiKey }, maxPayload: 1024 * 1024 });
    this.socket = socket;
    this.configuredVoice = '';
    this.opening = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('tts_connect_timeout')); }, 7000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('tts_connect_failed')); });
    }).finally(() => { this.opening = null; });
    socket.on('message', data => this.receive(socket, data));
    socket.on('close', () => this.disconnected(socket, 'tts_disconnected'));
    socket.on('error', () => this.disconnected(socket, 'tts_disconnected'));
    if (!this.ping) this.ping = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'ping' }));
    }, this.pingMs);
    return this.opening;
  }

  async speak(text: string, _segmentIndex: number, onChunk: (pcm: Buffer) => void, signal: AbortSignal) {
    if (signal.aborted) return;
    await this.open();
    const socket = this.socket;
    if (signal.aborted) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('tts_disconnected');
    const voiceKey = `${this.voice.languageCode}:${this.voice.speaker}`;
    if (voiceKey !== this.configuredVoice) {
      socket.send(JSON.stringify({ type: 'config', data: {
        model: 'bulbul:v3', language_code: this.voice.languageCode, speaker: this.voice.speaker, pace: 1,
        speech_sample_rate: '24000', output_audio_codec: 'linear16', min_buffer_size: 30, max_chunk_length: 250,
      } }));
      this.configuredVoice = voiceKey;
    }
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => this.cancel();
      const job: Job = {
        aligner: new PcmAligner(onChunk),
        resolve: () => { signal.removeEventListener('abort', onAbort); resolve(); },
        reject: error => { signal.removeEventListener('abort', onAbort); reject(error); },
      };
      this.jobs.push(job);
      signal.addEventListener('abort', onAbort, { once: true });
      socket.send(JSON.stringify({ type: 'text', data: { text: text.slice(0, 2500) } }));
      socket.send(JSON.stringify({ type: 'flush' }));
    });
  }

  cancel() {
    if (!this.socket && !this.jobs.length) return;
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) job.resolve();
    const socket = this.socket;
    this.socket = null;
    this.opening = null;
    socket?.terminate();
    // Reopen in the background so the next reply does not pay the connection cost.
    if (!this.closed) void this.open().catch(() => {});
  }

  close() {
    this.closed = true;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) job.resolve();
    const socket = this.socket;
    this.socket = null;
    if (socket?.readyState === WebSocket.OPEN) socket.close(); else socket?.terminate();
  }

  private receive(socket: WebSocket, data: WebSocket.RawData) {
    if (socket !== this.socket) return;
    let message: any;
    try { message = JSON.parse(data.toString()); } catch { this.fail('tts_bad_message'); return; }
    if (message.type === 'audio') {
      const job = this.jobs[0];
      if (!job) return;
      const contentType = String(message.data?.content_type ?? '').toLowerCase();
      if (/mpeg|mp3|wav|aac|opus/.test(contentType) || typeof message.data?.audio !== 'string') {
        this.fail('tts_unexpected_codec'); return;
      }
      try { job.aligner.push(Buffer.from(message.data.audio, 'base64')); }
      catch (error) { this.fail(error instanceof Error ? error.message : 'tts_bad_audio'); }
    } else if (message.type === 'event' && message.data?.event_type === 'final') {
      const job = this.jobs.shift();
      if (!job) return;
      try { job.aligner.end(); job.resolve(); }
      catch (error) { job.reject(error instanceof Error ? error : new Error('tts_bad_audio')); }
    } else if (message.type === 'error') this.fail('tts_provider_error');
  }

  private fail(code: string) {
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) job.reject(new Error(code));
    const socket = this.socket;
    this.socket = null;
    socket?.terminate();
  }

  private disconnected(socket: WebSocket, code: string) {
    if (socket !== this.socket) return;
    this.socket = null;
    const jobs = this.jobs;
    this.jobs = [];
    for (const job of jobs) job.reject(new Error(code));
  }
}

/** `TTS_TRANSPORT=http` fallback: per-clause HTTP stream, kept so the demo can fall back. */
export class HttpTtsSession implements TtsSession {
  private voice: TtsVoice = { languageCode: 'en-IN', speaker: config.ttsSpeaker };
  private controller = new AbortController();
  async open() {}
  setVoice(voice: TtsVoice) { this.voice = voice; }
  async speak(text: string, _segmentIndex: number, onChunk: (pcm: Buffer) => void, signal: AbortSignal) {
    await streamSarvamPcm(text, this.voice, AbortSignal.any([signal, this.controller.signal]), onChunk);
  }
  cancel() { this.controller.abort(); this.controller = new AbortController(); }
  close() { this.controller.abort(); }
}

export const createTtsSession = (): TtsSession =>
  config.ttsTransport === 'http' ? new HttpTtsSession() : new SarvamWsTtsSession();
