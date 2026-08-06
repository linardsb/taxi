# Code review — PR #60 · `feat(api): carry the ride from accepted to completed (#11)`

**Branch** `feature/api-ride-lifecycle` → `main` · **22 files, +3610/−23** (1218 of them the plan doc)
**Reviewed at** `34fc89e` (local == `origin/feature/api-ride-lifecycle`)

**Recommendation: request changes — minor.** 0 critical, 0 high, 3 medium, 4 low. Nothing here is
architectural; the two that should land before merge are a two-line edit to one function.

> ⚠️ **This is posted as a plain comment, not a formal review state.** GitHub blocks both `--approve` and
> `--request-changes` on your own PR, and the reviewer here is the author's account. **No review state was
> recorded** — the "request changes" verdict above is advisory. A human other than the author still needs
> to look at this and set the actual state.

---

## Summary

This closes the half of the ride the platform never had, and it does it without adding transition
machinery: `RideTransitionService` stays the one guarded writer of `rides.status` and the one caller of
`assertTransition()`. Both verified by grep, not taken on trust.

**The money path — the part that matters most — is correct, and I could not break it.** The settled split
is copied from the accepted `ride_offers.split` snapshot and parsed through `fareSplitSchema` on the way
out of the database, so the no-cent-leak refinement (`commissionCents + driverNetCents === totalCents`)
runs *before* anything is written. `complete()` then checks the offer's `totalCents` against the ride's
own **before** opening the transaction, so a mismatched split writes nothing at all. That ordering is
right, and the test that guards it is the best test in the diff.

The findings are concentrated somewhere else entirely: **the logging**. Three separate rules in
`.claude/references/logging-standard.md` are violated, and one of them writes user-authored free text
into logs in a jurisdiction where that matters. Those are what hold the merge, not the lifecycle logic.

---

## Validation — run first-hand, not quoted from the PR body

`REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

| Task | Result |
|---|---|
| Gate overall | **20 successful / 20 total, 0 cached**, exit 0, 33.4s |
| `@taxi/api` test | **293 passed / 293**, 41 suites, 0 skipped |
| `@taxi/shared` test | **122 passed / 122**, 11 files (`schemas.test.ts` 38) |
| typecheck | clean |
| lint | 0 errors, 5 warnings — all pre-existing `app.getHttpServer()` `no-unsafe-argument`, one per integration spec |
| build | clean |

`REDIS_TEST_URL` was set to match the container on 6381, so the Redis-backed suites ran rather than
`describe.skip`-ing. Docker `db` + `redis` both healthy. A red suite would itself be a finding; this one
is green.

**Not run:** the playbook's Level 5 manual curl/psql ride, which the author flagged rather than silently
skipped. I agree with the call — integration tests 1, 4 and 8 drive the same sequence and the same
`commission_cents + driver_net_cents = total_cents` invariant against the same real Postgres. Noting it
so you can overrule if the phase gate is hard for closing #11.

---

## Issues

### Medium 1 · Rider-authored free text is written verbatim into logs (PII)

`services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts:373` — call site `:223`

`logApplied` puts `reason` straight into the structured log. `reason` is free text up to 280 chars
(`rideCancelSchema`), authored by a rider, driver or dispatcher.

**Failure scenario.** A rider cancels with *"waiting at Brīvības iela 42, call me on 26123456"*. That
string lands in the log with a street address and an unmasked phone number in it. The standard forbids
both explicitly (`logging-standard.md:14` — "Never log: full phone numbers (mask to last 3 digits),
addresses beyond geozone name"), and the plan's own logging section repeats it. For an EU platform this
is the finding with real downside beyond untidiness.

Scoping matters and the rest of the handling is fine: carrying `reason` on the wire
(`rideStatusEventSchema.reason`) and persisting it are both legitimate. **Only the log line is the
violation.**

**Fix:** in `logApplied`'s payload, replace `reason,` with `hasReason: reason !== null`.

### Medium 2 · No `actorId` on the lifecycle log events

`services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts:358-375` and `:383-397`

`logApplied`/`logRejected` record `actor` (the role) but never `actorId`. `cancel` has `input.actorId` in
hand at line 223 and does not pass it.

**Failure scenario.** Two dispatchers on shift. One cancels a moving `in_progress` ride — the single
ownership-bypassing action this PR adds, and the only actor the state machine lets kill a ride under way.
The durable traces are `rides.status = 'cancelled_by_dispatcher'` and a log line reading
`actor: 'dispatcher'`. **Nothing records which dispatcher.** Same for an admin.

This breaks `logging-standard.md:13` ("Always include: `rideId`/`orderId`/`driverId`/`userId` when known"
— `userId` is known and dropped), and it cuts against the codebase's own precedent: `forceAssign` writes a
`dispatch_audit_log` row precisely because an override without a named actor is unacceptable.

**Fix:** add an `actorId` parameter to both log helpers and pass it (`driverId` at the `driverStep`/
`complete` call sites, `input.actorId` in `cancel`). A dedicated cancel *audit row* is a bigger question —
`dispatch_audit_log` is shaped for assignments — so if that is out of scope, name it in the barrel's
KNOWN GAPS rather than leaving it implied.

### Medium 3 · The `on_ride` claim narrows double-assignment but cannot close it — and says nothing when it fails

`services/api/src/features/dispatch/dispatch.service.ts:210` and `:363`

`claimForRide` (`drivers.repository.ts:203`) is conditional on `status = 'online'`, so it returns `false`
for two situations that mean opposite things:

- a force-assigned **offline** driver — genuinely ordinary, and the docblock is right that throwing here
  would break the S9-2 override; and
- a driver who is **not claimable because they are already committed** — a real conflict.

Both call sites discard the return value, so the second case passes in silence.

**Reachable chain A — presence lost mid-offer** (verified end to end):

1. Driver D is `online` and receives a pending offer for ride 1.
2. D's app loses its last socket → `clearPresenceOnDisconnect` (`drivers.service.ts:129-137`) writes
   `drivers.status = 'offline'`.
3. D reconnects and taps Accept before the offer expires. `acceptOffer` checks only `pending` +
   `driverId` + `expiresAt > now()` — nothing about presence — so it succeeds. The ride reaches
   `accepted`; `claimDriver` returns `false` (status is `offline`, not `online`) and is discarded.
4. D taps "go online". The `driver_on_ride` guard (`drivers.service.ts:84-85`) tests
   `profile.status === 'on_ride'`, but D is `offline`, so **the guard never fires** and D goes `online`.
5. Next sweeper tick: `toCandidates` (`strategies/candidate-filter.ts:29`) sees `online` and offers D a
   second car while they are driving ride 1.

**Reachable chain B — two live offers.** Nothing in `toCandidates` or `offerNext` excludes a driver
already holding a pending offer on a *different* ride (the `tried` set is per-ride). Two `requested`
rides, one online driver, both offered before either is accepted; D accepts both — ride 1's
`revokePendingForRide` only revokes ride 1's siblings. Completing ride 1 then calls `releaseFromRide` and
sets D back to `online` while ride 2 is still `in_progress`.

**This is not a regression and does not by itself hold the merge.** Before this PR `drivers.status` was
never written at all, so D stayed `online` throughout and the hole was universal. The PR's claim — "a
driver who accepted a ride stayed `online`, so the next sweeper tick could offer them a second car" — is
accurate, and that specific path *is* closed.

**Fix, in this PR (small):** capture the return value in `accept` and `logger.warn` on `false`, so the
hole is at least observable; add a KNOWN GAPS line. Do **not** widen the claim's WHERE to
`status <> 'on_ride'` — `releaseFromRide` would then put a legitimately-offline force-assigned driver
`online` at completion, which is the case the `online`-only guard exists for.

**Fix, separate ticket:** gate `setPresence('online')` on "no active post-acceptance ride", and stop
offering a second card to a driver already holding one. That is #10's offer model, not this slice.

> **Correction to note:** the misleading premise — *"In `accept` it cannot realistically be false (the
> driver was `online` to be offered)"* — is in the **plan document**
> (`.claude/plans/api-ride-lifecycle.md:778`), **not** in the shipped code. The comment at
> `dispatch.service.ts:206-209` says "`false` is ordinary, never an error", which is accurate. Worth
> correcting the plan's GOTCHA so the next reader doesn't inherit the assumption.

### Low 4 · The three lost-race 409s log nothing

`ride-lifecycle.service.ts:96`, `:136`, `:202`

Each throws `ConflictException('ride_transition_conflict')` without emitting
`ride.lifecycle.transition_rejected`. `logging-standard.md:15` says *every* state-machine rejection logs
that event with `from`, `to`, `actor` — and a conditional UPDATE that matched no row is one. Two
concurrent completes: the loser gets a typed 409 and leaves no trace.

Low rather than Medium because the *primary* rejection paths (`guardDriverStep`, `cancel`'s
`canTransition`) are logged correctly. **Fix:** call `logRejected` with a `reason: 'lost_race'`
discriminator before each throw.

### Low 5 · `changePaymentMethod`'s 404-masking branch is untested

`ride-lifecycle.service.ts:255-269`; spec `ride-lifecycle.service.spec.ts:469-516`

The three unit cases cover locked, terminal and success. The load-bearing behaviour is the *masking* —
the docblock says a 403 "would confirm the id exists to whoever guessed it" — and nothing verifies that a
rider patching another rider's ride gets `ride_not_found` rather than a 403 or a leaked status.

**Fix:** one case — `build({ paymentUpdated: false, ride: lifecycleRide({ riderId: SOMEONE_ELSE }) })` →
expect `NotFoundException`.

### Low 6 · A test asserts less than its name claims

`services/api/src/features/dispatch/dispatch.service.spec.ts:213-221`

Named *"claims the driver on_ride inside the transaction"*, but asserts only
`expect(claimDriver).toHaveBeenCalledWith(expect.anything(), DRIVER_ID)`. The spec's `db.transaction`
fake records nothing and `expect.anything()` matches the `{}` tx object, so **the test would still pass
with the claim moved outside the transaction** — which is the one thing the name promises it checks.

**Fix:** the mechanism already exists one slice over — copy the `events` ordering ledger from
`ride-lifecycle.service.spec.ts:71-80` and assert the claim lands between `tx:begin` and `tx:commit`.

### Low 7 · A driver stranded on `in_progress` has no self-service exit, and it isn't in KNOWN GAPS

`services/api/src/features/rides/index.ts:4-38`

`ALLOWED_TRANSITIONS.in_progress` is `['completed', 'cancelled_by_dispatcher']`, so the driver cannot
cancel; and `setPresence` refuses **both** `online` and `offline` while `on_ride`
(`drivers.service.ts:84-85`), so they cannot go offline to end their shift either. Their only exits are
tapping Complete — settling a fare for a ride that may not have happened — or phoning a dispatcher. (At
`accepted`/`arriving`/`arrived` the driver *can* self-cancel and be released, so this is specific to
`in_progress`.)

The plan documents "no sweeper timeout invented here"; the *consequence* is not recorded. **Fix:** one
KNOWN GAPS line.

---

## What I verified rather than assumed

| Claim | Verdict |
|---|---|
| Money invariant holds on every path | **Confirmed.** `findAcceptedOfferSplit` parses through `fareSplitSchema` (`commission.ts:60`), whose refinement *is* the sum check, so malformed jsonb throws before any write. `complete()` checks `split.totalCents === ride.totalCents` *before* the transaction. Money columns are `integer`. No float, no truthiness bug — `resolveCommissionPct` uses `!= null`, so a 0% override survives, and it has a test. |
| Missing accepted-offer row → 500 | **Unreachable.** Both assignment paths write one: `accept` flips the pending offer, force-assign inserts `status: 'accepted'` (`dispatch.service.ts:325`). The loud `Error` is a correct data-bug guard, not a live path. |
| Partial settlement observable | **No.** All four columns are one UPDATE inside the same transaction as the status change, and `toRide` projects a split only when all five money columns are non-null. |
| Two concurrent completes → one winner | **Confirmed by SQL, not read-then-write.** `transitionInTx` is `UPDATE … WHERE id = ? AND status = from` (`ride-transition.service.ts:83-87`); the loser's callback throws inside `db.transaction` and the split write rolls back with it. |
| Payment lock is one race-free conditional UPDATE | **Confirmed.** Ownership, existence and editability are all in the WHERE (`ride-lifecycle.repository.ts:111-121`); the follow-up read only selects the error message, and racing *that* costs a wrong message, never a wrong write. `PAYMENT_METHOD_EDITABLE_STATUSES` is derived from `isPaymentMethodLocked` + `isTerminal`, so the hard rule isn't bypassed by a hand-written list. |
| No socket emit inside a transaction | **Confirmed** at all three new sites, and mechanically asserted by the unit spec's ordering ledger. |
| Authorization | **Sound.** Per-route `@Roles`; actor from `user.role`, never the body (`rideCancelSchema` has no actor field, by construction). Ownership checked per-ride on top of role (`:179-184`, `:292`). A driver cannot complete a ride they were not assigned; a rider cannot advance someone else's. `admin → dispatcher` is total over `USER_ROLES`, and `system` is unreachable over HTTP — typecheck proves `user.role` can never be `system`. |
| Dispatcher cancelling a *settled* ride | **Closed.** `ALLOWED_TRANSITIONS.completed` is `['settled']`, so `canTransition` refuses every `cancelled_by_*` from `completed` and answers a typed 409. |
| One `rides.status` writer, one `assertTransition` caller | **Confirmed by grep.** Exactly one call site (`ride-transition.service.ts:81`); every other hit is a comment. The slice's only `set({ status })` targets `ride_offers`. |
| New required `rideSchema.paymentMethod` breaks a consumer | **No.** `rides.payment_method` is `.notNull()`, `toRide` supplies it, and no app parses `rideSchema` (`grep -rn "rideSchema" apps/` is empty). |
| DI cycle / route shadowing | **Neither.** `RidesModule → DriversModule → RealtimeModule` only. `RidesController` declares just `@Post()`, so no lifecycle route is shadowed. |
| PR edits its own rubric | **Additive, not goalpost-moving.** The `ride-state-machine.md` edit documents routes and 409 codes that now exist and records `completed → settled` as unimplemented — consistent with `ALLOWED_TRANSITIONS`, where the edge exists but nothing drives it. The `CLAUDE.md` line documents a real new divergence this PR creates. |

**Documented deviations 1–8** were read against the code and treated as intentional decisions, per the
review process — none is reported above. Deviation 2 (`driverStep` skips `canTransition`) was
re-verified independently since it touches the state machine: all four `DRIVER_STEPS` pairs are edges of
`ALLOWED_TRANSITIONS`, so for a fixed step table `status === from` implies legality, and `transitionInTx`
re-runs `assertTransition` anyway. It holds. Deviations 2 and 3 are improvements on the plan, not
concessions.

---

## What's good

- **The copy-don't-recompute rule is enforced by a test that would actually catch its violation.**
  `ride-lifecycle.integration.spec.ts:385-441` flips `commissionPctOverride` from 5 to 40 *mid-ride* and
  asserts the persisted `commission_pct` is still 5. That is an assertion about a value, not about a
  call. It makes "recompute at completion" impossible to reintroduce quietly — the €200→€130 grievance
  encoded as a test rather than a comment. Best thing in the diff.
- **The ordering ledger** (`ride-lifecycle.service.spec.ts:71-80`) turns "no socket emit inside a
  transaction" from a review item into a mechanical one, asserting
  `tx:begin → write:split → release → tx:commit → emit:status` exactly.
- **The in-transaction conflict branch is tested deterministically** (`:286-301`) — the one path no
  integration test can force reliably — and it asserts *no split written, nothing emitted*, not merely
  that an exception was raised.
- **Ordering discipline in `complete()`:** both validity checks before the transaction opens; status,
  split and release commit together; emits and the settlement log after.
- **`PAYMENT_METHOD_EDITABLE_STATUSES` derived rather than listed** — the obvious implementation is a
  hand-written array, which would have rotted the first time #21/#22 added a status *and* quietly
  bypassed the hard rule.
- **Error taxonomy:** client-illegal transitions get a typed 409 via `canTransition`; `assertTransition`
  keeps its role as the 500-worthy programming-error guard. `changePaymentMethod` returns 404 rather than
  403 for someone else's ride, so the endpoint doesn't confirm ids to whoever guessed them.
- No `any`, no `@ts-ignore`, no non-null `!` in production files; file sizes well under the cap (399 /
  150 / 115 / 72); no money or commission literal anywhere in the diff.

---

## The product decision for you

**`completed → settled` is deliberately not implemented.** A documented deviation whose reasoning matches
the pre-existing definition of `settled` ("money movement finished — ledger entries written"), #11's
acceptance criteria never mention it, and `ALLOWED_TRANSITIONS` keeps the edge free for #12. Going there
with zero ledger rows would make the status false for every ride until #12 ships.

I agree with the author's recommendation — but the ticket title says "→paid", so this is a scope call,
not a code call. **It needs your explicit yes or no, not the reviewer's.**

---

## Recommendation

**Request changes — minor.** The lifecycle logic, the money path and the concurrency handling are sound
and I could not break them. What holds the merge is three verified violations of
`.claude/references/logging-standard.md`:

1. **Medium 1** (PII in logs) and **Medium 2** (missing `actorId`) are the same function, `logApplied` —
   together a two-line edit. These should land before merge.
2. **Medium 3** needs only its small half here: log the discarded `false` and add a KNOWN GAPS line. The
   real fix is a follow-up ticket against #10's offer model.
3. The four Lows are polish and can travel in the same commit or a follow-up, as you prefer.

Re-run `pnpm turbo run typecheck lint test build --force` after the fixes. Natural next step is
`piv-fix-review-findings` against this file.
