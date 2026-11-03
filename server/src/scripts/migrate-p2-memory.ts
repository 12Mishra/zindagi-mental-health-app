import { prisma } from '../db';

const CARD_MAX = 1200;
const BULLETS_MAX = 12;

/** Memory card from legacy profile themes + keywords: deduped, <= 12 bullets, <= 1,200 chars. */
export function cardFromProfile(themes: string[], keywords: string[]) {
  const seen = new Set<string>();
  const bullets: string[] = [];
  for (const item of [...themes, ...keywords]) {
    const text = item.trim().replace(/\s+/g, ' ');
    if (text && !seen.has(text.toLowerCase())) { seen.add(text.toLowerCase()); bullets.push(`- ${text}`); }
  }
  let card = '';
  for (const bullet of bullets.slice(0, BULLETS_MAX)) {
    if (card.length + bullet.length + 1 > CARD_MAX) break;
    card += `${card ? '\n' : ''}${bullet}`;
  }
  return card;
}

/** Idempotent: re-running creates no duplicates. `--dry-run` prints counts only and writes nothing. */
export async function migrate(dryRun: boolean) {
  const counts = { userMemory: 0, riskHistory: 0, memorySummary: 0 };
  const profiles = await prisma.customerProfile.findMany();
  for (const profile of profiles) {
    if (!(await prisma.userMemory.findUnique({ where: { userId: profile.userId }, select: { userId: true } }))) {
      counts.userMemory++;
      if (!dryRun) await prisma.userMemory.create({ data: { userId: profile.userId, memoryCard: cardFromProfile(profile.themes, profile.keywords), version: 0 } });
    }
    for (const flag of new Set(profile.riskFlags)) {
      const exists = await prisma.riskHistory.findFirst({ where: { userId: profile.userId, flag, policyVersion: 'migrated-p2' }, select: { id: true } });
      if (exists) continue;
      counts.riskHistory++;
      if (!dryRun) await prisma.riskHistory.create({ data: { userId: profile.userId, level: 'UNKNOWN', flag: flag.slice(0, 80), conversationId: null, policyVersion: 'migrated-p2' } });
    }
  }
  const summaries = await prisma.conversationSummary.findMany({ include: { conversation: { select: { userId: true, createdAt: true } } } });
  for (const summary of summaries) {
    if (await prisma.memorySummary.findUnique({ where: { conversationId: summary.conversationId }, select: { id: true } })) continue;
    counts.memorySummary++;
    if (!dryRun) await prisma.memorySummary.create({ data: {
      userId: summary.conversation.userId, conversationId: summary.conversationId, summary: summary.summary,
      keyThemes: summary.keyThemes, sessionStartedAt: summary.conversation.createdAt, embedding: [],
    } });
  }
  return counts;
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  migrate(dryRun).then(counts => {
    console.log(`${dryRun ? '[dry-run] would create' : 'created'}: ${JSON.stringify(counts)}`);
    return prisma.$disconnect();
  }).catch(error => { console.error(error instanceof Error ? error.message : 'migration failed'); process.exit(1); });
}
