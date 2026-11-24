import { prisma } from '../db';
import type { SessionMode, SessionRequestStatus } from '../generated/prisma/client';
import { BookingError, createAppointmentRow, getStudentAppointment, studentInstitution } from './booking.service';
import { futureWindows, HORIZON_DAYS, HOUR_MS, overlaps, parseStudentDetails, parseWindows, windowProblem } from './windows';

/**
 * Session requests: the in-app version of the counselling cell's request form.
 *
 * A student either books a counsellor's published open slot straight away, or sends a request with the
 * one-hour windows they can make (optionally naming a counsellor). A counsellor then confirms one of
 * those windows, proposes another time (the student accepts or offers new windows), passes it to the
 * other counsellors, or declines it. Confirming always produces an ordinary Appointment, so everything
 * downstream (today list, notes, status) is shared with direct bookings.
 *
 * Nothing here records what the student wants to talk about; that happens in person.
 */

const MODES: readonly SessionMode[] = ['IN_PERSON', 'PHONE', 'VIDEO'];
const OPEN_STATES: SessionRequestStatus[] = ['PENDING', 'PROPOSED'];
const MAX_NOTE = 280;
const MAX_UPCOMING = 2;

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

const err = (message: string, status = 400) => new BookingError(message, status);
const asMode = (v: unknown): SessionMode => (MODES.includes(v as SessionMode) ? (v as SessionMode) : 'IN_PERSON');

function parse<T>(run: () => T): T {
  try { return run(); } catch (e) { throw err(e instanceof Error ? e.message : 'Invalid request.'); }
}

function cleanNote(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') throw err('note must be text.');
  const t = v.trim();
  if (t.length > MAX_NOTE) throw err(`Keep the note under ${MAX_NOTE} characters.`);
  return t || null;
}

/**
 * Books `therapistId` for the hour starting at `startsAt`, inside `tx`. Reuses their published open slot
 * at that time when there is one; otherwise creates an unpublished booked slot. Refuses a clash.
 */
