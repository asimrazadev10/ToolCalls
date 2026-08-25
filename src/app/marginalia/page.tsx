import type { Metadata } from 'next';
import { readSupabaseConfig } from '@/rag/db/client';
import { Desk } from './desk';

export const metadata: Metadata = {
  title: 'Marginalia — ask your documents',
  description:
    'Ask questions of your own documents and get answers that cite the page they came from.',
};

/**
 * Configuration is read on the server and handed down as props, so the browser
 * never needs a NEXT_PUBLIC_ copy of values that already exist. Both are safe
 * to ship — `anon` holds no grant on the rag schema — but duplicating an
 * environment variable is how the two copies eventually disagree.
 */
export default function MarginaliaPage() {
  const { url, publishableKey } = readSupabaseConfig(process.env);

  return <Desk supabaseUrl={url} supabasePublishableKey={publishableKey} />;
}
