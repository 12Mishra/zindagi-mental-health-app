import { createComplete, ContextAgent } from './context-agent';
import { prefetchLongTerm } from './long-term';
import { key, safe } from './redis';
import { reviewLisaSegment } from '../voice/policy';

const GREETING_TTL_S = 300;
const NO_GREETING = '__static__';

// TODO(counsellor): approve the exact wording of these static greetings before any pilot.
export const STATIC_GREETING = {
  en: 'Hi, I am Lisa. I am here to listen. How are you feeling today?',
  hi: 'नमस्ते, मैं लिसा हूँ। मैं सुनने के लिए यहाँ हूँ। आज आप कैसा महसूस कर रहे हैं?',
  mixed: 'Hi, main Lisa hoon. Main sunne ke liye yahan hoon. Aaj aap kaisa feel kar rahe hain?',
} as const;

/**
 * Called at voice-ticket issue: prefetch long-term memory for `hello` and pre-generate a personalised opening line.
 * First-ever sessions (no memory card) get the static greeting. Never throws.
 */
export async function prepareGreeting(conversationId: string, userId: string, agent = new ContextAgent(createComplete())) {
  try {
    const memory = await prefetchLongTerm(conversationId, userId);
    const store = (value: string) => safe(kv => kv.set(key('greet', conversationId), value, GREETING_TTL_S), undefined);
    // First-ever session: nothing to personalise, so `takeGreeting` returns the static line without waiting.
    if (!memory.memoryCard.trim() && !memory.openThreads.length) { await store(NO_GREETING); return; }
    const text = await agent.greeting({ memoryCard: memory.memoryCard, openThreads: memory.openThreads, language: memory.preferences.language ?? 'en' });
    await store(text && reviewLisaSegment(text, { level: 'LOW', action: 'continue' }).decision === 'ALLOW' ? text : NO_GREETING);
  } catch { /* greeting is best effort */ }
}

/** Waits up to `waitMs` for the pre-generated line; null means "use the static greeting". */
export async function takeGreeting(conversationId: string, waitMs = 300, pollMs = 50): Promise<string | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const text = await safe(kv => kv.get(key('greet', conversationId)), null);
    if (text) { await safe(kv => kv.del(key('greet', conversationId)), undefined); return text === NO_GREETING ? null : text; }
    if (Date.now() + pollMs > deadline) return null;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

export function staticGreeting(language: 'en' | 'hi' | 'mixed' | undefined) { return STATIC_GREETING[language ?? 'mixed']; }
