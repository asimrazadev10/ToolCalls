/**
 * Applies a reranker's ordering to the passages it was given.
 *
 * The reranker is never trusted with the result set itself, only with the
 * order of it. A model asked to return ids will sometimes return one that does
 * not exist, and will sometimes forget one it was given — and forgetting is
 * the more dangerous of the two, because it deletes evidence silently, with
 * nothing in the output to show a passage went missing.
 *
 * So the result is always a permutation of the input: unknown ids are dropped,
 * forgotten passages are appended in their original order, and repeats count
 * once. Enabling a reranker can therefore cost latency and can reorder badly,
 * but it cannot lose a citation. That is what makes it safe to A/B on live
 * traffic rather than only in an evaluation.
 */

export function reorderByRankedIds<Passage extends { chunkId: string }>(
  passages: Passage[],
  rankedIds: string[],
): Passage[] {
  const byId = new Map(passages.map((passage) => [passage.chunkId, passage]));

  const reordered: Passage[] = [];
  const placed = new Set<string>();

  for (const id of rankedIds) {
    const passage = byId.get(id);
    if (!passage || placed.has(id)) continue;
    reordered.push(passage);
    placed.add(id);
  }

  // Whatever the reranker did not mention keeps its original relative order.
  for (const passage of passages) {
    if (!placed.has(passage.chunkId)) reordered.push(passage);
  }

  return reordered;
}
