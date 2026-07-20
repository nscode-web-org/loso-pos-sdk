import { describe, expect, it } from 'vitest';

import { LosoPosClient } from './index.js';
import type { FetchLike } from './index.js';

/** A mock transport that records calls and replays queued responses. */
function mockFetch(
  responses: Array<{ status?: number; body: unknown } | { throw: Error }>
): { fetch: FetchLike; calls: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> } {
  const calls: Array<{ url: string; method?: string; headers?: Record<string, string>; body?: string }> = [];
  let i = 0;

  const fetch: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const next = responses[Math.min(i, responses.length - 1)];
    i++;
    if (next && 'throw' in next) {
      return Promise.reject(next.throw);
    }
    const status = (next && 'status' in next && next.status) || 200;
    const text = next ? JSON.stringify(next.body) : '';
    return Promise.resolve({
      status,
      ok: status >= 200 && status < 300,
      text: () => Promise.resolve(text),
    });
  };

  return { fetch, calls };
}

const ok = <T>(data: T) => ({ ok: true, data, warnings: [] });
const fail = (code: string, retryable: boolean) => ({
  ok: false,
  error: { code, message: `err ${code}`, retryable },
});

function makeClient(fetch: FetchLike, timeoutMs?: number): LosoPosClient {
  return new LosoPosClient({
    baseUrl: 'https://api.loso.example/',
    apiKey: '  pos_test_abc  ',
    fetch,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}

describe('LosoPosClient — construction', () => {
  it('requires baseUrl and apiKey', () => {
    expect(() => new LosoPosClient({ baseUrl: '', apiKey: 'k', fetch: mockFetch([]).fetch })).toThrow(/baseUrl/);
    expect(() => new LosoPosClient({ baseUrl: 'x', apiKey: '', fetch: mockFetch([]).fetch })).toThrow(/apiKey/);
  });

  it('allows a missing apiKey in proxy mode, and refuses one that is supplied', () => {
    expect(
      () => new LosoPosClient({ baseUrl: 'x', auth: 'proxy', fetch: mockFetch([]).fetch })
    ).not.toThrow();
    // Silently dropping it would hide a live key sitting in a browser bundle.
    expect(
      () => new LosoPosClient({ baseUrl: 'x', auth: 'proxy', apiKey: 'pos_live_x', fetch: mockFetch([]).fetch })
    ).toThrow(/proxy/);
  });

  it('throws when no fetch is available', () => {
    const original = globalThis.fetch;
    // @ts-expect-error — deliberately remove fetch for the test
    delete globalThis.fetch;
    try {
      expect(() => new LosoPosClient({ baseUrl: 'x', apiKey: 'k' })).toThrow(/fetch/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('LosoPosClient — requests', () => {
  it('builds the config URL and sends a trimmed bearer key', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ currency: 'BAM' }) }]);
    const result = await makeClient(fetch).getConfig();

    expect(calls[0]?.url).toBe('https://api.loso.example/api/pos/v1/config');
    expect(calls[0]?.headers?.['Authorization']).toBe('Bearer pos_test_abc');
    expect(result.ok && result.data.currency).toBe('BAM');
  });

  it('sends no Authorization header in proxy mode', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ currency: 'BAM' }) }]);
    const client = new LosoPosClient({ baseUrl: 'https://till.vendor.example', auth: 'proxy', fetch });
    await client.getConfig();

    expect(calls[0]?.url).toBe('https://till.vendor.example/api/pos/v1/config');
    expect(calls[0]?.headers?.['Authorization']).toBeUndefined();
  });

  it('url-encodes the resolve code', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ customerRef: 'c1' }) }]);
    await makeClient(fetch).resolveCustomer('+387 65/423');

    expect(calls[0]?.url).toContain('/customer/resolve?code=%2B387%2065%2F423');
  });

  it('POSTs a JSON quote with Content-Type', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ redeemable: null }) }]);
    await makeClient(fetch).quote({ cart: { subtotal: 42, currency: 'BAM' } });

    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(calls[0]?.body ?? '{}').cart.subtotal).toBe(42);
  });

  it('auto-generates an Idempotency-Key on commit', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ loyaltyReference: 'TXN-1' }) }]);
    await makeClient(fetch).commit({
      posTransactionId: 'POS-1',
      cart: { subtotal: 42, currency: 'BAM' },
    });

    expect(calls[0]?.headers?.['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
  });

  it('returns the envelope on a 4xx instead of throwing', async () => {
    const { fetch } = mockFetch([{ status: 422, body: fail('redeem.exceeds_cap', false) }]);
    const result = await makeClient(fetch).commit({
      posTransactionId: 'POS-1',
      cart: { subtotal: 42, currency: 'BAM' },
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('redeem.exceeds_cap');
  });
});

