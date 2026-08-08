# Code Review — PR #65, round 3

**`feature/api-payments-ledger` → `main`** · commits `1bb5a34`, `f9d8916`, `77560dd` (10 files, +435/−33)
· reviewing the round-2 fixes against [`pr-65-review-round2.md`](./pr-65-review-round2.md)

**Recommendation: APPROVE, with three comment edits and one ~8-line test worth taking first.**
0 Critical, 0 High, 3 Medium, 4 Low. Validation independently re-run and green.

**Every round-2 finding (1–10) was addressed and all ten landed behaviourally correct.** Finding 11 was
declined on the record as a style nit. What round 3 finds is that the *fixes* carry three new claims their
own code contradicts — the same species, one level up, for the third round running.

---

## Method, and its one honest limitation

**The author of the fixes coordinated this review.** That is the wrong person for fresh eyes, so the deep
pass went to two `code-reviewer` agents in clean context, each instructed to **refute** rather than confirm,
with scope split (settlement controller/service/specs · Stripe provider/barrel/ledger). One died to an API
error after finishing its verification and was resumed from its own transcript to write up what it had
already established.

The agents are read-only. **Every empirical claim below was run by the coordinator**, not asserted — which
is exactly the gap round 2 identified when one of its agents asserted a conclusion without running the
discriminating case.

---

## The headline: two comments, the same error, opposite directions

The two agents worked different files and each found one half of a single defect. Neither half is visible
from inside its own file.

| | claim | what the code does |
|---|---|---|
| `settlement.service.ts:172` | *"**THE ONLY PATH THAT CAN LOSE MONEY**"* | over-claims uniqueness — the 502 at `:293-295` is a second path where money moved and nothing was written |
| `stripe-payments.provider.ts:86-91` | *"the ride is **recoverable only through `metadata.rideId`** in the Stripe dashboard"* | under-claims recovery — a retried settle replays the same PaymentIntent and settles the ride |

Both concern the **same pair of paths**, and the truth is a third thing neither states:

- The `.catch()` path (charge succeeded, write rolled back) and the timeout path (charge succeeded, no
  response) are **both** "money moved, ride not settled".
- **Both recover identically and automatically on retry**, because the key is ride-derived —
  `settlement.policy.ts:4-8` says so in as many words: *"the retry presents the same key, Stripe returns the
  original PaymentIntent instead of creating a second one."*
- What actually differs is **whether the log names the PaymentIntent** — i.e. whether an operator *knows* to
  retry. `write_failed` carries `providerRef`; the timeout's `charge_failed` carries `null`.

So the residue on both paths is **diagnostic, not financial**. One comment makes it sound worse than it is,
the other makes a different path sound worse than it is, and a reader holding both is misled twice.

Strengthening the second half: `node_modules/stripe/cjs/stripe.core.js:171` defaults `maxNetworkRetries`
to **2**, so the SDK has already retried the timed-out request twice under the same key before it ever
constructs the `StripeConnectionError`.

---

## Findings

### HUMAN READS

**1 · Medium — the `@Roles` fix pins `rider`'s exclusion, and its comments claim it pins the list**
`services/api/src/features/payments/payments.integration.spec.ts:522-524` ·
`services/api/src/features/payments/settlement.controller.spec.ts:30-31`

The round-2 finding-1 fix works: asserting `insufficient_role` genuinely discriminates `RolesGuard`'s 403
from the controller's `role_cannot_settle`. **Verified by running it** — with `'rider'` added to `@Roles`:

```
Expected: "insufficient_role"
Received: "role_cannot_settle"
```

But two comments describe it as pinning the whole decorator list:

> *"`insufficient_role` is reachable only from the guard, so asserting it is what pins the decorator list."*
> *"the route's decorator list is pinned at HTTP level in `payments.integration.spec.ts`."*

Of the **10** `/settle` calls in the integration spec, **9 use driver auth and 1 uses rider auth. Zero use
dispatcher or admin.** A `dispatcher()` helper exists at `:176` but only force-assigns; there is no admin
helper in the file at all.

**Proven, not argued.** Deleting `'dispatcher'` from `settlement.controller.ts:53`:

```
Test Suites: 48 passed, 48 total
Tests:       376 passed, 376 total
```

Typecheck and lint pass too — no type connects a `@Roles` argument to `SETTLEMENT_ACTORS`, as the
controller's own docblock says at `:18-20`. And the capability that silently breaks is not incidental:
`payments/index.ts:36-38` sells it as one of three named mitigations for having no settlement sweeper —
*"the route is idempotent and callable by `dispatcher`/`admin` (so a stuck ride is recoverable by hand
today)."* **The slice's stated risk story rests on a path no test exercises.**

