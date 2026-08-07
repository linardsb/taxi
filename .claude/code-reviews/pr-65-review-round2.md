# Code Review — PR #65, round 2

**`fix(api): make the settlement slice's safety claims true (#12)`**
`feature/api-payments-ledger` → `main` · fix commit `acd79f8` (11 files, +711/−71) · reviewing the round-1
fixes against [`pr-65-review.md`](./pr-65-review.md)

**Recommendation: APPROVE, with one line worth fixing first.** 0 Critical, 0 High, 4 Medium, 7 Low.
Validation independently re-run and green. Every round-1 fix is behaviourally correct; the residue is that
several of them are *described* as covering more than they cover.

---

## Summary

Two `code-reviewer` agents reviewed in a clean context — one on the settlement service/controller, one on the
Stripe provider/ledger — each instructed to **refute** the fix claims rather than confirm them. I then
re-verified every load-bearing finding against primary sources myself, and **the two agents contradicted each
other on the most important one.** Resolving that disagreement is this review's main output.

**All eight round-1 findings were addressed, and seven landed cleanly.** The eighth — round-1 finding 5, the
rider→403 test — is the one below.

The round-1 theme has not fully cleared. It has, however, changed character: round 1 found comments claiming
protections the code lacked. Round 2 finds **fixes that work, described as covering hazards they don't.**
Nothing here costs money today, and nothing is a runtime defect.

---

## The agents disagreed — and one was wrong

| | Claim about the new rider→403 test |
|---|---|
| Provider/ledger agent | It **cannot** distinguish `RolesGuard`'s 403 from the controller's, so `@Roles` is still unpinned |
| Settlement agent | Round-1 finding 5 is "**now true** — the decorator list is pinned at HTTP level" |

**Settled empirically, not by argument.** I added `'rider'` to `@Roles` at `settlement.controller.ts:53` and
re-ran the test:

```
Tests: 7 skipped, 1 passed, 8 total
```

**It still passes.** The provider/ledger agent is right. The settlement agent asserted the conclusion without
running the discriminating case — a reminder that a second reviewer agreeing is not verification.

---

## Findings

Routed per `.claude/references/conventions.md`. **AGENT FIXES is deliberately empty** — the entire diff is
money-, auth- and ride-state-adjacent, which that rubric bars from automated fixing.

### HUMAN READS

**1 · Medium — the new rider→403 test cannot detect the change it says it detects**
`services/api/src/features/payments/payments.integration.spec.ts:513-531`

Its comment claims *"Adding `'rider'` to it now fails here instead of reaching `SETTLEMENT_ACTORS`."* Both
paths answer 403 — `RolesGuard` throws `ForbiddenException('insufficient_role')`
(`auth/guards/roles.guard.ts:33,37`), the controller throws `ForbiddenException('role_cannot_settle')`
(`settlement.controller.ts:66-67`) — and the test asserts only `.expect(403)`.

**Confirmed by experiment above: adding `'rider'` to `@Roles` leaves the suite green.** The three follow-up
assertions (`payments.calls` empty, ride still `completed`, no ledger entries) hold on that path too, because
the controller throws before `settle()` runs.

The two round-2 fixes cancelled each other: fixing round-1 finding 2(a) removed the 201-shaped symptom that
finding 5's test was designed to catch, and the test was written to assert only the status code. So
round-1 finding 5's stated purpose — pinning *this route's* `@Roles` list — is **not achieved**, while its
comment says it is. That is round 1's defect species, reintroduced by the fix for round 1.

**Fix (one line),** using the body-cast idiom already at `:487`:

```ts
const res = await http.post(`/rides/${ride.id}/settle`)
  .set('authorization', r.auth).expect(403);
expect((res.body as { message: string }).message).toBe('insufficient_role');
```

`'insufficient_role'` is reachable only from `RolesGuard`. **This is the one I'd fix before merge** — it is
the difference between having a regression guard and believing you have one.

---

**2 · Medium — the barrel's "every failure logs" survived an edit that made it only nearly true**
`services/api/src/features/payments/index.ts:38-41`

The sentence was *edited* in this commit (to name `write_failed`) and kept the word "every". Six of nine
failure exits in `settle()` emit no `payment.settlement.*` line at all:

| exit | line | logs? |
|---|---|---|
| `ride_not_found` 404 | `settlement.service.ts:107` | none |
| `ride_not_yours` 403 | `:113` | none |
| `ride_not_completed` 409 | `:124` | none |
| missing-split `Error` 500 | `:236` | none |
| `payment_method_unsupported` 409 | `:64` | none |
| `payment_instrument_missing` 409 | `:272` | none |
| declined 402 / provider error 502 | `:290-291` | `charge_failed` ✓ |
| transaction / COMMIT failure 500 | `:177` | `write_failed` ✓ |

