import Link from 'next/link';
import { fmtShortDate, fmtTimeRange } from '@/lib/format';
import type { Appointment } from '@/lib/types';
import { ConsentBadges, ModeChip, ReasonChip } from './Chips';

export function AppointmentCard({ appt, showDate }: { appt: Appointment; showDate?: boolean }) {
  return (
    <Link href={`/appointments/${appt.id}`} className="appt-card" aria-label={`Open session ${appt.sessionCode}`}>
      <div className="appt-time">{fmtTimeRange(appt.startsAt, appt.endsAt)}</div>
      <div className="appt-meta">
        {showDate && <span>{fmtShortDate(appt.startsAt)}</span>}
        <span className="mono">{appt.sessionCode}</span>
        <span>{appt.pseudonym}</span>
      </div>
      <div className="chips">
        <ReasonChip reason={appt.reason} />
        <ModeChip mode={appt.mode} />
        <ConsentBadges consent={appt.consent} />
      </div>
    </Link>
  );
}
