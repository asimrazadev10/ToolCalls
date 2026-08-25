import { createGeminiAnswerGenerator } from '@/rag/answer/gemini-answer-generator';
import { answerFromChunks } from '@/rag/answer/answer-question';
import { createMarginaliaClient, readSupabaseConfig } from '@/rag/db/client';
import { searchDocuments } from '@/rag/db/document-repository';
import { MARGINALIA_LIMITS, claimRequestSlot } from '@/rag/db/rate-limit';
import { createGeminiEmbedder } from '@/rag/embed/gemini-embedder';

/** Embedding, retrieval and generation are three round trips. */
export const maxDuration = 60;

const badRequest = (reason: string, status = 400) =>
  Response.json({ error: reason }, { status });

/**
 * Ask a question of your own documents.
 *
 * The caller's Supabase access token does the authorising: it is forwarded to
 * Postgres, `auth.uid()` resolves to that person, and row-level security
 * decides what the search can see. This route never chooses whose documents to
 * read — it could not, having no credential that reaches past one user.
 */
export async function POST(request: Request) {
  const authorization = request.headers.get('authorization');
  const accessToken = authorization?.replace(/^Bearer\s+/i, '').trim();

  if (!accessToken) {
    return badRequest('Sign in to ask questions about your documents.', 401);
  }

  let question: string;
  try {
    const body = (await request.json()) as { question?: unknown };
    if (typeof body.question !== 'string' || body.question.trim().length === 0) {
      return badRequest('Ask a question.');
    }
    question = body.question.trim();
  } catch {
    return badRequest('Request body must be valid JSON.');
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return badRequest('The server is missing its model credentials.', 500);

  try {
    const config = readSupabaseConfig(process.env);
    const client = createMarginaliaClient(config, accessToken);

    // Counted in Postgres, so the ceiling holds however many instances are
    // serving. Checked before any model call, since the point is to not spend
    // one.
    const slot = await claimRequestSlot(client, MARGINALIA_LIMITS.ask);
    if (!slot.allowed) {
      return Response.json(
        { error: `You are asking faster than the desk can read. Try again in ${slot.retryAfterSeconds}s.` },
        { status: 429, headers: { 'retry-after': String(slot.retryAfterSeconds) } },
      );
    }

    // The question is embedded as a query, not as a passage. Verified against
    // the live model: the two task types produce measurably different vectors.
    const embed = createGeminiEmbedder({ apiKey });
    const [queryEmbedding] = await embed({
      texts: [question],
      taskType: 'RETRIEVAL_QUERY',
      signal: request.signal,
    });

    const chunks = await searchDocuments(client, {
      queryEmbedding,
      queryText: question,
      limit: 8,
    });

    const result = await answerFromChunks({
      question,
      chunks,
      generate: createGeminiAnswerGenerator({ apiKey, signal: request.signal }),
    });

    return Response.json({
      answered: result.answered,
      answer: result.answer,
      confidence: result.confidence,
      citations: result.citations.map((chunkId) => {
        const chunk = chunks.find((candidate) => candidate.chunkId === chunkId)!;
        return {
          chunkId,
          documentTitle: chunk.documentTitle,
          headingPath: chunk.headingPath,
          pageFrom: chunk.pageFrom,
          excerpt: chunk.content.slice(0, 320),
        };
      }),
    });
  } catch (cause) {
    console.error('[rag/ask] failed', cause);
    return badRequest('The desk could not answer that. Please try again.', 500);
  }
}
