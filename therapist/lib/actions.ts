'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { CORE_URL, CoreError, coreJson } from './core';
import { SESSION_COOKIE } from './session';
import type { AppointmentStatus, ChatMessage, ChatThreadPage, ChatThreadSummary, ChatTicket, SavedNote } from './types';

export type SignInState = { error?: string };
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

/** Signs in against core's /staff/login (therapist portal only) and stores the token in an httpOnly cookie. */
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  let res: Response;
  try {
    res = await fetch(`${CORE_URL}/staff/login`, {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, portal: 'therapist' }),
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

async function guarded<T>(run: () => Promise<T>, ...paths: string[]): Promise<ActionResult<T>> {
  try {
    const data = await run();
    for (const p of paths) revalidatePath(p);
    return { ok: true, data };
  } catch (error) {
    if (error instanceof CoreError) return { ok: false, error: error.message };
    throw error; // includes redirect() for expired sessions
  }
}

const enc = encodeURIComponent;

// ── Availability ──
export type CreatedSlot = { id: string; startsAt: string; endsAt: string; status: 'OPEN' };
export async function openSlot(startsAt: string, endsAt: string) {
  return guarded(() => coreJson<CreatedSlot>('/therapist/slots', { method: 'POST', body: { startsAt, endsAt, mode: 'IN_PERSON' } }), '/availability');
}
export async function removeSlot(id: string) {
  return guarded(() => coreJson<{ ok: true }>(`/therapist/slots/${enc(id)}`, { method: 'DELETE' }), '/availability');
}

// ── Appointments ──
export async function setAppointmentStatus(id: string, status: Extract<AppointmentStatus, 'COMPLETED' | 'NO_SHOW' | 'CANCELLED_THERAPIST'>) {
  return guarded(() => coreJson<{ ok: true; status: AppointmentStatus }>(`/therapist/appointments/${enc(id)}`, { method: 'PATCH', body: { status } }), '/', `/appointments/${id}`);
}
export async function addNote(id: string, text: string) {
  return guarded(() => coreJson<SavedNote>(`/therapist/appointments/${enc(id)}/notes`, { method: 'POST', body: { text } }));
}

// ── Session requests ──
export async function confirmRequest(id: string, startsAt: string) {
  return guarded(() => coreJson<{ appointmentId: string }>(`/therapist/requests/${enc(id)}/confirm`, { method: 'POST', body: { startsAt } }), '/', '/requests');
}
export async function proposeTime(id: string, startsAt: string, note: string) {
  return guarded(() => coreJson<{ ok: true }>(`/therapist/requests/${enc(id)}/propose`, { method: 'POST', body: { startsAt, note } }), '/requests');
}
export async function declineRequest(id: string, note: string) {
  return guarded(() => coreJson<{ ok: true }>(`/therapist/requests/${enc(id)}/decline`, { method: 'POST', body: { note } }), '/requests');
}
export async function releaseRequest(id: string) {
  return guarded(() => coreJson<{ ok: true }>(`/therapist/requests/${enc(id)}/release`, { method: 'POST' }), '/requests');
}

// ── Chat ──
// The browser never holds the counsellor's session token: it asks for a one-time socket ticket here.
export async function chatTicket() {
  return guarded(() => coreJson<ChatTicket>('/therapist/chat/ticket', { method: 'POST' }));
}
export async function chatThreads() {
  return guarded(() => coreJson<ChatThreadSummary[]>('/therapist/chat/threads'));
}
export async function chatPage(threadId: string, before?: string) {
  return guarded(() => coreJson<ChatThreadPage>(`/therapist/chat/threads/${enc(threadId)}/messages${before ? `?before=${enc(before)}` : ''}`));
}
export async function sendChat(threadId: string, body: string, clientId: string) {
  return guarded(() => coreJson<{ message: ChatMessage }>(`/therapist/chat/threads/${enc(threadId)}/messages`, { method: 'POST', body: { body, clientId } }));
}
export async function markChatRead(threadId: string) {
  return guarded(() => coreJson<{ ok: true; at: string }>(`/therapist/chat/threads/${enc(threadId)}/read`, { method: 'POST' }));
}
/** Opens (or reuses) the chat with the student behind an appointment or request, then goes to it. */
export async function openChat(ref: { appointmentId?: string; requestId?: string }): Promise<ActionResult<never>> {
  const res = await guarded(() => coreJson<{ threadId: string }>('/therapist/chat/threads', { method: 'POST', body: ref }));
  if (!res.ok) return res;
  redirect(`/messages?t=${enc(res.data.threadId)}`);
}
