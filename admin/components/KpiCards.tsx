import { Icon, type IconName } from './Icons';
import { Suppressed, Empty } from './States';
import type { Kpi, KpiId } from '@/lib/types';

const META: Record<KpiId, { label: string; icon: IconName }> = {
  students: { label: 'Active Students', icon: 'people' },
  mood: { label: 'Avg Mood Score', icon: 'mood' },
  alerts: { label: 'Crisis Alerts', icon: 'warning' },
  sessions: { label: 'Sessions Today', icon: 'sessions' },
};

function Sparkline({ data, label }: { data: (number | null)[]; label: string }) {
  const max = Math.max(...data.map((v) => v ?? 0), 1);
  return (
    <div className="spark" role="img" aria-label={label}>
      {data.map((v, i) => (
        <i
          key={i}
          style={{ height: Math.max(4, ((v ?? 0) / max) * 28), opacity: 0.3 + (i / data.length) * 0.7 }}
        />
      ))}
    </div>
  );
}

export function KpiCards({ kpis }: { kpis: Kpi[] }) {
  if (kpis.length === 0) {
    return <div className="card"><Empty title="No metrics yet" hint="Numbers appear once students start using Zindagi." /></div>;
  }
  return (
    <section className="kpi-row" aria-label="Key figures">
      {kpis.map((k) => {
        const m = META[k.id];
        const accent = k.id === 'alerts';
        if (k.value === null) {
          return (
            <div key={k.id} className="kpi is-suppressed">
              <div className="kpi-head"><Icon name={m.icon} /><span className="kpi-label">{m.label}</span></div>
              <Suppressed compact />
            </div>
          );
        }
        return (
          <div key={k.id} className={`kpi${accent ? ' accent' : ''}`}>
            <div className="kpi-head"><Icon name={m.icon} /><span className="kpi-label">{m.label}</span></div>
            <div className="kpi-value">{k.value}</div>
            <div className="kpi-delta">{k.delta}</div>
            {!accent && (
              <Sparkline data={k.spark} label={`${m.label}, last 7 days: ${k.spark.map((v) => v ?? 'hidden').join(', ')}`} />
            )}
          </div>
        );
      })}
    </section>
  );
}
