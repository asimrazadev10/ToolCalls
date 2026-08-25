# Marginalia Document Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn uploaded bytes into per-page text, and decide page by page whether deterministic extraction sufficed.

**Architecture:** Type is decided by the bytes themselves, never by a filename or a client-supplied MIME type. Each format has its own extractor behind one interface. The vision fallback is an injected dependency, so the orchestrator is testable end to end with a stub and no model quota.

**Tech Stack:** TypeScript 5, Vitest 3, `unpdf` (serverless pdf.js wrapper), `pdf-lib` (dev only, to generate committed fixtures).

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md`

## Global Constraints

- Lives in `src/rag/ingest/**`; may not import `src/lib/ai/**`.
- No function here calls a model. The vision fallback arrives as a parameter.
- Fixtures are committed binaries, generated once; tests never generate them.

---

### Task 1: File type detection from bytes

A client controls the filename and the declared MIME type, so neither is
evidence. Believing them is how a parser gets handed something it cannot
safely read.

**Files:**
- Create: `src/rag/ingest/file-type-detection.ts`
- Create: `src/rag/ingest/file-type-detection.test.ts`

**Interfaces:**
- Produces: `detectFileType(bytes: Uint8Array): DetectedFileType` where
  `DetectedFileType = 'pdf' | 'docx' | 'text' | 'unsupported'`

- [x] **Step 1: Write failing tests** — PDF magic detected; OOXML zip containing `word/` detected as docx; a zip without it is unsupported; UTF-8 prose is text; arbitrary binary is unsupported; empty input is unsupported; and the security case — bytes that are a zip are reported as such no matter what a caller claims the file is.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

### Task 2: PDF page extraction

**Files:**
- Create: `src/rag/ingest/pdf-extraction.ts`
- Create: `src/rag/ingest/pdf-extraction.test.ts`
- Create: `scripts/generate-pdf-fixtures.mts`
- Create: `src/rag/ingest/__fixtures__/two-page-text.pdf`
- Create: `src/rag/ingest/__fixtures__/no-text-layer.pdf`

**Interfaces:**
- Produces: `extractPdfPages(bytes: Uint8Array): Promise<ExtractedPage[]>` where
  `ExtractedPage = { pageNumber: number; text: string; widthInPoints: number; heightInPoints: number }`

- [x] **Step 1: Generate and commit fixtures** — one two-page PDF with a text layer, one page-sized PDF with no text layer at all (the scanned case).
- [x] **Step 2: Write failing tests** — returns one entry per page, numbered from 1; text of each page matches what was written into it; page dimensions are reported in points; a PDF with no text layer yields empty text rather than throwing.
- [x] **Step 3: Run — expect FAIL**
- [x] **Step 4: Implement**
- [x] **Step 5: Run — expect PASS**
- [x] **Step 6: Commit**

---

### Task 3: The parse orchestrator

**Files:**
- Create: `src/rag/ingest/parse-document.ts`
- Create: `src/rag/ingest/parse-document.test.ts`

**Interfaces:**
- Consumes: `detectFileType`, `extractPdfPages`, `normalizeExtractedText`, `assessPageExtraction`
- Produces: `parseDocument(input: { bytes: Uint8Array; transcribePageWithVision?: VisionTranscriber }): Promise<ParsedDocument>` where `VisionTranscriber = (page: ExtractedPage) => Promise<string>` and `ParsedDocument = { markdown: string; pageCount: number; parseReport: PageParseRecord[] }`

- [x] **Step 1: Write failing tests** — a text PDF parses with no vision calls; a PDF with no text layer routes exactly the failing pages to the injected transcriber; the transcriber's output replaces that page's text; with no transcriber supplied the failing page is recorded as failed rather than throwing; every page appears in the parse report with its verdict and reasons; plain text passes through; an unsupported type is refused with a reason.
- [x] **Step 2: Run — expect FAIL**
- [x] **Step 3: Implement**
- [x] **Step 4: Run — expect PASS**
- [x] **Step 5: Commit**

---

## Completion record — 2026-08-24

All three tasks complete. `npm run verify` green: 80 tests passing.

| Module | Tests |
| --- | --- |
| `file-type-detection.ts` | 9 |
| `pdf-extraction.ts` | 6 |
| `parse-document.ts` | 10 |

### Finding 1 — a miscalibration the unit tests could not see

Running real extraction through `assessPageExtraction` showed that density
alone condemned every sparse page: a chapter opening or signature page was
sent to vision to re-read text already in hand, spending the scarcest
resource on pages that were fine. Pages with enough real characters are now
accepted regardless of density, and a caption stranded on a scanned page
still falls far below that bar.

The fixture was also unrepresentative at two lines per page — genuinely
ambiguous between sparse-but-real and a scan with a caption. It now carries a
realistic body.

Synthetic unit inputs cannot reveal this class of error. Only running the
component against output from the component upstream of it can.

### Finding 2 — PDF chunks carry no heading path  (OPEN)

Every chunk from a PDF comes back with `headingPath: []`. A PDF's text layer
is flat: "Section 8 Pets" arrives as plain text, not as `## Section 8 Pets`.
So the chunker's structure-aware splitting — its most valuable property —
does nothing for the format that matters most, and falls back to length-based
packing.

This is not a chunker bug. It is missing information at the extraction stage.

Options, in the order they should be considered:

1. **Infer headings from font size during extraction.** pdf.js text items
   carry `height` and `fontName`. A line materially larger than the body
   median is a heading, and its size relative to other headings gives the
   level. Deterministic, free, and recovers structure for every text PDF.
2. Have vision transcribe to Markdown for all pages — accurate, but costs a
   model call per page and the quota does not allow it.
3. Accept flat chunking for PDFs, and lose heading paths in citations.

Option 1 is the right answer and belongs in the next plan, before embedding.
Retrieval quality is capped by what the chunk carries, and a chunk that knows
it belongs to "Section 8 - Pets" retrieves for questions about pets in a way
the same text without that breadcrumb does not.

### Also noted

`joinTextItems` occasionally breaks a visual line where pdf.js reports an
end-of-line mid-line, so an item like a list number can land on its own line.
Cosmetic rather than lossy — no text is dropped — but it slightly weakens the
semantic unit. Worth revisiting alongside finding 2, since both live in the
extraction stage.
