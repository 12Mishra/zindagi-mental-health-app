import { config } from '../config';
import { prisma } from '../db';
import type { PromptSource, PromptStatus, RiskLevel } from '../generated/prisma/client';
import { contactLabel, ContactsError, getOwnedContact } from './contacts.service';
import { checkInTemplate, firstNameOf, isMessageLang, type MessageLang } from './templates';

export const MAX_MESSAGES_PER_DAY = 3;
const SOFT_REPEAT_MS = 24 * 3_600_000;

type PromptLevel = Extract<RiskLevel, 'LOW' | 'ELEVATED' | 'URGENT'>;

export type PromptHistory = {
  /** A SHOWN prompt that has not expired. */
  open: { expiresAt: Date } | null;
  /** Most recent prompt the student declined or snoozed. */
  lastDeclined: { level: RiskLevel; respondedAt: Date } | null;
  /** Most recent prompt of any status. */
  lastAny: { createdAt: Date } | null;
};

/**
 * Pure decision: should a new prompt be shown? One open prompt per student; after a decline or snooze nothing new for
 * the cooldown unless this signal is URGENT and the declined one was not; the soft low-mood prompt never repeats within a day.
 */
export function shouldCreatePrompt(level: PromptLevel, history: PromptHistory, now: Date, cooldownMs: number): boolean {
  if (history.open && history.open.expiresAt > now) return false;
  const declined = history.lastDeclined;
  if (declined && now.getTime() - declined.respondedAt.getTime() < cooldownMs) {
    if (!(level === 'URGENT' && declined.level !== 'URGENT')) return false;
  }
  if (level === 'LOW' && history.lastAny && now.getTime() - history.lastAny.createdAt.getTime() < SOFT_REPEAT_MS) return false;
  return true;
}

export type RespondAction = 'message' | 'call' | 'decline' | 'snooze';
export const isAction = (v: unknown): v is RespondAction => v === 'message' || v === 'call' || v === 'decline' || v === 'snooze';

/** Pure check: a prompt can be answered only by its owner, while SHOWN, and before it expires. */
export function respondable(prompt: { userId: string; status: PromptStatus; expiresAt: Date } | null, userId: string, now: Date): 'ok' | 'not_found' | 'expired' | 'answered' {
  if (!prompt || prompt.userId !== userId) return 'not_found';
  if (prompt.status !== 'SHOWN') return prompt.status === 'EXPIRED' ? 'expired' : 'answered';
  return prompt.expiresAt <= now ? 'expired' : 'ok';
}

/** Marks SHOWN prompts past their expiry. Used by the job and before creating or reading a prompt. */
export const expirePrompts = (userId?: string) => prisma.supportPrompt.updateMany({
  where: { status: 'SHOWN', expiresAt: { lte: new Date() }, ...(userId ? { userId } : {}) }, data: { status: 'EXPIRED' },
});

/**
 * Creates a support prompt when the threshold rules allow it; returns it, or null when suppressed. Callers pass only a
 * risk level and a source: nothing the student said is stored on the prompt or can reach a contact.
 */
export async function maybeCreatePrompt(userId: string, source: PromptSource, level: PromptLevel) {
  await expirePrompts(userId);
  const now = new Date();
  const [open, lastDeclined, lastAny] = await Promise.all([
    prisma.supportPrompt.findFirst({ where: { userId, status: 'SHOWN', expiresAt: { gt: now } }, select: { expiresAt: true } }),
    prisma.supportPrompt.findFirst({ where: { userId, status: { in: ['DECLINED', 'SNOOZED'] }, respondedAt: { not: null } }, orderBy: { respondedAt: 'desc' }, select: { level: true, respondedAt: true } }),
    prisma.supportPrompt.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
  ]);
  if (!shouldCreatePrompt(level, { open, lastDeclined: lastDeclined && { level: lastDeclined.level, respondedAt: lastDeclined.respondedAt! }, lastAny }, now, config.supportPromptCooldownMs)) return null;
  return prisma.supportPrompt.create({
    data: { userId, source, level, expiresAt: new Date(now.getTime() + config.supportPromptTtlMs) },
    select: { id: true, level: true, source: true, expiresAt: true },
  });
}

