# Marginalia Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an enforced module boundary, a tested configuration module, and an isolated `rag` schema whose per-user isolation is proven by test rather than asserted.

**Architecture:** Marginalia lives in `src/rag/**` and may not import the weather agent in `src/lib/ai/**`; a lint rule enforces this so the separation cannot rot. Persistence is a dedicated `rag` Postgres schema in an existing Supabase project whose `public` schema belongs to an unrelated application and must never be touched. Isolation is Postgres RLS keyed on `auth.uid()`, verified by switching JWT claims inside a transaction and asserting one user cannot see another's rows.

**Tech Stack:** TypeScript 5, Next.js 15, Vitest 3, ESLint 9 (flat config) + typescript-eslint, Postgres 17.6, pgvector 0.8 (`halfvec` + HNSW), Supabase Auth.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## Global Constraints

- Marginalia code lives only in `src/rag/**`. It must not import from `src/lib/ai/**`.
- Migrations may reference only the `rag` schema, `auth`, and `storage`. Never `public` — it belongs to another live application (2189 products, 12 users, 100 sessions).
- Embeddings are `gemini-embedding-001` at 3072 dimensions, stored as `halfvec(3072)`, indexed with `halfvec_ip_ops`.
- Every `rag` table has `owner_id uuid not null` and RLS enabled.
- Every SQL function is `SECURITY INVOKER` with `set search_path = ''`.
- Identifiers say exactly what they do. No abbreviations where a word will do.

---

### Task 1: Configuration module with executable invariants

The dimension trap from the spec becomes a failing test rather than a comment: 3072 dimensions cannot be HNSW-indexed as `vector` (max 2000) but can as `halfvec` (max 4096). If someone later changes the model or dimension count, the test fails instead of the index silently vanishing.

**Files:**
- Create: `src/rag/config.ts`
- Create: `src/rag/config.test.ts`
- Create: `vitest.config.ts`
- Modify: `package.json` (add vitest, add `test` script)

**Interfaces:**
- Consumes: nothing.
- Produces: `EMBEDDING_MODEL_ID: string`, `EMBEDDING_DIMENSIONS: number`, `HNSW_MAX_DIMENSIONS_FOR_VECTOR: 2000`, `HNSW_MAX_DIMENSIONS_FOR_HALFVEC: 4096`, `CHUNK_TARGET_TOKENS`, `CHUNK_OVERLAP_RATIO`, `RECIPROCAL_RANK_FUSION_K`, `DENSE_CANDIDATE_COUNT`, `FULL_TEXT_CANDIDATE_COUNT`, `FUSED_RESULT_COUNT`, `MAX_UPLOAD_BYTES`, `MAX_PAGE_COUNT`.

- [ ] **Step 1: Install Vitest and add the test script**

```bash
npm install -D vitest@^3
npm pkg set scripts.test="vitest run" scripts.test:watch="vitest"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Write the failing test — `src/rag/config.test.ts`**

```ts
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

describe('embedding storage type', () => {
  it('exceeds what pgvector can HNSW-index as `vector`, which is why halfvec is used', () => {
    expect(EMBEDDING_DIMENSIONS).toBeGreaterThan(HNSW_MAX_DIMENSIONS_FOR_VECTOR);
  });

  it('fits what pgvector can HNSW-index as `halfvec`', () => {
    expect(EMBEDDING_DIMENSIONS).toBeLessThanOrEqual(HNSW_MAX_DIMENSIONS_FOR_HALFVEC);
  });
});

describe('retrieval sizing', () => {
  it('fuses no more results than either candidate list can supply', () => {
    expect(FUSED_RESULT_COUNT).toBeLessThanOrEqual(DENSE_CANDIDATE_COUNT);
    expect(FUSED_RESULT_COUNT).toBeLessThanOrEqual(FULL_TEXT_CANDIDATE_COUNT);
  });
});

