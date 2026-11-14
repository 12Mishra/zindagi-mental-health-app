import { prisma } from '../db';
import type { ContactChannel, ContactRelationship } from '../generated/prisma/client';
import { openField, phoneHash, sealField } from './vault';

export class ContactsError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const MAX_CONTACTS = 3;

export const RELATIONSHIPS = ['FRIEND', 'ROOMMATE', 'SIBLING', 'FAMILY', 'PARTNER', 'MENTOR', 'COUNSELLOR', 'OTHER'] as const;
export const CHANNELS = ['WHATSAPP', 'SMS'] as const;
export const isRelationship = (v: unknown): v is ContactRelationship => typeof v === 'string' && (RELATIONSHIPS as readonly string[]).includes(v);
export const isChannel = (v: unknown): v is ContactChannel => typeof v === 'string' && (CHANNELS as readonly string[]).includes(v);

const LABELS: Record<ContactRelationship, string> = {
  FRIEND: 'a friend', ROOMMATE: 'a roommate', SIBLING: 'a sibling', FAMILY: 'a family member',
  PARTNER: 'a partner', MENTOR: 'a mentor', COUNSELLOR: 'a counsellor', OTHER: 'someone you trust',
};

/** What a log entry keeps after the contact is deleted: the relationship only, never a name or number. */
export const scrubbedLabel = (relationship: ContactRelationship) => LABELS[relationship];
export const contactLabel = (name: string, relationship: ContactRelationship) => `${name} (${relationship.toLowerCase()})`;

/** Indian mobile numbers only: +91 and 10 digits starting 6-9. Accepts "98765 43210", "+91 98765-43210" and "919876543210". */
export function normalizeIndianPhone(input: unknown): string {
  if (typeof input !== 'string') throw new ContactsError('A valid phone number is required.', 400);
  const compact = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+91|91)?(\d{10})$/.exec(compact);
  if (!match || !/^[6-9]/.test(match[1])) throw new ContactsError('Enter a valid 10-digit Indian mobile number.', 400);
  return `+91${match[1]}`;
}

/** Compares on the last 10 digits so "+919876543210" and "9876543210" match. */
export const isSameNumber = (a: string, b: string) => a.replace(/\D/g, '').slice(-10) === b.replace(/\D/g, '').slice(-10);

export function parseName(input: unknown): string {
  const name = typeof input === 'string' ? input.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 40) throw new ContactsError('A name of up to 40 characters is required.', 400);
  return name;
}

/** A reorder must list exactly the student's contacts, each once. */
export function validateOrder(ids: unknown, current: string[]): string[] {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string')) throw new ContactsError('ids must be a list of contact ids.', 400);
  const given = new Set(ids as string[]);
  if (given.size !== ids.length || given.size !== current.length || !current.every(id => given.has(id))) {
    throw new ContactsError('ids must be exactly your contacts, each once.', 400);
  }
  return ids as string[];
}

export const maskPhoneForDisplay = (e164: string) => `${e164.slice(0, 3)} ******${e164.slice(-4)}`;

type Row = { id: string; nameCipher: string; phoneCipher: string; relationship: ContactRelationship; channel: ContactChannel; priority: number };

/** Decrypts for the owner only; the full number never leaves the server. */
function toView(row: Row) {
  return {
    id: row.id, name: openField(row.nameCipher), phoneMasked: maskPhoneForDisplay(openField(row.phoneCipher)),
    relationship: row.relationship, channel: row.channel, priority: row.priority,
  };
}

const audit = (userId: string, action: string, targetType: string, targetId: string) =>
  prisma.auditLog.create({ data: { actorId: userId, actorRole: 'STUDENT', action, targetType, targetId } }).catch(() => {});

export async function listContacts(userId: string) {
  const rows = await prisma.trustedContact.findMany({ where: { userId }, orderBy: { priority: 'asc' } });
  return rows.map(toView);
}

