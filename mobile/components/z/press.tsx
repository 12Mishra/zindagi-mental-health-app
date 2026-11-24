import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ZColors, ZFont, ZGradients, ZRadius, ZShadow, ZSpring } from '@/constants/zindagi-theme';

const APressable = Animated.createAnimatedComponent(Pressable);

export const tap = (style: 'light' | 'medium' = 'light') => {
  if (Platform.OS === 'web') return;
  void Haptics.impactAsync(style === 'light' ? Haptics.ImpactFeedbackStyle.Light : Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

type PressScaleProps = Omit<PressableProps, 'style'> & { style?: StyleProp<ViewStyle>; scaleTo?: number; haptic?: boolean };

/** Pressable that squishes on press with a bouncy spring and a light haptic. */
export function PressScale({ style, scaleTo = 0.94, haptic = true, onPressIn, onPressOut, disabled, children, ...rest }: PressScaleProps) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <APressable
      {...rest}
      disabled={disabled}
      onPressIn={e => { scale.set(withSpring(scaleTo, ZSpring.snappy)); if (haptic) tap(); onPressIn?.(e); }}
      onPressOut={e => { scale.set(withSpring(1, ZSpring.bouncy)); onPressOut?.(e); }}
      style={[style, animated, disabled && { opacity: 0.45 }]}
    >
      {children}
    </APressable>
  );
}

type Variant = 'gloss' | 'clay' | 'coral' | 'ghost';
type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  iconRight?: boolean;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/** The one button. Gloss = primary, Clay = secondary, Coral = urgent/destructive, Ghost = text link. */
export function ZButton({ label, onPress, variant = 'gloss', icon, iconRight, disabled, loading, compact, style, accessibilityLabel }: ButtonProps) {
  const fg = variant === 'gloss' || variant === 'coral' ? '#FFFFFF' : variant === 'ghost' ? ZColors.olive : ZColors.textPrimary;
  const iconEl = icon ? <MaterialIcons name={icon} size={compact ? 16 : 18} color={variant === 'clay' && icon === 'call-end' ? ZColors.coralDeep : fg} /> : null;
  const body = (
    <View style={[styles.row, compact ? styles.compact : styles.regular]}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : <>
        {!iconRight && iconEl}
        <Text style={[styles.label, compact && { fontSize: 13.5 }, { color: fg }]} numberOfLines={1}>{label}</Text>
        {iconRight && iconEl}
      </>}
    </View>
  );
  const radius = compact ? 18 : 20;
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[{ borderRadius: radius }, variant === 'gloss' && ZShadow.glow, variant === 'clay' && ZShadow.lifted, style]}
    >
      {variant !== 'ghost' && (
        <LinearGradient
          colors={variant === 'gloss' ? ZGradients.gloss : variant === 'coral' ? ZGradients.coral : ZGradients.clay}
          style={[StyleSheet.absoluteFill, { borderRadius: radius },
            variant === 'clay' && { borderWidth: 1, borderColor: ZColors.clayEdge }]}
        />
      )}
      {(variant === 'gloss' || variant === 'coral') && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderTopWidth: 1.5, borderColor: 'rgba(255,255,255,0.42)' }]} />
      )}
      {body}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  regular: { paddingVertical: 16, paddingHorizontal: 22, minHeight: 54 },
  compact: { paddingVertical: 11, paddingHorizontal: 16, minHeight: 44 },
  label: { fontFamily: ZFont.bold, fontSize: 15.5, letterSpacing: 0.1 },
});

export const pillRadius = ZRadius.pill;
