/**
 * Pulls the text layer out of a PDF, one page at a time.
 *
 * Page-at-a-time is the point. The vision fallback is decided per page — a
 * report is commonly typeset text with two scanned exhibits bound into the
 * middle — so a whole-document text dump would force an all-or-nothing choice
 * and either miss the exhibits or re-read three hundred good pages.
 *
 * Dimensions come back alongside the text because emptiness alone does not
 * identify a scan: a nearly blank page legitimately holds little text, while
 * a full page holding the same amount did not extract properly.
 */

import { getDocumentProxy } from 'unpdf';

export interface ExtractedPage {
  /** One-based, matching how a reader refers to a page. */
  pageNumber: number;
  text: string;
  widthInPoints: number;
  heightInPoints: number;
}

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
}

/**
 * pdf.js hands back positioned fragments rather than lines. Joining them with
 * a space and honouring the end-of-line flag reconstructs something a reader
 * would recognize, without pretending to recover the original layout.
 */
function joinTextItems(items: PdfTextItem[]): string {
  let text = '';

  for (const item of items) {
    text += item.str ?? '';
    if (item.hasEOL) text += '\n';
    else if (item.str && !item.str.endsWith(' ')) text += ' ';
  }

  return text.replace(/[ \t]+\n/g, '\n').trim();
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

    pages.push({
      pageNumber,
      text: joinTextItems(textContent.items as PdfTextItem[]),
      widthInPoints: viewport.width,
      heightInPoints: viewport.height,
    });
  }

  return pages;
}
