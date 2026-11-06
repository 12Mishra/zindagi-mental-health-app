import type { NextFunction, Request, Response } from 'express';
import type { StaffRole } from '../generated/prisma/client';
import { getBearerToken } from '../auth/middlewares/auth.middleware';
import { staffFromToken, type StaffIdentity } from './staff.service';

export type StaffRequest = Request & { staff?: StaffIdentity; staffToken?: string };

/** Authenticates a staff bearer token; when roles are given the staff member must hold one of them. */
export const requireStaff = (...roles: StaffRole[]) => async (req: StaffRequest, res: Response, next: NextFunction) => {
  try {
    const token = getBearerToken(req);
    if (!token) { res.status(401).json({ error: 'Missing bearer token.' }); return; }
    const staff = await staffFromToken(token);
    if (!staff) { res.status(401).json({ error: 'Invalid or expired session.' }); return; }
    if (roles.length && !roles.includes(staff.role)) { res.status(403).json({ error: 'Not allowed for this role.' }); return; }
    req.staff = staff;
    req.staffToken = token;
    next();
  } catch (error) { next(error); }
};

/** The authenticated staff member; only call inside a route guarded by `requireStaff`. */
export const staffOf = (req: Request): StaffIdentity => {
  const staff = (req as StaffRequest).staff;
  if (!staff) throw new Error('requireStaff middleware missing');
  return staff;
};
