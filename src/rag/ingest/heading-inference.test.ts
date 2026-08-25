import { describe, expect, it } from 'vitest';
import { type MeasuredLine, measureHeadingScale, renderLinesAsMarkdown } from './heading-inference';

const line = (text: string, fontSizeInPoints: number): MeasuredLine => ({
  text,
  fontSizeInPoints,
});

const bodyLine = (index: number) =>
  line(`The tenant shall observe obligation number ${index} at all times without exception.`, 10);

const aPageOfBody = () => Array.from({ length: 20 }, (_, index) => bodyLine(index));

describe('measuring the body size', () => {
  it('weights by characters, so many short headings do not drag it upward', () => {
    // Ten short headings at 18pt against four long body lines at 10pt. Counted
    // by line, 18pt wins. Counted by character — which is what a reader sees —
    // 10pt is plainly the body.
    const lines = [
      ...Array.from({ length: 10 }, (_, index) => line(`Section ${index}`, 18)),
      ...Array.from({ length: 4 }, (_, index) => bodyLine(index)),
    ];

    expect(measureHeadingScale(lines).bodyFontSizeInPoints).toBe(10);
  });

  it('finds no headings in a document set entirely in one size', () => {
    const scale = measureHeadingScale(aPageOfBody());

    expect(scale.bodyFontSizeInPoints).toBe(10);
    expect(scale.levelByFontSize.size).toBe(0);
  });
});

describe('ranking heading levels', () => {
  it('assigns level one to the largest size and descends from there', () => {
    const scale = measureHeadingScale([
      line('Residential Lease', 24),
      line('Section 8 - Pets', 16),
      line('8.1 Exceptions', 13),
      ...aPageOfBody(),
    ]);

    expect(scale.levelByFontSize.get(24)).toBe(1);
    expect(scale.levelByFontSize.get(16)).toBe(2);
    expect(scale.levelByFontSize.get(13)).toBe(3);
  });

  it('does not promote a size barely above the body, which is emphasis not structure', () => {
    const scale = measureHeadingScale([line('slightly larger', 10.5), ...aPageOfBody()]);

    expect(scale.levelByFontSize.has(10.5)).toBe(false);
  });
});

describe('rendering', () => {
  const scale = () =>
    measureHeadingScale([
      line('Residential Lease', 24),
      line('Section 8 - Pets', 16),
      ...aPageOfBody(),
    ]);

  it('marks a heading with one hash per level', () => {
    const markdown = renderLinesAsMarkdown(
      [line('Residential Lease', 24), line('Section 8 - Pets', 16), bodyLine(0)],
      scale(),
    );

    expect(markdown).toContain('# Residential Lease');
    expect(markdown).toContain('## Section 8 - Pets');
  });

  it('passes body lines through untouched', () => {
    const markdown = renderLinesAsMarkdown([bodyLine(0)], scale());

    expect(markdown).toBe(bodyLine(0).text);
    expect(markdown.startsWith('#')).toBe(false);
  });

  it('leaves a long line as body even at heading size, because a heading is short', () => {
    // Large type across a full paragraph is a pull quote or a large-print
    // document, not a section title. Promoting it would invent structure.
    const longLineInLargeType = line(
      'The tenant hereby acknowledges and agrees that the covenants set out in this ' +
        'agreement are reasonable and necessary for the protection of the legitimate ' +
        'interests of the landlord and shall survive the termination hereof.',
      24,
    );

    const markdown = renderLinesAsMarkdown([longLineInLargeType], scale());

    expect(markdown.startsWith('#')).toBe(false);
  });

  it('leaves a bare page number as body', () => {
    const markdown = renderLinesAsMarkdown([line('12', 24)], scale());

    expect(markdown.startsWith('#')).toBe(false);
  });

  it('drops blank lines rather than emitting empty paragraphs', () => {
    const markdown = renderLinesAsMarkdown([line('   ', 10), bodyLine(0)], scale());

    expect(markdown).toBe(bodyLine(0).text);
  });
});

describe('the reason body size is measured across the whole document', () => {
  it('does not treat a title page as though its title were body text', () => {
    // Measured alone, a page holding only a 24pt title would call 24pt the
    // body size and find no headings anywhere in the document.
    const titlePageAlone = [line('Residential Lease', 24)];
    const wholeDocument = [...titlePageAlone, ...aPageOfBody()];

    expect(measureHeadingScale(titlePageAlone).bodyFontSizeInPoints).toBe(24);
    expect(measureHeadingScale(wholeDocument).bodyFontSizeInPoints).toBe(10);
    expect(measureHeadingScale(wholeDocument).levelByFontSize.get(24)).toBe(1);
  });
});
