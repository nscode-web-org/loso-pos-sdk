// ESM consumer of the packed tarball, under moduleResolution node16.
import { LosoPosClient, generateIdempotencyKey } from '@nscodecom/loso-pos-sdk';
import type { PosEnvelope, PosConfig } from '@nscodecom/loso-pos-sdk';

const client = new LosoPosClient({ baseUrl: 'https://example.test', apiKey: 'pos_test_x' });

const config: Promise<PosEnvelope<PosConfig>> = client.getConfig();
const key: string = generateIdempotencyKey();

// See cjs.cts — these guard against the types resolving to `any`.

// @ts-expect-error generateIdempotencyKey returns string, not number
const wrongType: number = generateIdempotencyKey();

// @ts-expect-error apiKey is required
const missingOption = new LosoPosClient({ baseUrl: 'https://example.test' });

// Proxy mode takes no key, and refuses one.
const proxied = new LosoPosClient({ baseUrl: 'https://till.example', auth: 'proxy' });

// @ts-expect-error apiKey is not accepted in proxy mode
const proxiedWithKey = new LosoPosClient({ baseUrl: 'https://till.example', auth: 'proxy', apiKey: 'pos_live_x' });

void config;
void key;
void wrongType;
void missingOption;
void proxied;
void proxiedWithKey;
