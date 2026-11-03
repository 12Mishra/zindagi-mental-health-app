import { config } from '../config';
import { prisma } from '../db';
import { loadLongTerm } from './long-term';
import { key, safe } from './redis';
import type { LongTermMemory, Preferences } from './types';

/** Persistence seam for `/api/memory`; every call is scoped to one user id taken from the session, never the request. */
export interface MemoryApiStore {
  read(userId: string): Promise<LongTermMemory>;
  wipe(userId: string, includeRiskHistory: boolean): Promise<void>;
  savePreferences(userId: string, preferences: Preferences): Promise<void>;
}

export const prismaMemoryApiStore: MemoryApiStore = {
  read: loadLongTerm,
  async wipe(userId, includeRiskHistory) {
    await prisma.$transaction([
      prisma.userMemory.deleteMany({ where: { userId } }),
      prisma.memorySummary.deleteMany({ where: { userId } }),
      ...(includeRiskHistory ? [prisma.riskHistory.deleteMany({ where: { userId } })] : []),
    ]);
  },
  async savePreferences(userId, preferences) {
    await prisma.userMemory.upsert({
      where: { userId }, create: { userId, preferences: preferences as object, version: 1 },
      update: { preferences: preferences as object, version: { increment: 1 } },
    });
  },
};

export const getMemory = async (userId: string, store: MemoryApiStore = prismaMemoryApiStore) => {
  const { memoryCard, openThreads, preferences } = await store.read(userId);
  return { memoryCard, openThreads, preferences };
};

/** Wipes UserMemory + MemorySummary (embeddings included); RiskHistory goes too when it is consent-gated. */
export async function deleteMemory(userId: string, store: MemoryApiStore = prismaMemoryApiStore) {
  await store.wipe(userId, config.riskHistoryRequiresConsent);
  await safe(kv => kv.del(key('vec', userId)), undefined);
}

const stringList = (value: unknown) => Array.isArray(value) && value.length <= 10 && value.every(x => typeof x === 'string' && x.length > 0 && x.length <= 80);

/** Returns an error message for an invalid body, otherwise saves the merged preferences. */
export async function patchPreferences(userId: string, body: unknown, store: MemoryApiStore = prismaMemoryApiStore): Promise<string | null> {
  const data = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  if (!data) return 'Invalid preferences.';
  const patch: Preferences = {};
  if (data.language !== undefined) {
    if (data.language !== 'en' && data.language !== 'hi' && data.language !== 'mixed') return 'language must be en, hi or mixed.';
    patch.language = data.language;
  }
  if (data.declinedExercises !== undefined) {
    if (!stringList(data.declinedExercises)) return 'declinedExercises must be up to 10 short strings.';
    patch.declinedExercises = data.declinedExercises as string[];
  }
  if (!Object.keys(patch).length) return 'No supported preference given.';
  const current = await store.read(userId);
  await store.savePreferences(userId, { ...current.preferences, ...patch });
  return null;
}
