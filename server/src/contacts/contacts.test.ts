import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { prisma } from '../db';
import { toPublicAlert } from '../insights/alerts';
import { buildBrief } from '../booking/brief';
import {
  ContactsError, createContact, deleteContact, getOwnedContact, isSameNumber, listContacts, normalizeIndianPhone,
  reorderContacts, scrubbedLabel, updateContact, validateOrder,
} from './contacts.service';
import { afterFailure, processOutbox } from './outbox';
import {
  expirePrompts, getPendingPrompt, listNotifications, maybeCreatePrompt, respondToPrompt, respondable, shouldCreatePrompt,
  type PromptHistory,
} from './prompts.service';
import type { MessageSender } from './sender';
import { checkInTemplate, firstNameOf } from './templates';
import { openField, phoneHash, sealField } from './vault';

const HOUR = 3_600_000;
const COOLDOWN = 6 * HOUR;
const NONE: PromptHistory = { open: null, lastDeclined: null, lastAny: null };

// ───────────────────────── pure rules ─────────────────────────

test('phone numbers: India only, +91 and 10 digits, formatting tolerated', () => {
  assert.equal(normalizeIndianPhone('98765 43210'), '+919876543210');
  assert.equal(normalizeIndianPhone('+91 98765-43210'), '+919876543210');
  assert.equal(normalizeIndianPhone('919876543210'), '+919876543210');
  for (const bad of ['12345', '+1 415 555 0100', '5876543210', '98765432100', '', null, 42]) {
    assert.throws(() => normalizeIndianPhone(bad), (e: unknown) => e instanceof ContactsError && e.status === 400);
  }
  assert.ok(isSameNumber('+919876543210', '+919876543210'));
  assert.ok(!isSameNumber('+919876543210', '+919876543211'));
});

test('contact fields are encrypted, tamper-evident, and the phone hash is keyed and stable', () => {
  const key = randomBytes(32);
  const stored = sealField('+919876543210', key);
  assert.ok(!stored.includes('9876543210') && !Buffer.from(stored.split('.')[2], 'base64').toString('utf8').includes('9876'));
  assert.equal(openField(stored, key), '+919876543210');
  assert.throws(() => openField(stored, randomBytes(32)));
  assert.equal(phoneHash('+919876543210', key), phoneHash('+919876543210', key));
  assert.notEqual(phoneHash('+919876543210', key), phoneHash('+919876543210', randomBytes(32)));
});

test('reorder must list exactly the student\'s ids, each once', () => {
  const mine = ['a', 'b', 'c'];
  assert.deepEqual(validateOrder(['c', 'a', 'b'], mine), ['c', 'a', 'b']);
  for (const bad of [['a', 'b'], ['a', 'b', 'x'], ['a', 'a', 'b'], ['a', 'b', 'c', 'd'], 'abc', null]) {
    assert.throws(() => validateOrder(bad, mine), (e: unknown) => e instanceof ContactsError && e.status === 400);
  }
});

test('message text is the fixed template: first name only, no risk, topic or mood words, no "suicide"', () => {
  for (const lang of ['en', 'hi'] as const) {
    const text = checkInTemplate('Ananya', lang);
    assert.ok(text.includes('Ananya') && text.includes('14416'));
    assert.ok(!/suicid|urgent level|elevated|risk|mood|conversation|diagnos/i.test(text), text);
  }
  assert.ok(checkInTemplate('Ananya', 'en').startsWith('Hi, Ananya has added you on Zindagi'));
  assert.equal(firstNameOf('  Ananya Sharma '), 'Ananya');
  assert.equal(firstNameOf('Ana<script>'), 'Anascript');
  assert.equal(firstNameOf('12345'), 'Your friend');
});

test('the template function takes no risk or conversation input', () => {
  assert.equal(checkInTemplate.length, 2);
});

test('threshold: one open prompt at a time', () => {
  const now = new Date();
  assert.equal(shouldCreatePrompt('URGENT', { ...NONE, open: { expiresAt: new Date(now.getTime() + HOUR) } }, now, COOLDOWN), false);
  assert.equal(shouldCreatePrompt('URGENT', { ...NONE, open: { expiresAt: new Date(now.getTime() - 1) } }, now, COOLDOWN), true);
});

