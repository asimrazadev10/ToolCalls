import { createHash } from 'node:crypto';
import { MAX_UPLOAD_BYTES } from '@/rag/config';
import { createMarginaliaClient, readSupabaseConfig } from '@/rag/db/client';
import { storeDocumentChunks } from '@/rag/db/document-repository';
import { MARGINALIA_LIMITS, claimRequestSlot } from '@/rag/db/rate-limit';
import { composeEmbeddingInput } from '@/rag/embed/embedding-input';
import { createGeminiEmbedder } from '@/rag/embed/gemini-embedder';
import { chunkMarkdownDocument } from '@/rag/ingest/chunker';
import { parseDocument } from '@/rag/ingest/parse-document';

/**
 * Ingestion runs inside the request: parse, chunk, embed, store.
 *
 * That is a known limit, not an oversight. A long document will outlast any
 * request budget, and the fix is a queue with a worker — which then has no
 * user token, and needs a credential decision this system has so far avoided
 * needing. Until then the upload cap keeps documents inside what a request can
 * finish.
 */
export const maxDuration = 60;

const refuse = (reason: string, status = 400) => Response.json({ error: reason }, { status });

export async function POST(request: Request) {
  const accessToken = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!accessToken) return refuse('Sign in to add a document.', 401);

  const filename = request.headers.get('x-filename')?.trim();
  if (!filename) return refuse('The upload is missing a filename.');

  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return refuse('The server is missing its model credentials.', 500);

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength === 0) return refuse('That file is empty.');
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    return refuse(`That file is larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`, 413);
  }

  try {
    const config = readSupabaseConfig(process.env);
    const client = createMarginaliaClient(config, accessToken);

    // Held far tighter than asking: a document costs an embedding call for
    // every chunk in it, so a handful of uploads can exhaust a whole minute's
    // provider allowance.
    const slot = await claimRequestSlot(client, MARGINALIA_LIMITS.upload);
    if (!slot.allowed) {
      return Response.json(
        { error: `That is a lot of documents at once. Try again in ${slot.retryAfterSeconds}s.` },
        { status: 429, headers: { 'retry-after': String(slot.retryAfterSeconds) } },
      );
    }

    // Parsing first: a file we cannot read should never leave a row behind.
    const parsed = await parseDocument({ bytes });
    const chunks = chunkMarkdownDocument(parsed.markdown);
    if (chunks.length === 0) return refuse('No readable text was found in that file.');

    const { data: userData } = await client.auth.getUser(accessToken);
    const ownerId = userData.user?.id;
    if (!ownerId) return refuse('That sign-in is no longer valid.', 401);

    // Content hash, not filename: re-uploading identical bytes must cost
    // nothing rather than creating a second copy.
    const contentSha256 = createHash('sha256').update(bytes).digest('hex');

    const { data: document, error: insertError } = await client
      .from('documents')
      .upsert(
        {
          owner_id: ownerId,
          title: filename.replace(/\.[^.]+$/, ''),
          mime_type: 'application/pdf',
          byte_size: bytes.byteLength,
          content_sha256: `\\x${contentSha256}`,
          storage_path: `${ownerId}/${filename}`,
          page_count: parsed.pageCount,
          parse_report: parsed.parseReport,
          status: 'embedding',
        },
        { onConflict: 'owner_id,content_sha256' },
      )
      .select('id, title')
      .single();

    if (insertError || !document) {
      return refuse(insertError?.message ?? 'That document could not be saved.', 500);
    }

    const vectors = await createGeminiEmbedder({ apiKey })({
      texts: chunks.map(composeEmbeddingInput),
      taskType: 'RETRIEVAL_DOCUMENT',
      signal: request.signal,
    });

    const stored = await storeDocumentChunks(
      client,
      document.id,
      chunks.map((chunk, index) => ({
        ordinal: chunk.ordinal,
        content: chunk.content,
        tokenCount: chunk.estimatedTokenCount,
        headingPath: chunk.headingPath,
        pageFrom: chunk.pageFrom,
        pageTo: chunk.pageTo,
        embedding: vectors[index],
      })),
    );

    return Response.json({
      id: document.id,
      title: document.title,
      pageCount: parsed.pageCount,
      chunkCount: stored,
      pagesNeedingVision: parsed.parseReport.filter((page) => page.usedVision).length,
    });
  } catch (cause) {
    console.error('[rag/documents] ingest failed', cause);
    const message = cause instanceof Error ? cause.message : 'That document could not be read.';
    return refuse(message, 500);
  }
}
