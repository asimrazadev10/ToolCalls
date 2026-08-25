# Marginalia Heading Inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover heading structure from a PDF's flat text layer, so chunks carry a heading path and the chunker's structure-aware splitting stops being inert on the format that matters most.

**Architecture:** pdf.js reports a font size per text item (`transform[3]`) and a baseline (`transform[5]`). Items sharing a baseline are one line; a line materially larger than the document's body size is a heading, and the ranking of distinct heading sizes gives the level. Inference is a pure module over `{ text, fontSizeInPoints }`, so it is unit-testable with synthetic lines and never imports a PDF library.

**Tech Stack:** TypeScript 5, Vitest 3, unpdf.

**Spec:** `docs/superpowers/specs/2026-08-24-marginalia-rag-design.md` — addresses finding 2 of `2026-08-24-marginalia-document-parsing.md`.

## Global Constraints

- The body font size is measured **across the whole document**, never per page. A title page holds nothing but large text, and measured alone would declare its title to be body.
- Size is weighted by characters, not by lines. A document with many short headings must not drag the body size upward.
- Inference must not import from `pdf-extraction.ts`; it takes a structural shape so it stays free of unpdf.

---

### Task 1: Heading inference from measured lines

**Files:**
- Create: `src/rag/ingest/heading-inference.ts`
- Create: `src/rag/ingest/heading-inference.test.ts`

**Interfaces:**
- Produces: `MeasuredLine = { text: string; fontSizeInPoints: number }`,
  `HeadingScale = { bodyFontSizeInPoints: number; levelByFontSize: Map<number, number> }`,
  `measureHeadingScale(allLines: MeasuredLine[]): HeadingScale`,
  `renderLinesAsMarkdown(lines: MeasuredLine[], scale: HeadingScale): string`

- [ ] **Step 1: Write failing tests** — body size is the character-weighted mode rather than the commonest line size; a document of one uniform size yields no headings; distinct larger sizes rank into levels 1, 2, 3 descending; a larger line renders with the right number of hashes; body lines pass through untouched; a long line at heading size stays body, because a heading is short; a page-number line stays body; blank lines are dropped.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Commit**

---

### Task 2: Report measured lines from PDF extraction

Also fixes the spurious line break found in Plan 3: pdf.js emits an
empty-string item carrying `hasEOL`, which the joiner turned into a newline
mid-line, stranding list numbers on their own line.

**Files:**
- Modify: `src/rag/ingest/pdf-extraction.ts`
- Modify: `src/rag/ingest/pdf-extraction.test.ts`
- Modify: `scripts/generate-pdf-fixtures.mts`
- Regenerate: `src/rag/ingest/__fixtures__/two-page-text.pdf` with a real heading hierarchy

**Interfaces:**
- Produces: `ExtractedPage` gains `lines: ExtractedTextLine[]`, where
  `ExtractedTextLine = { text: string; fontSizeInPoints: number; baselineYInPoints: number }`

- [ ] **Step 1: Regenerate the fixture** with a 24pt title, 16pt section headings and 10pt body.
- [ ] **Step 2: Write failing tests** — lines are grouped by baseline; each line reports the font size covering most of its characters; lines come back in reading order, top of page first; an empty item never splits a line.
- [ ] **Step 3: Run — expect FAIL**
- [ ] **Step 4: Implement**
- [ ] **Step 5: Run — expect PASS**
- [ ] **Step 6: Commit**

---

### Task 3: Wire inference into the parse orchestrator

**Files:**
- Modify: `src/rag/ingest/parse-document.ts`
- Modify: `src/rag/ingest/parse-document.test.ts`

- [ ] **Step 1: Write failing tests** — a PDF with a heading hierarchy produces Markdown carrying `#` and `##`; the scale is measured across all pages together, so a heading on page two is levelled against page one's body; chunking the result yields a non-empty heading path.
- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement**
- [ ] **Step 4: Run — expect PASS**
- [ ] **Step 5: Verify end to end that chunks carry heading paths**
- [ ] **Step 6: Commit**