test('cooldown: ELEVATED after a decline within 6 hours is suppressed; URGENT after an ELEVATED decline is not', () => {
  const now = new Date();
  const declined = (level: 'ELEVATED' | 'URGENT', ago: number): PromptHistory => ({ ...NONE, lastDeclined: { level, respondedAt: new Date(now.getTime() - ago) } });
  assert.equal(shouldCreatePrompt('ELEVATED', declined('ELEVATED', HOUR), now, COOLDOWN), false);
  assert.equal(shouldCreatePrompt('URGENT', declined('ELEVATED', HOUR), now, COOLDOWN), true);
  assert.equal(shouldCreatePrompt('URGENT', declined('URGENT', HOUR), now, COOLDOWN), false);
  assert.equal(shouldCreatePrompt('ELEVATED', declined('ELEVATED', 7 * HOUR), now, COOLDOWN), true);
});

test('the soft low-mood prompt does not repeat within a day', () => {
  const now = new Date();
  assert.equal(shouldCreatePrompt('LOW', { ...NONE, lastAny: { createdAt: new Date(now.getTime() - HOUR) } }, now, COOLDOWN), false);
  assert.equal(shouldCreatePrompt('LOW', { ...NONE, lastAny: { createdAt: new Date(now.getTime() - 25 * HOUR) } }, now, COOLDOWN), true);
});

test('a prompt is answerable only by its owner, while SHOWN, before expiry', () => {
  const now = new Date();
  const future = new Date(now.getTime() + HOUR);
  assert.equal(respondable({ userId: 'u1', status: 'SHOWN', expiresAt: future }, 'u1', now), 'ok');
  assert.equal(respondable({ userId: 'u1', status: 'SHOWN', expiresAt: future }, 'u2', now), 'not_found');
  assert.equal(respondable(null, 'u1', now), 'not_found');
  assert.equal(respondable({ userId: 'u1', status: 'SHOWN', expiresAt: new Date(now.getTime() - 1) }, 'u1', now), 'expired');
  assert.equal(respondable({ userId: 'u1', status: 'EXPIRED', expiresAt: future }, 'u1', now), 'expired');
  for (const status of ['MESSAGED', 'CALLED', 'DECLINED', 'SNOOZED'] as const) assert.equal(respondable({ userId: 'u1', status, expiresAt: future }, 'u1', now), 'answered');
});

test('outbox backoff: 1, 5, 15 minutes, then FAILED after 3 attempts', () => {
  const now = new Date();
  assert.equal(afterFailure(1, now).nextAttemptAt.getTime() - now.getTime(), 60_000);
  assert.equal(afterFailure(2, now).nextAttemptAt.getTime() - now.getTime(), 5 * 60_000);
  assert.equal(afterFailure(3, now).status, 'FAILED');
  assert.equal(afterFailure(1, now).status, 'QUEUED');
});

test('a provisional URGENT partial never creates a prompt', () => {
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'voice', 'index.ts'), 'utf8');
  const start = source.indexOf('private onPartial(');
  const end = source.indexOf('private onSpeechStart(');
  assert.ok(start > 0 && end > start);
  assert.ok(!/offerSupport|maybeCreatePrompt/.test(source.slice(start, end)));
});

const SRC = join(__dirname, '..', '..', 'src');
const walk = (dir: string): string[] => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
});

test('contacts stay private: no staff, brief, memory, insights or LLM code touches them', () => {
  for (const dir of ['admin', 'staff', 'insights', 'memory', 'conversation', 'booking']) {
    for (const file of walk(join(SRC, dir))) {
      const text = readFileSync(file, 'utf8');
      assert.ok(!/trustedContact|contacts\.service|contactNotification|contacts\/vault/i.test(text), `${file} must not read trusted contacts`);
    }
  }
});

