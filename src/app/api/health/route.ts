/**
 * Readiness probe for the Lambda Web Adapter.
 *
 * The adapter holds the invocation until this answers, so it must not touch
 * Supabase or Gemini: a health check that depends on everything reports
 * unhealthy whenever anything is, and turns one slow dependency into a cold
 * start that never completes.
 */
export function GET() {
  return Response.json({ ok: true });
}
