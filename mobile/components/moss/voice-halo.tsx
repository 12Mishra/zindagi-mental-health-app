import React, { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedProps, useFrameCallback, useReducedMotion, useSharedValue, withTiming, type SharedValue,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AURA_RGB, PARAMS, toVector, type MossExpression } from './expressions';

const APath = Animated.createAnimatedComponent(Path);
const TICKS = 64;
const A0 = PARAMS.indexOf('aSage');

const colorFor = (expression: MossExpression) => {
  const v = toVector(expression);
  let r = 0, g = 0, b = 0, w = 0;
  AURA_RGB.forEach(([cr, cg, cb], i) => { const k = v[A0 + i]; r += cr * k; g += cg * k; b += cb * k; w += k; });
  w = w || 1;
  // Darken a touch so the ticks read against the light sheet.
  return [(r / w) * 0.78, (g / w) * 0.82, (b / w) * 0.74];
};

type Props = {
  size: number;
  amp: SharedValue<number>;
  expression: MossExpression;
  thinking: boolean;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** A ring of rounded ticks around Moss that moves with the live voice level, plus three seeds that orbit while Lisa thinks. */
export function VoiceHalo({ size, amp, expression, thinking, active = true, style }: Props) {
  const reduce = useReducedMotion();
  const time = useSharedValue(0);
  const [r0, g0, b0] = colorFor(expression);
  const r = useSharedValue(r0), g = useSharedValue(g0), b = useSharedValue(b0);
  const think = useSharedValue(thinking ? 1 : 0);

  useEffect(() => {
    const [nr, ng, nb] = colorFor(expression);
    r.value = withTiming(nr, { duration: 700 }); g.value = withTiming(ng, { duration: 700 }); b.value = withTiming(nb, { duration: 700 });
  }, [expression, r, g, b]);
  useEffect(() => { think.value = withTiming(thinking ? 1 : 0, { duration: 350 }); }, [thinking, think]);

  const clock = useFrameCallback(f => { time.value = f.timeSinceFirstFrame / 1000; }, false);
  useEffect(() => { clock.setActive(active && !reduce); }, [active, reduce, clock]);

  const ticks = useAnimatedProps(() => {
    const t = time.value, a = amp.value;
    let d = '';
    for (let i = 0; i < TICKS; i++) {
      const ang = (i / TICKS) * Math.PI * 2 - Math.PI / 2;
      const wob = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.7) * Math.sin(t * 2.1 + i * 0.23);
      const len = 3 + a * 26 * wob + 1.2 * Math.sin(t * 1.5 + i * 0.3) + think.value * 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      const x1 = 134 + c * 104, y1 = 134 + s * 104;
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${(x1 + c * len).toFixed(1)} ${(y1 + s * len).toFixed(1)}`;
    }
    return {
      d,
      stroke: `rgb(${Math.round(r.value)},${Math.round(g.value)},${Math.round(b.value)})`,
      strokeOpacity: 0.35 + a * 0.6,
    };
  });

  const seeds = useAnimatedProps(() => {
    const t = time.value;
    let d = '';
    for (let i = 0; i < 3; i++) {
      const ang = t * 2.4 + i * 2.094;
      const x = 134 + Math.cos(ang) * 118, y = 134 + Math.sin(ang) * 118;
      d += `M${(x - 5).toFixed(1)} ${y.toFixed(1)}a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z`;
    }
    return { d, opacity: think.value * (0.65 + 0.35 * Math.sin(t * 5)) };
  });

  return (
    <Svg width={size} height={size} viewBox="0 0 268 268" style={style} pointerEvents="none">
      <APath strokeWidth={3.4} strokeLinecap="round" fill="none" animatedProps={ticks} />
      <APath fill="#FF8A78" animatedProps={seeds} />
    </Svg>
  );
}
