import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Todo App',
  description: 'Singapore timezone aware todo manager'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-100">
        <div className="min-h-screen">
          <header className="border-b border-slate-800/60 bg-slate-950/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
              <Link href="/" className="text-lg font-semibold tracking-wide text-slate-100 hover:text-white">
                Todo Dashboard
              </Link>
              <nav className="flex items-center gap-3 text-sm font-medium uppercase tracking-wide">
                <Link
                  href="/"
                  className="rounded border border-transparent px-3 py-1 text-slate-300 transition hover:border-blue-500/60 hover:text-blue-200"
                >
                  Home
                </Link>
                <Link
                  href={{ pathname: '/calendar' }}
                  className="rounded border border-transparent px-3 py-1 text-slate-300 transition hover:border-blue-500/60 hover:text-blue-200"
                >
                  Calendar
                </Link>
              </nav>
            </div>
          </header>
          <main className="min-h-[calc(100vh-64px)]">{children}</main>
        </div>
      </body>
    </html>
  );
}
