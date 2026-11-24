// Loudness meters for the voice UI. Nothing here touches the audio that is sent or played.

/** Maps RMS of normalised samples (-1..1) to a 0..1 level that feels linear to the eye. */
export const toLevel = (rms: number) => Math.min(1, Math.pow(rms * 5, 0.8));

export function rmsFloat(samples: ArrayLike<number>, from = 0, to = samples.length): number {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

export function rmsInt16(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) { const v = samples[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / Math.max(1, samples.length));
}

const WINDOW_S = 0.04;

/** Mic level with a short decay, and a timeline of Lisa's loudness keyed to playback time. */
export class LevelMeter {
  private mic = 0;
  private micAt = 0;
  private timeline: { t: number; level: number }[] = [];

  pushMic(level: number) {
    this.mic = this.mic * 0.4 + level * 0.6;
    this.micAt = Date.now();
  }

  /** Records the loudness of a chunk that starts playing at `when` (playback clock seconds). */
  schedule(channel: Float32Array, sampleRate: number, when: number) {
    const step = Math.max(1, Math.round(sampleRate * WINDOW_S));
    for (let i = 0, k = 0; i < channel.length; i += step, k++) {
      this.timeline.push({ t: when + k * WINDOW_S, level: toLevel(rmsFloat(channel, i, Math.min(channel.length, i + step))) });
    }
  }

  clearPlayback() { this.timeline = []; }

  read(playbackNow: number | null) {
    const mic = Date.now() - this.micAt < 250 ? this.mic : 0;
    let lisa = 0;
    if (playbackNow !== null) {
      while (this.timeline.length && this.timeline[0].t + WINDOW_S < playbackNow) this.timeline.shift();
      const head = this.timeline[0];
      if (head && head.t <= playbackNow) lisa = head.level;
    }
    return { mic, lisa };
  }
}
