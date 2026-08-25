import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING_DIMENSIONS } from '../config';
import {
  type RpcCapableClient,
  searchDocuments,
  storeDocumentChunks,
} from './document-repository';

const embedding = (fill: number) => Array.from({ length: EMBEDDING_DIMENSIONS }, () => fill);

const stubClient = (response: { data?: unknown; error?: { message: string } | null }) => {
  // Parameters are declared even though unused: without them `mock.calls[0]`
  // is an empty tuple and the assertions below cannot reach the arguments.
  const rpc = vi.fn(async (_functionName: string, _parameters: Record<string, unknown>) => ({
    data: response.data ?? null,
    error: response.error ?? null,
  }));
  return { client: { rpc } as unknown as RpcCapableClient, rpc };
};

const aChunk = () => ({
  ordinal: 0,
  content: 'No animals may be kept on the premises.',
  tokenCount: 9,
  headingPath: ['Lease', 'Section 8 - Pets'],
  pageFrom: 1,
  pageTo: 1,
  embedding: embedding(0.01),
});

describe('storing chunks', () => {
  it('sends the embedding as a halfvec literal, not a raw array', async () => {
    const { client, rpc } = stubClient({ data: 1 });

    await storeDocumentChunks(client, 'doc-1', [aChunk()]);

    const params = rpc.mock.calls[0][1] as unknown as { chunks: { embedding: string }[] };
    expect(typeof params.chunks[0].embedding).toBe('string');
    expect(params.chunks[0].embedding.startsWith('[')).toBe(true);
  });

  it('names the fields the database function expects', async () => {
    const { client, rpc } = stubClient({ data: 1 });

    await storeDocumentChunks(client, 'doc-1', [aChunk()]);

    const params = rpc.mock.calls[0][1] as unknown as {
      target_document_id: string;
      chunks: Record<string, unknown>[];
    };
    expect(params.target_document_id).toBe('doc-1');
    expect(params.chunks[0]).toMatchObject({
      ordinal: 0,
      token_count: 9,
      heading_path: ['Lease', 'Section 8 - Pets'],
      page_from: 1,
      page_to: 1,
    });
  });

  it('rejects a malformed embedding before it reaches the database', async () => {
    // The column would take a right-length vector of noise without complaint,
    // and the mistake would surface only as poor retrieval weeks later.
    const { client, rpc } = stubClient({ data: 1 });
    const broken = { ...aChunk(), embedding: [0.1, 0.2, 0.3] };

    await expect(storeDocumentChunks(client, 'doc-1', [broken])).rejects.toThrow(/dimensions/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns how many chunks were stored', async () => {
    const { client } = stubClient({ data: 7 });

    expect(await storeDocumentChunks(client, 'doc-1', [aChunk()])).toBe(7);
  });

  it("surfaces the database's own message, so an ownership refusal says so", async () => {
    const { client } = stubClient({
      error: { message: 'document d0c belongs to another owner' },
    });

    await expect(storeDocumentChunks(client, 'doc-1', [aChunk()])).rejects.toThrow(
      /belongs to another owner/,
    );
  });

  it('makes no call for an empty chunk list', async () => {
    const { client, rpc } = stubClient({ data: 0 });

    expect(await storeDocumentChunks(client, 'doc-1', [])).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('searching', () => {
  const aRow = () => ({
    chunk_id: 'chunk-1',
    document_id: 'doc-1',
    document_title: 'Alice lease',
    content: 'No animals may be kept.',
    heading_path: ['Lease', 'Section 8 - Pets'],
    page_from: 1,
    page_to: 1,
    fusion_score: 0.0325,
    dense_rank: 2,
    text_rank: 1,
  });

  it('sends the query embedding as a literal and the text alongside it', async () => {
    const { client, rpc } = stubClient({ data: [] });

    await searchDocuments(client, {
      queryEmbedding: embedding(0.02),
      queryText: 'pets policy',
      limit: 5,
    });

    const params = rpc.mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(typeof params.query_embedding).toBe('string');
    expect(params.query_text).toBe('pets policy');
    expect(params.match_limit).toBe(5);
  });

  it('reads the rows into the shape the rest of the system uses', async () => {
    const { client } = stubClient({ data: [aRow()] });

    const [result] = await searchDocuments(client, {
      queryEmbedding: embedding(0.02),
      queryText: 'pets',
    });

    expect(result).toEqual({
      chunkId: 'chunk-1',
      documentId: 'doc-1',
      documentTitle: 'Alice lease',
      content: 'No animals may be kept.',
      headingPath: ['Lease', 'Section 8 - Pets'],
      pageFrom: 1,
      pageTo: 1,
      fusionScore: 0.0325,
      denseRank: 2,
      textRank: 1,
    });
  });

  it('returns an empty array when nothing matched, never null', async () => {
    // A caller that has to distinguish null from empty will eventually forget.
    const { client } = stubClient({ data: null });

    expect(await searchDocuments(client, { queryEmbedding: embedding(0.02), queryText: 'x' })).toEqual(
      [],
    );
  });

  it('surfaces a database error rather than reporting no results', async () => {
    // Silently returning nothing would read as "your documents do not cover
    // this", which is a different and much worse answer than "search failed".
    const { client } = stubClient({ error: { message: 'statement timeout' } });

    await expect(
      searchDocuments(client, { queryEmbedding: embedding(0.02), queryText: 'x' }),
    ).rejects.toThrow(/statement timeout/);
  });
});
