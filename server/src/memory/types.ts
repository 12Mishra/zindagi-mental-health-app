export const NOTE_KEYS = ['topics', 'stressors', 'people', 'whatHelped', 'whatDidntHelp', 'commitments', 'questionsToFollowUp'] as const;
export type NoteKey = typeof NOTE_KEYS[number];
export type SessionNotes = Record<NoteKey, string[]>;
export type MemoryLanguage = 'en' | 'hi' | 'mixed';
export type TurnBrief = { intent: string; lang: MemoryLanguage; recall: string[]; emotionHint: string; avoid: string[]; suggestedFocus: string; forTurn: number; createdAt: number };
export type Recalled = { memorySummaryId: string; text: string };
export type RiskSlot = { turn: number; level: string; at: number };
export type OpenThread = { id: string; text: string; createdAt: string; lastMentionedAt: string; status: 'open' | 'resolved' };
export type Preferences = { language?: MemoryLanguage; declinedExercises?: string[]; likes?: string[] };
export type LongTermMemory = { memoryCard: string; openThreads: OpenThread[]; preferences: Preferences; version: number };
export type Turn = { role: 'user' | 'assistant'; content: string };

export const emptyNotes = (): SessionNotes => ({ topics: [], stressors: [], people: [], whatHelped: [], whatDidntHelp: [], commitments: [], questionsToFollowUp: [] });
export const emptyLongTerm = (): LongTermMemory => ({ memoryCard: '', openThreads: [], preferences: {}, version: 0 });
