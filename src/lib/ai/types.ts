import type { InferUITools, UIDataTypes, UIMessage } from 'ai';
import type { tools } from './agent';

/**
 * `InferUITools` turns the server tool registry into the shape the client
 * receives, so `part.type === 'tool-getWeather'` narrows `part.output` to the
 * tool's real return union. `import type` keeps server code out of the bundle.
 */
export type AgentUIMessage = UIMessage<never, UIDataTypes, InferUITools<typeof tools>>;

type Part = AgentUIMessage['parts'][number];

export type WeatherToolPart = Extract<Part, { type: 'tool-getWeather' }>;
export type AirToolPart = Extract<Part, { type: 'tool-getAirQuality' }>;
export type SunToolPart = Extract<Part, { type: 'tool-getSunAndUV' }>;
export type PollenToolPart = Extract<Part, { type: 'tool-getPollen' }>;

export type AgentToolPart = WeatherToolPart | AirToolPart | SunToolPart | PollenToolPart;
