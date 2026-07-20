/**
 * The `/api/pos/v1` wire contract, modelled as dependency-free TypeScript.
 *
 * Everything here is money and opaque handles. There is deliberately no notion of a point,
 * a tier, or a campaign — that is the whole design of the integration. See `api-guide.md`.
 */

// ── Envelope ────────────────────────────────────────────────────────────────

export interface PosWarning {
  /** Stable code; safe to switch on. Never fails an operation. */
  code: string;
  message: string;
}

/** Stable, documented error codes. The POS switches on these; they never change meaning. */
export type PosErrorCode =
  | 'auth.missing_key'
  | 'auth.invalid_key'
  | 'auth.key_disabled'
  | 'auth.key_expired'
  | 'auth.tenant_unavailable'
  | 'request.validation_failed'
  | 'customer.not_found'
  | 'quote.expired'
  | 'quote.invalid_token'
  | 'quote.cart_mismatch'
  | 'redeem.disabled'
  | 'redeem.insufficient_points'
  | 'redeem.exceeds_cap'
  | 'commit.idempotency_conflict'
  | 'commit.failed'
  | 'commit.not_found'
  | 'refund.already_refunded'
  | 'refund.period_expired'
  | 'refund.exceeds_amount'
  | 'refund.failed'
  | 'loyalty.unavailable'
  /** Synthesized client-side when the API cannot be reached at all (DNS, CORS, timeout, offline). */
  | 'loyalty.unreachable'
  /** Fallback for any code the server introduces that this SDK version predates. */
  | (string & {});

export interface PosError {
  code: PosErrorCode;
  /** Safe to show a cashier. */
  message: string;
  /** Whether re-trying (usually after a fresh quote) could succeed. */
  retryable: boolean;
  details?: unknown;
}

export interface PosOk<T> {
  ok: true;
  data: T;
  warnings: PosWarning[];
}

export interface PosFail {
  ok: false;
  error: PosError;
}

/**
 * Every call resolves to this union. A business failure (4xx/5xx with a Loso body) and a
 * transport failure both arrive as `PosFail` — the stream never throws, so a till can always
 * fall back to full price. Switch on `ok`.
 */
export type PosEnvelope<T> = PosOk<T> | PosFail;

// ── Config ──────────────────────────────────────────────────────────────────

export interface PosConfig {
  apiVersion: string;
  currency: string;
  redeemEnabled: boolean;
  maxRedeemPercentOfSubtotal: number;
  earnBasis: string;
  quoteTtlSeconds: number;
}

// ── Customer ────────────────────────────────────────────────────────────────

export interface PosCustomer {
  /** Opaque — store it for the sale, never parse it. */
  customerRef: string;
  name: string;
  tier?: string | null;
  active: boolean;
}

// ── Quote ───────────────────────────────────────────────────────────────────

export interface PosCartLine {
  sku: string;
  qty: number;
  amount: number;
}

export interface PosCart {
  subtotal: number;
  currency: string;
  lines?: PosCartLine[];
}

export interface PosRedeemOption {
  type: string;
  discount: number;
  discountPercent: number;
  costPoints: number;
  label: string;
}

export interface PosRedeemConstraints {
  minPoints: number;
  maxPercentOfSubtotal: number;
  step: number;
}

export interface PosRedeemable {
  /** The ceiling, in currency. Take any amount from 0 up to it. */
  maxDiscount: number;
  /** The same ceiling as a percentage of subtotal, floored so it never overshoots. */
  maxDiscountPercent: number;
  currency: string;
  options: PosRedeemOption[];
  constraints: PosRedeemConstraints;
}

export interface PosEarn {
  /** Display only, and computed on the gross basket. Commit is authoritative. */
  estimatedPoints: number;
  note?: string | null;
}

export interface PosQuoteRequest {
  customerRef?: string | null;
  cart: PosCart;
  intent?: { wantRedeem: boolean };
}

export interface PosQuoteResponse {
  customer?: PosCustomer | null;
  redeemable?: PosRedeemable | null;
  earn?: PosEarn | null;
  /** Signed, short-lived, bound to this customer and basket. Echo it back on commit. */
  redemptionToken?: string | null;
  quoteExpiresAt?: string | null;
}

// ── Commit ──────────────────────────────────────────────────────────────────

export interface PosCommitRequest {
  posTransactionId: string;
  customerRef?: string | null;
  cart: PosCart;
  redemption?: { redemptionToken: string; acceptDiscount: number } | null;
  tender?: { finalAmount: number; paymentMethod: string } | null;
}

export interface PosCommitResponse {
  /** Print this. It is the handle for refunds and lookups. */
  loyaltyReference: string;
  posTransactionId: string;
  discountApplied: number;
  pointsRedeemed: number;
  /** Authoritative — computed on the net amount paid. */
  pointsEarned: number;
  newPointsBalance?: number | null;
  finalAmount: number;
}

// ── Refund ──────────────────────────────────────────────────────────────────

export interface PosRefundRequest {
  reason?: string | null;
  /** Omit for a full refund. */
  amount?: number | null;
}

export interface PosRefundResponse {
  refundReference: string;
  loyaltyReference: string;
  type: string;
  refundedAmount: number;
  pointsReversed: number;
  pointsRestored: number;
  newPointsBalance: number;
}
