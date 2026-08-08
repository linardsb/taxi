# Code Review — PR #72

**`feature/api-settlement-comment-accuracy` → `main`** · commits `bd0323d`, `fb07ec6` (7 files, +421/−39)
· the follow-up to merged PR #65, answering [`pr-65-review-round3.md`](./pr-65-review-round3.md)

**Recommendation: REQUEST CHANGES — one clause, in two comments.**
0 Critical, 1 High, 1 Medium, 5 Low. Validation independently reproduced and green (378/48).
**Both review agents, working different files in clean context and told to refute, independently landed on the
same sentence** — from opposite sides of the slice, as round 3's two agents did.

**The code is correct and the test is the best thing in this PR.** The new `it.each` closes a real hole:
before this branch, deleting `'dispatcher'` *or* `'admin'` from the settle route passed the whole suite while
breaking a recovery path the barrel sells as a mitigation. I reproduced both mutations, and both now fail
exactly once. Most of the comment fixes land true, and two of the round-3 findings are closed cleanly.

Two of them introduce a new claim of their own, and one of those is about money. This is round 4 of *the code
is right and the prose oversells it* — and the sentence at issue is refuted by the slice's own spec, added by
the very commit the PR body cites as its precedent.

---

## Method, and its disclosure

**This repo's session authored the commits under review.** Fresh eyes were bought two ways: this review ran
in cleared context, and the deep pass went to two `code-reviewer` agents in clean context, scope-split
(settlement service/specs/barrel · Stripe provider/policy) and instructed to **refute**.

**The agents are read-only, so every empirical claim below was run by me** — the gate, four controller
mutations, and the restore. Nothing here is an asserted result.

---

## Findings

### HUMAN READS

**1 · High — "the ride still recovers the ordinary way" is stated unbounded, and the slice's own spec says it is bounded**
`services/api/src/features/payments/stripe-payments.provider.ts:100-105` (primary) ·
`services/api/src/features/payments/settlement.service.ts:181-185` (same clause, less teeth)

The provider's new paragraph, in full:

> *"THE RIDE ITSELF STILL RECOVERS THE ORDINARY WAY: the key is ride-derived, so a retried settle presents
> the same key and Stripe answers with the original PaymentIntent rather than charging again. WHAT IS LOST IS
> THE DIAGNOSIS — nothing logged at failure time says a charge may already have landed, so `metadata.rideId`
> in the dashboard is how an operator learns whether one did."*

**Those two sentences together are the double charge.** The paragraph establishes that discovery is deferred
to dashboard reconciliation — an operator learns about the ride *later* — and then asserts the deferred retry
is free. The slice already documents that it is not, one file over, without using a figure:

> `stripe-payments.provider.spec.ts:135-137` — *"The caveat of being retry-safe: a retry landing after
> Stripe's key window expires would mint a SECOND PaymentIntent, which is what #67's runbook is for."*

That line is the **only** mention of the key window anywhere in the slice (`grep window\|expir` over
`features/payments/*.ts`). This PR adds the slice's two other statements of the replay mechanism, and neither
carries it. The provider docblock at `:25-31` even sends the reader to that spec file — while omitting the
caveat that file exists to record.

**On the PR body's documented decision.** The body states the omission is deliberate: *"assert no time bound,
since round 2 already had a fabricated 24h figure removed from this slice."* A documented decision is normally
not a finding — but this rationale is checkable and it inverts:

```
$ git log --oneline -S "key window expires" -- .../stripe-payments.provider.spec.ts
1bb5a34 fix(api): make the settlement slice's comments match what its code proves (#12)
```

`1bb5a34` is that round-2 commit. It removed the fabricated figure **and added the figure-free caveat in the
same change.** The cited precedent establishes the opposite of what it is cited for: round 2's lesson was not
"assert no bound", it was "state the bound without inventing a number."

**Failure scenario.** A card settle times out after Stripe took the money. `charge_failed` logs a null ref, so
nothing at failure time flags it. Next shift, the barrel's reconciliation query surfaces the ride as
`completed`; the operator opens `stripe-payments.provider.ts`, reads that the ride "still recovers the ordinary
way", and re-POSTs `/settle`. Past the key window that is a second PaymentIntent — **the rider is charged
twice for one ride.** This is precisely the class of harm the slice's comments exist to prevent, and the PR
body itself calls them "the reconciliation runbook for money that has already moved."

**Fix — put the bound on the source, not on the restatements.** The reviewing agent found the unbounded claim
at **five** sites, and only two are this PR's:

