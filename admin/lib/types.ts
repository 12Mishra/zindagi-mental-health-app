// Mirrors the responses of core's /admin/* and /staff/me endpoints (server/src/insights/overview.ts, alerts.ts).
export type KpiId = 'students' | 'mood' | 'alerts' | 'sessions';
export type AlertKind = 'RISK' | 'DISENGAGEMENT' | 'COHORT_DIP';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AlertStatus = 'NEW' | 'ACK' | 'RESOLVED';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: Severity;
  status: AlertStatus;
  message: string;
  /** Pseudonym such as #KR047; core never sends a name or any other identifier. */
  subject: string | null;
  cohortKey: string | null;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  assigneeId: string | null;
}

export interface Kpi {
  id: KpiId;
  /** null = hidden because fewer than k students stand behind it */
  value: number | null;
  delta: string;
  spark: (number | null)[];
}

export interface Overview {
  asOf: string;
  institution: { name: string; activeStudents: number | null };
  kpis: Kpi[];
  /** [week][day], 0 = no data or suppressed */
  heatmap: number[][];
  problems: Array<{ topic: string; pct: number }> | null;
  years: Array<{ year: number; pct: number }> | null;
  alerts: Alert[];
}

export interface Therapist {
  id: string;
  label: string;
}

export interface AlertsData {
  asOf: string;
  alerts: Alert[];
  therapists: Therapist[];
}

export interface Staff {
  id: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'THERAPIST';
  institution: { id: string; name: string; slug: string } | null;
}
