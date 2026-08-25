import { describe, expect, it } from 'vitest';
import { chunkMarkdownDocument } from './chunker';

const CODE_FENCE = '```';

/** Roomy enough that structure, not length, decides the boundaries. */
const ROOMY = { targetTokens: 500 };

describe('documents with nothing to chunk', () => {
  it('produces no chunks for an empty document', () => {
    expect(chunkMarkdownDocument('')).toEqual([]);
  });

  it('produces no chunks for whitespace alone', () => {
    expect(chunkMarkdownDocument('   \n\n\t  \n')).toEqual([]);
  });

  it('produces no chunks for a heading with no content beneath it', () => {
    expect(chunkMarkdownDocument('# Lease Agreement\n')).toEqual([]);
  });
});

describe('heading path', () => {
  const document = [
    '# Lease Agreement',
    'This agreement is made between the parties named below.',
    '## Section 8 - Pets',
    'No animals may be kept on the premises.',
    '### 8.1 Exceptions',
    'Registered assistance dogs are permitted.',
    '## Section 9 - Noise',
    'Quiet hours run from 10pm to 7am.',
  ].join('\n\n');

  it('carries the enclosing headings, outermost first', () => {
    const chunks = chunkMarkdownDocument(document, ROOMY);

    expect(chunks[1].headingPath).toEqual(['Lease Agreement', 'Section 8 - Pets']);
  });

  it('nests a deeper heading beneath its parent', () => {
    const chunks = chunkMarkdownDocument(document, ROOMY);

    expect(chunks[2].headingPath).toEqual([
      'Lease Agreement',
      'Section 8 - Pets',
      '8.1 Exceptions',
    ]);
  });

  it('drops levels deeper than a new heading when the tree steps back out', () => {
    const chunks = chunkMarkdownDocument(document, ROOMY);

    // Section 9 is a sibling of Section 8, so 8.1 must not linger in its path.
    expect(chunks[3].headingPath).toEqual(['Lease Agreement', 'Section 9 - Noise']);
  });

  it('leaves the path empty for content above the first heading', () => {
    const chunks = chunkMarkdownDocument('Preamble text before any heading.', ROOMY);

    expect(chunks[0].headingPath).toEqual([]);
  });
});

describe('structure decides boundaries before length does', () => {
  it('keeps a section that fits in one chunk', () => {
    const chunks = chunkMarkdownDocument(
      '## Rent\n\nRent is due on the first of each month.',
      ROOMY,
    );

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('Rent is due');
  });

  it('starts a new chunk at a heading even when the previous one had room left', () => {
    const chunks = chunkMarkdownDocument('## One\n\nShort.\n\n## Two\n\nAlso short.', ROOMY);

    expect(chunks).toHaveLength(2);
  });
});

describe('a section too large for one chunk', () => {
  const longSection = [
    '## Obligations',
    Array.from(
      { length: 40 },
      (_, index) => `The tenant shall observe obligation number ${index} at all times.`,
    ).join(' '),
  ].join('\n\n');

  it('splits into several chunks', () => {
    const chunks = chunkMarkdownDocument(longSection, { targetTokens: 60 });

    expect(chunks.length).toBeGreaterThan(1);
  });

  it('never cuts a sentence in half', () => {
    const chunks = chunkMarkdownDocument(longSection, { targetTokens: 60 });

    for (const chunk of chunks) {
      expect(chunk.content.trimEnd().endsWith('.')).toBe(true);
    }
  });

  it('overlaps consecutive chunks so a boundary does not sever an argument', () => {
    const chunks = chunkMarkdownDocument(longSection, {
      targetTokens: 60,
      overlapRatio: 0.2,
    });

    const tailOfFirst = chunks[0].content.trimEnd().split(/(?<=\.)\s+/).at(-1)!;
    expect(chunks[1].content).toContain(tailOfFirst);
  });

  it('keeps every chunk within the same heading path', () => {
    const chunks = chunkMarkdownDocument(longSection, { targetTokens: 60 });

    for (const chunk of chunks) {
      expect(chunk.headingPath).toEqual(['Obligations']);
    }
  });
});

