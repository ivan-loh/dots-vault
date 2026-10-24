import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'dots-vault · Private vault',
  description:
    'Owner-unlocked encrypted vault, private notes and contacts, with separately published Shared Notes.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
