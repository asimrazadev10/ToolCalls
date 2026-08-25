/**
 * Per-user rate limiting, counted in Postgres.
 *
 * The weather agent's limiter keeps counters in process memory, which is
 * correct on one instance and wrong on several: the "global" window becomes
 * per-instance and the provider ceiling is overrun by a factor of N, which is
 * the thing a limiter exists to prevent. Postgres is what every instance
 * already shares, so the counter lives there and this is a thin call to it.
 *
 * The bucket is derived from `auth.uid()` inside the database, never passed
 * in. A caller-supplied bucket would let anyone spend somebody else's
 * allowance — a denial-of-service handed out with the API.
 */

import type { RpcCapableClient } from './document-repository';

export interface RateLimit {
  /** Names the window. Each operation gets its own allowance. */
  operation: string;
  maxRequests: number;
  windowSeconds: number;
}

export interface SlotClaim {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Asking is interactive and costs two model calls. Ingesting costs an
 * embedding call for every chunk in the document, so it is held far tighter.
 * Separate windows, so a burst of uploads cannot stop someone asking.
 */
export const MARGINALIA_LIMITS = {
  ask: { operation: 'ask', maxRequests: 20, windowSeconds: 60 },
  upload: { operation: 'upload', maxRequests: 5, windowSeconds: 300 },
} as const satisfies Record<string, RateLimit>;

interface SlotRow {
  allowed?: boolean;
  retry_after_seconds?: number;
}

export async function claimRequestSlot(
  client: RpcCapableClient,
  limit: RateLimit,
): Promise<SlotClaim> {
  const { data, error } = await client.rpc('claim_request_slot', {
    operation: limit.operation,
    max_requests: limit.maxRequests,
    window_seconds: limit.windowSeconds,
  });

  // Fails open, deliberately. A limiter that fails closed turns one broken
  // dependency into a total outage; failing open costs a burst of over-limit
  // traffic, and the provider's own ceiling is still underneath as a backstop.
  if (error) return { allowed: true, retryAfterSeconds: 0 };

  const row = Array.isArray(data) ? (data[0] as SlotRow | undefined) : undefined;
  if (!row || typeof row.allowed !== 'boolean') return { allowed: true, retryAfterSeconds: 0 };

  return { allowed: row.allowed, retryAfterSeconds: row.retry_after_seconds ?? 0 };
}
