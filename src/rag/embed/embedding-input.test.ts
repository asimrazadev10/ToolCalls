import { describe, expect, it } from 'vitest';
import { composeEmbeddingInput } from './embedding-input';

describe('the breadcrumb', () => {
  it('prepends the heading path, so a clause carries the section it sits under', () => {
    // "Does not apply to assistance dogs" embeds poorly against "can I keep a
    // guide dog?" until it carries the word Pets from its heading.
    const composed = composeEmbeddingInput({
      headingPath: ['Residential Lease', 'Section 8 - Pets'],
      content: 'This clause does not apply to registered assistance dogs.',
    });

    expect(composed).toContain('Residential Lease');
    expect(composed).toContain('Section 8 - Pets');
    expect(composed).toContain('assistance dogs');
  });

  it('places the breadcrumb before the content, not after', () => {
    const composed = composeEmbeddingInput({
      headingPath: ['Pets'],
      content: 'No animals permitted.',
    });

    expect(composed.indexOf('Pets')).toBeLessThan(composed.indexOf('No animals'));
  });

  it('yields the content alone when there is no heading path', () => {
    const composed = composeEmbeddingInput({ headingPath: [], content: 'Preamble text.' });

    expect(composed).toBe('Preamble text.');
  });
});

describe('the context blurb', () => {
  it('is included when present', () => {
    const composed = composeEmbeddingInput({
      headingPath: ['Pets'],
      content: 'No animals permitted.',
      contextBlurb: 'From a residential lease between Acme Ltd and the tenant.',
    });

    expect(composed).toContain('From a residential lease');
  });

  it('is omitted when absent, leaving no empty line behind', () => {
    const withoutBlurb = composeEmbeddingInput({
      headingPath: ['Pets'],
      content: 'No animals permitted.',
      contextBlurb: null,
    });

    expect(withoutBlurb).not.toMatch(/\n\n\n/);
    expect(withoutBlurb.trim()).toBe(withoutBlurb);
  });
});

describe('the content itself', () => {
  it('is never altered, because the stored chunk and the embedded text must agree', () => {
    const content = 'Rent is 1,200 per calendar month.   Payable in advance.';

    const composed = composeEmbeddingInput({ headingPath: ['Rent'], content });

    expect(composed).toContain(content);
  });

  it('composes the same string twice for the same input', () => {
    const chunk = { headingPath: ['A', 'B'], content: 'body' };

    expect(composeEmbeddingInput(chunk)).toBe(composeEmbeddingInput(chunk));
  });
});
