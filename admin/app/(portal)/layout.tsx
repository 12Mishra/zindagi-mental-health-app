import { TopBar } from '@/components/TopBar';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <a href="#main" className="sr-only">Skip to content</a>
      <TopBar />
      <main id="main" className="page">{children}</main>
    </>
  );
}
