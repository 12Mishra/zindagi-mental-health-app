import type { StaffRole } from '../generated/prisma/client';
import { config } from '../config';
import { prisma } from '../db';
import { createSessionToken, hashValue } from '../auth/utils/crypto.util';
import { verifyPassword } from './password';

export type Portal = 'admin' | 'therapist';
export const PORTAL_ROLE: Record<Portal, StaffRole> = { admin: 'ADMIN', therapist: 'THERAPIST' };

export type StaffIdentity = {
  staffId: string; role: StaffRole; institutionId: string; displayName: string; email: string; sessionId: string;
};

// Compared against when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = `scrypt$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export class StaffAuthError extends Error {}

export async function staffLogin(email: string, password: string, portal: Portal) {
  const staff = await prisma.staffUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  const passwordOk = await verifyPassword(password, staff?.passwordHash ?? DUMMY_HASH);
  if (!staff || !staff.active || !passwordOk) throw new StaffAuthError('Invalid email or password.');
  if (staff.role !== PORTAL_ROLE[portal]) throw new StaffAuthError('This account cannot use this portal.');
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + config.staffSessionTtlHours * 3_600_000);
  await prisma.staffSession.create({ data: { staffUserId: staff.id, tokenHash: hashValue(token), expiresAt } });
  return {
    token, expiresAt,
    staff: { id: staff.id, email: staff.email, displayName: staff.displayName, role: staff.role, institutionId: staff.institutionId },
  };
}

export async function staffFromToken(token: string): Promise<StaffIdentity | null> {
  const session = await prisma.staffSession.findUnique({ where: { tokenHash: hashValue(token) }, include: { staff: true } });
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.staff.active) return null;
  const { staff } = session;
  return {
    staffId: staff.id, role: staff.role, institutionId: staff.institutionId,
    displayName: staff.displayName, email: staff.email, sessionId: session.id,
  };
}

export const staffLogout = (token: string) =>
  prisma.staffSession.updateMany({ where: { tokenHash: hashValue(token), revokedAt: null }, data: { revokedAt: new Date() } });
