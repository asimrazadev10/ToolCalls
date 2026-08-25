/**
 * Approximates how many tokens a piece of text will cost.
 *
 * Named an estimate because it is one. Exact counts are model-specific and
 * Gemini only reports them over the network, which would mean one HTTP call
 * per chunk during ingestion — far more expensive than the sizing decision it
 * would inform. What chunk sizing actually needs is consistency, not accuracy:
 * chunks of roughly equal cost, with a bound that never wildly under-counts.
 *
 * If an exact count is ever needed at a decision point that justifies the
 * latency, Gemini's countTokens endpoint is the answer — not a better guess
 * here.
 */

/**
 * Scripts written without spaces, where a subword tokenizer emits close to one
 * token per character: CJK ideographs, kana, and Hangul. Counting these by
 * word would score an entire sentence as a single token.
 */
const CHARACTER_PER_TOKEN_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * Space-separated words average slightly more than one token each, because
 * tokenizers split longer and rarer words into pieces. Four tokens per three
 * words is the usual rule of thumb for English prose.
 */
const TOKENS_PER_SPACE_SEPARATED_WORD = 4 / 3;

export function estimateTokenCount(text: string): number {
  let charactersInDenseScripts = 0;
  let remainingText = '';

  for (const character of text) {
    if (CHARACTER_PER_TOKEN_SCRIPT.test(character)) {
      charactersInDenseScripts += 1;
    } else {
      remainingText += character;
    }
  }

  const words = remainingText.split(/\s+/).filter((word) => word.length > 0);

  return Math.ceil(charactersInDenseScripts + words.length * TOKENS_PER_SPACE_SEPARATED_WORD);
}
