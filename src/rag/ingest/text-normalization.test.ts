import { describe, expect, it } from 'vitest';
import { normalizeExtractedText } from './text-normalization';

// Named code points rather than the characters themselves: a test asserting
// that invisible characters are removed is unreadable if it contains them.
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const ZERO_WIDTH_NON_JOINER = String.fromCodePoint(0x200c);
const ZERO_WIDTH_JOINER = String.fromCodePoint(0x200d);
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);
const NON_BREAKING_SPACE = String.fromCodePoint(0x00a0);
const IDEOGRAPHIC_SPACE = String.fromCodePoint(0x3000);
const NULL_CHARACTER = String.fromCodePoint(0x00);
const BELL = String.fromCodePoint(0x07);
const COMBINING_ACUTE_ACCENT = String.fromCodePoint(0x0301);

describe('characters that carry risk', () => {
  it('removes zero-width characters, a documented way to hide instructions in a document', () => {
    const hidden =
      `Pay the${ZERO_WIDTH_SPACE}invoice${ZERO_WIDTH_NON_JOINER}` +
      ` by${ZERO_WIDTH_JOINER} Friday${BYTE_ORDER_MARK}`;
    expect(normalizeExtractedText(hidden)).toBe('Pay theinvoice by Friday');
  });

  it('removes control characters that corrupt tokenization', () => {
    expect(normalizeExtractedText(`before${NULL_CHARACTER}${BELL}after`)).toBe('beforeafter');
  });

  it('keeps newline and tab, which carry real structure', () => {
    expect(normalizeExtractedText('line one\nline\ttwo')).toBe('line one\nline\ttwo');
  });
});

describe('whitespace', () => {
  it('turns a non-breaking space into an ordinary space so tokenization matches the query', () => {
    expect(normalizeExtractedText(`Section${NON_BREAKING_SPACE}8`)).toBe('Section 8');
  });

  it('turns an ideographic space into an ordinary space', () => {
    expect(normalizeExtractedText(`A${IDEOGRAPHIC_SPACE}B`)).toBe('A B');
  });

  it('collapses a run of blank lines into a single blank line', () => {
    expect(normalizeExtractedText('first\n\n\n\n\nsecond')).toBe('first\n\nsecond');
  });

  it('trims trailing whitespace from every line', () => {
    expect(normalizeExtractedText('first   \nsecond\t\n')).toBe('first\nsecond');
  });
});

describe('unicode', () => {
  it('normalizes decomposed characters to NFC so identical words compare equal', () => {
    const decomposed = `cafe${COMBINING_ACUTE_ACCENT}`;
    const composed = 'café';

    expect(decomposed).not.toBe(composed);
    expect(normalizeExtractedText(decomposed)).toBe(composed);
  });

  it('keeps characters outside the basic plane intact rather than splitting surrogates', () => {
    expect(normalizeExtractedText('chart 📊 caption')).toBe('chart 📊 caption');
  });
});

describe('text that is already clean', () => {
  it('passes through unchanged', () => {
    const clean = 'Section 8 — Pets\n\nNo animals may be kept without written consent.';
    expect(normalizeExtractedText(clean)).toBe(clean);
  });

  it('returns an empty string for empty input', () => {
    expect(normalizeExtractedText('')).toBe('');
  });
});
