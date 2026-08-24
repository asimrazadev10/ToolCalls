/** Presentation constants. Everything here ships to the browser. */

export const SEED_QUESTIONS = [
  'Should I take an umbrella in Lahore tomorrow?',
  'Is the air clean enough to run outside in Delhi?',
  'Have I got time for a run in Karachi before dark?',
  'Is the pollen bad in Berlin right now?',
] as const;

/** Indexed by Date#getUTCDay, so labels never shift with the viewer's zone. */
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Every scale in the interface reuses the same four tokens, so a card the reader
 * has never seen still reads at a glance. Ordered high to low; first match wins.
 */
export type Stop = { readonly from: number; readonly color: string };

/** Radar reflectivity, for precipitation probability (%). */
export const RADAR_STOPS: readonly Stop[] = [
  { from: 75, color: 'var(--r3)' },
  { from: 45, color: 'var(--r2)' },
  { from: 15, color: 'var(--r1)' },
  { from: 0, color: 'var(--r0)' },
];

/** European AQI bands, collapsed onto the same four tokens. */
export const AQI_STOPS: readonly Stop[] = [
  { from: 80, color: 'var(--r3)' },
  { from: 60, color: 'var(--r2)' },
  { from: 40, color: 'var(--r1)' },
  { from: 0, color: 'var(--r0)' },
];

/** Pollutant concentration as a multiple of its WHO guideline. */
export const GUIDELINE_STOPS: readonly Stop[] = [
  { from: 2, color: 'var(--r3)' },
  { from: 1, color: 'var(--r2)' },
  { from: 0.5, color: 'var(--r1)' },
  { from: 0, color: 'var(--r0)' },
];

/** A pollutant at 3x its guideline fills the meter. */
export const GUIDELINE_FULL_SCALE = 3;

/** WHO UV index bands, collapsed onto the same four tokens. */
export const UV_STOPS: readonly Stop[] = [
  { from: 8, color: 'var(--r3)' },
  { from: 6, color: 'var(--r2)' },
  { from: 3, color: 'var(--r1)' },
  { from: 0, color: 'var(--r0)' },
];

/** UV 11 is the top of the published scale, so it fills the meter. */
export const UV_FULL_SCALE = 11;

/** Pollen count as a share of the level most sensitised people react at. */
export const POLLEN_STOPS: readonly Stop[] = [
  { from: 1, color: 'var(--r3)' },
  { from: 0.5, color: 'var(--r2)' },
  { from: 0.2, color: 'var(--r1)' },
  { from: 0, color: 'var(--r0)' },
];

/** Twice the reaction threshold fills the meter. */
export const POLLEN_FULL_SCALE = 2;

/** Keeps a 0% bar visible as a tick rather than collapsing the track. */
export const MIN_BAR_PERCENT = 2;

/**
 * Barograph geometry. One tile is a full drum revolution; the trace is drawn
 * twice and shifted by exactly one tile, which is what makes the loop seamless.
 */
export const BAROGRAPH = {
  tile: 1200,
  height: 82,
  steps: 120,
  inkSeed: 20260819,
  inkAmplitude: 13,
  ghostSeed: 74341551,
  ghostAmplitude: 8,
  rulePitch: 48,
  ruleCount: 50,
  cursorInset: 58,
} as const;
