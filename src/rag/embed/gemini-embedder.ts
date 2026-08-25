/**
 * Turns text into vectors via Gemini's embedding endpoint.
 *
 * The transport arrives as a parameter rather than being imported. Batching,
 * ordering across batch boundaries, dimension checking and error handling are
 * all worth testing, and none of them should cost a request against a quota
 * this tight to exercise.
 *
 * The task type is not decoration. Verified against the live API: identical
 * text embeds to visibly different vectors as RETRIEVAL_DOCUMENT and
 * RETRIEVAL_QUERY. Embedding a question the same way as a passage discards an
 * asymmetry the model offers for free.
 */

import { EMBEDDING_MODEL_ID } from '../config';
import { assertEmbeddingShape } from './vector-encoding';

/**
 * Documents are embedded as passages to be searched; questions as searches
 * against them. The endpoint accepts more types, but Marginalia has exactly
 * these two jobs.
 */
export type EmbeddingTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY';

/**
 * Requests per call. Well inside the endpoint's ceiling, and small enough that
 * one rejected batch during ingestion is cheap to retry.
 */
export const EMBEDDING_BATCH_SIZE = 100;

const EMBEDDING_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL_ID}:batchEmbedContents`;

export interface EmbedTextsInput {
  texts: string[];
  taskType: EmbeddingTaskType;
  signal?: AbortSignal;
}

export type GeminiEmbedder = (input: EmbedTextsInput) => Promise<number[][]>;

export interface GeminiEmbedderOptions {
  apiKey: string;
  /** Injected in tests; defaults to the platform fetch. */
  fetchImplementation?: typeof fetch;
}

interface BatchEmbedResponse {
  embeddings?: { values?: number[] }[];
  error?: { message?: string };
}

function batchesOf<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    batches.push(items.slice(start, start + size));
  }
  return batches;
}

export function createGeminiEmbedder(options: GeminiEmbedderOptions): GeminiEmbedder {
  const performRequest = options.fetchImplementation ?? fetch;

  async function embedOneBatch(input: EmbedTextsInput, texts: string[]): Promise<number[][]> {
    const response = await performRequest(`${EMBEDDING_ENDPOINT}?key=${options.apiKey}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: input.signal,
      body: JSON.stringify({
        requests: texts.map((text) => ({
          model: `models/${EMBEDDING_MODEL_ID}`,
          content: { parts: [{ text }] },
          taskType: input.taskType,
        })),
      }),
    });

    const payload = (await response.json()) as BatchEmbedResponse;

    if (!response.ok) {
      // The provider's own wording distinguishes a quota problem from a bad
      // key from a malformed request; replacing it with our own loses that.
      throw new Error(
        `Embedding request failed (${response.status}): ${payload.error?.message ?? 'no message'}`,
      );
    }

    const embeddings = payload.embeddings ?? [];
    if (embeddings.length !== texts.length) {
      // Silently shorter output would misalign every vector after the gap,
      // storing each chunk against its neighbour's embedding.
      throw new Error(
        `Embedding response held ${embeddings.length} vectors, expected ${texts.length}.`,
      );
    }

    return embeddings.map((embedding) => {
      const values = embedding.values ?? [];
      assertEmbeddingShape(values);
      return values;
    });
  }

  return async function embedTexts(input: EmbedTextsInput): Promise<number[][]> {
    if (input.texts.length === 0) return [];

    const vectors: number[][] = [];

    // Sequential rather than concurrent: the free tier's ceiling is requests
    // per minute, so firing batches in parallel buys nothing and reaches the
    // limit sooner. Order is preserved by construction.
    for (const batch of batchesOf(input.texts, EMBEDDING_BATCH_SIZE)) {
      vectors.push(...(await embedOneBatch(input, batch)));
    }

    return vectors;
  };
}
