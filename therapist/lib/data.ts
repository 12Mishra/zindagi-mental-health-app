// Data layer: server-only reads from core (CORE_API_URL) with the signed-in counsellor's token.
// Mutations live in lib/actions.ts as server actions.
import { CoreError, coreJson } from './core';
import { dayKey } from './format';
import type { Appointment, AppointmentDetail, ChatThreadPage, ChatThreadSummary, Me, SessionRequest, Slot } from './types';

const IST = '+05:30';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Counselling cell office hours: 1-hour sessions starting 09:00 to 16:00. */
export const FIRST_HOUR = 9;
export const LAST_START_HOUR = 16;
const WEEKDAYS = 5;

const at = (day: string, hhmm: string) => `${day}T${hhmm}:00${IST}`;

/** Monday (IST) of the week containing `day`. */
export function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00${IST}`);
  const dow = (d.getUTCDay() + 6) % 7; // Mon=0
  return dayKey(new Date(d.getTime() - dow * DAY_MS));
}
export function addDays(day: string, n: number): string {
  return dayKey(new Date(new Date(`${day}T12:00:00${IST}`).getTime() + n * DAY_MS));
}
export function currentWeekStart(): string {
  return mondayOf(dayKey(new Date()));
}

export const getMe = () => coreJson<Me>('/staff/me');

export const getAppointments = () => coreJson<Appointment[]>('/therapist/appointments');

export async function getAppointment(id: string): Promise<AppointmentDetail | null> {
  try {
    return await coreJson<AppointmentDetail>(`/therapist/appointments/${encodeURIComponent(id)}`);
  } catch (error) {
    if (error instanceof CoreError && error.status === 404) return null;
    throw error;
  }
}

export const getRequests = (scope: 'open' | 'all' = 'open') => coreJson<SessionRequest[]>(`/therapist/requests?scope=${scope}`);

type CoreSlot = { id: string; startsAt: string; endsAt: string; status: Slot['status']; pseudonym?: string };

/**
 * A full Mon–Fri × office-hours grid for the week starting `weekStart` (a Monday, YYYY-MM-DD), day-major.
 * Hours with no slot in core come back with `id: null` and status REMOVED (closed).
 */
export async function getSlots(weekStart: string): Promise<Slot[]> {
  const from = new Date(at(weekStart, '00:00'));
  const to = new Date(from.getTime() + WEEKDAYS * DAY_MS);
  const rows = await coreJson<CoreSlot[]>(`/therapist/slots?from=${from.toISOString()}&to=${to.toISOString()}`);
  const now = Date.now();
  const grid: Slot[] = [];
  for (let d = 0; d < WEEKDAYS; d++) {
    const day = addDays(weekStart, d);
    for (let h = FIRST_HOUR; h <= LAST_START_HOUR; h++) {
      const startsAt = at(day, `${String(h).padStart(2, '0')}:00`);
      const start = new Date(startsAt).getTime();
      // Prefer a booked slot that starts in this hour, then any other slot starting in it.
      const inHour = rows.filter(s => { const t = new Date(s.startsAt).getTime(); return t >= start && t < start + HOUR_MS; });
      const slot = inHour.find(s => s.status === 'BOOKED') ?? inHour[0];
      grid.push(slot
        ? { id: slot.id, startsAt: slot.startsAt, endsAt: slot.endsAt, status: slot.status, pseudonym: slot.pseudonym, past: start <= now }
        : { id: null, startsAt, endsAt: new Date(start + HOUR_MS).toISOString(), status: 'REMOVED', past: start <= now });
    }
  }
  return grid;
}

export const getChatThreads = () => coreJson<ChatThreadSummary[]>('/therapist/chat/threads');
/** Unread chat messages for the nav badge; a core failure shows no badge rather than breaking the page. */
export async function getChatUnread(): Promise<number> {
  try {
    return (await coreJson<{ unread: number }>('/therapist/chat/unread')).unread;
  } catch (error) {
    if (error instanceof CoreError) return 0;
    throw error; // e.g. redirect() to sign-in
  }
}
export async function getChatPage(threadId: string): Promise<ChatThreadPage | null> {
  try {
    return await coreJson<ChatThreadPage>(`/therapist/chat/threads/${encodeURIComponent(threadId)}/messages`);
  } catch (error) {
    if (error instanceof CoreError && error.status === 404) return null;
    throw error;
  }
}
