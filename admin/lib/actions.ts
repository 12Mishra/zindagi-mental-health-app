'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { CORE_URL, CoreError, coreJson } from './core';
import { SESSION_COOKIE } from './session';
import type { Alert, AlertStatus } from './types';

export type SignInState = { error?: string };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Signs in against core's /staff/login (admin portal only) and stores the token in an httpOnly cookie. */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  let res: Response;
  try {
    res = await fetch(`${CORE_URL}/staff/login`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, portal: 'admin' }),
    });
  } catch {
    return { error: 'Cannot reach the Zindagi server. Check that it is running.' };
  }
  const body = await res.json().catch(() => null) as { token?: string; expiresAt?: string; error?: string } | null;
  if (!res.ok || !body?.token) {
    return { error: res.status === 429 ? 'Too many attempts. Wait a minute and try again.' : body?.error ?? 'Sign-in failed.' };
  }
  (await cookies()).set(SESSION_COOKIE, body.token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/',
    expires: body.expiresAt ? new Date(body.expiresAt) : undefined,
  });
  redirect('/'); // outside the try: redirect() works by throwing
}

/** Revokes the session in core (best effort), clears the cookie and returns to the sign-in page. */
export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await fetch(`${CORE_URL}/staff/logout`, { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

async function guarded<T>(run: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof CoreError) return { ok: false, error: error.message };
    throw error; // includes redirect() for expired sessions
  }
}

/** PATCH /admin/alerts/:id: change status and/or assignee. Returns the updated alert. */
export async function updateAlert(id: string, patch: { status?: AlertStatus; assigneeId?: string | null }): Promise<ActionResult<Alert>> {
  return guarded(() => coreJson<Alert>(`/admin/alerts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }));
}

/** POST /admin/alerts/:id/outreach: an in-app invitation to the student; the admin never learns who they are. */
export async function sendOutreach(id: string): Promise<ActionResult<{ ok: true }>> {
  return guarded(() => coreJson<{ ok: true }>(`/admin/alerts/${encodeURIComponent(id)}/outreach`, { method: 'POST', body: {} }));
}
