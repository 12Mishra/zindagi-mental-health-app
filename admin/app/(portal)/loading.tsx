import { Skeleton } from '@/components/States';

export default function Loading() {
  return (
    <div role="status" aria-label="Loading overview" className="skel-stack">
      <Skeleton h={34} w={180} />
      <div className="kpi-row">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={120} r={20} />)}
      </div>
      <Skeleton h={220} r={20} />
      <div className="pair">
        <Skeleton h={230} r={20} />
        <Skeleton h={230} r={20} />
      </div>
      <Skeleton h={190} r={20} />
    </div>
  );
}
