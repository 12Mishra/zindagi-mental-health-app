/**
 * Creates only what the portals need to run on real data: the institution, one admin and
 * (optionally) therapists. No fake students, check-ins or alerts. Safe to re-run.
 *
 *   SEED_STAFF_PASSWORD=... npm run seed:admin
 *   INSTITUTION_NAME="My College" INSTITUTION_SLUG=mycollege ADMIN_EMAIL=me@college.edu npm run seed:admin
 *
 * Students are linked by matching their `college` text to INSTITUTION_NAME (or the slug).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db';
import { hashPassword } from '../staff/password';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed:admin is for development only.');
  const name = process.env.INSTITUTION_NAME || 'Thapar Institute of Engineering and Technology';
  const slug = process.env.INSTITUTION_SLUG || 'tiet';
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@tiet.test').toLowerCase();
  const therapistEmails = (process.env.THERAPIST_EMAILS ?? 'therapist1@tiet.test,therapist2@tiet.test').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

  const password = process.env.SEED_STAFF_PASSWORD || randomBytes(9).toString('base64url');
  const passwordHash = await hashPassword(password);

  const institution = await prisma.institution.upsert({
    where: { slug }, update: { name },
    create: { name, slug, kAnonymity: 10, pseudonymSalt: randomBytes(16).toString('hex') },
  });

  await prisma.staffUser.upsert({
    where: { email: adminEmail }, update: { passwordHash, active: true },
    create: { email: adminEmail, role: 'ADMIN', displayName: 'Campus Admin', institutionId: institution.id, passwordHash },
  });
  for (const [i, email] of therapistEmails.entries()) {
    const staff = await prisma.staffUser.upsert({
      where: { email }, update: { passwordHash, active: true },
      create: { email, role: 'THERAPIST', displayName: `Counsellor ${i + 1}`, institutionId: institution.id, passwordHash },
    });
    await prisma.therapistProfile.upsert({ where: { staffUserId: staff.id }, update: {}, create: { staffUserId: staff.id, languages: ['en', 'hi'], specialties: [] } });
  }

  console.log(`Institution: ${institution.name} (${institution.slug}). Students whose college matches this name are linked automatically.`);
  console.log(`Admin: ${adminEmail}; therapists: ${therapistEmails.join(', ') || '(none)'}`);
  if (!process.env.SEED_STAFF_PASSWORD) console.log(`Generated staff password (shown once): ${password}`);
}

main().then(() => prisma.$disconnect()).catch(async error => { console.error(error); await prisma.$disconnect(); process.exit(1); });
