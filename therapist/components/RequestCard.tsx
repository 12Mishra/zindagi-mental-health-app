'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { confirmRequest, declineRequest, proposeTime, releaseRequest } from '@/lib/actions';
import { fmtShortDate, fmtStamp, fmtTime, MODE_LABEL } from '@/lib/format';
import type { SessionRequest } from '@/lib/types';
import { ConfirmDialog } from './ConfirmDialog';
import { MessageStudentButton } from './MessageStudentButton';

type Panel = null | 'propose' | 'decline';

const STATUS_TEXT: Record<SessionRequest['status'], string> = {
  PENDING: 'Waiting for a time', PROPOSED: 'Waiting for the student', CONFIRMED: 'Confirmed',
  DECLINED: 'Declined', CANCELLED: 'Cancelled by student', EXPIRED: 'Expired',
};

/** Office-hours start times for the next `days` weekdays, grouped by IST date (YYYY-MM-DD). */
function proposalOptions(days = 10) {
  const out: Array<{ day: string; label: string; hours: string[] }> = [];
  const istNow = new Date(Date.now() + 330 * 60_000);
  for (let i = 0; out.length < days && i < 15; i++) {
    const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + i));
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const day = d.toISOString().slice(0, 10);
    const hours = Array.from({ length: 8 }, (_, h) => new Date(`${day}T${String(9 + h).padStart(2, '0')}:00:00+05:30`).toISOString())
      .filter((iso) => new Date(iso).getTime() > Date.now());
    if (hours.length) out.push({ day, label: fmtShortDate(hours[0]), hours });
  }
  return out;
}