export async function createContact(userId: string, input: { name: unknown; phone: unknown; relationship?: unknown; channel?: unknown }) {
  const name = parseName(input.name);
  const phone = normalizeIndianPhone(input.phone);
  if (!isRelationship(input.relationship)) throw new ContactsError('Choose who this person is to you.', 400);
  const channel = input.channel == null ? 'WHATSAPP' : input.channel;
  if (!isChannel(channel)) throw new ContactsError('channel must be WHATSAPP or SMS.', 400);

  const me = await prisma.user.findUnique({ where: { id: userId }, select: { phoneNumber: true } });
  if (!me) throw new ContactsError('User not found.', 404);
  if (isSameNumber(me.phoneNumber, phone)) {
    throw new ContactsError('That is your own number. Add someone else you trust.', 400);
  }

  const hash = phoneHash(phone);
  try {
    const row = await prisma.$transaction(async tx => {
      const existing = await tx.trustedContact.findMany({ where: { userId }, select: { phoneHash: true } });
      if (existing.length >= MAX_CONTACTS) throw new ContactsError(`You can add up to ${MAX_CONTACTS} people.`, 409);
      if (existing.some(c => c.phoneHash === hash)) throw new ContactsError('You already added this number.', 409);
      return tx.trustedContact.create({ data: {
        userId, nameCipher: sealField(name), phoneCipher: sealField(phone), phoneHash: hash,
        relationship: input.relationship as ContactRelationship, channel, priority: existing.length + 1,
      } });
    });
    void audit(userId, 'contact.create', 'TrustedContact', row.id);
    return toView(row);
  } catch (error) {
    // A concurrent add can still hit the unique indexes; report it the same way.
    if ((error as { code?: string }).code === 'P2002') throw new ContactsError('You already added this number or reached the limit.', 409);
    throw error;
  }
}

export async function updateContact(userId: string, id: string, input: { name?: unknown; relationship?: unknown; channel?: unknown }) {
  const data: { nameCipher?: string; relationship?: ContactRelationship; channel?: ContactChannel } = {};
  if (input.name !== undefined) data.nameCipher = sealField(parseName(input.name));
  if (input.relationship !== undefined) {
    if (!isRelationship(input.relationship)) throw new ContactsError('Invalid relationship.', 400);
    data.relationship = input.relationship;
  }
  if (input.channel !== undefined) {
    if (!isChannel(input.channel)) throw new ContactsError('channel must be WHATSAPP or SMS.', 400);
    data.channel = input.channel;
  }
  if (!Object.keys(data).length) throw new ContactsError('Nothing to update.', 400);
  const claimed = await prisma.trustedContact.updateMany({ where: { id, userId }, data });
  if (!claimed.count) throw new ContactsError('Contact not found.', 404);
  return toView(await prisma.trustedContact.findFirstOrThrow({ where: { id, userId } }));
}

export async function reorderContacts(userId: string, ids: unknown) {
  await prisma.$transaction(async tx => {
    const rows = await tx.trustedContact.findMany({ where: { userId }, select: { id: true } });
    const order = validateOrder(ids, rows.map(r => r.id));
    // Offset first so the (userId, priority) unique index never sees two rows with the same value.
    await tx.trustedContact.updateMany({ where: { userId }, data: { priority: { increment: 100 } } });
    for (let i = 0; i < order.length; i++) await tx.trustedContact.update({ where: { id: order[i] }, data: { priority: i + 1 } });
  });
  return listContacts(userId);
}

export async function deleteContact(userId: string, id: string) {
  await prisma.$transaction(async tx => {
    const contact = await tx.trustedContact.findFirst({ where: { id, userId }, select: { relationship: true, priority: true } });
    if (!contact) throw new ContactsError('Contact not found.', 404);
    // The log keeps the relationship only; name and number go with the row.
    await tx.contactNotification.updateMany({ where: { userId, contactId: id }, data: { contactId: null, contactLabel: scrubbedLabel(contact.relationship) } });
    await tx.trustedContact.delete({ where: { id } });
    const later = await tx.trustedContact.findMany({ where: { userId, priority: { gt: contact.priority } }, orderBy: { priority: 'asc' }, select: { id: true, priority: true } });
    for (const row of later) await tx.trustedContact.update({ where: { id: row.id }, data: { priority: row.priority - 1 } });
  });
  void audit(userId, 'contact.delete', 'TrustedContact', id);
}

/** For the prompt flow: one owned contact, with the details needed to label and send. Server-internal. */
export async function getOwnedContact(userId: string, id: string) {
  const row = await prisma.trustedContact.findFirst({ where: { id, userId } });
  if (!row) return null;
  return { id: row.id, name: openField(row.nameCipher), phone: openField(row.phoneCipher), relationship: row.relationship, channel: row.channel };
}
