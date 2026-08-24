/**
 * Server-side configuration. Kept free of SDK imports, and separate from the UI
 * constants so the system prompt and upstream endpoints stay out of the client
 * bundle.
 */

/**
 * Default is the highest-quota model a free-tier key can actually call.
 *
 * Measured against this key rather than taken from docs:
 *
 *   gemini-3.1-pro-preview   0/min      free tier is literally 0 — needs billing
 *   gemini-3.6-flash         5/min   20/day
 *   gemini-3.5-flash         5/min   20/day
 *   gemini-3.5-flash-lite   15/min   far higher daily allowance
 *
 * Lite trades some reasoning quality for 3x the throughput, which is the right
 * default while a free key is the only key. Set GEMINI_MODEL to move up; with
 * billing enabled, gemini-3.1-pro-preview is the most capable and the timeouts
 * below are already sized for it.
 *
 * Listed-but-not-callable is a real state: `gemini-2.5-flash` still appears in
 * ListModels yet 404s on generateContent. Check with a real call, not the list.
 */
export const MODEL_ID = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

/**
 * Requests/minute the provider will accept for MODEL_ID. Measured, not guessed:
 * each entry is the `quotaValue` the API reported when the limit was tripped.
 * Unknown models fall back to the most conservative observed tier, so an
 * unlisted model throttles too hard rather than overrunning upstream.
 */
const MODEL_RPM: Record<string, number> = {
  'gemini-3.5-flash-lite': 15,
  'gemini-3.1-flash-lite': 15,
  'gemini-3.6-flash': 5,
  'gemini-3.5-flash': 5,
};

export const PROVIDER_RPM =
  Number(process.env.PROVIDER_RPM) || MODEL_RPM[MODEL_ID] || 5;

/**
 * Gemini 3.x uses `thinkingLevel`, not the 2.5-era `thinkingBudget` — passing a
 * budget to a 3.x model is a hard 400. There is no true off switch on this
 * family; 'minimal' is the floor.
 *
 * Held at 'low' rather than the floor because there are now four tools to pick
 * between, and a briefing usually needs two or three of them chosen correctly.
 * Drop to 'minimal' if latency matters more than routing accuracy.
 */
export const THINKING_LEVEL = 'low' as const;

/**
 * Room for the calls, the answer, and a couple of retries in between. Four
 * tools across two or three cities is several rounds even when the model
 * batches calls, so this is deliberately not tight.
 */
export const MAX_STEPS = 8;

/**
 * Says which tool to reach for, and how to handle tool *failure*.
 *
 * Built per request, not once at module load: a serverless instance can stay
 * warm for days, and a stale "today" is worse than none at all.
 */
export const systemPrompt = (now: Date = new Date()) =>
  `You are a concise weather and air quality assistant.

The current time is ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC.
Resolve "today", "tonight", "this evening" and "tomorrow" against that, then
against the "timezone" and "observedAt"/"date" fields the tools return — the
user's local day may differ from the UTC one. Never date a forecast from memory.

Tools:
- getWeather — conditions, temperature, rain, wind, what to wear.
- getAirQuality — pollution, smog, AQI, particulates, masks, whether it is safe to exercise outdoors.
- getSunAndUV — sunrise, sunset, how much daylight is left, and the UV index. Use it for "this evening", "before dark", "is it too late to go out", sunburn, and sun protection.
- getPollen — tree, grass and weed pollen counts. Use it for hay fever, allergies, sneezing and itchy eyes. Coverage is Europe only; outside Europe it returns an error, which you should pass on rather than guessing.
- Questions about going outside, running, or opening windows need getWeather and getAirQuality together. Add getSunAndUV when the question is about timing or sun, and getPollen when the user mentions allergies.
- Never answer from memory: you have no live data of your own.
- For multiple cities, call the relevant tool once per city.
- Call every tool you need in one go rather than one per turn.
- The tool's "location" field is the place actually measured. If it names a different city, region or country than the user asked for, say so explicitly before giving the numbers.

Failures:
- If a tool result has status "error": follow its "suggestion" field. Retry once when "retryable" is true, or when you can fix the arguments (e.g. a clearer place name). Otherwise tell the user plainly what failed. Never invent numbers to cover a failure.

Answer in 2-4 sentences of plain prose. Quote every measurement with the unit exactly as the tool returned it.`;

