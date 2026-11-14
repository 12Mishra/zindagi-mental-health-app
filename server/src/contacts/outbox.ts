import { prisma } from '../db';
import { getSender, SendError, type MessageSender } from './sender';
import { openField } from './vault';

const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 3;
/** Wait after the 1st, 2nd failed attempt; the 3rd failure is final. */
export const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];

/** Pure: what happens to a notification after a failed attempt (`attempts` already includes this one). */
export function afterFailure(attempts: number, now: Date): { status: 'QUEUED' | 'FAILED'; nextAttemptAt: Date } {
  if (attempts >= MAX_ATTEMPTS) return { status: 'FAILED', nextAttemptAt: now };
  return { status: 'QUEUED', nextAttemptAt: new Date(now.getTime() + BACKOFF_MS[attempts - 1]) };
}

async function claim(userId?: string) {
  const now = new Date();
  const due = { ...(userId ? { userId } : {}), status: 'QUEUED' as const, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] };
  const candidate = await prisma.contactNotification.findFirst({ where: due, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!candidate) return null;
  const claimed = await prisma.contactNotification.updateMany({
    where: { id: candidate.id, ...due }, data: { attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  return claimed.count ? prisma.contactNotification.findUnique({ where: { id: candidate.id } }) : null;
}

/** Sends queued messages with backoff. The recipient's number is decrypted here and nowhere else outside the owner's contact routes. */
/** `userId` narrows the run to one student (tests); the worker passes nothing. */
export async function processOutbox(sender: MessageSender = getSender(), userId?: string): Promise<number> {
  let sent = 0;
  for (let i = 0; i < 10; i++) {
    const row = await claim(userId);
    if (!row) break;
    try {
      const contact = row.contactId ? await prisma.trustedContact.findFirst({ where: { id: row.contactId, userId: row.userId } }) : null;
      // Deleting a contact cancels anything still waiting to go to them.
      if (!contact) throw new SendError('contact_deleted');
      const result = await sender.send({ to: openField(contact.phoneCipher), channel: row.channel, body: row.body });
      await prisma.contactNotification.update({
        where: { id: row.id }, data: { status: 'SENT', sentAt: new Date(), providerId: result.providerId, leaseUntil: null, errorCode: null },
      });
      sent++;
    } catch (error) {
      const code = error instanceof SendError ? error.code : 'send_failed';
      const next = code === 'contact_deleted' ? { status: 'FAILED' as const, nextAttemptAt: new Date() } : afterFailure(row.attempts, new Date());
      await prisma.contactNotification.update({
        where: { id: row.id }, data: { status: next.status, nextAttemptAt: next.nextAttemptAt, leaseUntil: null, errorCode: code },
      });
      console.warn(`[contacts] outbox ${row.id} attempt ${row.attempts} failed: ${code}`);
    }
  }
  return sent;
}
