/**
 * A fresh idempotency key. `commit` and `refund` require one; reuse the *same* key across
 * retries of one attempt so a timeout-then-retry returns the original result instead of
 * ringing up a second sale.
 */
export function generateIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID();
  }

  // Fallback for runtimes without crypto.randomUUID — RFC-4122 v4 shape, best-effort randomness.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
