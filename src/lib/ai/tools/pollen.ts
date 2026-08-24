import { tool } from 'ai';
import { z } from 'zod';
import { AIR_QUALITY_URL, POLLEN_SPECIES } from '../constants';
import { fail, fetchJson, geocode, locationSchema, placeName } from './shared';

const PollenResponse = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    alder_pollen: z.number().nullable(),
    birch_pollen: z.number().nullable(),
    grass_pollen: z.number().nullable(),
    mugwort_pollen: z.number().nullable(),
    olive_pollen: z.number().nullable(),
    ragweed_pollen: z.number().nullable(),
  }),
});

export const getPollen = tool({
  description:
    'Get current tree, grass and weed pollen counts for a city or place, each ' +
    'against the level at which most sensitised people react. Use this for hay ' +
    'fever, allergies, sneezing, itchy eyes, or whether to keep windows shut. ' +
    'Coverage is Europe only — outside Europe this returns an error rather ' +
    'than a zero, and you should say so instead of guessing.',

  inputSchema: z.object({
    location: locationSchema,
  }),

  execute: async ({ location }, { abortSignal }) => {
    const place = await geocode(location, abortSignal);
    if (!place.ok) return place.failure;

    const reading = await fetchJson(
      `${AIR_QUALITY_URL}?${new URLSearchParams({
        latitude: String(place.data.latitude),
        longitude: String(place.data.longitude),
        current: POLLEN_SPECIES.map((s) => s.key).join(','),
        timezone: 'auto',
      })}`,
      PollenResponse,
      'pollen',
      abortSignal,
    );

    if (!reading.ok) return reading.failure;

    const { current, timezone } = reading.data;
    const where = placeName(place.data);

    // Outside Europe the endpoint answers 200 with every species null. Reporting
    // that as "no pollen detected" would be a lie the model has no way to catch,
    // so it becomes an explicit, non-retryable failure instead.
    if (POLLEN_SPECIES.every(({ key }) => current[key] === null)) {
      return fail(
        `No pollen coverage for ${where}.`,
        'Pollen forecasts cover Europe only. Tell the user this location is outside the covered area, and do not substitute an air-quality reading for it.',
      );
    }

    return {
      status: 'ok' as const,
      location: where,
      timezone,
      observedAt: current.time,
      species: POLLEN_SPECIES.map(({ key, name, high }) => {
        const value = current[key];
        return {
          name,
          value: value === null ? 'unavailable' : `${value} grains/m³`,
          highThreshold: `${high} grains/m³`,
          // Share of the "most people react" level, so the count means something
          // without the model having to know per-species thresholds.
          ratio: value === null ? null : Number((value / high).toFixed(2)),
        };
      }),
    };
  },
});
