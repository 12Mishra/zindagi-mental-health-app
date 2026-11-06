// Mock data layer. Phase 2 replaces the bodies of these functions with calls to core.
import type { Alert, AlertsData, Overview } from './types';

const AS_OF = '2026-04-23T09:30:00.000Z';
const ago = (minutes: number) => new Date(Date.parse(AS_OF) - minutes * 60_000).toISOString();

const ALERTS: Alert[] = [
  { id: 'al_1', kind: 'RISK', severity: 'HIGH', message: 'Student #KR047 flagged Unsafe mood 3 times this week', lastSeenAt: ago(14), status: 'NEW' },
  { id: 'al_2', kind: 'DISENGAGEMENT', severity: 'MEDIUM', message: 'Student #KR112 missed 4 consecutive check-ins', lastSeenAt: ago(60), status: 'NEW' },
  { id: 'al_3', kind: 'COHORT_DIP', severity: 'LOW', message: 'Mood score dip detected in Batch 2024-CS cohort', lastSeenAt: ago(180), status: 'ACK' },
  { id: 'al_4', kind: 'RISK', severity: 'HIGH', message: 'Student #KR019 expressed hopelessness in two conversations', lastSeenAt: ago(60 * 26), status: 'RESOLVED' },
  { id: 'al_5', kind: 'DISENGAGEMENT', severity: 'MEDIUM', message: 'Student #KR088 stopped using the app after a distress check-in', lastSeenAt: ago(60 * 50), status: 'RESOLVED' },
  { id: 'al_6', kind: 'COHORT_DIP', severity: 'MEDIUM', message: 'Mood score dip detected in 3rd year cohort during exam week', lastSeenAt: ago(60 * 24 * 6), status: 'RESOLVED' },
];

export async function getOverview(opts: { suppressed?: boolean; empty?: boolean } = {}): Promise<Overview> {
  const base: Overview = {
    asOf: AS_OF,
    institution: { name: 'Demo Institute', activeStudents: 127 },
    kpis: [
      { id: 'students', value: 127, delta: '+4 today', spark: [112, 118, 122, 119, 124, 121, 127] },
      { id: 'mood', value: 7.4, delta: '+0.3 vs last week', spark: [71, 73, 72, 75, 74, 76, 74] },
      { id: 'alerts', value: 3, delta: '2 pending review', spark: [1, 0, 2, 1, 3, 2, 3] },
      { id: 'sessions', value: 24, delta: '18 completed', spark: [18, 22, 20, 25, 21, 26, 24] },
    ],
    heatmap: [
      [1, 2, 2, 3, 2, 0, 1],
      [2, 2, 3, 2, 2, 1, 0],
      [2, 3, 3, 3, 2, 1, 1],
      [2, 2, 2, 3, 3, 1, 1],
      [3, 4, 4, 5, 3, 2, 1],
      [3, 3, 3, 4, 2, 1, 1],
      [2, 2, 3, 3, 2, 1, 0],
      [1, 2, 2, 2, 2, 1, 0],
      [2, 3, 4, 5, 4, 2, 1],
      [3, 3, 3, 3, 2, 1, 1],
      [2, 2, 2, 2, 1, 1, 0],
      [1, 2, 2, 2, 1, 0, 0],
    ],
    problems: [
      { topic: 'Academic', pct: 78 },
      { topic: 'Anxiety', pct: 62 },
      { topic: 'Relationships', pct: 45 },
      { topic: 'Financial', pct: 38 },
      { topic: 'Family', pct: 32 },
    ],
    years: [
      { year: 1, pct: 40 },
      { year: 2, pct: 28 },
      { year: 3, pct: 20 },
      { year: 4, pct: 12 },
    ],
    alerts: ALERTS.slice(0, 3),
  };

  if (opts.suppressed) {
    return {
      ...base,
      institution: { ...base.institution, activeStudents: 0 },
      kpis: base.kpis.map((k) => ({ ...k, value: null, spark: k.spark.map(() => null) })),
      heatmap: base.heatmap.map((w) => w.map(() => 0)),
      problems: null,
      years: null,
    };
  }
  if (opts.empty) {
    return { ...base, heatmap: [], problems: [], years: [], alerts: [] };
  }
  return base;
}

export async function getAlerts(): Promise<AlertsData> {
  return {
    asOf: AS_OF,
    alerts: ALERTS,
    therapists: [
      { id: 'th_a', label: 'Counsellor A' },
      { id: 'th_b', label: 'Counsellor B' },
    ],
  };
}
