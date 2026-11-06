import { CardSkeleton, LoadingRegion, Skeleton } from '@/components/Skeleton';

export default function Loading() {
  return (
    <LoadingRegion label="Loading appointments">
      <Skeleton h={28} w="55%" />
      <CardSkeleton />
      <CardSkeleton />
    </LoadingRegion>
  );
}
