import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zindagi Admin",
  description: "Community well-being overview for institution admins",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
