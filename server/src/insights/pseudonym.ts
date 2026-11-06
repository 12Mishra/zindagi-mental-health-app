import { createHmac } from 'node:crypto';
import { prisma } from '../db';

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Stable, non-reversible label like `#KR047` for a student within one institution. `attempt` resolves rare collisions. */
export function makePseudonym(userId: string, salt: string, attempt = 0): string {
  const digest = createHmac('sha256', salt).update(`${userId}:${attempt}`).digest();
  const letters = LETTERS[digest[0] % LETTERS.length] + LETTERS[digest[1] % LETTERS.length];
  const number = ((digest[2] << 8) | digest[3]) % 1000;
  return `#${letters}${String(number).padStart(3, '0')}`;
}

/** Links a student to the institution matching their `college` text and assigns a pseudonym. Idempotent; no-op without a match. */
export async function linkUserToInstitution(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { college: true, institutionId: true, pseudonym: true } });
  if (!user || (user.institutionId && user.pseudonym)) return;
  const college = user.college.trim();
  const institution = user.institutionId
    ? await prisma.institution.findUnique({ where: { id: user.institutionId } })
    : await prisma.institution.findFirst({ where: { OR: [
      { name: { equals: college, mode: 'insensitive' } }, { slug: { equals: college, mode: 'insensitive' } },
    ] } });
  if (!institution) return;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { institutionId: institution.id, pseudonym: makePseudonym(userId, institution.pseudonymSalt, attempt) },
      });
      return;
    } catch (error) {
      if (!(error instanceof Error && /Unique constraint|P2002/.test(error.message))) throw error;
    }
  }
}
