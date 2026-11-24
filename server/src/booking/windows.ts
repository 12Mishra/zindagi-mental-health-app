/**
 * Rules for session-request time windows, matching the counselling cell's office hours:
 * one-hour slots starting on the hour, 09:00–17:00 IST, Monday to Friday, within the next two weeks.
 * Pure functions so they can be tested without a database.
 */

export const FIRST_HOUR = 9;
export const LAST_START_HOUR = 16; // the 16:00–17:00 slot is the last of the day
export const HORIZON_DAYS = 14;
export const MAX_WINDOWS = 12;
export const HOUR_MS = 3_600_000;

const IST_OFFSET_MS = 330 * 60_000;

/** Wall-clock parts of an instant in IST. */
export function istParts(d: Date) {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  return {
    weekday: ist.getUTCDay(), // 0 = Sunday
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
    second: ist.getUTCSeconds(),
    ms: ist.getUTCMilliseconds(),
  };
}

/** Why `start` is not a bookable window, or null when it is. */
export function windowProblem(start: Date, now = new Date()): string | null {
  if (Number.isNaN(start.getTime())) return 'is not a valid time';
  const p = istParts(start);
  if (p.minute || p.second || p.ms) return 'must start on the hour';
  if (p.weekday === 0 || p.weekday === 6) return 'must be on a weekday';
  if (p.hour < FIRST_HOUR || p.hour > LAST_START_HOUR) return 'must be between 09:00 and 17:00';
  if (start.getTime() <= now.getTime()) return 'is in the past';
  if (start.getTime() > now.getTime() + HORIZON_DAYS * 86_400_000) return `must be within the next ${HORIZON_DAYS} days`;
  return null;
}

/** Parses, de-duplicates, validates and sorts a list of window start times. Throws a readable message. */
export function parseWindows(input: unknown, now = new Date()): Date[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('Choose at least one time that works for you.');
  const unique = [...new Set(input.map(v => (typeof v === 'string' ? Date.parse(v) : NaN)))];
  if (unique.length > MAX_WINDOWS) throw new Error(`Choose at most ${MAX_WINDOWS} times.`);
  const dates = unique.map(ms => new Date(ms));
  for (const d of dates) {
    const problem = windowProblem(d, now);
    if (problem) throw new Error(`Each time ${problem}.`);
  }
  return dates.sort((a, b) => a.getTime() - b.getTime());
}

/** Windows that are still in the future. */
export const futureWindows = (windows: Date[], now = new Date()) => windows.filter(w => w.getTime() > now.getTime());

/** True when [aStart, aStart+1h) overlaps [bStart, bEnd). */
export const overlaps = (aStart: Date, bStart: Date, bEnd: Date) =>
  aStart.getTime() < bEnd.getTime() && aStart.getTime() + HOUR_MS > bStart.getTime();

const ROLL = /^[A-Za-z0-9/-]{3,20}$/;

/** Roll number and branch as the counselling form collects them, trimmed and validated. */
export function parseStudentDetails(rollNumber: unknown, branch: unknown): { rollNumber: string; branch: string } {
  const roll = typeof rollNumber === 'string' ? rollNumber.trim().toUpperCase() : '';
  const br = typeof branch === 'string' ? branch.trim().replace(/\s+/g, ' ') : '';
  if (!ROLL.test(roll)) throw new Error('Enter your roll number (letters and digits, 3–20 characters).');
  if (br.length < 2 || br.length > 60) throw new Error('Enter your branch.');
  return { rollNumber: roll, branch: br };
}