**Fix (minimum):** narrow both comments — the test pins that `rider` is EXCLUDED, not that dispatcher/admin
are INCLUDED.
**Fix that closes it (~8 lines, preferred):** settle one completed ride through `dina.auth` with
`.expect(201)`. The `dispatcher()` helper already exists, and it doubles as the only end-to-end proof of the
by-hand recovery path the barrel advertises.

---

**2 · Medium — the money-path pair above**
`services/api/src/features/payments/settlement.service.ts:172` (restated at
`settlement.service.spec.ts:348`) · `services/api/src/features/payments/stripe-payments.provider.ts:86-91`

Detailed in the headline section. Both sentences were written or edited by these commits — the superlative
survived the very edit that was about that comment's accuracy (round-2 finding 10), and the dashboard clause
is new in `1bb5a34` and was already flagged and partly corrected in `f9d8916` without this error being
caught.

**Failure scenario:** an on-call engineer reads `settlement.service.ts:172`, builds reconciliation on
`write_failed` plus the barrel's `WHERE status = 'completed'` query, and concludes any completed ride
without a `write_failed` line was never charged. Every timed-out card ride is misclassified. Reading the
provider comment instead, they go to the Stripe dashboard to reconcile by hand when re-POSTing the settle
route would have closed it correctly and idempotently.

**Fix:** make both sentences tell the one true story — *"the only path where the charge succeeded and the
write did not"* on one side; on the other, *"the RIDE still recovers the ordinary way (the key is
ride-derived); what is lost is the DIAGNOSIS — at failure time nothing in the log says a charge may already
have landed."*

---

**3 · Medium — "THIS IS THE FILE'S ONE RULE" states a test with no discriminating power**
`services/api/src/features/payments/stripe-payments.provider.ts:18-23`

Round-2 finding 8 asked for one rule instead of two contradictory definitions of `declined`. **The
structural ask was met** — `STATUS_REASON`'s docblock now defers to the top instead of asserting a rival
definition. The problem moved inside the rule:

> *"`declined` means THE RIDER MUST ACT — **retrying this charge unchanged cannot succeed**."*

Under a ride-derived key, Stripe replays the cached response, so "retrying cannot succeed" is true of **all
four** `provider_error` statuses too. The repo asserts this itself, in a comment added by the *same commit*
— `stripe-payments.provider.spec.ts:130-134`: *"A `processing` intent strands the ride under EITHER
bucketing: the key is ride-derived, so Stripe replays the same cached answer to every retry."*

A future reader buckets a new SDK status by that clause and routes it to `declined` — the wrong bucket by
this file's own asymmetry doctrine, which is the exact failure the `Record` exists to prevent.

Secondary, and verified in the installed SDK: `isCardError` sends **every** HTTP-402 `StripeCardError` to
`declined`, but `node_modules/stripe/cjs/resources/Charges.d.ts:447` types
`AdviceCode = 'confirm_card_data' | 'do_not_try_again' | 'try_again_later'`. A decline whose advice is
`try_again_later` is bucketed as "the rider must act" and answers 402 `payment_declined` — the *"lie to a
driver"* the docblock's own asymmetry paragraph says the design exists to avoid. Mitigating: `describe()`
puts `decline_code` ahead of `code`, so the issuer's code does reach the log.

**Fix:** state the one test that discriminates — *"must the RIDER do something before any retry can work?"*
— and explicitly warn off the retry framing. **Do not change `STATUS_REASON`'s bucketing or `isCardError`'s
coarseness**; both are right on the merits, and re-bucketing on `advice_code` is a separate decision.

---

### HUMAN DECIDES

**4 · Low — the barrel's "six of them" undercounts the unlogged exits**
`services/api/src/features/payments/index.ts:46-50`

The six inherited from round 2's table all check out — each is unlogged and each precedes
`this.payments.charge()`. But at least two more unlogged pre-provider exits are not in it:

- `settlement.service.ts:247` — `fareSplitSchema.parse(...)` throws a `ZodError` when the persisted split
  fails the no-cent-leak refinement (`packages/shared/src/commission.ts:61-63`). An *anticipated* failure:
  the method's docblock says the re-parse exists to run that refinement "at the last boundary before money
  moves".
- `settlement.service.ts:69-71` — the `never` default arm of `settlementMethodOf`.

