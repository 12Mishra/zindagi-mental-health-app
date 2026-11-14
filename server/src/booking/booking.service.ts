import { randomInt } from 'node:crypto';
import { prisma } from '../db';
import type { ConsentScope, Topic } from '../generated/prisma/client';
import { buildBrief } from './brief';

export class BookingError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export const SCOPES: readonly ConsentScope[] = ['BRIEF', 'IDENTITY', 'CONTACT'];
export const TOPICS: readonly Topic[] = ['ACADEMIC', 'ANXIETY', 'RELATIONSHIPS', 'FINANCIAL', 'FAMILY', 'SLEEP', 'CAREER', 'HEALTH', 'OTHER'];
export const isScope = (v: unknown): v is ConsentScope => typeof v === 'string' && (SCOPES as readonly string[]).includes(v);
export const isTopic = (v: unknown): v is Topic => typeof v === 'string' && (TOPICS as readonly string[]).includes(v);

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newSessionCode = () => 'ZK-' + Array.from({ length: 4 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

async function studentInstitution(studentId: string): Promise<string> {
  const user = await prisma.user.findUnique({ where: { id: studentId }, select: { institutionId: true } });
  if (!user?.institutionId) throw new BookingError('Your account is not linked to an institution with counselling.', 403);
  return user.institutionId;
}

/** Brief built only from data the student consented to share; stored as a frozen snapshot. */
export async function generateBrief(appointmentId: string, studentId: string, reason: Topic | null) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [checkins, conversations, risk] = await Promise.all([
    prisma.moodCheckin.findMany({ where: { userId: studentId, createdAt: { gte: since } }, orderBy: { createdAt: 'asc' }, select: { score: true } }),
    prisma.conversation.findMany({ where: { userId: studentId, createdAt: { gte: since } }, select: { topics: true } }),
    prisma.riskHistory.findMany({ where: { userId: studentId, createdAt: { gte: since } }, select: { level: true } }),
  ]);
  const content = buildBrief({
    reason, scoresOldestFirst: checkins.map(c => c.score),
    topics: conversations.flatMap(c => c.topics), risk: risk.map(r => r.level),
  });
  await prisma.careBrief.upsert({
    where: { appointmentId },
    create: { appointmentId, content: content as object, generator: 'fallback' },
    update: { content: content as object, generator: 'fallback', generatedAt: new Date() },
  });
}

export async function listOpenSlots(studentId: string) {
  const institutionId = await studentInstitution(studentId);
  const slots = await prisma.availabilitySlot.findMany({
    where: { status: 'OPEN', startsAt: { gt: new Date() }, therapist: { institutionId, active: true } },
    orderBy: { startsAt: 'asc' }, take: 100,
    include: { therapist: { select: { id: true, displayName: true, profile: { select: { languages: true, specialties: true, bio: true } } } } },
  });
  return slots.map(s => ({
    id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, mode: s.mode,
    therapist: { id: s.therapist.id, name: s.therapist.displayName, ...s.therapist.profile },
  }));
}

export type BookInput = { slotId: string; reason: Topic | null; consents: ConsentScope[]; alertId?: string };

/** Atomic: the conditional slot update lets exactly one of two concurrent bookings succeed. */
export async function bookSlot(studentId: string, input: BookInput) {
  const institutionId = await studentInstitution(studentId);
  if (input.alertId) {
    const alert = await prisma.alert.findFirst({ where: { id: input.alertId, institutionId, subjectUserId: studentId }, select: { id: true } });
    if (!alert) throw new BookingError('Unknown alert.', 400);
  }
  const upcoming = await prisma.appointment.count({ where: { studentId, status: 'CONFIRMED', slot: { startsAt: { gt: new Date() } } } });
  if (upcoming >= 2) throw new BookingError('You already have two upcoming sessions.', 409);

  const appointmentId = await prisma.$transaction(async tx => {
    const claimed = await tx.availabilitySlot.updateMany({
      where: { id: input.slotId, status: 'OPEN', startsAt: { gt: new Date() }, therapist: { institutionId, active: true } },
      data: { status: 'BOOKED' },
    });
    if (claimed.count !== 1) throw new BookingError('That slot is no longer available.', 409);
    const slot = await tx.availabilitySlot.findUniqueOrThrow({ where: { id: input.slotId }, select: { therapistId: true } });
    for (let attempt = 0; ; attempt++) {
      try {
        const created = await tx.appointment.create({
          data: {
            slotId: input.slotId, studentId, therapistId: slot.therapistId, institutionId, sessionCode: newSessionCode(),
            reason: input.reason, alertId: input.alertId ?? null,
            consents: { create: [...new Set(input.consents)].map(scope => ({ scope })) },
          },
          select: { id: true },
        });
        return created.id;
      } catch (error) {
        if (attempt < 5 && error instanceof Error && /Unique constraint|P2002/.test(error.message)) continue;
        throw error;
      }
    }
  });
  if (input.consents.includes('BRIEF')) await generateBrief(appointmentId, studentId, input.reason);
  return getStudentAppointment(studentId, appointmentId);
}

const appointmentSelect = {
  id: true, status: true, sessionCode: true, reason: true, createdAt: true,
  slot: { select: { startsAt: true, endsAt: true, mode: true } },
  therapist: { select: { displayName: true } },
  consents: { where: { revokedAt: null }, select: { scope: true } },
} as const;

type AppointmentRow = {
  id: string; status: string; sessionCode: string; reason: Topic | null;
  slot: { startsAt: Date; endsAt: Date; mode: string }; therapist: { displayName: string }; consents: Array<{ scope: ConsentScope }>;
};

const shape = (a: AppointmentRow) => ({
  id: a.id, status: a.status, sessionCode: a.sessionCode, reason: a.reason, startsAt: a.slot.startsAt, endsAt: a.slot.endsAt,
  mode: a.slot.mode, therapistName: a.therapist.displayName, consents: a.consents.map(c => c.scope),
});

export async function getStudentAppointment(studentId: string, id: string) {
  const a = await prisma.appointment.findFirst({ where: { id, studentId }, select: appointmentSelect });
  if (!a) throw new BookingError('Appointment not found.', 404);
  return shape(a);
}

export async function listStudentAppointments(studentId: string) {
  const rows = await prisma.appointment.findMany({ where: { studentId }, orderBy: { slot: { startsAt: 'desc' } }, take: 50, select: appointmentSelect });
  return rows.map(shape);
}

export async function cancelAsStudent(studentId: string, id: string) {
  const a = await prisma.appointment.findFirst({ where: { id, studentId }, select: { id: true, status: true, slotId: true, slot: { select: { startsAt: true } } } });
  if (!a) throw new BookingError('Appointment not found.', 404);
  if (a.status !== 'CONFIRMED') throw new BookingError('Only confirmed appointments can be cancelled.', 409);
  await prisma.$transaction([
    prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED_STUDENT' } }),
    // A cancelled future slot returns to the pool; a past one just stays booked history.
    ...(a.slot.startsAt > new Date() ? [prisma.availabilitySlot.update({ where: { id: a.slotId }, data: { status: 'OPEN' as const } })] : []),
  ]);
  return getStudentAppointment(studentId, id);
}

/** Grants or revokes one scope. Revoking BRIEF hides the brief at read time; the snapshot stays but is never served. */
export async function setConsent(studentId: string, id: string, scope: ConsentScope, granted: boolean) {
  const a = await prisma.appointment.findFirst({ where: { id, studentId }, select: { id: true, status: true, reason: true } });
  if (!a) throw new BookingError('Appointment not found.', 404);
  if (a.status !== 'CONFIRMED' && !(a.status === 'COMPLETED' && !granted)) throw new BookingError('Consent can only change for a confirmed session.', 409);
  if (granted) {
    await prisma.consentGrant.upsert({
      where: { appointmentId_scope: { appointmentId: id, scope } },
      create: { appointmentId: id, scope }, update: { revokedAt: null, grantedAt: new Date() },
    });
    if (scope === 'BRIEF') await generateBrief(id, studentId, a.reason);
  } else {
    await prisma.consentGrant.updateMany({ where: { appointmentId: id, scope, revokedAt: null }, data: { revokedAt: new Date() } });
  }
  return getStudentAppointment(studentId, id);
}

export async function listOutreach(studentId: string) {
  return prisma.outreach.findMany({
    where: { userId: studentId, dismissedAt: null }, orderBy: { createdAt: 'desc' }, take: 20,
    select: { id: true, message: true, createdAt: true, seenAt: true, alertId: true },
  });
}

export async function updateOutreach(studentId: string, id: string, action: 'seen' | 'dismiss') {
  const data = action === 'seen' ? { seenAt: new Date() } : { dismissedAt: new Date() };
  const { count } = await prisma.outreach.updateMany({ where: { id, userId: studentId }, data });
  if (!count) throw new BookingError('Not found.', 404);
}
