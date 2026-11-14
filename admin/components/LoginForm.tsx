'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from '@/lib/actions';

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <main className="login-wrap">
      <form className="login-card" action={action}>
        <div>
          <p className="brand">Zindagi</p>
          <h1>Admin sign-in</h1>
        </div>
        <label className="field">
          Email
          <input type="email" name="email" required autoComplete="username" />
        </label>
        <label className="field">
          Password
          <input type="password" name="password" required autoComplete="current-password" />
        </label>
        <button type="submit" className="btn" style={{ padding: '11px 16px' }} disabled={pending}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="login-error" role="alert">{state.error ?? (expired ? 'Your session expired. Please sign in again.' : '')}</p>
      </form>
    </main>
  );
}