test('admin alerts and therapist briefs expose no contact fields', () => {
  const alert = toPublicAlert({
    id: 'a', institutionId: 'i', kind: 'RISK', severity: 'HIGH', status: 'NEW', dedupeKey: 'k', subjectUserId: 'u', subjectPseudonym: 'p',
    cohortKey: null, occurrences: 1, message: 'm', assigneeId: null, firstSeenAt: new Date(), lastSeenAt: new Date(), resolvedAt: null,
  });
  const brief = buildBrief({ reason: 'ANXIETY', scoresOldestFirst: [1, 2, 3, 4], topics: ['SLEEP'], risk: ['ELEVATED'] });
  for (const keys of [Object.keys(alert), Object.keys(brief)]) {
    assert.ok(!keys.some(k => /contact|trusted|notification|prompt/i.test(k)), keys.join(','));
  }
  assert.ok(!/contact|trusted/i.test(JSON.stringify({ alert, brief })));
});

// ───────────────────────── database-backed rules ─────────────────────────

let dbUp = false;
const users: string[] = [];
const newUser = async (fullName = 'Ananya Sharma') => {
  const digits = String(Math.floor(6_000_000_000 + Math.random() * 3_999_999_999));
  const user = await prisma.user.create({ data: { phoneNumber: `+91${digits}`, fullName, age: 21, college: 'Test College', sex: 'FEMALE' } });
  users.push(user.id);
  return { id: user.id, phone: `+91${digits}` };
};
const phone = () => String(Math.floor(6_000_000_000 + Math.random() * 3_999_999_999));
const add = (userId: string, name = 'Riya', relationship: string = 'FRIEND') => createContact(userId, { name, phone: phone(), relationship });
const rejects = (promise: Promise<unknown>, status: number) => assert.rejects(promise, (e: unknown) => e instanceof ContactsError && e.status === status);
const prompt = (userId: string, level: 'URGENT' | 'ELEVATED' = 'URGENT') => prisma.supportPrompt.create({ data: { userId, source: 'VOICE', level, expiresAt: new Date(Date.now() + 30 * 60_000) } });
const notificationCount = (userId: string) => prisma.contactNotification.count({ where: { userId } });

before(async () => { dbUp = await prisma.$queryRaw`SELECT 1`.then(() => true, () => false); });
after(async () => {
  if (dbUp) await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const db = (name: string, fn: () => Promise<void>) => test(name, async t => { if (!dbUp) return t.skip('database not reachable'); await fn(); });

db('a fourth contact and a duplicate number return 409; the student\'s own number is rejected', async () => {
  const u = await newUser();
  const first = await createContact(u.id, { name: 'Riya', phone: '98765 00001', relationship: 'FRIEND' });
  await rejects(createContact(u.id, { name: 'Again', phone: '+919876500001', relationship: 'FRIEND' }), 409);
  await add(u.id); await add(u.id);
  await rejects(add(u.id), 409);
  const other = await newUser();
  await rejects(createContact(other.id, { name: 'Me', phone: other.phone, relationship: 'FRIEND' }), 400);
  assert.equal(first.phoneMasked.endsWith('0001'), true);
  assert.ok(!JSON.stringify(first).includes('9876500001'));
});

db('relationship must be chosen: none is defaulted', async () => {
  const u = await newUser();
  await rejects(createContact(u.id, { name: 'Riya', phone: phone() }), 400);
  await rejects(createContact(u.id, { name: 'Riya', phone: phone(), relationship: 'PARENT' }), 400);
});

db('priorities stay dense 1..n after reorder and delete; bad reorders are 400', async () => {
  const u = await newUser();
  const [a, b, c] = [await add(u.id, 'A'), await add(u.id, 'B'), await add(u.id, 'C')];
  assert.deepEqual((await listContacts(u.id)).map(x => x.name), ['A', 'B', 'C']);
  assert.deepEqual((await reorderContacts(u.id, [c.id, a.id, b.id])).map(x => [x.name, x.priority]), [['C', 1], ['A', 2], ['B', 3]]);
  await rejects(reorderContacts(u.id, [a.id, b.id]), 400);
  await rejects(reorderContacts(u.id, [a.id, b.id, randomUUID()]), 400);
  const stranger = await newUser();
  const foreign = await add(stranger.id);
  await rejects(reorderContacts(u.id, [a.id, b.id, foreign.id]), 400);
  await deleteContact(u.id, c.id);
  assert.deepEqual((await listContacts(u.id)).map(x => [x.name, x.priority]), [['A', 1], ['B', 2]]);
});

db('another student\'s contact or prompt id is a 404 everywhere', async () => {
  const owner = await newUser(); const intruder = await newUser();
  const contact = await add(owner.id);
  const p = await prompt(owner.id);
  await rejects(updateContact(intruder.id, contact.id, { name: 'X' }), 404);
  await rejects(deleteContact(intruder.id, contact.id), 404);
  assert.equal(await getOwnedContact(intruder.id, contact.id), null);
  await rejects(respondToPrompt(intruder.id, p.id, { action: 'decline' }), 404);
  await rejects(respondToPrompt(intruder.id, p.id, { action: 'message', contactId: contact.id }), 404);
  await rejects(respondToPrompt(owner.id, p.id, { action: 'message', contactId: (await add(intruder.id)).id }), 404);
  assert.equal(await getPendingPrompt(intruder.id), null);
  assert.equal(await notificationCount(owner.id), 0);
  assert.equal((await prisma.supportPrompt.findUniqueOrThrow({ where: { id: p.id } })).status, 'SHOWN');
});

db('message needs a tap on a live SHOWN prompt: expired, answered and unknown prompts send nothing', async () => {
  const u = await newUser();
  const contact = await add(u.id);
  const expired = await prisma.supportPrompt.create({ data: { userId: u.id, source: 'VOICE', level: 'URGENT', expiresAt: new Date(Date.now() - 1000) } });
  await rejects(respondToPrompt(u.id, expired.id, { action: 'message', contactId: contact.id }), 410);
  const answered = await prompt(u.id);
  await respondToPrompt(u.id, answered.id, { action: 'decline' });
  await rejects(respondToPrompt(u.id, answered.id, { action: 'message', contactId: contact.id }), 409);
  await rejects(respondToPrompt(u.id, randomUUID(), { action: 'message', contactId: contact.id }), 404);
  await rejects(respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message' }), 400);
  assert.equal(await notificationCount(u.id), 0);
});

db('decline and call never create a notification', async () => {
  const u = await newUser();
  const contact = await add(u.id);
  assert.equal((await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'decline' })).status, 'DECLINED');
  const called = await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'call', contactId: contact.id }) as { status: string; tel: string | null };
  assert.equal(called.status, 'CALLED');
  assert.match(called.tel ?? '', /^\+91[6-9]\d{9}$/);
  assert.equal((await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'snooze' })).status, 'SNOOZED');
  assert.equal(await notificationCount(u.id), 0);
});

