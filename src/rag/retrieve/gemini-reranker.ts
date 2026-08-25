/**
 * Reorders retrieved passages by asking a model which actually answer the
 * question.
 *
 * Listwise rather than pointwise: every candidate goes in one prompt and the
 * model returns an order. Scoring each passage separately would be more
 * precise and would cost one call per passage, which a fifteen-requests-a-
 * minute budget cannot survive on a single query.
 *
 * A reranker is an improvement, never a dependency. If the model errors, times
 * out or answers in prose, this returns no ordering at all and the fused
 * ranking underneath stands — which was already a good answer. Retrieval must
 * not acquire a new way to fail in exchange for a better average.
 */

export interface PassageToRank {
  id: string;
  text: string;
}

export interface RerankRequest {
  question: string;
  passages: PassageToRank[];
  signal?: AbortSignal;
}

/** Ids, most relevant first. Empty means "keep the order you had". */
export type PassageReranker = (request: RerankRequest) => Promise<string[]>;

export type RerankGenerator = (prompt: {
  system: string;
  user: string;
  signal?: AbortSignal;
}) => Promise<string>;

/** Enough of each passage to judge relevance without paying for all of it. */
const CHARACTERS_SHOWN_PER_PASSAGE = 600;

const SYSTEM_PROMPT = `You order passages by how well they answer a question.

You will be given a question and several passages, each with an id. Return the
ids ordered from most useful to least useful for answering that question.

Rules:
- Return every id you were given, exactly once.
- Judge only whether a passage helps answer the question. Do not answer it.
- Reply with a JSON array of ids and nothing else: ["id1","id2",...]`;

/**
 * Models fence JSON, wrap it in an object, or answer in prose despite the
 * instruction. Anything unreadable yields an empty order, which the caller
 * treats as "leave the ranking alone".
 */
export function parseRankedOrder(reply: string): string[] {
  const withoutFence = reply
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();

  if (withoutFence.length === 0) return [];

  try {
    const parsed: unknown = JSON.parse(withoutFence);
    const list = Array.isArray(parsed)
      ? parsed
      : ((parsed as { ranking?: unknown }).ranking ?? null);

    if (!Array.isArray(list)) return [];
    return list.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export function createGeminiPassageReranker(options: {
  generate: RerankGenerator;
}): PassageReranker {
  return async ({ question, passages, signal }) => {
    // One passage has only one possible order, and none has none. Neither is
    // worth a request against a budget this tight.
    if (passages.length <= 1) return passages.map((passage) => passage.id);

    const user = [
      ...passages.map((passage) =>
        [`[${passage.id}]`, passage.text.slice(0, CHARACTERS_SHOWN_PER_PASSAGE)].join('\n'),
      ),
      '',
      `Question: ${question}`,
    ].join('\n\n');

    try {
      return parseRankedOrder(await options.generate({ system: SYSTEM_PROMPT, user, signal }));
    } catch {
      return [];
    }
  };
}
