import React, { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, LinearGradient, Path, Pattern, RadialGradient, Stop } from 'react-native-svg';

import { AURA_RGB, PARAMS, toVector, type MossExpression } from './expressions';

const APath = Animated.createAnimatedComponent(Path);
const AEllipse = Animated.createAnimatedComponent(Ellipse);
const ACircle = Animated.createAnimatedComponent(Circle);

const N = PARAMS.length;
// Vector indices (see expressions.ts PARAMS).
const EYE_OPEN = 0, EYE_SMILE = 1, PUPIL = 2, LOOK_X = 3, LOOK_Y = 4, BROW_Y = 5, BROW_TILT = 6, CURVE = 7, OPEN = 8,
  BLUSH = 9, SQUASH = 10, DROOP = 11, SWEAT = 12, TILT = 13, WAVE = 14, A0 = 15;

const BODY = 'M100 50C143 50 170 80 170 119C170 157 140 177 100 177C60 177 30 157 30 119C30 80 57 50 100 50Z';
const CAP = 'M28 108C26 72 58 46 100 46C142 46 174 72 172 108C164 101 158 111 149 104C141 113 130 102 121 109C112 100 102 111 93 103C84 111 74 101 65 108C57 101 47 111 38 103C35 106 31 108 28 108Z';
const LEAF_L = [101, 34, 90, 21, 75, 22, 70, 27, 77, 38, 92, 40, 101, 34];
const LEAF_R = [102, 29, 110, 14, 127, 12, 134, 16, 129, 29, 114, 35, 102, 29];

const r2 = (v: number) => { 'worklet'; return Math.round(v * 100) / 100; };

function eyeD(cx: number, cy: number, open: number, smile: number) {
  'worklet';
  const w = 12.5, H = 15;
  const top = H * open;
  const bot = H * (0.82 * Math.min(1, open + 0.35) - 1.6 * smile);
  const l = r2(cx - w), r = r2(cx + w), y = r2(cy);
  const ty = r2(cy - 1.33 * top), by = r2(cy + 1.33 * bot);
  return `M${l} ${y}C${l} ${ty} ${r} ${ty} ${r} ${y}C${r} ${by} ${l} ${by} ${l} ${y}Z`;
}

function circleD(x: number, y: number, r: number) {
  'worklet';
  return `M${r2(x - r)} ${r2(y)}a${r2(r)} ${r2(r)} 0 1 0 ${r2(2 * r)} 0a${r2(r)} ${r2(r)} 0 1 0 ${r2(-2 * r)} 0Z`;
}

function leafD(pts: number[], deg: number) {
  'worklet';
  const px = pts[0], py = pts[1], a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - px, dy = pts[i + 1] - py;
    out.push(`${r2(px + dx * c - dy * s)} ${r2(py + dx * s + dy * c)}`);
  }
  return `M${out[0]}C${out[1]} ${out[2]} ${out[3]}C${out[4]} ${out[5]} ${out[6]}Z`;
}

function rotPoint(x: number, y: number, px: number, py: number, deg: number) {
  'worklet';
  const a = (deg * Math.PI) / 180, dx = x - px, dy = y - py;
  return [px + dx * Math.cos(a) - dy * Math.sin(a), py + dx * Math.sin(a) + dy * Math.cos(a)];
}

function blink(t: number, seed: number, sleepy: number) {
  'worklet';
  const period = 4.3 + seed * 0.4;
  const c = (t + seed) % period;
  const dur = 0.17 + sleepy * 0.25;
  // An occasional double blink keeps it from feeling mechanical.
  const c2 = (t + seed) % (period * 3);
  const extra = c2 > 0.32 && c2 < 0.32 + dur ? Math.sin((Math.PI * (c2 - 0.32)) / dur) : 0;
  return Math.max(c < dur ? Math.sin((Math.PI * c) / dur) : 0, extra);
}

