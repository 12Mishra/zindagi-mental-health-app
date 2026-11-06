import { prisma } from '../db';
import { getKv, key } from '../memory/redis';

/** Prints what the memory tiers hold for the most recently active user (or the user id given as the first argument). */
async function main() {
  const latest = await prisma.conversation.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, userId: true } });
  const userId = process.argv[2] ?? latest?.userId;
  if (!userId) { console.log('No conversations yet.'); return; }

  const conversations = await prisma.conversation.findMany({
    where: { userId }, orderBy: { createdAt: 'desc' }, take: 5,
    select: { id: true, status: true, transcriptConsent: true, memoryConsent: true, createdAt: true, summaryJob: { select: { state: true, attempts: true, lastErrorCode: true } } },
  });
  console.log('\n== Recent conversations (newest first)');
  for (const c of conversations) console.log(`${c.id} ${c.status} transcript=${c.transcriptConsent} memory=${c.memoryConsent} job=${c.summaryJob ? `${c.summaryJob.state} attempts=${c.summaryJob.attempts} err=${c.summaryJob.lastErrorCode ?? '-'}` : 'none'}`);

  const card = await prisma.userMemory.findUnique({ where: { userId } });
  console.log('\n== UserMemory (long-term card)');
  console.log(card ? JSON.stringify({ version: card.version, memoryCard: card.memoryCard, openThreads: card.openThreads, preferences: card.preferences }, null, 2) : 'none yet');

  const summaries = await prisma.memorySummary.findMany({ where: { userId }, orderBy: { sessionStartedAt: 'desc' }, take: 5 });
  console.log('\n== MemorySummary (newest first)');
  for (const s of summaries) console.log(`- [${s.language ?? '?'}] embedding=${s.embedding.length} dims themes=${s.keyThemes.join(', ')}\n  ${s.summary}`);
  if (!summaries.length) console.log('none yet');

  const risks = await prisma.riskHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 5 });
  console.log('\n== RiskHistory');
  for (const r of risks) console.log(`- ${r.level} ${r.flag} ${r.createdAt.toISOString()}`);
  if (!risks.length) console.log('none');

  const kv = getKv();
  const session = conversations[0] && kv ? await kv.hgetall(key('sess', conversations[0].id)).catch(() => ({})) : {};
  console.log('\n== Redis session of newest conversation');
  console.log(Object.keys(session).length ? JSON.stringify(session, null, 2).slice(0, 1500) : 'empty (expired, or Redis down)');
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => process.exit());
