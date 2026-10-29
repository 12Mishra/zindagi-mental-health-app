import WebSocket from 'ws';
import { config } from '../config';

export type SttCallbacks = {
  speechStart: () => void;
  partial: (text: string) => void;
  final: (text: string) => void;
  error: (code: string) => void;
};

export class DeepgramStream {
  private socket: WebSocket | null = null;
  private finalized: string[] = [];
  private keepalive: NodeJS.Timeout | null = null;
  constructor(private readonly callbacks: SttCallbacks,
    private readonly endpoint = 'wss://api.deepgram.com/v1/listen') {}

  async connect() {
    if (!config.deepgramApiKey) throw new Error('stt_not_configured');
    const url = new URL(this.endpoint);
    for (const [key, value] of Object.entries({
      model: 'nova-3', language: 'multi', encoding: 'linear16', sample_rate: '16000', channels: '1',
      interim_results: 'true', endpointing: String(config.sttEndpointingMs), utterance_end_ms: '1000',
      vad_events: 'true', punctuate: 'true', smart_format: 'true',
    })) url.searchParams.set(key, value);
    const socket = new WebSocket(url, { headers: { Authorization: `Token ${config.deepgramApiKey}` }, maxPayload: 32 * 1024 });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { socket.terminate(); reject(new Error('stt_connect_timeout')); }, 7000);
      socket.once('open', () => { clearTimeout(timer); resolve(); });
      socket.once('error', () => { clearTimeout(timer); reject(new Error('stt_connect_failed')); });
    });
    socket.on('message', data => {
      let event: any;
      try { event = JSON.parse(data.toString()); } catch { return; }
      if (event.type === 'SpeechStarted') this.callbacks.speechStart();
      // UtteranceEnd closes a turn when endpointing never produced speech_final (e.g. background noise).
      // https://developers.deepgram.com/docs/understanding-end-of-speech-detection#using-utteranceend
      if (event.type === 'UtteranceEnd') { this.emitFinal(); return; }
      if (event.type !== 'Results') return;
      const text = event.channel?.alternatives?.[0]?.transcript;
      if (typeof text !== 'string') return;
      if (event.is_final && text.trim()) this.finalized.push(text.trim());
      if (!event.is_final && text.trim()) this.callbacks.partial([...this.finalized, text.trim()].join(' ').slice(0, 2000));
      if (event.speech_final) this.emitFinal();
    });
    socket.on('close', () => { this.stopKeepalive(); this.callbacks.error('stt_disconnected'); });
    socket.on('error', () => this.callbacks.error('stt_disconnected'));
    this.keepalive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 10_000);
  }

  /** One turn = one final: finalized segments are consumed, so a following UtteranceEnd is a no-op. */
  private emitFinal() {
    const finalText = this.finalized.join(' ').trim().slice(0, 2000);
    this.finalized = [];
    if (finalText) this.callbacks.final(finalText);
  }

  send(frame: Buffer) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    if (socket.bufferedAmount > 64 * 1024) return false;
    socket.send(frame, { binary: true });
    return true;
  }

  private stopKeepalive() { if (this.keepalive) clearInterval(this.keepalive); this.keepalive = null; }
  close() {
    this.stopKeepalive();
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.close();
    this.socket = null;
  }
}

export type LlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type LlmUsage = { promptTokens: number; completionTokens: number };
export type LisaStreamOptions = { maxTokens?: number; onUsage?: (usage: LlmUsage) => void; onRequestSent?: () => void };

/**
 * Chat templates such as Mistral's (llama.cpp, vLLM) reject anything but system?, user, assistant, user, ...
 * The context block and back-to-back student turns (after a barge-in) produce adjacent same-role messages,
 * so those are merged and a leading assistant message is dropped.
 */
export function alternateRoles(messages: LlmMessage[]): LlmMessage[] {
  const result: LlmMessage[] = [];
  for (const message of messages) {
    const last = result[result.length - 1];
    if (message.role === 'assistant' && !result.some(m => m.role !== 'system')) continue;
    if (last && last.role === message.role) last.content = `${last.content}\n\n${message.content}`;
    else result.push({ ...message });
  }
  return result;
}

