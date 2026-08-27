/**
 * Runs the golden set against the live stack and reports retrieval and answer
 * quality.
 *
 * A script rather than a unit test: it needs a database, a model and a signed-
 * in user, and it costs quota. Run it deliberately, record the numbers, and
 * compare them before and after any change to retrieval.
 *
 *   npx tsx scripts/run-evaluation.mts
 */
import { readFile, readdir } from 'node:fs/promises';
import { parseDocument } from '../src/rag/ingest/parse-document.ts';
import { chunkMarkdownDocument } from '../src/rag/ingest/chunker.ts';
import { composeEmbeddingInput } from '../src/rag/embed/embedding-input.ts';
import { createGeminiEmbedder } from '../src/rag/embed/gemini-embedder.ts';
import { readSupabaseConfig, createMarginaliaClient } from '../src/rag/db/client.ts';
import { storeDocumentChunks, searchDocuments } from '../src/rag/db/document-repository.ts';
import { answerFromChunks } from '../src/rag/answer/answer-question.ts';
import { createGeminiAnswerGenerator } from '../src/rag/answer/gemini-answer-generator.ts';
import {
  recallAtK,
  reciprocalRank,
  normalizedDiscountedCumulativeGain,
} from '../src/rag/eval/retrieval-metrics.ts';
import { createGeminiPassageReranker } from '../src/rag/retrieve/gemini-reranker.ts';
import { reorderByRankedIds } from '../src/rag/retrieve/reorder-by-ranked-ids.ts';
import { generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

const K = 5;

/**
 * A/B switch. `RERANK=1 npm run eval` measures the reranker against the
 * recorded baseline; without it the run is the baseline itself. A flag rather
 * than an edit, so the two runs differ in exactly one thing.
 */
const RERANK_ENABLED = process.env.RERANK === '1';

/** Stable per corpus file, so a re-run replaces its chunks rather than adding. */
const evaluationDocumentId = (index: number) =>
  `e7a10000-0000-4000-8000-0000000000${String(index).padStart(2, '0')}`;

interface GoldenQuestion {
  id: string;
  question: string;
  expectedContentMarkers: string[];
  expectRefusal: boolean;
}

const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY!;
const config = readSupabaseConfig(process.env);
const embed = createGeminiEmbedder({ apiKey });

const google = createGoogleGenerativeAI({ apiKey });
// Counted, because the reranker swallows its own failures by design: a
// reranker must not be able to break retrieval. That safety property also
// hides quota errors, which would silently understate any measured gain.
let rerankCallsAttempted = 0;
let rerankCallsFailed = 0;

const rerank = createGeminiPassageReranker({
  generate: async ({ system, user, signal }) => {
    rerankCallsAttempted += 1;
    try {
      const { text } = await generateText({
        model: google('gemini-3.5-flash-lite'),
        system,
        prompt: user,
        abortSignal: signal,
      });
      return text;
    } catch (cause) {
      rerankCallsFailed += 1;
      console.log(`    rerank failed: ${cause instanceof Error ? cause.message.slice(0, 90) : cause}`);
      throw cause;
    }
  },
});

const goldenSet = JSON.parse(
  await readFile(new URL('../src/rag/eval/golden-set.json', import.meta.url), 'utf8'),
) as { corpus: string; questions: GoldenQuestion[] };

// --- sign in ----------------------------------------------------------------
// Required rather than defaulted. A committed fallback password is a live
// credential for whichever project the .env points at, and this file is public.
const evalEmail = process.env.EVAL_EMAIL;
const evalPassword = process.env.EVAL_PASSWORD;
if (!evalEmail || !evalPassword) {
  throw new Error(
    'set EVAL_EMAIL and EVAL_PASSWORD to a user that owns the evaluation corpus',
  );
}

const authResponse = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: config.publishableKey, 'content-type': 'application/json' },
  body: JSON.stringify({ email: evalEmail, password: evalPassword }),
});
const { access_token: accessToken } = (await authResponse.json()) as { access_token?: string };
if (!accessToken) throw new Error('evaluation needs a signed-in user; see EVAL_EMAIL/EVAL_PASSWORD');

const client = createMarginaliaClient(config, accessToken);

// --- ingest the corpus ------------------------------------------------------
const corpusDirectory = new URL(`../${goldenSet.corpus}/`, import.meta.url);
const corpusFiles = (await readdir(corpusDirectory)).filter((name) => name.endsWith('.pdf')).sort();

