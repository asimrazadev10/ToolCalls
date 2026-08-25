/**
 * Retrieval quality, measured.
 *
 * Three metrics rather than one, because each is blind to something the others
 * see. Recall says whether the right passage was found at all; reciprocal rank
 * says how far a reader must look to reach it; nDCG distinguishes two rankings
 * that recall scores identically but a reader would not.
 *
 * All take relevance as a boolean per rank, so how relevance was decided —
 * matching content, a human judgement, an id — stays out of the arithmetic.
 *
 * Arguments arrive named rather than positional. `totalRelevant` and `k` are
 * both counts, and adjacent numeric parameters are transposable in a way the
 * type checker cannot catch: writing this module positionally produced two
 * wrong call sites in its own test file on the first attempt.
 *
 * Every metric returns 0 rather than NaN when there is nothing relevant to
 * find. A question whose answer is genuinely absent has recall 0 by
 * definition, and a NaN would poison every average computed from it.
 */

export interface RankedRelevance {
  /** Whether the passage at each rank was relevant, best rank first. */
  relevanceByRank: boolean[];
  /** How many relevant passages exist in the corpus for this question. */
  totalRelevant: number;
  /** How far down the ranking to score. */
  k: number;
}

/** Share of all relevant passages that appear in the top k. */
export function recallAtK({
  relevanceByRank,
  totalRelevant,
  k,
}: RankedRelevance): number {
  if (totalRelevant <= 0) return 0;

  const foundWithinK = relevanceByRank.slice(0, k).filter(Boolean).length;
  return foundWithinK / totalRelevant;
}

/**
 * One over the rank of the first relevant passage. Answers "how far down did
 * the reader have to look", which recall cannot express.
 */
export function reciprocalRank(relevanceByRank: boolean[]): number {
  const firstRelevant = relevanceByRank.indexOf(true);
  return firstRelevant === -1 ? 0 : 1 / (firstRelevant + 1);
}

function discountedCumulativeGain(
  relevanceByRank: boolean[],
  k: number,
): number {
  return relevanceByRank
    .slice(0, k)
    .reduce(
      (total, isRelevant, index) =>
        isRelevant ? total + 1 / Math.log2(index + 2) : total,
      0,
    );
}

/**
 * Discounted gain against the best achievable ordering. Binary relevance, so
 * the ideal ranking is simply every relevant passage first.
 */
export function normalizedDiscountedCumulativeGain({
  relevanceByRank,
  totalRelevant,
  k,
}: RankedRelevance): number {
  if (totalRelevant <= 0) return 0;

  const ideal = discountedCumulativeGain(
    new Array<boolean>(Math.min(totalRelevant, k)).fill(true),
    k,
  );
  if (ideal === 0) return 0;

  return discountedCumulativeGain(relevanceByRank, k) / ideal;
}
