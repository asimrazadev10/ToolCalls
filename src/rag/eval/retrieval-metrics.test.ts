import { describe, expect, it } from "vitest";
import {
  normalizedDiscountedCumulativeGain,
  recallAtK,
  reciprocalRank,
} from "./retrieval-metrics";

/** Relevance as a plain boolean list, ordered by rank. */
const ranking = (...relevant: boolean[]) => relevant;

describe("recall@k", () => {
  it("is one when every relevant item appears within k", () => {
    expect(
      recallAtK({
        relevanceByRank: ranking(true, true, false),
        totalRelevant: 2,
        k: 3,
      }),
    ).toBe(1);
  });

  it("is the fraction found when only some appear within k", () => {
    expect(
      recallAtK({
        relevanceByRank: ranking(true, false, false),
        totalRelevant: 2,
        k: 3,
      }),
    ).toBeCloseTo(0.5, 10);
  });

  it("ignores relevant items ranked below k, which a user never sees", () => {
    // The whole point of measuring at k: an answer built from the top 3 does
    // not benefit from a perfect match at rank 40.
    expect(
      recallAtK({
        relevanceByRank: ranking(false, false, false, true),
        totalRelevant: 1,
        k: 3,
      }),
    ).toBe(0);
  });

  it("is zero when nothing relevant was retrieved", () => {
    expect(
      recallAtK({
        relevanceByRank: ranking(false, false),
        totalRelevant: 2,
        k: 2,
      }),
    ).toBe(0);
  });

  it("is zero, not undefined, when there is nothing relevant to find", () => {
    // A question whose answer is absent from the corpus has recall 0 by
    // definition. Returning NaN here would poison every average downstream.
    expect(
      recallAtK({ relevanceByRank: ranking(false), totalRelevant: 0, k: 5 }),
    ).toBe(0);
  });
});

describe("reciprocal rank", () => {
  it("is one when the first result is relevant", () => {
    expect(reciprocalRank(ranking(true, false))).toBe(1);
  });

  it("halves when the first relevant result is second", () => {
    expect(reciprocalRank(ranking(false, true))).toBeCloseTo(0.5, 10);
  });

  it("reads only the first relevant result, ignoring the rest", () => {
    expect(reciprocalRank(ranking(false, true, true))).toBeCloseTo(0.5, 10);
  });

  it("is zero when nothing relevant was retrieved", () => {
    expect(reciprocalRank(ranking(false, false))).toBe(0);
  });
});

describe("normalized discounted cumulative gain", () => {
  it("is one for a perfect ranking", () => {
    expect(
      normalizedDiscountedCumulativeGain({
        relevanceByRank: ranking(true, true, false),
        totalRelevant: 2,
        k: 3,
      }),
    ).toBeCloseTo(1, 10);
  });

  it("falls when a relevant result is pushed down", () => {
    const perfect = normalizedDiscountedCumulativeGain({
      relevanceByRank: ranking(true, false),
      totalRelevant: 1,
      k: 2,
    });
    const demoted = normalizedDiscountedCumulativeGain({
      relevanceByRank: ranking(false, true),
      totalRelevant: 1,
      k: 2,
    });

    expect(demoted).toBeLessThan(perfect);
    expect(demoted).toBeGreaterThan(0);
  });

  it("matches the value computed by hand", () => {
    // One relevant result at rank 2, one relevant result in total.
    //   DCG  = 1 / log2(3) = 0.63093
    //   IDCG = 1 / log2(2) = 1
    expect(
      normalizedDiscountedCumulativeGain({
        relevanceByRank: ranking(false, true),
        totalRelevant: 1,
        k: 3,
      }),
    ).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it("distinguishes rankings that recall@k cannot tell apart", () => {
    // This is why nDCG is measured at all: both rankings find the same items
    // within k, so recall is identical, but one puts them where a reader looks.
    const relevantCount = 2;
    const topHeavy = ranking(true, true, false, false);
    const bottomHeavy = ranking(false, false, true, true);

    expect(
      recallAtK({
        relevanceByRank: topHeavy,
        totalRelevant: relevantCount,
        k: 4,
      }),
    ).toBe(
      recallAtK({
        relevanceByRank: bottomHeavy,
        totalRelevant: relevantCount,
        k: 4,
      }),
    );
    expect(
      normalizedDiscountedCumulativeGain({
        relevanceByRank: topHeavy,
        totalRelevant: relevantCount,
        k: 4,
      }),
    ).toBeGreaterThan(
      normalizedDiscountedCumulativeGain({
        relevanceByRank: bottomHeavy,
        totalRelevant: relevantCount,
        k: 4,
      }),
    );
  });

  it("is zero, not undefined, when there is nothing relevant to find", () => {
    expect(
      normalizedDiscountedCumulativeGain({
        relevanceByRank: ranking(false),
        totalRelevant: 0,
        k: 3,
      }),
    ).toBe(0);
  });
});
