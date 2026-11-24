import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';

import { ZColors } from '@/constants/zindagi-theme';

/**
 * The shared screen ground: pale canvas with three soft pools of light (sage top left, a warm blush top right,
 * sage rising from the bottom). Static, so it costs one draw.
 */
export function Backdrop({ variant = 'default' }: { variant?: 'default' | 'calm' }) {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 200">
        <Defs>
          <RadialGradient id="bdA" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#C3DAAA" stopOpacity="0.85" />
            <Stop offset="1" stopColor="#C3DAAA" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bdB" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFE0D6" stopOpacity={variant === 'calm' ? 0.35 : 0.7} />
            <Stop offset="1" stopColor="#FFE0D6" stopOpacity="0" />
          </RadialGradient>
          <RadialGradient id="bdC" cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#A8C48A" stopOpacity="0.55" />
            <Stop offset="1" stopColor="#A8C48A" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="200" fill={ZColors.canvas} />
        <Ellipse cx="0" cy="0" rx="95" ry="70" fill="url(#bdA)" />
        <Ellipse cx="100" cy="14" rx="70" ry="55" fill="url(#bdB)" />
        <Ellipse cx="50" cy="215" rx="95" ry="70" fill="url(#bdC)" />
      </Svg>
    </View>
  );
}
