'use client';

import { useRef, useState } from 'react';
import { Empty } from './States';
import { SEV_CLASS, SEV_LABEL } from './alert-style';
import { relativeTime } from '@/lib/format';
import type { Alert, AlertStatus, Severity, Therapist } from '@/lib/types';

type StatusFilter = AlertStatus | 'ALL';
type SevFilter = Severity | 'ALL';
interface Local extends Alert { assignee: string; outreach: boolean }

const KIND_LABEL = { RISK: 'Risk', DISENGAGEMENT: 'Disengagement', COHORT_DIP: 'Cohort dip' } as const;
const STATUS_TAG = { NEW: 'new', ACK: 'ack', RESOLVED: 'resolved' } as const;
const STATUS_LABEL = { NEW: 'New', ACK: 'Acknowledged', RESOLVED: 'Resolved' } as const;

export function AlertsBoard({ initial, therapists, asOf }: { initial: Alert[]; therapists: Therapist[]; asOf: string }) {
  const [items, setItems] = useState<Local[]>(() => initial.map((a) => ({ ...a, assignee: '', outreach: false })));
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [sev, setSev] = useState<SevFilter>('ALL');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const patch = (id: string, p: Partial<Local>) => setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const visible = items.filter((a) => (status === 'ALL' || a.status === status) && (sev === 'ALL' || a.severity === sev));

  function openConfirm(id: string, el: HTMLElement) {
    openerRef.current = el;
    setConfirmId(id);
    dialogRef.current?.showModal();
  }
  function closeConfirm() {
    dialogRef.current?.close();
    setConfirmId(null);
    openerRef.current?.focus();
  }
  function sendOutreach() {
    if (confirmId) {
      patch(confirmId, { outreach: true });
      setNote('Outreach invitation sent. The student stays anonymous to you.');
    }
    closeConfirm();
  }

  const statusOpts: StatusFilter[] = ['ALL', 'NEW', 'ACK', 'RESOLVED'];
  const sevOpts: SevFilter[] = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];
  const cap = (s: string) => (s === 'ALL' ? 'All' : s === 'ACK' ? 'Acknowledged' : s[0] + s.slice(1).toLowerCase());

  return (
    <div className="card">
      <div className="section-header">
        <h1 className="section-title" style={{ fontSize: 17 }}>Alerts</h1>
        <span className="section-sub">{visible.length} of {items.length} shown</span>
      </div>

      <div className="filters">
        <div className="fgroup" role="group" aria-label="Filter by status">
          <span>Status</span>
          {statusOpts.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{cap(s)}</button>
          ))}
        </div>
        <div className="fgroup" role="group" aria-label="Filter by severity">
          <span>Severity</span>
          {sevOpts.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={sev === s} onClick={() => setSev(s)}>{cap(s)}</button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <Empty title="No alerts match these filters" hint="Try a different status or severity." />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {visible.map((a) => (
            <li key={a.id} className="row-item">
              <div className="row-main">
                <span className={`dot ${SEV_CLASS[a.severity]}`} role="img" aria-label={SEV_LABEL[a.severity]} />
                <div>
                  <p className="al-text" style={{ color: 'var(--text-primary)' }}>{a.message}</p>
                  <div className="row-meta">
                    <span className={`tag ${STATUS_TAG[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                    <span className="tag">{KIND_LABEL[a.kind]}</span>
                    <span className="tag">{cap(a.severity)}</span>
                    {a.outreach && <span className="tag">Outreach sent</span>}
                    <span className="al-time" style={{ margin: 0 }}>{relativeTime(a.lastSeenAt, asOf)}</span>
                  </div>
                </div>
              </div>
              <div className="actions">
                <button type="button" className="btn sm" disabled={a.status !== 'NEW'} onClick={() => patch(a.id, { status: 'ACK' })}>Acknowledge</button>
                <button type="button" className="btn sm ghost" disabled={a.status === 'RESOLVED'} onClick={() => patch(a.id, { status: 'RESOLVED' })}>Resolve</button>
                <label className="sr-only" htmlFor={`as-${a.id}`}>Assign alert to a counsellor</label>
                <select id={`as-${a.id}`} className="select" value={a.assignee} disabled={a.status === 'RESOLVED'} onChange={(e) => patch(a.id, { assignee: e.target.value })}>
                  <option value="">Assign…</option>
                  {therapists.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <button type="button" className="btn sm ghost" disabled={a.status === 'RESOLVED' || a.outreach} onClick={(e) => openConfirm(a.id, e.currentTarget)}>Send outreach</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="live" role="status" aria-live="polite">{note}</p>

      <dialog ref={dialogRef} aria-labelledby="outreach-title" onClose={() => setConfirmId(null)}>
        <h2 id="outreach-title">Send outreach?</h2>
        <p>The student receives an in-app invitation to talk to a counsellor; you will not see who they are.</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={closeConfirm}>Cancel</button>
          <button type="button" className="btn" onClick={sendOutreach}>Send outreach</button>
        </div>
      </dialog>
    </div>
  );
}
