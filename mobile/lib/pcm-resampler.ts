// Continuous linear resampling. Keeps phase between native recorder callbacks.
export class PcmResampler {
  private position = 0;
  private next = 0;
  private previous = 0;
  private frame = new ArrayBuffer(640);
  private view = new DataView(this.frame);
  private index = 0;
  private inputRate = 0;

  push(samples: Float32Array, sampleRate: number, send: (frame: ArrayBuffer) => void) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Unsupported microphone sample rate.');
    if (this.inputRate && this.inputRate !== sampleRate) {
      this.position = 0; this.next = 0; this.index = 0;
    }
    this.inputRate = sampleRate;
    const step = sampleRate / 16000;
    for (let i = 0; i < samples.length; i++) {
      const current = samples[i];
      while (this.next <= this.position) {
        const fraction = this.position ? Math.max(0, Math.min(1, this.next - (this.position - 1))) : 1;
        const value = this.previous + (current - this.previous) * fraction;
        this.view.setInt16(this.index * 2, Math.max(-32768, Math.min(32767, Math.round(value * 32767))), true);
        this.index++;
        this.next += step;
        if (this.index === 320) {
          send(this.frame);
          this.frame = new ArrayBuffer(640); this.view = new DataView(this.frame); this.index = 0;
        }
      }
      this.previous = current; this.position++;
    }
  }
}