**Note:** issue **#70** carries the same six, so fixing this means editing both. The count was inherited
from round 2's table rather than counted independently — my error, not round 2's.

**Fix:** drop the number (*"#70 tabulates them"*), or make it exact in both places.

---

**5 · Low — the barrel credits the reconciliation query with a distinction only the log can make**
`services/api/src/features/payments/index.ts:40-42`

> *"…`write_failed` … carries the PaymentIntent so **the query below** can tell a ride that was charged
> from one that never was"*

The query is `SELECT id, order_id, driver_id, payment_method, total_cents, updated_at FROM rides WHERE
status = 'completed'`. It does not select `payment_provider_ref` — and on the `write_failed` path the
rollback has set that column back to NULL anyway. The distinction lives entirely in the log line. Survived
round 2's edit of the surrounding sentence.

**Fix:** *"…so the LOG can tell a ride that was charged from one that never was; the query surfaces it, the
log explains it."*

---

### FYI

**6 · Low — "`customerRef` / `instrumentRef` are never logged" is stated as an absolute.**
`stripe-payments.provider.ts:189-190`, mirrored at `settlement.service.ts:305`. Neither is logged as a
*field* — verified, both log sites enumerate their keys. But `describe()` forwards the SDK error's `message`
verbatim, and Stripe composes that string server-side; a `StripeInvalidRequestError` for a stale ref
plausibly embeds the id. Not settleable from the repo. Low either way — `cus_…`/`pm_…` are pseudonymous
handles of the same class as the `pi_…` the slice logs deliberately.

**7 · Low — `payments.integration.spec.ts` is 563 lines, past the ~500 guideline.** Pre-existing and not
caused here: 531 at the feature commit, 552 after round 2, 563 now. It is also the house pattern for
integration specs (`dispatch` 768, `ride-lifecycle` 673), so this is a question about the guideline rather
than about this PR.

---

## Validation

`pnpm turbo run typecheck lint test build --force`, docker up, `REDIS_TEST_URL` set:

| Package | Typecheck | Lint | Tests |
|---|---|---|---|
| `@taxi/shared` | pass | pass | pass |
| `@taxi/db` | pass | pass | pass |
| `@taxi/api` | pass | 0 errors, 6 warnings | **376 passed, 48 suites** |

**Tasks: 20 successful, 20 total · 0 cached.** Up from 375/48 at round 2 — the one new fail-closed test.
The 6 warnings are the same pre-existing `no-unsafe-argument` on `app.getHttpServer()`.

**Regression guards re-verified on HEAD** (both restored clean afterwards):

| guard | break applied | result |
|---|---|---|
| finding 1 — `@Roles` rider exclusion | `+ 'rider'` | fails: `Expected "insufficient_role" / Received "role_cannot_settle"` |
| finding 6 — fail-closed actor | `!actor` → `actor === null` | fails: `Received function did not throw` |
| finding 1 — dispatcher inclusion | `− 'dispatcher'` | **stays green, 376/376** ← finding 1 above |

---

## What held up under attack

Both agents were told to refute. These survived, each checked against a primary source:

- **The SDK forensics are exact.** `stripe@22.4.0` confirmed at `node_modules/stripe/package.json:3`.
  `cjs/Error.js:97` really is `this.payment_intent = raw.payment_intent` on the **base** `StripeError`.
  `cjs/RequestSender.js:419-424` really is the local `{ message, detail }` construction — and it is the
  **only** `StripeConnectionError` construction site in the whole SDK, so "can never carry a
  `payment_intent`" holds SDK-wide, not just on that path. Both cited line numbers are right.
- **`StripeAPIError` was the right fixture choice** — `Error.js:140-143` passes it as `type`, and
  `generateV1Error` returns it as the fallback for any status outside {429, 400, 404, 401, 402, 403}. A
  genuinely reachable class, unlike the one it replaced.
- **The `it.each` stayed honest after the fixture swap.** Its `StripeConnectionError` fixtures still carry no
  intent, so the `providerRef: null` arm is exercised rather than made vacuous.
- **`STATUS_REASON`'s bucketing is correct for all six statuses** against the rule's *operative* clause
  ("must the rider act?"), including `canceled` and `requires_capture`. Finding 3 is about the rule's prose,
  not the map. Do not change the map.
