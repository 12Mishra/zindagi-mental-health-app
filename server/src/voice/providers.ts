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
      interim_results: 'true', endpointing: '450', vad_events: 'true', punctuate: 'true',
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
      if (event.type !== 'Results') return;
      const text = event.channel?.alternatives?.[0]?.transcript;
      if (typeof text !== 'string') return;
      if (event.is_final && text.trim()) this.finalized.push(text.trim());
      if (!event.is_final && text.trim()) this.callbacks.partial([...this.finalized, text.trim()].join(' ').slice(0, 2000));
      if (event.speech_final) {
        const finalText = this.finalized.join(' ').trim().slice(0, 2000);
        this.finalized = [];
        if (finalText) this.callbacks.final(finalText);
      }
    });
    socket.on('close', () => { this.stopKeepalive(); this.callbacks.error('stt_disconnected'); });
    socket.on('error', () => this.callbacks.error('stt_disconnected'));
    this.keepalive = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'KeepAlive' }));
    }, 10_000);
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

export async function* streamLisa(messages: LlmMessage[], signal: AbortSignal): AsyncGenerator<string> {
  if (!config.voiceLlmBaseUrl || !config.voiceLlmModel) throw new Error('llm_not_configured');
  const url = new URL('chat/completions', config.voiceLlmBaseUrl.endsWith('/')
    ? config.voiceLlmBaseUrl : `${config.voiceLlmBaseUrl}/`);
  const response = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...(config.voiceLlmApiKey ? { Authorization: `Bearer ${config.voiceLlmApiKey}` } : {}) },
    // Let the served model's own sampling settings apply (Lisa's Modelfile specifies temperature/top_p).
    body: JSON.stringify({ model: config.voiceLlmModel, messages, stream: true, max_tokens: 200 }),
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
        const token = parsed.choices?.[0]?.delta?.content;
        if (typeof token === 'string' && token) yield token;
      }
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function streamSarvamPcm(text: string, signal: AbortSignal, onChunk: (chunk: Buffer) => void) {
  if (!config.sarvamApiKey) throw new Error('tts_not_configured');
  const language_code = /[\u0900-\u097f]/u.test(text) ? 'hi-IN' : 'en-IN';
  const response = await fetch('https://api.sarvam.ai/text-to-speech/stream', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'api-subscription-key': config.sarvamApiKey },
    body: JSON.stringify({
      text, language_code, speaker: 'shubh', model: 'bulbul:v3', pace: 1,
      speech_sample_rate: 24000, output_audio_codec: 'linear16',
    }),
  });
  if (!response.ok || !response.body) throw new Error(`tts_http_${response.status}`);
  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('mpeg') || contentType.includes('wav') || contentType.includes('mp3') || contentType.includes('json')) {
    throw new Error('tts_unexpected_codec');
  }
  const reader = response.body.getReader();
  let trailing = Buffer.alloc(0);
  let byteCount = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const data = trailing.length ? Buffer.concat([trailing, Buffer.from(value)]) : Buffer.from(value);
      if (!byteCount && (data.subarray(0, 4).toString() === 'RIFF' || data.subarray(0, 3).toString() === 'ID3')) {
        throw new Error('tts_unexpected_codec');
      }
      const aligned = data.length - (data.length % 2);
      trailing = aligned === data.length ? Buffer.alloc(0) : data.subarray(aligned);
      for (let offset = 0; offset < aligned; offset += 4800) {
        const chunk = data.subarray(offset, Math.min(offset + 4800, aligned));
        byteCount += chunk.length;
        if (byteCount > 2_000_000) throw new Error('tts_output_limit');
        onChunk(chunk);
      }
    }
    if (trailing.length) throw new Error('tts_unaligned_pcm');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
