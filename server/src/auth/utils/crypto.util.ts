import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export const hashValue = (value: string) =>
  createHash('sha256').update(value).digest('hex');

export const createSessionToken = () => randomBytes(32).toString('base64url');

export const safeCompare = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
};
