'use client';

import { useId, useState } from 'react';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const BUCKETS = ['No data', 'Positive', 'Fairly positive', 'Mild distress', 'Distress', 'Crisis'];

export function Heatmap({ data }: { data: number[][] }) {
  const uid = useId();
  const weeks = data.length;
  const [active, setActive] = useState<{ w: number; d: number } | null>(null);

  const cellId = (w: number, d: number) => `${uid}-c-${w}-${d}`;
  const weeksAgo = (w: number) => weeks - 1 - w;
  const weekName = (w: number) => (weeksAgo(w) === 0 ? 'This week' : `${weeksAgo(w)} week${weeksAgo(w) === 1 ? '' : 's'} ago`);

  function onKey(e: React.KeyboardEvent) {
    const cur = active ?? { w: 0, d: 0 };
    let { w, d } = cur;
    if (e.key === 'ArrowRight') w = Math.min(weeks - 1, w + 1);
    else if (e.key === 'ArrowLeft') w = Math.max(0, w - 1);
    else if (e.key === 'ArrowDown') d = Math.min(6, d + 1);
    else if (e.key === 'ArrowUp') d = Math.max(0, d - 1);
    else if (e.key === 'Escape') { setActive(null); return; }
    else return;
    e.preventDefault();
    setActive({ w, d });
  }

  const tipAlign = active ? (active.w < 2 ? 'left' : active.w > weeks - 3 ? 'right' : 'mid') : 'mid';

  return (
    <div>
      <div
        className="hm"
        role="grid"
        tabIndex={0}
        aria-label="Student mood by day for the last 12 weeks. Use arrow keys to explore."
        aria-activedescendant={active ? cellId(active.w, active.d) : undefined}
        onKeyDown={onKey}
        onFocus={() => setActive((a) => a ?? { w: weeks - 1, d: 0 })}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
      >
        {DAYS.map((day, d) => (
          <div key={day} className="hm-row" role="row">
            <span className="hm-day" role="rowheader">{day}</span>
            <div className="hm-cells">
              {data.map((week, w) => {
                const v = week[d];
                const isOn = active?.w === w && active?.d === d;
                return (
                  <div
                    key={w}
                    id={cellId(w, d)}
                    role="gridcell"
                    aria-label={`${weekName(w)}, ${DAY_FULL[d]}: ${BUCKETS[v]}`}
                    className={`hm-cell hm-bucket-${v}${isOn ? ' on' : ''}`}
                    onMouseEnter={() => setActive({ w, d })}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {active && (
          <div
            className="hm-tip"
            aria-hidden="true"
            style={{
              top: `calc(${active.d} * (var(--hm-h) + 3px) - 40px)`,
              ...(tipAlign === 'left'
                ? { left: `calc(32px + ${active.w} * ((100% - 32px) / ${weeks}))` }
                : tipAlign === 'right'
                  ? { right: `calc(${weeks - 1 - active.w} * ((100% - 32px) / ${weeks}))` }
                  : { left: `calc(32px + (${active.w} + 0.5) * ((100% - 32px) / ${weeks}))`, transform: 'translateX(-50%)' }),
            }}
          >
            {weekName(active.w)} · {DAY_FULL[active.d]} · {BUCKETS[data[active.w][active.d]]}
          </div>
        )}
      </div>
      <div className="hm-legend" aria-hidden="true">
        <span>Positive</span>
        <div className="hm-scale">
          {[1, 2, 3, 4, 5].map((b) => <i key={b} className={`hm-bucket-${b}`} />)}
        </div>
        <span>Distress</span>
      </div>
    </div>
  );
}
