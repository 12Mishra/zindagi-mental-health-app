import type { ReactNode } from 'react';

type P = { size?: number };
function Svg({ size = 18, children }: P & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}
export const IconCalendar = (p: P) => (
  <Svg {...p}><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M3 10h18M8 3v4M16 3v4" /></Svg>
);
export const IconShield = (p: P) => (
  <Svg {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></Svg>
);
export const IconUser = (p: P) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21c1-4 4-6 8-6s7 2 8 6" /></Svg>
);
export const IconLock = (p: P) => (
  <Svg {...p}><rect x="5" y="11" width="14" height="10" rx="3" /><path d="M8 11V8a4 4 0 018 0v3" /></Svg>
);
export const IconInfo = (p: P) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></Svg>
);
export const IconChevronLeft = (p: P) => (
  <Svg {...p}><path d="M15 6l-6 6 6 6" /></Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>
);
export const IconNote = (p: P) => (
  <Svg {...p}><path d="M5 4h14v16H5zM9 9h6M9 13h6" /></Svg>
);
