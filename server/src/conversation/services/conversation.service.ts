import { prisma } from '../../db';
import { chatWithLisa } from './llm.service';
import { buildConversationContext } from './context.service';
import {
  POLICY_VERSION, RESPONSE_UNAVAILABLE, SAFETY_CLARIFICATION, URGENT_SUPPORT, turnLanguage,
} from '../../voice/policy';
import { assessStudentUtterance, checkLisaSegment } from '../../voice/safety-classifier';

export async function startConversation(userId: string, moodBefore: string[], moodNote?: string, transcriptConsent = false) {
  return prisma.conversation.create({
    data: {
      userId,
      moodBefore: moodBefore.slice(0, 8),
      moodNote: moodNote?.slice(0, 500),
      transcriptConsent,
      retentionUntil: new Date(Date.now() + (transcriptConsent ? 30 : 1) * 24 * 60 * 60_000),
    },
  });
}

export async function processMessage(conversationId: string, userId: string, userText: string, clientTurnId?: string) {
  const content = userText.trim();
  if (!content || content.length > 2000) throw new Error('Message must be between 1 and 2000 characters.');
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId, status: 'ACTIVE' },
  });
  if (!conversation) throw new Error('Active conversation not found');
  if (clientTurnId && conversation.transcriptConsent) {
    const previous = await prisma.message.findFirst({
      where: { conversationId, clientTurnId, role: 'ASSISTANT' },
    });
    if (previous) return { response: previous.deliveredContent ?? previous.content, turnNumber: previous.turnNumber };
  }

  const allocated = conversation.transcriptConsent
    ? await prisma.conversation.update({
      where: { id: conversationId, userId, status: 'ACTIVE' },
      data: { nextTurnNumber: { increment: 2 } },
      select: { nextTurnNumber: true },
    }) : null;
  const userTurnNumber = allocated ? allocated.nextTurnNumber - 2 : 0;
  if (conversation.transcriptConsent) {
    await prisma.message.create({
      data: { conversationId, role: 'USER', content, turnNumber: userTurnNumber, clientTurnId },
    });
  }

  const triage = await assessStudentUtterance(content);
  if (conversation.transcriptConsent) {
    await prisma.riskEvent.upsert({
      where: { conversationId_turnId_policyVersion: { conversationId, turnId: clientTurnId ?? `text-${userTurnNumber}`, policyVersion: POLICY_VERSION } },
      create: {
        conversationId, turnId: clientTurnId ?? `text-${userTurnNumber}`, level: triage.level,
        evidence: triage.evidence, action: triage.action, policyVersion: POLICY_VERSION,
      }, update: {},
    });
  }

  let response: string;
  const language = turnLanguage(content);
  if (triage.level === 'URGENT') response = URGENT_SUPPORT[language];
  else if (triage.level === 'UNKNOWN') response = SAFETY_CLARIFICATION[language];
  else {
    const context = await buildConversationContext(userId, conversationId);
    const messages = conversation.transcriptConsent
      ? context.messages : [...context.messages, { role: 'user', content }];
    const generated = await chatWithLisa(messages, context.systemPrompt);
    response = (await checkLisaSegment(generated, triage, undefined, content)).decision === 'ALLOW' ? generated : RESPONSE_UNAVAILABLE[language];
  }

  if (conversation.transcriptConsent) {
    const stillActive = await prisma.conversation.findFirst({ where: { id: conversationId, userId, status: 'ACTIVE' }, select: { id: true } });
    if (!stillActive) throw new Error('Conversation ended before response could be committed');
    await prisma.message.create({
      data: {
        conversationId, role: 'ASSISTANT', content: response, deliveredContent: response,
        turnNumber: userTurnNumber + 1, clientTurnId,
      },
    });
  }
  return { response, turnNumber: userTurnNumber + 1 };
}

export async function endConversation(conversationId: string, userId: string) {
  return prisma.$transaction(async tx => {
    const conversation = await tx.conversation.findFirst({
      where: { id: conversationId, userId }, select: { id: true, status: true, transcriptConsent: true },
    });
    if (!conversation) throw new Error('Conversation not found');
    if (conversation.status === 'ACTIVE') {
      await tx.conversation.update({ where: { id: conversationId }, data: { status: 'ENDED', endedAt: new Date() } });
      if (conversation.transcriptConsent) {
        const count = await tx.message.count({ where: { conversationId } });
        if (count > 0) await tx.summaryJob.upsert({
          where: { conversationId }, create: { conversationId }, update: {},
        });
      }
    }
    const job = await tx.summaryJob.findUnique({ where: { conversationId }, select: { state: true } });
    return { summaryStatus: job?.state.toLowerCase() ?? 'none' };
  });
}

export async function deleteConversation(conversationId: string, userId: string) {
  const result = await prisma.conversation.deleteMany({ where: { id: conversationId, userId } });
  if (!result.count) throw new Error('Conversation not found');
}

export async function getConversation(conversationId: string, userId: string) {
  const result = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { turnNumber: 'asc' } }, summary: true, summaryJob: { select: { state: true } } },
  });
  if (!result) throw new Error('Conversation not found');
  return result;
}

export const getUserSummaries = (userId: string, limit: number) => prisma.conversationSummary.findMany({
  where: { conversation: { userId } }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 20),
});

export const getUserProfile = (userId: string) => prisma.customerProfile.findUnique({ where: { userId } });

export const getSavedConversations = (userId: string, limit: number) => prisma.conversation.findMany({
  where: { userId, transcriptConsent: true, status: 'ENDED' },
  orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 30),
  select: { id: true, createdAt: true, endedAt: true,
    summary: { select: { summary: true, keyThemes: true } },
    summaryJob: { select: { state: true } } },
});
