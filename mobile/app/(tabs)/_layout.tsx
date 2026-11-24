import { TopTabs } from "expo-router/js-top-tabs";
import React from "react";

import { ZTabBar } from "@/components/z/tab-bar";
import { ZColors } from "@/constants/zindagi-theme";

/**
 * The student tabs sit on a native pager (react-native-pager-view), so a horizontal swipe drags the next tab in
 * and the bottom bar's pill follows the finger. Tapping a tab slides to it the same way.
 */
export default function TabLayout() {
  return (
    <TopTabs
      tabBarPosition="bottom"
      tabBar={props => <ZTabBar {...props} />}
      style={{ backgroundColor: ZColors.canvas }}
      screenOptions={{
        lazy: true,
        lazyPreloadDistance: 1,
        swipeEnabled: true,
        animationEnabled: true,
        sceneStyle: { backgroundColor: ZColors.canvas },
      }}
    >
      <TopTabs.Screen name="mood-checkin" options={{ title: "Mood" }} />
      <TopTabs.Screen name="voice" options={{ title: "Voice" }} />
      <TopTabs.Screen name="counsellor" options={{ title: "Counsellor" }} />
      <TopTabs.Screen name="saved" options={{ title: "Saved" }} />
    </TopTabs>
  );
}
