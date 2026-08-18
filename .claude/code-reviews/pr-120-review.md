# PR #120 review — force-assign, reassign and cancel from the board (#19 Phase A)

**Head** `ced2d30` · **Base** `main` @ `30d057b` · 39 files, +4961/−48
**Reviewed against** root `CLAUDE.md`, `apps/dispatch/CLAUDE.md`, `.claude/references/{ride-state-machine,realtime-events,dispatch-strategies,logging-standard}.md`, the plan and the implementation report.

**Recommendation: request changes.** One Critical on the money path, four High. Everything below was re-verified against the source in this worktree — no finding is passed through on an agent's word.

The design is sound and the reasoning in it is unusually good. The defect is a single blind spot with four faces: **the release undoes the ride's state but not the state that acceptance built around it** — the accepted offer row, the ride-room membership, the attempt count, the unclaimed clock. C1, H3, H4 and M3 are all that one omission, and they are worth fixing as one change to the release transaction and its post-commit tail.

---

## Validation

`observed` — my own run, this worktree at `ced2d30`, 2026-08-17 21:49:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **18/18 tasks, exit 0**.

| Package | PR body claims | I observed |
|---|---|---|
| `@taxi/api` test | 510 passed, 0 skipped, 57/57 suites | **identical** |
| `@taxi/shared` test | 167 passed (19 files) | **identical** |
| `@taxi/dispatch` test | 147 passed (20 files) | **identical** |
| `@taxi/db` test | 17 passed (3 files) | **identical** |
| typecheck · lint · build | clean | **clean** |

Every figure in the PR body's validation table reproduces exactly, including the zero-skip claim. CI is green on this same SHA (`ced2d30`, run 32066816201). Neither reported intermittent failure recurred in my run. `closingIssuesReferences` is empty, which is what this PR intends.

The gate is not what blocks this PR — a green suite is exactly what C1 predicts, because nothing tests it.

---

## Critical

### C1 · Money · A reassigned ride can settle on the wrong driver's commission split
`services/api/src/features/dispatch/reassign.service.ts:88-123` (cause) → `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts:65-74` (effect)

The release transaction moves the status, clears `driver_id`, releases the driver and writes the audit row. It never touches `ride_offers`. The outgoing driver's row is `status = 'accepted'` (set by `acceptOffer`, `dispatch.repository.ts:153-160`), and `revokePendingForRide` only matches `status = 'pending'` (`dispatch.repository.ts:216-221`) — so it survives. `ForceAssignService` then inserts a **second** row, also `status: 'accepted'` (`force-assign.service.ts:87`).

There is no constraint stopping that: `ride_offers` carries only `ride_offers_ride_idx` on `(ride_id)` and `ride_offers_driver_idx` on `(driver_id, status)` — no unique index, partial or otherwise (`db/src/schema/rides.ts:161-163`). Two accepted rows for one ride are legal.

At completion, `findAcceptedOfferSplit` reads:

```ts
.where(and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, 'accepted')))
.limit(1);      // ← no ORDER BY
```

`LIMIT 1` with no `ORDER BY` returns whichever row the heap yields. `complete()` (`ride-lifecycle.service.ts:138`) hands it to `writeSettledSplit`, which writes `rides.commission_pct / commission_cents / driver_net_cents` — the columns #12's ledger consumes verbatim.

**The split is driver-specific**, which is what turns ambiguity into money: `offer-builder.ts:53-54` computes it through `resolveCommissionPct({ commissionPctOverride: input.driverAttrs.commissionPctOverride }, config)`. So the harm needs one precondition — the outgoing and incoming driver resolve to **different** commission pct (either has an override). With both on the platform base the two rows agree and nothing visible happens, which is why the suite is green.

Neither existing guard catches it. `guardDriverStep` checks `ride.driverId === driverId`, and the new driver is correct. The `split.totalCents !== ride.totalCents` check at `ride-lifecycle.service.ts:144` passes, because both rows carry the same rider-facing total — the divergence lives entirely in `commissionCents` / `driverNetCents`.

Failure scenario: A has `commissionPctOverride = 10`, accepts. Dina reassigns to B (platform base 15%). B completes. The ride settles at 10%, B is overpaid, and the ledger records a commission the platform never agreed. Reverse the overrides and B is underpaid — the "€200→€130" grievance this product exists to answer, reproduced from the inside.

