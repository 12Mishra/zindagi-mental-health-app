import type { VoiceClient, VoiceClientOptions, VoiceEvent } from './voice-client-types';

// A scripted, offline stand-in for the voice service. Used only when the voice screen is opened with
// ?demo=1, for presentations and UI review: no microphone, no network, nothing is saved.

type Step = { at: number; event: VoiceEvent };

const SCRIPT: [who: 'user' | 'lisa', text: string, risk?: string][] = [
  ['user', "I don't even know where to start. Three submissions this week and I haven't slept properly."],
  ['lisa', "That's a lot landing at once. Let's slow down for a second. Which one is due first?"],
  ['user', 'The DBMS one, on Thursday. And my parents keep calling about placements, it is too much.'],
  ['lisa', 'Okay. DBMS first, placements can wait for the weekend. Could you give it 45 minutes tonight?'],
  ['user', 'Yeah, I think I can do that. That actually feels doable.'],
  ['lisa', "That's a solid plan. It's also okay to tell your parents you'll call them on Sunday."],
  ['user', 'Thanks. Honestly, I feel a bit lighter now.'],
  ['lisa', "I'm really glad. I'm here whenever you want to check in."],
];

function buildTimeline(): Step[] {
  const steps: Step[] = [];
  let t = 600;
  steps.push({ at: t, event: { type: 'ready' } });
  t += 1200;
  SCRIPT.forEach(([who, text]) => {
    if (who === 'user') {
      steps.push({ at: t, event: { type: 'speech_start' } });
      const words = text.split(' ');
      const step = 230;
      for (let i = 3; i < words.length; i += 3) {
        t += step * 3;
        steps.push({ at: t, event: { type: 'transcript_partial', text: words.slice(0, i).join(' ') } });
      }
      t += 500;
      steps.push({ at: t, event: { type: 'speech_end' } });
      steps.push({ at: t + 50, event: { type: 'transcript_final', text } });
      steps.push({ at: t + 50, event: { type: 'risk', level: 'LOW' } });
      t += 1800;
      steps.push({ at: t, event: { type: 'processing', stage: 'lisa_generation' } });
      t += 1600;
    } else {
      steps.push({ at: t, event: { type: 'response_text', text } });
      steps.push({ at: t + 100, event: { type: 'audio_start', generationId: 'demo' } });
      t += 600 + text.length * 55;
      steps.push({ at: t, event: { type: 'audio_end', generationId: 'demo' } });
      t += 1400;
    }
  });
  steps.push({ at: t + 1500, event: { type: 'session_end', summaryStatus: 'none' } });
  return steps;
}

export function createDemoVoiceClient(options: VoiceClientOptions): VoiceClient {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let mode: 'idle' | 'user' | 'lisa' = 'idle';
  let muted = false;
  let ended = false;
  const t0 = Date.now();

  const emit = (event: VoiceEvent) => {
    if (ended) return;
    if (event.type === 'speech_start') mode = 'user';
    if (event.type === 'speech_end') mode = 'idle';
    if (event.type === 'audio_start') mode = 'lisa';
    if (event.type === 'audio_end') mode = 'idle';
    if (event.type === 'session_end') { mode = 'idle'; ended = true; options.onEvent(event); return; }
    options.onEvent(event);
  };

  return {
    async start() {
      for (const step of buildTimeline()) timers.push(setTimeout(() => emit(step.event), step.at));
    },
    end() {
      timers.forEach(clearTimeout);
      if (!ended) { timers.push(setTimeout(() => emit({ type: 'session_end', summaryStatus: 'none' }), 400)); }
    },
    mute(value: boolean) { muted = value; },
    levels() {
      const t = (Date.now() - t0) / 1000;
      const speech = (a: number, b: number) => Math.max(0, Math.min(1, 0.5 + 0.32 * Math.sin(t * a) * Math.sin(t * b) + 0.18 * Math.sin(t * 23.7)));
      return { mic: mode === 'user' && !muted ? speech(9.1, 2.3) : 0, lisa: mode === 'lisa' ? speech(6.2, 1.7) : 0 };
    },
  };
}
