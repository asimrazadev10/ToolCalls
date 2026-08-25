import { describe, expect, it } from 'vitest';
import { reorderByRankedIds } from './reorder-by-ranked-ids';

const passages = (...ids: string[]) => ids.map((id) => ({ chunkId: id }));
const idsOf = (result: { chunkId: string }[]) => result.map((entry) => entry.chunkId);

describe('applying a new order', () => {
  it('puts passages in the order the reranker asked for', () => {
    const result = reorderByRankedIds(passages('a', 'b', 'c'), ['c', 'a', 'b']);

    expect(idsOf(result)).toEqual(['c', 'a', 'b']);
  });

  it('leaves the order untouched when the reranker returns nothing', () => {
    // A reranker that fails should cost latency, never results.
    const result = reorderByRankedIds(passages('a', 'b', 'c'), []);

    expect(idsOf(result)).toEqual(['a', 'b', 'c']);
  });
});

describe('the reranker is not trusted with the result set', () => {
  it('ignores an id that was never a candidate', () => {
    // The same discipline as citations: a model asked to return ids will
    // sometimes return one that does not exist.
    const result = reorderByRankedIds(passages('a', 'b'), ['b', 'invented', 'a']);

    expect(idsOf(result)).toEqual(['b', 'a']);
  });

  it('keeps a candidate the reranker forgot, after the ones it ranked', () => {
    // Dropping it would let a model silently delete evidence by omission.
    const result = reorderByRankedIds(passages('a', 'b', 'c'), ['c']);

    expect(idsOf(result)).toEqual(['c', 'a', 'b']);
  });

  it('preserves the original order among the forgotten ones', () => {
    const result = reorderByRankedIds(passages('a', 'b', 'c', 'd'), ['d']);

    expect(idsOf(result)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('counts a repeated id only once', () => {
    const result = reorderByRankedIds(passages('a', 'b'), ['b', 'b', 'a']);

    expect(idsOf(result)).toEqual(['b', 'a']);
  });
});

describe('the property that makes it safe to enable', () => {
  it('always returns a permutation of what it was given', () => {
    const given = passages('a', 'b', 'c', 'd', 'e');
    const nonsense = ['e', 'ghost', 'e', 'b', 'another-ghost'];

    const result = reorderByRankedIds(given, nonsense);

    expect(result).toHaveLength(given.length);
    expect(idsOf(result).sort()).toEqual(idsOf(given).sort());
  });

  it('carries the whole passage through, not just its id', () => {
    const given = [
      { chunkId: 'a', content: 'first', fusionScore: 0.01 },
      { chunkId: 'b', content: 'second', fusionScore: 0.02 },
    ];

    const result = reorderByRankedIds(given, ['b', 'a']);

    expect(result[0]).toEqual({ chunkId: 'b', content: 'second', fusionScore: 0.02 });
  });
});
