import type { Topic } from '../generated/prisma/client';

export const TOPICS = ['ACADEMIC', 'ANXIETY', 'RELATIONSHIPS', 'FINANCIAL', 'FAMILY', 'SLEEP', 'CAREER', 'HEALTH', 'OTHER'] as const satisfies readonly Topic[];
const VALID = new Set<string>(TOPICS);

/** Keeps at most 3 distinct valid topics, case-insensitively; anything else is dropped. Empty input becomes ['OTHER']. */
export function parseTopics(value: unknown): Topic[] {
  const found: Topic[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const topic = typeof item === 'string' ? item.trim().toUpperCase() : '';
      if (VALID.has(topic) && !found.includes(topic as Topic)) found.push(topic as Topic);
      if (found.length === 3) break;
    }
  }
  return found.length ? found : ['OTHER'];
}
