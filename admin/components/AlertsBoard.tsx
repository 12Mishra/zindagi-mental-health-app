'use client';

import { useEffect, useRef, useState } from 'react';
import { Empty } from './States';
import { SEV_CLASS, SEV_LABEL } from './alert-style';
import { sendOutreach, updateAlert } from '@/lib/actions';
import { relativeTime } from '@/lib/format';
import type { Alert, AlertStatus, Severity, Therapist } from '@/lib/types';

type StatusFilter = AlertStatus | 'ALL';
type SevFilter = Severity | 'ALL';
/** `outreach` is remembered for this session only; core limits outreach to once per alert per 24 h. */
interface Local extends Alert { outreach: boolean }

const KIND_LABEL = { RISK: 'Risk', DISENGAGEMENT: 'Disengagement', COHORT_DIP: 'Cohort dip' } as const;
const STATUS_TAG = { NEW: 'new', ACK: 'ack', RESOLVED: 'resolved' } as const;
const STATUS_LABEL = { NEW: 'New', ACK: 'Acknowledged', RESOLVED: 'Resolved' } as const;

/** Inserts or replaces an alert, newest activity first. */
function merge(items: Local[], alert: Alert): Local[] {
  const known = items.find((x) => x.id === alert.id);
  const next = known ? items.map((x) => (x.id === alert.id ? { ...alert, outreach: x.outreach } : x)) : [{ ...alert, outreach: false }, ...items];
  return next.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function AlertsBoard({ initial, therapists, asOf }: { initial: Alert[]; therapists: Therapist[]; asOf: string }) {
  const [items, setItems] = useState<Local[]>(() => initial.map((a) => ({ ...a, outreach: false })));
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [sev, setSev] = useState<SevFilter>('ALL');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [now, setNow] = useState(asOf);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Live updates: core pushes alert.created / alert.updated through the same-origin SSE proxy.
  useEffect(() => {
    const source = new EventSource('/api/alerts/stream');
    const onAlert = (event: MessageEvent<string>) => {
      try { const alert = JSON.parse(event.data) as Alert; setItems((xs) => merge(xs, alert)); } catch { /* ignore malformed events */ }
    };
    source.addEventListener('alert.created', onAlert as EventListener);
    source.addEventListener('alert.updated', onAlert as EventListener);
    return () => source.close();
  }, []);

  // Keeps "5 min ago" labels fresh. Starts from the server's time so the first render matches the server HTML.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const visible = items.filter((a) => (status === 'ALL' || a.status === status) && (sev === 'ALL' || a.severity === sev));

  async function change(id: string, patch: { status?: AlertStatus; assigneeId?: string | null }) {
    setBusyId(id);
    setNote('');
    const result = await updateAlert(id, patch);
    setBusyId(null);
    if (result.ok) setItems((xs) => merge(xs, result.data));
    else setNote(result.error);
  }

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
  async function confirmOutreach() {
    const id = confirmId;
    closeConfirm();
    if (!id) return;
    setBusyId(id);
    const result = await sendOutreach(id);
    setBusyId(null);
    if (result.ok) {
      setItems((xs) => xs.map((x) => (x.id === id ? { ...x, outreach: true } : x)));
      setNote('Outreach invitation sent. The student stays anonymous to you.');
    } else {
      if (/already sent/i.test(result.error)) setItems((xs) => xs.map((x) => (x.id === id ? { ...x, outreach: true } : x)));
      setNote(result.error);
    }
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
          {visible.map((a) => {
            const busy = busyId === a.id;
            const canOutreach = a.kind !== 'COHORT_DIP';
            return (
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
                      <span className="al-time" style={{ margin: 0 }}>{relativeTime(a.lastSeenAt, now)}</span>
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="btn sm" disabled={busy || a.status !== 'NEW'} onClick={() => change(a.id, { status: 'ACK' })}>Acknowledge</button>
                  <button type="button" className="btn sm ghost" disabled={busy || a.status === 'RESOLVED'} onClick={() => change(a.id, { status: 'RESOLVED' })}>Resolve</button>
                  <label className="sr-only" htmlFor={`as-${a.id}`}>Assign alert to a counsellor</label>
                  <select id={`as-${a.id}`} className="select" value={a.assigneeId ?? ''} disabled={busy || a.status === 'RESOLVED'} onChange={(e) => change(a.id, { assigneeId: e.target.value || null })}>
                    <option value="">Assign…</option>
                    {therapists.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                  {canOutreach && (
                    <button type="button" className="btn sm ghost" disabled={busy || a.status === 'RESOLVED' || a.outreach} onClick={(e) => openConfirm(a.id, e.currentTarget)}>Send outreach</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="live" role="status" aria-live="polite">{note}</p>

      <dialog ref={dialogRef} aria-labelledby="outreach-title" onClose={() => setConfirmId(null)}>
        <h2 id="outreach-title">Send outreach?</h2>
        <p>The student receives an in-app invitation to talk to a counsellor; you will not see who they are.</p>
        <div className="dialog-actions">
          <button type="button" className="btn ghost" onClick={closeConfirm}>Cancel</button>
          <button type="button" className="btn" onClick={confirmOutreach}>Send outreach</button>
        </div>
      </dialog>
    </div>
  );
}
