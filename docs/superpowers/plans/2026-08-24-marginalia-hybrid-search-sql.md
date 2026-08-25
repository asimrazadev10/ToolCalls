# Marginalia Hybrid Search SQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One database function that runs both retrieval arms, fuses them by rank, and returns citable rows — enforcing per-user isolation while doing it.

**Architecture:** Dense (HNSW over `halfvec`, inner product) and full text (GIN over `tsvector`, `ts_rank_cd`) run as two CTEs in a single statement, fused by Reciprocal Rank Fusion. `SECURITY INVOKER` so row-level security applies to the caller, and iterative index scans so filtering does not silently shorten the result set.

**Tech Stack:** Postgres 17.6, pgvector 0.8.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## Note on the access path

This work does not depend on PostgREST exposing `rag`. That setting governs
whether supabase-js can reach the schema; the function itself can be created
and exercised now, and it is needed by either access path — PostgREST RPC or a
direct Postgres connection.

## Global Constraints

- `SECURITY INVOKER` and `set search_path = ''` on every function. A
  `SECURITY DEFINER` search function bypasses RLS and returns other tenants'
  chunks — the classic RAG data leak.
- Fusion reads ranks only, mirroring `fuseByReciprocalRank` with the same
  constant, so the SQL and TypeScript agree on what a fused ranking means.
- Must complete inside `authenticator`'s 8 second `statement_timeout`.

---

### Task 1: The search function

**Files:**
- Create: `supabase/migrations/20260824093000_rag_search.sql`

**Interfaces:**
- Produces: `rag.search_chunks(query_embedding extensions.halfvec, query_text text, match_limit int)` returning chunk id, document id and title, content, heading path, page range, fusion score, and the rank held in each arm.

- [ ] **Step 1: Write the function** with both arms as CTEs and RRF over their ranks.
- [ ] **Step 2: Apply it and confirm it is SECURITY INVOKER with an empty search_path.**
- [ ] **Step 3: Commit the migration.**

---

### Task 2: Prove it against real data

**Files:**
- Create: `supabase/tests/search_chunks.sql`

- [ ] **Step 1: Seed two owners** with chunks carrying real Gemini embeddings, including one pair of identical boilerplate under different headings.
- [ ] **Step 2: Prove ranking** — the semantically right chunk wins for a paraphrased question.
- [ ] **Step 3: Prove the arms differ** — a chunk found only by exact lexical match still appears, which is why full text is there at all.
- [ ] **Step 4: Prove isolation inside the function** — searching as one owner never returns another's chunks, even though the function reads every row it can see.
- [ ] **Step 5: Confirm latency** inside the statement timeout.
- [ ] **Step 6: Clean up and commit.**
