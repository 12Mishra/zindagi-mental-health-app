import { prisma } from '../db';
import { embed, embeddingsEnabled } from '../memory/vector';

/** Fills embeddings for MemorySummary rows that have none (needs EMBEDDING_* configured). */
async function main() {
  if (!embeddingsEnabled()) { console.log('EMBEDDING_* is not configured; nothing to do.'); return; }
  const rows = await prisma.memorySummary.findMany({ where: { embedding: { isEmpty: true } }, select: { id: true, summary: true, keyThemes: true } });
  let done = 0;
  for (const row of rows) {
    const vector = await embed(`${row.summary}\n${row.keyThemes.join(', ')}`);
    if (!vector) continue;
    await prisma.memorySummary.update({ where: { id: row.id }, data: { embedding: vector } });
    done++;
  }
  console.log(`embedded ${done} of ${rows.length}`);
}

main().then(() => prisma.$disconnect()).catch(error => { console.error(error instanceof Error ? error.message : 'backfill failed'); process.exit(1); });