| site | in this PR? |
|---|---|
| `settlement.policy.ts:5-8` — *"Stripe returns the original PaymentIntent instead of creating a second one, and the rider is charged once"* | no — pre-existing, and the source every other site cites |
| `packages/shared/src/seams/payments-provider.ts:32-35` | no — pre-existing |
| `stripe-payments.provider.ts:36` | no — pre-existing |
| `stripe-payments.provider.ts:100-105`, `:26-27` | **yes** |
| `settlement.service.ts:181-185` | **yes** |

Qualifying only the two new ones leaves the slice *more* inconsistent, not less. **The bound belongs on
`settlement.policy.ts` alone** — the single definition the other four already defer to — with the restatements
left pointing at it. That is this file's own established pattern (`:22-23`: *"`STATUS_REASON` below applies it
rather than restating it"*). The spec's caveat at `:135-137` should then point at the same source instead of
being the lone place it lives.

**One honest complication, and it does not change the verdict.** The bound is not citable from this repo
either way. I grepped `/idempotenc/i` across `node_modules/stripe` — 34 files, **none** stating a retention
window; the only pointer is the doc URL at `cjs/lib.d.ts:107` and `README.md:304`. So the spec's *"after
Stripe's key window expires"* is, strictly, as uncitable as the 24h figure round 2 deleted. Someone has to
**fetch** Stripe's published idempotency documentation and cite it — that is the real fix, and it is a
five-minute lookup, not a rework.

**The minimum to unblock this PR** is smaller than that: the two new sentences must stop asserting the
unbounded absolute. Deferring — *"recovery is the ordinary retry; `settlement.policy.ts` owns the mechanism
and its limits"* — costs one clause, needs no citation, and stops the slice from telling an operator that a
next-day retry is free.

---

**2 · Medium — "`message` is the SDK's own string, composed server-side" is refuted three ways by the provider's own spec**
`services/api/src/features/payments/stripe-payments.provider.ts:205-206`

The narrowing this sentence supports is correct and is a genuine improvement (*"never logged **AS FIELDS**"*).
Its supporting clause is not. `message` reaches that log payload from four producers, and on three of them it
is not the SDK's string at all — each pinned by an assertion in `stripe-payments.provider.spec.ts`:

