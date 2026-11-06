import { getOverview } from '@/lib/data';
import { formatAsOf } from '@/lib/format';
import { Icon } from '@/components/Icons';
import { KpiCards } from '@/components/KpiCards';
import { Heatmap } from '@/components/Heatmap';
import { ProblemBars, YearDistribution } from '@/components/Charts';
import { RecentAlerts } from '@/components/RecentAlerts';
import { Empty, Suppressed } from '@/components/States';

export default async function OverviewPage({ searchParams }: { searchParams: Promise<{ suppressed?: string; empty?: string }> }) {
  const sp = await searchParams;
  const data = await getOverview({ suppressed: sp.suppressed === '1', empty: sp.empty === '1' });
  const heatSuppressed = data.heatmap.length > 0 && data.heatmap.every((w) => w.every((v) => v === 0));

  return (
    <>
      <div>
        <div className="header">
          <div>
            <h1 className="brand">Zindagi</h1>
            <p className="subtitle">Community Well-being Overview</p>
          </div>
          <div className="header-right">
            <span className="badge-admin">Admin</span>
            <button type="button" className="bell" aria-label="Notifications"><Icon name="bell" size={22} /></button>
          </div>
        </div>
        <p className="date-line">{formatAsOf(data.asOf)} · {data.institution.activeStudents} active students</p>
      </div>

      <KpiCards kpis={data.kpis} />

      <section className="card" aria-labelledby="h-mood">
        <div className="section-header">
          <h2 className="section-title" id="h-mood">Student Mood Trends</h2>
          <span className="section-sub">Last 12 Weeks</span>
        </div>
        {data.heatmap.length === 0 ? (
          <Empty title="No mood data yet" hint="Check-ins will appear here week by week." />
        ) : heatSuppressed ? (
          <Suppressed />
        ) : (
          <Heatmap data={data.heatmap} />
        )}
      </section>

      <div className="pair">
        <section className="card" aria-labelledby="h-prob">
          <h2 className="section-title" id="h-prob">Problem Frequency</h2>
          <p className="section-sub">Top reported concerns</p>
          <div style={{ height: 12 }} />
          {data.problems === null ? <Suppressed /> : data.problems.length === 0 ? <Empty title="No topics yet" /> : <ProblemBars data={data.problems} />}
        </section>
        <section className="card" aria-labelledby="h-year">
          <h2 className="section-title" id="h-year">Year Distribution</h2>
          <p className="section-sub">Students by academic year</p>
          <div style={{ height: 12 }} />
          {data.years === null ? <Suppressed /> : data.years.length === 0 ? <Empty title="No students yet" /> : <YearDistribution data={data.years} />}
        </section>
      </div>

      <RecentAlerts alerts={data.alerts} asOf={data.asOf} />
    </>
  );
}