The same function's error message is now false: *"Both assignment paths write exactly one"* (`ride-lifecycle.service.ts:141`). Three paths write one; one ride can hold two.

**Fix**: inside the release transaction, supersede the outgoing driver's accepted offer — a repository method setting `status = 'revoked'` where `ride_id = $1 AND driver_id = $2 AND status = 'accepted'`. That restores the at-most-one-accepted-offer invariant both `findAcceptedOfferSplit` and that error message already assume. Add an integration assertion that after reassign + complete, `rides.commission_cents` equals the **second** offer's `split.commissionCents`, with the two drivers on different rates. Do not fix this with `orderBy(sentAt desc)` alone — it hides the ambiguity and leaves the invariant broken for every other reader.

---

## High

### H1 · A11y · Focus is managed once on mount, so the keyboard-first flow breaks at its last step
`apps/dispatch/src/features/override/dialog-shell.tsx:28-33`

The focus effect has `[]` deps, no cleanup, and never captures the opener. `AssignDialog` swaps steps by unmounting the picker (`assign-dialog.tsx:114`) — so when Enter or a click picks a driver, the element holding focus is destroyed and focus falls to `document.body`, outside the dialog subtree. The shell's `onKeyDown` (`:35`) is attached to the dialog div, so from that moment it sees nothing:

- **The confirm button is unreachable by keyboard.** ↓ ↓ Enter selects a driver, and there is no Tab path back into the dialog. This slice's premise is "a dispatcher on a call must manage without the mouse" (`apps/dispatch/CLAUDE.md:19`); the primary flow cannot be completed.
- **Escape stops closing.** The shell's own docblock (`:11-13`) calls that the escape hatch a dispatcher must always have.
- **Tab lands on the board behind the modal** — what `:44-46` calls "typing into nothing".
- On close (`page.tsx:267,277,289,293`) focus is never restored to the triggering row button, so Dina tabs from the top of the page back to her ride. WCAG 2.4.3.

Why the tests are green: `assign-dialog.test.tsx:114` fires the keydown **on** the dialog node. In a browser the event originates at the focused element, which by then is `body`. The test exercises a path the browser does not take.

**Fix**: in `DialogShell`, capture `document.activeElement` on open and restore it on unmount, and re-run the focus effect per step via a `focusKey` prop (`AssignDialog` passes `picked?.driverId ?? 'picker'`). Add `tabIndex={-1}` on the dialog container so it can hold focus when a focused child leaves. Then change the Escape test to fire from `document.activeElement`, and add one asserting the row button has focus after close.

### H2 · Correctness/i18n · A failed cancel shows the *assign* error; `console.cancel_failed` is unreachable
`apps/dispatch/src/features/override/use-assign.ts:146-154`

`post()` writes the assign-mapped key into component state at `:119`. `cancel()` rewrites only the returned `Outcome`, and `page.tsx:291-293` discards `outcome.key` — it renders `assignApi.errorKey` (`:287`). So the `'console.cancel_failed'` at `:151` can never reach a screen; the key sits unused in all three catalogs.

What Dina actually sees: cancel fails with `ride_not_cancellable` (`ride-lifecycle.service.ts:217`) or `ride_transition_conflict` (`:111,154,229`). Neither is in `ERROR_KEYS` (`assign-state.ts:86-92`), so both fall through to `console.assign_failed` — **«Neizdevās piešķirt. Mēģiniet vēlreiz.»** ("Could not assign. Try again.") — rendered inside the *Atcelt braucienu* dialog, on the destructive action, when the ride has already completed under her.

This is not general sloppiness. I checked all five mapped assign codes against `force-assign.service.ts:59,67,113,118` and `reassign.service.ts:65,69,85` — every one is genuinely thrown. The assign half was written against the real API; the cancel path was appended to it and never wired.

**Fix**: give `post` a `fallback: MessageKey = 'console.assign_failed'` parameter so the **state** write is right at the source, pass `'console.cancel_failed'` from `cancel()`, and map `ride_not_cancellable` / `ride_transition_conflict` in `ERROR_KEYS`.

### H3 · The cascade cannot reliably reclaim a released ride — the docblock's central guarantee is false
`services/api/src/features/dispatch/reassign.service.ts:39-43`

