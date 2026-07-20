import { generateIdempotencyKey } from './idempotency.js';
import type {
  PosCommitRequest,
  PosCommitResponse,
  PosConfig,
  PosCustomer,
  PosEnvelope,
  PosFail,
  PosQuoteRequest,
  PosQuoteResponse,
  PosRefundRequest,
  PosRefundResponse,
} from './types.js';

/** The `fetch` shape the client depends on — a subset of the WHATWG signature. */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}>;

export interface LosoPosClientOptions {
  /** e.g. `https://api.loso.example`. The `/api/pos/v1` prefix is added for you. */
  baseUrl: string;
  /** The merchant's POS key, `pos_live_…` or `pos_test_…`. Sent as a bearer token. */
  apiKey: string;
  /**
   * Transport. Defaults to `globalThis.fetch`. Supply your own for Node < 18, a proxy, mTLS,
   * or request logging. A browser page should point this (or `baseUrl`) at your own backend
   * rather than embed a live key — see the README.
   */
  fetch?: FetchLike;
  /** Per-request timeout in milliseconds. Default 10000. Keep it short on `commit`. */
  timeoutMs?: number;
}

/** Options for the auto-retrying commit/refund helpers. */
export interface RetryOptions {
  /** Reuse this key instead of generating one. */
  idempotencyKey?: string;
  /** Extra attempts after the first. Default 2. */
  retries?: number;
  /** Base delay between attempts, multiplied by the attempt number. Default 300ms. */
  backoffMs?: number;
}

const API_PREFIX = '/api/pos/v1';
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Typed client for the Loso POS loyalty API. Every call resolves to a {@link PosEnvelope}:
 * a business failure and a transport failure both arrive as `{ ok: false }`, so the stream
 * never throws and a till can always fall back to full price. The Promise rejects only on
 * programmer error (a missing `baseUrl` or `apiKey`).
 */
export class LosoPosClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: LosoPosClientOptions) {
    if (!options?.baseUrl) {
      throw new Error('LosoPosClient: `baseUrl` is required.');
    }
    if (!options.apiKey) {
      throw new Error('LosoPosClient: `apiKey` is required.');
    }

    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
      throw new Error(
        'LosoPosClient: no `fetch` available. Pass `fetch` explicitly on Node < 18.'
      );
    }

    // Trim: keys get pasted, and pasted things carry whitespace.
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey.trim();
    this.fetchImpl = fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Currency and redemption rules. Fetch once at startup and cache. */
  getConfig(): Promise<PosEnvelope<PosConfig>> {
    return this.send<PosConfig>('GET', '/config');
  }

  /** Turn a scanned code, phone, email or card number into an opaque `customerRef`. */
  resolveCustomer(code: string): Promise<PosEnvelope<PosCustomer>> {
    return this.send<PosCustomer>(
      'GET',
      `/customer/resolve?code=${encodeURIComponent(code)}`
    );
  }

  /** Price the current cart. Read-only; call it as often as the basket changes. */
  quote(request: PosQuoteRequest): Promise<PosEnvelope<PosQuoteResponse>> {
    return this.send<PosQuoteResponse>('POST', '/quote', request);
  }

  /**
   * Finalize the sale. Requires an `Idempotency-Key`; one is generated if omitted. Prefer
   * {@link commitWithRetry} on a flaky network — it reuses the key across attempts.
   */
  commit(
    request: PosCommitRequest,
    idempotencyKey: string = generateIdempotencyKey()
  ): Promise<PosEnvelope<PosCommitResponse>> {
    return this.send<PosCommitResponse>('POST', '/commit', request, idempotencyKey);
  }

  /** Fetch a prior commit — receipt reprint, or reconciliation after a timeout. */
  getCommit(loyaltyReference: string): Promise<PosEnvelope<PosCommitResponse>> {
    return this.send<PosCommitResponse>(
      'GET',
      `/commit/${encodeURIComponent(loyaltyReference)}`
    );
  }

  /** Reverse a sale, fully (omit `amount`) or in part. Requires its own idempotency key. */
  refund(
    loyaltyReference: string,
    request: PosRefundRequest,
    idempotencyKey: string = generateIdempotencyKey()
  ): Promise<PosEnvelope<PosRefundResponse>> {
    return this.send<PosRefundResponse>(
      'POST',
      `/commit/${encodeURIComponent(loyaltyReference)}/refund`,
      request,
      idempotencyKey
    );
  }

  /**
   * Commit with automatic, safe retries. One idempotency key is generated and reused across
   * every attempt, so a timeout that already landed server-side replays the original result
   * rather than double-selling. Retries only on a `retryable` failure.
   */
  commitWithRetry(
    request: PosCommitRequest,
    options: RetryOptions = {}
  ): Promise<PosEnvelope<PosCommitResponse>> {
    const key = options.idempotencyKey ?? generateIdempotencyKey();
    return this.withRetry((k) => this.commit(request, k), key, options);
  }

  /** Refund with automatic, safe retries. Same idempotency guarantee as {@link commitWithRetry}. */
  refundWithRetry(
    loyaltyReference: string,
    request: PosRefundRequest,
    options: RetryOptions = {}
  ): Promise<PosEnvelope<PosRefundResponse>> {
    const key = options.idempotencyKey ?? generateIdempotencyKey();
    return this.withRetry((k) => this.refund(loyaltyReference, request, k), key, options);
  }

  private async withRetry<T>(
    call: (idempotencyKey: string) => Promise<PosEnvelope<T>>,
    key: string,
    options: RetryOptions
  ): Promise<PosEnvelope<T>> {
    const retries = options.retries ?? 2;
    const backoffMs = options.backoffMs ?? 300;

    let result = await call(key);
    for (let attempt = 0; attempt < retries; attempt++) {
      if (result.ok || !result.error.retryable) {
        return result;
      }
      await delay(backoffMs * (attempt + 1));
      result = await call(key);
    }
    return result;
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    idempotencyKey?: string
  ): Promise<PosEnvelope<T>> {
    const url = `${this.baseUrl}${API_PREFIX}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (idempotencyKey) {
      headers['Idempotency-Key'] = idempotencyKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      const text = await response.text();
      const parsed = text ? (JSON.parse(text) as unknown) : undefined;

      // Loso returns the envelope even on 4xx, so a well-formed body is authoritative
      // regardless of status.
      if (isEnvelope(parsed)) {
        return parsed as PosEnvelope<T>;
      }

      // A response with no usable envelope (proxy error page, empty 5xx) is unreachable-shaped.
      return unreachable<T>(
        `Loso returned an unreadable response (HTTP ${response.status}). Sell at full price.`
      );
    } catch (error) {
      // Timeout, DNS, CORS, offline — the one case the contract can't describe. Sell at full price.
      const aborted = error instanceof Error && error.name === 'AbortError';
      return unreachable<T>(
        aborted
          ? 'The request to Loso timed out. Sell at full price.'
          : 'Could not reach Loso (network, CORS, or the API is down). Sell at full price.'
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isEnvelope(value: unknown): value is { ok: boolean } {
  return typeof value === 'object' && value !== null && 'ok' in value;
}

function unreachable<T>(message: string): PosFail & PosEnvelope<T> {
  return {
    ok: false,
    error: { code: 'loyalty.unreachable', message, retryable: true },
  };
}
