import { apiRequest } from '@/lib/conversation-api';

export type SessionMode = 'IN_PERSON' | 'PHONE' | 'VIDEO';
export type RequestStatus = 'PENDING' | 'PROPOSED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
export type AppointmentStatus = 'CONFIRMED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED_STUDENT' | 'CANCELLED_THERAPIST';

export type Counsellor = { id: string; name: string; languages: string[]; bio: string | null };
export type OpenSlot = { id: string; therapistId: string; startsAt: string; endsAt: string; mode: SessionMode };
export type Busy = { therapistId: string; startsAt: string; endsAt: string };
export type Availability = { counsellors: Counsellor[]; openSlots: OpenSlot[]; busy: Busy[] };

export type SessionRequest = {
  id: string; status: RequestStatus; rollNumber: string; branch: string; mode: SessionMode; windows: string[];
  counsellor: { id: string; name: string } | null; handledBy: string | null;
  proposedStartsAt: string | null; counsellorNote: string | null; appointmentId: string | null;
  createdAt: string; updatedAt: string;
};

export type Appointment = {
  id: string; status: AppointmentStatus; sessionCode: string; startsAt: string; endsAt: string; mode: SessionMode; therapistName: string;
};

export type NewRequest = { rollNumber: string; branch: string; mode: SessionMode; therapistId?: string | null } & (
  | { windows: string[] }
  | { slotId: string }
);

const base = '/api/booking';

export const getAvailability = (token: string) => apiRequest<Availability>(`${base}/availability`, { token });
export const listRequests = (token: string) => apiRequest<SessionRequest[]>(`${base}/requests`, { token });
export const listAppointments = (token: string) => apiRequest<Appointment[]>(`${base}/appointments`, { token });
export const createRequest = (token: string, body: NewRequest) =>
  apiRequest<SessionRequest>(`${base}/requests`, { method: 'POST', token, body: body as unknown as Record<string, unknown> });
export const acceptProposal = (token: string, id: string) =>
  apiRequest<{ request: SessionRequest }>(`${base}/requests/${id}/respond`, { method: 'POST', token, body: { action: 'accept' } });
export const offerNewTimes = (token: string, id: string, windows: string[]) =>
  apiRequest<{ request: SessionRequest }>(`${base}/requests/${id}/respond`, { method: 'POST', token, body: { action: 'decline', windows } });
export const cancelRequest = (token: string, id: string) => apiRequest<SessionRequest>(`${base}/requests/${id}/cancel`, { method: 'POST', token });
export const cancelAppointment = (token: string, id: string) => apiRequest<Appointment>(`${base}/appointments/${id}/cancel`, { method: 'POST', token });

// ── Time helpers: office hours are 09:00–17:00 IST, weekdays, next 14 days (mirrors server/src/booking/windows.ts). ──

export const FIRST_HOUR = 9;
export const LAST_START_HOUR = 16;
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Upcoming weekdays (IST) as midnight-IST epoch ms, starting today. */
export function officeDays(count = 10, now = Date.now()): number[] {
  const days: number[] = [];
  let day = Math.floor((now + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
  while (days.length < count && day < now + 14 * DAY_MS) {
    const wd = new Date(day + IST_MS).getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(day);
    day += DAY_MS;
  }
  return days;
}

export const hourStart = (dayMs: number, hour: number) => new Date(dayMs + hour * 3_600_000).toISOString();

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts });
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const weekdayFmt = fmt({ weekday: 'short' });
const dateFmt = fmt({ day: 'numeric' });
const timeFmt = fmt({ hour: 'numeric', minute: '2-digit', hour12: true });

export const fmtDay = (iso: string | number) => dayFmt.format(new Date(iso));
export const fmtWeekday = (ms: number) => weekdayFmt.format(new Date(ms));
export const fmtDateNum = (ms: number) => dateFmt.format(new Date(ms));
export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtSlot = (iso: string) => `${fmtDay(iso)}, ${fmtTime(iso)}`;
export const fmtHour = (h: number) => `${h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`;

export const MODE_LABEL: Record<SessionMode, string> = { IN_PERSON: 'In person', PHONE: 'Phone call', VIDEO: 'Video' };
