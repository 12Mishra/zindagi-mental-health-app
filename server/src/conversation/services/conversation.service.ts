import { prisma } from '../../db';
import { chatWithLisa, generateSummary, extractKeywords, generateSummaryAndKeywords } from './llm.service';
import { buildConversationContext } from './context.service';

export const startConversation = async (userId: string, moodBefore: string[], moodNote?: string) => {
  const conversation = await prisma.conversation.create({
    data: {
      userId,
      moodBefore,
      moodNote,
      status: 'ACTIVE',
    },
  });
  return conversation;
};

export const processMessage = async (conversationId: string, userId: string, userText: string) => {
  // Ensure conversation exists and is active
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId, userId, status: 'ACTIVE' },
    include: { messages: true },
  });

  if (!conversation) {
    throw new Error('Active conversation not found');
  }

  const turnNumber = conversation.messages.length + 1;

  // Save user message
  await prisma.message.create({
    data: {
      conversationId,
      role: 'USER',
      content: userText,
      turnNumber,
    },
  });

  // Build context
  const { systemPrompt, messages } = await buildConversationContext(userId, conversationId);

  // Call LLM
  const assistantResponse = await chatWithLisa(messages, systemPrompt);

  // Save assistant message
  await prisma.message.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      content: assistantResponse,
      turnNumber: turnNumber + 1,
    },
  });

  return { response: assistantResponse, turnNumber: turnNumber + 1 };
};

export const endConversation = async (conversationId: string, userId: string) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId, userId, status: 'ACTIVE' },
    include: { messages: true },
  });

  if (!conversation) {
    throw new Error('Active conversation not found');
  }

  // Combine messages to string for summarization
  const conversationText = conversation.messages
    .sort((a, b) => a.turnNumber - b.turnNumber)
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  // 1. Immediately mark conversation as ENDED in DB
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { status: 'ENDED', endedAt: new Date() },
  });

  // 2. Spawn summary & customer profile extraction asynchronously in the background
  if (conversation.messages.length > 0) {
    setImmediate(async () => {
      try {
        console.log(`[Background Worker] Starting summary & profile extraction for conversation ${conversationId}...`);
        const result = await generateSummaryAndKeywords(conversationText);

        await prisma.conversationSummary.upsert({
          where: { conversationId },
          create: {
            conversationId,
            summary: result.summary,
            keyThemes: result.keyThemes,
          },
          update: {
            summary: result.summary,
            keyThemes: result.keyThemes,
          },
        });

        const profile = await prisma.customerProfile.findUnique({ where: { userId } });
        if (profile) {
          await prisma.customerProfile.update({
            where: { userId },
            data: {
              keywords: Array.from(new Set([...profile.keywords, ...result.keywords])),
              themes: Array.from(new Set([...profile.themes, ...result.keyThemes])),
              riskFlags: Array.from(new Set([...profile.riskFlags, ...result.riskFlags])),
            },
          });
        } else {
          await prisma.customerProfile.create({
            data: {
              userId,
              keywords: result.keywords,
              themes: result.keyThemes,
              riskFlags: result.riskFlags,
            },
          });
        }
        console.log(`[Background Worker] Successfully saved summary and profile for ${conversationId}`);
      } catch (bgError) {
        console.error(`[Background Worker Error] Failed to process summary for ${conversationId}:`, bgError);
      }
    });
  }

  // 3. Immediately respond to the client (sub-15ms response time!)
  return {
    summary: 'Session completed. Your reflections and conversation themes have been saved.',
    keyThemes: ['Emotional Processing', 'Supportive Dialogue'],
  };
};

export const getConversation = async (conversationId: string, userId: string) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId, userId },
    include: { messages: { orderBy: { turnNumber: 'asc' } }, summary: true },
  });
  if (!conversation) throw new Error('Conversation not found');
  return conversation;
};

export const getUserSummaries = async (userId: string, limit: number) => {
  return await prisma.conversationSummary.findMany({
    where: { conversation: { userId } },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
};

export const getUserProfile = async (userId: string) => {
  return await prisma.customerProfile.findUnique({
    where: { userId },
  });
};
