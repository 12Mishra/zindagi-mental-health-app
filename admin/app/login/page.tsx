'use client';

import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Mock only: Phase 2 replaces this with a server action against core /staff/login.
    document.cookie = 'zs_admin_mock=1; path=/; max-age=43200; samesite=lax';
    router.push('/');
  }

  return (
    <main className="login-wrap">
      <form className="login-card" onSubmit={onSubmit}>
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
        <button type="submit" className="btn" style={{ padding: '11px 16px' }}>Sign in</button>
        <p className="login-note">Demo build: any email and password work.</p>
      </form>
    </main>
  );
}
