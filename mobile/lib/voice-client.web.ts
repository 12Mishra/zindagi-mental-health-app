import type { VoiceClient, VoiceClientOptions, VoiceEvent } from './voice-client-types';

const CAPTURE_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  constructor() { super(); this.out = new Int16Array(320); this.index = 0; this.previous = 0; this.position = 0; this.next = 0; this.active = true;
    this.port.onmessage = e => { if (e.data === 'stop') this.active = false; };
  }
  process(inputs, outputs) {
    const channel = inputs[0] && inputs[0][0];
    const output = outputs[0] && outputs[0][0];
    if (output) output.fill(0);
    if (!this.active || !channel) return true;
    const step = sampleRate / 16000;
    for (let i = 0; i < channel.length; i++) {
      const current = channel[i];
      while (this.next <= this.position) {
        const fraction = this.position ? Math.max(0, Math.min(1, this.next - (this.position - 1))) : 1;
        const value = this.previous + (current - this.previous) * fraction;
        this.out[this.index++] = Math.max(-32768, Math.min(32767, Math.round(value * 32767)));
        this.next += step;
        if (this.index === 320) { const frame = this.out.buffer; this.port.postMessage(frame, [frame]); this.out = new Int16Array(320); this.index = 0; }
      }
      this.previous = current; this.position++;
    }
    return true;
  }
}
registerProcessor('zindagi-pcm-capture', PcmCapture);
`;

const startupMessage = (code?: string) => {
  if (code === 'provider_not_configured') return 'Voice service is missing a provider or safety checker. Check server/.env and restart the voice service.';
  if (code === 'origin_not_allowed') return 'This browser origin is not allowed by the voice service. Check VOICE_ALLOWED_ORIGINS.';
  if (code === 'invalid_ticket') return 'Voice access expired. Please try starting the session again.';
  return code ? `Voice could not start (${code}). Check the voice service terminal.` :
    'Cannot connect to the voice service. Start npm run voice in the server folder and check its terminal.';
};

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  let socket: WebSocket | null = null;
  let captureContext: AudioContext | null = null;
  let playbackContext: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let worklet: AudioWorkletNode | null = null;
  let workletUrl: string | null = null;
  let queuedEnvelope: VoiceEvent | null = null;
  let nextPlaybackTime = 0;
  let currentGeneration = '';
  const playing = new Set<AudioBufferSourceNode>();
  const lastSource = new Map<number, AudioBufferSourceNode>();
  let ended = false;

  const send = (value: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, ...value }));
  };
  const stopPlayback = () => {
    currentGeneration = '';
    for (const source of playing) { try { source.stop(); } catch {} }
    playing.clear(); lastSource.clear(); queuedEnvelope = null;
    nextPlaybackTime = playbackContext?.currentTime ?? 0;
  };
  const cleanup = () => {
    worklet?.port.postMessage('stop'); worklet?.disconnect(); worklet = null;
    stream?.getTracks().forEach(track => track.stop()); stream = null;
    void captureContext?.close(); captureContext = null;
    stopPlayback(); void playbackContext?.close(); playbackContext = null;
    if (workletUrl) URL.revokeObjectURL(workletUrl); workletUrl = null;
  };
  const play = (data: ArrayBuffer, envelope: VoiceEvent) => {
    if (!playbackContext || envelope.generationId !== currentGeneration || data.byteLength % 2) return;
    const samples = new Int16Array(data);
    const audio = playbackContext.createBuffer(1, samples.length, 24000);
    const channel = audio.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = playbackContext.createBufferSource();
    source.buffer = audio; source.connect(playbackContext.destination);
    playing.add(source);
    source.onended = () => playing.delete(source);
    const when = Math.max(playbackContext.currentTime + 0.025, nextPlaybackTime);
    source.start(when);
    nextPlaybackTime = when + audio.duration;
    if (typeof envelope.segmentIndex === 'number') lastSource.set(envelope.segmentIndex, source);
  };
  const beginCapture = async () => {
    if (!stream || !socket) return;
    captureContext = new AudioContext();
    playbackContext = new AudioContext();
    await playbackContext.resume();
    workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
    await captureContext.audioWorklet.addModule(workletUrl);
    worklet = new AudioWorkletNode(captureContext, 'zindagi-pcm-capture');
    worklet.port.onmessage = event => {
      if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 64 * 1024) socket.send(event.data);
      else if (socket?.readyState === WebSocket.OPEN) options.onError('Microphone network buffer is full.');
    };
    captureContext.createMediaStreamSource(stream).connect(worklet);
    worklet.connect(captureContext.destination);
    await captureContext.resume();
  };

  return {
    async start(ticket: string) {
      const base = process.env.EXPO_PUBLIC_VOICE_WS_URL;
      if (!base) throw new Error('Voice URL is missing. Set EXPO_PUBLIC_VOICE_WS_URL in mobile/.env and restart Expo.');
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('This browser does not support realtime microphone capture.');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        let settled = false;
        const timer = setTimeout(() => failStart('Voice service did not become ready. Check its terminal.'), 12_000);
        const failStart = (message: string) => {
          if (settled) return;
          settled = true; ended = true; clearTimeout(timer);
          cleanup(); socket?.close(); reject(new Error(message));
        };
        try { socket = new WebSocket(base); }
        catch { failStart(startupMessage()); return; }
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => send({ type: 'hello', ticket,
          format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, frameMs: 20 } });
        socket.onmessage = event => {
          if (event.data instanceof ArrayBuffer) {
            if (queuedEnvelope) play(event.data, queuedEnvelope);
            queuedEnvelope = null; return;
          }
          let value: VoiceEvent;
          try { value = JSON.parse(String(event.data)); } catch { return; }
          if (!ready && value.type === 'error') { failStart(startupMessage(value.code)); return; }
          if (!ready && value.type === 'session_end') { failStart(startupMessage('session_ended_early')); return; }
          if (value.type === 'audio_chunk') { queuedEnvelope = value; return; }
          if (value.type === 'ready') {
            void beginCapture().then(() => {
              if (settled) return;
              ready = true; settled = true; clearTimeout(timer);
              options.onEvent(value); resolve();
            }).catch(error => failStart(error instanceof Error ? error.message : String(error)));
            return;
          }
          if (value.type === 'audio_start' && value.generationId && value.generationId !== currentGeneration) {
            stopPlayback(); currentGeneration = value.generationId;
          }
          if (value.type === 'interrupted' || value.type === 'session_end') stopPlayback();
          if (value.type === 'audio_end' && typeof value.segmentIndex === 'number') {
            const source = lastSource.get(value.segmentIndex);
            const acknowledge = () => {
              if (currentGeneration === value.generationId && !ended) send({ type: 'playback_progress',
                generationId: value.generationId, segmentIndex: value.segmentIndex });
            };
            if (source && playing.has(source)) source.addEventListener('ended', acknowledge, { once: true });
            else if (source) acknowledge();
          }
          options.onEvent(value);
          if (value.type === 'session_end') { ended = true; cleanup(); socket?.close(); }
        };
        socket.onerror = () => {
          if (!ready) failStart(startupMessage());
          else options.onError('Voice connection failed.');
        };
        socket.onclose = event => {
          if (!ready) failStart(startupMessage(event.reason || undefined));
          else if (!ended) {
            ended = true;
            options.onError('Voice connection closed.');
            options.onEvent({ type: 'session_end', summaryStatus: 'error' });
          }
          cleanup();
        };
      });
    },
    end() { if (ended) return; send({ type: 'end' }); cleanup(); setTimeout(() => socket?.close(), 10_000); },
    mute(value: boolean) { send({ type: value ? 'mute' : 'unmute' }); },
  };
}