- **The new `findByRide` docblock is true clause by clause** — six rows in one `.values()` INSERT
  (`settlement-entries.ts:82-118,150-158` → `ledger.repository.ts:81-83`); settles exactly once
  (`transitionInTx` gates the transaction at `settlement.service.ts:145-151`); identical `created_at`
  (`.defaultNow()` at `db/src/schema/ledger.ts:51-53`, confirmed as deployed `DEFAULT now()` in migration
  `0001:138`); `asc(id)` on `defaultRandom()` doing all the ordering. "ARBITRARY but IDENTICAL across two
  reads" is exactly right, and keeping the vacuous `asc(createdAt)` term is correct — `payout`/`adjustment`
  entry types mean a future second write for the same ride makes it meaningful again.
- **The barrel's narrowed charge/write sentence is now true.** Every charge failure logs unconditionally
  before the throw (`settlement.service.ts:290`); every write failure logs at `:171-183`; both carry
  `rideId`.
- **The six named exits really do all precede the provider call** — so *"a diagnosis gap, not a loss one"*
  is correct, even though the count is short (finding 4).
- **Finding 6's fix is sound and cannot over-refuse.** `SettlementActor` is three non-empty string literals,
  so `!actor` is true only for `null`/`undefined`. Its test bites, and its comment about `jwtClaimsSchema` is
  accurate — `role: z.enum(USER_ROLES)` at `packages/shared/src/schemas/auth.ts:55-61`, reached through
  `AuthTokenService.verify`'s `parse`.
- **Finding 7's rewording is correct and the `afterEach` is load-bearing** — `services/api/package.json` sets
  no `restoreMocks: true`, so the hook is doing real work rather than duplicating a global.
- **Finding 10 is now true at both sites and the enumeration is complete.** `chargeIfNeeded` returns `null`
  in exactly two places — cash (`:269`) and `totalCents === 0` (`:273`); every other exit throws.
- **Finding 9 is fixed** and no longer contradicted by the `it.each` three lines below it.
- **Round-2 finding 4's fabricated 24h figure is gone** — no "24h" survives anywhere in the slice.
- **No global exception filter or interceptor exists** (`APP_FILTER|useGlobalFilters|ExceptionFilter|
  useGlobalInterceptors|APP_INTERCEPTOR`: zero matches in `services/api`), so `body.message` is the real
  serialization — which the passing assertion confirms empirically.
- **`insufficient_role` is emitted from exactly one place repo-wide** — `roles.guard.ts:33,37`.
- **Hard rules clean.** Integer cents throughout; status only via `transitionInTx`; operative
  `ride.paymentMethod`; Stripe imported type-only and still confined to the slice; `packages/shared` imports
  nothing from the workspace; logging fits `domain.component.action_state`; no PII in any payload.

## What is genuinely good

- **The finding-6 fix is the model of this round.** One character in the source, plus a test that forges past
  the type system with a comment explaining *why the forge is the point* — that the property previously lived
  in another slice's zod enum. Honesty applied without being asked twice.
- **Finding 10's fix names the zero-amount card ride specifically** rather than adding a vague hedge. It
  closes the enumeration instead of blurring it.
- **The `f9d8916` self-review pass** caught three of the author's own new over-claims before this review ran,
  including an attribution that credited an `it.each` with an assertion it does not make. That is the loop
  working.
- **Finding 5 shipped as an honest retreat.** "Oldest first" was not repaired into a stronger claim; it was
  replaced with the weaker true one, and the logical-ordering question was filed (#71) rather than guessed.

---

## Recommendation

**APPROVE.** The gate is green and independently reproduced, there are no Critical or High issues, no
runtime defects and no hard-rule violations. All ten round-2 findings landed behaviourally correct.

**Worth taking before merge:** the three Medium comment edits, and — the one with real teeth — the ~8-line
dispatcher settle test, because `− 'dispatcher'` currently passes 376/376 while breaking a recovery path the
slice advertises. Findings 4–5 are doc edits (plus a matching edit to #70); 6–7 are FYI.

The standing theme, third round: *the code is right and the prose oversells it.* The gap keeps narrowing —
round 1 found protections that did not exist, round 2 found fixes described as covering more than they
covered, round 3 finds three sentences whose neighbours in the same slice contradict them. The reason it
keeps being worth naming is that this slice's comments are load-bearing: they are the reconciliation runbook
for money that has already moved.

*Round 3 reviewed per `piv-review-pr`: two `code-reviewer` agents in clean context instructed to refute, with
scope split; every empirical claim run by the coordinator, since the agents are read-only. The coordinator
authored the fixes under review — stated plainly, because it is the reason the deep pass was delegated.*
