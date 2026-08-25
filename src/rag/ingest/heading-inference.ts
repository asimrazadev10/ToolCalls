/**
 * Recovers heading structure from typography.
 *
 * A PDF's text layer is flat: "Section 8 — Pets" arrives as characters, not as
 * a heading, so structure-aware chunking has nothing to work with and falls
 * back to packing by length. But the structure is still visible — it is
 * carried in the type size, which is how a reader recognizes it too. A line
 * materially larger than the body is a heading, and the ranking of distinct
 * heading sizes gives the level.
 *
 * Deliberately pure and free of any PDF library: it takes a measured line and
 * nothing more, so every rule below is testable without a PDF in the loop.
 */

export interface MeasuredLine {
  text: string;
  fontSizeInPoints: number;
}

export interface HeadingScale {
  bodyFontSizeInPoints: number;
  /** Only sizes that qualify as headings. Largest size is level 1. */
  levelByFontSize: Map<number, number>;
}

/**
 * How much larger than the body a line must be to count as structure. Below
 * this it is emphasis — a bolded lead-in, a slightly larger caption — and
 * promoting it invents a section that the author never wrote.
 */
const HEADING_SIZE_RATIO = 1.15;

/**
 * Markdown offers six levels; distinct heading sizes beyond that collapse into
 * the last one rather than being discarded.
 */
const DEEPEST_HEADING_LEVEL = 6;

/**
 * A heading is short. Large type running to paragraph length is a pull quote,
 * or a large-print document, and calling it a section title invents structure.
 */
const LONGEST_PLAUSIBLE_HEADING_IN_CHARACTERS = 120;

/** Page numbers and folios are set apart, sometimes large. They are not headings. */
const CONTAINS_A_LETTER = /\p{Letter}/u;

function isPlausibleHeadingText(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= LONGEST_PLAUSIBLE_HEADING_IN_CHARACTERS &&
    CONTAINS_A_LETTER.test(trimmed)
  );
}

/**
 * The body size is the size covering the most characters — not the size on the
 * most lines. A document with many short headings and few long paragraphs has
 * more heading *lines* than body lines while still being mostly body, and
 * counting lines would call the headings body and find no structure at all.
 */
function measureBodyFontSize(lines: MeasuredLine[]): number {
  const charactersByFontSize = new Map<number, number>();

  for (const line of lines) {
    const characters = line.text.trim().length;
    if (characters === 0) continue;
    charactersByFontSize.set(
      line.fontSizeInPoints,
      (charactersByFontSize.get(line.fontSizeInPoints) ?? 0) + characters,
    );
  }

  let bodyFontSize = 0;
  let mostCharacters = -1;

  for (const [fontSize, characters] of charactersByFontSize) {
    // Ties break toward the smaller size, the likelier body of the two.
    if (characters > mostCharacters || (characters === mostCharacters && fontSize < bodyFontSize)) {
      bodyFontSize = fontSize;
      mostCharacters = characters;
    }
  }

  return bodyFontSize;
}

export function measureHeadingScale(allLines: MeasuredLine[]): HeadingScale {
  const bodyFontSizeInPoints = measureBodyFontSize(allLines);
  const headingThreshold = bodyFontSizeInPoints * HEADING_SIZE_RATIO;

  const headingSizes = new Set<number>();
  for (const line of allLines) {
    if (line.fontSizeInPoints >= headingThreshold && isPlausibleHeadingText(line.text)) {
      headingSizes.add(line.fontSizeInPoints);
    }
  }

  const levelByFontSize = new Map<number, number>();
  [...headingSizes]
    .sort((larger, smaller) => smaller - larger)
    .forEach((fontSize, index) => {
      levelByFontSize.set(fontSize, Math.min(index + 1, DEEPEST_HEADING_LEVEL));
    });

  return { bodyFontSizeInPoints, levelByFontSize };
}

export function renderLinesAsMarkdown(lines: MeasuredLine[], scale: HeadingScale): string {
  const rendered: string[] = [];

  for (const line of lines) {
    const text = line.text.trim();
    if (text.length === 0) continue;

    const level = scale.levelByFontSize.get(line.fontSizeInPoints);
    if (level !== undefined && isPlausibleHeadingText(text)) {
      rendered.push(`${'#'.repeat(level)} ${text}`);
    } else {
      rendered.push(text);
    }
  }

  // Blank lines between blocks so the chunker's Markdown parser sees discrete
  // paragraphs rather than one run-on block.
  return rendered.join('\n\n');
}
