import { useEffect, useRef, useState } from 'react';

import type { MossExpression } from './expressions';

/**
 * Holds each face for at least `minMs` so Moss never flickers between expressions mid-sentence.
 * "steady" (urgent safety) always shows immediately.
 */
export function useHeldExpression(target: MossExpression, minMs = 1600): MossExpression {
  const [shown, setShown] = useState(target);
  const since = useRef(0);
  useEffect(() => {
    if (target === shown) return;
    const wait = target === 'steady' ? 0 : Math.max(0, minMs - (Date.now() - since.current));
    const timer = setTimeout(() => { setShown(target); since.current = Date.now(); }, wait);
    return () => clearTimeout(timer);
  }, [target, shown, minMs]);
  return shown;
}
