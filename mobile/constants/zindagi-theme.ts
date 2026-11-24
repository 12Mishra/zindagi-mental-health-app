import { Platform, ViewStyle } from 'react-native';

export const ZColors = {
  cream: '#F4F4F0',
  creamDark: '#EAEAE4',
  creamCard: '#EEEEE6',

  dark: '#121212',
  darkSurface: '#1C1C1C',
  darkCard: '#252525',
  darkBorder: '#333333',

  sageLight: '#D4E3C8',
  sage: '#A8B89B',
  sageMid: '#8FAA82',
  olive: '#6B7C4F',
  oliveDark: '#556040',
  forest: '#2D4A1E',
  forestDark: '#1A2E10',

  coralLight: '#FFD4CC',
  coral: '#FFB3A7',
  coralMid: '#FF8A78',
  coralDeep: '#E05C47',

  textPrimary: '#1E321E',
  textSecondary: '#4A6048',
  textMuted: '#7A9078',
  textOnDark: '#E8E8E8',
  textSubtleOnDark: '#9A9A9A',

  // Surfaces for the "Moss" design language. Same palette, lit from the top left.
  canvas: '#EEF3E7',
  clayTop: '#FBFDF8',
  clayBottom: '#EDF3E5',
  clayEdge: 'rgba(255,255,255,0.9)',
  hairline: 'rgba(85,96,64,0.12)',
  ink: '#16260F',

  // 0 = no data, 1–2 = positive (sage), 3–4 = distress (coral), 5 = crisis
  heatmap: [
    '#EEF4E8',
    '#C8D5B9',
    '#A8C48A',
    '#FFD4CC',
    '#FFB3A7',
    '#E05C47',
  ] as readonly string[],
};

/** Gradient stops, top to bottom. */
export const ZGradients = {
  gloss: ['#8FAA6E', '#556040', '#3D4A2B'] as const,
  clay: [ZColors.clayTop, ZColors.clayBottom] as const,
  coral: ['#FF9C8B', '#E05C47'] as const,
  chip: ['#FFFFFF', '#EEF3E8'] as const,
};

/** Font families loaded in app/_layout.tsx. Use these instead of fontWeight so Android picks the right face. */
export const ZFont = {
  display: 'BricolageGrotesque_800ExtraBold',
  displayBold: 'BricolageGrotesque_700Bold',
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  heavy: 'PlusJakartaSans_800ExtraBold',
};

export const ZRadius = {
  pill: 100,
  card: 20,
  cardLg: 28,
  sheet: 34,
  small: 12,
  xs: 6,
};

export const ZShadow: { card: ViewStyle; subtle: ViewStyle; lifted: ViewStyle; glow: ViewStyle } = {
  card: {
    shadowColor: '#2D4A1E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  subtle: {
    shadowColor: '#2D4A1E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  // Clay surfaces: a soft, green-tinted key shadow below.
  lifted: {
    shadowColor: '#2D4A1E',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  // Primary actions: a coloured glow under the gloss.
  glow: {
    shadowColor: '#3D4A2B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 8,
  },
};

/** Spring presets: gentle for Moss, bouncy for presses and new content, snappy for layout. */
export const ZSpring = {
  gentle: { damping: 18, stiffness: 120, mass: 1 },
  bouncy: { damping: 12, stiffness: 260, mass: 0.8 },
  snappy: { damping: 22, stiffness: 380, mass: 0.7 },
};

export const isAndroid = Platform.OS === 'android';

/** Web only: inputs draw their own focus ring, so drop the browser outline. */
export const webNoOutline = (Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) as object;
