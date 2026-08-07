# Code Review — PR #65

**`feat(api): settle rides via payments seam and integer-cent ledger (#12)`**
`feature/api-payments-ledger` → `main` · 56 files, +7087/−47 · commit `aac35fb`

**Recommendation: APPROVE** — 0 Critical, 0 High. Four Medium findings, all
*documentation-accuracy or defensive-typing* items in code whose runtime behaviour is correct as written.
Validation independently reproduced and green.

---

## Summary

This is careful work in the highest-stakes area of the codebase, and — unusually — the claims it makes about
itself hold up under checking. I verified the load-bearing ones against the code rather than transcribing
the report, and dispatched three `code-reviewer` agents across the payments slice, the ledger + schema, and
dispatch/shared/config. Every finding below I then re-verified against the file myself; several agent items
were discarded for re-litigating documented decisions.

**No defect was found in the money arithmetic, the settlement lock, the idempotency handling, the debt-limit
boundary, or the production-refusal paths.** The four Medium findings share one shape: *a comment or barrel
promises a safety property the code does not actually implement.* None changes behaviour today. Two
independent reviewers converged on findings 1 and 2 without seeing each other's work.

---

## What I verified independently

| Claim under test | Verdict | Evidence |
|---|---|---|
| "The transition IS the settlement lock" | **Holds** | `ride-transition.service.ts:79-88` — conditional `UPDATE … WHERE id = ? AND status = ?` with `.returning()`; zero rows → `undefined` → lost-race path. A real atomic guard, not a JS-side check. |
| Six-entry set sums to zero; rider nets zero on **both** methods | **Holds** | Checked by hand. Card: `−T +T −C +C −T +T = 0`. Cash: same, driver nets `−C`, platform `+C`. `settlement-entries.ts:82-127` |
| No double-rounding in the split | **Holds** | `driverNetCents` is *never* read when building entries — only `totalCents`/`commissionCents`. Commission is rounded once (`money.ts:41`), the net derived by subtraction (`commission.ts:89`), and the refinement `C + N === T` (`commission.ts:61`) is re-run at the last boundary before money moves (`settlement.service.ts:186`). There is exactly one rounding in the whole path. |
| Idempotency key ride-derived, in Stripe's **second** argument | **Holds** | `stripe-payments.provider.ts:107` — options arg, not a params field. Key `settle:<rideId>`, no attempt counter. The spec asserts on `calls[0].options`, which is the assertion that actually catches a silent double-charge. |
| Debt-limit boundary inclusive at the limit | **Holds** | `candidate-filter.ts:45` — `−5000 < −5000` false (eligible), `−5001` blocked, limit `0` reproduces the old rule. Pinned at unit *and* integration level, assertions not swapped. |
| Commission never recomputed at settlement | **Holds** | Split read from persisted columns; `resolveCommissionPct` never called in the settlement path. |
| Money path is float-free | **Holds** | grep for `parseFloat|toFixed|Number(|/100|*0.|Math.round/floor/ceil` across `features/ledger` + `features/payments` (non-spec): **zero hits**. |
| Stripe SDK confined to `features/payments/` | **Holds** | 3 import sites, all in-slice. |
| `packages/shared` imports nothing from the workspace | **Holds** | `seams/payments-provider.ts` has no imports at all. |
| Driver balance moves as a `sql` delta | **Holds** | `ledger.repository.ts:103` — relative and parameterised, no read-modify-write. |
| Production refusal cannot be bypassed | **Holds** | `payments.module.ts:41-45`. `sk_live_` refused **unconditionally** — the refinement sits on the field, *outside* the production-only `superRefine` (`env.schema.ts:72-79`). No `process.env` back door. |
| Migration 0006 ordering | **Holds** | `ADD COLUMN NOT NULL DEFAULT` → `DROP DEFAULT` (`:4`,`:7`); `card_settlement` added and **not used** in the same migration. `ledger_entries_ride_idx` correctly **non-**unique — six rows share a `ride_id`. |

---

## Validation

`pnpm turbo run typecheck lint test build --force`, docker up, `REDIS_TEST_URL` set:

| Package | Typecheck | Lint | Tests |
|---|---|---|---|
| `@taxi/shared` | pass | pass | **125 passed** (11 files) |
| `@taxi/db` | pass | pass | **17 passed** (3 files) |
| `@taxi/api` | pass | 0 errors, 6 warnings | **364 passed, 47 suites** |

