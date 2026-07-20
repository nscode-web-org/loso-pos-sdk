// CommonJS consumer of the packed tarball, under moduleResolution node16.
//
// This is the case that regressed silently: package.json sets "type": "module",
// so a .d.ts is an ESM declaration, and a require-condition pointing at one
// fails with TS1479. Only a .d.cts satisfies it.
import { LosoPosClient, generateIdempotencyKey } from '@nscodecom/loso-pos-sdk';
import type { PosEnvelope, PosConfig } from '@nscodecom/loso-pos-sdk';

const client = new LosoPosClient({ baseUrl: 'https://example.test', apiKey: 'pos_test_x' });

const config: Promise<PosEnvelope<PosConfig>> = client.getConfig();
const key: string = generateIdempotencyKey();

// The checks above pass just as happily if the types silently widen to `any`,
// which is exactly what a broken resolution looks like. The two below must
// ERROR instead. An expect-error directive is itself a build failure when the
// line it guards turns out to be valid, so types degrading to `any` get caught
// rather than reported as green.

// @ts-expect-error generateIdempotencyKey returns string, not number
const wrongType: number = generateIdempotencyKey();

// @ts-expect-error apiKey is required
const missingOption = new LosoPosClient({ baseUrl: 'https://example.test' });

void config;
void key;
void wrongType;
void missingOption;
