import { config } from '../config';
import { prisma } from '../db';
import { Prisma } from '../generated/prisma/client';
import { addDays, todayIn, ymdToDate } from '../insights/dates';

const BACKFILL_DAYS = 84;
const RECENT_DAYS = 3;
const FULL_EVERY_MS = 24 * 3_600_000;

type Window = { from: string; to: string; tz: string };
type Tx = Prisma.TransactionClient;

// A student belongs to the campus cohort plus their year and department cohorts (never a year x department cross).
// Every query below exposes its student rows as alias `e` with columns inst, uid, yr, dept, day.
const COHORT_JOIN = Prisma.sql`CROSS JOIN LATERAL (VALUES ('all'), ('year:' || e.yr::text), ('dept:' || e.dept)) AS c(cohort)`;
const COHORT_OK = Prisma.sql`c.cohort IS NOT NULL`;

/** Local calendar day of a UTC `timestamp` column (Prisma stores UTC without a timezone). */
const localDay = (column: string, tz: string) =>
  Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${tz})::date`;

/** Distinct students per cohort over the trailing 7 days, for each day in [from, to]. */
function trailingDistinct(w: Window, metric: string, withConversations: boolean) {
  const lookback = addDays(w.from, -8);
  const conversations = withConversations
    ? Prisma.sql`SELECT "userId", ${localDay('"createdAt"', w.tz)} AS day FROM "Conversation" WHERE "createdAt" >= ${lookback}::date UNION `
    : Prisma.empty;
  return Prisma.sql`
    WITH raw AS (
      ${conversations}
      SELECT "userId", ${localDay('"createdAt"', w.tz)} AS day FROM "MoodCheckin" WHERE "createdAt" >= ${lookback}::date
    ), e AS (
      SELECT u."institutionId" AS inst, u.id AS uid, u."yearOfStudy" AS yr, u.department AS dept, raw.day
      FROM raw JOIN "User" u ON u.id = raw."userId" WHERE u."institutionId" IS NOT NULL
    ), days AS (
      SELECT generate_series(${w.from}::date, ${w.to}::date, interval '1 day')::date AS day
    )
    SELECT e.inst, d.day, c.cohort, ${metric}::text AS metric,
           count(DISTINCT e.uid)::float8 AS value, count(DISTINCT e.uid)::int AS n
    FROM days d JOIN e ON e.day BETWEEN d.day - 6 AND d.day
    ${COHORT_JOIN}
    WHERE ${COHORT_OK}
    GROUP BY e.inst, d.day, c.cohort`;
}

/** Daily sum of scores and number of check-ins; the mean is derived later as sum / count. */
function dailyMood(w: Window) {
  return Prisma.sql`
    WITH e AS (
      SELECT u."institutionId" AS inst, u.id AS uid, u."yearOfStudy" AS yr, u.department AS dept,
             ${localDay('m."createdAt"', w.tz)} AS day, m.score
      FROM "MoodCheckin" m JOIN "User" u ON u.id = m."userId"
      WHERE u."institutionId" IS NOT NULL AND m."createdAt" >= ${w.from}::date - 1
    ), agg AS (
      SELECT e.inst, e.day, c.cohort, sum(e.score)::float8 AS s, count(*)::float8 AS cnt, count(DISTINCT e.uid)::int AS n
      FROM e ${COHORT_JOIN}
      WHERE ${COHORT_OK} AND e.day BETWEEN ${w.from}::date AND ${w.to}::date
      GROUP BY e.inst, e.day, c.cohort
    )
    SELECT a.inst, a.day, a.cohort, m.metric, m.value, a.n
    FROM agg a CROSS JOIN LATERAL (VALUES ('mood_sum', a.s), ('checkins', a.cnt)) AS m(metric, value)`;
}

/** Conversations started and ended per day. */
function dailySessions(w: Window) {
  const select = (metric: string, column: string, filter: Prisma.Sql) => Prisma.sql`
    SELECT e.inst, e.day, c.cohort, ${metric}::text AS metric, count(*)::float8 AS value, count(DISTINCT e.uid)::int AS n
    FROM (
      SELECT u."institutionId" AS inst, u.id AS uid, u."yearOfStudy" AS yr, u.department AS dept, ${localDay(column, w.tz)} AS day
      FROM "Conversation" cv JOIN "User" u ON u.id = cv."userId"
      WHERE u."institutionId" IS NOT NULL AND ${filter}
    ) e ${COHORT_JOIN}
    WHERE ${COHORT_OK} AND e.day BETWEEN ${w.from}::date AND ${w.to}::date
    GROUP BY e.inst, e.day, c.cohort`;
  return Prisma.sql`
    ${select('sessions_started', 'cv."createdAt"', Prisma.sql`cv."createdAt" >= ${w.from}::date - 1`)}
    UNION ALL
    ${select('sessions_ended', 'cv."endedAt"', Prisma.sql`cv.status = 'ENDED' AND cv."endedAt" >= ${w.from}::date - 1`)}`;
}

/** Distinct students per topic per day, plus the distinct students with any topic (the denominator). */
function dailyTopics(w: Window) {
  return Prisma.sql`
    WITH e AS (
      SELECT u."institutionId" AS inst, u.id AS uid, u."yearOfStudy" AS yr, u.department AS dept,
             ${localDay('cv."createdAt"', w.tz)} AS day, cv.topics
      FROM "Conversation" cv JOIN "User" u ON u.id = cv."userId"
      WHERE u."institutionId" IS NOT NULL AND cardinality(cv.topics) > 0 AND cv."createdAt" >= ${w.from}::date - 1
    )
    SELECT e.inst, e.day, c.cohort, ('topic:' || t.topic::text) AS metric,
           count(DISTINCT e.uid)::float8 AS value, count(DISTINCT e.uid)::int AS n
    FROM e CROSS JOIN LATERAL unnest(e.topics) AS t(topic) ${COHORT_JOIN}
    WHERE ${COHORT_OK} AND e.day BETWEEN ${w.from}::date AND ${w.to}::date
    GROUP BY e.inst, e.day, c.cohort, t.topic
    UNION ALL
    SELECT e.inst, e.day, c.cohort, 'topic_students'::text AS metric,
           count(DISTINCT e.uid)::float8 AS value, count(DISTINCT e.uid)::int AS n
    FROM e ${COHORT_JOIN}
    WHERE ${COHORT_OK} AND e.day BETWEEN ${w.from}::date AND ${w.to}::date
    GROUP BY e.inst, e.day, c.cohort`;
}

const upsert = (tx: Tx, select: Prisma.Sql) => tx.$executeRaw`
  INSERT INTO "CohortDailyStat" ("institutionId", "day", "cohortKey", "metric", "value", "n", "updatedAt")
  SELECT s.inst, s.day, s.cohort, s.metric, s.value, s.n, now() FROM (${select}) AS s
  ON CONFLICT ("institutionId", "day", "cohortKey", "metric")
  DO UPDATE SET "value" = EXCLUDED."value", "n" = EXCLUDED."n", "updatedAt" = now()`;

/**
 * Recomputes every metric for the inclusive date range [from, to] (YYYY-MM-DD in the rollup timezone).
 * The range is deleted and rewritten in one transaction: idempotent, and rows for deleted data disappear.
 */
export async function rollupRange(from: string, to: string): Promise<void> {
  const w: Window = { from, to, tz: config.rollupTimezone };
  await prisma.$transaction(async tx => {
    await tx.cohortDailyStat.deleteMany({ where: { day: { gte: ymdToDate(from), lte: ymdToDate(to) } } });
    await upsert(tx, trailingDistinct(w, 'active_7d', true));
    await upsert(tx, trailingDistinct(w, 'checkin_students_7d', false));
    await upsert(tx, dailyMood(w));
    await upsert(tx, dailySessions(w));
    await upsert(tx, dailyTopics(w));
  }, { timeout: 120_000, maxWait: 10_000 });
}

let lastFull = 0;

/** One scheduled run: a full backfill on first start and once a day, otherwise only the last few days. */
export async function rollupTick(now = new Date()): Promise<void> {
  const today = todayIn(config.rollupTimezone, now);
  const empty = !(await prisma.cohortDailyStat.findFirst({ select: { metric: true } }));
  if (empty || now.getTime() - lastFull > FULL_EVERY_MS) {
    await rollupRange(addDays(today, -(BACKFILL_DAYS - 1)), today);
    lastFull = now.getTime();
  } else {
    await rollupRange(addDays(today, -(RECENT_DAYS - 1)), today);
  }
}
