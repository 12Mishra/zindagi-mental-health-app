'use client';

import Link from 'next/link';
import { useState } from 'react';
import { fmtDate, fmtTimeRange } from '@/lib/format';
import type { Appointment, AppointmentStatus } from '@/lib/types';
import { ModeChip, ReasonChip, StatusChip } from './Chips';
import { ConfirmDialog } from './ConfirmDialog';
import { IconChevronLeft } from './Icons';

export function SessionHeader({ appt }: { appt: Appointment }) {
  const [status, setStatus] = useState<AppointmentStatus>(appt.status);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const open = status === 'CONFIRMED';

  function change(next: AppointmentStatus, text: string) {
    setStatus(next);
    setMsg(text);
    setConfirming(false);
  }

  return (
    <section className="card" aria-labelledby="sess-h">
      <Link href="/" className="btn ghost small" style={{ marginLeft: -10, marginBottom: 6 }}>
        <IconChevronLeft size={16} /> Today
      </Link>
      <div className="card-head" style={{ marginBottom: 8 }}>
        <div>
          <h1 className="page-title" id="sess-h">
            <span className="mono" style={{ fontSize: 'inherit' }}>{appt.sessionCode}</span>
          </h1>
          <p className="subtitle">
            {fmtDate(appt.startsAt)} · {fmtTimeRange(appt.startsAt, appt.endsAt)} · {appt.pseudonym}
          </p>
        </div>
        <StatusChip status={status} />
      </div>
      <div className="chips" style={{ marginTop: 0, marginBottom: 14 }}>
        <ReasonChip reason={appt.reason} />
        <ModeChip mode={appt.mode} />
      </div>
      <div className="btn-row">
        <button type="button" className="btn" disabled={!open} onClick={() => change('COMPLETED', 'Marked as completed.')}>
          Mark completed
        </button>
        <button type="button" className="btn secondary" disabled={!open} onClick={() => change('NO_SHOW', 'Marked as no-show.')}>
          Mark no-show
        </button>
        <button type="button" className="btn danger" disabled={!open} onClick={() => setConfirming(true)}>
          Cancel appointment
        </button>
      </div>
      <p className="sublabel" role="status" style={{ marginTop: 10, minHeight: 16 }}>
        {msg || (open ? 'Changes here are local in this prototype.' : '')}
      </p>
      <ConfirmDialog
        open={confirming}
        title="Cancel this appointment?"
        body="The slot will reopen and the student will be told the session was cancelled."
        confirmLabel="Cancel appointment"
        onConfirm={() => change('CANCELLED_THERAPIST', 'Appointment cancelled. The slot is open again.')}
        onCancel={() => setConfirming(false)}
      />
    </section>
  );
}
