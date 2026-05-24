import type { Request } from 'express';

import { config } from '../../config';
import { prisma } from '../../db';
import type { RegistrationInput } from '../validators/auth.validator';
import { createSessionToken, hashValue, safeCompare } from '../utils/crypto.util';

const addMinutes = (date: Date, minutes: number) =>
  new Date(date.getTime() + minutes * 60 * 1000);

const addDays = (date: Date, days: number) =>
  new Date(date.getTime() + days * 24 * 60 * 60 * 1000);

const publicUserSelect = {
  id: true,
  phoneNumber: true,
  fullName: true,
  age: true,
  college: true,
  sex: true,
  history: true,
  createdAt: true,
  updatedAt: true,
};

export const requestOtp = async (phoneNumber: string) => {
  const user = await prisma.user.findUnique({
    where: { phoneNumber },
    select: { id: true },
  });

  await prisma.otpRequest.create({
    data: {
      phoneNumber,
      otpHash: hashValue(config.otpCode),
      expiresAt: addMinutes(new Date(), config.otpTtlMinutes),
      userId: user?.id,
    },
  });

  return {
    phoneNumber,
    otp: config.otpCode,
    expiresInMinutes: config.otpTtlMinutes,
    registrationRequired: !user,
  };
};

export const consumeOtp = async (phoneNumber: string, otp: string) => {
  const otpRequest = await prisma.otpRequest.findFirst({
    where: {
      phoneNumber,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRequest || !safeCompare(otpRequest.otpHash, hashValue(otp))) {
    throw new Error('Invalid or expired OTP.');
  }

  await prisma.otpRequest.update({
    where: { id: otpRequest.id },
    data: { consumedAt: new Date() },
  });
};

export const createSession = async (userId: string, req: Request) => {
  const token = createSessionToken();
  const expiresAt = addDays(new Date(), config.sessionTtlDays);

  const session = await prisma.session.create({
    data: {
      tokenHash: hashValue(token),
      userId,
      expiresAt,
      userAgent: req.header('user-agent'),
      ipAddress: req.ip,
    },
  });

  return {
    token,
    expiresAt: session.expiresAt,
  };
};

export const login = async (phoneNumber: string, otp: string, req: Request) => {
  const user = await prisma.user.findUnique({
    where: { phoneNumber },
    select: publicUserSelect,
  });

  if (!user) {
    throw new Error('User is not registered.');
  }

  await consumeOtp(phoneNumber, otp);

  const session = await createSession(user.id, req);
  return { user, session };
};

export const register = async (input: RegistrationInput, req: Request) => {
  await consumeOtp(input.phoneNumber, input.otp);

  const existingUser = await prisma.user.findUnique({
    where: { phoneNumber: input.phoneNumber },
    select: publicUserSelect,
  });

  const user = existingUser ?? await prisma.user.create({
    data: {
      phoneNumber: input.phoneNumber,
      fullName: input.fullName,
      age: input.age,
      college: input.college,
      sex: input.sex,
      history: input.history,
    },
    select: publicUserSelect,
  });

  const session = await createSession(user.id, req);
  return { user, session, wasRegistered: !existingUser };
};

export const getSessionFromToken = async (token: string) => {
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashValue(token) },
    include: {
      user: { select: publicUserSelect },
    },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  await prisma.session.update({
    where: { id: session.id },
    data: { lastSeenAt: new Date() },
  });

  return session;
};

export const revokeSession = async (token: string) => {
  await prisma.session.updateMany({
    where: {
      tokenHash: hashValue(token),
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
};
