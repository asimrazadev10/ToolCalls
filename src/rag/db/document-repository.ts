/**
 * Reading and writing a user's documents.
 *
 * Both operations go through database functions rather than table access:
 * writing because `authenticated` deliberately holds no insert grant on
 * chunks, and searching because both retrieval arms and their fusion belong in
 * one statement.
 *
 * The client is described structurally, by the one method used, so this module
 * neither depends on supabase-js typings nor needs a real connection to test.
 */

import { assertEmbeddingShape, toHalfvecLiteral } from '../embed/vector-encoding';

/** The narrow slice of a Supabase client this module needs. */
export interface RpcCapableClient {
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export interface ChunkToStore {
  ordinal: number;
  content: string;
  tokenCount: number;
  headingPath: string[];
  pageFrom?: number | null;
  pageTo?: number | null;
  embedding: number[];
}

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  content: string;
  headingPath: string[];
  pageFrom: number | null;
  pageTo: number | null;
  fusionScore: number;
  denseRank: number | null;
  textRank: number | null;
}

export interface SearchRequest {
  queryEmbedding: number[];
  queryText: string;
  limit?: number;
}

interface SearchRow {
  chunk_id: string;
  document_id: string;
  document_title: string;
  content: string;
  heading_path: string[] | null;
  page_from: number | null;
  page_to: number | null;
  fusion_score: number;
  dense_rank: number | null;
  text_rank: number | null;
}

async function callFunction(
  client: RpcCapableClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(functionName, parameters);

  if (error) {
    // The database's own wording distinguishes an ownership refusal from a
    // timeout from a malformed argument. Replacing it loses that.
    throw new Error(`${functionName} failed: ${error.message}`);
  }

  return data;
}

export async function storeDocumentChunks(
  client: RpcCapableClient,
  documentId: string,
  chunks: ChunkToStore[],
): Promise<number> {
  if (chunks.length === 0) return 0;

  // Checked before the call, not after. The column accepts a right-length
  // vector of noise without complaint, and the mistake would then surface only
  // as poor retrieval, long after the document was ingested.
  for (const chunk of chunks) assertEmbeddingShape(chunk.embedding);

  const stored = await callFunction(client, 'store_document_chunks', {
    target_document_id: documentId,
    chunks: chunks.map((chunk) => ({
      ordinal: chunk.ordinal,
      content: chunk.content,
      token_count: chunk.tokenCount,
      heading_path: chunk.headingPath,
      page_from: chunk.pageFrom ?? null,
      page_to: chunk.pageTo ?? null,
      embedding: toHalfvecLiteral(chunk.embedding),
    })),
  });

  return typeof stored === 'number' ? stored : 0;
}

export async function searchDocuments(
  client: RpcCapableClient,
  request: SearchRequest,
): Promise<RetrievedChunk[]> {
  assertEmbeddingShape(request.queryEmbedding);

  const rows = await callFunction(client, 'search_chunks', {
    query_embedding: toHalfvecLiteral(request.queryEmbedding),
    query_text: request.queryText,
    match_limit: request.limit ?? 20,
  });

  // Empty rather than null. A caller forced to distinguish "no matches" from
  // "no result set" will eventually forget, and the two mean the same thing.
  if (!Array.isArray(rows)) return [];

  return (rows as SearchRow[]).map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    documentTitle: row.document_title,
    content: row.content,
    headingPath: row.heading_path ?? [],
    pageFrom: row.page_from,
    pageTo: row.page_to,
    fusionScore: row.fusion_score,
    denseRank: row.dense_rank,
    textRank: row.text_rank,
  }));
}
