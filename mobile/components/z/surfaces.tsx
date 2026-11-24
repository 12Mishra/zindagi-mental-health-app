import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ZColors, ZGradients, ZRadius, ZShadow } from '@/constants/zindagi-theme';

type SurfaceProps = { style?: StyleProp<ViewStyle>; radius?: number; children?: React.ReactNode; flat?: boolean };

/** Clay: a surface you rest on. Lit from above, soft green shadow below, bright top edge. */
export function Clay({ style, radius = ZRadius.cardLg, children, flat }: SurfaceProps) {
  return (
    <View style={[{ borderRadius: radius }, !flat && ZShadow.lifted, style]}>
      <LinearGradient
        colors={ZGradients.clay}
        style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 1, borderColor: ZColors.clayEdge }]}
      />
      {children}
    </View>
  );
}

/**
 * Frost: something floating over content. Real blur on iOS and web; Android gets a denser translucent fill,
 * because live blur is expensive on low-end Android GPUs.
 */
export function Frost({ style, radius = ZRadius.card, children, tint = 'light' }: SurfaceProps & { tint?: 'light' | 'sage' }) {
  const fill = tint === 'sage' ? 'rgba(212,227,200,0.55)' : 'rgba(255,255,255,0.55)';
  return (
    <View style={[{ borderRadius: radius, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.8)' }, ZShadow.subtle, style]}>
      {Platform.OS === 'android'
        ? <View style={[StyleSheet.absoluteFill, { backgroundColor: tint === 'sage' ? 'rgba(220,233,208,0.92)' : 'rgba(255,255,255,0.86)' }]} />
        : <>
          <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: fill }]} />
        </>}
      {children}
    </View>
  );
}

/** Gloss: only for the main action and the student's own messages. */
export function Gloss({ style, radius = ZRadius.card, children, colors = ZGradients.gloss }: SurfaceProps & { colors?: readonly [string, string, ...string[]] }) {
  return (
    <View style={[{ borderRadius: radius }, ZShadow.glow, style]}>
      <LinearGradient colors={colors} style={[StyleSheet.absoluteFill, { borderRadius: radius }]} />
      {/* top highlight */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderTopWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' }]} />
      {children}
    </View>
  );
}
