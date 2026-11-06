export function Skeleton({ h = 16, w = '100%' }: { h?: number; w?: number | string }) {
  return <span className="skeleton" style={{ height: h, width: w }} aria-hidden="true" />;
}

export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card stack" style={{ gap: 10 }} aria-hidden="true">
      <Skeleton h={22} w="40%" />
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} h={14} w={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function LoadingRegion({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" className="stack">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