| producer | value | spec |
|---|---|---|
| non-succeeded intent (`charge():189`) | `payment_intent_${status}` — composed **here** | `:102`, `:144` |
| card error (`describe():71-75`) | the `decline_code`, e.g. `insufficient_funds` — a code, not a message | `:163` |
| other throws (`describe():107`) | `` `${type}: ${message}` `` — prefixed **here** | `:188` (`toContain(type)`) |
| `StripeConnectionError` | the SDK builds it **locally**, as `:96-97` of this same file says | `:200` (the spec's own note) |

The gate log shows it directly: `message: 'StripeConnectionError: upstream said no'`.

The last row is the sharpest: the file states "composed server-side" ~100 lines below stating that this class
is built client-side with no response body to read. Confirmed at primary source —
`node_modules/stripe/cjs/RequestSender.js:150-151` returns the literal *"An error occurred with our connection
to Stripe."*, and `:420-421` builds the timeout text from the **local** timeout value.

**It is load-bearing, not cosmetic.** This PR's other new line at `settlement.service.ts:314-315` makes this
docblock the single source of truth for two log sites' PII surface — *"see `StripePaymentsProvider.failed` for
what `message` can carry."* A false premise there is now cited from another file.

**The conclusion survives; only the premise is wrong.** The named scenario does route through a server-composed
string: a stale ref is HTTP 400 → `StripeInvalidRequestError` → the non-card branch → `error.message`. And the
hedge — *"**could** still name one"* — is the right modality for something round 3 ruled unsettleable. The
sentence over-warns while misdescribing provenance.

**Fix:** attach the property to the branch that has it — *"on an API error the SDK forwards Stripe's own
server-composed string, so a stale-ref error could still name one; the non-throw and connection-error paths
compose `message` locally"* — instead of to `message` in general.

---

### HUMAN DECIDES

**3 · Low — the barrel points at #70 for the exact count, and #70's *body* still carries the wrong one**
`services/api/src/features/payments/index.ts:48-49`

The barrel now reads *"#70 tabulates them (no count here: the table is the one place worth keeping exact)."*
The correction did land — but as a **comment** on #70. The issue **body** still opens *"`SettlementService.settle()`
has nine failure exits. **Six** emit no `payment.settlement.*` event at all"* with the stale six-row table.
A reader following the pointer reads the body first and finds the number the barrel just deleted for being
wrong.

**Fix:** edit #70's body to the corrected table (or open it with a one-line "superseded by the comment below").
No code change.

**4 · Low — round 3 named two sites for the money-path caveat; the fix reached one of them**
`services/api/src/features/payments/settlement.service.spec.ts:348` ·
`services/api/src/features/payments/index.ts:38-44`

`settlement.service.ts` got the narrowed superlative **plus** the disambiguating paragraph at `:178-185`
(*"NOT the only shape where money moved…"*). Its two named companions got the narrowing without the paragraph:

- **The spec at `:348`** now reads *"THE ONLY PATH WHERE THE CHARGE SUCCEEDED AND THE WRITE DID NOT"* standing
  alone, with no neighbour to disambiguate. True under the *observed* reading (`charge.ok === true` was seen),
  false under the *physical* one — a timed-out charge also succeeded at Stripe and also wrote nothing. That is
  the exact ambiguity round-3 finding 2 existed to remove.
- **The barrel** is the file an on-call engineer actually opens, because it hosts the reconciliation query — and
  round-3 finding 2's failure scenario runs through it explicitly. It still offers no hint that a
  `charge_failed` with a null ref may *also* have been charged.

**Fix:** one clause each — *"the only path where the charge was OBSERVED to succeed…"* in the spec, and in the
barrel *"…a `charge_failed` carrying a null ref may ALSO have been charged (a timeout after Stripe took it);
see `settlement.service.ts`."*

**5 · Low — a fresh hard count, in the PR that deleted one for being drift-prone**
`services/api/src/features/payments/payments.integration.spec.ts:558`

*"the nine driver-auth settles above pin `driver`"* — **verified correct today**: 11 `/settle` call sites, 9
with `d.auth`, 1 with `r.auth`, 1 in the new `it.each`. It is also much safer than the count it replaced,
because it sits in the same file as the thing it counts. Raising it only because this PR's own remedy two files
over was *delete the number* (finding 3), and consistency is cheap: *"every other driver-auth settle above"*
costs nothing and never drifts.

**6 · Low — "`driver` on every other settle in the file" contradicts the clause after it**
`services/api/src/features/payments/settlement.controller.spec.ts:31-33`

> *"…all four roles: `rider` refused with `insufficient_role`, `driver` on **every other settle in the file**,
> and `dispatcher`/`admin` each settling a ride they do not own."*

"Every other settle" literally includes the two the next clause names as dispatcher/admin. **Fix:** *"`driver`
on the rest."* Everything else in this docblock is now accurate, and *"pins the route's decorator list"* is
true in a way it was not at round 3 — I confirmed all four arms by mutation.

**7 · Low — the new one-rule framing lives in one file; the contract it implements still frames it the old way**
`services/api/src/features/payments/stripe-payments.provider.ts:25-26` vs
`packages/shared/src/seams/payments-provider.ts:16-21`

The new *"NEVER 'CAN A BARE RETRY SUCCEED?'"* is stated file-locally, while the seam that **defines** the two
reasons still separates them by retry semantics (*"A retry re-declines and costs a second provider call"* vs
*"A retry is SAFE"*). Steelmanned, both are true — "is a retry safe?" is caller guidance and "can a bare retry
succeed?" is a bucketing criterion, which are different questions — so only the contrast reads sharper than it
is. Raised because CLAUDE.md puts cross-surface contracts in `@taxi/shared`: if the rule is the rule, the seam
is where it belongs. No fix demanded in this PR.

**Nits, not numbered:**

- The `%s` test title reads *"lets **a admin** settle a ride they do not own"* (`:555`). It is CI output an
  operator reads; `'lets %s settle…'` with the rows carrying `'a dispatcher'` / `'an admin'` fixes it.
- The PR body puts the integration spec at "~590 lines"; it is **602**. The won't-fix itself is sound —
  `dispatch` is 768 and `ride-lifecycle` 673, so the house pattern holds and this is a question about the
  guideline.
- The new case asserts the ledger *count* (`toHaveLength(6)`), not whose rows they are. Mentioned and then
  dismissed: `SettlementInput` (`features/ledger/settlement-entries.ts:21-31`) has **no actor field at all**,
  so a dispatcher's id cannot reach the ledger even in principle. The property is enforced by the type, not by
  a test — adding `expect(sumOf(of('driver'))).toBe(before.driverNetCents)` would be polish, not coverage.

**Raised by a reviewing agent and closed by running it:** whether the comment's `admin` half (*"deleting EITHER
`'dispatcher'` or `'admin'` … left the whole suite green"*) was inference rather than fact. Round 3 only ever
ran the `dispatcher` mutation. It is now verified both ways — `− 'admin'` fails **only** the admin row, so
without that row the suite was green, and the base commit carried zero admin-auth settles. The sentence stands
as written.

---

## Validation

Docker healthy (`db`, `redis` on 6381), `REDIS_TEST_URL=redis://127.0.0.1:6381`,
`pnpm turbo run typecheck lint test build --force`:

| | result |
|---|---|
| Tasks | **20 successful, 20 total · 0 cached** |
| `@taxi/api` tests | **378 passed, 48 suites** (376 at round 3 + the 2 new rows) |
| `@taxi/api` lint | 0 errors, 6 warnings — the same pre-existing `no-unsafe-argument` on `app.getHttpServer()` |
| typecheck / build | pass, all packages |

**Exactly the numbers the PR body claims.**

### Mutation testing — every arm of the route's `@Roles` is now pinned

Each mutation applied to `settlement.controller.ts:53`, full `@taxi/api` suite run, controller restored after:

| mutation | result | failing test |
|---|---|---|
| `− 'dispatcher'` | **1 failed, 377 passed** | `lets a dispatcher settle…` — `expected 201 "Created", got 403 "Forbidden"` |
| `− 'admin'` | **1 failed, 377 passed** | `lets a admin settle…` |
| `+ 'rider'` | **1 failed, 377 passed** | rider-403 — `Expected "insufficient_role" / Received "role_cannot_settle"` |
| `− 'driver'` | **7 failed, 371 passed** | the six driver-auth cases, + `lets a dispatcher settle…` as collateral (see below) |

`git diff --stat` and `git status --short` both empty afterwards — **controller restored clean.**

**The 7th failure is a leaked jest spy, and it is worth knowing about (pre-existing, not this PR's).** Under
`− 'driver'`, the dispatcher row fails with `500`, not `403` — it is on the mutated `@Roles`, so the guard lets
it through. The server-side cause is `Error: connection terminated mid-transaction`, which is the
`mockRejectedValueOnce` armed at `payments.integration.spec.ts:434-438`. That test settles with driver auth
first, so under this mutation it fails at `:440` and **never reaches its `post.mockRestore()` at `:451`** — the
armed rejection then fires on the next `postRideSettlement`, which is now the new dispatcher row. `services/api`
sets no `restoreMocks: true`, so an inline `mockRestore()` is only reached on the happy path. The new test is
the first downstream victim rather than the cause. One-line fix whenever someone is in there:
`restoreMocks: true`, or move the restore into `afterEach`.

The historical premise holds structurally: on the base commit (`67855d5`) the spec had 10 `/settle` calls, 9
driver-auth and 1 rider-auth, and **zero** dispatcher or admin. Nothing could have caught either deletion.

---

## What held up under attack

Checked against the file each claim names, not read and accepted:

- **The ride-derived key is real.** `settlement.policy.ts:14-16` is `` `settle:${rideId}` `` — nothing
  per-attempt. The mechanism finding 1 disputes is sound; only its unbounded framing is not.
- **The barrel's reconciliation narrowing is exactly right.** The query at `index.ts:45-46` really does not
  select `payment_provider_ref`, and `writePaymentRef` really is inside the transaction
  (`settlement.service.ts:162-166`), so a rollback returns the column to NULL. *"The log explains it"* is the
  true version.
- **"Throws 502 in `chargeIfNeeded` below"** — `:302-304`, and `chargeIfNeeded` (`:272`) is indeed below the
  `.catch()` (`:171`).
- **The narrowed superlative is true.** *"THE ONLY PATH WHERE THE CHARGE SUCCEEDED AND THE WRITE DID NOT"* —
  the lost-race arm (`:151` → `:194-202`) is not a counterexample: the winner settles the ride and writes the
  same PaymentIntent under the same key.
- **"All four roles"** — `USER_ROLES` is exactly `['rider','driver','dispatcher','admin']`
  (`packages/shared/src/enums.ts:1`), and all four are now pinned by mutation, above.
- **The `staff()` helper's docblock is accurate.** Dispatcher and admin both bypass ownership —
  `settlement.service.ts:112` gates the check on `input.actor === 'driver'` alone. The rename left **zero**
  stale `dispatcher(` call sites.
- **No fixture collisions.** Drivers 1–8 were taken, new rows use 9/10; riders 50–56, new 57/58; staff 90, new
  91/92. `p()` is this file's own `+371270` E.164 range (`:24-32`), so no cross-file reuse. The two `it.each`
  rows share no fixtures, so they are order-independent.
- **Every SDK citation in the provider survives primary-source checking.** `stripe@22.4.0`
  (`node_modules/stripe/package.json:3`); `Error.js` really passes the class name as `type`; `generateV1Error`
  really selects `StripeCardError` from **HTTP 402**, not from `rawType === 'card_error'`; `Error.js:97` really
  is `this.payment_intent = raw.payment_intent` on the **base** error; `RequestSender.js:419-424` really is the
  local construction, at exactly those lines.
- **No line-number drift in any changed comment.** The new text cites bare filenames
  (`settlement.policy.ts`, `stripe-payments.provider.spec.ts`, `StripePaymentsProvider.failed`) rather than
  line numbers — round 3's drift lesson applied deliberately, and the PR body says so. Every cited file exists
  and says what is attributed to it.
- **The ride-derived premise is contract-backed, not a caller accident.**
  `packages/shared/src/seams/payments-provider.ts:31-37` makes it a documented property of the
  `idempotencyKey` field, and the sole caller honours it (`settlement.service.ts:289`).
- **Hard rules clean.** Integer cents only; no direct `rides.status` write; `ride.paymentMethod` operative;
  Stripe still confined to the slice; nothing user-facing hardcoded; `'dispatcher' | 'admin'` as a local
  literal union matches the file's existing `signIn(phone, role: 'rider' | 'driver')` rather than duplicating
  a shared contract.

## What is genuinely good

- **The test is the point, and it is a real one.** A capability the barrel sells as one of three named
  mitigations for having no sweeper had zero coverage, in both directions. It now has end-to-end proof for
  both actors, and I confirmed each bites independently.
- **Finding the admin gap after the first push** — by applying the review's own mutation method to the role the
  review did not think to test — is the loop working better than the review did. The review asked for a
  dispatcher test; the author shipped the general case.
- **The rider-403 comment was narrowed honestly rather than defended.** *"Pins that `rider` is EXCLUDED — not
  that anyone else is on it"* is the weaker true claim, and the PR then went and earned the stronger one.
- **`STATUS_REASON` and `isCardError` were deliberately left alone**, on the record, because the review said
  they are right on the merits. Restraint under a review is harder than compliance.
- **Choosing `cash` for the new cases** keeps the payments fake out of a test about roles. The right axis.
- **The actor cannot leak into the ledger, structurally.** `SettlementInput`
  (`features/ledger/settlement-entries.ts:21-31`) has no actor field at all, and `settlement.service.ts:153-159`
  passes only `{rideId, riderId, driverId, paymentMethod, split}`. A dispatcher/admin settle therefore produces
  byte-identical entries to the driver's — the new test's `toHaveLength(6)` is method-derived, not
  actor-derived, and claims nothing more than that.

---

## Recommendation

**REQUEST CHANGES** — narrowly, for finding 1, and I want to be plain about how narrow it is: **the code is
correct, the gate is green and independently reproduced, and nothing here is a rework.** The blocking ask is
one clause in the two comments this PR added, so that neither tells an operator a deferred retry is free.
Moving the bound onto `settlement.policy.ts` with a real Stripe citation is the durable fix and is worth a
follow-up ticket — it touches three pre-existing sites this PR did not create and should not be forced to own.

The reason it is not a Medium-and-merge is what the sentence would cost if acted on. Every other finding in
four rounds of this slice has been a diagnosis gap. This one is a **duplicate charge to a rider** — and it sits
in a paragraph that, three lines later, establishes the exact delay that makes it reachable.

Findings 2 and 4–6 are cheap enough to take in the same push — every one is a clause. Finding 3 is a GitHub
edit, not code. Finding 7 is a contract question for a later ticket, not this one.

Then re-run the gate and merge. The trend is real and worth saying: round 1 found protections that did not
exist, round 2 found fixes that covered less than they claimed, round 3 found three comments contradicted by
their own slice, round 4 finds one — and this round the PR also shipped the test that closes the hole rounds
1–3 all missed.

*Reviewed per `piv-review-pr`: two `code-reviewer` agents in clean context instructed to refute, scope-split;
every empirical claim run by the coordinator, since the agents are read-only. The coordinator's session
authored the commits under review — stated plainly, because it is why the deep pass was delegated and why the
gate and all four mutations were re-run from scratch rather than taken from the PR body.*
