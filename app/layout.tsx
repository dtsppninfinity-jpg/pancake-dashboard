import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'PN Infinity — Pancake Dashboard',
  description: 'Pancake POS Dashboard (Next.js + Supabase)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
