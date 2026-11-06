'use client';

import { useState, type KeyboardEvent } from 'react';
import { fmtShortDate, fmtTime } from '@/lib/format';
import type { Slot } from '@/lib/types';

const DAYS = 5;

export function AvailabilityGrid({ slots }: { slots: Slot[] }) {
  const [state, setState] = useState<Record<string, Slot['status']>>(() =>
    Object.fromEntries(slots.map((s) => [s.id, s.status])),
  );
  const [active, setActive] = useState({ r: 0, c: 0 });
  const [live, setLive] = useState('');

  const rows = Math.ceil(slots.length / DAYS);
  // slots arrive day-major: index = day * rows + row
  const at = (r: number, c: number) => slots[c * rows + r];

  function toggle(s: Slot) {
    const cur = state[s.id];
    if (cur === 'BOOKED') return;
    const next = cur === 'OPEN' ? 'REMOVED' : 'OPEN';
    setState((p) => ({ ...p, [s.id]: next }));
    setLive(`${fmtShortDate(s.startsAt)} ${fmtTime(s.startsAt)} ${next === 'OPEN' ? 'opened' : 'removed'}`);
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
                const st = state[s.id];
                const label = `${fmtShortDate(s.startsAt)}, ${fmtTime(s.startsAt)}: ${
                  st === 'BOOKED' ? `booked, ${s.pseudonym}` : st === 'OPEN' ? 'open' : 'removed'
                }`;
                return (
                  <div key={c} role="gridcell">
                    <button
                      type="button"
                      id={`cell-${r}-${c}`}
                      className={`slot ${st.toLowerCase()}`}
                      tabIndex={active.r === r && active.c === c ? 0 : -1}
                      aria-label={label}
                      aria-pressed={st === 'BOOKED' ? undefined : st === 'OPEN'}
                      aria-disabled={st === 'BOOKED' || undefined}
                      onFocus={() => setActive({ r, c })}
                      onClick={() => toggle(s)}
                    >
                      {st === 'BOOKED' ? s.pseudonym : st === 'OPEN' ? 'Open' : 'Removed'}
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
        <span><i className="swatch removed" /> Removed: hidden from students</span>
        <span><i className="swatch booked" /> Booked: locked</span>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{live}</p>
    </div>
  );
}