**Tasks: 20 successful, 20 total · 0 cached.** No `FAIL`/`✗` anywhere in the run.

The 6 lint warnings are the pre-existing `no-unsafe-argument` on `app.getHttpServer()` — one per integration
spec. The report's counts match mine exactly. The `auth.integration.spec.ts` flake the report disclosed did
**not** reproduce here.

---

## Findings

Routed per `.claude/references/conventions.md`. **AGENT FIXES is deliberately empty** — this diff is
entirely money-, auth- and ride-state-adjacent, which that rubric bars from automated fixing.

### HUMAN READS

**1 · Medium — the barrel promises a failure log that does not fire on the one money-losing path**
`services/api/src/features/payments/index.ts:38` · `settlement.service.ts:93`

The barrel states *"every failure logs a distinct `payment.settlement.*` event with the rideId"* — one of the
three mitigations cited to justify shipping without a settlement sweeper. It is not true for the case that
actually costs money.

**Failure scenario:** a €25.00 card ride charges successfully (`providerRef: pi_abc`), then
`postRideSettlement` throws (connection drop, constraint violation). There is no `try` around
`this.db.transaction(...)`, so the error propagates uncaught. `payment.settlement.settled` never runs;
`payment.settlement.charge_failed` never runs — the charge *succeeded*. The rider's money is at Stripe,
`payment_provider_ref` rolls back to `NULL`, and **no log line anywhere names `rideId` together with
`pi_abc`.** The reconciliation query in the barrel surfaces the stuck ride but cannot distinguish "never
charged" from "charged, then rolled back" without opening Stripe.

Visible in the gate output of the branch's own AC #3b test:

```
ERROR [ExceptionsHandler] Error: connection terminated mid-transaction
```

That test (`payments.integration.spec.ts:425-465`) exercises this exact path and asserts the 500 and the key
reuse — it demonstrates the gap without noticing it.

**Compounded by `stripe-payments.provider.ts:55-56, 77`:** `describe()` extracts `intentId`, uses it on the
card-error branch (`:63`), then hardcodes `providerRef: null` at `:77` for everything else — discarding the
handle precisely in the `provider_error` bucket, which *means* "we don't know whether the money moved." No
comment explains the asymmetry.

**Fix (~10 lines, no behaviour change):** wrap the transaction, log `payment.settlement.write_failed` with
`rideId` + `charge.providerRef`, rethrow; and return `intentId` on both branches of `describe()`. Worth
doing before #15 wires a production caller to this route.

---

**2 · Medium — "ternary-as-narrowing" appears twice, both times silently mapping an unexpected value to a dangerous default**

*(a)* `settlement.controller.ts:38-43` — the comment claims that adding a fourth role to `@Roles` "becomes a
compile error instead of a silent dispatcher-grade authorization." It does not. The chain's catch-all is
`: 'dispatcher'`:

```ts
user.role === 'driver' ? 'driver' : user.role === 'admin' ? 'admin' : 'dispatcher'
```

`USER_ROLES` is closed at four (`enums.ts:1`) and `@Roles` lists three, so the role available to add is
`'rider'` — which maps to `dispatcher`, the actor that **bypasses the ownership check** at
`settlement.service.ts:74-76`. Full override on any ride, no compile error at any point.

*(b)* `settlement.service.ts:109` — `ride.paymentMethod === 'cash' ? 'cash' : 'card'` maps *everything
non-cash* to `'card'`, including `balance` and `corporate`. The guard that makes this sound lives in a
different method 100 lines away (`chargeIfNeeded:207-215`), with nothing typechecking the coupling. A
`balance` ride reaching here would post `card_settlement` entries asserting Stripe collected money it never
touched — and the set still sums to zero, so every invariant test passes.

**Both are inert today** (`RolesGuard` blocks riders; `chargeIfNeeded` throws first). The finding is that a
comment asserts a protection the code doesn't implement, in money-authorization paths, which will stop the
next reviewer from looking harder. A lookup table with a `null`/fail-closed arm, or a `switch` with a
`never` default, would make both comments true.

---

**3 · Medium — the Stripe provider's non-throw path contradicts its own documented doctrine**
`services/api/src/features/payments/stripe-payments.provider.ts:118-122`

Lines 18-25 state the asymmetric default explicitly: anything unrecognised goes to `provider_error`, the
retry-safe bucket, "because a transient error misfiled as `declined` strands a settleable ride behind a 402
that says the rider's card failed when it did not." The non-throw path then does the opposite — *every*
status that is not `succeeded` returns `reason: 'declined'` by fallthrough.

