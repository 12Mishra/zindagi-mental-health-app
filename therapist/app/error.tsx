'use client';

/** Shown instead of Next's bare "Application error" screen when a page or the portal layout fails (e.g. core is down). */
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="container">
      <div className="card empty" role="alert">
        <strong>Couldn&apos;t load this page</strong>
        <p className="sublabel">Check that the Zindagi server is running, then try again.</p>
        <button type="button" className="btn" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
