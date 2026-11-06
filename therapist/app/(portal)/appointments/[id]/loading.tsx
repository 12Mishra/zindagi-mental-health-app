import { CardSkeleton, LoadingRegion } from '@/components/Skeleton';

export default function Loading() {
  return (
    <LoadingRegion label="Loading appointment">
      <CardSkeleton lines={3} />
      <div className="grid-2">
        <CardSkeleton lines={8} />
        <div className="stack">
          <CardSkeleton lines={2} />
          <CardSkeleton lines={4} />
        </div>
      </div>
    </LoadingRegion>
  );
}
