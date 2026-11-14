import { config } from '../config';
import { prisma } from '../db';
import { raiseAlert } from '../insights/alerts';
import { addDays, dateToYmd, mondayOf, todayIn, ymdToDate } from '../insights/dates';

const DAY_MS = 86_400_000;
const MIN_PRIOR_CHECKINS = 30; // a cohort needs a real baseline before a "dip" means anything
const DIP_THRESHOLD = 0.6; // points on the 1-5 mood scale

type Subject = { userId: string; institutionId: string; pseudonym: string; urgent: number; elevated: number; lowScores: number };

/** One alert per student per week: urgent/elevated risk signals and repeated very-low check-ins. */
async function riskAlerts(now: Date, weekKey: string): Promise<number> {
  const since = new Date(now.getTime() - 7 * DAY_MS);
  const linked = { institutionId: { not: null }, pseudonym: { not: null } } as const;
  const [risks, lowScores] = await Promise.all([
    prisma.riskHistory.findMany({
      where: { createdAt: { gte: since }, level: { in: ['ELEVATED', 'URGENT'] }, user: linked },
      select: { userId: true, level: true, user: { select: { institutionId: true, pseudonym: true } } },
    }),
    prisma.moodCheckin.groupBy({
      by: ['userId'], where: { score: 1, createdAt: { gte: since }, user: linked },
      _count: { _all: true }, having: { userId: { _count: { gte: 3 } } },
    }),
  ]);

  const subjects = new Map<string, Subject>();
  const subject = (userId: string, institutionId: string, pseudonym: string) => {
    let s = subjects.get(userId);
    if (!s) { s = { userId, institutionId, pseudonym, urgent: 0, elevated: 0, lowScores: 0 }; subjects.set(userId, s); }
    return s;
  };
  for (const r of risks) {
    const { institutionId, pseudonym } = r.user;
    if (!institutionId || !pseudonym) continue;
    const s = subject(r.userId, institutionId, pseudonym);
    if (r.level === 'URGENT') s.urgent++; else s.elevated++;
  }
  const missing = lowScores.map(l => l.userId).filter(id => !subjects.has(id));
  const users = missing.length ? await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, institutionId: true, pseudonym: true } }) : [];
  const known = new Map(users.map(u => [u.id, u]));
  for (const l of lowScores) {
    const existing = subjects.get(l.userId);
    if (existing) { existing.lowScores = l._count._all; continue; }
    const u = known.get(l.userId);
    if (u?.institutionId && u.pseudonym) subject(l.userId, u.institutionId, u.pseudonym).lowScores = l._count._all;
  }

  let raised = 0;
  for (const s of subjects.values()) {
    const parts = [
      s.urgent ? `${s.urgent} urgent signal${s.urgent > 1 ? 's' : ''}` : '',
      s.elevated ? `${s.elevated} elevated signal${s.elevated > 1 ? 's' : ''}` : '',
      s.lowScores ? `${s.lowScores} very low check-ins` : '',
    ].filter(Boolean);
    const outcome = await raiseAlert({
      institutionId: s.institutionId, kind: 'RISK', severity: s.urgent ? 'HIGH' : 'MEDIUM',
      dedupeKey: `risk:${s.pseudonym}:${weekKey}`, message: `Student ${s.pseudonym}: ${parts.join(', ')} this week`,
      occurrences: s.urgent + s.elevated + s.lowScores, subjectUserId: s.userId, subjectPseudonym: s.pseudonym,
    });
    if (outcome !== 'unchanged') raised++;
  }
  return raised;
}

