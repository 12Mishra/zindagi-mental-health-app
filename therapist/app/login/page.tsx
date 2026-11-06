'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    // Mock sign-in: phase 2 replaces this with POST /staff/login on core.
    document.cookie = 'zindagi_therapist=1; path=/; max-age=86400; samesite=lax';
    router.push('/');
  }

  return (
    <main className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div>
          <p className="wordmark">Zindagi</p>
          <h1 className="page-title" style={{ marginTop: 14 }}>Therapist sign-in</h1>
          <p className="subtitle">Use your institution email.</p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" className="input" type="email" autoComplete="username" required defaultValue="dullat@example.edu" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" className="input" type="password" autoComplete="current-password" required defaultValue="password" />
        </div>
        <button type="submit" className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
