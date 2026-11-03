import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import type { Prisma } from '../generated/prisma/client';
import { key, safe } from './redis';
import { emptyLongTerm, type LongTermMemory, type MemoryLanguage, type OpenThread, type Preferences } from './types';

const CARD_MAX = 1200;
const CTX_TTL_S = 300;

const asThreads = (value: unknown): OpenThread[] => Array.isArray(value) ? value.filter((t): t is OpenThread =>
  !!t && typeof t === 'object' && typeof (t as OpenThread).id === 'string' && typeof (t as OpenThread).text === 'string' &&
  ((t as OpenThread).status === 'open' || (t as OpenThread).status === 'resolved')).slice(0, 20) : [];
const asPreferences = (value: unknown): Preferences => value && typeof value === 'object' && !Array.isArray(value) ? value as Preferences : {};

export async function loadLongTerm(userId: string): Promise<LongTermMemory> {
  const row = await prisma.userMemory.findUnique({ where: { userId } });
  if (!row) return emptyLongTerm();
  return { memoryCard: row.memoryCard, openThreads: asThreads(row.openThreads), preferences: asPreferences(row.preferences), version: row.version };
}

/** Ticket-time prefetch so `hello` needs no DB work (`zs:ctx:{conversationId}`, 5 min). */
export async function prefetchLongTerm(conversationId: string, userId: string): Promise<LongTermMemory> {
  const memory = await loadLongTerm(userId);
  await safe(kv => kv.set(key('ctx', conversationId), JSON.stringify(memory), CTX_TTL_S), undefined);
  return memory;
}

export async function getLongTerm(conversationId: string, userId: string): Promise<LongTermMemory> {
  const cached = await safe(kv => kv.get(key('ctx', conversationId)), null);
  if (cached) { try { return JSON.parse(cached) as LongTermMemory; } catch { /* fall back to the DB */ } }
  return loadLongTerm(userId);
}

export type MergedMemory = { memoryCard: string; openThreads: OpenThread[]; preferences: Preferences };

const str = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : null;

/** Validates the memory-card merge output (lengths and shapes) and keeps thread ids/timestamps stable. */
export function parseMerge(raw: string, current: LongTermMemory, now = new Date()): MergedMemory | null {
  let data: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim());
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    data = value as Record<string, unknown>;
  } catch { return null; }
  const memoryCard = str(data.memoryCard, CARD_MAX);
  if (memoryCard === null || memoryCard.split('\n').filter(l => l.trim()).length > 12) return null;
  if (!Array.isArray(data.openThreads) || data.openThreads.length > 10) return null;
  const iso = now.toISOString();
  const openThreads: OpenThread[] = [];
  for (const item of data.openThreads as unknown[]) {
    if (!item || typeof item !== 'object') return null;
    const t = item as Record<string, unknown>;
    const text = str(t.text, 200);
    if (!text || !text.trim() || (t.status !== 'open' && t.status !== 'resolved')) return null;
    const previous = current.openThreads.find(x => x.id === t.id || x.text.toLowerCase() === text.toLowerCase());
    openThreads.push({ id: previous?.id ?? randomUUID(), text: text.trim(), status: t.status, createdAt: previous?.createdAt ?? iso, lastMentionedAt: iso });
  }
  const p = data.preferences && typeof data.preferences === 'object' && !Array.isArray(data.preferences) ? data.preferences as Record<string, unknown> : {};
  const preferences: Preferences = { ...current.preferences };
  if (p.language === 'en' || p.language === 'hi' || p.language === 'mixed') preferences.language = p.language as MemoryLanguage;
  for (const field of ['declinedExercises', 'likes'] as const) {
    if (Array.isArray(p[field]) && (p[field] as unknown[]).length <= 10 && (p[field] as unknown[]).every(x => typeof x === 'string' && x.length <= 80)) preferences[field] = p[field] as string[];
  }
  return { memoryCard: memoryCard.trim(), openThreads, preferences };
}

/** Persistence seam for the optimistic-concurrency merge; tests inject a fake. */
export interface MemoryStore {
  load(userId: string): Promise<LongTermMemory>;
  /** True when the write won: the row was at `expectedVersion` (or absent and expectedVersion is 0). */
  save(userId: string, expectedVersion: number, next: MergedMemory, tx?: Prisma.TransactionClient): Promise<boolean>;
}

export const prismaMemoryStore: MemoryStore = {
  load: loadLongTerm,
  async save(userId, expectedVersion, next, tx) {
    const db = tx ?? prisma;
    const data = { memoryCard: next.memoryCard, openThreads: next.openThreads as object[], preferences: next.preferences as object, version: expectedVersion + 1 };
    if (expectedVersion === 0) {
      const exists = await db.userMemory.findUnique({ where: { userId }, select: { version: true } });
      if (!exists) {
        try { await db.userMemory.create({ data: { userId, ...data } }); return true; } catch { return false; }
      }
    }
    return (await db.userMemory.updateMany({ where: { userId, version: expectedVersion }, data })).count === 1;
  },
};

/** Load → compute → compare-and-set; on a version conflict reload and retry (max 3). */
export async function mergeLongTerm(userId: string, compute: (current: LongTermMemory) => Promise<MergedMemory | null>,
  store: MemoryStore = prismaMemoryStore, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const current = await store.load(userId);
    const next = await compute(current);
    if (!next) return false;
    if (await store.save(userId, current.version, next)) return true;
  }
  return false;
}