The two-transaction split is justified by: *"the failure mode is 'the ride sits in `requested` and the cascade picks it up' — the rider gets a car by the normal route."* Two mechanisms defeat it:

- `offerNext` gates on `countAttempts` (`dispatch.service.ts:61-68`), which counts **every** offer row for the ride regardless of status (`dispatch.repository.ts:106-112`). `MAX_OFFER_ATTEMPTS = 5`. Each cascade round and each override adds a row, so a ride that cascaded through a few candidates before acceptance is at or near the cap the moment it is released — `offerNext` returns without offering.
- `findTriedDriverIds` is "any offer row, any status" (`:97-104`), so the released driver and every earlier candidate are excluded. At ≤10 pilot drivers the candidate set can exhaust below the cap.

Worst case: attempts ≥ 5 **and** the `dispatch:unclaimed:<rideId>` key already spent within `UNCLAIMED_ALERT_DEDUPE_SECONDS = 300` from the original cascade. `raiseUnclaimed` deduplicates *before* it emits (`dispatch.service.ts:314-319`) and returns, so no alert fires.

To be precise about what Dina then sees, because it is not nothing: `requested` is in `BOARD_LIVE_RIDE_STATUSES` (`ride-state-machine.ts:53-58`), so the driverless ride **does** sit in her requested column. It just looks like an ordinary fresh booking — no unclaimed flash, no cascade working it, and M3 makes its displayed age read as time-since-booking rather than time-since-release. Outside the 300 s window she gets one alert. That visibility is why this is High rather than Critical.

**Fix**: exclude `source = 'dispatcher'` rows from `countAttempts` (an override is not a cascade attempt), or count only offers whose `sent_at` postdates the ride's last release. Either way, correct the docblock — as written it promises something the code does not deliver, which is the claim-accuracy rule applied to a comment that a reviewer would otherwise trust.

### H4 · Realtime/privacy · The released driver never leaves the ride room
`services/api/src/features/dispatch/reassign.service.ts:124-136`

`DispatchNotifier.emitAssigned` joins the assigned driver to `ride:<id>` (`dispatch-notifier.ts:66`) and calls that ordering load-bearing. There is no inverse in the release path. `RealtimeService.leaveRideRoom` **exists** (`realtime.service.ts:68`) and has **zero production callers** — grep across `services/api/src` returns only its own definition.

So after a reassign the removed driver's sockets keep receiving every subsequent `ride:status` for a ride they are no longer party to, plus the incoming driver's `ride:assigned` carrying that driver's id (`dispatch-notifier.ts:80-86`), plus the rider-position leg into the ride room once it lands (`realtime-events.md:7`). They also get no `ride:offer_revoked`, because their offer row is `accepted`, not `pending` — the same root cause as C1.

**Fix**: `this.realtime.leaveRideRoom(previousDriverId, input.rideId)` in the post-commit tail beside the `emitStatus` at `:127`, in the same never-throw try/catch shape the rest of the emit tail uses.

---

## Medium

**M1 · The dispatcher's free-text `reason` is emitted to the rider** — `reassign.service.ts:127` passes `input.reason` into `emitStatus`, which puts it on `RT.rideStatus` to the ride room (`ride-transition.service.ts:109-116`), i.e. rider + driver per `realtime-events.md:9`. Your own integration test sends `"first driver not moving"` (`dispatch.integration.spec.ts:614`). No client renders it today, so this is wire-level rather than visible. The reason already goes to `dispatch_audit_log`, which is where it belongs. **Fix**: pass `null` on the release emit.

**M2 · The half-completed reassign is untested** — `reassign.service.spec.ts:93-96` stubs `forceAssign` with a `jest.fn` that always resolves and offers no rejection knob; every failure case in the file asserts `forceAssign` was *not* called. The one path the two-transaction split exists to produce — release committed, force-assign throws — has no unit case and no integration case. `driverId` is validated as a uuid but never for existence before the release commits, so a stale roster row produces a 404 that reads as "nothing happened" while the ride has already lost its car. **Fix**: a rejection knob plus a case asserting the release still committed (ride at `requested`, `driver_id` null, release audit row present, error propagated), and an integration companion reassigning onto a non-existent driver. Pre-flighting the driver before the release would stop the commonest instance at source.

