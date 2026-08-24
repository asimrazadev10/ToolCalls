import { RATE_LIMIT } from './constants';

/**
 * Fixed-window throttle, held in process memory, enforced at two levels:
 * one window for the whole project and one per caller.
 *
 * The caveat matters more here than for a per-caller-only limiter. Memory is
 * per instance, so on a platform that fans out across lambdas the "global"
 * window is really per instance — N instances allow N × RATE_LIMIT.global,
 * which is exactly what the provider ceiling cannot absorb. Single instance,
 * this is correct; beyond that, move the counter to Redis or Vercel KV.
 */

type Window = { count: number; resetAt: number };

const windows = new Map<string, Window>();

const GLOBAL = 'global';
/** Namespaced so a caller cannot collide with the global bucket. */
const callerWindow = (key: string) => `caller:${key}`;

/** Trusts the platform's proxy header; falls back to a shared bucket. */
export function callerKey(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'anonymous';
}

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number; scope: 'global' | 'caller' };

/** Returns the live window for a key, rolling it over if it has expired. */
function open(key: string, now: number): Window {
  const existing = windows.get(key);
  if (existing && existing.resetAt > now) return existing;

  const fresh = { count: 0, resetAt: now + RATE_LIMIT.windowMs };
  windows.set(key, fresh);
  return fresh;
}

export function rateLimit(key: string, now = Date.now()): RateLimitResult {
  // Windows are only ever touched on request, so sweep expired ones here rather
  // than holding a timer open in a serverless process.
  if (windows.size > 1_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
  }

  const global = open(GLOBAL, now);
  const caller = open(callerWindow(key), now);

  // Both are checked before either is charged: a request turned away by one
  // limit must not burn budget in the other.
  const blocked =
    global.count >= RATE_LIMIT.global
      ? ({ window: global, scope: 'global' } as const)
      : caller.count >= RATE_LIMIT.perCaller
        ? ({ window: caller, scope: 'caller' } as const)
        : null;

  if (blocked) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((blocked.window.resetAt - now) / 1_000)),
      scope: blocked.scope,
    };
  }

  global.count += 1;
  caller.count += 1;

  return {
    ok: true,
    remaining: Math.min(
      RATE_LIMIT.global - global.count,
      RATE_LIMIT.perCaller - caller.count,
    ),
  };
}

/** Test seam: the window map is module state and outlives a single request. */
export const __resetRateLimit = () => windows.clear();
