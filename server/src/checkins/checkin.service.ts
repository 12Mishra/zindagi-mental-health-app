import { prisma } from '../db';

export class CheckinError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type CheckinInput = { score: number; tags: string[]; note: string | null };

const MAX_PER_DAY = 3;

export function parseCheckin(body: unknown): CheckinInput {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const { score } = data;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    throw new CheckinError('score must be an integer from 1 to 5.', 400);
  }
  const tags = data.tags ?? [];
  if (!Array.isArray(tags) || tags.length > 5 || !tags.every(t => typeof t === 'string' && t.trim().length > 0 && t.length <= 24)) {
    throw new CheckinError('tags must be at most 5 short strings.', 400);
  }
  const note = typeof data.note === 'string' && data.note.trim() ? data.note.trim() : null;
  if (note && note.length > 500) throw new CheckinError('note must be at most 500 characters.', 400);
  return { score, tags: (tags as string[]).map(t => t.trim()), note };
}

export async function createCheckin(userId: string, input: CheckinInput) {
  const since = new Date(Date.now() - 86_400_000);
  if (await prisma.moodCheckin.count({ where: { userId, createdAt: { gte: since } } }) >= MAX_PER_DAY) {
    throw new CheckinError('Check-in limit reached for today.', 429);
  }
  // Severity is classified later by the worker, never on the request path.
  return prisma.moodCheckin.create({
    data: { userId, score: input.score, tags: input.tags, note: input.note, source: 'APP' },
    select: { id: true, score: true, tags: true, createdAt: true },
  });
}

/** Own history only; the note and its severity are deliberately not echoed back. */
export const listCheckins = (userId: string, take = 30) => prisma.moodCheckin.findMany({
  where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(take, 100),
  select: { id: true, score: true, tags: true, createdAt: true },
});
