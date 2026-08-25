import { readFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { parseDocument } from './parse-document';

const fixture = async (name: string) =>
  new Uint8Array(await readFile(new URL(`./__fixtures__/${name}`, import.meta.url)));

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe('a PDF whose text layer is intact', () => {
  it('parses every page without spending a single vision call', async () => {
    const transcribePageWithVision = vi.fn();

    const parsed = await parseDocument({
      bytes: await fixture('two-page-text.pdf'),
      transcribePageWithVision,
    });

    expect(parsed.pageCount).toBe(2);
    expect(transcribePageWithVision).not.toHaveBeenCalled();
  });

  it('carries the text of every page into the markdown', async () => {
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    expect(parsed.markdown).toContain('Section 8 Pets');
    expect(parsed.markdown).toContain('Section 9 Noise');
  });

  it('records each page as usable, so a later bad answer can be traced', async () => {
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    expect(parsed.parseReport).toHaveLength(2);
    for (const record of parsed.parseReport) {
      expect(record.verdict).toBe('usable');
      expect(record.usedVision).toBe(false);
    }
  });
});

describe('structure recovered from typography', () => {
  it('renders the document title and section headings as Markdown headings', async () => {
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    expect(parsed.markdown).toContain('# Residential Lease');
    expect(parsed.markdown).toContain('## Section 8 Pets');
  });

  it('levels a heading on page two against the body of the whole document', async () => {
    // Page two carries a 16pt heading and 10pt body but no 24pt title. Measured
    // alone it would still be levelled correctly only by luck; measured with
    // page one it is unambiguously a level-two heading.
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    // Asserted on exact lines: '## Section 9 Noise' contains the substring
    // '# Section 9 Noise', so a substring check cannot tell the levels apart.
    const lines = parsed.markdown.split('\n');

    expect(lines).toContain('## Section 9 Noise');
    expect(lines).not.toContain('# Section 9 Noise');
  });

  it('leaves body text unmarked', async () => {
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    expect(parsed.markdown).not.toContain('# 1. The tenant');
  });
});

describe('page provenance reaching a chunk', () => {
  it('lets a chunk say which page it came from, which a citation needs', async () => {
    const { chunkMarkdownDocument } = await import('./chunker');
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });

    const chunks = chunkMarkdownDocument(parsed.markdown, { targetTokens: 140 });

    expect(chunks.every((chunk) => chunk.pageFrom !== null)).toBe(true);
    // The fixture has two pages, and chunks come from both.
    expect(new Set(chunks.map((chunk) => chunk.pageFrom))).toEqual(new Set([1, 2]));
  });

  it('keeps the marker out of the text the model reads', async () => {
    const parsed = await parseDocument({ bytes: await fixture('two-page-text.pdf') });
    const { chunkMarkdownDocument } = await import('./chunker');

    for (const chunk of chunkMarkdownDocument(parsed.markdown, { targetTokens: 140 })) {
      expect(chunk.content).not.toContain('marginalia:page');
    }
  });
});

describe('a PDF with no text layer', () => {
  it('sends exactly the failing page to the transcriber', async () => {
    const transcribePageWithVision = vi.fn().mockResolvedValue('Recovered by vision.');

    await parseDocument({
      bytes: await fixture('no-text-layer.pdf'),
      transcribePageWithVision,
    });

    expect(transcribePageWithVision).toHaveBeenCalledTimes(1);
    expect(transcribePageWithVision.mock.calls[0][0].pageNumber).toBe(1);
  });

  it("uses the transcriber's text in place of what did not extract", async () => {
    const parsed = await parseDocument({
      bytes: await fixture('no-text-layer.pdf'),
      transcribePageWithVision: async () => 'Recovered by vision.',
    });

    expect(parsed.markdown).toContain('Recovered by vision.');
    expect(parsed.parseReport[0].usedVision).toBe(true);
  });

  it('records the page as failed rather than throwing when no transcriber is supplied', async () => {
    const parsed = await parseDocument({ bytes: await fixture('no-text-layer.pdf') });

    expect(parsed.parseReport[0].verdict).toBe('needs-vision');
    expect(parsed.parseReport[0].usedVision).toBe(false);
    expect(parsed.parseReport[0].reasons).toContain('no text extracted');
  });

  it('survives a transcriber that fails, recording the reason against that page', async () => {
    const parsed = await parseDocument({
      bytes: await fixture('no-text-layer.pdf'),
      transcribePageWithVision: async () => {
        throw new Error('quota exhausted');
      },
    });

    expect(parsed.parseReport[0].usedVision).toBe(false);
    expect(parsed.parseReport[0].reasons.join(' ')).toContain('quota exhausted');
  });
});

describe('plain text and markdown', () => {
  it('passes markdown through as a single page', async () => {
    const parsed = await parseDocument({
      bytes: bytesOf('# Lease\n\nNo animals may be kept on the premises.'),
    });

    expect(parsed.pageCount).toBe(1);
    expect(parsed.markdown).toContain('# Lease');
  });

  it('normalizes the text on the way through', async () => {
    const withHiddenCharacter = `Pay${String.fromCodePoint(0x200b)} now`;

    const parsed = await parseDocument({ bytes: bytesOf(withHiddenCharacter) });

    expect(parsed.markdown).toBe('Pay now');
  });
});

describe('a file we cannot read', () => {
  it('refuses with a reason instead of producing an empty document', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    await expect(parseDocument({ bytes: png })).rejects.toThrow(/unsupported/i);
  });
});
