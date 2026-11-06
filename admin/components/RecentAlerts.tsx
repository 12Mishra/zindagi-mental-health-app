import Link from 'next/link';
import { Empty } from './States';
import { relativeTime } from '@/lib/format';
import type { Alert } from '@/lib/types';

import { SEV_CLASS, SEV_LABEL } from './alert-style';

export function RecentAlerts({ alerts, asOf }: { alerts: Alert[]; asOf: string }) {
  return (
    <div className="card">
      <div className="section-header">
        <h2 className="section-title">Recent Alerts</h2>
        <Link href="/alerts" className="section-sub">View all</Link>
      </div>
      {alerts.length === 0 ? (
        <Empty title="No alerts" hint="Nothing needs attention right now." />
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {alerts.map((a) => (
            <li key={a.id} className="al-item">
              <span className={`dot ${SEV_CLASS[a.severity]}`} role="img" aria-label={SEV_LABEL[a.severity]} />
              <div>
                <p className="al-text">{a.message}</p>
                <p className="al-time">{relativeTime(a.lastSeenAt, asOf)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
