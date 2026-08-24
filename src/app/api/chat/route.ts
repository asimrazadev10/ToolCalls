import {
  convertToModelMessages,
  safeValidateUIMessages,
  type ModelMessage,
} from 'ai';
import { streamAgent } from '@/lib/ai/agent';
import { MAX_INPUT_CHARS, MAX_INPUT_MESSAGES, RUN_BUDGET_MS } from '@/lib/ai/constants';
import { callerKey, rateLimit } from '@/lib/ai/rate-limit';
import type { AgentUIMessage } from '@/lib/ai/types';

/**
 * Tool round-trips add latency — raise the default serverless timeout. Sized
 * above RUN_BUDGET_MS so the run aborts itself first and can flush a partial
 * answer. Lower both if your platform caps function duration below 60s.
 */
export const maxDuration = 60;

const refuse = (status: number, reason: string, headers?: HeadersInit) =>
  Response.json({ error: reason }, { status, headers });

const badRequest = (reason: string) => refuse(400, reason);

/** Rough proxy for prompt size — cheaper than tokenising, and only a ceiling. */
const historyChars = (messages: AgentUIMessage[]) =>
  messages.reduce(
    (total, message) =>
      total +
      message.parts.reduce(
        (n, part) => n + (part.type === 'text' ? part.text.length : 0),
        0,
      ),
    0,
  );

/**
 * Chat endpoint for the `useChat` hook from '@ai-sdk/react'.
 *
 * The client sends `UIMessage[]` (UI-shaped, with parts); the model needs
 * `ModelMessage[]`. `convertToModelMessages` bridges the two — passing UI
 * messages straight to the model is the most common v5 wiring bug.
 *
 * Everything before `streamText` runs while there is still no stream to fail
 * into, so `onError` below cannot cover it. A bad body has to be rejected here
 * or it surfaces as an opaque 500.
 */
export async function POST(req: Request) {
  // Cheapest check first: a throttled caller should not get to parse a body.
  const limit = rateLimit(callerKey(req));

  if (!limit.ok) {
    // Distinguish the two: "you are asking too fast" is the caller's to fix,
    // "the desk is full" is not, and telling them apart avoids a pointless retry.
    return refuse(
      429,
      limit.scope === 'global'
        ? `The desk is at capacity. Try again in ${limit.retryAfterSeconds}s.`
        : 'Too many requests from you. Wait a moment and try again.',
      { 'retry-after': String(limit.retryAfterSeconds) },
    );
  }

  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  // `safeValidateUIMessages` is the SDK's own checker, so it stays in step with
  // whatever `convertToModelMessages` is willing to accept.
  const validated = await safeValidateUIMessages<AgentUIMessage>({
    messages: (body as { messages?: unknown } | null)?.messages,
  });

  if (!validated.success) {
    console.warn('[chat] rejected malformed messages:', validated.error.message);
    return badRequest('`messages` must be an array of UI messages.');
  }

  // The client owns the whole history, so it needs a ceiling in both dimensions.
  if (validated.data.length > MAX_INPUT_MESSAGES) {
    return refuse(413, `Conversation is too long (limit ${MAX_INPUT_MESSAGES} messages).`);
  }

  if (historyChars(validated.data) > MAX_INPUT_CHARS) {
    return refuse(413, `Conversation is too large (limit ${MAX_INPUT_CHARS} characters).`);
  }

  // A crafted history — say, an assistant tool call with no matching result —
  // survives conversion but makes the provider 400 ("function call turn must
  // come immediately after a user turn"). `useChat` always posts a history
  // ending in the new user message, so anything else is a bad caller, and
  // catching it here saves a billed round-trip.
  if (validated.data.at(-1)?.role !== 'user') {
    return badRequest('The last message must be from the user.');
  }

  let messages: ModelMessage[];

  try {
    messages = convertToModelMessages(validated.data);
  } catch (cause) {
    // Shape-valid but unconvertible — e.g. a tool call with no matching result.
    // Still the caller's problem, so keep it a 400 rather than a server fault.
    console.warn('[chat] could not convert messages', cause);
    return badRequest('Message history could not be converted for the model.');
  }

  // Two ways to stop: the caller goes away, or the run outstays `maxDuration`.
  // Self-aborting flushes whatever has streamed so far; a platform timeout does
  // not. `AbortSignal.any` takes whichever fires first.
  const deadline = AbortSignal.any([req.signal, AbortSignal.timeout(RUN_BUDGET_MS)]);

  const result = streamAgent(messages, deadline);

  // Streams text *and* tool-call/tool-result parts, so the UI can render
  // "checking the weather..." while the tool runs.
  return result.toUIMessageStreamResponse({
    // Errors thrown outside the tool (auth, quota, network) still need a
    // message the client can display instead of an opaque stream abort.
    onError: (error) => {
      console.error('[chat] stream failed', error);
      return 'The assistant hit an error. Please try again.';
    },
  });
}
