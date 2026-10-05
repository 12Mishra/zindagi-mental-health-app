import { createSessionToken, hashValue } from '../auth/utils/crypto.util';
import { prisma } from '../db';

const TICKET_LIFETIME_MS = 60_000;

export async function issueVoiceTicket(userId: string, sessionId: string, conversationId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, status: 'ACTIVE' }, select: { id: true },
  });
  if (!conversation) return null;
  const ticket = createSessionToken();
  await prisma.voiceTicket.create({
    data: {
      tokenHash: hashValue(ticket), userId, sessionId, conversationId,
      expiresAt: new Date(Date.now() + TICKET_LIFETIME_MS),
    },
  });
  return { ticket, expiresAt: new Date(Date.now() + TICKET_LIFETIME_MS) };
}

export async function consumeVoiceTicket(ticket: string) {
  if (ticket.length < 20 || ticket.length > 256) return null;
  const tokenHash = hashValue(ticket);
  const now = new Date();
  const updated = await prisma.voiceTicket.updateMany({
    where: { tokenHash, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (updated.count !== 1) return null;
  const record = await prisma.voiceTicket.findUnique({
    where: { tokenHash },
    include: { session: true, conversation: true },
  });
  if (!record || record.session.revokedAt || record.session.expiresAt <= now ||
      record.session.userId !== record.userId || record.conversation.userId !== record.userId ||
      record.conversation.status !== 'ACTIVE') return null;
  return {
    userId: record.userId, conversationId: record.conversationId,
    sessionId: record.sessionId, transcriptConsent: record.conversation.transcriptConsent,
  };
}