db('a message is exactly the template for the first name, in the student\'s language, and sends once', async () => {
  const u = await newUser('Ananya Sharma');
  const contact = await add(u.id, 'Riya', 'FRIEND');
  const p = await prompt(u.id, 'URGENT');
  const result = await respondToPrompt(u.id, p.id, { action: 'message', contactId: contact.id }) as { notification: { body: string; contactLabel: string } };
  assert.equal(result.notification.body, checkInTemplate('Ananya', 'en'));
  assert.equal(result.notification.contactLabel, 'Riya (friend)');
  await rejects(respondToPrompt(u.id, p.id, { action: 'message', contactId: contact.id }), 409);
  assert.equal(await notificationCount(u.id), 1);
  const hindi = await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: contact.id, lang: 'hi' }) as { notification: { body: string } };
  assert.equal(hindi.notification.body, checkInTemplate('Ananya', 'hi'));
  assert.ok(!/URGENT|ELEVATED/.test(hindi.notification.body));
  const log = await listNotifications(u.id);
  assert.equal(log.length, 2);
  assert.ok(log.every(n => 'body' in n && 'contactLabel' in n && 'channel' in n && 'createdAt' in n));
});

db('at most 3 messages per student per day', async () => {
  const u = await newUser();
  const contact = await add(u.id);
  for (let i = 0; i < 3; i++) await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: contact.id });
  await rejects(respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: contact.id }), 429);
  assert.equal(await notificationCount(u.id), 3);
});

