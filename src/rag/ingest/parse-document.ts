/**
 * Turns uploaded bytes into Markdown, deciding page by page whether
 * deterministic extraction sufficed.
 *
 * The vision transcriber is a parameter rather than an import. That keeps this
 * function pure enough to test end to end without a network or a quota, and it
 * keeps the module free of any model client — which matters here more than
 * usual, because Marginalia's separation from the weather agent is a security
 * property and not a preference.
 *
 * Nothing in here throws for a page that failed to parse. A document with two
 * unreadable pages out of three hundred is still worth answering from; the
 * failures are recorded against their pages so a later wrong answer can be
 * traced back to a bad parse rather than blamed on retrieval.
 */

import { pageMarker } from './chunker';
import { detectFileType } from './file-type-detection';
import { measureHeadingScale, renderLinesAsMarkdown } from './heading-inference';
import {
  type PageExtractionVerdict,
  assessPageExtraction,
} from './page-extraction-assessment';
import { type ExtractedPage, extractPdfPages } from './pdf-extraction';
import { normalizeExtractedText } from './text-normalization';

/** Re-reads a page that did not extract. Supplied by the caller. */
export type VisionTranscriber = (page: ExtractedPage) => Promise<string>;

export interface PageParseRecord {
  pageNumber: number;
  verdict: PageExtractionVerdict;
  /** Why deterministic extraction was judged insufficient, if it was. */
  reasons: string[];
  usedVision: boolean;
}

export interface ParsedDocument {
  markdown: string;
  pageCount: number;
  parseReport: PageParseRecord[];
}

export interface ParseDocumentInput {
  bytes: Uint8Array;
  transcribePageWithVision?: VisionTranscriber;
}

/**
 * Each page is announced by a marker the chunker reads and removes, so a chunk
 * knows which page it came from. Without it a citation can name the section but
 * not the page, and "show me where it says that" has no answer.
 */
const PAGE_SEPARATOR = '\n\n';

async function parsePdf(
  bytes: Uint8Array,
  transcribePageWithVision: VisionTranscriber | undefined,
): Promise<ParsedDocument> {
  const pages = await extractPdfPages(bytes);

  // Measured across every page at once, never per page. A title page holds
  // nothing but large type, and measured alone would declare its title to be
  // body text — finding no headings anywhere in the document.
  const headingScale = measureHeadingScale(pages.flatMap((page) => page.lines));

  const parseReport: PageParseRecord[] = [];
  const pageTexts: string[] = [];

  for (const page of pages) {
    // Two readings of the same page. Extraction quality is judged on the plain
    // text, because heading markers would inflate the character count and make
    // a sparse page look denser than it is. What we keep is the marked-up
    // version, because that is what the chunker splits on.
    const normalizedText = normalizeExtractedText(page.text);
    const markdownForPage = normalizeExtractedText(
      renderLinesAsMarkdown(page.lines, headingScale),
    );
    const assessment = assessPageExtraction({
      extractedText: normalizedText,
      pageWidthInPoints: page.widthInPoints,
      pageHeightInPoints: page.heightInPoints,
    });

    if (assessment.verdict === 'usable') {
      pageTexts.push(markdownForPage);
      parseReport.push({
        pageNumber: page.pageNumber,
        verdict: 'usable',
        reasons: [],
        usedVision: false,
      });
      continue;
    }

    if (!transcribePageWithVision) {
      pageTexts.push(markdownForPage);
      parseReport.push({
        pageNumber: page.pageNumber,
        verdict: 'needs-vision',
        reasons: assessment.reasons,
        usedVision: false,
      });
      continue;
    }

    try {
      const transcribed = normalizeExtractedText(await transcribePageWithVision(page));
      pageTexts.push(transcribed);
      parseReport.push({
        pageNumber: page.pageNumber,
        verdict: 'needs-vision',
        reasons: assessment.reasons,
        usedVision: true,
      });
    } catch (cause) {
      // One page's transcription failing must not cost the whole document.
      pageTexts.push(markdownForPage);
      parseReport.push({
        pageNumber: page.pageNumber,
        verdict: 'needs-vision',
        reasons: [
          ...assessment.reasons,
          `vision transcription failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        ],
        usedVision: false,
      });
    }
  }

  const markdown = pages
    .map((page, index) => ({ pageNumber: page.pageNumber, text: pageTexts[index] }))
    .filter((page) => page.text.length > 0)
    .map((page) => `${pageMarker(page.pageNumber)}\n\n${page.text}`)
    .join(PAGE_SEPARATOR);

  return { markdown, pageCount: pages.length, parseReport };
}

export async function parseDocument(input: ParseDocumentInput): Promise<ParsedDocument> {
  const fileType = detectFileType(input.bytes);

  switch (fileType) {
    case 'pdf':
      return parsePdf(input.bytes, input.transcribePageWithVision);

    case 'text': {
      const markdown = normalizeExtractedText(new TextDecoder().decode(input.bytes));
      return {
        markdown,
        pageCount: 1,
        parseReport: [{ pageNumber: 1, verdict: 'usable', reasons: [], usedVision: false }],
      };
    }

    // Word documents are recognized but not yet read; saying so plainly beats
    // returning an empty document that looks like a successful parse.
    case 'docx':
      throw new Error('Word documents are not supported yet. Upload a PDF or a text file.');

    default:
      throw new Error('This file is an unsupported format. Upload a PDF or a text file.');
  }
}
