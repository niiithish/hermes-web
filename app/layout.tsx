import type { Metadata } from 'next';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'Hermes Control Interface',
  description: 'Self-hosted web dashboard for the Hermes AI agent stack',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;500;600;700&amp;display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/styles/github-dark.min.css"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        <Providers>
          {children}
        </Providers>
        <script
          src="https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11/build/highlight.min.js"
          crossOrigin="anonymous"
        />
      </body>
    </html>
  );
}
