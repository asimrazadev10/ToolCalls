import { describe, expect, it, vi } from 'vitest';
import {
  type AnsweredQuestion,
  type RetrievedContext,
  answerFromChunks,
  buildAnswerPrompt,
} from './answer-question';

const chunk = (overrides: Partial<RetrievedContext> = {}): RetrievedContext => ({
  chunkId: 'chunk-1',
  documentTitle: 'Residential Lease',
  headingPath: ['Residential Lease', 'Section 8 - Pets'],
  content: 'No animals may be kept on the premises without written consent.',
  pageFrom: 3,
  pageTo: 3,
  fusionScore: 0.032,
  ...overrides,
});

const stubGenerator = (result: { answer: string; citations: string[] }) =>
  vi.fn(async () => result);

describe('the prompt', () => {
  it('fences retrieved content and names it as material to read, not instructions', () => {
    const prompt = buildAnswerPrompt('can I keep a dog?', [chunk()]);

    expect(prompt.system).toMatch(/never.*instruction|instruction.*never/i);
    expect(prompt.user).toContain('No animals may be kept');
  });

  it('labels each passage with the id the answer must cite', () => {
    const prompt = buildAnswerPrompt('can I keep a dog?', [chunk()]);

    expect(prompt.user).toContain('chunk-1');
  });

  it('carries the heading path, so the model can say where an answer came from', () => {
    const prompt = buildAnswerPrompt('can I keep a dog?', [chunk()]);

    expect(prompt.user).toContain('Section 8 - Pets');
  });

  it('instructs the model to refuse when the passages do not answer the question', () => {
    const prompt = buildAnswerPrompt('anything', [chunk()]);

    expect(prompt.system).toMatch(/do not contain|cannot answer|not.*in.*document/i);
  });
});

describe('answering', () => {
  it('returns the answer with the citations the model chose', async () => {
    const generate = stubGenerator({
      answer: 'No, animals need written consent.',
      citations: ['chunk-1'],
    });

    const result = await answerFromChunks({
      question: 'can I keep a dog?',
      chunks: [chunk()],
      generate,
    });

    expect(result.answer).toContain('written consent');
    expect(result.citations).toEqual(['chunk-1']);
  });

  it('refuses without calling the model when nothing was retrieved', async () => {
    // Asking the model to answer from no passages invites it to answer from
    // memory, which is the one thing this system exists to prevent.
    const generate = stubGenerator({ answer: 'anything', citations: [] });

    const result = await answerFromChunks({ question: 'anything', chunks: [], generate });

    expect(result.answered).toBe(false);
    expect(result.citations).toEqual([]);
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('citations are enforced, not requested', () => {
  it('drops a citation naming a chunk that was never retrieved', async () => {
    // A fabricated source is indistinguishable from a real one to a reader.
    // Checking in code makes it impossible rather than unlikely.
    const generate = stubGenerator({
      answer: 'Something confident.',
      citations: ['chunk-1', 'chunk-does-not-exist'],
    });

    const result = await answerFromChunks({
      question: 'q',
      chunks: [chunk()],
      generate,
    });

    expect(result.citations).toEqual(['chunk-1']);
  });

  it('refuses the whole answer when every citation was fabricated', async () => {
    const generate = stubGenerator({
      answer: 'Confidently wrong, citing nothing real.',
      citations: ['invented'],
    });

    const result = await answerFromChunks({ question: 'q', chunks: [chunk()], generate });

    expect(result.answered).toBe(false);
    expect(result.answer).toMatch(/could not/i);
  });

  it('refuses an answer that cites nothing at all', async () => {
    const generate = stubGenerator({ answer: 'A claim with no source.', citations: [] });

    const result = await answerFromChunks({ question: 'q', chunks: [chunk()], generate });

    expect(result.answered).toBe(false);
  });
});

describe('confidence', () => {
  it('is low when the best passage barely matched', async () => {
    // The failure worth eliminating is not a wrong answer. It is a confident
    // wrong answer.
    const generate = stubGenerator({ answer: 'Maybe.', citations: ['chunk-1'] });

    const result = await answerFromChunks({
      question: 'q',
      chunks: [chunk({ fusionScore: 0.001 })],
      generate,
    });

    expect(result.confidence).toBe('low');
  });

  it('is high when a passage matched strongly', async () => {
    const generate = stubGenerator({ answer: 'Yes.', citations: ['chunk-1'] });

    const result = await answerFromChunks({
      question: 'q',
      chunks: [chunk({ fusionScore: 0.032 })],
      generate,
    });

    expect(result.confidence).toBe('high');
  });
});

describe('what the caller receives', () => {
  it('always reports which passages were consulted, answered or not', async () => {
    const generate = stubGenerator({ answer: 'Yes.', citations: ['chunk-1'] });

    const result: AnsweredQuestion = await answerFromChunks({
      question: 'q',
      chunks: [chunk(), chunk({ chunkId: 'chunk-2' })],
      generate,
    });

    expect(result.consultedChunkIds).toEqual(['chunk-1', 'chunk-2']);
  });
});
