// Data layer: every function calls core (server/). Pages never talk to the database or to mock data.
import { coreJson } from './core';
import type { AlertsData, Overview, Staff } from './types';

const titleCase = (value: string) => value.charAt(0) + value.slice(1).toLowerCase();

/** GET /admin/overview. `cohort` is `all`, `year:N` or `dept:CODE`; core rejects groups that are too small (422). */
export async function getOverview(cohort = 'all'): Promise<Overview> {
  const data = await coreJson<Overview>(`/admin/overview?cohort=${encodeURIComponent(cohort)}`);
  // Core sends topic enums (ACADEMIC); the UI shows Academic.
  return { ...data, problems: data.problems?.map((p) => ({ ...p, topic: titleCase(p.topic) })) ?? null };
}

/** GET /admin/alerts (newest 50) and GET /admin/therapists (for the assign menu). */
export async function getAlerts(): Promise<AlertsData> {
  const [list, therapists] = await Promise.all([
    coreJson<{ alerts: AlertsData['alerts']; next: string | null }>('/admin/alerts'),
    coreJson<Array<{ id: string; displayName: string }>>('/admin/therapists'),
  ]);
  return {
    asOf: new Date().toISOString(),
    alerts: list.alerts,
    therapists: therapists.map((t) => ({ id: t.id, label: t.displayName })),
  };
}

/** GET /staff/me */
export const getMe = () => coreJson<Staff>('/staff/me');
