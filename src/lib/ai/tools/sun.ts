import { tool } from 'ai';
import { z } from 'zod';
import { FORECAST_DAYS, FORECAST_URL, UV_BANDS } from '../constants';
import { fetchJson, geocode, locationSchema, placeName } from './shared';

const SunResponse = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    is_day: z.number(),
    uv_index: z.number().nullable(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
    daylight_duration: z.array(z.number()),
    uv_index_max: z.array(z.number().nullable()),
  }),
}).refine(
  // Same column-height assumption as the forecast tool, same reason to check it.
  ({ daily }) =>
    [daily.sunrise, daily.sunset, daily.daylight_duration, daily.uv_index_max].every(
      (column) => column.length === daily.time.length,
    ),
  { message: 'daily columns have mismatched lengths' },
);

const band = (uv: number) => UV_BANDS.find((b) => uv >= b.from)?.label ?? 'low';

/** "2026-08-24T18:36" -> "18:36". The API already returns local time. */
const clock = (iso: string) => iso.split('T')[1] ?? iso;

const hoursMinutes = (seconds: number) =>
  `${Math.floor(seconds / 3600)}h ${Math.round((seconds % 3600) / 60)}m`;

export const getSunAndUV = tool({
  description:
    'Get sunrise, sunset, remaining daylight and the UV index for a city or ' +
    'place. Use this whenever timing matters — "this evening", "before dark", ' +
    '"is it too late to go for a run" — or when the user asks about sunburn, ' +
    'sun protection or how strong the sun is. Separate from getWeather: call ' +
    'both when the user wants to know whether to go out and when.',

  inputSchema: z.object({
    location: locationSchema,
    forecastDays: z
      .number()
      .int()
      .min(FORECAST_DAYS.min)
      .max(FORECAST_DAYS.max)
      .default(FORECAST_DAYS.min)
      .describe(
        'How many days of sun times to return, counting today as day 1. Use 1 ' +
          'for "when does it get dark tonight", more only for trip planning.',
      ),
  }),

  execute: async ({ location, forecastDays }, { abortSignal }) => {
    const place = await geocode(location, abortSignal);
    if (!place.ok) return place.failure;

    const sun = await fetchJson(
      `${FORECAST_URL}?${new URLSearchParams({
        latitude: String(place.data.latitude),
        longitude: String(place.data.longitude),
        current: 'is_day,uv_index',
        daily: 'sunrise,sunset,daylight_duration,uv_index_max',
        forecast_days: String(forecastDays),
        timezone: 'auto',
      })}`,
      SunResponse,
      'sun and UV',
      abortSignal,
    );

    if (!sun.ok) return sun.failure;

    const { current, daily, timezone } = sun.data;
    const uv = current.uv_index;

    return {
      status: 'ok' as const,
      location: placeName(place.data),
      timezone,
      current: {
        observedAt: current.time,
        // The model cannot infer this from the clock alone — the sun sets at a
        // different hour every day, and the user's zone is not the server's.
        daylight: current.is_day === 1 ? 'daylight' : 'dark',
        uvIndex: uv,
        uvBand: uv === null ? 'unavailable' : band(uv),
      },
      days: daily.time.map((date, i) => ({
        date,
        sunrise: clock(daily.sunrise[i]),
        sunset: clock(daily.sunset[i]),
        daylight: hoursMinutes(daily.daylight_duration[i]),
        peakUv: daily.uv_index_max[i],
        peakUvBand:
          daily.uv_index_max[i] === null ? 'unavailable' : band(daily.uv_index_max[i]),
      })),
    };
  },
});
