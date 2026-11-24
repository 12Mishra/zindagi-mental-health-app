// Moss's face is driven by one vector of numbers. Every expression is a preset of that vector, and Moss
// eases from one preset to the next, so any two faces blend smoothly.

export type MossExpression =
  | 'calm' | 'listening' | 'thinking' | 'concerned' | 'worried'
  | 'steady' | 'sleepy' | 'encouraging' | 'relieved' | 'happy';

export const PARAMS = [
  'eyeOpen', 'eyeSmile', 'pupil', 'lookX', 'lookY', 'browY', 'browTilt', 'curve', 'open',
  'blush', 'squash', 'droop', 'sweat', 'tilt', 'wave', 'aSage', 'aSun', 'aCoral', 'aMist',
] as const;
type Param = (typeof PARAMS)[number];
type Preset = Partial<Record<Param, number>>;

export const P = Object.fromEntries(PARAMS.map((k, i) => [k, i])) as Record<Param, number>;

const BASE: Record<Param, number> = {
  eyeOpen: 0.85, eyeSmile: 0, pupil: 1, lookX: 0, lookY: 0, browY: 0, browTilt: 0, curve: 0.3, open: 0,
  blush: 0.4, squash: 0, droop: 0.1, sweat: 0, tilt: 0, wave: 0, aSage: 1, aSun: 0, aCoral: 0, aMist: 0,
};

const glow = (sage: number, sun: number, coral: number, mist: number): Preset => ({ aSage: sage, aSun: sun, aCoral: coral, aMist: mist });

const PRESETS: Record<MossExpression, Preset> = {
  calm: { eyeOpen: 0.8, eyeSmile: 0.2, curve: 0.45, blush: 0.45, droop: 0.1, ...glow(1, 0, 0, 0) },
  listening: { eyeOpen: 1, pupil: 1.18, browY: 0.5, browTilt: 0.15, curve: 0.2, tilt: -7, ...glow(1, 0, 0, 0) },
  thinking: { eyeOpen: 0.78, pupil: 0.95, lookX: 0.7, lookY: -0.75, browY: 0.35, curve: 0.02, tilt: 5, ...glow(0.3, 0, 0, 0.7) },
  concerned: { eyeOpen: 0.86, pupil: 1.12, lookY: 0.1, browY: 0.15, browTilt: 0.85, curve: -0.12, blush: 0.3, droop: 0.35, ...glow(0.35, 0, 0.65, 0) },
  worried: { eyeOpen: 0.8, pupil: 1.15, browY: 0.25, browTilt: 1, curve: -0.4, open: 0.04, blush: 0.2, squash: -0.04, droop: 0.8, sweat: 1, ...glow(0, 0, 1, 0) },
  steady: { eyeOpen: 0.92, pupil: 1.05, browY: 0.1, browTilt: 0.4, curve: 0.02, blush: 0.15, droop: 0.2, ...glow(0, 0, 1, 0) },
  sleepy: { eyeOpen: 0.26, eyeSmile: 0.1, pupil: 0.9, lookY: 0.4, browY: -0.2, browTilt: 0.2, curve: 0.12, droop: 0.6, tilt: 6, ...glow(0, 0, 0, 1) },
  encouraging: { eyeOpen: 0.95, eyeSmile: 0.5, browY: 0.6, browTilt: 0.05, curve: 0.8, open: 0.14, blush: 0.7, tilt: -5, wave: 0.5, ...glow(0.2, 0.8, 0, 0) },
  relieved: { eyeOpen: 0.7, eyeSmile: 0.55, browY: 0.2, browTilt: 0.35, curve: 0.6, open: 0.05, blush: 0.65, droop: 0.05, ...glow(0.5, 0.5, 0, 0) },
  happy: { eyeOpen: 1, eyeSmile: 0.9, browY: 0.6, curve: 1, open: 0.42, blush: 0.95, squash: 0.05, droop: 0, tilt: -3, wave: 1, ...glow(0, 1, 0, 0) },
};

export const toVector = (name: MossExpression): number[] => {
  const preset = PRESETS[name];
  return PARAMS.map(k => preset[k] ?? BASE[k]);
};

/** Glow colours, in the order aSage, aSun, aCoral, aMist. */
export const AURA_RGB: readonly (readonly [number, number, number])[] = [
  [168, 196, 138],
  [218, 228, 132],
  [255, 168, 146],
  [200, 208, 192],
];

export const EXPRESSION_LABEL: Record<MossExpression, string> = {
  calm: 'Calm', listening: 'Listening', thinking: 'Thinking', concerned: 'Empathetic', worried: 'Worried',
  steady: 'Steady', sleepy: 'Sleepy', encouraging: 'Encouraging', relieved: 'Relieved', happy: 'Happy',
};
