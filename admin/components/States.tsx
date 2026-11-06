import { Icon } from './Icons';

export function Suppressed({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`suppressed${compact ? ' compact' : ''}`} role="status">
      <Icon name="lock" size={compact ? 18 : 24} />
      <span>Hidden: fewer than 10 students</span>
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="empty" role="status">
      <Icon name="inbox" size={24} />
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}
