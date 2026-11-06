import { TopBar } from '@/components/TopBar';
import { THERAPIST_NAME } from '@/lib/data';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar name={THERAPIST_NAME} />
      <main className="container">{children}</main>
    </>
  );
}
