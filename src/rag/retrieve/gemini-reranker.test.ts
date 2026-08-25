import { describe, expect, it, vi } from 'vitest';
import { createGeminiPassageReranker, parseRankedOrder } from './gemini-reranker';

const passage = (id: string, text: string) => ({ id, text });

describe('reading the model back', () => {
  it('accepts a plain list of ids', () => {
    expect(parseRankedOrder('["c","a","b"]')).toEqual(['c', 'a', 'b']);
  });

  it('accepts a fenced list, which models emit even when told not to', () => {
    expect(parseRankedOrder('```json\n["b","a"]\n```')).toEqual(['b', 'a']);
  });

  it('accepts an object with a ranking field', () => {
    expect(parseRankedOrder('{"ranking":["b","a"]}')).toEqual(['b', 'a']);
  });

  it('ignores entries that are not strings', () => {
    expect(parseRankedOrder('["a",7,null,"b"]')).toEqual(['a', 'b']);
  });

  it('returns nothing for a reply it cannot read', () => {
    // Nothing means "keep the original order", which is the safe outcome.
    expect(parseRankedOrder('I think passage b is best, actually.')).toEqual([]);
  });

  it('returns nothing for an empty reply', () => {
    expect(parseRankedOrder('')).toEqual([]);
  });
});

describe('the request', () => {
  const stub = (reply: string) => {
    const generate = vi.fn(async (_prompt: { system: string; user: string }) => reply);
    return { generate, reranker: createGeminiPassageReranker({ generate }) };
  };

  it('returns the order the model chose', async () => {
    const { reranker } = stub('["b","a"]');

    const order = await reranker({
      question: 'what are the quiet hours?',
      passages: [passage('a', 'Pets are not allowed.'), passage('b', 'Quiet hours are 10pm.')],
    });

    expect(order).toEqual(['b', 'a']);
  });

  it('shows the model every candidate, labelled by the id it must return', async () => {
    const { generate, reranker } = stub('["a"]');

    await reranker({
      question: 'q',
      passages: [passage('a', 'first passage'), passage('b', 'second passage')],
    });

    const { user } = generate.mock.calls[0][0];
    expect(user).toContain('a');
    expect(user).toContain('first passage');
    expect(user).toContain('second passage');
  });

  it('makes no call for a single passage, which cannot be reordered', async () => {
    const { generate, reranker } = stub('["a"]');

    const order = await reranker({ question: 'q', passages: [passage('a', 'only one')] });

    expect(order).toEqual(['a']);
    expect(generate).not.toHaveBeenCalled();
  });

  it('makes no call for no passages', async () => {
    const { generate, reranker } = stub('[]');

    expect(await reranker({ question: 'q', passages: [] })).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('when the reranker fails', () => {
  it('yields no ordering rather than throwing, so retrieval still answers', async () => {
    // A reranker is an improvement, not a dependency. If it breaks, the fused
    // ranking underneath it is still a perfectly good answer.
    const generate = vi.fn(async () => {
      throw new Error('quota exhausted');
    });
    const reranker = createGeminiPassageReranker({ generate });

    const order = await reranker({
      question: 'q',
      passages: [passage('a', 'one'), passage('b', 'two')],
    });

    expect(order).toEqual([]);
  });
});
