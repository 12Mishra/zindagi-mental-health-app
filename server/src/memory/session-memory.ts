import { config } from '../config';
import { key, safe } from './redis';
import { emptyNotes, type MemoryLanguage, type Recalled, type RiskSlot, type SessionNotes, type TurnBrief } from './types';

export type SessionState = {
  rollingSummary: string;
  notes: SessionNotes;
  turnBrief: TurnBrief | null;
  recalled: Recalled[];
  language: MemoryLanguage;
  riskTimeline: RiskSlot[];
  turnCount: number;
};

export const emptySession = (): SessionState => ({ rollingSummary: '', notes: emptyNotes(), turnBrief: null, recalled: [], language: 'en', riskTimeline: [], turnCount: 0 });

const parse = <T>(raw: string | undefined, fallback: T): T => {
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
};

/** Typed access to the Redis session tier (`zs:sess:{conversationId}`). Every call degrades instead of throwing. */
export const sessionKey = (conversationId: string) => key('sess', conversationId);

export async function loadSession(conversationId: string): Promise<SessionState | null> {
  const hash = await safe(kv => kv.hgetall(sessionKey(conversationId)), null);
  if (!hash || !Object.keys(hash).length) return null;
  const base = emptySession();
  return {
    rollingSummary: parse(hash.rollingSummary, base.rollingSummary),
    notes: { ...base.notes, ...parse<Partial<SessionNotes>>(hash.notes, {}) },
    turnBrief: parse(hash.turnBrief, null),
    recalled: parse(hash.recalled, base.recalled),
    language: parse(hash.language, base.language),
    riskTimeline: parse(hash.riskTimeline, base.riskTimeline),
    turnCount: parse(hash.turnCount, 0),
  };
}

export async function saveSession(conversationId: string, fields: Partial<SessionState>) {
  const values: Record<string, string> = {};
  for (const [name, value] of Object.entries(fields)) values[name] = JSON.stringify(value);
  if (!Object.keys(values).length) return;
  await safe(kv => kv.hset(sessionKey(conversationId), values), undefined);
}

export const expireSession = (conversationId: string) =>
  safe(kv => kv.expire(sessionKey(conversationId), config.sessionMemoryTtlS), undefined);
