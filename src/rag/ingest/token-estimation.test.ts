import { describe, expect, it } from 'vitest';
import { estimateTokenCount } from './token-estimation';

describe('boundaries', () => {
  it('counts nothing in an empty string', () => {
    expect(estimateTokenCount('')).toBe(0);
  });

  it('counts nothing in whitespace alone', () => {
    expect(estimateTokenCount('   \n\t  ')).toBe(0);
  });
});

describe('growth', () => {
  it('never shrinks as text is added', () => {
    const short = estimateTokenCount('The tenant shall not keep any animal.');
    const longer = estimateTokenCount(
      'The tenant shall not keep any animal on the premises without written consent.',
    );

    expect(longer).toBeGreaterThan(short);
  });
});

describe('calibration against real tokenizer behaviour', () => {
  it('estimates English prose at roughly four tokens per three words', () => {
    // 24 words. Subword tokenizers land near 30 tokens on prose of this kind.
    const twentyFourWords =
      'The tenant shall not keep any animal on the premises without the prior written ' +
      'consent of the landlord which consent may be withheld entirely';

    const estimate = estimateTokenCount(twentyFourWords);

    expect(estimate).toBeGreaterThanOrEqual(24);
    expect(estimate).toBeLessThanOrEqual(40);
  });

  it('estimates CJK at roughly one token per character, not per word', () => {
    // Eight characters, no spaces — a word-only count would call this 1.
    const eightCharacters = '租户不得饲养动物';

    const estimate = estimateTokenCount(eightCharacters);

    expect(estimate).toBeGreaterThanOrEqual(6);
    expect(estimate).toBeLessThanOrEqual(12);
  });
});

describe('the shape of the answer', () => {
  it('is a whole number, because a fraction of a token cannot be budgeted', () => {
    expect(Number.isInteger(estimateTokenCount('some ordinary words here'))).toBe(true);
  });
});
