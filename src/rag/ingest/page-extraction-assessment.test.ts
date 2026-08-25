import { describe, expect, it } from 'vitest';
import { assessPageExtraction } from './page-extraction-assessment';

/** US Letter at 72 points per inch — 8.5 x 11 inches, so 93.5 square inches. */
const LETTER_PAGE = { pageWidthInPoints: 612, pageHeightInPoints: 792 };

const prose = (repetitions: number) =>
  'The tenant shall not keep any animal on the premises without written consent. '.repeat(
    repetitions,
  );

describe('a page whose text extracted cleanly', () => {
  it('is usable', () => {
    const assessment = assessPageExtraction({ extractedText: prose(30), ...LETTER_PAGE });

    expect(assessment.verdict).toBe('usable');
    expect(assessment.reasons).toEqual([]);
  });
});

describe('a page that needs re-reading by vision', () => {
  it('yields nothing at all, as a scanned image would', () => {
    const assessment = assessPageExtraction({ extractedText: '', ...LETTER_PAGE });

    expect(assessment.verdict).toBe('needs-vision');
    expect(assessment.reasons).toContain('no text extracted');
  });

  it('yields only whitespace', () => {
    const assessment = assessPageExtraction({ extractedText: '   \n\n \t ', ...LETTER_PAGE });

    expect(assessment.verdict).toBe('needs-vision');
    expect(assessment.reasons).toContain('no text extracted');
  });

  it('yields a scattering of characters across a full page', () => {
    const assessment = assessPageExtraction({ extractedText: 'Fig. 4', ...LETTER_PAGE });

    expect(assessment.verdict).toBe('needs-vision');
    expect(assessment.reasons).toContain('too little text for the page area');
  });

  it('yields mostly replacement characters, the mark of a broken font encoding', () => {
    const assessment = assessPageExtraction({
      extractedText: '���� tenant ������'.repeat(
        40,
      ),
      ...LETTER_PAGE,
    });

    expect(assessment.verdict).toBe('needs-vision');
    expect(assessment.reasons).toContain('text is mostly unreadable symbols');
  });

  it('always explains itself, so a bad answer can be traced back to a bad parse', () => {
    const assessment = assessPageExtraction({ extractedText: '', ...LETTER_PAGE });

    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
});

describe('the measurements behind the verdict', () => {
  it('reports character density against page area, not raw character count', () => {
    const dense = assessPageExtraction({ extractedText: prose(30), ...LETTER_PAGE });
    const sameTextOnADoublePage = assessPageExtraction({
      extractedText: prose(30),
      pageWidthInPoints: 1224,
      pageHeightInPoints: 1584,
    });

    expect(sameTextOnADoublePage.charactersPerSquareInch).toBeLessThan(
      dense.charactersPerSquareInch,
    );
  });

  it('reports the share of characters that belong to real words', () => {
    const clean = assessPageExtraction({ extractedText: prose(30), ...LETTER_PAGE });

    expect(clean.wordLikeRatio).toBeGreaterThan(0.8);
  });
});

describe('a page too small to judge by density', () => {
  it('does not demand vision for a short line on a receipt-sized page', () => {
    const assessment = assessPageExtraction({
      extractedText: 'Total due: 42.00',
      pageWidthInPoints: 144,
      pageHeightInPoints: 216,
    });

    expect(assessment.verdict).toBe('usable');
  });
});
