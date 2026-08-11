#!/usr/bin/env node
/**
 * Spike #68 — Stripe in-flight idempotency-key behaviour on a concurrent double-tap.
 *
 * Fires TWO PaymentIntent creates simultaneously with the SAME idempotency key,
 * in two client configurations, and reports what each call actually returned.
 *
 *   A) maxNetworkRetries: 0  → observes the RAW API response (expected: one 409
 *                              `idempotency_key_in_use` on the loser)
 *   B) maxNetworkRetries: 2  → the config `payments.module.ts` actually uses
 *                              (`new Stripe(key)` with no options). Expected: the
 *                              SDK absorbs the 409 (RequestSender._shouldRetry
 *                              returns true on 409) and both calls resolve.
 *
 * TEST MODE ONLY. Creates unconfirmed PaymentIntents (no customer, no card, no
 * money moves). Never prints the API key.
 *
 * Run:  STRIPE_SECRET_KEY=sk_test_... node spike68-double-tap.cjs
 *   or: node -r dotenv/config spike68-double-tap.cjs   (loads .env itself)
 */
const path = require('path');

const ROUNDS = Number(process.env.ROUNDS || 10);
const AMOUNT = 500;

function loadStripe() {
  // Use the repo's installed SDK so the observed behaviour is the version we ship.
  const repo = process.env.TAXI_REPO || path.resolve(__dirname);
  for (const p of [
    'stripe',
    path.join(repo, 'node_modules', 'stripe'),
    '/Users/Berzins/Desktop/taxi/node_modules/stripe',
  ]) {
    try {
      return require(p);
    } catch (_) {
      /* try next */
    }
  }
  throw new Error('Could not resolve the `stripe` package. Set TAXI_REPO.');
}

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set. Test-mode key required (sk_test_...).');
  process.exit(2);
}
if (!key.startsWith('sk_test_')) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is not a TEST-mode key (expected sk_test_ prefix).');
  process.exit(2);
}

const Stripe = loadStripe();

/** Everything we can learn about one settled promise, with no secrets in it. */
function describe(outcome) {
  if (outcome.status === 'fulfilled') {
    const v = outcome.value;
    const headers = (v.lastResponse && v.lastResponse.headers) || {};
    return {
      ok: true,
      httpStatus: v.lastResponse && v.lastResponse.statusCode,
      intentId: v.id,
      replayed: headers['idempotent-replayed'] === 'true',
      requestId: v.lastResponse && v.lastResponse.requestId,
    };
  }
  const e = outcome.reason || {};
  return {
    ok: false,
    httpStatus: e.statusCode ?? null,
    type: e.type ?? null,          // the SDK error CLASS name (e.g. StripeAPIError)
    rawType: e.rawType ?? null,    // Stripe's own `type` (e.g. idempotency_error)
    code: e.code ?? null,          // e.g. idempotency_key_in_use
    message: e.message ?? String(outcome.reason),
    requestId: e.requestId ?? null,
  };
}

async function round(stripe, label, n) {
  const idempotencyKey = `spike68-${label}-${process.pid}-${n}-${Math.random().toString(36).slice(2, 10)}`;
  const params = { amount: AMOUNT, currency: 'eur' };
  const opts = { idempotencyKey };

  const settled = await Promise.allSettled([
    stripe.paymentIntents.create(params, opts),
    stripe.paymentIntents.create(params, opts),
  ]);

  return settled.map(describe);
}

async function run(label, maxNetworkRetries) {
  const stripe = new Stripe(key, { maxNetworkRetries });
  console.log(`\n=== Config ${label} — maxNetworkRetries: ${maxNetworkRetries} ===`);

  const tally = { bothOk: 0, oneErrored: 0, bothErrored: 0, replays: 0, distinctIntents: 0 };
  const errors = [];

  for (let n = 0; n < ROUNDS; n++) {
    let results;
    try {
      results = await round(stripe, label, n);
    } catch (e) {
      console.log(`  round ${n}: harness error — ${e.message}`);
      continue;
    }
    const [a, b] = results;
    const okCount = results.filter((r) => r.ok).length;

    if (okCount === 2) tally.bothOk++;
    else if (okCount === 1) tally.oneErrored++;
    else tally.bothErrored++;

    for (const r of results) if (r.ok && r.replayed) tally.replays++;
    if (a.ok && b.ok && a.intentId !== b.intentId) tally.distinctIntents++;

    for (const r of results) if (!r.ok) errors.push(r);

    const fmt = (r) =>
      r.ok
        ? `ok ${r.intentId}${r.replayed ? ' (replayed)' : ''}`
        : `ERR ${r.httpStatus} ${r.type}/${r.rawType} code=${r.code}`;
    console.log(`  round ${n}: [${fmt(a)}] [${fmt(b)}]`);
  }

  console.log(`  --- ${label} summary over ${ROUNDS} rounds ---`);
  console.log(`  both succeeded ......... ${tally.bothOk}`);
  console.log(`  exactly one errored .... ${tally.oneErrored}`);
  console.log(`  both errored ........... ${tally.bothErrored}`);
  console.log(`  responses marked replay  ${tally.replays}`);
  console.log(`  DISTINCT intent ids ⚠ .. ${tally.distinctIntents}   (must be 0 — >0 means a double charge)`);

  if (errors.length) {
    const seen = new Map();
    for (const e of errors) {
      const k = `${e.httpStatus} ${e.type}/${e.rawType} code=${e.code}`;
      seen.set(k, (seen.get(k) || 0) + 1);
    }
    console.log('  error shapes:');
    for (const [k, count] of seen) console.log(`    ${count}× ${k}`);
    console.log(`  sample message: ${errors[0].message}`);
  }
  return tally;
}

(async () => {
  console.log(`Spike #68 — concurrent same-key double-tap · ${ROUNDS} rounds per config · TEST MODE`);
  const raw = await run('A(raw)', 0);
  const app = await run('B(app-default)', 2);

  console.log('\n=== VERDICT ===');
  console.log(`Q1 raw API      : ${raw.oneErrored > 0 ? 'the loser DOES error (see shapes above)' : 'no error observed — Stripe served both'}`);
  console.log(`Q2 our config   : ${app.oneErrored + app.bothErrored === 0 ? 'SDK absorbed it — the app sees no error' : 'an error REACHED the app (a settle would 502)'}`);
  console.log(`Money safety    : distinct intent ids across both configs = ${raw.distinctIntents + app.distinctIntents} (must be 0)`);
})().catch((e) => {
  console.error('fatal:', e.message);
  process.exit(1);
});
