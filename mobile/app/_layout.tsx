import {
  BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
} from '@expo-google-fonts/bricolage-grotesque';
import {
  PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold, useFonts,
} from '@expo-google-fonts/plus-jakarta-sans';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-reanimated';

import { SupportPromptHost } from '@/components/support-prompt-sheet';
import { ZColors } from '@/constants/zindagi-theme';

void SplashScreen.preventAutoHideAsync().catch(() => {});

export const unstable_settings = {
  initialRouteName: 'login',
  anchor: '(tabs)',
};

// The student app is designed light-only for now: the Moss materials are lit for a pale canvas.
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: ZColors.canvas, primary: ZColors.olive } };

export default function RootLayout() {
  const [loaded, failed] = useFonts({
    BricolageGrotesque_700Bold, BricolageGrotesque_800ExtraBold,
    PlusJakartaSans_400Regular, PlusJakartaSans_500Medium, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  useEffect(() => { if (loaded || failed) void SplashScreen.hideAsync().catch(() => {}); }, [loaded, failed]);
  if (!loaded && !failed) return null;

  return (
    <ThemeProvider value={theme}>
      <Stack
        initialRouteName="login"
        screenOptions={{
          contentStyle: { backgroundColor: ZColors.canvas },
          animation: 'fade_from_bottom',
          headerShown: false,
        }}
      >
        <Stack.Screen name="login" options={{ animation: 'fade' }} />
        <Stack.Screen name="profile-details" />
        <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="trusted-contacts" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="contact-log" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="chat/[id]" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal', headerShown: true }} />
      </Stack>
      <SupportPromptHost />
      <StatusBar style="dark" />
    </ThemeProvider>
  );
}
