import { ViewStyle } from 'react-native';

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

export const ZRadius = {
  pill: 100,
  card: 20,
  cardLg: 28,
  small: 12,
  xs: 6,
};

export const ZShadow: { card: ViewStyle; subtle: ViewStyle } = {
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
};
