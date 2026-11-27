import { AppState, TurboModuleRegistry } from 'react-native';

import { VOICE_WS_URL } from '@/lib/api-config';
import type { AudioContext, AudioRecorder } from 'react-native-audio-api';
import type { VoiceClient, VoiceClientOptions, VoiceEvent } from './voice-client-types';
import { PcmResampler } from './pcm-resampler';
import { LevelMeter, rmsFloat, toLevel } from './voice-levels';

// Audio scheduled this far ahead after a start or an underrun, so the next late chunk does not leave an audible gap.
const PLAYBACK_LEAD_S = 0.15;
// Mic stays closed this long after Lisa's last scheduled audio ends, so the room's echo tail is not sent either.
const ECHO_TAIL_S = 0.35;

type AudioApi = typeof import('react-native-audio-api');

export const VOICE_UNSUPPORTED_MESSAGE =
  'Hands-free voice needs the Zindagi development build. Expo Go does not include the audio engine it uses. You can still talk to Lisa in chat.';

/**
 * True when the react-native-audio-api native module is in this binary (dev/production builds, not Expo Go).
 * Checked before requiring the package: its module body throws when the native side is missing, and Metro reports
 * a throw from a runtime require() as a fatal red-screen error before any surrounding try/catch can see it.
 */
export function isVoiceSupported(): boolean {
  return TurboModuleRegistry.get('AudioAPIModule') != null;
}

// Loaded lazily, and only after isVoiceSupported(): a top-level import would crash every route in Expo Go.
function loadAudioApi(): AudioApi {
  if (!isVoiceSupported()) throw new Error(VOICE_UNSUPPORTED_MESSAGE);
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- must stay lazy, see above
  return require('react-native-audio-api') as AudioApi;
}

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  const { AudioContext, AudioManager, AudioRecorder } = loadAudioApi();
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
  const meter = new LevelMeter();
  const appState = AppState.addEventListener('change', state => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, type: 'diag', step: 'appState', state }));
    if (state !== 'active') stop();
  });

  const send = (value: Record<string, unknown>) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, ...value }));
  };
  const stopAudio = () => {
    currentGeneration = '';
    for (const source of sources) { try { source.stop(); } catch {} }
    sources.clear(); lastSource.clear(); envelope = null; meter.clearPlayback();
    nextPlaybackTime = context?.currentTime ?? 0;
  };
  const cleanup = () => {
    if (statsTimer) { clearInterval(statsTimer); statsTimer = null; }
    try { recorder?.clearOnAudioReady(); recorder?.clearOnError(); void recorder?.stop().catch(() => {}); } catch {}
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
    const inputFrames = bytes.byteLength / 2;
    // react-native-audio-api 0.13 reads a buffer at the *context* rate and ignores the buffer's own rate, so 24 kHz
    // speech in a 48 kHz context plays at double speed. Resample to the context rate here (linear is fine for speech).
    const outputRate = context.sampleRate;
    const ratio = outputRate / 24000;
    const outputFrames = Math.max(1, Math.round(inputFrames * ratio));
    const buffer = context.createBuffer(1, outputFrames, outputRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < outputFrames; i++) {
      const position = i / ratio;
      const index = Math.floor(position);
      const a = pcm.getInt16(Math.min(index, inputFrames - 1) * 2, true);
      const b = pcm.getInt16(Math.min(index + 1, inputFrames - 1) * 2, true);
      channel[i] = (a + (b - a) * (position - index)) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    sources.add(source);
    source.onEnded = () => sources.delete(source);
    // Back-to-back chunks play seamlessly; after a start or an underrun, rebuild a small cushion first.
    const when = nextPlaybackTime > context.currentTime ? nextPlaybackTime : context.currentTime + PLAYBACK_LEAD_S;
    source.start(when); meter.schedule(channel, outputRate, when); nextPlaybackTime = when + buffer.duration;
    if (typeof event.segmentIndex === 'number') lastSource.set(event.segmentIndex, source);
  };
  // Capture diagnostics, sent to the voice server's log as `diag` control messages (counts and statuses only, never
  // audio). Phones have no console we can read, so this is how a silent microphone gets explained.
  const stats = { callbacks: 0, skippedNotOpen: 0, skippedBuffered: 0, skippedEcho: 0, framesSent: 0, errors: 0, rate: 0, numFrames: 0, lastError: '' };
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let statsReports = 0;
  const diag = (step: string, extra: Record<string, unknown> = {}) => send({ type: 'diag', step, ...extra });
  const beginCapture = async () => {
    try {
      const permission = await AudioManager.requestRecordingPermissions();
      diag('permission', { permission });
      if (permission !== 'Granted') throw new Error('Microphone permission denied.');
      AudioManager.setAudioSessionOptions({ iosCategory: 'playAndRecord', iosMode: 'voiceChat', iosOptions: ['defaultToSpeaker'] });
      await AudioManager.setAudioSessionActivity(true);
      context = new AudioContext();
      await context.resume();
      diag('context', { sampleRate: context.sampleRate, state: context.state });
      recorder = new AudioRecorder();
      const ready = recorder.onAudioReady({ sampleRate: 16000, bufferLength: 1600, channelCount: 1 }, ({ buffer, numFrames }) => {
        stats.callbacks++;
        try {
          if (socket?.readyState !== WebSocket.OPEN) { stats.skippedNotOpen++; return; }
          if ((socket.bufferedAmount ?? 0) > 64 * 1024) { stats.skippedBuffered++; return; }
          // Half-duplex: Android's recorder here has no echo cancellation, so on speakerphone the mic hears Lisa and
          // the server takes her own voice as the student barging in. Hold the mic while her audio is playing, plus a
          // short tail for room echo, and resume as soon as she finishes.
          if (context && context.currentTime < nextPlaybackTime + ECHO_TAIL_S) { stats.skippedEcho++; return; }
          stats.rate = buffer.sampleRate; stats.numFrames = numFrames;
          const samples = buffer.getChannelData(0).subarray(0, numFrames);
          meter.pushMic(toLevel(rmsFloat(samples)));
          resampler.push(samples, buffer.sampleRate, frame => { stats.framesSent++; socket?.send(frame); });
        } catch (error) {
          stats.errors++; stats.lastError = String(error).slice(0, 120);
        }
      });
      diag('onAudioReady', { status: ready.status, message: ready.status === 'error' ? ready.message : undefined });
      if (ready.status === 'error') throw new Error(`Could not configure native audio callback: ${ready.message}`);
      recorder.onError(({ message }) => { diag('recorderError', { message }); options.onError(`Microphone error: ${message}`); });
      // start() is async in react-native-audio-api 0.13; without the await a failed start was silently ignored.
      const started = await recorder.start();
      diag('start', { status: started.status, message: started.status === 'error' ? started.message : undefined });
      if (started.status === 'error') throw new Error(`Could not start the microphone: ${started.message ?? 'unknown error'}`);
      statsTimer = setInterval(() => {
        if (++statsReports > 15) { if (statsTimer) clearInterval(statsTimer); return; }
        diag('stats', { ...stats });
      }, 2000);
    } catch (error) {
      diag('captureFailed', { error: String(error).slice(0, 200) });
      throw error;
    }
  };

  return {
    async start(ticket: string) {
      const url = VOICE_WS_URL;
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
    levels() { return meter.read(context ? context.currentTime : null); },
  };
}