export async function* streamLisa(messages: LlmMessage[], signal: AbortSignal,
  options: LisaStreamOptions = {}): AsyncGenerator<string> {
  if (!config.voiceLlmBaseUrl || !config.voiceLlmModel) throw new Error('llm_not_configured');
  const url = new URL('chat/completions', config.voiceLlmBaseUrl.endsWith('/')
    ? config.voiceLlmBaseUrl : `${config.voiceLlmBaseUrl}/`);
  options.onRequestSent?.();
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(config.voiceLlmApiKey ? { Authorization: `Bearer ${config.voiceLlmApiKey}` } : {}) },
    // Temperature is only sent when configured, so the served model's own sampling settings (Lisa's Modelfile) apply.
    body: JSON.stringify({ model: config.voiceLlmModel, messages: alternateRoles(messages), stream: true,
      max_tokens: options.maxTokens ?? config.voiceLlmMaxTokens, stream_options: { include_usage: true },
      ...(config.voiceLlmTemperature === null ? {} : { temperature: config.voiceLlmTemperature }) }),
  });
  if (!response.ok || !response.body) throw new Error(`llm_http_${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      if (pending.length > 32_000) throw new Error('llm_stream_overflow');
      const events = pending.split('\n\n');
      pending = events.pop() ?? '';
      for (const event of events) {
        const payload = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('');
        if (!payload || payload === '[DONE]') continue;
        let parsed: any;
        try { parsed = JSON.parse(payload); } catch { throw new Error('llm_bad_stream'); }
        const usage = parsed.usage;
        if (usage && Number.isSafeInteger(usage.prompt_tokens) && Number.isSafeInteger(usage.completion_tokens)) {
          options.onUsage?.({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
        }
        const token = parsed.choices?.[0]?.delta?.content;
        if (typeof token === 'string' && token) yield token;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Fire-and-forget 1-token request so the first real turn does not pay the model cold start. */
export async function warmLisa(timeoutMs = 15_000) {
  try {
    for await (const token of streamLisa([{ role: 'user', content: 'Hi' }], AbortSignal.timeout(timeoutMs), { maxTokens: 1 })) void token;
  } catch { /* warm-up is best effort */ }
}

/** Re-chunks a byte stream into 16-bit aligned PCM pieces with a total output bound. */
export class PcmAligner {
  private trailing = Buffer.alloc(0);
  private byteCount = 0;
  constructor(private readonly onChunk: (chunk: Buffer) => void, private readonly maxBytes = 2_000_000) {}
  get bytes() { return this.byteCount; }

  push(value: Uint8Array) {
    const data = this.trailing.length ? Buffer.concat([this.trailing, Buffer.from(value)]) : Buffer.from(value);
    if (!this.byteCount && (data.subarray(0, 4).toString() === 'RIFF' || data.subarray(0, 3).toString() === 'ID3')) {
      throw new Error('tts_unexpected_codec');
    }
    const aligned = data.length - (data.length % 2);
    this.trailing = aligned === data.length ? Buffer.alloc(0) : data.subarray(aligned);
    for (let offset = 0; offset < aligned; offset += 4800) {
      const chunk = data.subarray(offset, Math.min(offset + 4800, aligned));
      this.byteCount += chunk.length;
      if (this.byteCount > this.maxBytes) throw new Error('tts_output_limit');
      this.onChunk(chunk);
    }
  }

  end() { if (this.trailing.length) throw new Error('tts_unaligned_pcm'); }
}

export type TtsVoice = { languageCode: 'hi-IN' | 'en-IN'; speaker: string };

/** HTTP fallback (`TTS_TRANSPORT=http`): one streamed POST per clause. */
export async function streamSarvamPcm(text: string, voice: TtsVoice, signal: AbortSignal, onChunk: (chunk: Buffer) => void) {
  if (!config.sarvamApiKey) throw new Error('tts_not_configured');
  const response = await fetch('https://api.sarvam.ai/text-to-speech/stream', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': config.sarvamApiKey },
    body: JSON.stringify({
      text, language_code: voice.languageCode, speaker: voice.speaker, model: 'bulbul:v3', pace: 1,
      speech_sample_rate: 24000, output_audio_codec: 'linear16',
    }),
  });
  if (!response.ok || !response.body) throw new Error(`tts_http_${response.status}`);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('mpeg') || contentType.includes('wav') || contentType.includes('mp3') || contentType.includes('json')) {
    throw new Error('tts_unexpected_codec');
  }
  const reader = response.body.getReader();
  const aligner = new PcmAligner(onChunk);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      aligner.push(value);
    }
    aligner.end();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
