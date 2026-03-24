// apps/web/app/layout.tsx
import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import SandboxBanner from '../components/SandboxBanner';
import './globals.css';

export const metadata: Metadata = {
  title:       'ResolveX — Smart Civic CRM',
  description: 'File and track civic complaints in real time',
  manifest:    '/manifest.json',
};

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  themeColor:   '#4F46E5',
};

// FIX: children must be explicitly typed as React.ReactNode in strict mode
// Original error: "Binding element 'children' implicitly has an 'any' type. ts(7031)"
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const demoMode = process.env.NEXT_PUBLIC_MODE === 'demo';

  return (
    <html lang="en">
      <body className="bg-gray-50 text-gray-900 antialiased">
        <SandboxBanner demoMode={demoMode} />
        <nav className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-40">
          <Link href="/" className="font-bold text-indigo-600 tracking-tight">
            ResolveX
          </Link>
          <Link href="/file" className="text-sm text-indigo-600 font-medium hover:underline">
            Report issue
          </Link>
        </nav>
        <div className="min-h-screen">{children}</div>
      </body>
    </html>
  );
}
