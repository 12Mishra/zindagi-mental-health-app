/** Today's date (YYYY-MM-DD) in the given IANA timezone. */
export const todayIn = (timeZone: string, now = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

export const addDays = (ymd: string, days: number): string => {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** The Monday of the week containing `ymd`; also used as the week's identifier. */
export const mondayOf = (ymd: string): string => {
  const weekday = (new Date(`${ymd}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(ymd, -weekday);
};

/** A `YYYY-MM-DD` string as a UTC midnight Date (the form Prisma returns for `@db.Date` columns). */
export const ymdToDate = (ymd: string): Date => new Date(`${ymd}T00:00:00Z`);
export const dateToYmd = (date: Date): string => date.toISOString().slice(0, 10);
