# Marginalia Document Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

- [ ] **Step 1: Write failing tests** — PDF magic detected; OOXML zip containing `word/` detected as docx; a zip without it is unsupported; UTF-8 prose is text; arbitrary binary is unsupported; empty input is unsupported; and the security case — bytes that are a zip are reported as such no matter what a caller claims the file is.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

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

- [ ] **Step 1: Generate and commit fixtures** — one two-page PDF with a text layer, one page-sized PDF with no text layer at all (the scanned case).
- [ ] **Step 2: Write failing tests** — returns one entry per page, numbered from 1; text of each page matches what was written into it; page dimensions are reported in points; a PDF with no text layer yields empty text rather than throwing.
- [ ] **Step 3: Run — expect FAIL**
- [ ] **Step 4: Implement**
- [ ] **Step 5: Run — expect PASS**
- [ ] **Step 6: Commit**

---

### Task 3: The parse orchestrator

**Files:**
- Create: `src/rag/ingest/parse-document.ts`
- Create: `src/rag/ingest/parse-document.test.ts`

**Interfaces:**
- Consumes: `detectFileType`, `extractPdfPages`, `normalizeExtractedText`, `assessPageExtraction`
- Produces: `parseDocument(input: { bytes: Uint8Array; transcribePageWithVision?: VisionTranscriber }): Promise<ParsedDocument>` where `VisionTranscriber = (page: ExtractedPage) => Promise<string>` and `ParsedDocument = { markdown: string; pageCount: number; parseReport: PageParseRecord[] }`

- [ ] **Step 1: Write failing tests** — a text PDF parses with no vision calls; a PDF with no text layer routes exactly the failing pages to the injected transcriber; the transcriber's output replaces that page's text; with no transcriber supplied the failing page is recorded as failed rather than throwing; every page appears in the parse report with its verdict and reasons; plain text passes through; an unsupported type is refused with a reason.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**
