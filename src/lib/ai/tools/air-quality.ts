import { tool } from 'ai';
import { z } from 'zod';
import { AIR_QUALITY_URL, AQI_BANDS, WHO_GUIDELINES } from '../constants';
import { fetchJson, geocode, locationSchema, placeName } from './shared';

const AirQualityResponse = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    european_aqi: z.number().nullable(),
    pm2_5: z.number().nullable(),
    pm10: z.number().nullable(),
    nitrogen_dioxide: z.number().nullable(),
    ozone: z.number().nullable(),
  }),
});

// Bands are ordered high to low and floored at 0, so only a negative index —
// which the scale does not define — can miss. Fall through rather than throw.
const band = (aqi: number) => AQI_BANDS.find((b) => aqi >= b.from)?.label ?? 'good';

export const getAirQuality = tool({
  description:
    'Get current air quality for a city or place: the European AQI plus the ' +
    'pollutants behind it, each compared against the WHO guideline. Use this for ' +
    'questions about pollution, smog, haze, masks, asthma, opening windows, or ' +
    'whether it is safe to exercise outdoors. This is separate from the weather — ' +
    'call getWeather as well when the user asks about going outside.',

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
        current: 'european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
        timezone: 'auto',
      })}`,
      AirQualityResponse,
      'air quality',
      abortSignal,
    );

    if (!reading.ok) return reading.failure;

    const { current, timezone } = reading.data;

    return {
      status: 'ok' as const,
      location: placeName(place.data),
      timezone,
      observedAt: current.time,
      index: {
        scale: 'European AQI',
        // Null means the model has no index to quote — say so rather than guess.
        value: current.european_aqi,
        band: current.european_aqi === null ? 'unavailable' : band(current.european_aqi),
      },
      pollutants: WHO_GUIDELINES.map(({ key, name, limit }) => {
        const value = current[key];
        return {
          name,
          value: value === null ? 'unavailable' : `${value} µg/m³`,
          whoGuideline: `${limit} µg/m³`,
          // How many times over the guideline, so the number carries meaning.
          ratio: value === null ? null : Number((value / limit).toFixed(2)),
        };
      }),
    };
  },
});
