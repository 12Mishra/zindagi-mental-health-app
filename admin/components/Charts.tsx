const CHART_H = 110;

export function ProblemBars({ data }: { data: Array<{ topic: string; pct: number }> }) {
  const max = Math.max(...data.map((d) => d.pct));
  return (
    <div className="bars" role="group" aria-label="Problem frequency, share of students per topic">
      {data.map((d, i) => (
        <div
          key={d.topic}
          className="bar-col"
          role="img"
          tabIndex={0}
          aria-label={`${d.topic}: ${d.pct}% of students`}
          data-tip={`${d.topic}: ${d.pct}% of students`}
        >
          <span className="bar-pct" aria-hidden="true">{d.pct}%</span>
          <div className="bar-fill" style={{ height: Math.max(8, (d.pct / max) * CHART_H), opacity: 0.55 + (i / data.length) * 0.45 }} />
          <span className="bar-lbl" aria-hidden="true">{d.topic}</span>
        </div>
      ))}
    </div>
  );
}

const ORD = ['1st', '2nd', '3rd', '4th', '5th'];

export function YearDistribution({ data }: { data: Array<{ year: number; pct: number }> }) {
  const label = (y: number) => ORD[y - 1] ?? `${y}th`;
  const color = (y: number) => `var(--year-${Math.min(y, 4)})`;
  return (
    <div className="yd">
      <div className="stack" role="group" aria-label="Students by academic year">
        {data.map((d) => (
          <div
            key={d.year}
            role="img"
            tabIndex={0}
            aria-label={`${label(d.year)} year: ${d.pct}%`}
            data-tip={`${label(d.year)} year: ${d.pct}%`}
            style={{ flex: d.pct, background: color(d.year) }}
          />
        ))}
      </div>
      <div className="yd-legend">
        {data.map((d) => (
          <div key={d.year} className="yd-row">
            <span className="dot" style={{ background: color(d.year) }} />
            {label(d.year)} Year — {d.pct}%
          </div>
        ))}
      </div>
    </div>
  );
}
