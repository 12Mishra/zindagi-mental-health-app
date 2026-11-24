'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from '@/lib/actions';

const NAV = [
  { href: '/', label: 'Today' },
  { href: '/requests', label: 'Requests' },
  { href: '/messages', label: 'Messages' },
  { href: '/availability', label: 'Availability' },
];

export function TopBar({ name, waiting, unread }: { name: string; waiting: number; unread: number }) {
  const pathname = usePathname();

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
                {n.href === '/requests' && waiting > 0 && (
                  <span className="count-badge" aria-label={`${waiting} waiting`}>{waiting}</span>
                )}
                {n.href === '/messages' && unread > 0 && (
                  <span className="count-badge" aria-label={`${unread} unread`}>{unread}</span>
                )}
              </Link>
            );
          })}
        </nav>
        <div className="topbar-right">
          <span className="chip">Counsellor</span>
          <span className="user-name">{name}</span>
          <form action={signOut}>
            <button type="submit" className="btn secondary small">Sign out</button>
          </form>
        </div>
      </div>
    </header>
  );
}
