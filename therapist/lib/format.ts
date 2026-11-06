// Fixed time zone so server and client render identical text (no hydration drift).
const TZ = 'Asia/Kolkata';

const timeFmt = new Intl.DateTimeFormat('en-IN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
});
const dateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: TZ,
});
const shortDateFmt = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: TZ,
});
const stampFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: TZ,
});
const dayKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ });

export const fmtTime = (iso: string) => timeFmt.format(new Date(iso));
export const fmtTimeRange = (a: string, b: string) => `${fmtTime(a)} – ${fmtTime(b)}`;
export const fmtDate = (iso: string) => dateFmt.format(new Date(iso));
export const fmtShortDate = (iso: string) => shortDateFmt.format(new Date(iso));
export const fmtStamp = (iso: string) => stampFmt.format(new Date(iso));
/** YYYY-MM-DD in IST. */
export const dayKey = (iso: string | Date) => dayKeyFmt.format(typeof iso === 'string' ? new Date(iso) : iso);

export const MODE_LABEL = { IN_PERSON: 'In person', PHONE: 'Phone', VIDEO: 'Video' } as const;

export const STATUS_LABEL = {
  CONFIRMED: 'Confirmed',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CANCELLED_STUDENT: 'Cancelled by student',
  CANCELLED_THERAPIST: 'Cancelled by you',
} as const;

export function greeting(now = new Date()) {
  const h = Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: TZ }).format(now),
  );
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}