/** Students who opted into check-ins, had at least 3, and have gone quiet for 4+ days (and not longer than 30). */
async function disengagementAlerts(now: Date): Promise<number> {
  const quietSince = new Date(now.getTime() - 4 * DAY_MS);
  const giveUp = new Date(now.getTime() - 30 * DAY_MS);
  const rows = await prisma.$queryRaw<Array<{ userId: string; institutionId: string; pseudonym: string; lastCheckin: Date }>>`
    SELECT u.id AS "userId", u."institutionId" AS "institutionId", u.pseudonym AS pseudonym, max(m."createdAt") AS "lastCheckin"
    FROM "User" u JOIN "MoodCheckin" m ON m."userId" = u.id
    WHERE u."checkinOptIn" AND u."institutionId" IS NOT NULL AND u.pseudonym IS NOT NULL
    GROUP BY u.id
    HAVING count(*) >= 3 AND max(m."createdAt") < ${quietSince} AND max(m."createdAt") > ${giveUp}`;
  let raised = 0;
  for (const r of rows) {
    const days = Math.floor((now.getTime() - r.lastCheckin.getTime()) / DAY_MS);
    const outcome = await raiseAlert({
      institutionId: r.institutionId, kind: 'DISENGAGEMENT', severity: 'MEDIUM',
      dedupeKey: `gap:${r.pseudonym}:${dateToYmd(r.lastCheckin)}`, message: `Student ${r.pseudonym} has not checked in for ${days} days`,
      occurrences: 1, subjectUserId: r.userId, subjectPseudonym: r.pseudonym,
    });
    if (outcome !== 'unchanged') raised++;
  }
  return raised;
}

const cohortLabel = (key: string) => key === 'all' ? 'the whole campus' : key.startsWith('year:') ? `year ${key.slice(5)}` : `department ${key.slice(5)}`;

/** A cohort whose last-7-day mean mood fell well below its previous 28 days, only when enough students stand behind it. */
async function cohortDipAlerts(now: Date, weekKey: string): Promise<number> {
  const today = todayIn(config.rollupTimezone, now);
  const recentFrom = addDays(today, -6);
  const [rows, institutions] = await Promise.all([
    prisma.cohortDailyStat.findMany({
      where: { day: { gte: ymdToDate(addDays(today, -34)) }, metric: { in: ['mood_sum', 'checkins', 'checkin_students_7d'] } },
      select: { institutionId: true, cohortKey: true, metric: true, day: true, value: true },
    }),
    prisma.institution.findMany({ select: { id: true, kAnonymity: true } }),
  ]);
  const k = new Map(institutions.map(i => [i.id, i.kAnonymity]));
  type Acc = { recentSum: number; recentCnt: number; priorSum: number; priorCnt: number; students: number };
  const groups = new Map<string, Acc & { institutionId: string; cohortKey: string }>();
  for (const r of rows) {
    const id = `${r.institutionId}|${r.cohortKey}`;
    const g = groups.get(id) ?? { institutionId: r.institutionId, cohortKey: r.cohortKey, recentSum: 0, recentCnt: 0, priorSum: 0, priorCnt: 0, students: 0 };
    groups.set(id, g);
    const day = dateToYmd(r.day);
    if (r.metric === 'checkin_students_7d') { if (day === today) g.students = r.value; continue; }
    const recent = day >= recentFrom;
    if (r.metric === 'mood_sum') { if (recent) g.recentSum += r.value; else g.priorSum += r.value; }
    else if (recent) g.recentCnt += r.value; else g.priorCnt += r.value;
  }
  let raised = 0;
  for (const g of groups.values()) {
    if (g.students < (k.get(g.institutionId) ?? 10) || g.recentCnt === 0 || g.priorCnt < MIN_PRIOR_CHECKINS) continue;
    const drop = g.priorSum / g.priorCnt - g.recentSum / g.recentCnt;
    if (drop < DIP_THRESHOLD) continue;
    const outcome = await raiseAlert({
      institutionId: g.institutionId, kind: 'COHORT_DIP', severity: 'LOW', cohortKey: g.cohortKey,
      dedupeKey: `dip:${g.institutionId}:${g.cohortKey}:${weekKey}`,
      message: `Mood in ${cohortLabel(g.cohortKey)} is ${drop.toFixed(1)} points (of 5) below its 4-week average`, occurrences: 1,
    });
    if (outcome !== 'unchanged') raised++;
  }
  return raised;
}

/** One pass of every alert rule. Safe to run as often as you like; unchanged alerts are not touched. */
export async function runAlertEngine(now = new Date()): Promise<{ risk: number; disengagement: number; dips: number }> {
  const weekKey = mondayOf(todayIn(config.rollupTimezone, now));
  return {
    risk: await riskAlerts(now, weekKey),
    disengagement: await disengagementAlerts(now),
    dips: await cohortDipAlerts(now, weekKey),
  };
}