**Not hypothetical:** `rideRequestBodySchema` is `rideRequestSchema.omit({ riderId: true })` and
`paymentMethod` is `z.enum(PAYMENT_METHOD_TYPES)` (`packages/shared/src/schemas/ride.ts:79,100`), so **a rider
can book a `balance` ride today.** It dispatches, completes, and every settle attempt 409s forever. The ride
sits `completed`, the barrel's own reconciliation query surfaces it, and nothing says why. Same shape for
`payment_instrument_missing`, which the barrel's KNOWN GAPS names as the expected outcome for *every* card
ride until #17.

**Mitigating, and it matters:** the provider is never reached on any unlogged path, so no money can be
stranded. The "charged vs never charged" ambiguity round 1 actually cared about **is** closed.

**Fix:** narrow the sentence to *"every charge and write failure logs…"*, or add a `logRejected` line to the
two 409 refusals. The doc edit is the honest minimum.

---

**3 · Medium — the new non-card-error test uses an error shape the SDK cannot produce**
`services/api/src/features/payments/stripe-payments.provider.spec.ts:185-204`

Verified in the installed `stripe@22.4.0`:

- `cjs/Error.js:97` — `this.payment_intent = raw.payment_intent` sits on the **base** `StripeError`, so
  subclasses built from an HTTP response body (`StripeAPIError`, `StripeInvalidRequestError`,
  `StripeIdempotencyError`, `StripeRateLimitError`) **can** carry it. *The fix is real for those.*
- `cjs/RequestSender.js:419-424` — `StripeConnectionError` is constructed **locally** from
  `{ message, detail }`. No HTTP response arrived, so it can **never** carry a `payment_intent`.

The test's fixture is `{ type: 'StripeConnectionError', … payment_intent: { id: 'pi_test_inflight' } }` —
unreachable in production, and it picks the one class where the handle is structurally unavailable.

