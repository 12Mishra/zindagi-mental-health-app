'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Re-fetches the server-rendered page when core reports an alert change (debounced). Renders nothing. */
export function LiveRefresh() {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource('/api/alerts/stream');
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 800);
    };
    source.addEventListener('alert.created', refresh);
    source.addEventListener('alert.updated', refresh);
    return () => { clearTimeout(timer); source.close(); };
  }, [router]);

  return null;
}
