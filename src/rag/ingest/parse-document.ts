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

import { detectFileType } from './file-type-detection';
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

/** Pages are separated so a chunk can later be traced to the page it came from. */
const PAGE_SEPARATOR = '\n\n';

async function parsePdf(
  bytes: Uint8Array,
  transcribePageWithVision: VisionTranscriber | undefined,
): Promise<ParsedDocument> {
  const pages = await extractPdfPages(bytes);

  const parseReport: PageParseRecord[] = [];
  const pageTexts: string[] = [];

  for (const page of pages) {
    const normalizedText = normalizeExtractedText(page.text);
    const assessment = assessPageExtraction({
      extractedText: normalizedText,
      pageWidthInPoints: page.widthInPoints,
      pageHeightInPoints: page.heightInPoints,
    });

    if (assessment.verdict === 'usable') {
      pageTexts.push(normalizedText);
      parseReport.push({
        pageNumber: page.pageNumber,
        verdict: 'usable',
        reasons: [],
        usedVision: false,
      });
      continue;
    }

    if (!transcribePageWithVision) {
      pageTexts.push(normalizedText);
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
      pageTexts.push(normalizedText);
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

  return {
    markdown: pageTexts.filter((text) => text.length > 0).join(PAGE_SEPARATOR),
    pageCount: pages.length,
    parseReport,
  };
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
