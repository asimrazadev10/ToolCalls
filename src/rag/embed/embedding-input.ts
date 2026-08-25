/**
 * Builds the text that is actually embedded for a chunk.
 *
 * A chunk's own words are not the best representation of it. "This clause does
 * not apply to registered assistance dogs" embeds poorly against "can I keep a
 * guide dog?" until it carries the word *Pets* from the heading it sits under —
 * a word the clause itself never uses. Prepending the breadcrumb costs a few
 * tokens and recovers the context the page layout was carrying.
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
