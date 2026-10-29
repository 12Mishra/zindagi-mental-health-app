import type { Triage } from './policy';

export type GateState = 'held' | 'open' | 'blocked';
export type ReleaseGateOptions<T> = {
  /** Deterministic (regex) triage for the turn. Only LOW turns may be released by the timeout. */
  regexLevel: Triage['level'];
  timeoutMs: number;
  release: (item: T) => void;
  /** `late` is true when items were already released (by timeout) before the non-LOW verdict arrived. */
  block: (triage: Triage, late: boolean) => void;
  opened?: (reason: 'triage' | 'timeout') => void;
};

/**
 * Holds Lisa clauses until the parallel LLM triage resolves. LOW releases held and future clauses in order;
 * any other verdict discards them. On a regex-LOW turn the gate fails open after `timeoutMs` (latency budget),
 * and a later non-LOW verdict is reported as a late block so the caller can cut playback.
 */
export class ReleaseGate<T> {
  private held: T[] = [];
  private current: GateState = 'held';
  private timer: NodeJS.Timeout | null = null;
  private verdict: Triage | null = null;

  constructor(private readonly options: ReleaseGateOptions<T>) {
    if (options.regexLevel === 'LOW') this.timer = setTimeout(() => this.open('timeout'), options.timeoutMs);
  }

  get state() { return this.current; }
  get settled() { return this.verdict !== null; }

  push(item: T) {
    if (this.current === 'open') this.options.release(item);
    else if (this.current === 'held') this.held.push(item);
  }

  settle(triage: Triage) {
    if (this.verdict) return;
    this.verdict = triage;
    this.clearTimer();
    if (this.current === 'blocked') return;
    if (triage.level === 'LOW') { this.open('triage'); return; }
    const late = this.current === 'open';
    this.current = 'blocked';
    this.held = [];
    this.options.block(triage, late);
  }

  /** Stops the gate without a verdict (barge-in / turn end). Nothing further is released. */
  close() {
    this.clearTimer();
    if (this.current === 'held') this.held = [];
    this.current = 'blocked';
  }

  private open(reason: 'triage' | 'timeout') {
    if (this.current !== 'held') return;
    this.clearTimer();
    this.current = 'open';
    this.options.opened?.(reason);
    const held = this.held;
    this.held = [];
    for (const item of held) this.options.release(item);
  }

  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
