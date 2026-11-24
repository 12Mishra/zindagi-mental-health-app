import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { ZColors } from '@/constants/zindagi-theme';

function Bead({ delay, color }: { delay: number; color: string }) {
  const y = useSharedValue(0);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (reduce) return;
    y.value = withDelay(delay, withRepeat(withSequence(
      withTiming(-6, { duration: 300, easing: Easing.out(Easing.quad) }),
      withTiming(0, { duration: 300, easing: Easing.in(Easing.quad) }),
      withTiming(0, { duration: 250 }),
    ), -1));
  }, [delay, reduce, y]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: y.value }],
  }));
  return <Animated.View style={[styles.bead, { backgroundColor: color }, style]}><View style={styles.shine} /></Animated.View>;
}

/** Three clay beads that bounce in turn. Used for "someone is typing" and "Lisa is thinking". */
export function TypingDots({ color = ZColors.olive }: { color?: string }) {
  return (
    <View style={styles.row} accessibilityLabel="Typing">
      <Bead delay={0} color={color} />
      <Bead delay={150} color={ZColors.sageMid} />
      <Bead delay={300} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, alignItems: 'center', height: 18 },
  bead: { width: 9, height: 9, borderRadius: 5 },
  shine: { position: 'absolute', top: 1.5, left: 2, width: 3, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.7)' },
});
