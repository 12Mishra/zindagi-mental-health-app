'use client';

import { Empty } from '@/components/States';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page">
      <div className="card">
        <Empty title="Couldn't load the data" hint="Check that the Zindagi server is running, then try again." />
        <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 12 }}>
          <button type="button" className="btn" onClick={reset}>Try again</button>
        </div>
      </div>
    </main>
  );
}
