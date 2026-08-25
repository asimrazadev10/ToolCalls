import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../config';
import { EMBEDDING_BATCH_SIZE, createGeminiEmbedder } from './gemini-embedder';

const vectorFilledWith = (fill: number) =>
  Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);

/** Stands in for the API, returning one vector per requested text. */
const stubTransport = (options: { vectorFor?: (index: number) => number[] } = {}) => {
  const calls: { body: Record<string, unknown>; signal?: AbortSignal | null }[] = [];

  const fetchImplementation = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { requests: unknown[] };
    calls.push({ body: body as Record<string, unknown>, signal: init?.signal });

    const embeddings = body.requests.map((_request, index) => ({
      values: options.vectorFor?.(index) ?? vectorFilledWith(0.01),
    }));

    return new Response(JSON.stringify({ embeddings }), { status: 200 });
  });

  return { fetchImplementation: fetchImplementation as unknown as typeof fetch, calls };
};

const textsNumbering = (count: number) =>
  Array.from({ length: count }, (_, index) => `chunk ${index}`);

describe('batching', () => {
  it('sends a single request when everything fits in one batch', async () => {
    const { fetchImplementation, calls } = stubTransport();
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await embed({ texts: textsNumbering(3), taskType: 'RETRIEVAL_DOCUMENT' });

    expect(calls).toHaveLength(1);
  });

  it('splits work across requests once past the batch size', async () => {
    const { fetchImplementation, calls } = stubTransport();
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await embed({
      texts: textsNumbering(EMBEDDING_BATCH_SIZE + 1),
      taskType: 'RETRIEVAL_DOCUMENT',
    });

    expect(calls).toHaveLength(2);
  });

  it('returns vectors in the order the texts were given, across batch boundaries', async () => {
    // Each stub vector encodes its position within its batch. If batches were
    // merged out of order, a chunk would be stored against another's vector —
    // silently, and undetectably from the database.
    const { fetchImplementation } = stubTransport({
      vectorFor: (index) => vectorFilledWith(index / 1000),
    });
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    const vectors = await embed({
      texts: textsNumbering(EMBEDDING_BATCH_SIZE + 3),
      taskType: 'RETRIEVAL_DOCUMENT',
    });

    expect(vectors).toHaveLength(EMBEDDING_BATCH_SIZE + 3);
    expect(vectors[0][0]).toBeCloseTo(0, 10);
    expect(vectors[EMBEDDING_BATCH_SIZE][0]).toBeCloseTo(0, 10);
    expect(vectors[EMBEDDING_BATCH_SIZE + 1][0]).toBeCloseTo(0.001, 10);
  });

  it('makes no request at all for no texts', async () => {
    const { fetchImplementation, calls } = stubTransport();
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    const vectors = await embed({ texts: [], taskType: 'RETRIEVAL_DOCUMENT' });

    expect(vectors).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('the request', () => {
  it('carries the requested task type, which changes the vector the model returns', async () => {
    const { fetchImplementation, calls } = stubTransport();
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await embed({ texts: ['a question'], taskType: 'RETRIEVAL_QUERY' });

    const requests = calls[0].body.requests as { taskType: string }[];
    expect(requests[0].taskType).toBe('RETRIEVAL_QUERY');
  });

  it('passes an abort signal through to the transport', async () => {
    const { fetchImplementation, calls } = stubTransport();
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });
    const controller = new AbortController();

    await embed({ texts: ['a'], taskType: 'RETRIEVAL_DOCUMENT', signal: controller.signal });

    expect(calls[0].signal).toBe(controller.signal);
  });
});

describe('responses that must not reach the database', () => {
  it('rejects a vector of the wrong dimension instead of storing it', async () => {
    const { fetchImplementation } = stubTransport({ vectorFor: () => [0.1, 0.2, 0.3] });
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await expect(embed({ texts: ['a'], taskType: 'RETRIEVAL_DOCUMENT' })).rejects.toThrow(
      /dimensions/i,
    );
  });

  it('rejects when the provider returns fewer vectors than texts', async () => {
    const fetchImplementation = (async () =>
      new Response(JSON.stringify({ embeddings: [] }), { status: 200 })) as unknown as typeof fetch;
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await expect(
      embed({ texts: ['a', 'b'], taskType: 'RETRIEVAL_DOCUMENT' }),
    ).rejects.toThrow(/expected 2/i);
  });

  it("surfaces the provider's own message on failure, so a quota error says so", async () => {
    const fetchImplementation = (async () =>
      new Response(
        JSON.stringify({ error: { message: 'You exceeded your current quota' } }),
        { status: 429 },
      )) as unknown as typeof fetch;
    const embed = createGeminiEmbedder({ apiKey: 'test-key', fetchImplementation });

    await expect(embed({ texts: ['a'], taskType: 'RETRIEVAL_DOCUMENT' })).rejects.toThrow(
      /exceeded your current quota/,
    );
  });
});
