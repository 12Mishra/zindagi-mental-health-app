import { config } from '../config';
import { prisma } from '../db';
import { toPublicAlert, type PublicAlert } from './alerts';
import { addDays, dateToYmd, mondayOf, todayIn, ymdToDate } from './dates';
import { heatBucket, signed, suppress } from './privacy';
import { TOPICS } from './topics';

export class CohortTooSmallError extends Error {}

type Cell = { value: number; n: number };
const WEEKS = 12;
const key = (metric: string, day: string) => `${metric}|${day}`;
/** The `count` days ending at (and including) `end`, oldest first. */
const lastDays = (end: string, count: number) => Array.from({ length: count }, (_, i) => addDays(end, i - count + 1));

export type Overview = {
  asOf: string;
  institution: { name: string; activeStudents: number | null };
  kpis: Array<{ id: 'students' | 'mood' | 'alerts' | 'sessions'; value: number | null; delta: string; spark: Array<number | null> }>;
  heatmap: number[][];
  problems: Array<{ topic: string; pct: number }> | null;
  years: Array<{ year: number; pct: number }> | null;
  alerts: PublicAlert[];
};

/**
 * The whole dashboard payload. Reads only CohortDailyStat and Alert (never conversations, messages or notes),
 * and hides every number that fewer than the institution's k students stand behind.
 */
export async function buildOverview(institutionId: string, cohort = 'all', now = new Date()): Promise<Overview> {
  const institution = await prisma.institution.findUniqueOrThrow({ where: { id: institutionId }, select: { name: true, kAnonymity: true } });
  const k = institution.kAnonymity;
  const today = todayIn(config.rollupTimezone, now);
  const firstMonday = addDays(mondayOf(today), -7 * (WEEKS - 1));

  const [rows, yearRows, openNew, openAck, recent] = await Promise.all([
    prisma.cohortDailyStat.findMany({
      where: { institutionId, cohortKey: cohort, day: { gte: ymdToDate(firstMonday) } },
      select: { metric: true, day: true, value: true, n: true },
    }),
    prisma.cohortDailyStat.findMany({
      where: { institutionId, cohortKey: { startsWith: 'year:' }, metric: 'active_7d', day: ymdToDate(today) },
      select: { cohortKey: true, value: true, n: true },
    }),
    prisma.alert.count({ where: { institutionId, status: 'NEW' } }),
    prisma.alert.count({ where: { institutionId, status: 'ACK' } }),
    prisma.alert.findMany({ where: { institutionId }, orderBy: { lastSeenAt: 'desc' }, take: 5 }),
  ]);

  const index = new Map<string, Cell>(rows.map(r => [key(r.metric, dateToYmd(r.day)), { value: r.value, n: r.n }]));
  const cell = (metric: string, day: string) => index.get(key(metric, day));
  const visible = (metric: string, day: string) => { const c = cell(metric, day); return suppress(c?.value ?? null, c?.n, k); };
  const sum = (metric: string, days: string[]) => days.reduce((total, d) => total + (cell(metric, d)?.value ?? 0), 0);

  const active = cell('active_7d', today);
  if (cohort !== 'all' && (active?.n ?? 0) < k) throw new CohortTooSmallError('cohort_too_small');
  const days7 = lastDays(today, 7);
  const prev7 = lastDays(addDays(today, -7), 7);

  // Active students: distinct students in the trailing 7 days.
  const students = visible('active_7d', today);
  const studentsBefore = visible('active_7d', addDays(today, -7));

  // Mean mood on a 0-10 scale (stored 1-5); the audience for suppression is the week's distinct check-in students.
  const mean = (days: string[]) => { const c = sum('checkins', days); return c > 0 ? sum('mood_sum', days) / c : null; };
  const moodNow = mean(days7), moodBefore = mean(prev7);
  const moodAudience = cell('checkin_students_7d', today)?.n;
  const mood = suppress(moodNow === null ? null : moodNow * 2, moodAudience, k);
  const round1 = (value: number | null) => value === null ? null : Math.round(value * 10) / 10;
  const moodSpark = days7.map(d => {
    const c = cell('checkins', d);
    return round1(suppress(c && c.value > 0 ? (cell('mood_sum', d)?.value ?? 0) / c.value * 2 : null, c?.n, k));
  });

  // Heatmap: [week][day], Monday first, oldest week first. 0 = no data, suppressed or in the future.
  const heatmap = Array.from({ length: WEEKS }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const day = addDays(firstMonday, w * 7 + d);
    if (day > today) return 0;
    const c = cell('checkins', day);
    const total = suppress(cell('mood_sum', day)?.value ?? null, c?.n, k);
    return total === null || !c || c.value === 0 ? 0 : heatBucket(total / c.value);
  }));

  // Problem frequency over 28 days: share of student-days that raised each topic. Needs a real audience first.
  const days28 = lastDays(today, 28);
  const topicTotal = sum('topic_students', days28);
  const problems = (active?.n ?? 0) < k || topicTotal < k ? null : TOPICS
    .map(topic => ({ topic, count: sum(`topic:${topic}`, days28) }))
    .filter(t => t.count >= k)
    .sort((a, b) => b.count - a.count).slice(0, 5)
    .map(t => ({ topic: t.topic as string, pct: Math.round(100 * t.count / topicTotal) }));

  // Year split: hidden entirely if any year is below k, otherwise the missing years could be inferred by subtraction.
  const yearTotal = yearRows.reduce((t, r) => t + r.value, 0);
  const years = yearRows.length && yearTotal > 0 && yearRows.every(r => r.n >= k)
    ? yearRows.map(r => ({ year: Number(r.cohortKey.slice(5)), pct: Math.round(100 * r.value / yearTotal) })).sort((a, b) => a.year - b.year)
    : null;

  const started = cell('sessions_started', today);
  const ended = cell('sessions_ended', today);

  return {
    asOf: now.toISOString(),
    institution: { name: institution.name, activeStudents: students },
    kpis: [
      { id: 'students', value: students, spark: days7.map(d => visible('active_7d', d)),
        delta: students !== null && studentsBefore !== null ? `${signed(students - studentsBefore)} vs last week` : 'Not enough data' },
      { id: 'mood', value: round1(mood), spark: moodSpark,
        delta: mood !== null && moodBefore !== null ? `${signed((moodNow! - moodBefore) * 2, 1)} vs last week` : 'Not enough data' },
      { id: 'alerts', value: openNew + openAck, spark: [], delta: `${openNew} pending review` },
      { id: 'sessions', value: suppress(started?.value ?? null, started?.n, k), spark: days7.map(d => visible('sessions_started', d)),
        delta: `${suppress(ended?.value ?? null, ended?.n, k) ?? 0} completed` },
    ],
    heatmap, problems, years,
    alerts: recent.map(toPublicAlert),
  };
}
