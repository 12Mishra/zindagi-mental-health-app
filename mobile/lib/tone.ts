// The tone engine behind Moss's face. Lisa is voice only, so Moss shows how the conversation feels:
// today's check-in sets the starting point, what the student says moves it, the server's safety check
// overrides it, and Lisa's reply decides how Moss looks while she speaks.
//
// Care rules (from the design): Moss reflects softly and never amplifies. It never looks scared or angry,
// never smiles at distress, and turns "steady" whenever the safety check says URGENT.

import type { MossExpression } from '@/components/moss/expressions';

type Cue = [phrase: string, weight: number];

// Negations are listed as their own negative phrases and matched first, so "not okay" never counts as "okay".
const NEGATIVE: Cue[] = [
  ['not okay', -1], ['not ok', -1], ['not fine', -1], ['not good', -1], ['not better', -0.8], ['no better', -0.8],
  ['not happy', -0.9], ['not doing well', -1],
  ["can't sleep", -1], ['cant sleep', -1], ["haven't slept", -1], ['havent slept', -1], ['not sleeping', -1],
  ["can't cope", -1], ['cant cope', -1], ["can't do this", -1], ['cant do this', -1], ['give up', -1],
  ["don't know what to do", -0.9], ["don't know where to start", -0.9], ['dont know what to do', -0.9],
  ['too much', -0.8], ['overwhelm', -1], ['panic', -1], ['anxious', -0.9], ['anxiety', -0.9], ['stressed', -0.8],
  ['stress', -0.6], ['scared', -0.9], ['afraid', -0.8], ['worried', -0.7], ['worry', -0.6], ['hopeless', -1],
  ['worthless', -1], ['lonely', -0.9], ['alone', -0.6], ['crying', -0.9], ['exhausted', -0.8], ['tired', -0.5],
  ['burnt out', -0.9], ['burned out', -0.9], ['failing', -0.8], ['falling behind', -0.7], ['behind', -0.4],
  ['pressure', -0.6], ['deadline', -0.4], ['hate', -0.8], ['angry', -0.7], ['frustrated', -0.7], ['upset', -0.7],
  ['sad', -0.8], ['depressed', -1], ['hurt', -0.8], ['keep calling', -0.4], ['fight', -0.6],
  // Hinglish
  ['pareshan', -0.8], ['tension', -0.7], ['dar lag', -0.9], ['akela', -0.8], ['thak gaya', -0.6], ['thak gayi', -0.6],
  ['rona', -0.8], ['dukhi', -0.8], ['gussa', -0.7], ['bahut zyada', -0.6], ['mushkil', -0.6],
];

const POSITIVE: Cue[] = [
  ['thank', 0.8], ['better', 0.7], ['lighter', 0.9], ['relieved', 0.9], ['calm', 0.6], ['feel good', 0.8],
  ['feeling good', 0.8], ['happy', 0.8], ['glad', 0.7], ['doable', 0.8], ['i can do', 0.8], ['makes sense', 0.6],
  ['helpful', 0.7], ['helped', 0.7], ['good idea', 0.7], ['great', 0.6], ['excited', 0.7], ['hopeful', 0.8],
  ['okay now', 0.6], ['fine now', 0.6], ['sounds good', 0.6], ['will try', 0.5], ["i'll try", 0.5],
  // Hinglish
  ['accha', 0.5], ['theek', 0.4], ['shukriya', 0.8], ['dhanyavad', 0.8], ['behtar', 0.7], ['khush', 0.8],
];

export type ToneRead = { score: number; hits: string[] };

/** Scores a sentence from -1 (stressed) to +1 (at ease). Returns null when no cue words were heard. */
export function scoreText(text: string): ToneRead | null {
  let rest = ` ${text.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ')} `;
  const hits: string[] = [];
  let sum = 0;
  for (const list of [NEGATIVE, POSITIVE]) {
    for (const [phrase, weight] of list) {
      const at = rest.indexOf(phrase);
      if (at < 0) continue;
      hits.push(phrase); sum += weight;
      rest = rest.slice(0, at) + ' '.repeat(phrase.length) + rest.slice(at + phrase.length);
    }
  }
  if (!hits.length) return null;
  const score = Math.max(-1, Math.min(1, (sum / hits.length) * Math.min(1, 0.55 + 0.15 * hits.length)));
  return { score, hits };
}

