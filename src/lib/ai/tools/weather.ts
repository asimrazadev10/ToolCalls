import { tool } from 'ai';
import { z } from 'zod';
import { FORECAST_DAYS, FORECAST_URL, WMO_CODES } from '../constants';
import { fetchJson, geocode, locationSchema, placeName } from './shared';

const ForecastResponse = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: z.number(),
    relative_humidity_2m: z.number(),
    wind_speed_10m: z.number(),
    weather_code: z.number(),
  }),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number()),
    temperature_2m_max: z.array(z.number()),
    temperature_2m_min: z.array(z.number()),
    precipitation_probability_max: z.array(z.number().nullable()),
  }),
})
  // The daily block is column-oriented, and nothing in the shape says the
  // columns are the same height. A short one would quietly index to undefined
  // and print "undefined°C" — both in the card and in what the model quotes.
  // Better to fail as a payload-shape error the caller already handles.
  .refine(
    ({ daily }) =>
      [
        daily.weather_code,
        daily.temperature_2m_max,
        daily.temperature_2m_min,
        daily.precipitation_probability_max,
      ].every((column) => column.length === daily.time.length),
    { message: 'daily columns have mismatched lengths' },
  );

const describeCode = (code: number) => WMO_CODES[code] ?? `unknown (WMO ${code})`;

export const getWeather = tool({
  description:
    'Get the current conditions and daily forecast for a city or place. Use this ' +
    'whenever the user asks about weather, temperature, rain, wind or what to wear. ' +
    'Resolves the place name to coordinates first, so plain city names are fine.',

  inputSchema: z.object({
    location: locationSchema,
    unit: z
      .enum(['celsius', 'fahrenheit'])
      .default('celsius')
      .describe(
        'Temperature unit for the response. Default to celsius unless the user ' +
          'asked for Fahrenheit or is clearly in the United States.',
      ),
    forecastDays: z
      .number()
      .int()
      .min(FORECAST_DAYS.min)
      .max(FORECAST_DAYS.max)
      .default(FORECAST_DAYS.fallback)
      .describe(
        'How many days of forecast to return, counting today as day 1. Use 1 for ' +
          '"what is it like right now", 3 for general questions, up to 7 for trip planning.',
      ),
  }),

  execute: async ({ location, unit, forecastDays }, { abortSignal }) => {
    const place = await geocode(location, abortSignal);
    if (!place.ok) return place.failure;

    const forecast = await fetchJson(
      `${FORECAST_URL}?${new URLSearchParams({
        latitude: String(place.data.latitude),
        longitude: String(place.data.longitude),
        current: 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code',
        daily:
          'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        forecast_days: String(forecastDays),
        temperature_unit: unit,
        wind_speed_unit: 'kmh',
        timezone: 'auto',
      })}`,
      ForecastResponse,
      'forecast',
      abortSignal,
    );

    if (!forecast.ok) return forecast.failure;

    const { current, daily, timezone } = forecast.data;
    const degrees = unit === 'celsius' ? '°C' : '°F';

    // Units are embedded in the values so the model cannot mislabel them.
    return {
      status: 'ok' as const,
      location: placeName(place.data),
      timezone,
      current: {
        observedAt: current.time,
        temperature: `${current.temperature_2m}${degrees}`,
        conditions: describeCode(current.weather_code),
        humidity: `${current.relative_humidity_2m}%`,
        windSpeed: `${current.wind_speed_10m} km/h`,
      },
      forecast: daily.time.map((date, i) => ({
        date,
        conditions: describeCode(daily.weather_code[i]),
        high: `${daily.temperature_2m_max[i]}${degrees}`,
        low: `${daily.temperature_2m_min[i]}${degrees}`,
        precipitationChance: `${daily.precipitation_probability_max[i] ?? 0}%`,
      })),
    };
  },
});
