import { prisma } from '../db';
import { Prisma, type Alert, type AlertKind, type AlertSeverity } from '../generated/prisma/client';

/** The only shape of an alert that leaves the server: no internal user id, no dedupe key. */
export type PublicAlert = {
  id: string; kind: AlertKind; severity: AlertSeverity; status: Alert['status']; message: string;
  subject: string | null; cohortKey: string | null; occurrences: number;
  firstSeenAt: string; lastSeenAt: string; assigneeId: string | null;
};

export const toPublicAlert = (a: Alert): PublicAlert => ({
  id: a.id, kind: a.kind, severity: a.severity, status: a.status, message: a.message,
  subject: a.subjectPseudonym, cohortKey: a.cohortKey, occurrences: a.occurrences,
  firstSeenAt: a.firstSeenAt.toISOString(), lastSeenAt: a.lastSeenAt.toISOString(), assigneeId: a.assigneeId,
});

export const ALERT_CHANNEL = 'zindagi_alerts';

/** Tells every API process (via Postgres LISTEN/NOTIFY) that an alert changed. The payload carries no personal data. */
export async function notifyAlert(type: 'alert.created' | 'alert.updated', alert: Alert): Promise<void> {
  const payload = JSON.stringify({ type, institutionId: alert.institutionId, alert: toPublicAlert(alert) });
  await prisma.$executeRaw`SELECT pg_notify(${ALERT_CHANNEL}, ${payload})`;
}

const RANK: Record<AlertSeverity, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export type RaiseInput = {
  institutionId: string; kind: AlertKind; severity: AlertSeverity; dedupeKey: string; message: string; occurrences: number;
  subjectUserId?: string; subjectPseudonym?: string; cohortKey?: string;
};

/**
 * Idempotent upsert keyed by `dedupeKey`: repeating a tick never duplicates an alert, only counts and escalates it.
 * An escalation re-opens a RESOLVED alert. Notifies listeners only when something actually changed.
 */
export async function raiseAlert(input: RaiseInput): Promise<'created' | 'updated' | 'unchanged'> {
  const existing = await prisma.alert.findUnique({ where: { dedupeKey: input.dedupeKey } });
  if (!existing) {
    try {
      const created = await prisma.alert.create({ data: {
        institutionId: input.institutionId, kind: input.kind, severity: input.severity, dedupeKey: input.dedupeKey,
        message: input.message, occurrences: input.occurrences, subjectUserId: input.subjectUserId,
        subjectPseudonym: input.subjectPseudonym, cohortKey: input.cohortKey,
      } });
      await notifyAlert('alert.created', created);
      return 'created';
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'unchanged'; // lost a race
      throw error;
    }
  }
  const escalated = RANK[input.severity] > RANK[existing.severity];
  if (!escalated && existing.occurrences === input.occurrences && existing.message === input.message) return 'unchanged';
  const updated = await prisma.alert.update({ where: { id: existing.id }, data: {
    severity: escalated ? input.severity : existing.severity, occurrences: input.occurrences, message: input.message, lastSeenAt: new Date(),
    ...(escalated && existing.status === 'RESOLVED' ? { status: 'NEW' as const, resolvedAt: null } : {}),
  } });
  await notifyAlert('alert.updated', updated);
  return 'updated';
}
