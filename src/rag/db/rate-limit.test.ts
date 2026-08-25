import { describe, expect, it, vi } from 'vitest';
import { MARGINALIA_LIMITS, claimRequestSlot } from './rate-limit';

const stubClient = (response: { data?: unknown; error?: { message: string } | null }) => {
  const rpc = vi.fn(async (_name: string, _parameters: Record<string, unknown>) => ({
    data: response.data ?? null,
    error: response.error ?? null,
  }));
  return { client: { rpc } as never, rpc };
};

describe('claiming a slot', () => {
  it('allows the request when the database says so', async () => {
    const { client } = stubClient({ data: [{ allowed: true, retry_after_seconds: 42 }] });

    expect(await claimRequestSlot(client, MARGINALIA_LIMITS.ask)).toEqual({
      allowed: true,
      retryAfterSeconds: 42,
    });
  });

  it('refuses when the window is spent, and says how long to wait', async () => {
    const { client } = stubClient({ data: [{ allowed: false, retry_after_seconds: 17 }] });

    expect(await claimRequestSlot(client, MARGINALIA_LIMITS.ask)).toEqual({
      allowed: false,
      retryAfterSeconds: 17,
    });
  });

  it('passes the operation name and its limits through', async () => {
    const { client, rpc } = stubClient({ data: [{ allowed: true, retry_after_seconds: 1 }] });

    await claimRequestSlot(client, MARGINALIA_LIMITS.upload);

    expect(rpc.mock.calls[0][0]).toBe('claim_request_slot');
    expect(rpc.mock.calls[0][1]).toEqual({
      operation: MARGINALIA_LIMITS.upload.operation,
      max_requests: MARGINALIA_LIMITS.upload.maxRequests,
      window_seconds: MARGINALIA_LIMITS.upload.windowSeconds,
    });
  });
});

describe('when the limiter itself cannot be reached', () => {
  it('allows the request rather than locking everyone out', async () => {
    // A limiter that fails closed turns one broken dependency into a total
    // outage. Failing open costs a burst of over-limit traffic; the provider's
    // own ceiling is still there underneath as a backstop.
    const { client } = stubClient({ error: { message: 'connection refused' } });

    expect(await claimRequestSlot(client, MARGINALIA_LIMITS.ask)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('allows the request when the response has no rows', async () => {
    const { client } = stubClient({ data: [] });

    expect((await claimRequestSlot(client, MARGINALIA_LIMITS.ask)).allowed).toBe(true);
  });
});

describe('the configured limits', () => {
  it('lets a person ask far more often than they upload', () => {
    // Asking is cheap and interactive; ingesting a document costs an embedding
    // call for every chunk in it.
    expect(MARGINALIA_LIMITS.ask.maxRequests).toBeGreaterThan(
      MARGINALIA_LIMITS.upload.maxRequests,
    );
  });

  it('gives each operation its own window, so uploading cannot silence asking', () => {
    expect(MARGINALIA_LIMITS.ask.operation).not.toBe(MARGINALIA_LIMITS.upload.operation);
  });
});
