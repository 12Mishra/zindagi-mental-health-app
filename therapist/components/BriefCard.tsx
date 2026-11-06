import type { CareBrief } from '@/lib/types';
import { IconInfo, IconLock } from './Icons';
import { MoodSparkline } from './MoodSparkline';

const RISK_LABEL = { LOW: 'Low', ELEVATED: 'Elevated', URGENT: 'Urgent', UNKNOWN: 'Unknown' } as const;

export function BriefCard({ brief }: { brief: CareBrief | null }) {
  if (!brief) {
    return (
      <section className="card" aria-labelledby="brief-h">
        <div className="card-head">
          <h2 className="section-title" id="brief-h">AI brief</h2>
        </div>
        <div className="empty">
          <IconLock size={28} />
          <strong>The student has not shared a summary</strong>
          <p>You can still hold the session and take notes.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="brief-h">
      <div className="card-head">
        <h2 className="section-title" id="brief-h">AI brief</h2>
        <span className="sublabel">Shared by the student</span>
      </div>
      <div className="kv">
        <div>
          <h3>Presenting concern</h3>
          <p>{brief.presenting}</p>
        </div>
        <div>
          <h3>Themes</h3>
          <div className="chips" style={{ marginTop: 0 }}>
            {brief.themes.map((t) => (
              <span key={t} className="chip">{t}</span>
            ))}
          </div>
        </div>
        <div>
          <h3>Mood trend</h3>
          <MoodSparkline trend={brief.moodTrend} series={brief.moodSeries} />
        </div>
        <div>
          <h3>Risk levels</h3>
          <div className="risk-row">
            {brief.riskLevels.map((r, i) => (
              <span key={i} className={r === 'ELEVATED' || r === 'URGENT' ? 'chip alert' : r === 'LOW' ? 'chip' : 'chip neutral'}>
                {RISK_LABEL[r]}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3>What helped</h3>
          {brief.whatHelped.length ? (
            <ul className="bullets">{brief.whatHelped.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : (
            <p className="sublabel">Nothing recorded yet.</p>
          )}
        </div>
        <div>
          <h3>Open threads</h3>
          {brief.openThreads.length ? (
            <ul className="bullets">{brief.openThreads.map((x) => <li key={x}>{x}</li>)}</ul>
          ) : (
            <p className="sublabel">No open threads.</p>
          )}
        </div>
        <p className="caution">
          <IconInfo size={18} />
          <span>{brief.caution}</span>
        </p>
      </div>
    </section>
  );
}
