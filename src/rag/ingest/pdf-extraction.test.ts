import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractPdfPages } from './pdf-extraction';

const fixture = async (name: string) =>
  new Uint8Array(await readFile(new URL(`./__fixtures__/${name}`, import.meta.url)));

describe('a PDF with a text layer', () => {
  it('returns one entry per page, numbered from one as a reader would count them', async () => {
    const pages = await extractPdfPages(await fixture('two-page-text.pdf'));

    expect(pages).toHaveLength(2);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2]);
  });

  it('extracts the text that was written on each page, to that page', async () => {
    const pages = await extractPdfPages(await fixture('two-page-text.pdf'));

    expect(pages[0].text).toContain('Section 8 Pets');
    expect(pages[0].text).toContain('animal covenants');
    expect(pages[1].text).toContain('Section 9 Noise');
    expect(pages[1].text).toContain('quiet hours covenants');
    // Neither page's content may bleed into the other.
    expect(pages[0].text).not.toContain('quiet hours covenants');
    expect(pages[1].text).not.toContain('animal covenants');
  });

  it('reports page dimensions in points, which the yield assessment needs', async () => {
    const pages = await extractPdfPages(await fixture('two-page-text.pdf'));

    expect(pages[0].widthInPoints).toBeCloseTo(612, 0);
    expect(pages[0].heightInPoints).toBeCloseTo(792, 0);
  });
});

describe('a PDF with no text layer, as a scan has none', () => {
  it('yields empty text rather than throwing, so the page can be sent to vision', async () => {
    const pages = await extractPdfPages(await fixture('no-text-layer.pdf'));

    expect(pages).toHaveLength(1);
    expect(pages[0].text.trim()).toBe('');
  });

  it('still reports the page dimensions', async () => {
    const pages = await extractPdfPages(await fixture('no-text-layer.pdf'));

    expect(pages[0].widthInPoints).toBeCloseTo(612, 0);
    expect(pages[0].heightInPoints).toBeCloseTo(792, 0);
  });
});

describe('bytes that are not a PDF', () => {
  it('rejects rather than returning empty pages, which would look like a scan', async () => {
    const notAPdf = new TextEncoder().encode('this is plainly not a PDF');

    await expect(extractPdfPages(notAPdf)).rejects.toThrow();
  });
});
