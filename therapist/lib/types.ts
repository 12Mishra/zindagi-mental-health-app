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
  /** What the student entered on the request form; null for sessions booked another way. */
  student: { rollNumber: string; branch: string } | null;
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
  /** Core's slot id, or null for an hour with no slot yet (shown as closed). */
  id: string | null;
  startsAt: string;
  endsAt: string;
  status: 'OPEN' | 'BOOKED' | 'REMOVED';
  pseudonym?: string;
  /** In the past: cannot be opened or removed. */
  past?: boolean;
};

export type Identity = { name: string; phone?: string };

export type SavedNote = { id: string; createdAt: string; text: string };

export type AppointmentDetail = {
  appointment: Appointment;
  brief: CareBrief | null;
  identity: Identity | null;
  notes: SavedNote[];
};

export type Me = { id: string; email: string; displayName: string; role: 'THERAPIST' | 'ADMIN'; institution: { name: string } | null };

export type RequestStatus = 'PENDING' | 'PROPOSED' | 'CONFIRMED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';

export type SessionRequest = {
  id: string;
  status: RequestStatus;
  rollNumber: string;
  branch: string;
  mode: Appointment['mode'];
  pseudonym: string;
  /** The student named this counsellor. */
  addressedToMe: boolean;
  handledByMe: boolean;
  handledBy: string | null;
  /** Future windows the student offered; `free` = this counsellor has nothing booked then. */
  windows: Array<{ startsAt: string; free: boolean }>;
  proposedStartsAt: string | null;
  counsellorNote: string | null;
  appointmentId: string | null;
  createdAt: string;
};

// ── Chat ──
export type ChatRole = 'STUDENT' | 'THERAPIST';
export type ChatMessage = { id: string; threadId: string; from: ChatRole; body: string; clientId: string | null; createdAt: string; flagged?: boolean };
export type ChatThreadSummary = {
  id: string;
  title: string;
  subtitle: string | null;
  lastMessage: { from: ChatRole; body: string; createdAt: string } | null;
  lastMessageAt: string | null;
  unread: number;
  urgent?: boolean;
};
export type ChatThreadPage = {
  thread: { id: string; title: string; subtitle: string | null; otherLastReadAt: string | null; urgent?: boolean };
  messages: ChatMessage[];
  hasMore: boolean;
};
export type ChatTicket = { ticket: string; expiresAt: string; path: string };
