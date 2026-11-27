/**
 * Dev-only: removes the synthetic students created by seed:portals (phone numbers +915000000xxx) and everything
 * derived from them, so the admin portal shows only real students. Staff, therapist profiles and slots are kept.
 *
 *   npm run unseed:students
 */
import { prisma } from '../db';
import { addDays, todayIn } from '../insights/dates';
import { config } from '../config';
import { rollupRange } from '../worker/rollup-job';
import { runAlertEngine } from '../worker/alert-engine';

if (process.env.NODE_ENV === 'production') throw new Error('unseed:students is for development only.');

const PHONE_PREFIX = '+915000000';

async function main() {
  const seeded = (await prisma.user.findMany({ where: { phoneNumber: { startsWith: PHONE_PREFIX } }, select: { id: true } })).map(u => u.id);

  // Alerts are not linked to users by a foreign key, so remove the ones about seeded students explicitly,
  // plus cohort dips, which were computed from the seeded aggregates.
  const alerts = await prisma.alert.deleteMany({ where: { OR: [{ subjectUserId: { in: seeded } }, { kind: 'COHORT_DIP' }] } });

  // Cascades check-ins, conversations, risk history, appointments, session requests and outreach.
  const users = await prisma.user.deleteMany({ where: { id: { in: seeded } } });

  // Slots booked by the deleted appointments go back to open time.
  const slots = await prisma.availabilitySlot.updateMany({ where: { status: 'BOOKED', appointments: { none: {} } }, data: { status: 'OPEN' } });

  // Rebuild aggregates from real data only.
  await prisma.cohortDailyStat.deleteMany({});
  const today = todayIn(config.rollupTimezone, new Date());
  await rollupRange(addDays(today, -364), today);
  const engine = await runAlertEngine();

  console.log(`Removed ${users.count} seeded students and ${alerts.count} alerts; reopened ${slots.count} slots.`);
  console.log(`Rebuilt rollups for the last 365 days; alert engine pass: ${JSON.stringify(engine)}.`);
}

main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