The terminal statuses are correctly classified and pinned in the spec (`requires_payment_method`,
`requires_action` at `stripe-payments.provider.spec.ts:93,106`). A **non-terminal** status is not. If an
intent returns `processing`, `chargeIfNeeded` throws 402 `payment_declined`, the ride stays `completed` with
no ledger entries — and because the key is ride-derived, a retry replays the same response and re-answers
402, so the ride cannot be settled by retrying **within the 24h idempotency-key window**; past it, finding 9
applies and a retry creates a fresh intent instead. The two findings interact.

`processing` is uncommon for off-session card charges, so treat this as low-probability / high-consequence.
**Fix:** enumerate the terminal statuses as `declined` and let the rest fall to `provider_error` — which is
what lines 18-25 already promise. Both existing spec cases keep passing.

---

### HUMAN DECIDES

**4 · Medium — a reference doc still states the rule this PR replaced**
`.claude/references/dispatch-strategies.md:6`

Still reads *"filter by category + options … + positive-balance check."* Root `CLAUDE.md` and
`services/api/CLAUDE.md` were both updated to the debt-limit rule; this file was not — and `CLAUDE.md`'s
on-demand-context table routes **every** dispatch session to it before touching the slice.

**Concrete regression path:** a future session reads "positive-balance check", sees
`balanceCents < -driverDebtLimitCents` at `candidate-filter.ts:45`, and "corrects" it back to `< 0` — which
strands every cash-only driver after one €10 ride. That is precisely the bug this PR fixes. The doc also
doesn't mention that the limit arrives on `DispatchContext`, so the same session gets no signal that a
strategy must not read config itself.

**Your call:** fix in this PR (a two-line doc edit) or carry it into the next dispatch ticket. I'd do it
here — the drift is what invites the regression, and the next dispatch ticket is when it would bite.

---

### HUMAN TESTS

**5 · Low — no test pins that a rider is refused at the settle route**
`services/api/src/features/payments/payments.integration.spec.ts`

`rider` is deliberately absent from `@Roles` (`settlement.controller.ts:23`), and `RolesGuard`'s own spec
proves the mechanism generically — but nothing pins *this route's* list. An HTTP-level rider→403 case is the
defensive complement to finding 2(a): adding `'rider'` to `@Roles` would then fail a test instead of
silently granting dispatcher override.

---

### FYI

**6 · Low — `ledger.repository.ts:127`** — `.orderBy(asc(createdAt))` cannot order this data. `createdAt` is
`defaultNow()` (= `transaction_timestamp()`, stable across the transaction) and all six rows land in one
INSERT, so they carry identical timestamps and "oldest first" (`:108`) is vacuous. #20's reconciliation view
could render the same six lines in different sequences on different requests. Add `asc(ledgerEntries.id)` as
a tiebreaker. *(Not a test-flake risk — the specs correctly assert set properties, never position.)*

**7 · Low — deviation #8's sweep missed four more sites.** The report says the three doc sites naming a
literal 200 were all corrected. Still present: `settlement.service.spec.ts:199` and `:212` (both test
*names*), `payments.integration.spec.ts:467` (nine lines above `.expect(201)`) and the comment at `:479-480`.
Cosmetic; noted only because the report claims that sweep was complete.

**8 · Low — the harness fake is weaker than the stub in the dimension AC #3b tests.**
`test/harness.ts:297-299` returns `pi_test_${calls.length}` — a **new ref per call** — while
`StubPaymentsProvider` derives its ref from the idempotency key with an explicit comment about
"demonstrating the property the real provider must have." So AC #3b can assert the key is stable but cannot
assert the retry landed on the *same* PaymentIntent. Deriving the fake's ref from the key would let that
test also assert the second settle wrote the same `payment_provider_ref`.

**9 · FYI — the accepted "stuck money" risk has a sharper edge than the writeup states.** Not a defect: the
PR discloses that stuck money has no automatic recovery, accepted because no production client calls the
route. One detail worth knowing — **Stripe expires idempotency keys after ~24 hours.** AC #3b correctly
asserts the property the code controls (same key across retries), but a *manual* recovery days after a
rollback would present an expired key and create a second PaymentIntent. The recovery handle exists —
`stripe-payments.provider.ts:103` sets `metadata: { rideId }` — so this is a note about **recovery
procedure**, not a code change: whoever settles a stuck ride by hand should check Stripe first. Worth a line
in the runbook when #15 lands.

