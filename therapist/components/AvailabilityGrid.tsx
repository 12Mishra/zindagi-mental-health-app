'use client';

import { useState, useTransition, type KeyboardEvent } from 'react';
import { openSlot, removeSlot } from '@/lib/actions';
import { fmtShortDate, fmtTime } from '@/lib/format';
import type { Slot } from '@/lib/types';

const DAYS = 5;

export function AvailabilityGrid({ slots }: { slots: Slot[] }) {
  // Keyed by start time: a closed hour has no slot id until it is opened.
  const [cells, setCells] = useState<Record<string, { id: string | null; status: Slot['status'] }>>(() =>
    Object.fromEntries(slots.map((s) => [s.startsAt, { id: s.id, status: s.status }])),
  );
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [live, setLive] = useState('');
  const [error, setError] = useState('');
  const [, start] = useTransition();
  const [saving, setSaving] = useState<string | null>(null);

  const rows = Math.ceil(slots.length / DAYS);
  // slots arrive day-major: index = day * rows + row
  const at = (r: number, c: number) => slots[c * rows + r];

  function toggle(s: Slot) {
    const cur = cells[s.startsAt];
    if (cur.status === 'BOOKED' || s.past || saving) return;
    const opening = cur.status !== 'OPEN';
    const label = `${fmtShortDate(s.startsAt)} ${fmtTime(s.startsAt)}`;
    setError('');
    setSaving(s.startsAt);
    setCells((p) => ({ ...p, [s.startsAt]: { ...cur, status: opening ? 'OPEN' : 'REMOVED' } })); // optimistic
    start(async () => {
      const res = opening ? await openSlot(s.startsAt, s.endsAt) : await removeSlot(cur.id!);
      setSaving(null);
      if (!res.ok) {
        setCells((p) => ({ ...p, [s.startsAt]: cur }));
        setError(`${label}: ${res.error}`);
        return;
      }
      if (opening) setCells((p) => ({ ...p, [s.startsAt]: { id: (res.data as { id: string }).id, status: 'OPEN' } }));
      setLive(`${label} ${opening ? 'opened' : 'removed'}`);
    });
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    const d: Record<string, [number, number]> = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    };
    let { r, c } = active;
    if (e.key in d) {
      r = Math.min(rows - 1, Math.max(0, r + d[e.key][0]));
      c = Math.min(DAYS - 1, Math.max(0, c + d[e.key][1]));
    } else if (e.key === 'Home') c = 0;
    else if (e.key === 'End') c = DAYS - 1;
    else return;
    e.preventDefault();
    setActive({ r, c });
    document.getElementById(`cell-${r}-${c}`)?.focus();
  }

  return (
    <div>
      <div className="avail-scroll">
        <div className="avail" role="grid" aria-label="Weekly availability. Use arrow keys to move, Enter or Space to toggle." onKeyDown={onKey}>
          <div role="row" style={{ display: 'contents' }}>
            <div role="columnheader" className="avail-head"><span className="sr-only">Time</span></div>
            {Array.from({ length: DAYS }, (_, c) => {
              const s = at(0, c);
              const [wd, ...rest] = fmtShortDate(s.startsAt).split(' ');
              return (
                <div key={c} role="columnheader" className="avail-head">
                  {wd.replace(',', '')}
                  <span>{rest.join(' ')}</span>
                </div>
              );
            })}
          </div>
          {Array.from({ length: rows }, (_, r) => (
            <div key={r} role="row" style={{ display: 'contents' }}>
              <div role="rowheader" className="avail-time">{fmtTime(at(r, 0).startsAt)}</div>
              {Array.from({ length: DAYS }, (_, c) => {
                const s = at(r, c);
                const st = cells[s.startsAt].status;
                const locked = st === 'BOOKED' || !!s.past;
                const label = `${fmtShortDate(s.startsAt)}, ${fmtTime(s.startsAt)}: ${
                  st === 'BOOKED' ? `booked, ${s.pseudonym ?? 'student'}` : s.past ? 'past' : st === 'OPEN' ? 'open' : 'closed'
                }`;
                return (
                  <div key={c} role="gridcell">
                    <button
                      type="button"
                      id={`cell-${r}-${c}`}
                      className={`slot ${st.toLowerCase()}${s.past && st !== 'BOOKED' ? ' past' : ''}`}
                      tabIndex={active.r === r && active.c === c ? 0 : -1}
                      aria-label={label}
                      aria-pressed={locked ? undefined : st === 'OPEN'}
                      aria-disabled={locked || undefined}
                      aria-busy={saving === s.startsAt || undefined}
                      onFocus={() => setActive({ r, c })}
                      onClick={() => toggle(s)}
                    >
                      {st === 'BOOKED' ? s.pseudonym ?? 'Booked' : st === 'OPEN' ? 'Open' : s.past ? '—' : 'Closed'}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="legend" aria-label="Legend">
        <span><i className="swatch open" /> Open: students can book</span>
        <span><i className="swatch removed" /> Closed: students can still request it</span>
        <span><i className="swatch booked" /> Booked: locked</span>
      </div>
      <p className="form-error" role="alert" style={{ marginTop: 8 }}>{error}</p>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </div>
  );
}
