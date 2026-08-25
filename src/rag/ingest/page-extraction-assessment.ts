/**
 * Decides whether deterministic text extraction actually worked on a page, or
 * whether the page must be re-read by a vision model.
 *
 * The asymmetry matters. Sending a good page to vision costs a model call.
 * Accepting a bad page costs an answer: a scanned page that scores "usable"
 * becomes an empty or garbled chunk that silently never matches anything, and
 * the failure surfaces much later as "the assistant could not find it in my
 * document" with nothing to point at. So each signal below is tuned to fail
 * toward vision.
 */

const POINTS_PER_INCH = 72;

/**
 * Below this density a full page is almost certainly an image with a caption
 * rather than a page of text. Ordinary printed prose runs an order of
 * magnitude above it.
 */
const MINIMUM_CHARACTERS_PER_SQUARE_INCH = 8;

/**
 * Density is meaningless on a small page — a receipt legitimately holds a few
 * short lines — so the density test only applies above this area.
 */
const MINIMUM_AREA_FOR_DENSITY_TEST_IN_SQUARE_INCHES = 20;

/**
 * Enough extracted characters that the page is real regardless of how much
 * white space surrounds them. Chapter openings, signature pages and section
 * dividers are legitimately sparse, and density alone condemns all of them —
 * which spends the scarcest resource re-reading text already in hand.
 *
 * A caption stranded on a scanned page falls far below this, so the two cases
 * still separate: what matters is how much real text there is, not how much of
 * the page it covers.
 */
const CHARACTERS_THAT_MAKE_A_PAGE_REAL_REGARDLESS_OF_DENSITY = 80;

/**
 * Share of characters that must belong to words. A broken font encoding
 * extracts as replacement characters and stray symbols, which look like text
 * to a length check but carry no meaning.
 */
const MINIMUM_WORD_LIKE_RATIO = 0.5;

export type PageExtractionVerdict = 'usable' | 'needs-vision';

export interface PageExtractionAssessment {
  verdict: PageExtractionVerdict;
  /** Human-readable, so a bad answer can be traced back to a bad parse. */
  reasons: string[];
  charactersPerSquareInch: number;
  wordLikeRatio: number;
}

export interface PageExtractionInput {
  extractedText: string;
  pageWidthInPoints: number;
  pageHeightInPoints: number;
}

/** Letters, digits and the punctuation that genuinely appears inside prose. */
const WORD_LIKE_CHARACTER = /[\p{Letter}\p{Number}\p{Mark}'’\-.,;:!?()]/u;

function countWordLikeCharacters(text: string): number {
  let count = 0;
  for (const character of text) {
    if (WORD_LIKE_CHARACTER.test(character)) count += 1;
  }
  return count;
}

export function assessPageExtraction(input: PageExtractionInput): PageExtractionAssessment {
  const { extractedText, pageWidthInPoints, pageHeightInPoints } = input;

  const areaInSquareInches =
    (pageWidthInPoints / POINTS_PER_INCH) * (pageHeightInPoints / POINTS_PER_INCH);

  const visibleText = extractedText.trim();
  const nonSpaceCharacterCount = visibleText.replace(/\s/g, '').length;

  const charactersPerSquareInch =
    areaInSquareInches > 0 ? nonSpaceCharacterCount / areaInSquareInches : 0;

  const wordLikeRatio =
    nonSpaceCharacterCount > 0
      ? countWordLikeCharacters(visibleText) / nonSpaceCharacterCount
      : 0;

  const reasons: string[] = [];

  if (nonSpaceCharacterCount === 0) {
    reasons.push('no text extracted');
  } else {
    if (
      areaInSquareInches >= MINIMUM_AREA_FOR_DENSITY_TEST_IN_SQUARE_INCHES &&
      charactersPerSquareInch < MINIMUM_CHARACTERS_PER_SQUARE_INCH &&
      nonSpaceCharacterCount < CHARACTERS_THAT_MAKE_A_PAGE_REAL_REGARDLESS_OF_DENSITY
    ) {
      reasons.push('too little text for the page area');
    }
    if (wordLikeRatio < MINIMUM_WORD_LIKE_RATIO) {
      reasons.push('text is mostly unreadable symbols');
    }
  }

  return {
    verdict: reasons.length === 0 ? 'usable' : 'needs-vision',
    reasons,
    charactersPerSquareInch,
    wordLikeRatio,
  };
}
