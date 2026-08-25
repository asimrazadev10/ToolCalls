/**
 * Cleans text pulled out of an uploaded document.
 *
 * Two of these rules are security rules rather than tidiness. Zero-width
 * characters render as nothing and are a documented way to hide instructions
 * inside a document that looks innocent to whoever uploaded it; control
 * characters corrupt tokenization, so a chunk containing them can embed to
 * something quite unlike what a reader sees. Both are removed before the text
 * reaches a model or an index.
 *
 * Characters are classified by code point rather than matched by a regular
 * expression. A pattern that removes invisible characters must itself contain
 * them, and source code carrying invisible characters is the same hazard this
 * module exists to remove.
 */

const TAB = 0x09;
const NEWLINE = 0x0a;

/** Zero-width space, non-joiner, joiner, and the byte-order mark. */
function isZeroWidth(codePoint: number): boolean {
  return (codePoint >= 0x200b && codePoint <= 0x200d) || codePoint === 0xfeff;
}

/** C0 and C1 control characters, less the tab and newline that carry structure. */
function isControlCharacterWorthDropping(codePoint: number): boolean {
  if (codePoint === TAB || codePoint === NEWLINE) return false;
  return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
}

/**
 * Spaces a reader cannot tell from an ordinary one: non-breaking, the en/em
 * quad family, narrow and medium mathematical spaces, and the ideographic
 * space. Left as-is they tokenize differently from the space in a question.
 */
function isSpaceInDisguise(codePoint: number): boolean {
  return (
    codePoint === 0x00a0 ||
    (codePoint >= 0x2000 && codePoint <= 0x200a) ||
    codePoint === 0x202f ||
    codePoint === 0x205f ||
    codePoint === 0x3000
  );
}

const TRAILING_WHITESPACE_PER_LINE = /[ \t]+$/gm;
const THREE_OR_MORE_NEWLINES = /\n{3,}/g;

export function normalizeExtractedText(rawText: string): string {
  let cleaned = '';

  // Iterating the string yields whole code points, so characters outside the
  // basic plane are never split into surrogate halves.
  for (const character of rawText.normalize('NFC')) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) continue;
    if (isZeroWidth(codePoint) || isControlCharacterWorthDropping(codePoint)) continue;
    cleaned += isSpaceInDisguise(codePoint) ? ' ' : character;
  }

  return cleaned
    .replace(TRAILING_WHITESPACE_PER_LINE, '')
    .replace(THREE_OR_MORE_NEWLINES, '\n\n')
    .trim();
}
