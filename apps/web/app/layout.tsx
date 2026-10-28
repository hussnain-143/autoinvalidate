import type { Metadata } from 'next';
import './globals.css';
import Image from 'next/image';

export const metadata: Metadata = {
  metadataBase: new URL('https://github.com/hussnain-143/autoinvalidate'),
  title: 'autoinvalidate — Zero-Config PostgreSQL + Redis Query Cache',
  description:
    'Automatic write invalidation query cache for Node.js, PostgreSQL (pg), and Redis. In-memory LRU by default, scalable to distributed Redis Sets.',
  keywords: [
    'postgresql',
    'postgres',
    'pg',
    'redis',
    'cache',
    'cache invalidation',
    'query cache',
    'autoinvalidate',
    'sql cache',
    'nodejs',
    'typescript',
  ],
  authors: [{ name: 'Hussnain Ahmed', url: 'https://github.com/hussnain-143' }],
  openGraph: {
    title: 'autoinvalidate — Smart PostgreSQL + Redis Query Cache',
    description:
      'Wrap your pg pool once: SELECT queries are automatically cached and invalidated whenever tables or rows are updated.',
    url: 'https://github.com/hussnain-143/autoinvalidate',
    siteName: 'autoinvalidate',
    images: [
      {
        url: '/brand/og-banner.svg',
        width: 1200,
        height: 630,
        alt: 'autoinvalidate banner',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'autoinvalidate — PostgreSQL + Redis Smart Cache',
    description: 'Zero-config query caching with automatic write invalidation for Node.js.',
    images: ['/brand/og-banner.svg'],
  },
  icons: {
    icon: '/brand/favicon.svg',
    shortcut: '/brand/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {/* Sticky Header */}
        <header className="navbar">
          <div className="container nav-inner">
            <a href="/" className="brand-link">
              <img
                src="/brand/logo-mark.svg"
                alt="autoinvalidate logo"
                width={32}
                height={32}
                style={{ borderRadius: '6px' }}
              />
              <span>autoinvalidate</span>
              <span className="brand-badge">v1.0.0</span>
            </a>

            <nav className="nav-links">
              <a href="#features" className="nav-item">Features</a>
              <a href="#simulator" className="nav-item">Simulator</a>
              <a href="#quickstart" className="nav-item">Quickstart</a>
              <a href="#redis" className="nav-item">Redis Mode</a>
              <a href="#benchmarks" className="nav-item">Benchmarks</a>
              <a
                href="https://www.npmjs.com/package/autoinvalidate"
                target="_blank"
                rel="noreferrer"
                className="nav-item"
              >
                npm ↗
              </a>
              <a
                href="https://github.com/hussnain-143/autoinvalidate"
                target="_blank"
                rel="noreferrer"
                className="btn btn-secondary"
                style={{ padding: '6px 14px', fontSize: '0.85rem' }}
              >
                ★ Star on GitHub
              </a>
            </nav>
          </div>
        </header>

        {/* Main Page Content */}
        <main>{children}</main>

        {/* Footer */}
        <footer className="footer">
          <div className="container footer-inner">
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <img src="/brand/logo-mark.svg" alt="autoinvalidate logo" width={24} height={24} />
              <span>
                <strong>autoinvalidate</strong> — MIT License © {new Date().getFullYear()}{' '}
                <a
                  href="https://github.com/hussnain-143"
                  target="_blank"
                  rel="noreferrer"
                  style={{ textDecoration: 'underline' }}
                >
                  Hussnain Ahmed
                </a>
              </span>
            </div>

            <div style={{ display: 'flex', gap: '20px' }}>
              <a
                href="https://github.com/hussnain-143/autoinvalidate"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--text-muted)' }}
              >
                GitHub
              </a>
              <a
                href="https://github.com/hussnain-143/autoinvalidate/issues"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--text-muted)' }}
              >
                Issues
              </a>
              <a
                href="https://www.npmjs.com/package/autoinvalidate"
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--text-muted)' }}
              >
                NPM Registry
              </a>
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}

