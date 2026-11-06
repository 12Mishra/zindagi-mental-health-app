export type Consent = { brief: boolean; identity: boolean; contact: boolean };

export type AppointmentStatus =
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'NO_SHOW'
  | 'CANCELLED_STUDENT'
  | 'CANCELLED_THERAPIST';

export type Appointment = {
  id: string;
  sessionCode: string;
  pseudonym: string;
  startsAt: string;
  endsAt: string;
  mode: 'IN_PERSON' | 'PHONE' | 'VIDEO';
  reason: string | null;
  status: AppointmentStatus;
  consent: Consent;
};

export type MoodTrend = 'improving' | 'stable' | 'declining' | 'unknown';

export type CareBrief = {
  presenting: string;
  themes: string[];
  moodTrend: MoodTrend;
  /** Optional recent mood scores (0-10) used only to draw the sparkline. */
  moodSeries?: number[];
  riskLevels: Array<'LOW' | 'ELEVATED' | 'URGENT' | 'UNKNOWN'>;
  whatHelped: string[];
  openThreads: string[];
  caution: string;
};

export type Slot = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'BOOKED' | 'REMOVED';
  pseudonym?: string;
};

export type Identity = { name: string; phone?: string };

export type SavedNote = { id: string; createdAt: string; text: string };

export type AppointmentDetail = {
  appointment: Appointment;
  brief: CareBrief | null;
  identity: Identity | null;
  notes: SavedNote[];
};