describe('overlap never crosses a heading', () => {
  it('does not carry text from one section into the next, because a heading is a semantic break', () => {
    const chunks = chunkMarkdownDocument(
      '## Pets\n\nNo animals are permitted here.\n\n## Noise\n\nQuiet hours apply.',
      { targetTokens: 500, overlapRatio: 0.5 },
    );

    expect(chunks[1].content).not.toContain('No animals');
  });
});

describe('tables', () => {
  const table = [
    '| Item     | Amount |',
    '| -------- | ------ |',
    '| Rent     | 1200   |',
    '| Deposit  | 2400   |',
    '| Cleaning | 150    |',
    '| Keys     | 40     |',
  ].join('\n');

  it('keeps a table that fits in a single chunk', () => {
    const chunks = chunkMarkdownDocument(`## Charges\n\n${table}`, ROOMY);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('| Cleaning | 150    |');
  });

  it('repeats the header on every part when a table must be split', () => {
    const chunks = chunkMarkdownDocument(`## Charges\n\n${table}`, { targetTokens: 22 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content).toContain('| Item     | Amount |');
      expect(chunk.content).toContain('| -------- | ------ |');
    }
  });

  it('places each data row in exactly one chunk, repeating only the header', () => {
    const chunks = chunkMarkdownDocument(`## Charges\n\n${table}`, { targetTokens: 22 });
    const everything = chunks.map((chunk) => chunk.content).join('\n');

    // The header is meant to repeat. A data row appearing twice means chunks
    // are accumulating rather than advancing.
    for (const row of ['Rent', 'Deposit', 'Cleaning', 'Keys']) {
      const occurrences = everything.split(row).length - 1;
      expect(occurrences, `row ${row} appeared ${occurrences} times`).toBe(1);
    }
  });

  it('loses no data rows when a table is split', () => {
    const chunks = chunkMarkdownDocument(`## Charges\n\n${table}`, { targetTokens: 22 });
    const everything = chunks.map((chunk) => chunk.content).join('\n');

    for (const row of ['Rent', 'Deposit', 'Cleaning', 'Keys']) {
      expect(everything).toContain(row);
    }
  });
});

describe('fenced code', () => {
  it('is not mistaken for a table just because it contains pipes', () => {
    const document = [
      '## Query',
      '',
      CODE_FENCE,
      'select a | b from t',
      'where c | d',
      CODE_FENCE,
    ].join('\n');

    const chunks = chunkMarkdownDocument(document, ROOMY);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain('select a | b from t');
    // A table reading would have injected a separator row.
    expect(chunks[0].content).not.toContain('| --- |');
  });
});

describe('the shape of the result', () => {
  it('numbers chunks sequentially from zero with no gaps', () => {
    const chunks = chunkMarkdownDocument(
      '## A\n\nFirst body.\n\n## B\n\nSecond body.\n\n## C\n\nThird body.',
      ROOMY,
    );

    expect(chunks.map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
  });

  it('reports an estimated token count for each chunk', () => {
    const chunks = chunkMarkdownDocument('## A\n\nSome body text here.', ROOMY);

    expect(chunks[0].estimatedTokenCount).toBeGreaterThan(0);
  });

  it('keeps every chunk near its budget rather than growing without bound', () => {
    const table = [
      '| Item     | Amount |',
      '| -------- | ------ |',
      ...Array.from({ length: 12 }, (_, index) => `| Row ${index}    | ${index}00    |`),
    ].join('\n');

    const chunks = chunkMarkdownDocument(`## Charges\n\n${table}`, { targetTokens: 22 });

    for (const chunk of chunks) {
      expect(
        chunk.estimatedTokenCount,
        `chunk ${chunk.ordinal} ran to ${chunk.estimatedTokenCount} tokens`,
      ).toBeLessThanOrEqual(44);
    }
  });

  it('never emits an empty chunk', () => {
    const chunks = chunkMarkdownDocument('## A\n\n\n\n## B\n\nOnly B has content.', ROOMY);

    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });
});
