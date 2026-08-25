/**
 * Wires the answering step to Gemini.
 *
 * Deliberately a plain text generation with **no tools bound**. That is the
 * structural half of Marginalia's injection defence: an instruction smuggled
 * inside an uploaded PDF reaches the model as context, and with no tool
 * registry present there is nothing for it to actuate — no request to make,
 * no other tenant's data in reach.
 *
 * The answer comes back as JSON rather than through structured-output tooling,
 * because tool-shaped structured output is exactly the affordance we are
 * withholding. A parse failure degrades to a refusal rather than to prose with
 * invented citations.
 */

import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AnswerGenerator } from './answer-question';

const ANSWER_MODEL_ID = 'gemini-3.5-flash-lite';

const RESPONSE_INSTRUCTION = `
Reply with JSON only, in exactly this shape:
{"answer": "<your answer>", "citations": ["<passage id>", ...]}
No prose outside the JSON, no code fence.`;

function parseAnswer(raw: string): { answer: string; citations: string[] } {
  // Models fence JSON even when told not to; strip it rather than fail.
  const withoutFence = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');

  try {
    const parsed = JSON.parse(withoutFence) as { answer?: unknown; citations?: unknown };
    return {
      answer: typeof parsed.answer === 'string' ? parsed.answer : '',
      citations: Array.isArray(parsed.citations)
        ? parsed.citations.filter((id): id is string => typeof id === 'string')
        : [],
    };
  } catch {
    // No citations means answerFromChunks refuses, which is the right outcome
    // for an unparseable reply — better silence than a claim with no source.
    return { answer: '', citations: [] };
  }
}

export function createGeminiAnswerGenerator(options: {
  apiKey: string;
  signal?: AbortSignal;
}): AnswerGenerator {
  const google = createGoogleGenerativeAI({ apiKey: options.apiKey });

  return async (prompt) => {
    const { text } = await generateText({
      model: google(ANSWER_MODEL_ID),
      system: `${prompt.system}\n${RESPONSE_INSTRUCTION}`,
      prompt: prompt.user,
      abortSignal: options.signal,
      // No `tools` key. Its absence is the defence.
    });

    return parseAnswer(text);
  };
}