db('deleting a contact removes the row and scrubs the log to the relationship only', async () => {
  const u = await newUser();
  const contact = await add(u.id, 'Riya', 'FRIEND');
  await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: contact.id });
  await deleteContact(u.id, contact.id);
  assert.equal(await prisma.trustedContact.count({ where: { userId: u.id } }), 0);
  const [entry] = await listNotifications(u.id);
  assert.equal(entry.contactLabel, 'a friend');
  assert.equal(entry.contactLabel, scrubbedLabel('FRIEND'));
  const raw = await prisma.contactNotification.findFirstOrThrow({ where: { userId: u.id } });
  assert.equal(raw.contactId, null);
  assert.ok(!raw.contactLabel.includes('Riya'));
  const audits = await prisma.auditLog.findMany({ where: { actorId: u.id } });
  assert.ok(audits.some(a => a.action === 'contact.delete') && audits.some(a => a.action === 'contact.message'));
  assert.ok(audits.every(a => !/Riya|\+91/.test(JSON.stringify(a))));
});

db('prompts: ELEVATED after a decline is suppressed, URGENT is not; one open prompt at a time; Tele-MANAS needs no contacts', async () => {
  const u = await newUser();
  const first = await maybeCreatePrompt(u.id, 'VOICE', 'ELEVATED');
  assert.ok(first);
  assert.equal(await maybeCreatePrompt(u.id, 'VOICE', 'URGENT'), null, 'one open prompt per student');
  assert.equal((await getPendingPrompt(u.id))?.id, first.id);
  await respondToPrompt(u.id, first.id, { action: 'decline' });
  assert.equal(await getPendingPrompt(u.id), null);
  assert.equal(await maybeCreatePrompt(u.id, 'CHECKIN', 'ELEVATED'), null);
  const urgent = await maybeCreatePrompt(u.id, 'VOICE', 'URGENT');
  assert.ok(urgent, 'URGENT breaks the cooldown after an ELEVATED decline');
  assert.deepEqual(Object.keys(urgent).sort(), ['expiresAt', 'id', 'level', 'source']);
  assert.equal((await listContacts(u.id)).length, 0);
});

db('expiry job closes stale prompts', async () => {
  const u = await newUser();
  const stale = await prisma.supportPrompt.create({ data: { userId: u.id, source: 'CHECKIN', level: 'ELEVATED', expiresAt: new Date(Date.now() - 1000) } });
  await expirePrompts(u.id);
  assert.equal((await prisma.supportPrompt.findUniqueOrThrow({ where: { id: stale.id } })).status, 'EXPIRED');
});

db('outbox sends queued messages, retries failures, and cancels anything for a deleted contact', async () => {
  const u = await newUser();
  const kept = await add(u.id, 'Riya');
  const doomed = await add(u.id, 'Kabir', 'ROOMMATE');
  const sent: { to: string; body: string }[] = [];
  let failNext = false;
  const sender: MessageSender = { async send(m) { if (failNext) throw new Error('boom'); sent.push({ to: m.to, body: m.body }); return { providerId: 'p1' }; } };

  await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: kept.id });
  assert.equal(await processOutbox(sender, u.id), 1);
  assert.equal(sent.length, 1);
  assert.match(sent[0].to, /^\+91[6-9]\d{9}$/);
  assert.equal(sent[0].body, checkInTemplate('Ananya', 'en'));
  assert.equal((await prisma.contactNotification.findFirstOrThrow({ where: { userId: u.id } })).status, 'SENT');

  failNext = true;
  await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: kept.id });
  await processOutbox(sender, u.id);
  const retry = await prisma.contactNotification.findFirstOrThrow({ where: { userId: u.id, status: 'QUEUED' } });
  assert.equal(retry.attempts, 1);
  assert.ok(retry.nextAttemptAt.getTime() > Date.now());
  assert.equal(await processOutbox(sender, u.id), 0, 'not due yet');
  await prisma.contactNotification.update({ where: { id: retry.id }, data: { attempts: 2, nextAttemptAt: new Date() } });
  await processOutbox(sender, u.id);
  assert.equal((await prisma.contactNotification.findUniqueOrThrow({ where: { id: retry.id } })).status, 'FAILED');

  failNext = false;
  await respondToPrompt(u.id, (await prompt(u.id)).id, { action: 'message', contactId: doomed.id });
  await deleteContact(u.id, doomed.id);
  const before = sent.length;
  await processOutbox(sender, u.id);
  assert.equal(sent.length, before, 'nothing goes to a deleted contact');
  const cancelled = await prisma.contactNotification.findFirstOrThrow({ where: { userId: u.id, errorCode: 'contact_deleted' } });
  assert.equal(cancelled.status, 'FAILED');
});
