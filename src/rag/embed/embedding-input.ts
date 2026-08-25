/**
 * Builds the text that is actually embedded for a chunk.
 *
 * The breadcrumb earns its place by making chunks *distinguishable*, not by
 * making any one of them score higher. Measured against the live model:
 *
 *   Three chunks of identical boilerplate — "the tenant shall obtain the prior
 *   written consent of the landlord" — sitting under Pets, Subletting and
 *   Alterations. Asked "do I need permission to sublet the flat?":
 *
 *     without breadcrumb   all three score 0.7095, exactly. The winner is
 *                          whichever happened to sort first, so the answer
 *                          cites the wrong section two times in three.
 *     with breadcrumb      Subletting 0.6800, Alterations 0.6054, Pets 0.5943.
 *                          Correct, with a 0.0857 spread behind it.
 *
 * Absolute similarity falls, which looks like a loss and is not: a uniform
 * drop across every chunk changes no ranking at all, and ranking is the only
 * thing retrieval reads. Repeated boilerplate under different headings is
 * ordinary in contracts, policies and manuals, and it is precisely where a
 * chunk's own words cannot identify it.
 *
 * The chunk's content is reproduced verbatim. What is stored and what is
 * embedded have to agree, or a citation points at text that differs from what
 * matched.
 */

export interface ChunkToEmbed {
  headingPath: string[];
  content: string;
  /** Written in a later phase; absent until then. */
  contextBlurb?: string | null;
}

/** Reads as a trail rather than a sentence, which is how a reader scans it too. */
const BREADCRUMB_SEPARATOR = ' > ';

export function composeEmbeddingInput(chunk: ChunkToEmbed): string {
  const parts: string[] = [];

  if (chunk.headingPath.length > 0) {
    parts.push(chunk.headingPath.join(BREADCRUMB_SEPARATOR));
  }

  const blurb = chunk.contextBlurb?.trim();
  if (blurb) parts.push(blurb);

  parts.push(chunk.content);

  return parts.join('\n\n');
}
