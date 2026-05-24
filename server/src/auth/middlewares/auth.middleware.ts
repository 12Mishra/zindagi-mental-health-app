import type { NextFunction, Request, Response } from 'express';

import { getSessionFromToken } from '../services/auth.service';

export type AuthedRequest = Request & {
  auth?: {
    token: string;
    sessionId: string;
    userId: string;
  };
};

export const getBearerToken = (req: Request) => {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
};

export const requireAuth = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = getBearerToken(req);
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    const session = await getSessionFromToken(token);
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }

    req.auth = {
      token,
      sessionId: session.id,
      userId: session.userId,
    };

    next();
  } catch (error) {
    next(error);
  }
};
