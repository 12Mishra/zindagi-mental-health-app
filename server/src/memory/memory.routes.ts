import { Router } from 'express';
import type { AuthedRequest } from '../auth/middlewares/auth.middleware';
import { deleteMemory, getMemory, patchPreferences } from './memory.service';

/** Mounted at /api/memory behind requireAuth; the user id always comes from the authenticated session. */
export const memoryRouter = Router();

memoryRouter.get('/', async (req, res, next) => {
  try { res.json(await getMemory((req as AuthedRequest).auth!.userId)); } catch (error) { next(error); }
});

memoryRouter.delete('/', async (req, res, next) => {
  try { await deleteMemory((req as AuthedRequest).auth!.userId); res.status(204).send(); } catch (error) { next(error); }
});

memoryRouter.patch('/preferences', async (req, res, next) => {
  try {
    const error = await patchPreferences((req as AuthedRequest).auth!.userId, req.body);
    if (error) { res.status(400).json({ error }); return; }
    res.json(await getMemory((req as AuthedRequest).auth!.userId));
  } catch (error) { next(error); }
});
