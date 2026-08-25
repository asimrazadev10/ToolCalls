/**
 * Merges the two retrieval arms into one ranking.
 *
 * Dense search finds paraphrases; full-text search finds exact tokens — a
 * clause number, a surname, "PM2.5". Neither alone is enough, so both run and
 * their results have to be combined.
 *
 * The combination reads ranks and never scores. Cosine similarity and
 * `ts_rank_cd` occupy incomparable scales, so any weighted blend of raw scores
 * needs a normalization tuned to one corpus, which then misbehaves on the
 * next. Rank fusion has nothing to tune and nothing to drift: an arm that
 * separates its top results by 0.001 contributes exactly as much as one that
 * separates them by 40.
 *
 * The constant damps the advantage of a first place. Without it a single arm's
 * top hit would beat anything two arms agreed on slightly lower down, which is
 * the opposite of what running two arms is for.
 */

import { RECIPROCAL_RANK_FUSION_K } from '../config';

export interface FusedResult {
  id: string;
  score: number;
  /** Rank held in each arm, in the order the arms were given. Null where absent. */
  ranks: (number | null)[];
}

export interface FusionOptions {
  k?: number;
  limit?: number;
}

export function fuseByReciprocalRank(
  rankings: string[][],
  options: FusionOptions = {},
): FusedResult[] {
  const k = options.k ?? RECIPROCAL_RANK_FUSION_K;

  const scoreById = new Map<string, number>();
  const ranksById = new Map<string, (number | null)[]>();

  const ranksForId = (id: string) => {
    let ranks = ranksById.get(id);
    if (!ranks) {
      ranks = new Array<number | null>(rankings.length).fill(null);
      ranksById.set(id, ranks);
    }
    return ranks;
  };

  rankings.forEach((ranking, armIndex) => {
    const alreadySeenInThisArm = new Set<string>();

    ranking.forEach((id, position) => {
      // An arm listing the same chunk twice must not count twice; only its best
      // position in that arm is meaningful.
      if (alreadySeenInThisArm.has(id)) return;
      alreadySeenInThisArm.add(id);

      const rank = position + 1;
      scoreById.set(id, (scoreById.get(id) ?? 0) + 1 / (k + rank));
      ranksForId(id)[armIndex] = rank;
    });
  });

  const fused: FusedResult[] = [...scoreById].map(([id, score]) => ({
    id,
    score,
    ranks: ranksForId(id),
  }));

  // Ties break by id so the same question returns the same citations twice.
  // Without it, insertion order decides, and a refresh can reorder the answer.
  fused.sort((first, second) =>
    second.score === first.score ? first.id.localeCompare(second.id) : second.score - first.score,
  );

  return options.limit === undefined ? fused : fused.slice(0, options.limit);
}
