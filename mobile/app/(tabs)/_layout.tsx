import { Tabs } from "expo-router";
import React from "react";

import { ZTabBar } from "@/components/z/tab-bar";
import { ZColors } from "@/constants/zindagi-theme";

export default function TabLayout() {
  return (
    <Tabs
      tabBar={props => <ZTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: ZColors.canvas },
        animation: "shift",
      }}
    >
      <Tabs.Screen name="mood-checkin" options={{ title: "Mood" }} />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="voice" options={{ title: "Voice" }} />
      <Tabs.Screen name="counsellor" options={{ title: "Counsellor" }} />
      <Tabs.Screen name="dashboard" options={{ href: null }} />
      <Tabs.Screen name="saved" options={{ title: "Saved" }} />
    </Tabs>
  );
}
