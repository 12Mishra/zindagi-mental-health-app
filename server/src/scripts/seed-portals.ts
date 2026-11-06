/**
 * Dev-only seed for the admin and therapist portals: one institution, staff, ~150 synthetic students with
 * 12 weeks of check-ins and conversations, risk history, therapist slots and a few appointments.
 * Idempotent: it removes its own previous data first. Seeded students use the reserved range +915000000xxx
 * (Indian mobile numbers never start with 5), so they cannot collide with real users.
 *
 *   SEED_STAFF_PASSWORD=... npm run seed:portals
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { makePseudonym } from '../insights/pseudonym';
import { hashPassword } from '../staff/password';
import { POLICY_VERSION } from '../voice/policy';
import type { Topic } from '../generated/prisma/client';

if (process.env.NODE_ENV === 'production') throw new Error('seed-portals refuses to run with NODE_ENV=production');

const SLUG = 'tiet';
const PHONE_PREFIX = '+915000000';
const STUDENTS = 150;
const WEEKS = 12;
const DAY = 86_400_000;

// Deterministic generator so every run produces the same dataset.
let state = 20260106;
const rand = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 2 ** 32; };
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)];
const gauss = () => (rand() + rand() + rand() + rand() - 2) / 0.58;

const DEPARTMENTS = ['CSE', 'ECE', 'ME', 'CE', 'BT'];
const FIRST = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Isha', 'Vivaan', 'Anika', 'Arjun', 'Saanvi', 'Dev', 'Tara'];
const LAST = ['Sharma', 'Verma', 'Singh', 'Gupta', 'Kaur', 'Mehta', 'Reddy', 'Nair', 'Bose', 'Khanna'];
const TOPIC_WEIGHTS: Array<[Topic, number]> = [
  ['ACADEMIC', 78], ['ANXIETY', 62], ['RELATIONSHIPS', 45], ['FINANCIAL', 38], ['FAMILY', 32], ['SLEEP', 25], ['CAREER', 22], ['HEALTH', 10],
];
const TAGS = ['tired', 'stressed', 'okay', 'anxious', 'hopeful', 'lonely', 'calm', 'overwhelmed'];

function pickTopics(): Topic[] {
  const chosen = new Set<Topic>();
  for (const [topic, weight] of TOPIC_WEIGHTS) if (rand() * 130 < weight / 2) chosen.add(topic);
  if (!chosen.size) chosen.add('ACADEMIC');
  return [...chosen].slice(0, 3);
}

// Exam weeks (counted from the oldest week) pull mood down, matching the dashboard design.
const examPressure = (week: number) => week === 4 ? 0.9 : week === 8 ? 1.1 : 0;
const sessionCode = (used: Set<string>) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    const code = 'ZK-' + Array.from({ length: 4 }, () => alphabet[Math.floor(rand() * alphabet.length)]).join('');
    if (!used.has(code)) { used.add(code); return code; }
  }
};

async function main() {
  const password = process.env.SEED_STAFF_PASSWORD || randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);

  // Remove previous seed data (students cascade to their own rows; the institution cascades staff, stats, alerts).
  await prisma.user.deleteMany({ where: { phoneNumber: { startsWith: PHONE_PREFIX } } });
  await prisma.institution.deleteMany({ where: { slug: SLUG } });

  const institution = await prisma.institution.create({
    data: { name: 'Thapar Institute of Engineering and Technology', slug: SLUG, kAnonymity: 10, pseudonymSalt: randomBytes(16).toString('hex') },
  });

  const staffData = [
    { email: 'admin@tiet.test', role: 'ADMIN' as const, displayName: 'Campus Admin' },
    { email: 'therapist1@tiet.test', role: 'THERAPIST' as const, displayName: 'Dr. Sonam Dullat' },
    { email: 'therapist2@tiet.test', role: 'THERAPIST' as const, displayName: 'Dr. Rahul Arora' },
  ];
  const staff = [];
  for (const s of staffData) staff.push(await prisma.staffUser.create({ data: { ...s, institutionId: institution.id, passwordHash } }));
  const therapists = staff.filter(s => s.role === 'THERAPIST');
  await prisma.therapistProfile.createMany({ data: [
    { staffUserId: therapists[0].id, languages: ['en', 'hi'], specialties: ['ANXIETY', 'ACADEMIC', 'SLEEP'], bio: 'Student counsellor' },
    { staffUserId: therapists[1].id, languages: ['en', 'hi'], specialties: ['RELATIONSHIPS', 'FAMILY', 'CAREER'], bio: 'Clinical psychologist' },
  ] });

  // Students: years 40/28/20/12 %.
  const yearFor = () => { const r = rand(); return r < 0.4 ? 1 : r < 0.68 ? 2 : r < 0.88 ? 3 : 4; };
  const students = Array.from({ length: STUDENTS }, (_, i) => {
    const id = crypto.randomUUID();
    return {
      id, phoneNumber: `${PHONE_PREFIX}${String(i + 1).padStart(3, '0')}`, fullName: `${pick(FIRST)} ${pick(LAST)}`,
      age: 17 + Math.floor(rand() * 8), college: institution.name, sex: pick(['FEMALE', 'MALE', 'NON_BINARY', 'PREFER_NOT_TO_SAY'] as const),
      institutionId: institution.id, yearOfStudy: yearFor(), department: pick(DEPARTMENTS), checkinOptIn: rand() < 0.7,
      baseline: 3.3 + gauss() * 0.45,
    };
  });
  const used = new Set<string>();
  for (const s of students) {
    let attempt = 0;
    let pseudonym = makePseudonym(s.id, institution.pseudonymSalt, attempt);
    while (used.has(pseudonym)) pseudonym = makePseudonym(s.id, institution.pseudonymSalt, ++attempt);
    used.add(pseudonym);
    (s as typeof s & { pseudonym: string }).pseudonym = pseudonym;
  }
  await prisma.user.createMany({ data: students.map(({ baseline: _baseline, ...s }) => ({ ...s, pseudonym: (s as typeof s & { pseudonym: string }).pseudonym })) });

  // Check-ins: opted-in students check in most days; exam weeks lower scores.
  const now = Date.now();
  const startDay = new Date(new Date(now).setHours(0, 0, 0, 0) - (WEEKS * 7 - 1) * DAY);
  const checkins: Array<{ userId: string; score: number; tags: string[]; createdAt: Date }> = [];
  for (const s of students) {
    for (let d = 0; d < WEEKS * 7; d++) {
      const week = Math.floor(d / 7);
      if (rand() > (s.checkinOptIn ? 0.62 : 0.18)) continue;
      const score = Math.max(1, Math.min(5, Math.round(s.baseline - examPressure(week) + gauss() * 0.7)));
      checkins.push({ userId: s.id, score, tags: [pick(TAGS)], createdAt: new Date(startDay.getTime() + d * DAY + (8 + Math.floor(rand() * 14)) * 3_600_000) });
    }
  }
  for (let i = 0; i < checkins.length; i += 2000) await prisma.moodCheckin.createMany({ data: checkins.slice(i, i + 2000) });

  // Ended conversations with topics (memory consent only, so no transcripts exist for synthetic students).
  const conversations: Array<{ userId: string; status: 'ENDED'; memoryConsent: boolean; topics: Topic[]; createdAt: Date; endedAt: Date }> = [];
  for (let i = 0; i < 400; i++) {
    const s = pick(students);
    const week = Math.floor(rand() * WEEKS);
    const at = new Date(startDay.getTime() + (week * 7 + Math.floor(rand() * 7)) * DAY + (9 + Math.floor(rand() * 12)) * 3_600_000);
    if (at.getTime() > now) continue;
    conversations.push({ userId: s.id, status: 'ENDED', memoryConsent: true, topics: pickTopics(), createdAt: at, endedAt: new Date(at.getTime() + (5 + rand() * 20) * 60_000) });
  }
  await prisma.conversation.createMany({ data: conversations });

  // Risk history: 2 students with URGENT and 3 with ELEVATED in the last days (the alert engine turns these into alerts).
  const risky = [...students].sort(() => rand() - 0.5).slice(0, 5);
  await prisma.riskHistory.createMany({ data: risky.map((s, i) => ({
    userId: s.id, level: i < 2 ? 'URGENT' as const : 'ELEVATED' as const, flag: i < 2 ? 'triage_urgent' : 'triage_elevated',
    policyVersion: POLICY_VERSION, createdAt: new Date(now - (i + 1) * 8 * 3_600_000),
  })) });

  // Therapist availability: weekdays, hourly 10:00-16:00, next 14 days.
  const today = new Date(new Date(now).setHours(0, 0, 0, 0));
  const slots: Array<{ therapistId: string; startsAt: Date; endsAt: Date; mode: 'IN_PERSON' | 'PHONE' }> = [];
  for (const t of therapists) for (let d = 1; d <= 14; d++) {
    const day = new Date(today.getTime() + d * DAY);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    for (let h = 10; h < 16; h++) {
      const startsAt = new Date(day.getTime() + h * 3_600_000);
      slots.push({ therapistId: t.id, startsAt, endsAt: new Date(startsAt.getTime() + 3_000_000), mode: h % 3 === 0 ? 'PHONE' : 'IN_PERSON' });
    }
  }
  await prisma.availabilitySlot.createMany({ data: slots });

  // Three appointments: one with identity consent, one brief only, one with no consent at all.
  const booked = await prisma.availabilitySlot.findMany({ where: { therapistId: { in: therapists.map(t => t.id) } }, orderBy: { startsAt: 'asc' }, take: 3 });
  const codes = new Set<string>();
  const consentSets: Array<Array<'BRIEF' | 'IDENTITY' | 'CONTACT'>> = [['BRIEF', 'IDENTITY', 'CONTACT'], ['BRIEF'], []];
  for (let i = 0; i < booked.length; i++) {
    const slot = booked[i];
    await prisma.availabilitySlot.update({ where: { id: slot.id }, data: { status: 'BOOKED' } });
    await prisma.appointment.create({ data: {
      slotId: slot.id, studentId: risky[i % risky.length].id, therapistId: slot.therapistId, institutionId: institution.id,
      sessionCode: sessionCode(codes), reason: (['ANXIETY', 'ACADEMIC', 'FAMILY'] as const)[i],
      consents: { create: consentSets[i].map(scope => ({ scope })) },
    } });
  }

  console.log(`Seeded ${STUDENTS} students, ${checkins.length} check-ins, ${conversations.length} conversations, ${slots.length} slots.`);
  console.log('Staff (same password): admin@tiet.test, therapist1@tiet.test, therapist2@tiet.test');
  if (!process.env.SEED_STAFF_PASSWORD) console.log(`Generated staff password (shown once): ${password}`);
}

main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