async function claimHour(tx: Tx, therapistId: string, startsAt: Date, mode: SessionMode): Promise<string> {
  const endsAt = new Date(startsAt.getTime() + HOUR_MS);
  const open = await tx.availabilitySlot.findFirst({ where: { therapistId, status: 'OPEN', startsAt }, select: { id: true } });
  if (open) {
    const claimed = await tx.availabilitySlot.updateMany({ where: { id: open.id, status: 'OPEN' }, data: { status: 'BOOKED', mode } });
    if (claimed.count === 1) return open.id;
  }
  const clash = await tx.availabilitySlot.findFirst({
    where: { therapistId, status: 'BOOKED', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { id: true },
  });
  if (clash) throw err('That time is already booked for this counsellor.', 409);
  // An OPEN slot that overlaps without starting on the hour would now be double-booked: take it off the market.
  await tx.availabilitySlot.updateMany({
    where: { therapistId, status: 'OPEN', startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, data: { status: 'REMOVED' },
  });
  const slot = await tx.availabilitySlot.create({ data: { therapistId, startsAt, endsAt, mode, status: 'BOOKED', published: false } });
  return slot.id;
}

async function assertCanBook(studentId: string) {
  const upcoming = await prisma.appointment.count({ where: { studentId, status: 'CONFIRMED', slot: { startsAt: { gt: new Date() } } } });
  if (upcoming >= MAX_UPCOMING) throw err('You already have two upcoming sessions.', 409);
}

/** Turns a request into an appointment. `from` guards the status so concurrent actions resolve to one winner. */
async function confirm(requestId: string, from: SessionRequestStatus[], therapistId: string, startsAt: Date) {
  return prisma.$transaction(async tx => {
    const req = await tx.sessionRequest.findUnique({ where: { id: requestId } });
    if (!req || !from.includes(req.status)) throw err('This request has already been handled.', 409);
    const slotId = await claimHour(tx, therapistId, startsAt, req.mode);
    const appointmentId = await createAppointmentRow(tx, { slotId, studentId: req.studentId, therapistId, institutionId: req.institutionId });
    const done = await tx.sessionRequest.updateMany({
      where: { id: requestId, status: { in: from } },
      data: { status: 'CONFIRMED', appointmentId, handledById: therapistId, proposedStartsAt: null },
    });
    if (done.count !== 1) throw err('This request has already been handled.', 409);
    return appointmentId;
  });
}

/** Lazily retires requests whose times have all passed. Cheap enough to run on every read. */
async function expireStale(where: { studentId?: string; institutionId?: string }) {
  const now = new Date();
  const rows = await prisma.sessionRequest.findMany({
    where: { ...where, status: { in: OPEN_STATES } }, select: { id: true, status: true, windows: true, proposedStartsAt: true },
  });
  for (const r of rows) {
    const windowsLeft = futureWindows(r.windows, now).length > 0;
    if (r.status === 'PENDING' && !windowsLeft) {
      await prisma.sessionRequest.updateMany({ where: { id: r.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    } else if (r.status === 'PROPOSED' && r.proposedStartsAt && r.proposedStartsAt <= now) {
      await prisma.sessionRequest.updateMany({
        where: { id: r.id, status: 'PROPOSED' },
        data: windowsLeft ? { status: 'PENDING', proposedStartsAt: null } : { status: 'EXPIRED' },
      });
    }
  }
}

// ───────────────────────────── student side ─────────────────────────────

/** Counsellors, their published open slots, and the hours they are already booked (no student details). */
export async function getAvailability(studentId: string) {
  const institutionId = await studentInstitution(studentId);
  const now = new Date();
  const until = new Date(now.getTime() + HORIZON_DAYS * 86_400_000);
  const [counsellors, slots] = await Promise.all([
    prisma.staffUser.findMany({
      where: { institutionId, role: 'THERAPIST', active: true }, orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, profile: { select: { languages: true, bio: true } } },
    }),
    prisma.availabilitySlot.findMany({
      where: { status: { in: ['OPEN', 'BOOKED'] }, startsAt: { gt: now, lt: until }, therapist: { institutionId, active: true } },
      orderBy: { startsAt: 'asc' }, take: 1000,
      select: { id: true, therapistId: true, startsAt: true, endsAt: true, mode: true, status: true },
    }),
  ]);
  return {
    counsellors: counsellors.map(c => ({ id: c.id, name: c.displayName, languages: c.profile?.languages ?? [], bio: c.profile?.bio ?? null })),
    // Only hour-aligned office-hours slots can be booked from the app grid.
    openSlots: slots.filter(s => s.status === 'OPEN' && !windowProblem(s.startsAt, now))
      .map(s => ({ id: s.id, therapistId: s.therapistId, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), mode: s.mode })),
    busy: slots.filter(s => s.status === 'BOOKED')
      .map(s => ({ therapistId: s.therapistId, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() })),
  };
}

const studentSelect = {
  id: true, status: true, rollNumber: true, branch: true, mode: true, windows: true, proposedStartsAt: true,
  counsellorNote: true, appointmentId: true, createdAt: true, updatedAt: true,
  preferredTherapist: { select: { id: true, displayName: true } },
  handledBy: { select: { displayName: true } },
} as const;

type StudentRow = {
  id: string; status: SessionRequestStatus; rollNumber: string; branch: string; mode: SessionMode; windows: Date[];
  proposedStartsAt: Date | null; counsellorNote: string | null; appointmentId: string | null; createdAt: Date; updatedAt: Date;
  preferredTherapist: { id: string; displayName: string } | null; handledBy: { displayName: string } | null;
};

const toStudent = (r: StudentRow) => ({
  id: r.id, status: r.status, rollNumber: r.rollNumber, branch: r.branch, mode: r.mode,
  windows: r.windows.map(w => w.toISOString()),
  counsellor: r.preferredTherapist ? { id: r.preferredTherapist.id, name: r.preferredTherapist.displayName } : null,
  handledBy: r.handledBy?.displayName ?? null,
  proposedStartsAt: r.proposedStartsAt?.toISOString() ?? null,
  counsellorNote: r.counsellorNote, appointmentId: r.appointmentId,
  createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
});

async function studentRequest(studentId: string, id: string) {
  const r = await prisma.sessionRequest.findFirst({ where: { id, studentId }, select: studentSelect });
  if (!r) throw err('Request not found.', 404);
  return toStudent(r);
}

export async function listStudentRequests(studentId: string) {
  await expireStale({ studentId });
  const rows = await prisma.sessionRequest.findMany({ where: { studentId }, orderBy: { createdAt: 'desc' }, take: 20, select: studentSelect });
  return rows.map(toStudent);
}

export type NewRequest = { rollNumber: unknown; branch: unknown; mode?: unknown; therapistId?: unknown; windows?: unknown; slotId?: unknown };

/**
 * `slotId` books a published open slot immediately (the request is stored as already confirmed, so the
 * counsellor still sees roll number and branch). Otherwise `windows` sends a request to the inbox.
 */
export async function createRequest(studentId: string, input: NewRequest) {
  const institutionId = await studentInstitution(studentId);
  const details = parse(() => parseStudentDetails(input.rollNumber, input.branch));
  const mode = asMode(input.mode);

  if (typeof input.slotId === 'string') {
    await assertCanBook(studentId);
    const slot = await prisma.availabilitySlot.findFirst({
      where: { id: input.slotId, status: 'OPEN', startsAt: { gt: new Date() }, therapist: { institutionId, active: true } },
      select: { therapistId: true, startsAt: true },
    });
    if (!slot) throw err('That slot is no longer available.', 409);
    const id = await prisma.$transaction(async tx => {
      const claimed = await tx.availabilitySlot.updateMany({ where: { id: input.slotId as string, status: 'OPEN' }, data: { status: 'BOOKED', mode } });
      if (claimed.count !== 1) throw err('That slot is no longer available.', 409);
      const appointmentId = await createAppointmentRow(tx, { slotId: input.slotId as string, studentId, therapistId: slot.therapistId, institutionId });
      const created = await tx.sessionRequest.create({
        data: {
          institutionId, studentId, ...details, mode, preferredTherapistId: slot.therapistId, windows: [slot.startsAt],
          status: 'CONFIRMED', handledById: slot.therapistId, appointmentId,
        },
        select: { id: true },
      });
      return created.id;
    });
    return studentRequest(studentId, id);
  }

  const windows = parse(() => parseWindows(input.windows));
  let preferredTherapistId: string | null = null;
  if (input.therapistId != null && input.therapistId !== '') {
    if (typeof input.therapistId !== 'string') throw err('Invalid counsellor.');
    const t = await prisma.staffUser.findFirst({ where: { id: input.therapistId, institutionId, role: 'THERAPIST', active: true }, select: { id: true } });
    if (!t) throw err('That counsellor is not available.', 400);
    preferredTherapistId = t.id;
  }
  await expireStale({ studentId });
  const waiting = await prisma.sessionRequest.count({ where: { studentId, status: { in: OPEN_STATES } } });
  if (waiting > 0) throw err('You already have a request waiting. Change or cancel it first.', 409);
  await assertCanBook(studentId);

  const created = await prisma.sessionRequest.create({
    data: { institutionId, studentId, ...details, mode, preferredTherapistId, windows },
    select: { id: true },
  });
  return studentRequest(studentId, created.id);
}

/** Accept the counsellor's proposed time, or decline it and offer new windows. */
export async function respondToProposal(studentId: string, id: string, accept: boolean, newWindows?: unknown) {
  await expireStale({ studentId });
  const r = await prisma.sessionRequest.findFirst({ where: { id, studentId }, select: { status: true, proposedStartsAt: true, handledById: true } });
  if (!r) throw err('Request not found.', 404);
  if (r.status !== 'PROPOSED' || !r.proposedStartsAt || !r.handledById) throw err('There is no proposed time to answer.', 409);

  if (accept) {
    await assertCanBook(studentId);
    const appointmentId = await confirm(id, ['PROPOSED'], r.handledById, r.proposedStartsAt);
    return { request: await studentRequest(studentId, id), appointment: await getStudentAppointment(studentId, appointmentId) };
  }
  const windows = parse(() => parseWindows(newWindows));
  const { count } = await prisma.sessionRequest.updateMany({
    where: { id, status: 'PROPOSED' }, data: { status: 'PENDING', windows, proposedStartsAt: null },
  });
  if (!count) throw err('This request has already been handled.', 409);
  return { request: await studentRequest(studentId, id), appointment: null };
}

export async function cancelStudentRequest(studentId: string, id: string) {
  const { count } = await prisma.sessionRequest.updateMany({ where: { id, studentId, status: { in: OPEN_STATES } }, data: { status: 'CANCELLED' } });
  if (!count) throw err('Only a waiting request can be cancelled.', 409);
  return studentRequest(studentId, id);
}

// ───────────────────────────── counsellor side ─────────────────────────────

/**
 * What a counsellor may see: requests addressed to them, unaddressed requests nobody has picked up yet,
 * and anything they are already handling. A request addressed to a colleague stays with that colleague.
 */
const visibleTo = (staffId: string, institutionId: string) => ({
  institutionId,
  OR: [
    { preferredTherapistId: staffId },
    { preferredTherapistId: null, status: 'PENDING' as const },
    { handledById: staffId },
  ],
});

export async function listTherapistRequests(staffId: string, institutionId: string, scope: 'open' | 'all') {
  await expireStale({ institutionId });
  const now = new Date();
  const rows = await prisma.sessionRequest.findMany({
    where: { ...visibleTo(staffId, institutionId), ...(scope === 'open' ? { status: { in: OPEN_STATES } } : {}) },
    orderBy: { createdAt: scope === 'open' ? 'asc' : 'desc' }, take: 100,
    include: { student: { select: { pseudonym: true } }, handledBy: { select: { displayName: true } } },
  });
  // The counsellor's own booked hours, to flag which of the student's windows they can actually take.
  const booked = await prisma.availabilitySlot.findMany({
    where: { therapistId: staffId, status: 'BOOKED', endsAt: { gt: now }, startsAt: { lt: new Date(now.getTime() + (HORIZON_DAYS + 1) * 86_400_000) } },
    select: { startsAt: true, endsAt: true },
  });
  return rows.map(r => ({
    id: r.id, status: r.status, rollNumber: r.rollNumber, branch: r.branch, mode: r.mode,
    pseudonym: r.student.pseudonym ?? '#—',
    addressedToMe: r.preferredTherapistId === staffId,
    handledByMe: r.handledById === staffId,
    handledBy: r.handledBy?.displayName ?? null,
    windows: futureWindows(r.windows, now).map(w => ({ startsAt: w.toISOString(), free: !booked.some(b => overlaps(w, b.startsAt, b.endsAt)) })),
    proposedStartsAt: r.proposedStartsAt?.toISOString() ?? null,
    counsellorNote: r.counsellorNote, appointmentId: r.appointmentId,
    createdAt: r.createdAt.toISOString(),
  }));
}

async function visibleRequest(staffId: string, institutionId: string, id: string) {
  const r = await prisma.sessionRequest.findFirst({ where: { id, ...visibleTo(staffId, institutionId) } });
  if (!r) throw err('Request not found.', 404);
  return r;
}

const parseStart = (v: unknown): Date => {
  const d = typeof v === 'string' ? new Date(v) : new Date(NaN);
  const problem = windowProblem(d);
  if (problem) throw err(`The time ${problem}.`);
  return d;
};

/** Confirm one of the windows the student offered. */
export async function therapistConfirm(staffId: string, institutionId: string, id: string, startsAtRaw: unknown) {
  const r = await visibleRequest(staffId, institutionId, id);
  const startsAt = parseStart(startsAtRaw);
  if (!r.windows.some(w => w.getTime() === startsAt.getTime())) throw err('Pick one of the times the student offered, or propose a new one.');
  const from: SessionRequestStatus[] = r.status === 'PROPOSED' && r.handledById === staffId ? ['PROPOSED'] : ['PENDING'];
  await assertCanBook(r.studentId);
  const appointmentId = await confirm(id, from, staffId, startsAt);
  return { appointmentId };
}

/** Suggest a different time; the student accepts it or offers new windows. */
export async function therapistPropose(staffId: string, institutionId: string, id: string, startsAtRaw: unknown, noteRaw: unknown) {
  const r = await visibleRequest(staffId, institutionId, id);
  const startsAt = parseStart(startsAtRaw);
  const note = cleanNote(noteRaw);
  const clash = await prisma.availabilitySlot.findFirst({
    where: { therapistId: staffId, status: 'BOOKED', startsAt: { lt: new Date(startsAt.getTime() + HOUR_MS) }, endsAt: { gt: startsAt } },
    select: { id: true },
  });
  if (clash) throw err('You are already booked at that time.', 409);
  const allowed: SessionRequestStatus[] = r.handledById === staffId ? OPEN_STATES : ['PENDING'];
  const { count } = await prisma.sessionRequest.updateMany({
    where: { id, status: { in: allowed } },
    data: { status: 'PROPOSED', proposedStartsAt: startsAt, handledById: staffId, counsellorNote: note },
  });
  if (!count) throw err('This request has already been handled.', 409);
  return { ok: true };
}

/** Close the request with an optional short note to the student (e.g. who to contact instead). */
export async function therapistDecline(staffId: string, institutionId: string, id: string, noteRaw: unknown) {
  await visibleRequest(staffId, institutionId, id);
  const note = cleanNote(noteRaw);
  const { count } = await prisma.sessionRequest.updateMany({
    where: { id, status: { in: OPEN_STATES } }, data: { status: 'DECLINED', handledById: staffId, counsellorNote: note, proposedStartsAt: null },
  });
  if (!count) throw err('This request has already been handled.', 409);
  return { ok: true };
}

/** Hand a request addressed to me back to the shared queue so another counsellor can take it. */
export async function therapistRelease(staffId: string, institutionId: string, id: string) {
  const r = await visibleRequest(staffId, institutionId, id);
  if (r.preferredTherapistId !== staffId && r.handledById !== staffId) throw err('Only a request addressed to you can be passed on.', 409);
  const { count } = await prisma.sessionRequest.updateMany({
    where: { id, status: { in: OPEN_STATES } },
    data: { status: 'PENDING', preferredTherapistId: null, handledById: null, proposedStartsAt: null, counsellorNote: null },
  });
  if (!count) throw err('This request has already been handled.', 409);
  return { ok: true };
}
