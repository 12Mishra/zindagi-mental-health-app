export type Synthesize = (text: string, segmentIndex: number, onChunk: (pcm: Buffer) => void, signal: AbortSignal) => Promise<void>;
export type SpeechSink = {
  start(segmentIndex: number): void;
  /** May throw (e.g. playback backpressure); the pipeline then fails. */
  chunk(segmentIndex: number, chunkIndex: number, pcm: Buffer): void;
  end(segmentIndex: number, text: string): void;
};

type Segment = { index: number; text: string; chunks: Buffer[]; sent: number; started: boolean; done: boolean };

/**
 * Consumer side of the hot path: synthesizes up to `prefetch` segments at once and forwards audio strictly in
 * segment order. Lisa's turn pushes one segment at a time and batches the clauses that arrive meanwhile (see `onIdle`).
 */
export class SpeechPipeline {
  private readonly segments: Segment[] = [];
  private readonly controller = new AbortController();
  private head = 0;
  private nextStart = 0;
  private inflight = 0;
  private ended = false;
  private error: Error | null = null;
  private settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private readonly finished: Promise<void>;
  private idleWaiters: Array<() => void> = [];

  /** `onIdle` fires whenever no synthesis is running or queued, so the caller can hand over the text it batched meanwhile. */
  constructor(private readonly synthesize: Synthesize, private readonly sink: SpeechSink,
    signal: AbortSignal, private readonly prefetch = 2, private readonly onIdle?: () => void) {
    this.finished = new Promise<void>((resolve, reject) => { this.settle = { resolve, reject }; });
    this.finished.catch(() => {});
    if (signal.aborted) this.cancel();
    else signal.addEventListener('abort', () => this.cancel(), { once: true });
  }

  get cancelled() { return this.controller.signal.aborted; }

  /** True while a segment is being synthesized or waits to be. */
  get busy() { return this.inflight > 0 || this.nextStart < this.segments.length; }

  /** Resolves once nothing is being synthesized (or the pipeline stopped). */
  idle(): Promise<void> {
    if (!this.busy || this.cancelled) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  push(text: string, segmentIndex: number) {
    if (this.cancelled || this.ended) return;
    this.segments.push({ index: segmentIndex, text, chunks: [], sent: 0, started: false, done: false });
    this.pump();
  }

  /** No more segments; resolves once every segment's audio was forwarded (or the pipeline was cancelled). */
  finish() {
    this.ended = true;
    this.check();
    return this.finished;
  }

  cancel() {
    if (this.cancelled) return;
    this.controller.abort();
    this.settle?.resolve();
    this.wakeIdle();
  }

  private pump() {
    while (!this.cancelled && this.inflight < this.prefetch && this.nextStart < this.segments.length) {
      const segment = this.segments[this.nextStart++];
      this.inflight++;
      this.synthesize(segment.text, segment.index, pcm => this.receive(segment, pcm), this.controller.signal)
        .then(() => {
          segment.done = true;
          if (!this.cancelled && !segment.sent && !segment.chunks.length) throw new Error('tts_empty_audio');
          this.forward();
        })
        .catch(error => this.fail(error))
        .finally(() => { this.inflight--; this.pump(); this.notifyIdle(); this.check(); });
    }
  }

  private receive(segment: Segment, pcm: Buffer) {
    if (this.cancelled) return;
    segment.chunks.push(pcm);
    this.forward();
  }

  private forward() {
    try {
      while (!this.cancelled && this.head < this.segments.length) {
        const segment = this.segments[this.head];
        for (const pcm of segment.chunks.splice(0)) {
          if (!segment.started) { segment.started = true; this.sink.start(segment.index); }
          this.sink.chunk(segment.index, segment.sent++, pcm);
          if (this.cancelled) return;
        }
        if (!segment.done) return;
        this.sink.end(segment.index, segment.text);
        this.head++;
      }
    } catch (error) { this.fail(error); }
  }

  private fail(error: unknown) {
    if (this.cancelled || this.error) return;
    this.error = error instanceof Error ? error : new Error('tts_failed');
    this.controller.abort();
    this.settle?.reject(this.error);
    this.wakeIdle();
  }

  private notifyIdle() {
    if (this.busy || this.cancelled) return;
    this.onIdle?.();
    if (!this.busy) this.wakeIdle();
  }

  private wakeIdle() { for (const resolve of this.idleWaiters.splice(0)) resolve(); }

  private check() {
    if (this.ended && !this.cancelled && this.head >= this.segments.length && this.inflight === 0) this.settle?.resolve();
  }
}
