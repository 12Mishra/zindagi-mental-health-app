import { Router, type NextFunction, type Request, type Response } from 'express';
import { prisma } from '../db';
import type { AppointmentStatus, SessionMode } from '../generated/prisma/client';
import { requireStaff, staffOf } from '../staff/staff.middleware';
import { open, seal } from './crypto';

/**
 * Therapist API. Every query is scoped to the signed-in therapist, so another therapist's
 * appointment id simply matches nothing (404). Brief and identity are served only while the
 * student's matching consent is active.
 */
export const therapistRouter = Router();
therapistRouter.use(requireStaff('THERAPIST'));

const MODES: readonly SessionMode[] = ['IN_PERSON', 'PHONE', 'VIDEO'];
const NEXT_STATUS: readonly AppointmentStatus[] = ['COMPLETED', 'NO_SHOW', 'CANCELLED_THERAPIST'];
const MAX_NOTE = 8000;

const guard = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

const dateParam = (value: unknown): Date | undefined =>
  typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value) : undefined;

type ConsentRow = { scope: string; revokedAt: Date | null };
const consentFlags = (rows: ConsentRow[]) => {
  const active = new Set(rows.filter(r => !r.revokedAt).map(r => r.scope));
  return { brief: active.has('BRIEF'), identity: active.has('IDENTITY'), contact: active.has('CONTACT') };
};

const appointmentInclude = {
  slot: { select: { startsAt: true, endsAt: true, mode: true } },
  student: { select: { pseudonym: true } },
  consents: { select: { scope: true, revokedAt: true } },
} as const;

type AppointmentWith = {
  id: string; sessionCode: string; reason: string | null; status: AppointmentStatus;
  slot: { startsAt: Date; endsAt: Date; mode: SessionMode }; student: { pseudonym: string | null }; consents: ConsentRow[];
};

const toAppointment = (a: AppointmentWith) => ({
  id: a.id, sessionCode: a.sessionCode, pseudonym: a.student.pseudonym ?? '#—', startsAt: a.slot.startsAt.toISOString(),
  endsAt: a.slot.endsAt.toISOString(), mode: a.slot.mode, reason: a.reason, status: a.status, consent: consentFlags(a.consents),
});

therapistRouter.get('/appointments', guard(async (req, res) => {
  const { staffId } = staffOf(req);
  const from = dateParam(req.query.from);
  const to = dateParam(req.query.to);
  const rows = await prisma.appointment.findMany({
    where: { therapistId: staffId, ...(from || to ? { slot: { startsAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } } : {}) },
    orderBy: { slot: { startsAt: 'asc' } }, take: 200, include: appointmentInclude,
  });
  res.json(rows.map(toAppointment));
}));

therapistRouter.get('/appointments/:id', guard(async (req, res) => {
  const staff = staffOf(req);
  const a = await prisma.appointment.findFirst({
    where: { id: String(req.params.id), therapistId: staff.staffId },
    include: { ...appointmentInclude, brief: true, student: { select: { pseudonym: true, fullName: true, phoneNumber: true } } },
  });
  if (!a) { res.status(404).json({ error: 'Appointment not found.' }); return; }
  const consent = consentFlags(a.consents);

  let identity: { name: string; phone?: string } | null = null;
  if (consent.identity) {
    identity = { name: a.student.fullName, ...(consent.contact ? { phone: a.student.phoneNumber } : {}) };
    await prisma.auditLog.create({ data: { actorId: staff.staffId, actorRole: 'THERAPIST', action: 'identity.reveal', targetType: 'Appointment', targetId: a.id } });
  }
  const notes = await prisma.therapistNote.findMany({ where: { appointmentId: a.id, authorId: staff.staffId }, orderBy: { createdAt: 'asc' } });
  res.json({
    appointment: toAppointment(a),
    brief: consent.brief && a.brief ? a.brief.content : null,
    identity,
    notes: notes.map(n => ({ id: n.id, createdAt: n.createdAt.toISOString(), text: open({ ciphertext: n.ciphertext, iv: n.iv, tag: n.tag }) })),
  });
}));