**M3 · A released ride reports staleness from its original booking time** — `unclaimedSeconds` (`dispatch.service.ts:321-324`) and `isStale` (`dispatch.sweeper.ts:149`) both derive from `ride.createdAt`. A ride booked 15 minutes ago, accepted, then released is instantly stale and reports `unclaimedSeconds: 900` — time since booking, not time without a car. **Fix**: derive the unclaimed clock from the ride's last entry into `requested`; the release audit row's `created_at` is already written.

**M4 · The dispatch slice's public API still says this feature does not exist** — `services/api/src/features/dispatch/index.ts:36-40` reads "NO `reassign` AND NO `cancel`. … `reassign` needs a cancellation path (#11) to be coherent." Under VSA, `index.ts` is the slice's contract surface and the first file a future reader opens. Note the shape: the report's deviation 8 records fixing this exact stale sentence in `dispatch.integration.spec.ts` and missing this copy — the sentence was grepped, not the noun, which is the failure `CLAUDE.md` names.

**M5 · Neither reference doc records the new backward edge** — `.claude/references/ride-state-machine.md:6` still shows a linear diagram with no dispatcher release, and its own line 3 says the code wins and the doc gets fixed. `realtime-events.md:9` says `ride:status` is "emitted on every state-machine transition" without warning that `status` can now move **backward** — any consumer written against a monotonic lifecycle needs that clause.

**M6 · Every row's action buttons share one accessible name** — `row-actions.tsx:50-59`. A 12-ride board gives a screen-reader user twelve buttons named «Piešķirt» and twelve «Atcelt braucienu»; the `<li>` text that disambiguates is announced in browse mode, not while tabbing, which is the mode this slice is built for. Cancelling the wrong ride is the failure. **Fix**: catalog keys with an `{address}` placeholder and `aria-label` per button — `ride-queue.tsx:110` already has the ride.

**M7 · The active option never scrolls into view** — `driver-picker.tsx:132-145`. The listbox is `maxHeight: 320` with 44px options, about five visible. With ten drivers, ArrowDown moves `aria-activedescendant` past the fold while the list stays put: the sighted keyboard user selects a driver she cannot see. Screen readers do follow `aria-activedescendant`, so this hits the primary persona specifically. **Fix**: `scrollIntoView({ block: 'nearest' })` on the active option.

---

## Low

- **L1** `GET /dispatch/drivers` is the slice's only unbounded read — no `LIMIT`, no city filter (`drivers.repository.ts:328-341`), where every sibling read is bounded (`findBoardRides(limit)`, `CANDIDATE_LIMIT`, `AWAITING_BATCH_LIMIT`). Fine at ≤10 drivers; it is the one read whose cost scales with the table.
- **L2** `unassignDriver()`'s WHERE carries no status predicate (`rides.repository.ts:421-432`). The release path is guarded by `assertTransition`, so the hard rule holds today, but the method is exported through the rides barrel and does not defend itself. Its sibling `setOnlineIfEligible` argues at length that this check belongs in the WHERE. One `inArray(rides.status, ['accepted','arriving'])` and the guard survives the next caller.
- **L3** `rgba(0, 0, 0, 0.5)` at `dialog-shell.tsx:72` is the only hardcoded colour in the app's feature source. Add `overlay` to `theme.ts` `colors` so the brand epic still lands by editing one file.
- **L4** `aria-controls="driver-listbox"` (`driver-picker.tsx:90`) points at an id that does not exist in the empty state (`:120-131`) — an axe `aria-valid-attr-value` violation. Mirror the conditional treatment already used on `aria-activedescendant`.
- **L5** Backdrop `onClick={onClose}` (`dialog-shell.tsx:68`): a drag-select starting in the reason textarea and releasing outside dispatches `click` at the backdrop, closing the dialog and losing the typed reason. Record the press target on `onMouseDown`.
- **L6** `findActiveRideIdsByDriver` was inserted between `findBoardRides`'s docblock and `findBoardRides` (`rides.repository.ts:230-272`), so the board note now documents the roster query.
- **L7** `rides.repository.ts` is at 461/500 lines. Not a violation; worth knowing before Phases B and C touch it again.

---

## Claims audit

The repo treats a number in a PR body as a claim. Checked every one; most hold.

**Verified true** (`observed`): the four test counts and the zero-skip result; `driver-picker.tsx` at 221 lines and no `max-lines` disable anywhere; `apps/rider` and `apps/driver` genuinely have no `src/`; `TRACKING_STATE_BY_STATUS.requested === 'searching'` (`notifications.policy.ts:126`), so the Q2 blast-radius argument stands; the new edges are asserted both positively and negatively in `ride-state-machine.test.ts:41-48`; no closing keyword, as intended.

