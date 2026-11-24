'use client';

import { useActionState } from 'react';
import { signIn, type SignInState } from '@/lib/actions';

export function LoginForm({ expired }: { expired: boolean }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, {});
  const message = state.error ?? (expired ? 'Your session expired. Please sign in again.' : '');

  return (
    <main className="login-wrap">
      <form className="card login-card" action={action}>
        <div>
          <p className="wordmark">Zindagi</p>
          <h1 className="page-title" style={{ marginTop: 14 }}>Counsellor sign-in</h1>
          <p className="subtitle">Use your institution email.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" name="email" className="input" type="email" autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" name="password" className="input" type="password" autoComplete="current-password" required />
        </div>
        <button type="submit" className="btn" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        <p className="form-error" role="alert">{message}</p>
      </form>
    </main>
  );
}
