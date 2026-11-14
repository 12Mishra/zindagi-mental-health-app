'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/actions';

export function TopBar({ name }: { name: string }) {
  const pathname = usePathname();

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
          <span>Signed in as {name}</span>
          <form action={signOut}>
            <button type="submit" className="btn ghost sm">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
