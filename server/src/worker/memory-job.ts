import { NOTE_KEYS, type SessionNotes } from '../memory/types';

export type JobPayload = {
  rollingSummary?: string; notes?: Partial<SessionNotes>; language?: string;
  riskTimeline?: Array<{ turn: number; level: string; at: number }>;
};
export type JobSource = 'transcript' | 'snapshot';

/**
 * Which input a job summarises. A transcript is used only with transcript consent; a memory-only job uses the
 * Redis snapshot payload and must never read message rows.
 */
export function jobSource(conversation: { transcriptConsent: boolean; memoryConsent: boolean }, payload: unknown): JobSource | null {
  if (conversation.transcriptConsent) return 'transcript';
  if (conversation.memoryConsent && payload && typeof payload === 'object') return 'snapshot';
  return null;
}

export function snapshotText(payload: JobPayload): string {
  const lines = [payload.rollingSummary ? `SUMMARY: ${payload.rollingSummary}` : ''];
  for (const key of NOTE_KEYS) {
    const list = payload.notes?.[key];
    if (Array.isArray(list) && list.length) lines.push(`${key}: ${list.filter(x => typeof x === 'string').join('; ')}`);
  }
  return lines.filter(Boolean).join('\n');
}

/** Risk rows to append: summary flags (unknown severity) plus non-LOW triage levels recorded during the session. */
export function riskRows(flags: string[], payload: JobPayload | null) {
  const rows: Array<{ level: 'UNKNOWN' | 'ELEVATED' | 'URGENT'; flag: string }> = flags.map(flag => ({ level: 'UNKNOWN', flag: flag.slice(0, 80) }));
  const levels = new Set<string>();
  for (const slot of payload?.riskTimeline ?? []) if (slot.level === 'ELEVATED' || slot.level === 'URGENT') levels.add(slot.level);
  for (const level of levels) rows.push({ level: level as 'ELEVATED' | 'URGENT', flag: `triage_${level.toLowerCase()}` });
  return rows;
}