describe('LosoPosClient — transport failure is never a throw', () => {
  it('maps a network error to loyalty.unreachable', async () => {
    const { fetch } = mockFetch([{ throw: new Error('ECONNREFUSED') }]);
    const result = await makeClient(fetch).getConfig();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('loyalty.unreachable');
    expect(!result.ok && result.error.retryable).toBe(true);
  });

  it('maps an abort/timeout to loyalty.unreachable', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { fetch } = mockFetch([{ throw: abort }]);
    const result = await makeClient(fetch).getConfig();

    expect(!result.ok && result.error.code).toBe('loyalty.unreachable');
    expect(!result.ok && result.error.message).toMatch(/timed out/);
  });

  it('maps an unreadable body to loyalty.unreachable', async () => {
    const badFetch: FetchLike = () =>
      Promise.resolve({ status: 502, ok: false, text: () => Promise.resolve('<html>gateway</html>') });
    const result = await makeClient(badFetch).getConfig();

    expect(!result.ok && result.error.code).toBe('loyalty.unreachable');
  });
});

describe('LosoPosClient — safe retry', () => {
  it('reuses one idempotency key across retries and stops on success', async () => {
    const { fetch, calls } = mockFetch([
      { throw: new Error('flaky') },
      { body: ok({ loyaltyReference: 'TXN-1' }) },
    ]);
    const result = await makeClient(fetch).commitWithRetry(
      { posTransactionId: 'POS-1', cart: { subtotal: 42, currency: 'BAM' } },
      { backoffMs: 0 }
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // The decisive guarantee: a retry must carry the SAME key, or it would double-sell.
    expect(calls[0]?.headers?.['Idempotency-Key']).toBe(calls[1]?.headers?.['Idempotency-Key']);
  });

  it('does not retry a non-retryable failure', async () => {
    const { fetch, calls } = mockFetch([{ status: 422, body: fail('redeem.exceeds_cap', false) }]);
    const result = await makeClient(fetch).commitWithRetry(
      { posTransactionId: 'POS-1', cart: { subtotal: 42, currency: 'BAM' } },
      { backoffMs: 0 }
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('gives up after the retry budget and returns the last failure', async () => {
    const { fetch, calls } = mockFetch([{ throw: new Error('down') }]);
    const result = await makeClient(fetch).commitWithRetry(
      { posTransactionId: 'POS-1', cart: { subtotal: 42, currency: 'BAM' } },
      { retries: 2, backoffMs: 0 }
    );

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(3); // first attempt + 2 retries
  });
});

describe('LosoPosClient — refund', () => {
  it('targets the reference and sends an idempotency key', async () => {
    const { fetch, calls } = mockFetch([{ body: ok({ refundReference: 'RFD-1', type: 'partial' }) }]);
    await makeClient(fetch).refund('TXN-20260716-000481', { amount: 14.75 });

    expect(calls[0]?.url).toContain('/commit/TXN-20260716-000481/refund');
    expect(calls[0]?.headers?.['Idempotency-Key']).toMatch(/[0-9a-f-]{36}/);
  });
});
