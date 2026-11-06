'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV = [
  { href: '/', label: 'Today' },
  { href: '/availability', label: 'Availability' },
];

export function TopBar({ name }: { name: string }) {
  const pathname = usePathname();
  const router = useRouter();

  function signOut() {
    document.cookie = 'zindagi_therapist=; path=/; max-age=0; samesite=lax';
    router.push('/login');
  }

  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="wordmark" aria-label="Zindagi, home">Zindagi</Link>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => {
            const active = n.href === '/' ? pathname === '/' || pathname.startsWith('/appointments') : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-right">
          <span className="chip">Therapist</span>
          <span className="user-name">{name}</span>
          <button type="button" className="btn secondary small" onClick={signOut}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
