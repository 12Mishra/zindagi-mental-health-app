import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import type { MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import React, { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

import { ZColors, ZFont, ZGradients, ZShadow } from '@/constants/zindagi-theme';
import { tap } from './press';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];
export const TAB_ICONS: Record<string, IconName> = {
  'mood-checkin': 'spa', voice: 'graphic-eq', counsellor: 'support-agent', saved: 'bookmarks',
};

export type ZTabBarProps = MaterialTopTabBarProps;

/**
 * Floating clay tab bar for the swipeable tab pager. The gloss pill is driven by the pager's live position,
 * so it tracks the finger mid-swipe and settles under the active tab.
 */
export function ZTabBar({ state, descriptors, emitter, navigateToTab, insets, position }: ZTabBarProps) {
  const routes = state.routes;
  const activeIndex = state.index;
  const [width, setWidth] = useState(0);
  const tabW = routes.length ? (width - 12) / routes.length : 0;
  const translateX = routes.length > 1
    ? position.interpolate({
      inputRange: routes.map((_, i) => i),
      outputRange: routes.map((_, i) => i * tabW),
      extrapolate: 'clamp',
    })
    : 0;
  const pill = { transform: [{ translateX }] };

  return (
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={[styles.bar, ZShadow.lifted]} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        <LinearGradient colors={ZGradients.clay} style={[StyleSheet.absoluteFill, styles.barFill]} />
        {tabW > 0 && (
          <Animated.View style={[styles.pill, { width: tabW }, pill]}>
            <LinearGradient colors={ZGradients.gloss} style={[StyleSheet.absoluteFill, { borderRadius: 20 }]} />
            <View style={styles.pillShine} />
          </Animated.View>
        )}
        {routes.map((route, i) => {
          const focused = i === activeIndex;
          const { options } = descriptors[route.key];
          const label = typeof options.title === 'string' ? options.title : route.name;
          const onPress = () => {
            const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) { tap(); navigateToTab(route.key); }
          };
          return (
            <Pressable key={route.key} onPress={onPress} style={styles.tab}
              accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label}>
              <MaterialIcons name={TAB_ICONS[route.name] ?? 'circle'} size={21} color={focused ? '#FFFFFF' : ZColors.textMuted} />
              <Text style={[styles.label, { color: focused ? '#FFFFFF' : ZColors.textMuted }]} numberOfLines={1}>{label}</Text>
              {focused && options.tabBarBadge ? <View style={styles.badge} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 14, paddingTop: 4, backgroundColor: ZColors.canvas },
  bar: { height: 64, borderRadius: 26, flexDirection: 'row', padding: 6 },
  barFill: { borderRadius: 26, borderWidth: 1, borderColor: ZColors.clayEdge },
  pill: { position: 'absolute', top: 6, left: 6, bottom: 6, borderRadius: 20, ...ZShadow.glow },
  pillShine: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, borderTopWidth: 1.5, borderColor: 'rgba(255,255,255,0.4)' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  label: { fontSize: 11, fontFamily: ZFont.bold, letterSpacing: 0.1 },
  badge: { position: 'absolute', top: 8, right: '28%', width: 7, height: 7, borderRadius: 4, backgroundColor: ZColors.coralDeep },
});
