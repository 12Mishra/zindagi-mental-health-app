import { TopBar } from '@/components/TopBar';
import { getMe } from '@/lib/data';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const me = await getMe();
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <TopBar name={me.displayName} />
      <main id="main" className="page">{children}</main>
    </>
  );
}
