import { AppState } from 'react-native';
import { AudioContext, AudioManager, AudioRecorder } from 'react-native-audio-api';
import type { VoiceClient, VoiceClientOptions, VoiceEvent } from './voice-client-types';
import { PcmResampler } from './pcm-resampler';

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  let socket: WebSocket | null = null;
  let recorder: AudioRecorder | null = null;
  let context: AudioContext | null = null;
  let nextPlaybackTime = 0;
  let currentGeneration = '';
  let envelope: VoiceEvent | null = null;
  let ended = false;
  let receivedEnd = false;
  const sources = new Set<ReturnType<AudioContext['createBufferSource']>>();
  const lastSource = new Map<number, ReturnType<AudioContext['createBufferSource']>>();
  const resampler = new PcmResampler();
  const appState = AppState.addEventListener('change', state => {
    if (state !== 'active') stop();
  });

  const send = (value: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, ...value }));
  };
  const stopAudio = () => {
    currentGeneration = '';
    for (const source of sources) { try { source.stop(); } catch {} }
    sources.clear(); lastSource.clear(); envelope = null;
    nextPlaybackTime = context?.currentTime ?? 0;
  };
  const cleanup = () => {
    try { recorder?.clearOnAudioReady(); recorder?.stop(); } catch {}
    recorder = null;
    stopAudio();
    void context?.close(); context = null;
    void AudioManager.setAudioSessionActivity(false);
    appState.remove();
  };
  const stop = () => {
    if (ended) return;
    ended = true; send({ type: 'end' }); cleanup();
    setTimeout(() => socket?.close(), 10_000);
  };
  const play = (bytes: ArrayBuffer, event: VoiceEvent) => {
    if (!context || event.generationId !== currentGeneration || bytes.byteLength % 2) return;
    const pcm = new DataView(bytes);
    const buffer = context.createBuffer(1, bytes.byteLength / 2, 24000);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < channel.length; i++) channel[i] = pcm.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    sources.add(source);
    source.onEnded = () => sources.delete(source);
    const when = Math.max(context.currentTime + 0.03, nextPlaybackTime);
    source.start(when); nextPlaybackTime = when + buffer.duration;
    if (typeof event.segmentIndex === 'number') lastSource.set(event.segmentIndex, source);
  };
  const beginCapture = async () => {
    if (await AudioManager.requestRecordingPermissions() !== 'Granted') throw new Error('Microphone permission denied.');
    AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker'] });
    await AudioManager.setAudioSessionActivity(true);
    context = new AudioContext();
    await context.resume();
    recorder = new AudioRecorder();
    const ready = recorder.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer, numFrames }) => {
      if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 64 * 1024) return;
      const samples = buffer.getChannelData(0).subarray(0, numFrames);
      resampler.push(samples, buffer.sampleRate, frame => socket?.send(frame));
    });
    if (ready.status === 'error') throw new Error('Could not configure native audio callback.');
    const started = recorder.start();
    if (started.status === 'error') throw new Error('Could not start native microphone.');
  };

  return {
    async start(ticket: string) {
      const url = process.env.EXPO_PUBLIC_VOICE_WS_URL;
      if (!url) throw new Error('EXPO_PUBLIC_VOICE_WS_URL is not configured.');
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      socket.onopen = () => send({ type: 'hello', ticket,
        format: { encoding: 'pcm_s16le', sampleRate: 16000, channels: 1, frameMs: 20 } });
      socket.onmessage = message => {
        if (message.data instanceof ArrayBuffer) {
          if (envelope) play(message.data, envelope);
          envelope = null; return;
        }
        let event: VoiceEvent;
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (event.type === 'audio_chunk') { envelope = event; return; }
        if (event.type === 'ready') void beginCapture().catch(error => options.onError(String(error)));
        if (event.type === 'audio_start' && event.generationId && event.generationId !== currentGeneration) {
          stopAudio(); currentGeneration = event.generationId;
        }
        if (event.type === 'interrupted' || event.type === 'session_end') stopAudio();
        if (event.type === 'audio_end' && typeof event.segmentIndex === 'number') {
          const source = lastSource.get(event.segmentIndex);
          const acknowledge = () => {
            if (source) sources.delete(source);
            if (currentGeneration === event.generationId && !ended) send({ type: 'playback_progress',
              generationId: event.generationId, segmentIndex: event.segmentIndex });
          };
          if (source && sources.has(source)) source.onEnded = acknowledge;
          else if (source) acknowledge();
        }
        options.onEvent(event);
        if (event.type === 'session_end') { receivedEnd = true; ended = true; cleanup(); socket?.close(); }
      };
      socket.onerror = () => options.onError('Voice connection failed.');
      socket.onclose = () => {
        if (!receivedEnd) {
          ended = true;
          options.onError('Voice connection closed.');
          options.onEvent({ type: 'session_end', summaryStatus: 'error' });
        }
        cleanup();
      };
    },
    end: stop,
    mute(value: boolean) { send({ type: value ? 'mute' : 'unmute' }); },
  };
}
