// Mock data layer. Phase 2 replaces the bodies of these functions with calls to core
// (CORE_API_URL); the signatures and return types stay the same.
import { dayKey } from './format';
import type { Appointment, AppointmentDetail, CareBrief, Identity, Slot } from './types';

export const THERAPIST_NAME = 'Dr. Dullat';

const IST = '+05:30';
const DAY_MS = 86_400_000;

/** YYYY-MM-DD (IST) for today + offset days. */
function istDay(offset: number): string {
  return dayKey(new Date(Date.now() + offset * DAY_MS));
}
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00${IST}`;

/** Monday (IST) of the week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00${IST}`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return dayKey(new Date(d.getTime() - dow * DAY_MS));
}
export function addDays(day: string, n: number): string {
  return dayKey(new Date(new Date(`${day}T12:00:00${IST}`).getTime() + n * DAY_MS));
}

function build(): Appointment[] {
  const today = istDay(0);
  const tomorrow = istDay(1);
  const later = istDay(3);
  return [
    {
      id: 'apt-1',
      sessionCode: 'ZK-7QF3',
      pseudonym: '#KR047',
      startsAt: at(today, '10:00'),
      endsAt: at(today, '11:00'),
      mode: 'IN_PERSON',
      reason: 'Anxiety',
      status: 'CONFIRMED',
      consent: { brief: true, identity: true, contact: true },
    },
    {
      id: 'apt-2',
      sessionCode: 'ZK-M2X9',
      pseudonym: '#TB112',
      startsAt: at(today, '14:00'),
      endsAt: at(today, '15:00'),
      mode: 'PHONE',
      reason: 'Academic',
      status: 'CONFIRMED',
      consent: { brief: true, identity: false, contact: false },
    },
    {
      id: 'apt-3',
      sessionCode: 'ZK-D84H',
      pseudonym: '#QL230',
      startsAt: at(tomorrow, '11:00'),
      endsAt: at(tomorrow, '12:00'),
      mode: 'IN_PERSON',
      reason: 'Family',
      status: 'CONFIRMED',
      consent: { brief: false, identity: false, contact: false },
    },
    {
      id: 'apt-4',
      sessionCode: 'ZK-P5W1',
      pseudonym: '#KR047',
      startsAt: at(later, '15:00'),
      endsAt: at(later, '16:00'),
      mode: 'IN_PERSON',
      reason: null,
      status: 'CONFIRMED',
      consent: { brief: true, identity: true, contact: false },
    },
  ];
}

const BRIEFS: Record<string, CareBrief> = {
  'apt-1': {
    presenting:
      'Persistent worry before exams, with trouble falling asleep on the nights before deadlines.',
    themes: ['Exam anxiety', 'Sleep', 'Perfectionism'],
    moodTrend: 'improving',
    moodSeries: [4, 4, 5, 4, 6, 6, 7],
    riskLevels: ['LOW', 'ELEVATED', 'LOW'],
    whatHelped: ['Paced breathing before study blocks', 'Short evening walks', 'Talking with a hostel friend'],
    openThreads: ['Upcoming viva on Friday', 'Unsure how to tell family about a lower grade'],
    caution:
      'This summary is AI-generated from conversations the student chose to share. Use it as a starting point and ask the student directly.',
  },
  'apt-2': {
    presenting: 'Feeling behind in two courses and unsure whether to drop one.',
    themes: ['Workload', 'Motivation'],
    moodTrend: 'declining',
    moodSeries: [7, 6, 6, 5, 5, 4, 4],
    riskLevels: ['ELEVATED', 'ELEVATED'],
    whatHelped: ['Writing a weekly plan', 'Study group on Sundays'],
    openThreads: ['Deadline to withdraw from a course is next week'],
    caution:
      'Mood has dipped over the last two weeks. This summary is AI-generated and may miss context; check in gently.',
  },
  'apt-4': {
    presenting: 'Follow-up on sleep and routine after the first session.',
    themes: ['Sleep', 'Routine'],
    moodTrend: 'stable',
    moodSeries: [5, 6, 5, 5, 6, 5, 6],
    riskLevels: ['LOW'],
    whatHelped: ['Fixed wake-up time'],
    openThreads: [],
    caution: 'This summary is AI-generated and may be incomplete.',
  },
};

// Clearly fake identities.
const IDENTITIES: Record<string, Identity> = {
  'apt-1': { name: 'Test Student One', phone: '+91 00000 00001' },
  'apt-4': { name: 'Test Student One' },
};

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export async function getAppointments(): Promise<Appointment[]> {
  await wait();
  return build().sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

export async function getAppointment(id: string): Promise<AppointmentDetail | null> {
  await wait();
  const appointment = build().find((a) => a.id === id);
  if (!appointment) return null;
  return {
    appointment,
    brief: appointment.consent.brief ? (BRIEFS[id] ?? null) : null,
    identity: appointment.consent.identity ? (IDENTITIES[id] ?? null) : null,
    notes:
      id === 'apt-1'
        ? []
        : id === 'apt-4'
          ? [
              {
                id: 'n-1',
                createdAt: at(istDay(-7), '16:20'),
                text: 'First session. Built rapport; agreed to try a fixed wake-up time.',
              },
            ]
          : [],
  };
}

/** Mon–Fri, hourly 10:00–16:00 for the week starting on `weekStart` (a Monday, YYYY-MM-DD). */
export async function getSlots(weekStart: string): Promise<Slot[]> {
  await wait(150);
  const booked = new Map(build().map((a) => [`${dayKey(a.startsAt)}T${a.startsAt.slice(11, 16)}`, a.pseudonym]));
  const slots: Slot[] = [];
  for (let d = 0; d < 5; d++) {
    const day = addDays(weekStart, d);
    for (let h = 10; h <= 16; h++) {
      const hh = String(h).padStart(2, '0');
      const key = `${day}T${hh}:00`;
      const pseudonym = booked.get(key);
      const removed = h === 13 || (d === 4 && h >= 15);
      slots.push({
        id: `slot-${day}-${hh}`,
        startsAt: at(day, `${hh}:00`),
        endsAt: at(day, `${String(h + 1).padStart(2, '0')}:00`),
        status: pseudonym ? 'BOOKED' : removed ? 'REMOVED' : 'OPEN',
        pseudonym,
      });
    }
  }
  return slots;
}

export function currentWeekStart(): string {
  return mondayOf(istDay(0));
}
