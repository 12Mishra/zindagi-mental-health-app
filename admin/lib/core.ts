import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE } from './session';

/** Base URL of the Zindagi core API (server/). Only ever called from the server side of this app. */
export const CORE_URL = (process.env.CORE_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

/** A failed call to core. 401 never reaches callers: it redirects to the sign-in page instead. */
export class CoreError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * Calls core with the signed-in staff member's token. Use from server components and server actions.
 * Missing or rejected sessions redirect to /login (redirect() throws, so never wrap this in a catch-all).
 */
export async function coreJson<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');

  let res: Response;
  try {
    res = await fetch(`${CORE_URL}${path}`, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new CoreError(503, 'Cannot reach the Zindagi server. Check that it is running.');
  }

  if (res.status === 401) redirect('/login?expired=1');
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
      ? data.error : `Request failed (${res.status}).`;
    throw new CoreError(res.status, message);
  }
  return data as T;
}
