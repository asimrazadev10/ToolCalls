import { z } from 'zod';
import { GEOCODE_CACHE, GEOCODING_URL, REQUEST_TIMEOUT_MS } from '../constants';

/**
 * Shared plumbing for every tool: a failure shape the model can act on, a
 * fetch that returns failures as data, and the place lookup both tools start with.
 */

export type ToolFailure = {
  status: 'error';
  error: string;
  retryable: boolean;
  suggestion: string;
};

export const fail = (
  error: string,
  suggestion: string,
  retryable = false,
): ToolFailure => ({ status: 'error', error, retryable, suggestion });

export type Fetched<T> = { ok: true; data: T } | { ok: false; failure: ToolFailure };

/**
 * Combines the per-request deadline with the run-level signal, so a client
 * disconnect cancels an upstream call already in flight rather than waiting out
 * the timeout.
 */
const deadline = (signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
};

/**
 * Node reports every transport problem as a bare "fetch failed" and hides the
 * real reason one level down in `cause`. Without the code — ECONNRESET,
 * ENOTFOUND, UND_ERR_SOCKET — a failure is undiagnosable from the logs alone.
 */
function describeNetworkError(cause: unknown): string {
  if (!(cause instanceof Error)) return String(cause);

  const inner = (cause as { cause?: unknown }).cause;
  const code =
    inner && typeof inner === 'object' && 'code' in inner
      ? String((inner as { code: unknown }).code)
      : undefined;
  const detail = inner instanceof Error ? inner.message : undefined;

  return [cause.message, code, detail && detail !== cause.message ? detail : undefined]
    .filter(Boolean)
    .join(' — ');
}

/** Fetches and validates, returning failures as data so callers need no try/catch. */
export async function fetchJson<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  label: string,
  signal?: AbortSignal,
): Promise<Fetched<z.infer<T>>> {
  let response: Response;

  try {
    response = await fetch(url, {
      signal: deadline(signal),
      headers: { accept: 'application/json' },
    });
  } catch (cause) {
    const timedOut = cause instanceof Error && cause.name === 'TimeoutError';
    return {
      ok: false,
      failure: fail(
        timedOut
          ? `The ${label} API did not respond within ${REQUEST_TIMEOUT_MS}ms.`
          : `Could not reach the ${label} API: ${describeNetworkError(cause)}`,
        'This is a transient network issue. Retry once; if it fails again, tell the user the service is unreachable.',
        true,
      ),
    };
  }

  if (!response.ok) {
    // 4xx means the model's arguments were wrong, so retrying them verbatim
    // cannot help — steer it toward fixing the input instead.
    const clientError = response.status >= 400 && response.status < 500;
    return {
      ok: false,
      failure: fail(
        `The ${label} API returned HTTP ${response.status} (${response.statusText}).`,
        clientError
          ? 'The request arguments were rejected. Re-check the location spelling and call the tool again with corrected input.'
          : 'The upstream service is degraded. Retry once, then report the outage to the user.',
        !clientError,
      ),
    };
  }

  const parsed = schema.safeParse(await response.json().catch(() => null));

  if (!parsed.success) {
    return {
      ok: false,
      failure: fail(
        `The ${label} API returned an unexpected payload shape.`,
        'Do not retry — this is a server-side contract change. Tell the user the data is temporarily unavailable.',
      ),
    };
  }

  return { ok: true, data: parsed.data };
}

const GeocodingResponse = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

export type Place = NonNullable<z.infer<typeof GeocodingResponse>['results']>[number];

/**
 * Open-Meteo's geocoder matches "City, Region" but not "City Region", so a
 * perfectly reasonable model output like "Gujrat Pakistan" misses entirely.
 * Try the query as written, then the comma-qualified readings of it.
 */
