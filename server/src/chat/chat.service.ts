import { prisma } from '../db';
import { BookingError } from '../booking/booking.service';
import { open, seal } from '../booking/crypto';
import { triageStableUtterance } from '../voice/policy';
import { publish, setCounterpartLookup, type ChatPrincipal } from './chat.hub';

/**
 * Text chat between a student and a counsellor they already have a relationship with: an appointment,
 * or a session request addressed to or handled by that counsellor. One thread per pair.
 */

export const MAX_BODY = 2000;
const PAGE = 50;
const RATE_LIMIT = 20; // messages per sender per minute
const sent = new Map<string, number[]>();

const err = (message: string, status = 400) => new BookingError(message, status);

type ThreadRow = { id: string; studentId: string; therapistId: string; institutionId: string };

/** True when this student and counsellor are linked through booking. */
export async function linked(studentId: string, therapistId: string): Promise<boolean> {
  const [appt, req] = await Promise.all([
    prisma.appointment.findFirst({ where: { studentId, therapistId }, select: { id: true } }),
    prisma.sessionRequest.findFirst({
      where: { studentId, OR: [{ preferredTherapistId: therapistId }, { handledById: therapistId }] }, select: { id: true },
    }),
  ]);
  return !!(appt || req);
}

async function threadFor(p: ChatPrincipal, threadId: string): Promise<ThreadRow> {
  const t = await prisma.chatThread.findFirst({
    where: { id: threadId, ...(p.role === 'STUDENT' ? { studentId: p.id } : { therapistId: p.id }) },
    select: { id: true, studentId: true, therapistId: true, institutionId: true },
  });
  if (!t) throw err('Conversation not found.', 404);
  return t;
}

const counterpart = (p: ChatPrincipal, t: ThreadRow): ChatPrincipal =>
  p.role === 'STUDENT' ? { role: 'THERAPIST', id: t.therapistId } : { role: 'STUDENT', id: t.studentId };

setCounterpartLookup(async (p, threadId) => counterpart(p, await threadFor(p, threadId)));

type MessageRow = { id: string; threadId: string; senderRole: 'STUDENT' | 'THERAPIST'; clientId: string | null; ciphertext: string; iv: string; tag: string; flagged: boolean; createdAt: Date };

function decrypt(m: Pick<MessageRow, 'ciphertext' | 'iv' | 'tag'>): string {
  try { return open(m); } catch { return '[This message could not be decrypted.]'; }
}

/** `flagged` is shown to counsellors only; a student never sees that their message was flagged. */
const toMessage = (m: MessageRow, viewer: ChatPrincipal['role']) => ({
  id: m.id, threadId: m.threadId, from: m.senderRole, body: decrypt(m), clientId: m.clientId,
  createdAt: m.createdAt.toISOString(), ...(viewer === 'THERAPIST' ? { flagged: m.flagged } : {}),
});

// ───────────────────────────── threads ─────────────────────────────

/** Opens (or returns) the student's thread with a counsellor they are linked to. */
export async function openAsStudent(studentId: string, therapistId: string) {
  const student = await prisma.user.findUnique({ where: { id: studentId }, select: { institutionId: true } });
  const therapist = await prisma.staffUser.findFirst({ where: { id: therapistId, role: 'THERAPIST', active: true }, select: { institutionId: true } });
  if (!student?.institutionId || !therapist || therapist.institutionId !== student.institutionId) throw err('That counsellor is not available.', 404);
  if (!(await linked(studentId, therapistId))) throw err('You can message a counsellor once you have a request or session with them.', 403);
  const t = await prisma.chatThread.upsert({
    where: { studentId_therapistId: { studentId, therapistId } },
    create: { studentId, therapistId, institutionId: student.institutionId },
    update: {}, select: { id: true },
  });
  return { threadId: t.id };
}

