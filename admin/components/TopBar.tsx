'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();

  function signOut() {
    document.cookie = 'zs_admin_mock=; path=/; max-age=0';
    router.push('/login');
  }

  const items = [
    { href: '/', label: 'Overview' },
    { href: '/alerts', label: 'Alerts' },
  ];

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="wordmark">Zindagi</Link>
        <nav className="nav" aria-label="Main">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={pathname === i.href ? 'page' : undefined}>
              {i.label}
            </Link>
          ))}
        </nav>
        <div className="who">
          <span>Signed in as Admin (demo)</span>
          <button type="button" className="btn ghost sm" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </header>
  );
}
