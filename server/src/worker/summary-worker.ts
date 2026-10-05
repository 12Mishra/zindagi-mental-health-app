import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { prisma } from '../db';
import { generateSummaryAndKeywords } from '../conversation/services/llm.service';
import { POLICY_VERSION } from '../voice/policy';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 3;

async function claimJob(owner: string) {
  const now = new Date();
  const candidate = await prisma.summaryJob.findFirst({
    where: { OR: [
      { state: 'PENDING', nextAttemptAt: { lte: now } },
      { state: 'RUNNING', leaseUntil: { lt: now } },
    ] },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (!candidate) return null;
  const claimed = await prisma.summaryJob.updateMany({
    where: { id: candidate.id, OR: [
      { state: 'PENDING', nextAttemptAt: { lte: now } },
      { state: 'RUNNING', leaseUntil: { lt: now } },
    ] },
    data: { state: 'RUNNING', attempts: { increment: 1 }, leaseOwner: owner, leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  return claimed.count ? prisma.summaryJob.findUnique({ where: { id: candidate.id } }) : null;
}

async function processJob(owner: string) {
  const job = await claimJob(owner);
  if (!job) return false;
  const heartbeat = setInterval(() => {
    void prisma.summaryJob.updateMany({
      where: { id: job.id, state: 'RUNNING', leaseOwner: owner },
      data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
    }).catch(() => {});
  }, 20_000);
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: job.conversationId },
      include: { messages: { orderBy: { turnNumber: 'asc' }, take: 200 } },
    });
    if (!conversation || !conversation.transcriptConsent || conversation.status !== 'ENDED') {
      throw new Error('conversation_not_available');
    }
    const transcript = conversation.messages.map(m =>
      `${m.role} [${m.clientTurnId ?? `turn-${m.turnNumber}`}]: ${m.role === 'ASSISTANT' ? (m.deliveredContent ?? '') : m.content}`,
    ).join('\n');
    const result = await generateSummaryAndKeywords(transcript);
    const userTurnIds = new Set(conversation.messages.filter(m => m.role === 'USER')
      .map(m => m.clientTurnId ?? `turn-${m.turnNumber}`));
    if (result.observations.some(o => !userTurnIds.has(o.evidenceTurnId))) {
      throw new Error('summary_invalid_evidence');
    }
    await prisma.$transaction(async tx => {
      const currentJob = await tx.summaryJob.findFirst({
        where: { id: job.id, state: 'RUNNING', leaseOwner: owner }, select: { id: true },
      });
      const currentConversation = await tx.conversation.findFirst({
        where: { id: job.conversationId, status: 'ENDED', transcriptConsent: true }, select: { userId: true },
      });
      if (!currentJob || !currentConversation) return;
      await tx.conversationSummary.upsert({
        where: { conversationId: job.conversationId },
        create: {
          conversationId: job.conversationId, summary: result.summary,
          keyThemes: result.keyThemes, structured: {
            ...result, koshaCoverage: Object.fromEntries(
              ['ANNAMAYA', 'PRANAMAYA', 'MANOMAYA', 'VIJNANAMAYA', 'ANANDAMAYA']
                .map(kosha => [kosha, result.observations.some(o => o.kosha === kosha) ? 'observed' : 'unknown']),
            ),
          }, policyVersion: POLICY_VERSION,
        },
        update: { summary: result.summary, keyThemes: result.keyThemes, structured: {
          ...result, koshaCoverage: Object.fromEntries(
            ['ANNAMAYA', 'PRANAMAYA', 'MANOMAYA', 'VIJNANAMAYA', 'ANANDAMAYA']
              .map(kosha => [kosha, result.observations.some(o => o.kosha === kosha) ? 'observed' : 'unknown']),
          ),
        }, policyVersion: POLICY_VERSION },
      });
      await tx.profileObservation.deleteMany({ where: { conversationId: job.conversationId } });
      if (result.observations.length) await tx.profileObservation.createMany({
        data: result.observations.map(o => ({
          userId: currentConversation.userId, conversationId: job.conversationId,
          kosha: o.kosha, observation: o.observation,
          evidenceTurnId: o.evidenceTurnId, policyVersion: POLICY_VERSION,
        })),
      });
      await tx.customerProfile.upsert({
        where: { userId: currentConversation.userId },
        create: { userId: currentConversation.userId, keywords: result.keywords, themes: result.keyThemes, riskFlags: result.riskFlags },
        update: { keywords: result.keywords, themes: result.keyThemes, riskFlags: result.riskFlags },
      });
      await tx.summaryJob.update({
        where: { id: job.id }, data: { state: 'COMPLETED', leaseOwner: null, leaseUntil: null, lastErrorCode: null },
      });
    });
  } catch (error) {
    const code = error instanceof Error && /^(conversation_not_available|summary_invalid_evidence)$/.test(error.message)
      ? error.message : 'generation_or_validation_failed';
    const failed = job.attempts >= MAX_ATTEMPTS;
    await prisma.summaryJob.updateMany({
      where: { id: job.id, leaseOwner: owner, state: 'RUNNING' },
      data: {
        state: failed ? 'FAILED' : 'PENDING', leaseOwner: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(60_000, 2000 * 2 ** job.attempts)),
        lastErrorCode: code,
      },
    });
  } finally { clearInterval(heartbeat); }
  return true;
}

async function loop(index: number) {
  const owner = `${process.pid}-${index}-${randomUUID()}`;
  for (;;) {
    const worked = await processJob(owner).catch(() => false);
    if (!worked) await new Promise(resolve => setTimeout(resolve, config.summaryPollMs));
  }
}

async function retentionLoop() {
  for (;;) {
    await prisma.conversation.deleteMany({ where: { retentionUntil: { lt: new Date() } } }).catch(() => {});
    await prisma.voiceTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

for (let i = 0; i < config.summaryConcurrency; i++) void loop(i);
void retentionLoop();
console.log(`Summary worker running with concurrency ${config.summaryConcurrency}`);