therapistRouter.patch('/appointments/:id', guard(async (req, res) => {
  const { staffId, institutionId } = staffOf(req);
  const status = req.body?.status as AppointmentStatus | undefined;
  if (!status || !NEXT_STATUS.includes(status)) { res.status(400).json({ error: `status must be one of ${NEXT_STATUS.join(', ')}.` }); return; }
  const a = await prisma.appointment.findFirst({ where: { id: String(req.params.id), therapistId: staffId }, select: { id: true, status: true, slotId: true, alertId: true, slot: { select: { startsAt: true } } } });
  if (!a) { res.status(404).json({ error: 'Appointment not found.' }); return; }
  if (a.status !== 'CONFIRMED') { res.status(409).json({ error: 'Only confirmed appointments can change status.' }); return; }

  await prisma.$transaction(async tx => {
    await tx.appointment.update({ where: { id: a.id }, data: { status } });
    // A therapist cancelling a future session takes that slot off the market rather than reopening it.
    if (status === 'CANCELLED_THERAPIST' && a.slot.startsAt > new Date()) {
      await tx.availabilitySlot.update({ where: { id: a.slotId }, data: { status: 'REMOVED' } });
    }
  });
  // Completing the session that came from an alert closes that alert.
  if (status === 'COMPLETED' && a.alertId) {
    await prisma.alert.updateMany({ where: { id: a.alertId, institutionId, status: { not: 'RESOLVED' } }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  }
  res.json({ ok: true, status });
}));

therapistRouter.post('/appointments/:id/notes', guard(async (req, res) => {
  const { staffId } = staffOf(req);
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
  if (!text || text.length > MAX_NOTE) { res.status(400).json({ error: `text is required and at most ${MAX_NOTE} characters.` }); return; }
  const a = await prisma.appointment.findFirst({ where: { id: String(req.params.id), therapistId: staffId }, select: { id: true } });
  if (!a) { res.status(404).json({ error: 'Appointment not found.' }); return; }
  const note = await prisma.therapistNote.create({ data: { appointmentId: a.id, authorId: staffId, ...seal(text) } });
  res.status(201).json({ id: note.id, createdAt: note.createdAt.toISOString(), text });
}));

therapistRouter.get('/slots', guard(async (req, res) => {
  const { staffId } = staffOf(req);
  const from = dateParam(req.query.from) ?? new Date(Date.now() - 86_400_000);
  const to = dateParam(req.query.to) ?? new Date(Date.now() + 28 * 86_400_000);
  const rows = await prisma.availabilitySlot.findMany({
    where: { therapistId: staffId, status: { not: 'REMOVED' }, startsAt: { gte: from, lt: to } },
    orderBy: { startsAt: 'asc' }, take: 500,
    include: { appointments: { where: { status: 'CONFIRMED' }, select: { student: { select: { pseudonym: true } } }, take: 1 } },
  });
  res.json(rows.map(s => ({
    id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), mode: s.mode, status: s.status,
    ...(s.appointments[0]?.student.pseudonym ? { pseudonym: s.appointments[0].student.pseudonym } : {}),
  })));
}));

therapistRouter.post('/slots', guard(async (req, res) => {
  const { staffId } = staffOf(req);
  const startsAt = dateParam(req.body?.startsAt);
  const endsAt = dateParam(req.body?.endsAt);
  const mode: SessionMode = MODES.includes(req.body?.mode) ? req.body.mode : 'IN_PERSON';
  if (!startsAt || !endsAt || endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 4 * 3_600_000 || startsAt <= new Date()) {
    res.status(400).json({ error: 'startsAt and endsAt must be future ISO times, end after start, at most 4 hours apart.' }); return;
  }
  const clash = await prisma.availabilitySlot.findFirst({ where: { therapistId: staffId, status: { not: 'REMOVED' }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } }, select: { id: true } });
  if (clash) { res.status(409).json({ error: 'This overlaps an existing slot.' }); return; }
  const slot = await prisma.availabilitySlot.create({ data: { therapistId: staffId, startsAt, endsAt, mode } });
  res.status(201).json({ id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), mode: slot.mode, status: slot.status });
}));

therapistRouter.delete('/slots/:id', guard(async (req, res) => {
  const { staffId } = staffOf(req);
  // Only an unbooked slot can be removed; a booked one must be cancelled via its appointment.
  const { count } = await prisma.availabilitySlot.updateMany({ where: { id: String(req.params.id), therapistId: staffId, status: 'OPEN' }, data: { status: 'REMOVED' } });
  if (!count) { res.status(409).json({ error: 'Slot not found or already booked.' }); return; }
  res.json({ ok: true });
}));
