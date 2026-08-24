import { describe, expect, it } from 'vitest';
import {
  CHUNK_OVERLAP_RATIO,
  DENSE_CANDIDATE_COUNT,
  EMBEDDING_DIMENSIONS,
  FULL_TEXT_CANDIDATE_COUNT,
  FUSED_RESULT_COUNT,
  HNSW_MAX_DIMENSIONS_FOR_HALFVEC,
  HNSW_MAX_DIMENSIONS_FOR_VECTOR,
} from './config';

/**
 * These are not tautologies. Each one encodes a decision that is expensive to
 * rediscover: change the embedding model without reading the spec and the
 * suite fails here rather than in production, where the symptom would be a
 * vector index that silently does not exist.
 */
describe('embedding storage type', () => {
  it('exceeds what pgvector can HNSW-index as `vector`, which is why halfvec is used', () => {
    expect(EMBEDDING_DIMENSIONS).toBeGreaterThan(HNSW_MAX_DIMENSIONS_FOR_VECTOR);
  });

  it('fits what pgvector can HNSW-index as `halfvec`', () => {
    expect(EMBEDDING_DIMENSIONS).toBeLessThanOrEqual(HNSW_MAX_DIMENSIONS_FOR_HALFVEC);
  });
});

describe('retrieval sizing', () => {
  it('fuses no more results than either candidate arm can supply', () => {
    expect(FUSED_RESULT_COUNT).toBeLessThanOrEqual(DENSE_CANDIDATE_COUNT);
    expect(FUSED_RESULT_COUNT).toBeLessThanOrEqual(FULL_TEXT_CANDIDATE_COUNT);
  });
});

describe('chunk overlap', () => {
  it('overlaps enough to carry context across a boundary, not so much that chunks duplicate', () => {
    expect(CHUNK_OVERLAP_RATIO).toBeGreaterThan(0);
    expect(CHUNK_OVERLAP_RATIO).toBeLessThan(0.5);
  });
});
