# @nscodecom/loso-pos-sdk

[![CI](https://github.com/nscode-web-org/loso-pos-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/nscode-web-org/loso-pos-sdk/actions/workflows/ci.yml)

Typed client for the **Loso POS loyalty API** (`/api/pos/v1`). Grant and spend loyalty on a sale
while speaking only in money — you never deal with points arithmetic.

Framework-agnostic, zero runtime dependencies, runs anywhere `fetch` exists (browsers, Node 20.19+,
Deno, Bun, edge). This is the supported replacement for hand-copying a reference client.

- **Full wire contract:** the POS integration guide — request it from your Loso contact.
- **Visual walkthrough:** the vendor guide (`how-it-works.html`), available on request.

## Install

```bash
npm install @nscodecom/loso-pos-sdk
```

## Quick start

```ts
import { LosoPosClient } from '@nscodecom/loso-pos-sdk';

const loso = new LosoPosClient({
  baseUrl: 'https://api.loso.example', // the /api/pos/v1 prefix is added for you
  apiKey: 'pos_live_…',                // or pos_test_… — from the merchant's Loso admin
});

// One continuous sale:
const q = await loso.quote({
  customerRef: '9f2c8a1e-…',           // from resolveCustomer(), or omit for anonymous
  cart: { subtotal: 42.0, currency: 'BAM' },
  intent: { wantRedeem: true },
});
if (!q.ok) return handle(q.error);      // typed PosError — switch on q.error.code

const offer = q.data.redeemable;         // ceiling, not an instruction
const acceptDiscount = 12.5;             // whatever the cashier actually takes off

const sale = await loso.commit({
  posTransactionId: 'POS-2026-000481',
  customerRef: q.data.customer?.customerRef ?? null,
  cart: { subtotal: 42.0, currency: 'BAM' },
  redemption: q.data.redemptionToken
    ? { redemptionToken: q.data.redemptionToken, acceptDiscount }
    : null,
  tender: { finalAmount: 29.5, paymentMethod: 'card' },
});
if (sale.ok) print(sale.data.loyaltyReference, sale.data.pointsEarned);
```

## The envelope — calls never throw on API or network errors

Every method resolves to a `PosEnvelope<T>` discriminated union. Switch on `ok`:

```ts
const r = await loso.getConfig();
if (r.ok) {
  console.log(r.data.currency);
} else {
  console.warn(r.error.code, r.error.message); // stable code, cashier-safe message
}
```

A 4xx/5xx with a Loso body arrives as `{ ok: false, error }`. A transport failure (timeout, DNS,
CORS, offline) arrives as `{ ok: false, error: { code: 'loyalty.unreachable', retryable: true } }` —
so your till can **sell at full price** rather than crash. The Promise rejects only on programmer
error (a missing `baseUrl`/`apiKey`), never on an API outcome.

## Idempotency & safe retries

`commit` and `refund` need an `Idempotency-Key`. The SDK generates one if you don't pass it. On a
flaky network, prefer the retry helpers — they reuse **one** key across every attempt, so a
timeout that already landed server-side replays the original result instead of ringing up a second
sale:

```ts
const sale = await loso.commitWithRetry(request, { retries: 2, backoffMs: 300 });
```

Retries fire only on a `retryable` failure. A definitive rejection (e.g. `redeem.exceeds_cap`)
returns immediately.

## API

```ts
new LosoPosClient({ baseUrl, apiKey, auth?, fetch?, timeoutMs? });

loso.getConfig(): Promise<PosEnvelope<PosConfig>>;
loso.resolveCustomer(code): Promise<PosEnvelope<PosCustomer>>;
loso.quote(request): Promise<PosEnvelope<PosQuoteResponse>>;
loso.commit(request, idempotencyKey?): Promise<PosEnvelope<PosCommitResponse>>;
loso.getCommit(loyaltyReference): Promise<PosEnvelope<PosCommitResponse>>;
loso.refund(loyaltyReference, request, idempotencyKey?): Promise<PosEnvelope<PosRefundResponse>>;

loso.commitWithRetry(request, options?): Promise<PosEnvelope<PosCommitResponse>>;
loso.refundWithRetry(loyaltyReference, request, options?): Promise<PosEnvelope<PosRefundResponse>>;
```

- **`auth`** — `'key'` (default) sends `Authorization: Bearer <apiKey>`. `'proxy'` sends no
  `Authorization` header at all, for when `baseUrl` points at your own backend, which holds the
  key. In proxy mode `apiKey` must be omitted; passing one is an error rather than silently
  ignored, so a key can't sit unnoticed in a browser bundle.
- **`fetch`** — defaults to `globalThis.fetch`. Pass your own on Node < 18, or to route through a
  proxy / add logging.
- **`timeoutMs`** — per-request, default `10000`. Keep it short on `commit`.

## Security — where the key lives

A POS key authenticates as the merchant. **A browser is the wrong place to hold a live key** —
anyone with devtools can read it. In production, keep the key in your backend or native app and
have the browser talk to *your* server, which calls Loso.

```ts
// In the browser: no key, ever.
const loso = new LosoPosClient({ baseUrl: 'https://till.vendor.example/loyalty', auth: 'proxy' });

// On your backend: the key, and the real Loso base URL.
const upstream = new LosoPosClient({ baseUrl: 'https://api.loso.example', apiKey: process.env.LOSO_POS_KEY });
```

Use `pos_test_…` keys for browser demos. If you want drop-in UI rather than wiring this yourself,
[`@nscodecom/loso-pos-elements`](https://github.com/nscode-web-org/loso-pos-elements) builds on
this package and is proxy-only by construction.

## Compatibility

SemVer tracks the API version. This package targets `/api/pos/v1`; a breaking `/api/pos/v2` would
ship as a major release.

## Releasing

Publishing is automated: pushing a `v*` tag triggers the
[`publish`](.github/workflows/publish.yml) workflow, which typechecks, tests, builds, and runs
`npm publish`.

Authentication uses npm **trusted publishing** (OIDC) — no `NPM_TOKEN` secret is involved. GitHub
Actions presents a short-lived signed token that npm verifies against the trusted publisher
configured for this package. This works with two-factor auth enabled on the account, which
token-based publishing does not: npm is restricting 2FA-bypass tokens for direct publishing.
Provenance is attached automatically.

**One-time setup:**

1. Publish rights on the `nscodecom` npm organization, which owns the `@nscodecom` scope. Check
   with `npm org ls nscodecom <your-username>` — publishing needs `owner` or `developer`.
2. On npmjs.com, open the package → **Settings** → **Trusted Publisher** → GitHub Actions, and
   enter:
   - Organization: `nscode-web-org`
   - Repository: `loso-pos-sdk`
   - Workflow filename: `publish.yml`

The trusted publisher is configured per package, so the package must already exist on npm. The
first release therefore has to be published manually (`npm publish --access public`, which prompts
for a 2FA code); every tagged release after that goes through CI.

**Each release:**

```bash
npm version patch        # or minor / major — bumps package.json, commits, and tags vX.Y.Z
git push --follow-tags   # pushes the commit and the tag; the tag triggers the publish
```

`npm version` bumps `package.json`, makes a commit, and creates the matching `vX.Y.Z` tag in one
step. The workflow refuses to publish if the tag and `package.json` version disagree, and npm
refuses to publish a version that already exists — so a forgotten bump fails safely rather than
shipping the wrong thing.

To publish by hand instead (needs `npm login`): `npm publish` from the package root.

## License

MIT