**Two figures do not hold:**

1. **"30 `console.*` keys"** (PR body, report line 27) — the diff adds **28**, each present in all three catalogs, none missing. Originates in the report, inherited into the PR body.
2. **"Root `CLAUDE.md` predicts 24 short … this run is 0 short"** — with `REDIS_TEST_URL` unset, this head skips **28**, not 24 (`observed`: `Tests: 28 skipped, 482 passed, 510 total`, 2 skipped suites of 57). This branch's own four gated integration tests moved 24 → 28, so the PR body quotes a figure its own diff falsifies. The report even records an intermediate `478 passed, 28 skipped` run and still prints 24 as the prediction. **`CLAUDE.md:43` is now stale and this is the PR that made it so** — the file count (4) and skipped-suite count (2) still hold; the test count needs 24 → 28 with the provenance re-anchored to this run.

**Two comments carry claims their own code now contradicts** — the #87/#107 shape, and both are load-bearing rather than decorative: `ride-lifecycle.service.ts:141` ("Both assignment paths write exactly one", see C1) and `reassign.service.ts:41-43` (the cascade guarantee, see H3). Fixing C1 and H3 makes both true again; retiring the sentences without fixing the code would not.

Credit where it is due: A15 catches exactly this class of defect in `RideNotificationsService` — a retired invariant still justifying a live decision — and fixes the reasoning rather than deleting the comment. C1 and H3 are the same audit continued one step further into the release path.

---

## What is good

- **The `arrived`/`in_progress` exclusion is enforced twice and argued once.** Absent from `ALLOWED_TRANSITIONS` *and* from `RELEASABLE_STATUSES`, with the service-layer copy explaining why the duplication is deliberate: the table answers "is the hop legal", never "who may make it". Both layers have tests, including the negative half that stops someone quietly widening it to `arrived`.
- **`assign-state.ts` as a total `Record<BoardRideStatus, …>`** — adding a board status upstream becomes a build failure, not a row with no affordance, and the runtime companion test catches a bad default the type cannot.
- **The error map is real, not imagined.** All five codes in `ERROR_KEYS` are genuinely thrown by the services they name. H2 is the exception that proves the rule.
- **Roster lifecycle.** Fetched on dialog open, zod-parsed rather than trusted, snapshotted for the dialog's lifetime — so "the selected driver vanishes mid-dialog" cannot happen rather than being handled. `key={target.rideId}` kills cross-ride state leakage; the in-flight ref backs up the disabled button instead of trusting it.
- **`unassignDriver` is a true mirror of `assignDriver`** including the vehicle stamp, and the integration test asserts the new `vehicle_id` is non-null **and different** — which is what catches a release that leaves it null and puts the wrong plate at the kerb.
- **`AuditEntry.payload` earns its place**, and the integration test discriminates the release row from the assign row on `payload.event` rather than on row order.
- **i18n parity is compiler-enforced**, not conventional — `satisfies Record<Language, Record<MessageKey, string>>` makes a missing RU/EN key a typecheck failure.
- **The PR body is the most honest one in this repo's history**: it flags its own stale report line, names two forward-only assumptions it breaks before a reviewer could find them, and reports two intermittent failures rather than quietly re-running until green. C1 and H3 are failures of blast-radius *reach*, not of candour.

---

## Recommendation

**Request changes.** C1 blocks on its own — it is a hard-rule money defect with a silent failure mode and no test that would ever catch it. H1 blocks the slice's own stated premise (keyboard-first override). H2 puts the wrong message on the destructive action. H3 and H4 undermine the design's stated fallback.

Suggested order, since four findings share one root: fix the release path as a single change (revoke the outgoing accepted offer → C1; leave the ride room → H4; exclude dispatcher rows from the attempt count → H3; re-base the unclaimed clock → M3), each with the test that would have caught it. Then the frontend pass (H1, H2, M6, M7 and the Lows). Then the claims (the two figures, `CLAUDE.md:43`, `dispatch/index.ts`, the two reference docs).

Phase A's shape is right and the reasoning behind it is better than most merged code in this repo. It is the reach of the release that is short.