/** Opens (or returns) a thread from one of the counsellor's appointments or visible requests. */
export async function openAsTherapist(staffId: string, institutionId: string, ref: { appointmentId?: unknown; requestId?: unknown }) {
  let studentId: string | null = null;
  if (typeof ref.appointmentId === 'string') {
    const a = await prisma.appointment.findFirst({ where: { id: ref.appointmentId, therapistId: staffId }, select: { studentId: true } });
    studentId = a?.studentId ?? null;
  } else if (typeof ref.requestId === 'string') {
    const r = await prisma.sessionRequest.findFirst({
      where: { id: ref.requestId, institutionId, OR: [{ preferredTherapistId: staffId }, { handledById: staffId }, { preferredTherapistId: null }] },
      select: { studentId: true, preferredTherapistId: true, handledById: true, id: true },
    });
    if (r && !r.preferredTherapistId && !r.handledById) {
      // Picking up an unaddressed request by messaging the student makes you its handler, so the link is explicit.
      await prisma.sessionRequest.updateMany({ where: { id: r.id, handledById: null }, data: { handledById: staffId } });
    }
    studentId = r?.studentId ?? null;
  } else {
    throw err('appointmentId or requestId is required.');
  }
  if (!studentId) throw err('Not found.', 404);
  const t = await prisma.chatThread.upsert({
    where: { studentId_therapistId: { studentId, therapistId: staffId } },
    create: { studentId, therapistId: staffId, institutionId },
    update: {}, select: { id: true },
  });
  publish({ role: 'STUDENT', id: studentId }, { type: 'thread', threadId: t.id });
  return { threadId: t.id };
}

/** How the counsellor sees the student: details from a request made to them, else the staff pseudonym. */
async function studentLabels(therapistId: string, studentIds: string[]) {
  const [requests, users] = await Promise.all([
    prisma.sessionRequest.findMany({
      where: { studentId: { in: studentIds }, OR: [{ preferredTherapistId: therapistId }, { handledById: therapistId }] },
      orderBy: { createdAt: 'desc' }, select: { studentId: true, rollNumber: true, branch: true },
    }),
    prisma.user.findMany({ where: { id: { in: studentIds } }, select: { id: true, pseudonym: true } }),
  ]);
  const out = new Map<string, { title: string; subtitle: string | null }>();
  for (const u of users) out.set(u.id, { title: u.pseudonym ?? 'Student', subtitle: null });
  for (const r of [...requests].reverse()) out.set(r.studentId, { title: `Roll ${r.rollNumber}`, subtitle: r.branch });
  return out;
}