/** The prompt to show now, if any. Level and source only. */
export async function getPendingPrompt(userId: string) {
  await expirePrompts(userId);
  return prisma.supportPrompt.findFirst({
    where: { userId, status: 'SHOWN', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' },
    select: { id: true, level: true, source: true, expiresAt: true },
  });
}

/** The exact text a contact would receive, for the preview step. Built from the student's first name only. */
export async function previewMessage(userId: string, lang: unknown): Promise<{ text: string; lang: MessageLang }> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  if (!user) throw new ContactsError('User not found.', 404);
  const language = isMessageLang(lang) ? lang : 'en';
  return { text: checkInTemplate(firstNameOf(user.fullName), language), lang: language };
}

export async function respondToPrompt(userId: string, promptId: string, input: { action: unknown; contactId?: unknown; lang?: unknown }) {
  if (!isAction(input.action)) throw new ContactsError('action must be message, call, decline or snooze.', 400);
  const action = input.action;
  const prompt = await prisma.supportPrompt.findUnique({ where: { id: promptId }, select: { userId: true, status: true, expiresAt: true } });
  const state = respondable(prompt, userId, new Date());
  if (state === 'not_found') throw new ContactsError('Prompt not found.', 404);
  if (state === 'expired') { await expirePrompts(userId); throw new ContactsError('This prompt has expired.', 410); }
  if (state === 'answered') throw new ContactsError('This prompt was already answered.', 409);

  if (action === 'decline' || action === 'snooze') {
    const status: PromptStatus = action === 'decline' ? 'DECLINED' : 'SNOOZED';
    await closePrompt(promptId, userId, status);
    return { status };
  }

  // The phone dials from the device; the server only records that it happened and sends nothing.
  if (action === 'call') {
    const callee = input.contactId == null ? null : typeof input.contactId === 'string' ? await getOwnedContact(userId, input.contactId) : null;
    if (input.contactId != null && !callee) throw new ContactsError('Contact not found.', 404);
    await closePrompt(promptId, userId, 'CALLED');
    // The student's own contact's number goes back to the student's device only, so it can dial; the server sends nothing.
    return { status: 'CALLED' as const, tel: callee?.phone ?? null };
  }

  if (typeof input.contactId !== 'string') throw new ContactsError('Choose who to message.', 400);
  const contact = await getOwnedContact(userId, input.contactId);
  if (!contact) throw new ContactsError('Contact not found.', 404);

  const sentToday = await prisma.contactNotification.count({ where: { userId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
  if (sentToday >= MAX_MESSAGES_PER_DAY) throw new ContactsError('You have reached today\'s limit for messages to your contacts.', 429);

  const { text } = await previewMessage(userId, input.lang);
  const notification = await prisma.$transaction(async tx => {
    // Single conditional update: only the first tap on a live, SHOWN prompt wins.
    const claimed = await tx.supportPrompt.updateMany({
      where: { id: promptId, userId, status: 'SHOWN', expiresAt: { gt: new Date() } }, data: { status: 'MESSAGED', respondedAt: new Date() },
    });
    if (claimed.count !== 1) throw new ContactsError('This prompt was already answered.', 409);
    return tx.contactNotification.create({
      data: { userId, promptId, contactId: contact.id, contactLabel: contactLabel(contact.name, contact.relationship), channel: contact.channel, body: text },
      select: { id: true, contactLabel: true, channel: true, body: true, status: true, createdAt: true },
    });
  });
  void prisma.auditLog.create({ data: { actorId: userId, actorRole: 'STUDENT', action: 'contact.message', targetType: 'ContactNotification', targetId: notification.id } }).catch(() => {});
  return { status: 'MESSAGED' as const, notification };
}

async function closePrompt(promptId: string, userId: string, status: PromptStatus) {
  const claimed = await prisma.supportPrompt.updateMany({
    where: { id: promptId, userId, status: 'SHOWN', expiresAt: { gt: new Date() } }, data: { status, respondedAt: new Date() },
  });
  if (claimed.count !== 1) throw new ContactsError('This prompt was already answered.', 409);
}

/** The student's own send log: who, when, channel, exact text. */
export const listNotifications = (userId: string) => prisma.contactNotification.findMany({
  where: { userId }, orderBy: { createdAt: 'desc' }, take: 100,
  select: { id: true, contactLabel: true, channel: true, body: true, status: true, createdAt: true, sentAt: true },
});
