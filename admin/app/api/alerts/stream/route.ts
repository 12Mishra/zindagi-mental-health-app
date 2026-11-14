import { cookies } from 'next/headers';
import { CORE_URL } from '@/lib/core';
import { SESSION_COOKIE } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Server-sent events proxy: the browser connects here (same origin, cookie auth) and this route streams core's
 * /admin/alerts/stream back with the Authorization header the browser never sees.
 */
export async function GET(request: Request) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return new Response('Unauthorized', { status: 401 });

  let upstream: Response;
  try {
    upstream = await fetch(`${CORE_URL}/admin/alerts/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: request.signal, // closing the browser tab closes the upstream connection too
      cache: 'no-store',
    });
  } catch {
    return new Response('Core unavailable', { status: 502 });
  }
  if (!upstream.ok || !upstream.body) return new Response('Stream unavailable', { status: upstream.status === 401 ? 401 : 502 });

  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
  });
}