function candidates(location: string) {
  const q = location.trim().replace(/\s+/g, ' ');
  if (q.includes(',')) return [q, q.split(',')[0].trim()];

  const words = q.split(' ');
  if (words.length < 2) return [q];

  // The qualifier is usually the last word ("Gujrat Pakistan"). For longer
  // strings, fall back to first-word plus last-word ("Gujrat Punjab Pakistan"
  // -> "Gujrat, Pakistan") rather than the bare city, so the country still
  // constrains the match.
  return [
    ...new Set([
      q,
      `${words.slice(0, -1).join(' ')}, ${words.at(-1)}`,
      `${words[0]}, ${words.slice(1).join(' ')}`,
      `${words[0]}, ${words.at(-1)}`,
    ]),
  ];
}

/**
 * A city's coordinates do not move, and a single "should I go outside?" turn
 * asks both tools for the same place — without this they each pay the full
 * lookup, serially, ahead of the reading that actually matters.
 */
const cache = new Map<string, { at: number; place: Place }>();

function cached(key: string, now: number): Place | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;

  if (now - hit.at > GEOCODE_CACHE.ttlMs) {
    cache.delete(key);
    return undefined;
  }

  // Re-insert so iteration order stays least-recently-used first.
  cache.delete(key);
  cache.set(key, hit);
  return hit.place;
}

function remember(key: string, place: Place, now: number) {
  cache.set(key, { at: now, place });
  while (cache.size > GEOCODE_CACHE.maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * A resolved cache is not enough. The model is told to call its tools in one
 * go, so all four fire before any of them has finished — every one misses, and
 * the same city is looked up four times in parallel. Holding the in-flight
 * promise collapses them into a single lookup.
 *
 * Safe because concurrent callers here are always tools within one run, sharing
 * that run's abort signal: if the shared lookup is cancelled, every caller
 * waiting on it was being cancelled anyway.
 */
const inFlight = new Map<string, Promise<Fetched<Place>>>();

/** Test seam: both maps are module state and outlive a single request. */
export const __resetGeocodeCache = () => {
  cache.clear();
  inFlight.clear();
};

/** Every tool takes a free-text place name, so every tool starts here. */
export async function geocode(
  location: string,
  signal?: AbortSignal,
): Promise<Fetched<Place>> {
  const key = location.trim().replace(/\s+/g, ' ').toLowerCase();
  const now = Date.now();

  const hit = cached(key, now);
  if (hit) return { ok: true, data: hit };

  const pending = inFlight.get(key);
  if (pending) return pending;

  const lookup = resolve(location, key, now, signal).finally(() => inFlight.delete(key));
  inFlight.set(key, lookup);
  return lookup;
}

async function resolve(
  location: string,
  key: string,
  now: number,
  signal?: AbortSignal,
): Promise<Fetched<Place>> {
  for (const name of candidates(location)) {
    const result = await fetchJson(
      `${GEOCODING_URL}?${new URLSearchParams({
        name,
        count: '1',
        language: 'en',
        format: 'json',
      })}`,
      GeocodingResponse,
      'geocoding',
      signal,
    );

    // A transport or HTTP problem will repeat for every candidate, so stop here.
    if (!result.ok) return result;

    const place = result.data.results?.[0];
    if (place) {
      // Only successes are cached — a miss may be a typo the model fixes next turn.
      remember(key, place, now);
      return { ok: true, data: place };
    }
  }

  // A miss is a normal outcome, not an exception — hand back a concrete move.
  return {
    ok: false,
    failure: fail(
      `No location matched "${location}".`,
      'Ask the user to confirm the spelling, or retry with a more specific name such as "<city>, <country>".',
    ),
  };
}

export const placeName = (place: Place) =>
  [place.name, place.admin1, place.country].filter(Boolean).join(', ');

/** Shared by both tools' input schemas so the guidance stays identical. */
export const locationSchema = z
  .string()
  .min(2)
  .describe(
    'City or place name to look up. To disambiguate, add a region or country ' +
      'after a comma — "Paris, France", "Springfield, Illinois", "Gujrat, Pakistan". ' +
      'Always use a comma before the qualifier, never a space. ' +
      'Never pass coordinates, postal codes or vague phrases like "here".',
  );
