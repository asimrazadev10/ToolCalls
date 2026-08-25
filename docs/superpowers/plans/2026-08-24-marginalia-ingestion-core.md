# Marginalia Ingestion Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn raw extracted page text into clean, structure-aware chunks ready for embedding — the half of ingestion that is pure computation.

**Architecture:** Four pure modules composed as a pipeline: normalize raw text, decide whether deterministic extraction actually worked, estimate token cost, then split on document structure rather than on character count. No database, no network, no model quota, so every behaviour is testable in-process and deterministic.

**Tech Stack:** TypeScript 5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## Global Constraints

- Lives in `src/rag/ingest/**`; may not import `src/lib/ai/**`.
- Every exported function is pure: same input, same output, no I/O.
- Sizing constants come from `src/rag/config.ts`, never inlined.
- Identifiers say exactly what they do. `estimateTokenCount`, not `countTokens` — it approximates, and the name must not claim otherwise.

## Pipeline

    raw page text
      → normalizeExtractedText     strip what no reader needs
      → assessPageExtraction       usable, or send the page to vision
      → chunkMarkdownDocument      split on structure
      → DocumentChunk[]            ready to embed

---

### Task 1: Text normalization

Removes characters that serve no reader but do carry risk: zero-width
characters are a documented way to hide instructions inside an otherwise
innocent-looking PDF, and control characters corrupt tokenization.

**Files:**
- Create: `src/rag/ingest/text-normalization.ts`
- Create: `src/rag/ingest/text-normalization.test.ts`

**Interfaces:**
- Produces: `normalizeExtractedText(rawText: string): string`

- [x] **Step 1: Write failing tests** covering: zero-width characters removed; control characters removed but newline and tab kept; non-breaking space becomes an ordinary space; runs of blank lines collapse to one; trailing whitespace per line trimmed; Unicode normalized to NFC; already-clean text unchanged.
- [x] **Step 2: Run — expect FAIL** (module missing)
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 2: Page extraction assessment

Decides per page whether deterministic extraction produced usable text or the
page must be re-read by vision. Getting this wrong in the lenient direction is
the expensive error: a scanned page that scores "usable" yields an empty chunk
that silently never answers anything.

**Files:**
- Create: `src/rag/ingest/page-extraction-assessment.ts`
- Create: `src/rag/ingest/page-extraction-assessment.test.ts`

**Interfaces:**
- Produces: `assessPageExtraction(input: { extractedText: string; pageWidthInPoints: number; pageHeightInPoints: number }): PageExtractionAssessment` where the result is `{ verdict: 'usable' | 'needs-vision'; reasons: string[]; charactersPerSquareInch: number; wordLikeRatio: number }`

- [x] **Step 1: Write failing tests** covering: empty text on a full page needs vision; ordinary prose is usable; a scattered handful of characters on a large page needs vision; text dominated by replacement characters needs vision; every needs-vision verdict carries at least one human-readable reason.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 3: Token estimation

**Files:**
- Create: `src/rag/ingest/token-estimation.ts`
- Create: `src/rag/ingest/token-estimation.test.ts`

**Interfaces:**
- Produces: `estimateTokenCount(text: string): number`

- [x] **Step 1: Write failing tests** covering: empty string is zero; monotonic in length; English prose lands near one token per 0.75 words; CJK counts roughly one token per character.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 4: Structure-aware chunker

The component that caps retrieval quality. Splits on document structure first
and length second, so a chunk is a semantic unit rather than an arbitrary
window.

**Files:**
- Create: `src/rag/ingest/chunker.ts`
- Create: `src/rag/ingest/chunker.test.ts`

**Interfaces:**
- Consumes: `estimateTokenCount` from Task 3; `CHUNK_TARGET_TOKENS`, `CHUNK_OVERLAP_RATIO` from `src/rag/config.ts`
- Produces: `chunkMarkdownDocument(markdown: string, options?: { targetTokens?: number; overlapRatio?: number }): DocumentChunk[]` where `DocumentChunk` is `{ ordinal: number; headingPath: string[]; content: string; estimatedTokenCount: number }`

- [x] **Step 1: Write failing tests** covering:
  - empty or whitespace-only input yields no chunks
  - a short document is one chunk with an empty heading path
  - headings become the heading path, nested to their level
  - a heading deeper in the tree replaces only its own level and below
  - a section under budget stays whole
  - an oversized paragraph splits at sentence boundaries, never mid-sentence
  - consecutive chunks within one section overlap
  - overlap does not cross a heading boundary, because a heading is a semantic break
  - a table that fits stays whole
  - an oversized table splits by rows and repeats the header on every part
  - a fenced code block containing pipes is not mistaken for a table
  - ordinals are sequential from zero with no gaps
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

## Completion record — 2026-08-24

All four tasks complete. `npm run verify` green: typecheck clean, lint clean,
53 tests passing.

| Module | Tests |
| --- | --- |
| `text-normalization.ts` | 11 |
| `page-extraction-assessment.ts` | 9 |
| `token-estimation.ts` | 6 |
| `chunker.ts` | 23 |

### One bug worth remembering

The chunker's first implementation passed all 21 of its tests while being
badly wrong: chunks accumulated, each containing its predecessor, growing
20/40/60/80 tokens against a 22-token budget. The overlap helper splits on
sentence boundaries, and a Markdown table contains none — so it returned the
entire previous chunk as "the trailing sentence".

It was found by printing the output and reading it, not by the suite. The
tests asserted the header appeared on every part and that no row was lost;
both stay true when chunks accumulate. Two assertions now pin the behaviour
the original suite left unconstrained:

- each data row appears in exactly one chunk
- no chunk exceeds twice its token budget

The general lesson: assertions about what is *present* pass happily while
content is duplicated. At least one assertion per component should bound what
is *absent* or *bounded*.

### Carried forward

Unchanged from Plan 1 — PostgREST still does not expose `rag`, which blocks
the upload route but nothing in this plan.
