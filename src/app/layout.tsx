import type { Metadata, Viewport } from 'next';
import { Archivo, IBM_Plex_Mono, Newsreader } from 'next/font/google';
import './globals.css';

// Archivo carries a width axis and is set condensed for chart lettering; Plex
// Mono holds every number and code; Newsreader is reserved for the agent's prose.
const display = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--f-display',
  display: 'swap',
});

const prose = Newsreader({ subsets: ['latin'], variable: '--f-prose', display: 'swap' });

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--f-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Isobar — weather briefings',
  description:
    'Ask about the weather anywhere and get a briefing built from live station data.',
};

/** Pinned to light so the browser never inverts the chart stock. */
export const viewport: Viewport = { colorScheme: 'light', themeColor: '#e7ebe6' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${prose.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