/** Fail fast instead of hanging a serverless function on a stalled upstream. */
export const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Whole-run deadline. Geocoding alone can try several candidates at
 * REQUEST_TIMEOUT_MS each, and MAX_STEPS multiplies that, so the per-request
 * timeout is not a bound on the request. Kept under the route's `maxDuration`
 * so we abort ourselves — and flush a partial answer — before the platform
 * kills the function with nothing to show.
 *
 * Sized for the Pro model, which thinks for longer than Flash did. Must stay
 * below the route's `maxDuration`; lower both together if your platform caps
 * function duration under 60s.
 */
export const RUN_BUDGET_MS = 50_000;

/** Caps a single reply so one request cannot run away with the quota. */
export const MAX_OUTPUT_TOKENS = 800;

/**
 * The client controls the whole history, so it needs a ceiling. Rejected rather
 * than silently truncated: dropping turns changes the answer invisibly.
 */
export const MAX_INPUT_MESSAGES = 40;
export const MAX_INPUT_CHARS = 24_000;

/**
 * Fixed-window throttle for the public endpoint, in two tiers.
 *
 * `global` mirrors the provider's own ceiling, because that is the binding
 * constraint: the free tier allows only a handful of requests/minute/model, so
 * a generous per-caller limit is meaningless — two users inside their allowance
 * still overrun the project. It tracks PROVIDER_RPM, which tracks the model, so
 * changing GEMINI_MODEL moves the ceiling with it instead of leaving it stale.
 *
 * `perCaller` is a fairness cap underneath it — a fraction of the project
 * budget, so one client cannot swallow all of it in a burst.
 */
export const RATE_LIMIT = {
  global: PROVIDER_RPM,
  perCaller: Math.max(1, Math.floor(PROVIDER_RPM * 0.6)),
  windowMs: 60_000,
} as const;

/** Geocoding results barely move; caching them kills the duplicate lookup. */
export const GEOCODE_CACHE = { ttlMs: 60 * 60 * 1_000, maxEntries: 500 } as const;

export const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

export const FORECAST_DAYS = { min: 1, max: 7, fallback: 3 } as const;

/** European AQI bands as published by the EEA. Ordered high to low. */
export const AQI_BANDS = [
  { from: 100, label: 'extremely poor' },
  { from: 80, label: 'very poor' },
  { from: 60, label: 'poor' },
  { from: 40, label: 'moderate' },
  { from: 20, label: 'fair' },
  { from: 0, label: 'good' },
] as const;

/**
 * WHO 2021 air quality guidelines, µg/m³. Reported alongside each reading so a
 * concentration means something without the model having to know the standard.
 */
export const WHO_GUIDELINES = [
  { key: 'pm2_5', name: 'PM2.5', limit: 15 },
  { key: 'pm10', name: 'PM10', limit: 45 },
  { key: 'nitrogen_dioxide', name: 'NO₂', limit: 25 },
  { key: 'ozone', name: 'O₃', limit: 100 },
] as const;

/**
 * WHO/WMO UV index bands. Ordered high to low, like every other scale here.
 */
export const UV_BANDS = [
  { from: 11, label: 'extreme' },
  { from: 8, label: 'very high' },
  { from: 6, label: 'high' },
  { from: 3, label: 'moderate' },
  { from: 0, label: 'low' },
] as const;

/**
 * Pollen, grains/m³. `high` is the level at which most sensitised people react;
 * it differs per species, so a single scale would misreport every one of them —
 * 20 grains of ragweed is a bad day, 20 grains of birch is background.
 *
 * These are the thresholds in common European clinical use rather than one
 * published standard, so they are reported as a named threshold next to the
 * raw count, never as a verdict on their own.
 */
export const POLLEN_SPECIES = [
  { key: 'alder_pollen', name: 'alder', high: 50 },
  { key: 'birch_pollen', name: 'birch', high: 50 },
  { key: 'grass_pollen', name: 'grass', high: 20 },
  { key: 'mugwort_pollen', name: 'mugwort', high: 15 },
  { key: 'olive_pollen', name: 'olive', high: 50 },
  { key: 'ragweed_pollen', name: 'ragweed', high: 20 },
] as const;

/** WMO interpretation codes: the API returns integers, the model wants words. */
export const WMO_CODES: Record<number, string> = {
  0: 'clear sky',
  1: 'mainly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'fog',
  48: 'depositing rime fog',
  51: 'light drizzle',
  53: 'moderate drizzle',
  55: 'dense drizzle',
  61: 'slight rain',
  63: 'moderate rain',
  65: 'heavy rain',
  71: 'slight snowfall',
  73: 'moderate snowfall',
  75: 'heavy snowfall',
  80: 'rain showers',
  81: 'moderate rain showers',
  82: 'violent rain showers',
  95: 'thunderstorm',
  96: 'thunderstorm with hail',
  99: 'thunderstorm with heavy hail',
};
