import { google, type GoogleGenerativeAIProviderOptions } from '@ai-sdk/google';
import { generateText, streamText, stepCountIs, type ModelMessage } from 'ai';
import {
  MAX_OUTPUT_TOKENS,
  MAX_STEPS,
  MODEL_ID,
  THINKING_LEVEL,
  systemPrompt,
} from './constants';
import { getAirQuality } from './tools/air-quality';
import { getPollen } from './tools/pollen';
import { getSunAndUV } from './tools/sun';
import { getWeather } from './tools/weather';

/**
 * `stopWhen` is the v5 replacement for v4's `maxSteps`. Without it the SDK stops
 * after the first tool call and `text` comes back empty. On v4 the equivalent is
 * `maxSteps: MAX_STEPS`; on v6 `stepCountIs` became `isStepCount`.
 */

// Reads GOOGLE_GENERATIVE_AI_API_KEY from the environment. Use `createGoogle({ apiKey })`
// if you need to supply one explicitly.
const model = google(MODEL_ID);

const providerOptions = {
  google: {
    thinkingConfig: { thinkingLevel: THINKING_LEVEL },
  } satisfies GoogleGenerativeAIProviderOptions,
};

/** One registry keeps `generateText` and `streamText` in sync. */
export const tools = { getWeather, getAirQuality, getSunAndUV, getPollen } as const;

/** One-shot run, for cron jobs, evals and server actions. */
export async function runAgent(prompt: string) {
  const { text, steps, usage } = await generateText({
    model,
    system: systemPrompt(),
    prompt,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    onStepFinish: ({ toolCalls, toolResults }) => {
      for (const call of toolCalls) console.debug('[agent] call', call.toolName, call.input);
      for (const result of toolResults) console.debug('[agent] result', result.toolName, result.output);
    },
  });

  return { text, toolCalls: steps.flatMap((step) => step.toolCalls), usage };
}

/**
 * Streaming variant; the caller decides how to serialise the result.
 *
 * `abortSignal` is not optional in spirit: pass the request signal so a client
 * disconnect ends the run. It reaches the provider fetch *and* every tool's
 * `execute`, so an abandoned request stops stepping instead of running on to
 * MAX_STEPS with nobody listening.
 */
export function streamAgent(messages: ModelMessage[], abortSignal?: AbortSignal) {
  return streamText({
    model,
    system: systemPrompt(),
    messages,
    tools,
    stopWhen: stepCountIs(MAX_STEPS),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions,
    abortSignal,
    // An abort is a normal outcome, not a fault — keep it out of `onError`.
    onAbort: () => console.debug('[agent] run aborted by the caller'),
  });
}

// Smoke test: `npm run agent`
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { text, toolCalls } = await runAgent(
    'Is it a good idea to go for a run in Lahore this evening?',
  );
  console.log('\nTools used:', toolCalls.map((c) => c.toolName).join(', ') || 'none');
  console.log('\n' + text);
}
