import type { NextFunction, Request, Response } from 'express';

import {
  getSessionFromToken,
  login,
  register,
  requestOtp,
  revokeSession,
} from '../services/auth.service';
import { getBearerToken, type AuthedRequest } from '../middlewares/auth.middleware';
import {
  normalizeOtp,
  normalizePhoneNumber,
  parseRegistrationInput,
} from '../validators/auth.validator';

export const sendOtpController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.body.phoneNumber);
    if (!phoneNumber || phoneNumber.length < 11) {
      res.status(400).json({ error: 'A valid phone number is required.' });
      return;
    }

    const result = await requestOtp(phoneNumber);
    res.json({
      message: 'OTP sent.',
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

export const loginController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.body.phoneNumber);
    const otp = normalizeOtp(req.body.otp);

    if (!phoneNumber || !otp) {
      res.status(400).json({ error: 'Phone number and OTP are required.' });
      return;
    }

    const result = await login(phoneNumber, otp, req);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const registerController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const input = parseRegistrationInput(req.body);
    const result = await register(input, req);
    res.status(result.wasRegistered ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
};

export const verifyController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.body.phoneNumber);
    const otp = normalizeOtp(req.body.otp);

    if (!phoneNumber || !otp) {
      res.status(400).json({ error: 'Phone number and OTP are required.' });
      return;
    }

    const hasRegistrationFields =
      typeof req.body.fullName === 'string' ||
      typeof req.body.college === 'string' ||
      typeof req.body.sex === 'string';

    const result = hasRegistrationFields
      ? await register(parseRegistrationInput(req.body), req)
      : await login(phoneNumber, otp, req);

    res.status('wasRegistered' in result && result.wasRegistered ? 201 : 200).json(result);
  } catch (error) {
    next(error);
  }
};

export const getSessionController = async (
  req: AuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = req.auth?.token;
    if (!token) {
      res.status(401).json({ error: 'Missing bearer token.' });
      return;
    }

    const session = await getSessionFromToken(token);
    if (!session) {
      res.status(401).json({ error: 'Invalid or expired session.' });
      return;
    }

    res.json({
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        createdAt: session.createdAt,
        lastSeenAt: session.lastSeenAt,
      },
      user: session.user,
    });
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  try {
    const token = getBearerToken(req);
    if (token) {
      await revokeSession(token);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
