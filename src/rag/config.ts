/**
 * Marginalia configuration.
 *
 * These values are load-bearing for correctness rather than taste, and the
 * relationships between them are asserted in `config.test.ts`. Changing one in
 * isolation fails the suite instead of silently degrading retrieval.
 */

/** Gemini's embedding model. Returns 3072 dimensions unless truncated. */
export const EMBEDDING_MODEL_ID = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * pgvector's HNSW dimension ceilings, by column type.
 *
 * `vector` stops at 2000, which a 3072-dimension embedding exceeds — storing
 * one as `vector` yields no index at all and a sequential scan over every row,
 * with no error to announce it. `halfvec` reaches 4096 at two bytes per
 * dimension instead of four, so it holds the whole embedding, indexes, and
 * costs exactly what truncating to `vector(1536)` would have cost.
 *
 * That makes the real choice fp16 across 3072 dimensions versus fp32 across
 * 1536. Quantization error sits far below the gap between a right and a wrong
 * chunk, so dimensions win.
 */
export const HNSW_MAX_DIMENSIONS_FOR_VECTOR = 2000;
export const HNSW_MAX_DIMENSIONS_FOR_HALFVEC = 4096;

/**
 * Chunking bounds. Document structure picks the boundaries; these only cap the
 * result, so a short section stays a short chunk rather than being padded.
 */
export const CHUNK_TARGET_TOKENS = 600;
export const CHUNK_OVERLAP_RATIO = 0.12;

/**
 * Reciprocal Rank Fusion constant. Fusion reads ranks and never scores,
 * because cosine similarity and ts_rank_cd occupy incomparable scales and any
 * normalization tuned on one corpus misbehaves on the next. 60 comes from the
 * original RRF paper and needs no per-corpus tuning.
 */
export const RECIPROCAL_RANK_FUSION_K = 60;

/** Candidates drawn from each retrieval arm before fusion narrows them. */
export const DENSE_CANDIDATE_COUNT = 50;
export const FULL_TEXT_CANDIDATE_COUNT = 50;
export const FUSED_RESULT_COUNT = 20;

/** Upload ceilings. Enforced server-side; any client-side bound is a courtesy. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_PAGE_COUNT = 500;
