# Spike #68 — Stripe in-flight idempotency-key behaviour on a concurrent double-tap

**Verdict: both hypothesised consequences are REFUTED at primary source — no code change needed. Live confirmation pending (one harness run, ~30s, needs a test key).** Issue [#68](https://github.com/linardsb/taxi/issues/68), deferred from the PR #65 review (finding 10, FYI).

The ticket named the wrong error. The in-flight case is not `idempotency_error`; it is **`idempotency_key_in_use` at HTTP 409**, and **stripe-node retries 409 automatically with the default client we construct**. So the losing half of a double-tap is absorbed inside the SDK and never reaches our code.

## The question

`chargeIfNeeded` runs before and outside the transaction (correctly — a provider call cannot be rolled back), so two concurrent settles for one ride both reach `payments.charge()` with the **same** ride-derived key before either reaches `transitionInTx`. The ticket asked what Stripe does with the second one, and flagged two consequences if it errors:

1. A driver double-tapping Settle could see a spurious **502**.
2. The provider's comment that a `StripeIdempotencyError` "is a real bug worth seeing" would be **too strong** and should be softened.

## Evidence

### DOCUMENTED — the concurrent case is `idempotency_key_in_use` / 409, not `idempotency_error`

Stripe's error reference defines the type the ticket hypothesised, and its definition **excludes** the in-flight case:

> `idempotency_error` — *"Idempotency errors occur when an `Idempotency-Key` is re-used on a request that does not match the first request's API endpoint and parameters."*
> — [docs.stripe.com/api/errors](https://docs.stripe.com/api/errors)

That is the same-key-**different-parameters** case. The concurrent case has its own error code:

> `idempotency_key_in_use` — *"The idempotency key provided is currently being used in another request. This occurs if your integration is making duplicate requests simultaneously."*
> — [docs.stripe.com/error-codes](https://docs.stripe.com/error-codes)

…and its own status:

> `409 | Conflict | The request conflicts with another request (perhaps due to using the same idempotent key).`
> — [docs.stripe.com/api/errors](https://docs.stripe.com/api/errors)

Stripe also states the result is not cached for this case, and that it is retryable:

> *"We save results only after the execution of an endpoint begins. If incoming parameters fail validation, **or the request conflicts with another request that's executing concurrently**, we don't save the idempotent result because no API endpoint initiates the execution. **You can retry these requests.**"*
> — [docs.stripe.com/api/idempotent_requests](https://docs.stripe.com/api/idempotent_requests)

### VERIFIED IN THE INSTALLED SDK (`stripe@22.4.0`) — a 409 is retried before we ever see it

**1 · A 409 cannot produce `StripeIdempotencyError`.** The class is gated on status 400/404, so a 409 falls through to `StripeAPIError` (`cjs/Error.js:8-25`):

```js
if (statusCode === 400 || statusCode === 404) {
    if (rawStripeError.type === 'idempotency_error') return new StripeIdempotencyError(rawStripeError);
    return new StripeInvalidRequestError(rawStripeError);
}
// 401 → Authentication · 402 → Card · 403 → Permission · 429 → RateLimit
return new StripeAPIError(rawStripeError);   // ← 409 lands here
```

**2 · The SDK retries 409 by default** (`cjs/RequestSender.js:176-179`):

```js
// Retry on conflict errors.
if (res.getStatusCode() === 409) {
    return true;
}
```

**3 · Our client takes that default.** `stripeClientFactory` is `new Stripe(env.STRIPE_SECRET_KEY)` with **no options** (`payments.module.ts`), and the default is **2** retries (`cjs/stripe.core.js:171` — `validateInteger('maxNetworkRetries', props.maxNetworkRetries, 2)`).

**4 · The retry budget is ~1.0–1.5 s over 3 attempts.** `INITIAL_NETWORK_RETRY_DELAY_SEC = 0.5`, `MAX_NETWORK_RETRY_DELAY_SEC = 5` (`cjs/stripe.core.js:100-101`); `_getSleepTimeInMS` is `min(0.5·2^(n−1), 5)` with jitter, floored at the initial delay — so ≈0.5 s before retry 1 and ≈0.5–1.0 s before retry 2.

**Chain:** concurrent double-tap → Stripe 409 `idempotency_key_in_use` → SDK retries → by then the winner's request has completed → the retry receives the replayed result → `charge()` returns `ok: true` with the **same** PaymentIntent. Our code sees no error.

### NOT YET OBSERVED — the one link that cannot be checked locally

`_shouldRetry` consults the response header **before** the 409 rule (`RequestSender.js:170-175`):

```js
if (res.getHeaders()['stripe-should-retry'] === 'false') return false;
if (res.getHeaders()['stripe-should-retry'] === 'true')  return true;
```

So if Stripe attaches `stripe-should-retry: false` to the 409, the retry is suppressed and the error **does** surface. The documentation ("*You can retry these requests*") points the other way, but the header itself is only observable against the live API. **That is the whole reason to run the harness**, and it is the only open link in the chain.

## Answers to the ticket

| ticket claim | verdict |
|---|---|
| Stripe *may* return an `idempotency_error` for a same-key request still in flight | **Wrong error.** By Stripe's own definition `idempotency_error` is the mismatched-parameters case. The in-flight case is `idempotency_key_in_use` / 409. |
| Consequence 1 — a double-tap could show a spurious **502** | **Refuted for the normal case.** The SDK absorbs the 409. Reachable only in the tail, if the winning request outlasts the ~1.0–1.5 s retry budget; then it arrives as `StripeAPIError` → `provider_error` → 502, which is the retry-SAFE bucket and the correct classification. |
| Consequence 2 — the `StripeIdempotencyError` comment is too strong | **Refuted outright.** That class cannot arise from a concurrent double-tap at all (409 ≠ 400/404). The comment is correct as written and needs no softening. |
| "Money stays safe either way — one derived key, one PaymentIntent" | **Holds.** Nothing in the concurrent path can mint a second intent inside the 24 h window; the loser either replays the winner's intent or errors without creating one. |

## Recommendation

1. **No code change.** Both consequences are refuted; the comment the ticket targeted is right.
2. **Do not write a comment asserting 409 behaviour until the harness has run.** Rounds 1–4 of this slice were all "the code is right and the prose oversells it" — a comment stating unobserved API behaviour would reintroduce exactly that. If the run confirms, the *optional* addition is one clause on the lost-race comment in `settlement.service.ts` noting that the simultaneous case is absorbed by SDK retry rather than reaching the `!result` arm.
3. **Worth knowing operationally:** a double-tap costs up to ~1.5 s of extra latency inside `charge()` while the SDK retries. Harmless, but it is why a double-tapped settle can feel slow.
4. **Leave `maxNetworkRetries` at the default.** The default is what makes this safe; setting it to 0 would expose the 409 to callers.

## What it means for the code

Nothing changes today. Three things are now pinned for whoever touches this next:

- `StripePaymentsProvider.describe()`'s `StripeIdempotencyError` note is **verified correct** — it can only fire on same-key-different-parameters, which for us would mean the frozen settled split changed between attempts. A real bug, as it says.
- A concurrent-conflict 409 buckets as `provider_error` (retry-SAFE) via the asymmetric default in `isCardError`. That is the right bucket, arrived at without anyone having considered 409 — worth noting as evidence the default is well-chosen rather than lucky.
- #66 (deriving the harness fake's `providerRef` from the idempotency key) is where a 409 would have to be simulated if we ever want this in the suite. **Run this spike before #66.**

## Harness + protocol (pending run)

`spikes/stripe-idempotency/double-tap.cjs` — zero-dependency, bare Node, outside the pnpm workspace like `spikes/gps-harness/` (so `pnpm check` never sees it). It deliberately resolves `stripe` from the monorepo's `node_modules` rather than installing its own, because the thing under test is the version we actually ship.

It fires two `paymentIntents.create` calls simultaneously with one shared idempotency key, ×10 rounds, in **two** configurations — because they answer different questions:

| config | `maxNetworkRetries` | question |
|---|---|---|
| A | `0` | What does the **API** return? (the only config that can observe the raw 409) |
| B | `2` | What does **our app** see? (the default `payments.module.ts` takes) |

TEST MODE ONLY — unconfirmed PaymentIntents, no customer, no card, no money moves. The script refuses any key without an `sk_test_` prefix and never prints the key.

```bash
# from the repo root; ROUNDS=10 by default
STRIPE_SECRET_KEY=sk_test_... node spikes/stripe-idempotency/double-tap.cjs
```

**What each outcome means:**

- **A errors with `409 … code=idempotency_key_in_use`, B has zero errors** → the chain above is confirmed end to end. Close the spike, no code change.
- **A and B both error** → Stripe sends `stripe-should-retry: false`; consequence 1 is real after all, and the lost-race comment needs the 502 path documented.
- **Neither errors** → Stripe serializes same-key requests rather than conflicting. Even better; record it and close.
- **`DISTINCT intent ids > 0` in any config** → stop. That would be a genuine double charge and a far bigger finding than the ticket.
