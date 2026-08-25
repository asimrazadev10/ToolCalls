# Marginalia Embedding and Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn chunks into stored vectors, and turn two ranked candidate lists into one — everything phases 03 and 04 need that does not require the database.

**Architecture:** Four modules, three of them pure. The embedding client takes its transport as a parameter so batching, dimension checking and error handling are testable without spending quota. Fusion reads ranks only, never scores, so it needs no calibration and no network at all.

**Tech Stack:** TypeScript 5, Vitest 3, Gemini `gemini-embedding-001`.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## Verified against the live API before designing

| Assumption | Result |
| --- | --- |
| Returns 3072 dimensions | confirmed |
| Vectors arrive normalized | confirmed, magnitude 1.0 — which is what justifies `halfvec_ip_ops` over cosine |
| `taskType` changes the vector | confirmed — identical text embeds differently as DOCUMENT vs QUERY |
| `batchEmbedContents` works | confirmed, 3 vectors of 3072 in one call |

## Global Constraints

- Lives in `src/rag/**`; may not import `src/lib/ai/**`.
- Chunks embed as `RETRIEVAL_DOCUMENT`, questions as `RETRIEVAL_QUERY`. Using one type for both discards a measurable asymmetry the model provides for free.
- No module here reads `process.env`. Credentials arrive as parameters.

---

### Task 1: Composing what actually gets embedded

A chunk's own text is not the best representation of it. "§8 does not apply to
assistance dogs" embeds poorly against "can I keep a guide dog?" until it
carries the breadcrumb that says it sits under "Pets".

**Files:**
- Create: `src/rag/embed/embedding-input.ts`
- Create: `src/rag/embed/embedding-input.test.ts`

**Interfaces:**
- Produces: `composeEmbeddingInput(chunk: { headingPath: string[]; content: string; contextBlurb?: string | null }): string`

- [x] **Step 1: Write failing tests** — the heading path is prepended as a breadcrumb; an empty path yields the content alone; a context blurb is included when present and omitted when null; the content itself is never altered or truncated; the result is deterministic for the same input.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 2: Vector serialization for storage

**Files:**
- Create: `src/rag/embed/vector-encoding.ts`
- Create: `src/rag/embed/vector-encoding.test.ts`

**Interfaces:**
- Produces: `toHalfvecLiteral(values: number[]): string`, `vectorMagnitude(values: number[]): number`, `assertEmbeddingShape(values: number[]): void`

- [x] **Step 1: Write failing tests** — a literal renders as `[a,b,c]` with no spaces; a wrong dimension count is rejected rather than stored, because the column would accept a plausible-looking wrong vector; a non-finite value is rejected; magnitude of a unit vector is 1; the literal round-trips the values it was given.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 3: Reciprocal Rank Fusion

The join between the dense and full-text arms. Reads ranks and never scores,
because cosine similarity and `ts_rank_cd` occupy incomparable scales and any
normalization tuned on one corpus misbehaves on the next.

**Files:**
- Create: `src/rag/retrieve/reciprocal-rank-fusion.ts`
- Create: `src/rag/retrieve/reciprocal-rank-fusion.test.ts`

**Interfaces:**
- Produces: `fuseByReciprocalRank(rankings: string[][], options?: { k?: number; limit?: number }): FusedResult[]` where `FusedResult = { id: string; score: number; ranks: (number | null)[] }`

- [x] **Step 1: Write failing tests** — an id ranked highly in both arms outranks one ranked first in a single arm; an id found by only one arm still appears, because the arms find different things; the score is the sum of `1/(k + rank)`; ranks are one-based; results come back in descending score; ties break deterministically by id so the same query gives the same answer twice; the limit caps output; empty input yields nothing; and the property that matters most — fusion depends only on order, so rescaling one arm's scores changes nothing.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 4: The Gemini embedding client

**Files:**
- Create: `src/rag/embed/gemini-embedder.ts`
- Create: `src/rag/embed/gemini-embedder.test.ts`

**Interfaces:**
- Produces: `createGeminiEmbedder(options: { apiKey: string; fetchImplementation?: typeof fetch }): GeminiEmbedder` where `GeminiEmbedder = (input: { texts: string[]; taskType: EmbeddingTaskType; signal?: AbortSignal }) => Promise<number[][]>`

- [x] **Step 1: Write failing tests** using a stub transport — texts beyond one batch are split across calls; every returned vector keeps the order of its input; the requested `taskType` reaches the request body; a response with the wrong dimension count is rejected rather than returned; an HTTP failure surfaces the provider's message; an abort signal is honoured; an empty input makes no call at all.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Smoke-test once against the live API** to confirm the stub matches reality.
- [x] **Step 6: Commit**

---

## Completion record — 2026-08-24

All four tasks complete. `npm run verify` green: 133 tests passing.

| Module | Tests |
| --- | --- |
| `embed/embedding-input.ts` | 7 |
| `embed/vector-encoding.ts` | 9 |
| `embed/gemini-embedder.ts` | 9 |
| `retrieve/reciprocal-rank-fusion.ts` | 11 |

### The finding: I measured the wrong thing first

The heading breadcrumb is standard practice, and the smoke test appeared to
refute it — similarity to the question *fell* in all three cases tried,
by 0.0011 to 0.0580.

The metric was wrong. Retrieval reads ranking, never absolute score, so a
uniform drop across every chunk costs exactly nothing. The question worth
asking is whether the breadcrumb helps the right chunk beat the wrong ones.

Re-measured that way, with three chunks of identical boilerplate sitting under
Pets, Subletting and Alterations, asked "do I need permission to sublet?":

    without breadcrumb   0.7095 / 0.7095 / 0.7095 — identical, winner arbitrary
    with breadcrumb      Subletting 0.6800, Alterations 0.6054, Pets 0.5943

Zero discrimination becomes decisive discrimination. Without it the system
cites the wrong section two times in three on any repeated clause — and
repeated boilerplate under different headings is ordinary in contracts,
policies and manuals.

The lesson generalizes past this decision: when a change looks like it hurt,
check that the metric measures the thing the system actually uses. This is
also the argument for phase 06 arriving before the quality levers of phase 07,
since every one of those levers will present the same trap.

### Still open

Persistence. Everything here produces values the database has nowhere to go
yet, because PostgREST does not expose the `rag` schema.
