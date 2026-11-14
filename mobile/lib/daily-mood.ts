// Today's mood check-in. Asked once per local calendar day, then reused for every conversation that day.
// Stored per user so a second account on the same device is still asked.
export type DailyMood = { date: string; moods: string[]; note: string };

const keyFor = (userId: string) => `zindagi_daily_mood:${userId}`;
const memory = new Map<string, DailyMood>();

/** Local calendar day, so "today" matches the student's day rather than UTC. */
export const todayKey = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

const storage = () => (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);

/** Today's saved mood for this user, or null when they have not checked in yet today. */
export const getTodayMood = (userId: string | undefined): DailyMood | null => {
  if (!userId) return null;
  let saved = memory.get(userId) ?? null;
  if (!saved) {
    try {
      const raw = storage()?.getItem(keyFor(userId));
      if (raw) saved = JSON.parse(raw) as DailyMood;
    } catch {}
  }
  if (!saved || saved.date !== todayKey() || !Array.isArray(saved.moods) || !saved.moods.length) return null;
  memory.set(userId, saved);
  return saved;
};

export const saveTodayMood = (userId: string | undefined, moods: string[], note: string) => {
  if (!userId) return;
  const value: DailyMood = { date: todayKey(), moods, note };
  memory.set(userId, value);
  try { storage()?.setItem(keyFor(userId), JSON.stringify(value)); } catch {}
};