type MossProps = {
  expression: MossExpression;
  size?: number;
  /** 0..1 voice level, drives lip-sync while `speaking` is 1. */
  amp?: SharedValue<number>;
  speaking?: SharedValue<number>;
  /** Pause the animation clock when the screen is not visible. */
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Moss: a mossy pebble that gives Lisa a face. Every frame is computed on the UI thread from one
 * eased vector of face controls plus a clock for breathing, blinking, gaze drift and lip-sync.
 */
export function Moss({ expression, size = 180, amp, speaking, active = true, style }: MossProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (name: string) => `m${uid}${name}`;
  const reduce = useReducedMotion();

  const from = useSharedValue<number[]>(toVector(expression));
  const to = useSharedValue<number[]>(toVector(expression));
  const progress = useSharedValue(1);
  const time = useSharedValue(0);
  const zero = useSharedValue(0);
  const ampSV = amp ?? zero;
  const speakSV = speaking ?? zero;
  const seed = useSharedValue((uid.length * 1.37) % 3);

  useEffect(() => {
    const p = progress.value;
    const f = from.value, t = to.value;
    from.value = f.map((v, i) => v + (t[i] - v) * p);
    to.value = toVector(expression);
    progress.value = 0;
    progress.value = reduce ? 1 : withTiming(1, { duration: 720, easing: Easing.out(Easing.cubic) });
  }, [expression, reduce, from, to, progress]);

  const clock = useFrameCallback(frame => { time.value = frame.timeSinceFirstFrame / 1000; }, false);
  useEffect(() => { clock.setActive(active && !reduce); }, [active, reduce, clock]);

  const cur = useDerivedValue(() => {
    const p = progress.value, f = from.value, t = to.value;
    const out: number[] = new Array(N);
    for (let i = 0; i < N; i++) out[i] = f[i] + (t[i] - f[i]) * p;
    return out;
  });

  // Gaze and face offset shared by several layers.
  const gaze = useDerivedValue(() => {
    const c = cur.value, t = time.value, s = seed.value;
    const lx = c[LOOK_X] + 0.22 * Math.sin(t * 0.7 + s);
    const ly = c[LOOK_Y] + 0.14 * Math.sin(t * 0.53 + s * 2);
    const b = t > 0 ? blink(t, s, c[A0 + 3]) : 0;
    return { lx, ly, fx: lx * 2.4, fy: ly * 2, open: Math.max(0.02, c[EYE_OPEN] * (1 - b * 0.96)) };
  });

  const bodyStyle = useAnimatedStyle(() => {
    const c = cur.value, t = time.value;
    const sp = speakSV.value * ampSV.value * 0.55;
    const sq = c[SQUASH] + 0.014 * Math.sin(t * 1.7) + 0.022 * c[WAVE] * Math.sin(t * 9) + sp * 0.06;
    const hop = -c[WAVE] * 3.2 * Math.abs(Math.sin(t * 4.5)) * (size / 200);
    return { transform: [{ translateY: hop }, { rotate: `${c[TILT]}deg` }, { scaleX: 1 + sq }, { scaleY: 1 - sq }] };
  });

  const aura0 = useAnimatedProps(() => ({ opacity: cur.value[A0] }));
  const aura1 = useAnimatedProps(() => ({ opacity: cur.value[A0 + 1] }));
  const aura2 = useAnimatedProps(() => ({ opacity: cur.value[A0 + 2] }));
  const aura3 = useAnimatedProps(() => ({ opacity: cur.value[A0 + 3] }));

  const eyeL = useAnimatedProps(() => {
    const g = gaze.value; return { d: eyeD(78 + g.fx, 113 + g.fy, g.open, cur.value[EYE_SMILE]) };
  });
  const eyeR = useAnimatedProps(() => {
    const g = gaze.value; return { d: eyeD(122 + g.fx, 113 + g.fy, g.open, cur.value[EYE_SMILE]) };
  });
  const pupils = useAnimatedProps(() => {
    const g = gaze.value, c = cur.value;
    const px = g.fx + g.lx * 4.2, py = g.fy + g.ly * 3.8, r = 5.8 * c[PUPIL];
    const vis = Math.min(1, Math.max(0, (g.open - 0.3) / 0.35)) * Math.min(1, Math.max(0, 1 - c[EYE_SMILE] * 1.3));
    return { d: circleD(78 + px, 113 + py, r) + circleD(122 + px, 113 + py, r), opacity: vis };
  });
  const shine = useAnimatedProps(() => {
    const g = gaze.value, c = cur.value;
    const px = g.fx + g.lx * 4.2, py = g.fy + g.ly * 3.8;
    const vis = Math.min(1, Math.max(0, (g.open - 0.25) / 0.3)) * Math.min(1, Math.max(0.15, 1 - c[EYE_SMILE] * 0.9));
    return {
      d: circleD(74.2 + px, 108.2 + py, 3.7) + circleD(81.8 + px, 116.5 + py, 1.6)
        + circleD(118.2 + px, 108.2 + py, 3.7) + circleD(125.8 + px, 116.5 + py, 1.6),
      opacity: vis,
    };
  });
  const browL = useAnimatedProps(() => {
    const c = cur.value, g = gaze.value;
    const by = 91 - c[BROW_Y] * 7 + g.fy, inn = -c[BROW_TILT] * 5.5, out = c[BROW_TILT] * 1.5;
    return { d: `M${r2(67 + g.fx)} ${r2(by + out)}Q${r2(78 + g.fx)} ${r2(by - 3.5)} ${r2(88 + g.fx)} ${r2(by + inn)}` };
  });
  const browR = useAnimatedProps(() => {
    const c = cur.value, g = gaze.value;
    const by = 91 - c[BROW_Y] * 7 + g.fy, inn = -c[BROW_TILT] * 5.5, out = c[BROW_TILT] * 1.5;
    return { d: `M${r2(112 + g.fx)} ${r2(by + inn)}Q${r2(122 + g.fx)} ${r2(by - 3.5)} ${r2(133 + g.fx)} ${r2(by + out)}` };
  });
  const mouthGeom = useDerivedValue(() => {
    const c = cur.value, g = gaze.value;
    const op = Math.min(1, c[OPEN] + speakSV.value * ampSV.value * 0.55);
    const cv = c[CURVE], x = 100 + g.fx, my = 138 + g.fy;
    const w = 10.5 + Math.max(0, cv) * 3 + op * 2.5;
    const cy = my - cv * 3.2, ct = my + cv * 8.5, cb = ct + op * 19 + 0.6;
    return { x, w, cy, ct, cb, op };
  });
  const mouth = useAnimatedProps(() => {
    const m = mouthGeom.value;
    return { d: `M${r2(m.x - m.w)} ${r2(m.cy)}Q${r2(m.x)} ${r2(m.ct)} ${r2(m.x + m.w)} ${r2(m.cy)}Q${r2(m.x)} ${r2(m.cb)} ${r2(m.x - m.w)} ${r2(m.cy)}Z` };
  });
  const tongue = useAnimatedProps(() => {
    const m = mouthGeom.value;
    const h = (m.cb - m.ct) / 2;
    return { cx: m.x, cy: m.ct + h * 1.15, rx: m.w * 0.5, ry: Math.max(0.1, h * 0.55), opacity: Math.min(1, Math.max(0, (m.op - 0.12) * 4)) };
  });
  const cheekL = useAnimatedProps(() => ({ cx: 66 + gaze.value.fx, cy: 132 + gaze.value.fy, opacity: cur.value[BLUSH] * 0.75 }));
  const cheekR = useAnimatedProps(() => ({ cx: 134 + gaze.value.fx, cy: 132 + gaze.value.fy, opacity: cur.value[BLUSH] * 0.75 }));
  const leafL = useAnimatedProps(() => {
    const c = cur.value, t = time.value, sw = Math.sin(t * 1.3 + seed.value), perk = c[WAVE] * 6 * Math.sin(t * 7);
    return { d: leafD(LEAF_L, -c[DROOP] * 30 + 4 * sw + perk) };
  });
  const leafRDeg = useDerivedValue(() => {
    const c = cur.value, t = time.value;
    return c[DROOP] * 30 - 4 * Math.sin(t * 1.3 + 1 + seed.value) - c[WAVE] * 6 * Math.sin(t * 7);
  });
  const leafR = useAnimatedProps(() => ({ d: leafD(LEAF_R, leafRDeg.value) }));
  const dew = useAnimatedProps(() => {
    const [x, y] = rotPoint(124, 22, 102, 29, leafRDeg.value);
    return { cx: x, cy: y, opacity: 0.75 + 0.25 * Math.sin(time.value * 2.4) };
  });
  const sweat = useAnimatedProps(() => {
    const dy = 2.2 * Math.sin(time.value * 2.1);
    return {
      d: `M153 ${r2(86 + dy)}C157 ${r2(93 + dy)} 159 ${r2(97 + dy)} 155.5 ${r2(100.5 + dy)}C152 ${r2(103.5 + dy)} 147.5 ${r2(100 + dy)} 149.3 ${r2(95.5 + dy)}C150.3 ${r2(92.5 + dy)} 151.5 ${r2(89.5 + dy)} 153 ${r2(86 + dy)}Z`,
      opacity: cur.value[SWEAT],
    };
  });
  const nubL = useAnimatedProps(() => {
    const c = cur.value, wv = c[WAVE] * (0.5 + 0.5 * Math.sin(time.value * 9));
    return { cy: 146 - wv * 7 + c[DROOP] * 2, cx: 36 - wv * 2 };
  });
  const nubR = useAnimatedProps(() => {
    const c = cur.value, wv = c[WAVE] * (0.5 + 0.5 * Math.sin(time.value * 9 + 0.6));
    return { cy: 146 - wv * 7 + c[DROOP] * 2, cx: 164 + wv * 2 };
  });

  return (
    <View style={[{ width: size, height: size }, style]} pointerEvents="none">
      {/* Glow: four tinted pools that cross-fade with the expression. */}
      <Svg width={size} height={size} viewBox="0 0 200 200" style={StyleSheet.absoluteFill}>
        <Defs>
          {AURA_RGB.map(([r, g, b], i) => (
            <RadialGradient key={i} id={id(`a${i}`)} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0.75} />
              <Stop offset="0.55" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0.28} />
              <Stop offset="1" stopColor={`rgb(${r},${g},${b})`} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <ACircle cx={100} cy={114} r={98} fill={`url(#${id('a0')})`} animatedProps={aura0} />
        <ACircle cx={100} cy={114} r={98} fill={`url(#${id('a1')})`} animatedProps={aura1} />
        <ACircle cx={100} cy={114} r={98} fill={`url(#${id('a2')})`} animatedProps={aura2} />
        <ACircle cx={100} cy={114} r={98} fill={`url(#${id('a3')})`} animatedProps={aura3} />
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, { transformOrigin: '50% 93%' }, bodyStyle]}>
        <Svg width={size} height={size} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id={id('body')} cx="36%" cy="28%" r="82%">
              <Stop offset="0" stopColor="#F3F8EC" />
              <Stop offset="0.33" stopColor="#CEDBBF" />
              <Stop offset="0.72" stopColor="#95A985" />
              <Stop offset="1" stopColor="#627656" />
            </RadialGradient>
            <RadialGradient id={id('cap')} cx="38%" cy="18%" r="90%">
              <Stop offset="0" stopColor="#BFD596" />
              <Stop offset="0.45" stopColor="#7F9A5B" />
              <Stop offset="1" stopColor="#465733" />
            </RadialGradient>
            <RadialGradient id={id('eye')} cx="42%" cy="30%" r="75%">
              <Stop offset="0" stopColor="#36502A" />
              <Stop offset="1" stopColor="#0B1507" />
            </RadialGradient>
            <LinearGradient id={id('leaf')} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#D2E6AE" />
              <Stop offset="1" stopColor="#6A8A42" />
            </LinearGradient>
            <RadialGradient id={id('shade')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#2F4422" stopOpacity={0.42} />
              <Stop offset="1" stopColor="#2F4422" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={id('light')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={id('cheek')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FF8F7C" stopOpacity={0.9} />
              <Stop offset="1" stopColor="#FF8F7C" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id={id('ground')} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#1E3313" stopOpacity={0.32} />
              <Stop offset="1" stopColor="#1E3313" stopOpacity={0} />
            </RadialGradient>
            <Pattern id={id('fuzz')} width={6} height={6} patternUnits="userSpaceOnUse">
              <Circle cx={1.4} cy={1.4} r={0.8} fill="#DDEDBC" opacity={0.38} />
              <Circle cx={4.6} cy={4.3} r={0.75} fill="#33461F" opacity={0.32} />
            </Pattern>
            <ClipPath id={id('clip')}><Path d={BODY} /></ClipPath>
          </Defs>

          <Ellipse cx={100} cy={187} rx={62} ry={9} fill={`url(#${id('ground')})`} />
          <AEllipse rx={11} ry={8.5} fill={`url(#${id('body')})`} animatedProps={nubL} />
          <AEllipse rx={11} ry={8.5} fill={`url(#${id('body')})`} animatedProps={nubR} />
          <Path d={BODY} fill={`url(#${id('body')})`} />
          <G clipPath={`url(#${id('clip')})`}>
            <Ellipse cx={140} cy={172} rx={92} ry={56} fill={`url(#${id('shade')})`} />
            <Ellipse cx={62} cy={122} rx={30} ry={42} fill={`url(#${id('light')})`} />
            <Path d={CAP} fill="#33461F" opacity={0.28} transform="translate(0 4)" />
            <Path d={CAP} fill={`url(#${id('cap')})`} />
            <Path d={CAP} fill={`url(#${id('fuzz')})`} />
            <Ellipse cx={76} cy={62} rx={30} ry={11} fill={`url(#${id('light')})`} />
            <Circle cx={134} cy={70} r={3} fill="#E8C9D6" opacity={0.9} />
            <Circle cx={140} cy={74} r={2.2} fill="#F3E6A1" opacity={0.9} />
            <Circle cx={62} cy={78} r={2.4} fill="#F3E6A1" opacity={0.75} />
          </G>
          <Path d={BODY} fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={1.2} />

          {/* Sprout */}
          <Path d="M100 52C99 42 98 36 102 27" stroke="#58743A" strokeWidth={3.2} fill="none" strokeLinecap="round" />
          <APath fill={`url(#${id('leaf')})`} animatedProps={leafL} />
          <APath fill={`url(#${id('leaf')})`} animatedProps={leafR} />
          <AEllipse rx={3.4} ry={4} fill="#F5FBF2" stroke="#B9D3A6" strokeWidth={0.6} animatedProps={dew} />

          {/* Face */}
          <AEllipse rx={13} ry={8} fill={`url(#${id('cheek')})`} animatedProps={cheekL} />
          <AEllipse rx={13} ry={8} fill={`url(#${id('cheek')})`} animatedProps={cheekR} />
          <APath stroke="#3B4F27" strokeWidth={4.2} fill="none" strokeLinecap="round" animatedProps={browL} />
          <APath stroke="#3B4F27" strokeWidth={4.2} fill="none" strokeLinecap="round" animatedProps={browR} />
          <APath fill={`url(#${id('eye')})`} animatedProps={eyeL} />
          <APath fill={`url(#${id('eye')})`} animatedProps={eyeR} />
          <APath fill="#050B03" animatedProps={pupils} />
          <APath fill="#FFFFFF" animatedProps={shine} />
          <APath fill="#22180F" stroke="#22180F" strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" animatedProps={mouth} />
          <AEllipse fill="#FF8A78" animatedProps={tongue} />
          <APath fill="#EEF8F4" stroke="#9EC3B0" strokeWidth={1} animatedProps={sweat} />
        </Svg>
      </Animated.View>
    </View>
  );
}
