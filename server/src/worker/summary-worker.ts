import { randomUUID } from 'node:crypto';
import { config } from '../config';
import { prisma } from '../db';
import { generateMemoryMerge, generateSummaryAndKeywords } from '../conversation/services/llm.service';
import { Prisma } from '../generated/prisma/client';
import { loadLongTerm, parseMerge, prismaMemoryStore } from '../memory/long-term';
import { embed } from '../memory/vector';
import { jobSource, riskRows, snapshotText, type JobPayload } from './memory-job';
import { POLICY_VERSION } from '../voice/policy';

const LEASE_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MERGE_ATTEMPTS = 3;

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
    // The conversation row never includes messages; they are read only for transcript-consented jobs.
    const conversation = await prisma.conversation.findUnique({ where: { id: job.conversationId } });
    if (!conversation || conversation.status !== 'ENDED') throw new Error('conversation_not_available');
    const source = jobSource(conversation, job.payload);
    if (!source) throw new Error('conversation_not_available');
    const payload = source === 'snapshot' || conversation.memoryConsent ? (job.payload as JobPayload | null) : null;

    let text: string;
    let userTurnIds: Set<string> | null = null;
    if (source === 'transcript') {
      const messages = await prisma.message.findMany({ where: { conversationId: job.conversationId }, orderBy: { turnNumber: 'asc' }, take: 200 });
      text = messages.map(m => `${m.role} [${m.clientTurnId ?? `turn-${m.turnNumber}`}]: ${m.role === 'ASSISTANT' ? (m.deliveredContent ?? '') : m.content}`).join('\n');
      userTurnIds = new Set(messages.filter(m => m.role === 'USER').map(m => m.clientTurnId ?? `turn-${m.turnNumber}`));
    } else text = snapshotText(payload ?? {});
    if (!text.trim()) throw new Error('conversation_not_available');

    const result = await generateSummaryAndKeywords(text);
    // A snapshot has no turn ids to cite, so observations (which need evidence) are only kept for transcripts.
    const observations = userTurnIds ? result.observations : [];
    if (userTurnIds && observations.some(o => !userTurnIds!.has(o.evidenceTurnId))) throw new Error('summary_invalid_evidence');
    const keepsMemory = conversation.memoryConsent;
    // Embedding is computed before the transaction (network call); null when unconfigured.
    const embedding = keepsMemory ? await embed(`${result.summary}\n${result.keyThemes.join(', ')}`) : null;
    const koshaCoverage = Object.fromEntries(['ANNAMAYA', 'PRANAMAYA', 'MANOMAYA', 'VIJNANAMAYA', 'ANANDAMAYA']
      .map(kosha => [kosha, observations.some(o => o.kosha === kosha) ? 'observed' : 'unknown']));
    const structured = { ...result, observations, koshaCoverage };
    const writesRisk = keepsMemory || !config.riskHistoryRequiresConsent;
    const risks = writesRisk ? riskRows(result.riskFlags, payload) : [];

    // Memory-card merge: reload, call the LLM, then compare-and-set inside the transaction; retry on a version conflict.
    for (let attempt = 0; attempt < MERGE_ATTEMPTS; attempt++) {
      const current = keepsMemory ? await loadLongTerm(conversation.userId) : null;
      const merged = current ? parseMerge(await generateMemoryMerge(current, result.summary, payload?.notes ?? result.keyThemes), current) : null;
      if (current && !merged) throw new Error('memory_merge_invalid');
      try {
        await prisma.$transaction(async tx => {
          const currentJob = await tx.summaryJob.findFirst({ where: { id: job.id, state: 'RUNNING', leaseOwner: owner }, select: { id: true } });
          const currentConversation = await tx.conversation.findFirst({
            where: { id: job.conversationId, status: 'ENDED' }, select: { userId: true, createdAt: true, languageHint: true },
          });
          if (!currentJob || !currentConversation) return;
          const userId = currentConversation.userId;
          if (source === 'transcript') {
            await tx.conversationSummary.upsert({
              where: { conversationId: job.conversationId },
              create: { conversationId: job.conversationId, summary: result.summary, keyThemes: result.keyThemes, structured, policyVersion: POLICY_VERSION },
              update: { summary: result.summary, keyThemes: result.keyThemes, structured, policyVersion: POLICY_VERSION },
            });
            await tx.profileObservation.deleteMany({ where: { conversationId: job.conversationId } });
            if (observations.length) await tx.profileObservation.createMany({
              data: observations.map(o => ({ userId, conversationId: job.conversationId, kosha: o.kosha, observation: o.observation,
                evidenceTurnId: o.evidenceTurnId, policyVersion: POLICY_VERSION })),
            });
          }
          if (keepsMemory && merged && current) {
            const language = payload?.language ?? currentConversation.languageHint ?? null;
            await tx.memorySummary.upsert({
              where: { conversationId: job.conversationId },
              create: { userId, conversationId: job.conversationId, summary: result.summary, keyThemes: result.keyThemes, language,
                embedding: embedding ?? [], sessionStartedAt: currentConversation.createdAt },
              update: { summary: result.summary, keyThemes: result.keyThemes, language, embedding: embedding ?? [] },
            });
            if (!(await prismaMemoryStore.save(userId, current.version, merged, tx))) throw new Error('memory_version_conflict');
          }
          if (risks.length) {
            const existing = await tx.riskHistory.findMany({ where: { userId, conversationId: job.conversationId }, select: { flag: true, level: true } });
            const seen = new Set(existing.map(r => `${r.level}:${r.flag}`));
            // Append-only: rows are only ever added, never updated or removed.
            const fresh = risks.filter(r => !seen.has(`${r.level}:${r.flag}`));
            if (fresh.length) await tx.riskHistory.createMany({
              data: fresh.map(r => ({ userId, conversationId: job.conversationId, level: r.level, flag: r.flag, policyVersion: POLICY_VERSION })),
            });
          }
          await tx.summaryJob.update({
            where: { id: job.id }, data: { state: 'COMPLETED', leaseOwner: null, leaseUntil: null, lastErrorCode: null, payload: Prisma.DbNull },
          });
        });
        break;
      } catch (error) {
        if (!(error instanceof Error && error.message === 'memory_version_conflict') || attempt === MERGE_ATTEMPTS - 1) throw error;
      }
    }
  } catch (error) {
    const code = error instanceof Error && /^(conversation_not_available|summary_invalid_evidence|memory_merge_invalid|memory_version_conflict)$/.test(error.message)
      ? error.message : 'generation_or_validation_failed';
    // Error message only (provider status, validation code); never conversation text.
    console.warn(`[worker] job ${job.id} attempt ${job.attempts} failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}`);
    const failed = job.attempts >= MAX_ATTEMPTS;
    await prisma.summaryJob.updateMany({
      where: { id: job.id, leaseOwner: owner, state: 'RUNNING' },
      data: {
        state: failed ? 'FAILED' : 'PENDING', leaseOwner: null, leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + Math.min(120_000, 5000 * 2 ** job.attempts)),
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
    // Conversation expiry cascades transcript data only; MemorySummary, ProfileObservation and RiskHistory are set null.
    await prisma.conversation.deleteMany({ where: { retentionUntil: { lt: new Date() } } }).catch(() => {});
    await prisma.memorySummary.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - config.memoryRetentionDays * 24 * 60 * 60_000) } } }).catch(() => {});
    await prisma.voiceTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 60_000));
  }
}

for (let i = 0; i < config.summaryConcurrency; i++) void loop(i);
void retentionLoop();
console.log(`Memory worker running with concurrency ${config.summaryConcurrency}`);
