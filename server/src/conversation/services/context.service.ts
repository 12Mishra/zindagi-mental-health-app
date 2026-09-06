import { prisma } from '../../db';

export const buildConversationContext = async (userId: string, conversationId: string): Promise<{ systemPrompt: string; messages: { role: string; content: string }[] }> => {
  // Fetch user data
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { fullName: true, age: true, college: true, sex: true, history: true }
  });

  // Fetch last 5 ConversationSummaries
  const summaries = await prisma.conversationSummary.findMany({
    where: { conversation: { userId } },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Fetch CustomerProfile
  const profile = await prisma.customerProfile.findUnique({
    where: { userId },
  });

  // Fetch current conversation messages
  const conversationMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { turnNumber: 'asc' },
  });

  const formattedMessages = conversationMessages.map(msg => ({
    role: msg.role === 'USER' ? 'user' : 'assistant',
    content: msg.content,
  }));

  let systemPrompt = `You are Lisa, an empathetic and supportive AI mental health companion for the Zindagi app.
User's Name: ${user?.fullName ?? 'Unknown'}
Age: ${user?.age ?? 'Unknown'}
College: ${user?.college ?? 'Unknown'}
Sex: ${user?.sex ?? 'Unknown'}
Medical/Therapy History: ${user?.history.join(', ') || 'None provided'}
`;

  if (profile) {
    systemPrompt += `\nUser's Profile Themes: ${profile.themes.join(', ') || 'None'}
User's Risk Flags: ${profile.riskFlags.join(', ') || 'None'}`;
  }

  if (summaries.length > 0) {
    systemPrompt += `\n\nRecent Conversation Summaries:\n`;
    summaries.reverse().forEach((s, idx) => {
      systemPrompt += `${idx + 1}. ${s.summary} (Themes: ${s.keyThemes.join(', ')})\n`;
    });
  }

  systemPrompt += `\nCRITICAL INSTRUCTION: You are speaking in a voice conversation. Keep your responses warm, empathetic, and concise (2 to 3 sentences maximum). Never give bulleted lists or long monologues. Validate feelings and ask one gentle follow-up question. If you see severe crisis, recommend professional help.`;

  return {
    systemPrompt,
    messages: formattedMessages,
  };
};
