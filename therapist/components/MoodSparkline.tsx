import type { MoodTrend } from '@/lib/types';

const LABEL: Record<MoodTrend, string> = {
  improving: 'Improving',
  stable: 'Stable',
  declining: 'Declining',
  unknown: 'Not enough data',
};

/** Single-series sparkline: 2px line, end marker, text alternative. Series is 0–10. */
export function MoodSparkline({ trend, series }: { trend: MoodTrend; series?: number[] }) {
  const w = 120;
  const h = 36;
  const pad = 4;
  const pts = series && series.length > 1 ? series : null;
  let path = '';
  let last: [number, number] | null = null;
  if (pts) {
    const coords = pts.map((v, i) => [
      pad + (i * (w - pad * 2)) / (pts.length - 1),
      pad + (1 - Math.min(10, Math.max(0, v)) / 10) * (h - pad * 2),
    ]);
    path = coords.map((c, i) => `${i ? 'L' : 'M'}${c[0].toFixed(1)} ${c[1].toFixed(1)}`).join(' ');
    last = coords[coords.length - 1] as [number, number];
  }
  const alt = pts
    ? `Mood over the last ${pts.length} check-ins: ${pts.join(', ')} out of 10. Trend ${LABEL[trend].toLowerCase()}.`
    : `Mood trend: ${LABEL[trend].toLowerCase()}.`;

  return (
    <div className="trend">
      {pts && (
        <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={alt}>
          <path d={path} fill="none" stroke="var(--viz)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {last && <circle cx={last[0]} cy={last[1]} r="4" fill="var(--viz)" stroke="var(--card)" strokeWidth="2" />}
        </svg>
      )}
      <span className="trend-label">
        {LABEL[trend]}
        {!pts && <span className="sr-only">. {alt}</span>}
      </span>
    </div>
  );
}
