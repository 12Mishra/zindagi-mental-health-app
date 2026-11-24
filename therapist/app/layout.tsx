import type { Metadata, Viewport } from 'next';
import './globals.css';
import './chat.css';

export const metadata: Metadata = {
  title: 'Zindagi Counsellor',
  description: 'Zindagi therapist portal',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
