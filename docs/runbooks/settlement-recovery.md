# Runbook — recovering a stuck settlement (#67)

A ride sits at `completed` and will not reach `settled`. This is the by-hand
procedure until #15 gives the settle route a production caller and a retry.
It exists because **the safe recovery action depends on how old the failure
is and on the payment method** — the wrong combination bills a rider twice.

Sources of truth this document defers to: `settlement.policy.ts` (the
idempotency key and its 24-hour bound), the payments barrel
`services/api/src/features/payments/index.ts` (KNOWN GAPS, the reconciliation
query), and issue #68 (verified concurrent-conflict behaviour).

## 1 · Find stuck rides

Unsettled money is one query (from the payments barrel):

```sql
SELECT id, order_id, driver_id, payment_method, total_cents, updated_at
FROM rides WHERE status = 'completed' ORDER BY updated_at;
```

Any row older than a few minutes is stuck — nothing retries automatically
(no sweeper, no alert; accepted for the pilot).

## 2 · Diagnose from the logs

Search `payment.settlement.*` events for the rideId. Three shapes:

| you find | it means | go to |
|---|---|---|
| `payment.settlement.write_failed` | **The charge succeeded and the database write rolled back.** The event carries `rideId` and `providerRef` (the `pi_…` id) together — this is the one log line that ties the ride to the PaymentIntent, because the rollback set `rides.payment_provider_ref` back to NULL. | § 3 |
| `payment.stripe.charge_failed`, `reason: declined` | The rider must act (card refused, or SCA). Not recoverable from our side; the 402 told the driver the truth. | stop |
| `payment.stripe.charge_failed`, `reason: provider_error` | Transient. **Careful: a NULL `providerRef` here does NOT mean no charge landed** — a connection cut after Stripe took the money surfaces as `StripeConnectionError` with no response body, so there is no intent id to log. Treat it like `write_failed`. | § 3 |
| nothing at all | One of the refusal exits that never reaches the provider — #70 tabulates them (`payment_instrument_missing` and `payment_method_unsupported` are the two that bite). No money moved; fix the cause, then settle. | § 3, cash column |

## 3 · Pick the recovery path

Two questions decide everything: **card or cash**, and **is the FIRST charge
attempt less than ~24 hours old**.

|  | cash ride | card ride, **< ~24 h** | card ride, **> ~24 h** |
|---|---|---|---|
| action | re-POST settle, any time | re-POST settle | **STOP — dashboard first (§ 4)** |
| why it is safe | `settle` never calls the provider on cash; the retry is pure database work | the key `settle:<rideId>` replays the original PaymentIntent — Stripe returns the SAME intent, the rider cannot be charged twice | it is NOT safe — that is the point |

Re-POST means: `POST /rides/:rideId/settle` with a `dispatcher` or `admin`
token (the route accepts both precisely so a stuck ride is recoverable by
hand). The route is idempotent — if the ride actually settled, the answer is
a success-shaped 201 with the settled ride, never a 409.

Two verified behaviours you may hit on the way (issue #68, desk-verified
2026-08-10 against Stripe's error reference and `stripe@22.4.0`):

- **A concurrent double-submit is absorbed.** Stripe answers the second
  in-flight same-key request with `idempotency_key_in_use` (HTTP 409), and
  stripe-node retries a 409 automatically (default `maxNetworkRetries: 2`,
  ~1.0–1.5 s budget) — normally nobody sees an error, the settle just takes a
  second longer. *(One link — the `stripe-should-retry` header on the live
  409 — is pending a live run; see #68.)*
- **If a 502 `payment_provider_error` does surface, retry it.** That bucket
  is retry-SAFE by construction: inside the window the retry replays, and a
  settled ride answers with the settled ride.

## 4 · The > 24 h card path — check Stripe BEFORE re-POSTing

Stripe prunes idempotency keys after ~24 hours and *"generates a new request
if a key is reused after the original is pruned"* — so a late re-POST does
not replay; **it mints a SECOND PaymentIntent and bills the rider twice for
one ride.**

1. **Search the Stripe dashboard by metadata.** Every intent we create
   carries `metadata: { rideId }` (`stripe-payments.provider.ts`). Search for
   the rideId; cross-check against the `providerRef` in the `write_failed`
   log line if there is one.
2. **No succeeded PaymentIntent found** → the rider was never charged.
   Re-POST settle: the pruned key starts a fresh window and one clean charge
   lands. Done.
3. **A succeeded PaymentIntent exists** → the rider paid; only the database
   missed it. Do NOT re-POST first, and do NOT hand-write `rides.status`,
   `ledger_entries`, or `drivers.balance_cents` in SQL — that bypasses
   `assertTransition()` and the balanced six-entry posting, the two
   invariants everything downstream reconciles against. Instead:
   1. **Refund the succeeded PaymentIntent in the dashboard** (full refund).
   2. **Re-POST settle.** A fresh charge lands and the ride settles through
      the only writers the codebase allows.
   3. The rider's statement shows a refund and a new charge. Acceptable at
      pilot scale; note it in the support thread if the rider asks.

## 5 · Verify

After any recovery: the ride is `settled`, `SELECT count(*) FROM
ledger_entries WHERE ride_id = …` returns 6, and the driver's balance moved
exactly once. If any of the three disagree, stop and treat it as a new
incident — do not re-run the recovery.
