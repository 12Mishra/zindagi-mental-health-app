import { Worker } from 'node:worker_threads';
import path from 'node:path';

export class AcousticAnalyzer {
  private worker = new Worker(path.join(__dirname, 'acoustic-worker.js'));
  private window = new Uint8Array(32_000);
  private position = 0;
  private busy = false;
  constructor(private readonly report: (value: Record<string, unknown>) => void) {
    this.worker.on('message', value => { this.busy = false; this.report(value); });
    this.worker.on('error', () => { this.busy = false; this.report({ emotion: 'not_available', reason: 'worker_error' }); });
  }
  add(frame: Buffer) {
    if (frame.length > this.window.length - this.position) this.position = 0;
    this.window.set(frame, this.position);
    this.position += frame.length;
    if (this.position === this.window.length) {
      if (!this.busy) {
        const data = this.window.buffer;
        this.busy = true;
        this.worker.postMessage(data, [data]);
        this.window = new Uint8Array(32_000);
      }
      this.position = 0;
    }
  }
  close() { void this.worker.terminate(); }
}
