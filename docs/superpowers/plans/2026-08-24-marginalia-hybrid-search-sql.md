# Marginalia Hybrid Search SQL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

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

- [x] **Step 1: Write the function** with both arms as CTEs and RRF over their ranks.
- [x] **Step 2: Apply it and confirm it is SECURITY INVOKER with an empty search_path.**
- [x] **Step 3: Commit the migration.**

---

### Task 2: Prove it against real data

**Files:**
- Create: `supabase/tests/search_chunks.sql`

- [x] **Step 1: Seed two owners** with chunks carrying real Gemini embeddings, including one pair of identical boilerplate under different headings.
- [x] **Step 2: Prove ranking** — the semantically right chunk wins for a paraphrased question.
- [x] **Step 3: Prove the arms differ** — a chunk found only by exact lexical match still appears, which is why full text is there at all.
- [x] **Step 4: Prove isolation inside the function** — searching as one owner never returns another's chunks, even though the function reads every row it can see.
- [x] **Step 5: Confirm latency** inside the statement timeout.
- [x] **Step 6: Clean up and commit.**

---

## Completion record — 2026-08-24

Both tasks complete. `rag.search_chunks` applied and verified:
`SECURITY INVOKER`, `search_path=""`, `anon` cannot execute.

### Two bugs that only execution could find

1. **`search_path = ''` excludes pgvector's operators.** A bare `<#>` does not
   resolve inside the function. The tempting fix — set `search_path` to
   `extensions` — trades away the hardening that stops a caller shadowing an
   unqualified name. `OPERATOR(extensions.<#>)` keeps both.
2. **An untyped `1.0` is `numeric`.** The fusion arithmetic did not match the
   declared `double precision` column, and plpgsql only checks that when the
   query runs, so `CREATE FUNCTION` succeeded and the first call failed.

Both were invisible on review. Applying a migration is not evidence it works.

### The result

    chunk                                          section                 score    dense  text
    Air filtration must maintain PM2.5 below the   Schedule 3 - Services   0.03227    3     1
    The tenant shall obtain prior written consen   Section 11 - Subletting 0.01639    1     -
    No animals may be kept on the premises.        Section 8 - Pets        0.01613    2     -

The winner was dense retrieval's *worst* result, promoted to first by the
lexical arm. That is the argument for two arms, demonstrated rather than
asserted.

Bob's chunk — same vector as Alice's top dense hit — never appears for her,
and searching as Bob confirms it genuinely ranks first for that query. Without
that counterfactual the isolation result would be empty: a chunk that never
appears might simply be a bad match.

### Not measured

Latency. Four rows prove only that nothing pathological happens. A p95 worth
quoting needs a realistic corpus, and belongs with the eval harness.