export const MOOD_TONE: Record<string, number> = {
  anxious: -0.5, angry: -0.5, sad: -0.55, fatigued: -0.3, unsafe: -0.9, overwhelmed: -0.6, calm: 0.5, okay: 0.2,
};

/** How Moss greets each check-in mood, and what it says. Order is priority when several are picked. */
export const MOOD_REACTION: { id: string; expression: MossExpression; line: string }[] = [
  { id: 'unsafe', expression: 'steady', line: "You're not alone. Help is one tap away, just below." },
  { id: 'overwhelmed', expression: 'worried', line: "One thing at a time. We'll sort it together." },
  { id: 'anxious', expression: 'worried', line: "Breathe with me for a second. We'll go slow." },
  { id: 'angry', expression: 'concerned', line: "That sounds really frustrating. I'm listening." },
  { id: 'sad', expression: 'concerned', line: "I'm here with you. No rush at all." },
  { id: 'fatigued', expression: 'sleepy', line: "Running low today? Let's keep it gentle." },
  { id: 'okay', expression: 'encouraging', line: 'Okay is okay. Want to talk anyway?' },
  { id: 'calm', expression: 'calm', line: "Love that. Let's keep this feeling going." },
];

export function moodReaction(moods: Iterable<string>) {
  const set = new Set(moods);
  return MOOD_REACTION.find(m => set.has(m.id)) ?? null;
}

export function baselineTone(moods: string[]): number {
  const known = moods.filter(m => m in MOOD_TONE);
  return known.length ? known.reduce((a, m) => a + MOOD_TONE[m], 0) / known.length : 0;
}

export function toneExpression(tone: number): MossExpression {
  if (tone < -0.55) return 'worried';
  if (tone < -0.2) return 'concerned';
  if (tone < 0.15) return 'calm';
  if (tone < 0.45) return 'relieved';
  return 'happy';
}

type Risk = 'LOW' | 'ELEVATED' | 'URGENT';

/** One per voice session. Keeps the smoothed tone and the latest safety level. */
export class ToneTracker {
  tone: number;
  risk: Risk = 'LOW';
  private moods: string[];

  constructor(moods: string[]) {
    this.moods = moods;
    this.tone = baselineTone(moods);
  }

  setRisk(level: string | undefined) {
    if (this.risk === 'URGENT') return; // stays steady for the rest of the session
    if (level === 'URGENT') this.risk = 'URGENT';
    else if (level === 'ELEVATED' || level === 'UNKNOWN') this.risk = 'ELEVATED';
    else if (level === 'LOW') this.risk = 'LOW';
  }

  private guard(expression: MossExpression): MossExpression {
    if (this.risk === 'URGENT') return 'steady';
    if (this.risk === 'ELEVATED' && (expression === 'happy' || expression === 'encouraging' || expression === 'relieved' || expression === 'calm')) return 'concerned';
    return expression;
  }

  /** Face while nobody is talking. */
  resting(): MossExpression {
    const fromMood = moodReaction(this.moods);
    if (Math.abs(this.tone - baselineTone(this.moods)) < 0.05 && fromMood) return this.guard(fromMood.expression === 'encouraging' ? 'calm' : fromMood.expression);
    return this.guard(toneExpression(this.tone));
  }

  /** Live reaction while the student is still talking. Does not change the stored tone. */
  peek(partial: string): MossExpression | null {
    const read = scoreText(partial);
    if (!read) return null;
    return this.guard(toneExpression(0.4 * this.tone + 0.6 * read.score));
  }

  /** A finished sentence from the student moves the tone. */
  hearUser(text: string): MossExpression {
    const read = scoreText(text);
    if (read) this.tone = 0.4 * this.tone + 0.6 * read.score;
    return this.guard(toneExpression(this.tone));
  }

  /** How Moss looks while Lisa says this. */
  hearLisa(text: string): MossExpression {
    const t = text.toLowerCase();
    if (this.tone < -0.35) return this.guard('concerned');
    if (this.tone > 0.45) return this.guard('happy');
    if (/\b(could you|you could|let's|lets|try|one step|you can|small step|how about)\b/.test(t)) return this.guard('encouraging');
    return this.guard('calm');
  }

  ended(): MossExpression {
    return this.guard(this.tone > 0.2 ? 'happy' : this.tone < -0.3 ? 'concerned' : 'calm');
  }
}
