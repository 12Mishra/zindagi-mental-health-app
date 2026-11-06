import { MODE_LABEL, STATUS_LABEL } from '@/lib/format';
import type { Appointment, Consent } from '@/lib/types';
import { IconLock, IconShield, IconUser } from './Icons';

export function ReasonChip({ reason }: { reason: string | null }) {
  return <span className="chip neutral">{reason ?? 'No reason given'}</span>;
}

export function ModeChip({ mode }: { mode: Appointment['mode'] }) {
  return <span className="chip outline">{MODE_LABEL[mode]}</span>;
}

export function StatusChip({ status }: { status: Appointment['status'] }) {
  const cls =
    status === 'CONFIRMED' ? 'chip' : status === 'COMPLETED' ? 'chip neutral' : 'chip alert';
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

export function ConsentBadges({ consent }: { consent: Consent }) {
  if (!consent.brief && !consent.identity) {
    return (
      <span className="chip outline">
        <IconLock size={12} /> No data shared
      </span>
    );
  }
  return (
    <>
      {consent.brief && (
        <span className="chip">
          <IconShield size={12} /> Summary shared
        </span>
      )}
      {consent.identity && (
        <span className="chip">
          <IconUser size={12} /> Identity shared
        </span>
      )}
    </>
  );
}