let totalChunks = 0;
for (const [index, filename] of corpusFiles.entries()) {
  const bytes = new Uint8Array(await readFile(new URL(filename, corpusDirectory)));
  const parsed = await parseDocument({ bytes });
  const chunks = chunkMarkdownDocument(parsed.markdown, { targetTokens: 160 });
  const vectors = await embed({
    texts: chunks.map(composeEmbeddingInput),
    taskType: 'RETRIEVAL_DOCUMENT',
  });
  const stored = await storeDocumentChunks(
    client,
    evaluationDocumentId(index),
    chunks.map((chunk, chunkIndex) => ({
      ordinal: chunk.ordinal,
      content: chunk.content,
      tokenCount: chunk.estimatedTokenCount,
      headingPath: chunk.headingPath,
      pageFrom: chunk.pageFrom,
      pageTo: chunk.pageTo,
      embedding: vectors[chunkIndex],
    })),
  );
  totalChunks += stored;
  console.log(`  ${filename.padEnd(28)} ${parsed.pageCount}pp -> ${stored} chunks`);
}
console.log(`corpus: ${corpusFiles.length} documents, ${totalChunks} chunks\n`);

// --- run the questions ------------------------------------------------------
const rows: string[] = [];
let recallTotal = 0;
let mrrTotal = 0;
let ndcgTotal = 0;
let retrievalQuestions = 0;
let refusalCorrect = 0;
let refusalQuestions = 0;
let answeredCorrectly = 0;

for (const golden of goldenSet.questions) {
  const [queryEmbedding] = await embed({ texts: [golden.question], taskType: 'RETRIEVAL_QUERY' });
  const fused = await searchDocuments(client, {
    queryEmbedding,
    queryText: golden.question,
    limit: 20,
  });

  // Rerank the fused candidates, never the whole corpus: the arms decide what
  // is worth considering, the reranker only decides the order among those.
  const hits = RERANK_ENABLED
    ? reorderByRankedIds(
        fused,
        await rerank({
          question: golden.question,
          passages: fused.map((hit) => ({ id: hit.chunkId, text: hit.content })),
        }),
      )
    : fused;

  // Relevance by content, not by id: ids change on every re-ingest, and a
  // golden set that must be rebuilt after each parser fix will not be kept.
  const relevanceByRank = hits.map((hit) =>
    golden.expectedContentMarkers.some((marker) => hit.content.includes(marker)),
  );
  const totalRelevant = golden.expectedContentMarkers.length === 0
    ? 0
    : Math.max(1, relevanceByRank.filter(Boolean).length);

  const answer = await answerFromChunks({
    question: golden.question,
    chunks: hits.slice(0, K),
    generate: createGeminiAnswerGenerator({ apiKey }),
  });

  if (golden.expectRefusal) {
    refusalQuestions += 1;
    const correct = !answer.answered;
    if (correct) refusalCorrect += 1;
    rows.push(`  ${correct ? 'PASS' : 'FAIL'}  ${golden.id.padEnd(32)} refusal expected, ${answer.answered ? 'answered anyway' : 'refused'}`);
    continue;
  }

  retrievalQuestions += 1;
  const recall = recallAtK({ relevanceByRank, totalRelevant, k: K });
  const mrr = reciprocalRank(relevanceByRank);
  const ndcg = normalizedDiscountedCumulativeGain({ relevanceByRank, totalRelevant, k: K });
  recallTotal += recall;
  mrrTotal += mrr;
  ndcgTotal += ndcg;

  const grounded = answer.answered && answer.citations.length > 0;
  if (grounded && recall > 0) answeredCorrectly += 1;

  rows.push(
    `  ${recall > 0 ? 'PASS' : 'FAIL'}  ${golden.id.padEnd(32)} recall@${K}=${recall.toFixed(2)} mrr=${mrr.toFixed(2)} ndcg=${ndcg.toFixed(2)} ${grounded ? 'answered' : 'refused'}`,
  );
}

console.log(rows.join('\n'));
console.log(`\n--- ${RERANK_ENABLED ? 'with reranking' : 'baseline'} ---`);
console.log(`  retrieval questions   ${retrievalQuestions}`);
console.log(`  mean recall@${K}        ${(recallTotal / retrievalQuestions).toFixed(3)}`);
console.log(`  mean reciprocal rank  ${(mrrTotal / retrievalQuestions).toFixed(3)}`);
console.log(`  mean nDCG@${K}          ${(ndcgTotal / retrievalQuestions).toFixed(3)}`);
console.log(`  answered and grounded ${answeredCorrectly}/${retrievalQuestions}`);
console.log(`  refusals correct      ${refusalCorrect}/${refusalQuestions}`);
if (RERANK_ENABLED) {
  console.log(`  rerank calls          ${rerankCallsAttempted}, ${rerankCallsFailed} failed`);
}
