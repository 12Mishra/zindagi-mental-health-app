export type KpiId = 'students' | 'mood' | 'alerts' | 'sessions';
export type AlertKind = 'RISK' | 'DISENGAGEMENT' | 'COHORT_DIP';
export type Severity = 'LOW' | 'MEDIUM' | 'HIGH';
export type AlertStatus = 'NEW' | 'ACK' | 'RESOLVED';

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: Severity;
  message: string;
  lastSeenAt: string;
  status: AlertStatus;
}

export interface Kpi {
  id: KpiId;
  value: number | null;
  delta: string;
  spark: (number | null)[];
}

export interface Overview {
  asOf: string;
  institution: { name: string; activeStudents: number };
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