export function RequestCard({ req }: { req: SessionRequest }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [chosen, setChosen] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState('');
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const options = panel === 'propose' ? proposalOptions() : [];
  const [propDay, setPropDay] = useState('');
  const [propHour, setPropHour] = useState('');
  const [note, setNote] = useState('');

  const open = req.status === 'PENDING' || (req.status === 'PROPOSED' && req.handledByMe);
  const awaitingStudent = req.status === 'PROPOSED';

  function run(work: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>, after?: (data: unknown) => void) {
    setError('');
    start(async () => {
      const res = await work();
      if (!res.ok) { setError(res.error); return; }
      after?.(res.data);
      router.refresh();
    });
  }

  const dayOpts = options.find((o) => o.day === propDay) ?? options[0];

  return (
    <article className="card" aria-labelledby={`req-${req.id}`}>
      <div className="card-head" style={{ marginBottom: 4 }}>
        <h3 className="section-title" id={`req-${req.id}`}>
          {req.addressedToMe ? 'Asked for you' : req.handledByMe ? 'You are handling this' : 'Any counsellor'}
        </h3>
        <span className={awaitingStudent ? 'chip neutral' : req.status === 'PENDING' ? 'chip alert' : 'chip outline'}>{STATUS_TEXT[req.status]}</span>
      </div>

      <div className="req-ident">
        <div><span className="sublabel">Roll number</span><strong className="mono">{req.rollNumber}</strong></div>
        <div><span className="sublabel">Branch</span><strong>{req.branch}</strong></div>
        <div><span className="sublabel">Mode</span><strong>{MODE_LABEL[req.mode]}</strong></div>
        <div><span className="sublabel">Sent</span><strong>{fmtStamp(req.createdAt)}</strong></div>
      </div>

      {awaitingStudent && req.proposedStartsAt && (
        <p className="subtitle" style={{ marginTop: 8 }}>
          You suggested <strong>{fmtShortDate(req.proposedStartsAt)}, {fmtTime(req.proposedStartsAt)}</strong>
          {req.counsellorNote ? ` (“${req.counsellorNote}”)` : ''}. The student can accept it or offer other times.
        </p>
      )}

      {req.status === 'CONFIRMED' && req.appointmentId && (
        <p className="subtitle" style={{ marginTop: 8 }}><Link href={`/appointments/${req.appointmentId}`}>Open the session →</Link></p>
      )}

      {open && req.windows.length > 0 && (
        <>
          <p className="sublabel" style={{ marginTop: 10 }}>The student can make these times. Pick one to confirm.</p>
          <div className="window-grid" role="group" aria-label="Times the student offered">
            {req.windows.map((w) => (
              <button
                key={w.startsAt}
                type="button"
                className={`window ${w.free ? 'free' : 'clash'}`}
                aria-pressed={chosen === w.startsAt}
                aria-disabled={!w.free || undefined}
                onClick={() => w.free && setChosen(chosen === w.startsAt ? null : w.startsAt)}
              >
                {fmtShortDate(w.startsAt)} · {fmtTime(w.startsAt)}
                <span>{w.free ? 'You’re free' : 'You’re booked'}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {open && req.windows.length === 0 && <p className="sublabel" style={{ marginTop: 10 }}>All the student’s times have passed. Suggest a new one.</p>}

      {open && (
        <div className="btn-row">
          <button type="button" className="btn" disabled={!chosen || pending} onClick={() => chosen && run(() => confirmRequest(req.id, chosen), () => setChosen(null))}>
            {pending && chosen ? 'Confirming…' : chosen ? `Confirm ${fmtShortDate(chosen)}, ${fmtTime(chosen)}` : 'Pick a time to confirm'}
          </button>
          <button type="button" className="btn secondary" disabled={pending} onClick={() => setPanel(panel === 'propose' ? null : 'propose')} aria-expanded={panel === 'propose'}>
            Suggest another time
          </button>
          {(req.addressedToMe || req.handledByMe) && (
            <button type="button" className="btn ghost" disabled={pending} onClick={() => run(() => releaseRequest(req.id))}>
              Pass to another counsellor
            </button>
          )}
          <MessageStudentButton requestId={req.id} className="btn ghost" />
          <button type="button" className="btn danger" disabled={pending} onClick={() => setPanel(panel === 'decline' ? null : 'decline')} aria-expanded={panel === 'decline'}>
            Decline
          </button>
        </div>
      )}

      {panel === 'propose' && dayOpts && (
        <form className="inline-form" onSubmit={(e) => {
          e.preventDefault();
          const hour = propHour && dayOpts.hours.includes(propHour) ? propHour : dayOpts.hours[0];
          run(() => proposeTime(req.id, hour, note), () => { setPanel(null); setNote(''); });
        }}>
          <div className="field">
            <label htmlFor={`pd-${req.id}`}>Day</label>
            <select id={`pd-${req.id}`} className="input select" value={dayOpts.day} onChange={(e) => { setPropDay(e.target.value); setPropHour(''); }}>
              {options.map((o) => <option key={o.day} value={o.day}>{o.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`ph-${req.id}`}>Time</label>
            <select id={`ph-${req.id}`} className="input select" value={propHour || dayOpts.hours[0]} onChange={(e) => setPropHour(e.target.value)}>
              {dayOpts.hours.map((h) => <option key={h} value={h}>{fmtTime(h)} – {fmtTime(new Date(new Date(h).getTime() + 3_600_000).toISOString())}</option>)}
            </select>
          </div>
          <div className="field wide">
            <label htmlFor={`pn-${req.id}`}>Note to the student (optional)</label>
            <input id={`pn-${req.id}`} className="input" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Room 204, Block B" />
            <span className="sublabel">Logistics only. The student sees this in the app.</span>
          </div>
          <div className="btn-row">
            <button type="submit" className="btn" disabled={pending}>{pending ? 'Sending…' : 'Send suggestion'}</button>
            <button type="button" className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'decline' && (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); setConfirmingDecline(true); }}>
          <div className="field wide">
            <label htmlFor={`dn-${req.id}`}>Message to the student (optional)</label>
            <input id={`dn-${req.id}`} className="input" maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Please book with Dr. Arora this week" />
          </div>
          <div className="btn-row">
            <button type="submit" className="btn danger" disabled={pending}>Decline request</button>
            <button type="button" className="btn ghost" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error}</p>

      <ConfirmDialog
        open={confirmingDecline}
        title="Decline this request?"
        body="The student will see that the request was declined, with your message if you wrote one. They can send a new request."
        confirmLabel="Decline"
        cancelLabel="Go back"
        onConfirm={() => { setConfirmingDecline(false); run(() => declineRequest(req.id, note), () => { setPanel(null); setNote(''); }); }}
        onCancel={() => setConfirmingDecline(false)}
      />
    </article>
  );
}
