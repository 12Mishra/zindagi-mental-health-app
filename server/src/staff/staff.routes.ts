import { Router } from 'express';
import { prisma } from '../db';
import { requireStaff, staffOf, type StaffRequest } from './staff.middleware';
import { staffLogin, staffLogout, StaffAuthError, type Portal } from './staff.service';

export const staffRouter = Router();

// Small in-memory limiter: 5 login attempts per minute per IP (single-process prototype).
const attempts = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(t => now - t < 60_000);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > 5;
};

staffRouter.post('/login', async (req, res, next) => {
  try {
    const { email, password, portal } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string' || (portal !== 'admin' && portal !== 'therapist')) {
      res.status(400).json({ error: 'email, password and portal (admin|therapist) are required.' }); return;
    }
    if (limited(req.ip ?? 'unknown')) { res.status(429).json({ error: 'Too many attempts. Try again in a minute.' }); return; }
    res.json(await staffLogin(email, password, portal as Portal));
  } catch (error) {
    if (error instanceof StaffAuthError) { res.status(401).json({ error: error.message }); return; }
    next(error);
  }
});

staffRouter.post('/logout', requireStaff(), async (req: StaffRequest, res, next) => {
  try { await staffLogout(req.staffToken!); res.json({ ok: true }); } catch (error) { next(error); }
});

staffRouter.get('/me', requireStaff(), async (req, res, next) => {
  try {
    const staff = staffOf(req);
    const institution = await prisma.institution.findUnique({
      where: { id: staff.institutionId }, select: { id: true, name: true, slug: true },
    });
    res.json({ id: staff.staffId, email: staff.email, displayName: staff.displayName, role: staff.role, institution });
  } catch (error) { next(error); }
});
