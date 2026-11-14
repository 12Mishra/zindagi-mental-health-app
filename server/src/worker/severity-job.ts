import { prisma } from '../db';
import { classifySeverity } from '../insights/severity';
import { POLICY_VERSION } from '../voice/policy';

const BATCH = 10;
const GIVE_UP_MS = 24 * 3_600_000;

/**
 * Classifies check-in notes that have no severity yet. If the model is unavailable the row is retried on a later
 * tick; after 24 hours it is closed as UNKNOWN so one bad note cannot be retried forever. ELEVATED/URGENT also
 * appends a RiskHistory row (what the alert engine reads), in the same transaction as the classification.
 */
export async function classifyPendingCheckins(): Promise<number> {
  const pending = await prisma.moodCheckin.findMany({
    where: { note: { not: null }, classifiedAt: null }, orderBy: { createdAt: 'asc' }, take: BATCH,
    select: { id: true, userId: true, note: true, createdAt: true },
  });
  let done = 0;
  for (const row of pending) {
    const result = await classifySeverity(row.note ?? '');
    const expired = Date.now() - row.createdAt.getTime() > GIVE_UP_MS;
    if (result.source === 'unavailable' && !expired) continue;
    await prisma.$transaction(async tx => {
      const claimed = await tx.moodCheckin.updateMany({
        where: { id: row.id, classifiedAt: null }, data: { severity: result.level, classifiedAt: new Date() },
      });
      if (claimed.count === 1 && (result.level === 'ELEVATED' || result.level === 'URGENT')) {
        await tx.riskHistory.create({
          data: { userId: row.userId, level: result.level, flag: 'checkin_note', policyVersion: POLICY_VERSION },
        });
      }
    });
    done++;
  }
  return done;
}
