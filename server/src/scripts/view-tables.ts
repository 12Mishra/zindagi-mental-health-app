import { prisma } from '../db';

async function main() {
  console.log('\n========================================');
  console.log('       NEON DATABASE TABLES VIEWER      ');
  console.log('========================================\n');

  const [userCount, sessionCount, convCount, msgCount, summaryCount, profileCount] = await Promise.all([
    prisma.user.count(),
    prisma.session.count(),
    prisma.conversation.count(),
    prisma.message.count(),
    prisma.conversationSummary.count(),
    prisma.customerProfile.count(),
  ]);

  console.log('TABLE ROW COUNTS:');
  console.log(`- User:                 ${userCount}`);
  console.log(`- Session:              ${sessionCount}`);
  console.log(`- Conversation:         ${convCount}`);
  console.log(`- Message:              ${msgCount}`);
  console.log(`- ConversationSummary:  ${summaryCount}`);
  console.log(`- CustomerProfile:      ${profileCount}\n`);

  console.log('--- RECENT USERS ---');
  const users = await prisma.user.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    select: { id: true, phoneNumber: true, fullName: true, age: true, college: true, createdAt: true },
  });
  console.table(users);

  console.log('\n--- RECENT CONVERSATIONS ---');
  const convs = await prisma.conversation.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { fullName: true, phoneNumber: true } },
      summary: { select: { summary: true, keyThemes: true } },
      _count: { select: { messages: true } },
    },
  });
  console.log(
    convs.map((c) => ({
      id: c.id,
      user: c.user.fullName,
      status: c.status,
      messageCount: c._count.messages,
      summary: c.summary?.summary || 'No summary yet',
      keyThemes: c.summary?.keyThemes || [],
      createdAt: c.createdAt.toISOString(),
    }))
  );

  console.log('\n--- CUSTOMER PROFILES (EXTRACTED THEMES & KEYWORDS) ---');
  const profiles = await prisma.customerProfile.findMany({
    take: 5,
    include: { user: { select: { fullName: true } } },
  });
  console.log(
    profiles.map((p) => ({
      user: p.user.fullName,
      keywords: p.keywords,
      themes: p.themes,
      riskFlags: p.riskFlags,
      updatedAt: p.updatedAt.toISOString(),
    }))
  );
  console.log('\n========================================\n');
}

main()
  .catch((e) => console.error('Error fetching tables:', e))
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