**10 · FYI — possible spurious 502 on a concurrent double-tap.** Because the charge is (correctly) outside
the transaction, two concurrent settles both reach `payments.charge()` before either reaches
`transitionInTx`. Stripe *may* return an `idempotency_error` for a same-key request still in flight — I did
**not** verify this against Stripe's error reference — which this provider would route to `provider_error` →
502, rather than the settled ride the comment at `:124-129` promises. **Money stays safe** (one derived key, one intent; the client's next
retry hits the `already_settled` fast path). Two consequences if confirmed: a driver double-tapping could
see a spurious 502, and the "only" in the comment at `:66-69` — `StripeIdempotencyError` "can only happen if
the amount changed" — would be too strong. Worth confirming against Stripe's API error reference before
acting; I did not verify Stripe's server-side in-flight behaviour.

**11 · FYI — `dispatch.service.ts` is 599 lines**, over the ~500 guideline. Pre-existing; this PR added one
line. Flagged only so the next dispatch ticket can plan a split deliberately rather than discover it.

---

## What is genuinely good

- **The lock is real and correctly reasoned.** Making the status transition itself the idempotency guard —
  rather than bolting on a `settled_at` column or an advisory lock — is the right call, and the conditional
  UPDATE actually implements it. Returning the settled ride instead of a 409 on a lost race is correct:
  both attempts are one charge, so a 409 would be a lie to a retrying client.
- **The rider-nets-to-zero argument** (`settlement-entries.ts:33-75`). The docblock explains why the
  tempting four-entry card set is wrong *even though it also sums to zero and also gives the driver the
  right balance* — it turns the rider account into a lifetime-spend log, which prepaid balance and corporate
  invoicing can't compose against. A genuine design insight, written where the next person will find it.
- **`driverBalanceDelta` sums the rows about to be inserted** rather than re-deriving from the split
  (`:171-178`), making `balance_cents == SUM(entries)` true *by construction* rather than by discipline.
- **AC #3b exists at all.** Most implementations of this never test charge-succeeded-database-failed. This
  one does, with a real mock rejection, and asserts key equality across both attempts.
- **The specs assert relations, not figures** — `sumOf(of('rider'))` is `0`, the platform account is checked
  as a contra *relation*, and `payments.integration.spec.ts:513-530` asserts that **every** ledger
  transaction in the database sums to zero, not just the ones this file wrote. That last one is a standing
  invariant that will catch a future second writer.
- **The debt limit is defended at four layers** — zod with no default, a test asserting the *absence* of a
  default, DB `NOT NULL` with the migration's temporary default dropped, and a schema-constraint case. The
  `limit = 0` test additionally proves the old rule is still expressible through config, making this a knob
  rather than a rewrite.
- **The stub's danger is correctly identified** (`payments.module.ts:30-33`): a payments stub that reports
  *success* is far worse than one that throws, because it produces settled rides and credited drivers with
  no money moved. Rightly the strongest of the three seam refusals.
- **The harness self-checks that its provider override actually took** (`test/harness.ts:388-397`) — the
  difference between "charged exactly once" testing something and passing vacuously.
- **No PII in the new log sites.** `customerRef`/`instrumentRef` appear in no log in the slice; only
  `providerRef` (a `pi_…`), with the reasoning recorded. The same discipline shows at the schema level.
- **The debt-limit fix was necessary and correctly bounded.** Catching that `balanceCents < 0` would strand
  a cash-only driver after their first ride — *before* it shipped — is the kind of thing that only surfaces
  when someone actually reasons through the money flow.

---

## Recommendation

**APPROVE.** The gate is green and independently reproduced. No Critical or High issues.

All four Medium findings are the same species: **a documented safety claim that the code doesn't implement**
— a promised log that doesn't fire, two comments claiming compile-time guarantees that aren't there, a
doctrine contradicted by its own fallthrough, and a reference doc describing the superseded rule. Every one
is inert at runtime today. None blocks a merge.

Finding 1 is the one worth fixing before #15 gives this route a production caller, since it is the
observability of the only path that can lose money. Finding 4 is worth fixing before the next dispatch
ticket, since the stale doc is what would invite the regression.

*Reviewed with fresh eyes per `piv-review-pr`: three `code-reviewer` agents across payments, ledger+schema,
and dispatch/shared/config; every finding re-verified against the file before inclusion. Agent items that
re-litigated documented decisions were discarded.*