**Failure scenario:** a €25 card ride; `paymentIntents.create` times out after Stripe charged. `describe()`
returns `providerRef: null`, `charge_failed` logs a null ref, 502. `write_failed` never fires — nothing
reached the transaction. Rider charged, ride `completed`, no log names a PaymentIntent. Recovery is
`metadata.rideId` in the dashboard only (round-1 finding 9 / issue #67). The test reads as if this is covered.

**Fix:** change the fixture's `type` to `'StripeAPIError'`, and add one sentence at
`stripe-payments.provider.ts:80` noting the timeout case still recovers only through `metadata.rideId`.

---

**4 · Medium — the `processing` test comment credits the fix with recoverability it doesn't deliver**
`services/api/src/features/payments/stripe-payments.provider.spec.ts:124-130`

> *"Because the key is ride-derived, that 402 then replays from Stripe's cache for the whole 24h key window,
> so the ride cannot be settled by retrying."*

That is a property of the **ride-derived key**, not of the 402 — it applies identically to the 502 the fix now
produces. `STATUS_REASON.processing === 'provider_error'` → `settlement.service.ts:289-291` → 502; Stripe
replays the same cached response for the same key; `index.ts:22-24` confirms there are no webhooks, so nothing
else advances the ride. **A `processing` intent strands the ride under both bucketings.**

The gain is real but **diagnostic**: an honest `reason` in the log, an honest HTTP class, and the right bucket
for a dispatcher on the phone. Two further notes: the 24h figure is the round-1 reviewer's unverified claim
(issue #67), carried into a code comment as fact — it was softened in the commit message but not here; and
`provider_error`/502 is the bucket clients *are* encouraged to retry, which slightly raises the odds of a
retry past key expiry minting a second PaymentIntent.

**Do not change the bucketing — round 1 asked for it and it is right.** Reword the comment.

---

### HUMAN DECIDES

**5 · Low — `asc(ledgerEntries.id)` buys stability, not "oldest first"**
`services/api/src/features/ledger/ledger.repository.ts:108,112-116`

`ledger_entries.id` is `uuid('id').primaryKey().defaultRandom()` (`db/src/schema/ledger.ts:41`) — random v4,
not insertion-ordered. Sharper than round 1 knew: because the transition **is** the settlement lock, a ride
settles exactly once, so all six rows share one `transaction_timestamp()` and `asc(createdAt)` is fully
vacuous — the effective order is 100% random-stable UUID.

Round-1 finding 6's actual goal (a stable sequence across two requests) **is achieved**, and `asc(id)` was the
prescribed fix. The docblock's "oldest first" headline is what's now false. **Your call:** reword to "in a
STABLE order", or, if #20 needs a logical sequence (fare → commission → collection), that is an explicit
`ORDER BY entry_type` and a separate ticket.

---

**6 · Low — `actor === null` misses `undefined`; `if (!actor)` makes the local claim locally true**
`services/api/src/features/payments/settlement.controller.ts:66`

`SETTLEMENT_ACTORS[user.role]` returning `undefined` would flow into `settle({ actor: undefined })`, where
`input.actor === 'driver'` is false and the ownership check is skipped — a silent full override, the exact
round-1 finding 2(a) hazard re-expressed.

**Unreachable today, but not because of this file:** `AuthTokenService.verify` runs `jwtClaimsSchema.parse`
(`auth/auth-token.service.ts:36`) and `role` is `z.enum(USER_ROLES)`, so `user.role` is always a `UserRole`.
The finding is that the docblock claims the fail-closed property *locally* while the property comes from a zod
parse in another slice. One character fixes it.

---

### HUMAN TESTS

**7 · Low — the spy-restore comment argues against the code it annotates**
`services/api/src/features/payments/settlement.service.spec.ts:162-165`

> *"A per-test restore would leak the spy into every test below on the first failed assertion."*

The code below it **is** a per-test restore — `afterEach(() => jest.restoreAllMocks())` runs after every test,
including a failing one, and does not leak. The pattern that leaks is an *in-body* `mockRestore()` skipped by a
thrown assertion. Reword to "An in-body restore would leak…". (The `afterEach` itself is correct and worth
keeping; both agents confirmed the spy tests bite and cannot pass vacuously.)

---

### FYI

**8 · Low — two non-equivalent definitions of `declined` now live in one file.**
`stripe-payments.provider.ts:18` says *"the rider's instrument SAID NO"*; `:94-96` says *"the rider MUST DO
SOMETHING"*. `requires_action` (SCA) satisfies the second, not the first — the instrument didn't refuse, it
demanded identity proof. The bucketing is right; the hazard is that the `Record`'s whole stated job is to stop
a future SDK bump until someone buckets a new status, and that person is handed two rules that disagree.

**9 · Low — a pre-existing test title now contradicts the `it.each` three lines below it.**
`stripe-payments.provider.spec.ts:93` — *"treats a returned non-succeeded intent as declined"* is the generic
claim round-1 finding 3 identified as wrong, and `:121-140` now asserts the opposite for three other
non-succeeded statuses. Rename to name `requires_payment_method` specifically.

**10 · Low — `write_failed`'s comments under-enumerate the null cases.** `settlement.service.ts:173` states
"the charge succeeded and the write did not" flatly, but the `.catch()` also fires when no charge happened;
`:333` says "`providerRef` is null on a cash ride" and misses the **zero-amount card ride**, where
`chargeIfNeeded` returns `null` at `:268`. No runtime defect — `?? null` is emitted correctly.

**11 · Low — `SETTLEMENT_ACTORS` uses a type annotation where a sibling documents `as const satisfies`.**
`settlement.controller.ts:25` vs `rides/lifecycle/ride-lifecycle.policy.ts:25-35`, which records the house rule
and why. Zero behavioural difference here (the annotation's value type is already the target), and
exhaustiveness holds either way.

---

## Validation

`pnpm turbo run typecheck lint test build --force`, docker up, `REDIS_TEST_URL` set:

| Package | Typecheck | Lint | Tests |
|---|---|---|---|
| `@taxi/shared` | pass | pass | 11 files |
| `@taxi/db` | pass | pass | 3 files |
| `@taxi/api` | pass | 0 errors, 6 warnings | **375 passed, 48 suites** |

**Tasks: 20 successful, 20 total · 0 cached.** Up from 364/47 at round 1 — the 11 new tests and 1 new suite.
The 6 warnings are the same pre-existing `no-unsafe-argument` on `app.getHttpServer()`.

---

## What held up under attack

Both agents were told to refute; these are what survived, verified against primary sources rather than assumed:

- **The `.catch()` is more thorough than the commit claims.** Verified against drizzle's own
  `node_modules/drizzle-orm/node-postgres/session.js:180-196`: `await tx.execute(sql\`commit\`)` sits **inside**
  the `try`, so a **COMMIT-time rollback** (serialization failure, deferred constraint) rejects the promise and
  fires the log too — not just callback throws. `BEGIN` and `connect()` failures likewise. **No path exists
  where the charge succeeded and no log names `rideId` + `providerRef`.** The two post-commit exits were
  checked as well: `emitStatus` has its own try/catch, and the `settled` log fires before `readRide`.
- **`lost_race` is untouched** — `return undefined` *resolves*, and `.catch()` only runs on rejection.
- **The rethrow is faithful** and the catch body's `never` return type keeps `result` from widening — which
  matters, since a callback returning `undefined` would make every write failure look like a lost race. HTTP
  status unchanged, pinned by the existing `.expect(500)`.
- **`STATUS_REASON` is genuinely exhaustive and the narrowing is sound.** `Stripe.PaymentIntent.Status` is
  closed at seven literals with no `OtherString` (`PaymentIntents.d.ts:631`, both esm and cjs);
  `intent.status` narrows correctly after the `=== 'succeeded'` early return; `noUncheckedIndexedAccess` does
  not apply to a `Record` over a finite union, so `?? 'provider_error'` is type-level dead but a real runtime
  guard, exactly as its comment says. Lint-clean because `no-unnecessary-condition` lives in
  `strictTypeChecked`, not `recommendedTypeChecked`.
- **The bucketing is correct on the merits.** `canceled` → `provider_error` is right (not "the instrument said
  no", so `declined` would be a lie); `requires_capture` → `provider_error` is right (no `capture_method` is
  sent, so it would be a config bug); `requires_confirmation` is unreachable under `confirm: true`.
- **`settlementMethodOf` preserves the original ordering** — still ahead of the `totalCents === 0` and
  `riderCustomerRef === null` checks. Its `never` arm is load-bearing, not decorative: `rides.payment_method`
  crosses a **database enum** boundary, so a DB enum extended without a deploy yields a value the union
  doesn't know.
- **`describe()` returning `intentId` on both branches weakens nothing.** Every surviving `providerRef: null`
  fixture lacks a `payment_intent` field, so those cases still exercise the null arm — and would now *fail* if
  a fixture carried an intent, which was not true before.
- **Round-1 finding 4 is correctly fixed** — `dispatch-strategies.md:6,8` now matches
  `candidate-filter.ts:45`, and the "travels on `DispatchContext`" claim is backed by
  `packages/shared/src/seams/dispatch-strategy.ts:23`. The regression path round 1 named is closed.
- **Hard rules clean:** integer cents throughout; status only via `transitionInTx`; operative
  `ride.paymentMethod` read, never `request.paymentMethod`; Stripe SDK still confined to the slice;
  `packages/shared` still imports nothing from the workspace; both changed files well under 500 lines.

## What is genuinely good

- **`SETTLEMENT_ACTORS` is the model fix of this commit.** It states explicitly that its guarantee is
  *narrower* than the ternary's comment claimed — "No type can connect a `@Roles(...)` decorator argument to a
  mapping … what changed is where it lands." That is precisely the honesty round 1 asked for, applied to the
  fix itself rather than only to the code being fixed.
- **Declining the reviewer's own suggested fix for 2(b) was correct.** Round 1 proposed failing closed at the
  ledger call; that line is inside the transaction, after the charge, so a throw there would have manufactured
  finding 1. Moving the narrowing above `chargeIfNeeded` is the right shape, and the comment says why.
- **`logWriteFailed`'s docblock explains why `charge_failed` cannot cover the case** (the charge succeeded) and
  why the line still fires on cash with a null ref. Round 1 asked for a log; this delivered a reason.
- **Finding 6 shipped without a fake test.** The commit states plainly that ordering determinism cannot be
  asserted against six identical timestamps, rather than inventing one that proves nothing.

---

## Recommendation

**APPROVE.** The gate is green and independently reproduced. No Critical or High issues, no runtime defects,
no hard-rule violations. Every round-1 finding was addressed and seven of eight landed cleanly.

**Fix finding 1 before merge** — one line, and without it the `@Roles` list on the money route has a guard that
looks like a regression test but is not one. Findings 2–4 are doc/comment edits worth taking in the same pass;
5–11 are polish.

The standing theme, now in its second round: *the code is right and the prose oversells it.* Findings 1–4 are
each a claim that a hazard is covered when what actually improved is diagnosis, stability, or reason-honesty.
That is a much smaller gap than round 1's, and it is worth naming rather than fixing silently — the comments in
this slice are load-bearing precisely because the next reader will trust them.

*Round 2 reviewed per `piv-review-pr`: two `code-reviewer` agents in a clean context, instructed to refute
rather than confirm. Where they disagreed, the disagreement was settled by experiment. Every finding above was
re-verified against the file or the installed dependency before inclusion.*
