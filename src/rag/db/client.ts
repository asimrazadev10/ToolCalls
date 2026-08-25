/**
 * Supabase access for Marginalia.
 *
 * Every client made here is scoped to the `rag` schema. This project's
 * `public` schema belongs to an unrelated live application with real data;
 * pointing at it would be a data-integrity incident rather than a bug, so the
 * schema is not a caller-supplied option.
 *
 * Access is carried by the signed-in user's own token, which is what makes
 * row-level security do the work. A service-role key would bypass RLS
 * entirely — every tenant's documents visible to every request — so
 * `readSupabaseConfig` refuses one outright rather than trusting that nobody
 * pastes the wrong value into `.env`.
 */

import { createClient } from '@supabase/supabase-js';

export const MARGINALIA_SCHEMA = 'rag';

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

const present = (value: string | undefined): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Recognizes a key that must never be shipped. Both the modern `sb_secret_`
 * prefix and a legacy JWT carrying `"role":"service_role"` bypass row-level
 * security completely.
 */
function rejectSecretKey(key: string): void {
  if (key.startsWith('sb_secret_')) {
    throw new Error(
      'SUPABASE_PUBLISHABLE_KEY holds a secret key. A secret key bypasses row-level ' +
        'security, so shipping it exposes every tenant. Use the publishable key.',
    );
  }

  const [, payload] = key.split('.');
  if (!payload) return;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: unknown;
    };
    if (claims.role === 'service_role') {
      throw new Error(
        'SUPABASE_PUBLISHABLE_KEY holds a service_role key. It bypasses row-level ' +
          'security, so shipping it exposes every tenant. Use the anon key.',
      );
    }
  } catch (cause) {
    // A key that is not a decodable JWT is simply not a service-role JWT.
    if (cause instanceof Error && cause.message.includes('service_role')) throw cause;
  }
}

export function readSupabaseConfig(
  environment: Record<string, string | undefined>,
): SupabaseConfig {
  const url = environment.SUPABASE_URL;
  const publishableKey = environment.SUPABASE_PUBLISHABLE_KEY;

  // Named individually so a misconfigured deploy says which line of .env is
  // wrong, rather than failing at the first query with a connection error.
  if (!present(url)) throw new Error('SUPABASE_URL is not set.');
  if (!present(publishableKey)) throw new Error('SUPABASE_PUBLISHABLE_KEY is not set.');

  rejectSecretKey(publishableKey.trim());

  return { url: url.trim(), publishableKey: publishableKey.trim() };
}

/**
 * A client acting as one signed-in user. The access token is forwarded on
 * every request, so `auth.uid()` resolves inside the database and the policies
 * apply to the person actually asking.
 */
export function createMarginaliaClient(config: SupabaseConfig, accessToken: string) {
  // Return type inferred rather than annotated as SupabaseClient: that type
  // defaults its schema parameter to "public", so annotating it would report
  // a rag-scoped client as a mismatch. Generated database types will make this
  // precise later.
  return createClient(config.url, config.publishableKey, {
    db: { schema: MARGINALIA_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** The rag-scoped client shape, for consumers to reference. */
export type MarginaliaClient = ReturnType<typeof createMarginaliaClient>;
