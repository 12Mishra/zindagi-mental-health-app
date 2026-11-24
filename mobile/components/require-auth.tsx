import { Redirect } from 'expo-router';
import React from 'react';

import { isAuthSessionValid, useAuthSession } from '@/lib/auth-session';

/**
 * Protected route guard: renders the screen only for a signed-in student with an unexpired session,
 * otherwise sends them to login. Signing out while the screen is open redirects straight away.
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const auth = useAuthSession();
  if (!isAuthSessionValid(auth)) return <Redirect href="/login" />;
  return <>{children}</>;
}
