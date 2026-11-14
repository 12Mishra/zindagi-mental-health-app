import { Router, type NextFunction, type Response } from 'express';
import type { AuthedRequest } from '../auth/middlewares/auth.middleware';
import { CheckinError, createCheckin, listCheckins, parseCheckin } from './checkin.service';

export const checkinRouter = Router();

const handle = (fn: (req: AuthedRequest, res: Response) => Promise<void>) =>
  async (req: AuthedRequest, res: Response, next: NextFunction) => {
    try { await fn(req, res); } catch (error) {
      if (error instanceof CheckinError) { res.status(error.status).json({ error: error.message }); return; }
      next(error);
    }
  };

checkinRouter.post('/', handle(async (req, res) => {
  res.status(201).json(await createCheckin(req.auth!.userId, parseCheckin(req.body)));
}));
checkinRouter.get('/me', handle(async (req, res) => { res.json(await listCheckins(req.auth!.userId)); }));
