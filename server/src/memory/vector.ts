import { config } from '../config';
import { prisma } from '../db';
import { key, safe } from './redis';

/**
 * Per-user semantic recall without pgvector: embeddings are Float[] and ranked in Node (tens to a few hundred rows
 * per user). Moving to pgvector later only swaps this module plus one migration.
 */
export const l2normalize = (vector: number[]) => {
  const norm = Math.sqrt(vector.reduce((sum, x) => sum + x * x, 0));
  return norm ? vector.map(x => x / norm) : vector;
};
export const dot = (a: number[], b: number[]) => { let sum = 0; for (let i = 0; i < a.length; i++) sum += a[i] * b[i]; return sum; };

export type VectorRow = { id: string; summary: string; embedding: number[] };
export type VectorHit = { id: string; summary: string; score: number };

/** Pure ranking over normalised vectors; rows with empty or mismatched embeddings are skipped. */
export function rank(rows: VectorRow[], query: number[], k: number, minScore: number): VectorHit[] {
  return rows.filter(row => row.embedding.length > 0 && row.embedding.length === query.length)
    .map(row => ({ id: row.id, summary: row.summary, score: dot(row.embedding, query) }))
    .filter(hit => hit.score >= minScore).sort((a, b) => b.score - a.score).slice(0, k);
}

export const embeddingsEnabled = () => !!(config.embeddingBaseUrl && config.embeddingModel);

/** OpenAI-compatible /embeddings. Null when unconfigured, failing, or the wrong dimension; never throws. */
export async function embed(text: string, signal?: AbortSignal): Promise<number[] | null> {
  if (!embeddingsEnabled() || !text.trim()) return null;
  try {
    const url = new URL('embeddings', config.embeddingBaseUrl.endsWith('/') ? config.embeddingBaseUrl : `${config.embeddingBaseUrl}/`);
    const response = await fetch(url, {
      method: 'POST', signal: signal ?? AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(config.embeddingApiKey ? { Authorization: `Bearer ${config.embeddingApiKey}` } : {}) },
      body: JSON.stringify({ model: config.embeddingModel, input: text.slice(0, 4000) }),
    });
    if (!response.ok) return null;
    const data = await response.json() as { data?: Array<{ embedding?: unknown }> };
    return validateEmbedding(data.data?.[0]?.embedding);
  } catch { return null; }
}

export function validateEmbedding(vector: unknown, dim = config.embeddingDim): number[] | null {
  if (!Array.isArray(vector) || vector.length !== dim || !vector.every(x => typeof x === 'number' && Number.isFinite(x))) {
    if (Array.isArray(vector)) console.warn('[memory] embedding_dimension_mismatch');
    return null;
  }
  return l2normalize(vector as number[]);
}

async function loadRows(userId: string): Promise<VectorRow[]> {
  const cacheKey = key('vec', userId);
  const cached = await safe(kv => kv.get(cacheKey), null);
  if (cached) { try { return JSON.parse(cached) as VectorRow[]; } catch { /* reload below */ } }
  const rows = await prisma.memorySummary.findMany({
    where: { userId, NOT: { embedding: { isEmpty: true } } },
    select: { id: true, summary: true, embedding: true }, orderBy: { sessionStartedAt: 'desc' }, take: config.memorySearchMaxRows,
  });
  if (rows.length >= config.memorySearchMaxRows) console.warn('[memory] memory_search_row_cap_reached: consider pgvector');
  const mapped = rows.map(r => ({ id: r.id, summary: r.summary, embedding: r.embedding }));
  await safe(kv => kv.set(cacheKey, JSON.stringify(mapped), config.sessionMemoryTtlS), undefined);
  return mapped;
}

export async function search(userId: string, text: string, k: number, minScore: number): Promise<VectorHit[]> {
  const query = await embed(text);
  if (!query) return [];
  return rank(await loadRows(userId), query, k, minScore);
}
