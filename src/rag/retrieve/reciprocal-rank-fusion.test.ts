import { describe, expect, it } from 'vitest';
import { RECIPROCAL_RANK_FUSION_K } from '../config';
import { fuseByReciprocalRank } from './reciprocal-rank-fusion';

const idsOf = (results: { id: string }[]) => results.map((result) => result.id);

describe('combining two arms', () => {
  it('ranks an item found by both arms above one found first by a single arm', () => {
    const dense = ['agreed', 'dense-only'];
    const fullText = ['fullText-only', 'agreed'];

    const fused = fuseByReciprocalRank([dense, fullText]);

    expect(fused[0].id).toBe('agreed');
  });

  it('keeps an item found by only one arm, because the arms find different things', () => {
    // Dense retrieval finds paraphrases; full text finds exact tokens like a
    // clause number. Dropping single-arm hits discards half the point.
    const fused = fuseByReciprocalRank([['dense-only'], ['fullText-only']]);

    expect(idsOf(fused).sort()).toEqual(['dense-only', 'fullText-only']);
  });

  it('returns results in descending score', () => {
    const fused = fuseByReciprocalRank([
      ['first', 'second', 'third'],
      ['first', 'second', 'third'],
    ]);

    expect(idsOf(fused)).toEqual(['first', 'second', 'third']);
    expect(fused[0].score).toBeGreaterThan(fused[1].score);
  });
});

describe('the score', () => {
  it('sums one over k plus rank, with ranks counted from one', () => {
    const k = RECIPROCAL_RANK_FUSION_K;

    const fused = fuseByReciprocalRank([['a'], ['a']]);

    expect(fused[0].score).toBeCloseTo(1 / (k + 1) + 1 / (k + 1), 10);
  });

  it('reports the rank an item held in each arm, and null where it was absent', () => {
    const fused = fuseByReciprocalRank([['a', 'b'], ['b']]);
    const b = fused.find((result) => result.id === 'b');
    const a = fused.find((result) => result.id === 'a');

    expect(b?.ranks).toEqual([2, 1]);
    expect(a?.ranks).toEqual([1, null]);
  });
});

describe('the property that makes this the right choice', () => {
  it('depends only on order, so rescaling one arm changes nothing', () => {
    // Cosine similarity and ts_rank_cd occupy incomparable scales. Any blend of
    // raw scores needs normalization tuned per corpus, and drifts when the
    // corpus changes. Rank fusion has nothing to tune.
    const denseOrder = ['x', 'y', 'z'];
    const fullTextOrder = ['z', 'x', 'y'];

    const first = fuseByReciprocalRank([denseOrder, fullTextOrder]);
    // Same order, arrived at from wildly different underlying scores.
    const second = fuseByReciprocalRank([[...denseOrder], [...fullTextOrder]]);

    expect(first).toEqual(second);
  });

  it('gives the same answer twice for the same query, breaking ties by id', () => {
    // Two ids at identical scores must not swap places between runs, or the
    // same question returns different citations on a refresh.
    const fused = fuseByReciprocalRank([['b', 'a'], ['a', 'b']]);

    expect(idsOf(fused)).toEqual(['a', 'b']);
  });
});

describe('boundaries', () => {
  it('caps the result count when a limit is given', () => {
    const fused = fuseByReciprocalRank([['a', 'b', 'c', 'd']], { limit: 2 });

    expect(fused).toHaveLength(2);
  });

  it('returns nothing for no arms', () => {
    expect(fuseByReciprocalRank([])).toEqual([]);
  });

  it('returns nothing when every arm is empty', () => {
    expect(fuseByReciprocalRank([[], []])).toEqual([]);
  });

  it('ignores a duplicate id within one arm rather than double-counting it', () => {
    const fused = fuseByReciprocalRank([['a', 'a', 'b']]);
    const a = fused.find((result) => result.id === 'a');

    expect(fused).toHaveLength(2);
    expect(a?.ranks).toEqual([1]);
  });
});
