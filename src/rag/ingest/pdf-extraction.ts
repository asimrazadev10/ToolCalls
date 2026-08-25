/**
 * Pulls the text layer out of a PDF, one page at a time, keeping the
 * typography that carries structure.
 *
 * Page-at-a-time is the point. The vision fallback is decided per page — a
 * report is commonly typeset text with two scanned exhibits bound into the
 * middle — so a whole-document text dump would force an all-or-nothing choice
 * and either miss the exhibits or re-read three hundred good pages.
 *
 * Type size travels with each line because a PDF has no headings, only text
 * that happens to be larger. Discarding the size here would discard the
 * document's structure, and the chunker downstream would have nothing to split
 * on but length.
 */

import { getDocumentProxy } from 'unpdf';
import type { MeasuredLine } from './heading-inference';

export interface ExtractedTextLine extends MeasuredLine {
  /** PDF coordinates grow upward, so a larger baseline sits higher on the page. */
  baselineYInPoints: number;
}

export interface ExtractedPage {
  /** One-based, matching how a reader refers to a page. */
  pageNumber: number;
  /** Plain reading text. Used for extraction quality, which must not see markup. */
  text: string;
  lines: ExtractedTextLine[];
  widthInPoints: number;
  heightInPoints: number;
}

interface PdfTextItem {
  str?: string;
  width?: number;
  transform?: number[];
}

interface PositionedFragment {
  text: string;
  fontSizeInPoints: number;
  baselineYInPoints: number;
  leftXInPoints: number;
  widthInPoints: number;
}

/**
 * Baselines drift by a fraction of a point across a line, and superscripts sit
 * deliberately higher, so equality is the wrong test for "same line".
 */
const SAME_LINE_BASELINE_TOLERANCE_IN_POINTS = 2;

/**
 * A horizontal gap wider than this fraction of the type size is a word space
 * the PDF encoded as positioning rather than as a space character.
 */
const GAP_THAT_MEANS_A_SPACE = 0.25;

function toPositionedFragments(items: PdfTextItem[]): PositionedFragment[] {
  const fragments: PositionedFragment[] = [];

  for (const item of items) {
    const text = item.str ?? '';
    // pdf.js emits empty items that still carry an end-of-line flag. Treating
    // one as content strands the next fragment — a list number, typically — on
    // a line of its own.
    if (text.length === 0 || !item.transform) continue;

    fragments.push({
      text,
      fontSizeInPoints: Math.abs(item.transform[3]),
      baselineYInPoints: item.transform[5],
      leftXInPoints: item.transform[4],
      widthInPoints: item.width ?? 0,
    });
  }

  return fragments;
}

/** The size covering most of the line's characters, not merely the first size seen. */
function dominantFontSize(fragments: PositionedFragment[]): number {
  const charactersByFontSize = new Map<number, number>();

  for (const fragment of fragments) {
    charactersByFontSize.set(
      fragment.fontSizeInPoints,
      (charactersByFontSize.get(fragment.fontSizeInPoints) ?? 0) + fragment.text.trim().length,
    );
  }

  let dominant = fragments[0]?.fontSizeInPoints ?? 0;
  let mostCharacters = -1;

  for (const [fontSize, characters] of charactersByFontSize) {
    if (characters > mostCharacters) {
      dominant = fontSize;
      mostCharacters = characters;
    }
  }

  return dominant;
}

function joinFragmentsIntoLine(fragments: PositionedFragment[]): string {
  let text = '';
  let previous: PositionedFragment | undefined;

  for (const fragment of fragments) {
    if (previous) {
      const gap = fragment.leftXInPoints - (previous.leftXInPoints + previous.widthInPoints);
      const needsSpace =
        !text.endsWith(' ') &&
        !fragment.text.startsWith(' ') &&
        gap > fragment.fontSizeInPoints * GAP_THAT_MEANS_A_SPACE;
      if (needsSpace) text += ' ';
    }
    text += fragment.text;
    previous = fragment;
  }

  return text.trim();
}

function groupFragmentsIntoLines(fragments: PositionedFragment[]): ExtractedTextLine[] {
  // Reading order: down the page, which in PDF coordinates is descending Y.
  const inReadingOrder = [...fragments].sort(
    (first, second) => second.baselineYInPoints - first.baselineYInPoints,
  );

  const lines: ExtractedTextLine[] = [];
  let currentLine: PositionedFragment[] = [];

  const flush = () => {
    if (currentLine.length === 0) return;
    const leftToRight = [...currentLine].sort(
      (first, second) => first.leftXInPoints - second.leftXInPoints,
    );
    const text = joinFragmentsIntoLine(leftToRight);
    if (text.length > 0) {
      lines.push({
        text,
        fontSizeInPoints: dominantFontSize(leftToRight),
        baselineYInPoints: leftToRight[0].baselineYInPoints,
      });
    }
    currentLine = [];
  };

  for (const fragment of inReadingOrder) {
    const openBaseline = currentLine[0]?.baselineYInPoints;
    const belongsToCurrentLine =
      openBaseline !== undefined &&
      Math.abs(openBaseline - fragment.baselineYInPoints) <= SAME_LINE_BASELINE_TOLERANCE_IN_POINTS;

    if (!belongsToCurrentLine) flush();
    currentLine.push(fragment);
  }

  flush();
  return lines;
}

export async function extractPdfPages(bytes: Uint8Array): Promise<ExtractedPage[]> {
  // Copied because pdf.js takes ownership of the buffer it is given and leaves
  // the caller's view detached — a surprise for anything reusing those bytes,
  // such as hashing the upload for idempotency.
  const document = await getDocumentProxy(new Uint8Array(bytes));

  const pages: ExtractedPage[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const textContent = await page.getTextContent();

    const lines = groupFragmentsIntoLines(
      toPositionedFragments(textContent.items as PdfTextItem[]),
    );

    pages.push({
      pageNumber,
      text: lines.map((line) => line.text).join('\n'),
      lines,
      widthInPoints: viewport.width,
      heightInPoints: viewport.height,
    });
  }

  return pages;
}
