import { TopBar } from '@/components/TopBar';
import { getMe, getRequests } from '@/lib/data';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const [me, requests] = await Promise.all([getMe(), getRequests('open')]);
  // Requests that need this counsellor's action (a proposal they sent is waiting on the student instead).
  const waiting = requests.filter((r) => r.status === 'PENDING').length;
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <TopBar name={me.displayName} waiting={waiting} />
      <main id="main" className="container">{children}</main>
    </>
  );
}
