/**
 * Splits a Markdown document into chunks for embedding.
 *
 * Structure decides the boundaries and length only caps them, which is the
 * whole point: a fixed-width window slices mid-argument and mid-table, and the
 * resulting chunk retrieves as a fragment that answers nothing. Splitting on
 * headings first means a chunk is a unit someone could have written on purpose.
 *
 * Three cases earn special handling because getting them wrong is silent:
 *
 *   - A table split without repeating its header leaves orphan rows whose
 *     columns no longer mean anything: "1200" with no "Amount" above it.
 *   - A fenced code block containing pipes reads as a table to a naive parser,
 *     which then mangles it into rows.
 *   - Overlap carried across a heading dilutes both sections, so it stops at
 *     every heading.
 */

import { CHUNK_OVERLAP_RATIO, CHUNK_TARGET_TOKENS } from '../config';
import { estimateTokenCount } from './token-estimation';

export interface DocumentChunk {
  ordinal: number;
  /** Enclosing headings, outermost first. Embedded alongside the content. */
  headingPath: string[];
  content: string;
  estimatedTokenCount: number;
}

export interface ChunkingOptions {
  targetTokens?: number;
  overlapRatio?: number;
}

const HEADING_LINE = /^(#{1,6})\s+(.*\S)\s*$/;
const CODE_FENCE_LINE = /^\s*(```|~~~)/;
const TABLE_ROW_LINE = /^\s*\|.*\|\s*$/;
const TABLE_SEPARATOR_LINE = /^\s*\|[\s:|-]+\|\s*$/;
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+/;

/** A run of lines that must not be split by the generic sentence splitter. */
type Block =
  | { kind: 'table'; headerLines: string[]; bodyLines: string[] }
  | { kind: 'code'; lines: string[] }
  | { kind: 'prose'; text: string };

interface Section {
  headingPath: string[];
  blocks: Block[];
}

/**
 * Splits the document into sections at every heading, and each section's body
 * into blocks. Fenced code is consumed whole before any other rule looks at
 * its contents, so pipes inside code never reach the table detector.
 */
function parseSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const sections: Section[] = [];

  let headingStack: string[] = [];
  let currentBlocks: Block[] = [];
  let proseLines: string[] = [];

  const flushProse = () => {
    const text = proseLines.join('\n').trim();
    if (text.length > 0) currentBlocks.push({ kind: 'prose', text });
    proseLines = [];
  };

  const flushSection = () => {
    flushProse();
    if (currentBlocks.length > 0) {
      sections.push({ headingPath: [...headingStack], blocks: currentBlocks });
    }
    currentBlocks = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (CODE_FENCE_LINE.test(line)) {
      flushProse();
      const fenced = [line];
      index += 1;
      while (index < lines.length) {
        fenced.push(lines[index]);
        if (CODE_FENCE_LINE.test(lines[index])) break;
        index += 1;
      }
      currentBlocks.push({ kind: 'code', lines: fenced });
      continue;
    }

    const heading = HEADING_LINE.exec(line);
    if (heading) {
      flushSection();
      const level = heading[1].length;
      headingStack = [...headingStack.slice(0, level - 1), heading[2]];
      continue;
    }

    // A table needs a header row followed by a separator row; a lone piped line
    // is just prose that happens to contain a pipe.
    if (
      TABLE_ROW_LINE.test(line) &&
      index + 1 < lines.length &&
      TABLE_SEPARATOR_LINE.test(lines[index + 1])
    ) {
      flushProse();
      const headerLines = [line, lines[index + 1]];
      const bodyLines: string[] = [];
      index += 2;
      while (index < lines.length && TABLE_ROW_LINE.test(lines[index])) {
        bodyLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      currentBlocks.push({ kind: 'table', headerLines, bodyLines });
      continue;
    }

    proseLines.push(line);
  }

  flushSection();
  return sections;
}

/** Renders a block back to Markdown. */
function renderBlock(block: Block): string {
  if (block.kind === 'prose') return block.text;
  if (block.kind === 'code') return block.lines.join('\n');
  return [...block.headerLines, ...block.bodyLines].join('\n');
}

/**
 * Breaks a block that cannot fit into pieces that can. Each kind splits along
 * its own grain: tables by row with the header repeated, code by line, prose by
 * sentence. A single piece may still exceed the budget when it is one enormous
 * sentence — emitting it whole beats cutting a sentence in half.
 */
function splitOversizedBlock(block: Block, targetTokens: number): string[] {
  if (block.kind === 'table') {
    const headerText = block.headerLines.join('\n');
    const headerTokens = estimateTokenCount(headerText);
    const pieces: string[] = [];
    let rows: string[] = [];
    let rowTokens = 0;

    for (const row of block.bodyLines) {
      const tokens = estimateTokenCount(row);
      if (rows.length > 0 && headerTokens + rowTokens + tokens > targetTokens) {
        pieces.push([headerText, ...rows].join('\n'));
        rows = [];
        rowTokens = 0;
      }
      rows.push(row);
      rowTokens += tokens;
    }

    if (rows.length > 0) pieces.push([headerText, ...rows].join('\n'));
    return pieces;
  }

  const units =
    block.kind === 'code' ? block.lines : renderBlock(block).split(SENTENCE_BOUNDARY);
  const joiner = block.kind === 'code' ? '\n' : ' ';

  const pieces: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const unit of units) {
    const tokens = estimateTokenCount(unit);
    if (current.length > 0 && currentTokens + tokens > targetTokens) {
      pieces.push(current.join(joiner));
      current = [];
      currentTokens = 0;
    }
    current.push(unit);
    currentTokens += tokens;
  }

  if (current.length > 0) pieces.push(current.join(joiner));
  return pieces;
}

/**
 * Returns the trailing whole sentences of a chunk, up to a token budget, to
 * seed the next chunk. Whole sentences only — an overlap starting mid-clause
 * reads as noise to both the reader and the embedding.
 *
 * The overlap must be strictly smaller than the chunk it came from. Text with
 * no internal sentence boundary — a Markdown table is the common case, having
 * no sentences at all — has no trailing part to take that is not the whole
 * thing, and returning the whole thing makes each chunk contain its
 * predecessor, so chunks accumulate instead of advancing.
 */
function trailingSentencesWithin(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return '';

  const sentences = text.trim().split(SENTENCE_BOUNDARY);
  if (sentences.length <= 1) return '';

  const kept: string[] = [];
  let tokens = 0;

  for (let index = sentences.length - 1; index >= 0; index -= 1) {
    const tokensInSentence = estimateTokenCount(sentences[index]);
    if (kept.length > 0 && tokens + tokensInSentence > tokenBudget) break;
    kept.unshift(sentences[index]);
    tokens += tokensInSentence;
    if (tokens >= tokenBudget) break;
  }

  return kept.join(' ');
}

export function chunkMarkdownDocument(
  markdown: string,
  options: ChunkingOptions = {},
): DocumentChunk[] {
  const targetTokens = options.targetTokens ?? CHUNK_TARGET_TOKENS;
  const overlapRatio = options.overlapRatio ?? CHUNK_OVERLAP_RATIO;
  const overlapTokens = Math.floor(targetTokens * overlapRatio);

  const chunks: DocumentChunk[] = [];

  for (const section of parseSections(markdown)) {
    // Overlap is seeded per section and never carried across a heading.
    let pending: string[] = [];
    let pendingTokens = 0;

    const emit = () => {
      const content = pending.join('\n\n').trim();
      if (content.length === 0) return '';
      chunks.push({
        ordinal: chunks.length,
        headingPath: section.headingPath,
        content,
        estimatedTokenCount: estimateTokenCount(content),
      });
      return content;
    };

    const flushWithOverlap = () => {
      const emitted = emit();
      const overlap = emitted ? trailingSentencesWithin(emitted, overlapTokens) : '';
      pending = overlap ? [overlap] : [];
      pendingTokens = overlap ? estimateTokenCount(overlap) : 0;
    };

    const addPiece = (piece: string) => {
      const tokens = estimateTokenCount(piece);
      if (pending.length > 0 && pendingTokens + tokens > targetTokens) flushWithOverlap();
      pending.push(piece);
      pendingTokens += tokens;
    };

    for (const block of section.blocks) {
      const rendered = renderBlock(block);
      if (estimateTokenCount(rendered) <= targetTokens) {
        addPiece(rendered);
      } else {
        for (const piece of splitOversizedBlock(block, targetTokens)) addPiece(piece);
      }
    }

    emit();
  }

  return chunks;
}
