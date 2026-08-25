import { createMarginaliaClient, readSupabaseConfig } from '@/rag/db/client';
import { nextUnembeddedChunks, storeChunkEmbeddings } from '@/rag/db/document-repository';
import { MARGINALIA_LIMITS, claimRequestSlot } from '@/rag/db/rate-limit';
import { composeEmbeddingInput } from '@/rag/embed/embedding-input';
import { createGeminiEmbedder } from '@/rag/embed/gemini-embedder';

export const maxDuration = 60;

/**
 * How many chunks one call embeds. One provider request, comfortably inside a
 * request budget, and small enough that a failed batch is cheap to retry.
 */
const CHUNKS_PER_CALL = 50;

const refuse = (reason: string, status = 400) => Response.json({ error: reason }, { status });

/**
 * Embeds the next batch of a document's chunks and reports what is left.
 *
 * Idempotent and resumable by construction: it asks the database which chunks
 * still lack a vector rather than being told, so calling it twice does no harm
 * and a client that disappears mid-way leaves the work exactly where it was.
 * Anyone holding the owner's token can finish it later.
 */
export async function POST(request: Request) {
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return refuse('Sign in to add a document.', 401);

  let documentId: string;
  try {
    const body = (await request.json()) as { documentId?: unknown };
    if (typeof body.documentId !== 'string' || body.documentId.length === 0) {
      return refuse('Which document should be embedded?');
    }
    documentId = body.documentId;
  } catch {
    return refuse('Request body must be valid JSON.');
  }

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return refuse('The server is missing its model credentials.', 500);

  try {
    const config = readSupabaseConfig(process.env);
    const client = createMarginaliaClient(config, accessToken);

    const slot = await claimRequestSlot(client, MARGINALIA_LIMITS.embed);
    if (!slot.allowed) {
      return Response.json(
        { error: `Embedding is going as fast as the quota allows. Continuing in ${slot.retryAfterSeconds}s.` },
        { status: 429, headers: { 'retry-after': String(slot.retryAfterSeconds) } },
      );
    }

    const pending = await nextUnembeddedChunks(client, documentId, CHUNKS_PER_CALL);
    if (pending.chunks.length === 0) {
      return Response.json({ embedded: 0, remaining: 0, done: true });
    }

    const vectors = await createGeminiEmbedder({ apiKey })({
      texts: pending.chunks.map((chunk) =>
        composeEmbeddingInput({ headingPath: chunk.headingPath, content: chunk.content }),
      ),
      taskType: 'RETRIEVAL_DOCUMENT',
      signal: request.signal,
    });

    const remaining = await storeChunkEmbeddings(
      client,
      documentId,
      pending.chunks.map((chunk, index) => ({
        chunkId: chunk.chunkId,
        embedding: vectors[index],
      })),
    );

    return Response.json({
      embedded: pending.chunks.length,
      remaining,
      done: remaining === 0,
    });
  } catch (cause) {
    console.error('[rag/documents/embed] failed', cause);
    const message = cause instanceof Error ? cause.message : 'Embedding failed.';
    return refuse(message, 500);
  }
}
