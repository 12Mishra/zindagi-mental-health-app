import { ChatWorkspace } from '@/components/ChatWorkspace';
import { getChatPage, getChatThreads } from '@/lib/data';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Messages · Zindagi Counsellor' };

export default async function MessagesPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const threads = await getChatThreads();
  const id = t ?? (threads[0]?.id || null);
  const page = id ? await getChatPage(id) : null;
  return (
    <>
      <div>
        <h1 className="page-title">Messages</h1>
        <p className="subtitle">Text chat with students you have a session or request with. Students are told it isn&apos;t monitored outside office hours.</p>
      </div>
      {/* Keyed by thread so a link to another conversation remounts with its data. */}
      <ChatWorkspace key={page?.thread.id ?? 'none'} initialThreads={threads} initialPage={page} />
    </>
  );
}
