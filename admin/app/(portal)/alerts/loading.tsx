import { Skeleton } from '@/components/States';

export default function Loading() {
  return (
    <div className="card skel-stack" role="status" aria-label="Loading alerts">
      <Skeleton h={24} w={120} />
      <Skeleton h={30} w="60%" r={100} />
      {[0, 1, 2, 3].map((i) => <Skeleton key={i} h={64} />)}
    </div>
  );
}
