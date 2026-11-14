import type { RiskLevel, Topic } from '../generated/prisma/client';

export type MoodTrend = 'improving' | 'stable' | 'declining' | 'unknown';
export type BriefContent = {
  presenting: string;
  themes: string[];
  moodTrend: MoodTrend;
  moodSeries: number[];
  riskLevels: Array<'LOW' | 'ELEVATED' | 'URGENT' | 'UNKNOWN'>;
  whatHelped: string[];
  openThreads: string[];
  caution: string;
};

const LABEL: Record<Topic, string> = {
  ACADEMIC: 'Academic pressure', ANXIETY: 'Anxiety', RELATIONSHIPS: 'Relationships', FINANCIAL: 'Financial stress',
  FAMILY: 'Family', SLEEP: 'Sleep', CAREER: 'Career', HEALTH: 'Health', OTHER: 'Other',
};

/** Compares the average of the older half of scores with the newer half (scores are oldest first, 1..5). */
export function moodTrend(scores: number[]): MoodTrend {
  if (scores.length < 4) return 'unknown';
  const mid = Math.floor(scores.length / 2);
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const delta = avg(scores.slice(mid)) - avg(scores.slice(0, mid));
  return delta >= 0.4 ? 'improving' : delta <= -0.4 ? 'declining' : 'stable';
}

/** Deterministic brief from consented data only: no names, no raw message text. */
export function buildBrief(input: { reason: Topic | null; scoresOldestFirst: number[]; topics: Topic[]; risk: RiskLevel[] }): BriefContent {
  const counts = new Map<Topic, number>();
  for (const t of input.topics) counts.set(t, (counts.get(t) ?? 0) + 1);
  const themes = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => LABEL[t]);
  const levels = [...new Set(input.risk.map(r => (r === 'LOW' || r === 'ELEVATED' || r === 'URGENT' ? r : 'UNKNOWN')))] as BriefContent['riskLevels'];
  return {
    presenting: input.reason ? `Student chose “${LABEL[input.reason]}” as the reason for the session.` : 'No reason was given.',
    themes,
    moodTrend: moodTrend(input.scoresOldestFirst),
    moodSeries: input.scoresOldestFirst.slice(-14),
    riskLevels: levels.length ? levels : ['UNKNOWN'],
    whatHelped: [],
    openThreads: [],
    caution: 'Auto-generated from check-in scores and conversation topics. It is a starting point, not a clinical assessment.',
  };
}