describe('chunk overlap', () => {
  it('overlaps enough to preserve context without duplicating most of each chunk', () => {
    expect(CHUNK_OVERLAP_RATIO).toBeGreaterThan(0);
    expect(CHUNK_OVERLAP_RATIO).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./config`.

- [ ] **Step 5: Write `src/rag/config.ts`**

```ts
/**
 * Marginalia configuration. Values here are load-bearing for correctness, not
 * taste — `config.test.ts` asserts the relationships between them, so changing
 * one in isolation fails the suite rather than silently degrading retrieval.
 */

/** Gemini's embedding model. Returns 3072 dimensions unless truncated. */
export const EMBEDDING_MODEL_ID = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 3072;

/**
 * pgvector's HNSW index limits, by column type. `vector` stops at 2000, which
 * 3072-dimension embeddings exceed — storing them as `vector` yields no index
 * and a sequential scan. `halfvec` reaches 4096 at half the bytes per
 * dimension, so it holds the full embedding and still indexes.
 */
export const HNSW_MAX_DIMENSIONS_FOR_VECTOR = 2000;
export const HNSW_MAX_DIMENSIONS_FOR_HALFVEC = 4096;

/** Chunking. Structure decides boundaries first; these bound the result. */
export const CHUNK_TARGET_TOKENS = 600;
export const CHUNK_OVERLAP_RATIO = 0.12;

/**
 * Reciprocal Rank Fusion constant. Fusion reads ranks, never scores, because
 * cosine similarity and ts_rank_cd are on incomparable scales. 60 is the
 * value from the original RRF paper and needs no per-corpus tuning.
 */
export const RECIPROCAL_RANK_FUSION_K = 60;

/** Candidates drawn from each retrieval arm before fusion narrows them. */
export const DENSE_CANDIDATE_COUNT = 50;
export const FULL_TEXT_CANDIDATE_COUNT = 50;
export const FUSED_RESULT_COUNT = 20;

/** Upload limits. Enforced server-side; the client bound is a courtesy. */
export const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;
export const MAX_PAGE_COUNT = 500;
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/rag/config.ts src/rag/config.test.ts
git commit -m "Add Marginalia config with executable dimension invariants"
```

---

### Task 2: Enforce the module boundary in lint

"Separate system" is only true while nothing imports across the line. A rule makes it true; a convention makes it aspirational.

**Files:**
- Create: `eslint.config.mjs`
- Modify: `package.json` (add eslint deps, `lint` and `verify` scripts)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run lint`, `npm run verify` (typecheck + lint + test).

- [ ] **Step 1: Install ESLint and the TypeScript plugin**

```bash
npm install -D eslint@^9 typescript-eslint@^8 @eslint/js@^9
npm pkg set scripts.lint="eslint ." scripts.verify="npm run typecheck && npm run lint && npm test"
```

- [ ] **Step 2: Create `eslint.config.mjs`**

```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/rag/**/*.{ts,tsx}'],
    rules: {
      // Marginalia is a separate system. The weather agent binds tools to its
      // generation calls; Marginalia deliberately binds none, and that
      // guarantee only holds while the two stay unaware of each other.
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/lib/ai/*', '@/lib/ai', '../lib/ai/*', '../../lib/ai/*'],
            message: 'Marginalia must not import the weather agent. See docs/superpowers/specs/2026-08-24-marginalia-rag-design.md.' },
        ],
      }],
    },
  },
);
```

- [ ] **Step 3: Prove the rule fires — create a deliberate violation**

```bash
printf "import { tools } from '@/lib/ai/agent';\nexport const broken = tools;\n" > src/rag/boundary-probe.ts
npx eslint src/rag/boundary-probe.ts
```

Expected: FAIL with the "must not import the weather agent" message.

- [ ] **Step 4: Delete the probe and confirm a clean run**

```bash
rm src/rag/boundary-probe.ts
npm run verify
```

Expected: typecheck, lint and tests all pass.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs package.json package-lock.json
git commit -m "Enforce Marginalia module boundary with lint"
```

---

### Task 3: The `rag` schema

**Files:**
- Create: `supabase/migrations/20260824090000_rag_schema.sql`

**Interfaces:**
- Produces: `rag.documents`, `rag.chunks`, `rag.embeddings`, `rag.query_log`, and the enum `rag.document_status`.

- [ ] **Step 1: Confirm the schema does not already exist**

```sql
select count(*) from information_schema.schemata where schema_name = 'rag';
```

Expected: 0.

- [ ] **Step 2: Write and apply the migration**

Table definitions are in the spec's data-model section; apply verbatim with
`owner_id uuid not null` on all four tables, `unique (owner_id, content_sha256)`
on documents, `content_tsv` generated stored on chunks, and
`embedding halfvec(3072)` on embeddings.

- [ ] **Step 3: Verify tables, index types and dimensions**

```sql
select tablename, indexname, indexdef from pg_indexes where schemaname = 'rag';
```

Expected: one `hnsw` index using `halfvec_ip_ops`, one `gin` index on `content_tsv`.

- [ ] **Step 4: Commit the migration file**

---

### Task 4: RLS policies and a cross-tenant isolation proof

The exit criterion for this phase. Not "policies exist" — "user A provably cannot see user B's rows".

**Files:**
- Create: `supabase/migrations/20260824091000_rag_rls.sql`
- Create: `supabase/tests/rls_isolation.sql`

- [ ] **Step 1: Enable RLS and add owner policies on all four tables**

- [ ] **Step 2: Write the isolation proof**

Insert one document for each of two users, then within a transaction set
`role authenticated` and `request.jwt.claims` to user A's id and assert exactly
one visible row; repeat for B; assert neither sees the other.

- [ ] **Step 3: Run it and require the asserted counts**

Expected: A sees 1, B sees 1, cross-visibility 0.

- [ ] **Step 4: Run the Supabase security advisor**

Expected: no findings against the `rag` schema.

- [ ] **Step 5: Commit**

---

### Task 5: Private storage bucket scoped by user id

**Files:**
- Create: `supabase/migrations/20260824092000_rag_storage.sql`

- [ ] **Step 1: Create a private bucket `rag-documents`**
- [ ] **Step 2: Add policies requiring the object path's first segment to equal `auth.uid()`**
- [ ] **Step 3: Verify the bucket is private and four policies exist**
- [ ] **Step 4: Commit**
