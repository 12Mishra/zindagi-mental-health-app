import { LoadingRegion, Skeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <LoadingRegion label="Loading availability">
      <Skeleton h={28} w="40%" />
      <div className="card stack" aria-hidden="true">
        <Skeleton h={24} w="60%" />
        {Array.from({ length: 7 }, (_, i) => <Skeleton key={i} h={44} />)}
      </div>
    </LoadingRegion>
  );
}
