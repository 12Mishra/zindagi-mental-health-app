import { performance } from 'node:perf_hooks';

export const STAGES = ['speechFinal', 'triageRegexDone', 'triageLlmDone', 'llmRequestSent', 'llmFirstToken',
  'firstClauseReady', 'gateReleased', 'ttsRequestSent', 'ttsFirstByte', 'firstAudioSent', 'lastAudioSent'] as const;
export type Stage = typeof STAGES[number];

/** Per-turn monotonic stage marks. Holds timings and ids only, never transcript text or audio. */
export class TurnTrace {
  private readonly marks = new Map<Stage, number>();
  private readonly reviews: Array<{ segmentIndex: number; at: number }> = [];
  constructor(public turnId: string, private readonly now: () => number = () => performance.now()) {
    this.marks.set('speechFinal', now());
  }

  /** The turn id is assigned after the speech-final mark is taken. */
  withTurnId(turnId: string) { this.turnId = turnId; return this; }

  /** First mark wins, so `lastAudioSent` uses `markLast`. */
  mark(stage: Stage) { if (!this.marks.has(stage)) this.marks.set(stage, this.now()); }
  markLast(stage: Stage) { this.marks.set(stage, this.now()); }
  reviewDone(segmentIndex: number) { this.reviews.push({ segmentIndex, at: this.now() }); }
  has(stage: Stage) { return this.marks.has(stage); }

  /** Milliseconds from `speechFinal`; null when the stage did not happen this turn. */
  stages() {
    const start = this.marks.get('speechFinal')!;
    const offset = (at: number) => Math.round(at - start);
    const result: Record<string, unknown> = {};
    for (const stage of STAGES) { const at = this.marks.get(stage); result[stage] = at === undefined ? null : offset(at); }
    result.reviewDone = this.reviews.map(review => ({ segmentIndex: review.segmentIndex, ms: offset(review.at) }));
    return result as Record<Stage, number | null> & { reviewDone: Array<{ segmentIndex: number; ms: number }> };
  }

  logLine() {
    const stages = this.stages();
    return `[turn] ${this.turnId} ` + STAGES.slice(1).map(stage => `${stage}=${stages[stage] ?? '-'}`).join(' ') +
      ` reviews=${stages.reviewDone.length}`;
  }
}
