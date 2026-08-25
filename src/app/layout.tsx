import type { Metadata, Viewport } from 'next';
import { Archivo, Courier_Prime, IBM_Plex_Mono, Newsreader, Spectral } from 'next/font/google';
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

// Marginalia's pair. Spectral carries prose the model composed; Courier Prime
// carries text quoted verbatim from a page, so the typeface itself tells a
// reader which is which.
const documentSerif = Spectral({
  subsets: ['latin'],
  weight: ['400', '600'],
  style: ['normal', 'italic'],
  variable: '--f-document',
  display: 'swap',
});

const typewriter = Courier_Prime({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--f-typewriter',
  display: 'swap',
});

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
    <html
      lang="en"
      className={[
        display.variable,
        prose.variable,
        mono.variable,
        documentSerif.variable,
        typewriter.variable,
      ].join(' ')}
    >
      <body>{children}</body>
    </html>
  );
}
