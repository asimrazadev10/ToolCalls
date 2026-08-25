# Marginalia Persistence and Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the seam between the TypeScript pipeline and the database — store a parsed document's chunks and vectors, and search them back.

**Architecture:** Writing chunks needs privilege, because `authenticated` deliberately holds no insert grant on `rag.chunks`. Rather than introduce a service-role key into the application, a single narrow `SECURITY DEFINER` function performs the write after verifying the caller owns the target document. That way no credential exists in the app that could expose another tenant if it leaked.

**Tech Stack:** TypeScript 5, Vitest 3, `@supabase/supabase-js` 2, Postgres 17.6.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## The one place SECURITY DEFINER is correct

The spec warns that a definer-rights *search* function is the classic RAG data
leak: it runs as its owner, bypasses row-level security, and returns every
tenant's chunks. That warning stands and `rag.search_chunks` remains
`SECURITY INVOKER`.

A definer-rights *write* function is a different shape. It grants exactly one
capability — "insert chunks for a document" — and it re-establishes the check
RLS would have made, explicitly, in its first statement: the target document
must belong to `auth.uid()`. The alternative is a service-role key living in
the application, which grants *every* capability against *every* tenant and is
one misplaced environment variable away from a total compromise.

Narrow and audited beats broad and ambient. The check is the whole function's
justification, so it is the first thing it does and the first thing tested.

## Global Constraints

- `rag.search_chunks` stays `SECURITY INVOKER`. Only the write path is definer.
- Every function sets `search_path = ''`, and qualifies operators accordingly.
- Storing a document twice must not duplicate its chunks.

---

### Task 1: The privileged write path

**Files:**
- Create: `supabase/migrations/20260825090000_rag_store_chunks.sql`
- Create: `supabase/tests/store_chunks.sql`

**Interfaces:**
- Produces: `rag.store_document_chunks(target_document_id uuid, chunks jsonb) returns integer`

- [ ] **Step 1: Write the function**, ownership check first, then a replace-in-place insert and a status transition to `ready`.
- [ ] **Step 2: Prove the ownership check** — a caller storing chunks against another owner's document is refused, and no row is written.
- [ ] **Step 3: Prove idempotence** — storing the same document twice leaves one set of chunks, not two.
- [ ] **Step 4: Prove the happy path** — chunks and embeddings land, and the document reaches `ready`.
- [ ] **Step 5: Commit.**

---

### Task 2: The repository

**Files:**
- Create: `src/rag/db/document-repository.ts`
- Create: `src/rag/db/document-repository.test.ts`

**Interfaces:**
- Produces: `storeDocumentChunks(client, documentId, chunks): Promise<number>` and
  `searchDocuments(client, { queryEmbedding, queryText, limit }): Promise<RetrievedChunk[]>`

- [ ] **Step 1: Write failing tests** against a stubbed client — chunk rows carry the halfvec literal rather than a raw array; a shape-invalid embedding is rejected before it reaches the database; a database error surfaces its message rather than a silent empty result; search passes the literal and text through; an empty search result is an empty array rather than null.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

---

### Task 3: End to end against the live database

- [ ] **Step 1:** Sign in a real test user.
- [ ] **Step 2:** Run a real PDF through parse, chunk and embed, then store it.
- [ ] **Step 3:** Ask a question, embed it, search, and confirm the returned chunk answers it.
- [ ] **Step 4:** Confirm a second user sees nothing of it.
- [ ] **Step 5:** Clean up and record the result.