export async function listThreads(p: ChatPrincipal) {
  const threads = await prisma.chatThread.findMany({
    where: p.role === 'STUDENT' ? { studentId: p.id } : { therapistId: p.id },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 100,
    include: {
      therapist: { select: { displayName: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  const labels = p.role === 'THERAPIST' ? await studentLabels(p.id, threads.map(t => t.studentId)) : null;
  return Promise.all(threads.map(async t => {
    const myRead = p.role === 'STUDENT' ? t.studentLastReadAt : t.therapistLastReadAt;
    const otherRole = p.role === 'STUDENT' ? 'THERAPIST' : 'STUDENT';
    const unread = await prisma.chatMessage.count({ where: { threadId: t.id, senderRole: otherRole, ...(myRead ? { createdAt: { gt: myRead } } : {}) } });
    const last = t.messages[0];
    const label = p.role === 'STUDENT'
      ? { title: t.therapist.displayName, subtitle: 'Counsellor' }
      : labels!.get(t.studentId) ?? { title: 'Student', subtitle: null };
    return {
      id: t.id, ...label,
      counterpartId: p.role === 'STUDENT' ? t.therapistId : null,
      lastMessage: last ? { from: last.senderRole, body: decrypt(last).slice(0, 140), createdAt: last.createdAt.toISOString() } : null,
      lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
      unread,
      ...(p.role === 'THERAPIST' ? { urgent: !!t.urgentAt } : {}),
    };
  }));
}

/** Counsellors the student may message, with their existing thread id if there is one. */
export async function chatContacts(studentId: string) {
  const user = await prisma.user.findUnique({ where: { id: studentId }, select: { institutionId: true } });
  if (!user?.institutionId) return [];
  const counsellors = await prisma.staffUser.findMany({
    where: { institutionId: user.institutionId, role: 'THERAPIST', active: true }, orderBy: { displayName: 'asc' },
    select: { id: true, displayName: true },
  });
  const threads = await prisma.chatThread.findMany({ where: { studentId }, select: { id: true, therapistId: true } });
  const out = [];
  for (const c of counsellors) {
    const thread = threads.find(t => t.therapistId === c.id);
    if (thread || await linked(studentId, c.id)) out.push({ therapistId: c.id, name: c.displayName, threadId: thread?.id ?? null });
  }
  return out;
}

// ───────────────────────────── messages ─────────────────────────────

export async function getMessages(p: ChatPrincipal, threadId: string, before?: unknown) {
  const t = await prisma.chatThread.findFirst({
    where: { id: threadId, ...(p.role === 'STUDENT' ? { studentId: p.id } : { therapistId: p.id }) },
    include: { therapist: { select: { displayName: true } } },
  });
  if (!t) throw err('Conversation not found.', 404);
  const cursor = typeof before === 'string' && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  const rows = await prisma.chatMessage.findMany({
    where: { threadId, ...(cursor ? { createdAt: { lt: cursor } } : {}) },
    orderBy: { createdAt: 'desc' }, take: PAGE + 1,
  });
  const page = rows.slice(0, PAGE).reverse();
  const labels = p.role === 'THERAPIST' ? (await studentLabels(p.id, [t.studentId])).get(t.studentId) : null;
  return {
    thread: {
      id: t.id,
      title: p.role === 'STUDENT' ? t.therapist.displayName : labels?.title ?? 'Student',
      subtitle: p.role === 'STUDENT' ? 'Counsellor' : labels?.subtitle ?? null,
      // When the other side last read: lets the client show "Seen".
      otherLastReadAt: (p.role === 'STUDENT' ? t.therapistLastReadAt : t.studentLastReadAt)?.toISOString() ?? null,
      ...(p.role === 'THERAPIST' ? { urgent: !!t.urgentAt } : {}),
    },
    messages: page.map(m => toMessage(m, p.role)),
    hasMore: rows.length > PAGE,
  };
}

function rateLimited(p: ChatPrincipal): boolean {
  const key = `${p.role}:${p.id}`;
  const now = Date.now();
  const recent = (sent.get(key) ?? []).filter(t => now - t < 60_000);
  if (recent.length >= RATE_LIMIT) { sent.set(key, recent); return true; }
  recent.push(now);
  sent.set(key, recent);
  return false;
}

export async function sendMessage(p: ChatPrincipal, threadId: string, bodyRaw: unknown, clientIdRaw: unknown) {
  const t = await threadFor(p, threadId);
  const body = typeof bodyRaw === 'string' ? bodyRaw.replace(/\r\n/g, '\n').trim() : '';
  if (!body) throw err('Write a message first.');
  if (body.length > MAX_BODY) throw err(`Keep messages under ${MAX_BODY} characters.`);
  const clientId = typeof clientIdRaw === 'string' && /^[\w-]{8,64}$/.test(clientIdRaw) ? clientIdRaw : null;

  // A resend of something already stored (e.g. after a dropped connection) returns the original.
  if (clientId) {
    const existing = await prisma.chatMessage.findUnique({ where: { threadId_clientId: { threadId, clientId } } });
    if (existing) return { message: toMessage(existing, p.role), safety: null };
  }
  if (rateLimited(p)) throw err('You are sending messages too quickly. Wait a moment.', 429);

  // Crisis phrases in a student message: flag the thread for the counsellor and show the student helplines.
  const urgent = p.role === 'STUDENT' && triageStableUtterance(body).level === 'URGENT';
  const now = new Date();
  const row = await prisma.$transaction(async tx => {
    const m = await tx.chatMessage.create({ data: { threadId, senderRole: p.role, clientId, flagged: urgent, createdAt: now, ...seal(body) } });
    await tx.chatThread.update({
      where: { id: threadId },
      data: {
        lastMessageAt: now,
        ...(p.role === 'STUDENT' ? { studentLastReadAt: now } : { therapistLastReadAt: now }),
        ...(urgent ? { urgentAt: now } : {}),
      },
    });
    return m;
  });
  const other = counterpart(p, t);
  publish(p, { type: 'message', threadId, message: toMessage(row, p.role) }); // the sender's other devices
  publish(other, { type: 'message', threadId, message: toMessage(row, other.role) });
  return { message: toMessage(row, p.role), safety: urgent ? 'URGENT' as const : null };
}

export async function markRead(p: ChatPrincipal, threadId: string) {
  const t = await threadFor(p, threadId);
  const at = new Date();
  await prisma.chatThread.update({
    where: { id: threadId },
    data: p.role === 'STUDENT' ? { studentLastReadAt: at } : { therapistLastReadAt: at, urgentAt: null },
  });
  publish(counterpart(p, t), { type: 'read', threadId, by: p.role, at: at.toISOString() });
  return { ok: true, at: at.toISOString() };
}

/** Total unread across threads, for badges. */
export async function unreadTotal(p: ChatPrincipal) {
  const threads = await listThreads(p);
  return threads.reduce((n, t) => n + t.unread, 0);
}
