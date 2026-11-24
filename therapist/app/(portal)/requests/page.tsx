import Link from 'next/link';
import { IconCalendar } from '@/components/Icons';
import { RequestCard } from '@/components/RequestCard';
import { getRequests } from '@/lib/data';

export const dynamic = 'force-dynamic';

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams;
  const history = view === 'history';
  const requests = await getRequests(history ? 'all' : 'open');
  const needsYou = requests.filter((r) => r.status === 'PENDING');
  const waiting = requests.filter((r) => r.status === 'PROPOSED');

  return (
    <>
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div>
          <h1 className="page-title">Session requests</h1>
          <p className="subtitle">
            Students ask for a session and say when they&apos;re free. You only see requests addressed to you or to any counsellor.
          </p>
        </div>
        <nav className="tabs" aria-label="Request view">
          <Link href="/requests" className={`btn small ${history ? 'ghost' : 'secondary'}`} aria-current={!history ? 'page' : undefined}>Open</Link>
          <Link href="/requests?view=history" className={`btn small ${history ? 'secondary' : 'ghost'}`} aria-current={history ? 'page' : undefined}>History</Link>
        </nav>
      </div>

      {history ? (
        <section className="stack" aria-label="All requests">
          {requests.length === 0 ? <Empty text="No requests yet." /> : (
            <ul className="req-list">{requests.map((r) => <li key={r.id}><RequestCard req={r} /></li>)}</ul>
          )}
        </section>
      ) : (
        <>
          <section className="stack" aria-labelledby="needs-h">
            <h2 className="section-title" id="needs-h">Needs a time ({needsYou.length})</h2>
            {needsYou.length === 0 ? <Empty text="You're all caught up." /> : (
              <ul className="req-list">{needsYou.map((r) => <li key={r.id}><RequestCard req={r} /></li>)}</ul>
            )}
          </section>
          {waiting.length > 0 && (
            <section className="stack" aria-labelledby="wait-h">
              <h2 className="section-title" id="wait-h">Waiting for the student ({waiting.length})</h2>
              <ul className="req-list">{waiting.map((r) => <li key={r.id}><RequestCard req={r} /></li>)}</ul>
            </section>
          )}
        </>
      )}
    </>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="card empty">
      <IconCalendar size={28} />
      <strong>{text}</strong>
      <p className="sublabel">New requests from the app appear here.</p>
    </div>
  );
}
