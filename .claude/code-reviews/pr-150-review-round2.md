# PR #150 review — round 2

**Head** `1eb97f5` · **Base** `main` @ `0a619d3` · **Round** 2 · **Reviewed** 2026-09-04
**Scale** 111 files, +9,404 / −1,511 · **State** OPEN · reviewing `1eb97f5`, the round-1 fix pass, on top of `8cd083f`

## Recommendation — request changes

**21 of round 1's 22 findings genuinely close**, checked against the current source rather than
against the commit message, and several with tests that fail when the fix is reverted. I re-ran C1's
repro independently: delete `joinRideRoom` from `findForRider` and the new integration test fails
with the exact string the PR body quotes. The claim-sweeping is real work — M4's rules-file
correction ("**by choice, not by schema**") is the model of how to retire a claim, and H2's deadline
now labels itself `expected, not measured` instead of asserting a measurement it never took.

Two Highs, and both are round-1 fixes that moved their defect rather than closing it:

- **R1** — C1's fix relocated delivery's precondition into a REST call whose failure is swallowed and
  never retried. **After this fix `connected` no longer implies "can hear anything":** the banner's
  condition and the delivery condition are two different requests and nothing reconciles them.
- **R2** — L8's serialisation is the right mechanism, but one rejected write poisons the queue for
  the session, and the reachable trigger is a **41-character label**, not a rare IO error. Every
  later save and delete silently does nothing, and the UI clears the field exactly as it does on
  success. Reproduced.

One round-1 finding (**L5**) is not closed at all — the PR body's "Every one is fixed; nothing was
deferred" is wrong about it.

---

## Validation — `observed` 2026-09-04 at `1eb97f5`

`pnpm install --frozen-lockfile` (exit 0), then from cleared `dist` / `.turbo` / `.next`:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force   → exit 0, 22/22 tasks, 0 cached, 1m22.82s
```

| Package | Suites / files | Tests | PR body claims | |
|---|---|---|---|---|
| `@taxi/api` | 73 | 691, **0 skipped** | 691 / 73 | ✅ |
| `@taxi/rider` | 30 | 136 | 136 / 30 | ✅ |
| `@taxi/shared` | 23 | 217 | 217 / 23 | ✅ |
| `@taxi/dispatch` | 27 | 224 | 224 / 27 | ✅ |
| `@taxi/driver` | 27 | 109 | 109 / 27 | ✅ |
| `@taxi/db` | 3 | 17 | 17 / 3 | ✅ |

`REDIS_TEST_URL` was set and api reports `691 passed, 691 total` — nothing gated off, not the
"green and 33 short" shape. Wall time differs from the body's 1m18s; that is the machine.

**The dispatch flake was not reproduced and its supporting evidence holds.** `@taxi/dispatch` passed
224/27 inside the full gate and again alone, and `git diff --name-only origin/main...HEAD | grep
dispatch` returns 0 files. I cannot confirm the flake itself — recording that rather than treating
it as settled.

**A green gate is not evidence for either High.** R1 needs the read to fail and no test rejects it
(`use-ride-status.test.tsx` has seven cases, at `:91 :112 :135 :160 :177 :196 :211`, none of them a
rejection). R2 needs a save to fail and no test makes one fail.

---

## High

### R1 · `apps/rider/src/features/ride-status/use-ride-status.tsx:96-106, 116-121` — the join is now a request whose failure is silent, so `connected` no longer means the socket can hear anything

C1's fix is sound in the happy path and I confirmed it end to end. But it moved delivery's
precondition into an ordinary REST call:

```ts
const refetch = () => {
  const at = applied;
  void api.request('GET', `/rides/${rideId}`, { schema: rideSchema })
    .then(...)
    .catch(() => undefined);      // ← the join's only failure handler
};
...
socket.on('connect', () => {
  setState((s) => ({ ...s, connected: true }));   // ← set before the read is known to have worked
  refetch();
});
```

`refetch()` fires again only on the next `connect`. The socket is a *different connection* from the
one that failed, so it stays up and there is no next `connect` — no second attempt, ever.
`socket.ts:26-31` confirms reconnection is socket.io's own and is driven by transport loss alone.

**Failure scenario.** Rider books; `/book/status` mounts; the WebSocket handshake succeeds;
`GET /rides/<id>` fails once — an api restart behind Caddy, a 502, or a request timeout on a slow
link that the already-established WebSocket survives. `connected` is `true`, so
`status-screen.tsx:115`'s `rider.status.reconnecting` banner does not render. The server never ran
`joinRideRoom` for this socket, so no `ride:status` can reach it. A driver accepts; the screen still
reads «Meklējam auto…» and announces nothing. That is round-1 C1's outcome verbatim — the screen
reassuring the rider it is live while nothing can arrive — now gated behind one failed request
instead of happening always.

**`observed`, in halves, because each half is separately decisive.** Server half: the repro I ran for
the numbers pass — with the join absent, the new integration test reports `timed out waiting for 1
ride:status events, saw 0`. Client half: read from the source above, one `catch` that discards and
one `connect`-scoped call site.

**The seam, which is the part worth fixing rather than patching.** `connected` is a claim about the
transport; delivery is a claim about a separate HTTP request. The rider's only signal is derived
from the weaker of the two.

**Fix:** retry inside the `catch` (bounded backoff, or one re-fire), and track *joined* separately
from *connected* so the reconnecting banner covers **connected but never joined**. The existing
harness already fakes `api.request`, so a test that rejects the first read and asserts the banner
(or the second attempt) is cheap.

### R2 · `apps/rider/src/features/places/use-saved-places.tsx:74-80` + `booking-screen.tsx:165-177` — one rejected write disables saved places for the rest of the session, and a 41-character label is enough to trigger it

L8's serialisation is real — a promise chain plus refs, not another closure over `places` — and it
closes the lost-write it was written for. But the chain has no failure handling:

```ts
pending.current = pending.current
  .then(() => work(latest.current))   // :75
  .then((next) => { latest.current = next; setPlaces(next); return next; });
```

A rejected `work` leaves `pending.current` rejected. Every later `enqueue` chains
`.then(() => work(...))` onto it, and **`.then` with only an onFulfilled handler passes the rejection
through without calling `work` at all** — no write is attempted, `setPlaces` never fires, and the
queue stays dead for the provider's lifetime. `remove` goes with it; it shares `enqueue`.

**The trigger is in the UI, not in the storage layer.** `savedPlaceSchema.label` is
`z.string().min(1).max(40)` (`saved-places-store.ts:19`) and `toSavedPlace` uses `.parse` (`:96`).
`save` calls `toSavedPlace` **inside** the queued `work` (`use-saved-places.tsx:88-90`), so a
`ZodError` rejects the chain. The label field has no `maxLength` — `grep maxLength` over
`TextField.tsx` and `booking-screen.tsx` returns nothing, and `TextField` spreads `...rest` into
`TextInput`, so the prop exists and simply is not passed. The Button guards emptiness only
(`booking-screen.tsx:173`).

**Failure scenario.** Rider saves «Mājas» — it lands. Rider types a 41-character label for the next
address and taps «Saglabāt». Nothing is written; `setLabel('')` at `:176` runs regardless, so the
field clears exactly as it does on success. From then on **every** save and **every** delete does
nothing, silently, for the rest of the app session. `void save(...)` at `:175` has no `.catch`, so
the rejection is also unhandled.

**`observed` — two repros under the app's own RNTL harness, each with a control, both reverted
(`git status` clean).**

```
(1) storage failure   mockRejectedValueOnce on AsyncStorage.setItem
    after the rejected save:  setItem calls = 1, list = count:0
    after the NEXT save:      setItem calls = 1, list = count:0   ← work never ran
    CONTROL: a direct AsyncStorage.setItem/getItem round-trips     ← the store is healthy

(2) 41-char label     three distinct addresses, no IO mocking at all
    CONTROL save A:  count:1                                       ← the queue works
    41-char label:   count:1                                       ← that save fails, as designed
    save C:          count:1                                       ← the queue is dead
```

Both `jest --runTestsByPath` → 1 passed.

**This is a fix that moved the defect.** Before `1eb97f5` the same 41-character label was one failed
save and the next tap worked; chaining made the failure permanent.

**Fix — both halves:**
1. Terminate the chain's failure: `pending.current = pending.current.then(...).then(commit).catch(()
   => latest.current)`, so the next write starts from the last good list, and surface the failure on
   the returned promise instead of on the queue.
2. `maxLength` on the label field, sourced from `savedPlaceSchema` rather than a literal `40`, so
   the reachable trigger stops existing.

`use-saved-places.test.tsx:91` pins two concurrent saves; add one where a write rejects.

---

## Medium

### R3 · `use-ride-status.tsx:91-106, 117` — the staleness guard orders reads against events, never against each other, and the docblock claims otherwise

`let applied = 0` counts **events**. Both cold-start reads — the mount read at `:106` and the connect
read at `:117` — capture `at = 0` whenever no `ride:status` has landed between them, so neither is
dropped and **the last response to arrive wins, regardless of which snapshot is newer.**

**Failure scenario.** Mount `GET` issued at t=0, its query executes server-side at t=300 ms →
`requested`. Handshake completes at t=310 ms; the connect `GET` executes at t=350 ms, by which point
a driver has accepted → `accepted`, landing at t=360 ms → the screen renders «Auto ir atrasts» and
announces it. The mount response, delayed behind it, lands at t=400 ms with `requested`, `applied`
is still `0`, the guard passes, and the screen reverts to «Meklējam auto…» for an accepted ride —
and announces that too. Self-correcting on the next transition, but a screen reader has already
spoken the wrong thing.

Round 1's code fired the second read only on a **re**connect, seconds or minutes after the mount
read. `1eb97f5` fires it on the first connect too, so the pair now overlaps within a few hundred ms
on every cold start. The docblock at `:56-59` names the design ("TWO READS ON A COLD START,
deliberately") and argues only the response-vs-handshake race.

**And the guard's stated provenance is wrong.** `:84-90` says "The `quoteRequestId` guard in
`booking-draft.ts` is the same rule." It is not: `quoteRequestId` is a monotonic **request** id that
orders requests against each other (`booking-draft.ts:108, 113, 117`); `applied` orders reads
against events only. The sibling that would have caught this is cited as the precedent for not
having it.

The other direction is fine — the guard never drops a read it needed, because the server takes its
snapshot before it joins the room (R7), so an event that beat the response home is strictly newer.

**Fix:** a second monotonic counter — `const id = ++issued`, and drop when `id < newestApplied` —
plus a case beside `use-ride-status.test.tsx:135` for two reads in flight with the older-snapshot
one resolving last.

### R4 · `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts:713-720` + the PR body — C1's control sits where the failure case cannot reach it

```
:715   await waitForCount(() => mine().length, 1);      ← throws when the join is missing
:716   expect(mine().map((e) => e.status)).toEqual(['offered']);
:719   // CONTROL: the ride moves either way …
:720   expect((await rideRow(ride.id)).status).toBe('offered');
```

The control exists to separate "the socket was deaf" from "dispatch did nothing" — a distinction
that only matters **when the test fails**. It sits after the line that throws in exactly that case,
so it never runs there. My repro confirms it: with the join removed, the run printed the
`waitForCount` throw and nothing else.

The docblock at `:687-689` and the PR body both present the conjunction as one run's output — fails
"`timed out waiting for 1 ride:status events, saw 0` **while its control still reads `offered`**".
The failure string is real and I reproduced it verbatim; the control half was not produced by that
run and cannot be. It is *true* — round 1's own C1 repro asserted it — but it is inherited, not
observed, which is the labelling rule this repo has now tripped over three times.

**Fix:** move `expect((await rideRow(ride.id)).status).toBe('offered')` **above** `waitForCount`,
where a failing run will print it. One line, and the control starts doing its job.

### R5 · `services/api/src/features/rides/index.ts:16-24` + `rides.service.ts:184-187` — "no driver" is still not true; the sentence was rewritten around the half that was fixed

Round 1's M3 named two things crossing the wire: `split` **and** `driverId`. The fix strips `split`
(`return { ...found.ride, split: null }`) and the prose was rewritten to enumerate that — "no driver,
no position, no ETA, no plate, and no `split` — that field is stripped rather than merely absent."
The `driverId` half is unchanged: `toRide` still projects `driverId: row.driverId`
(`rides.repository.ts:106`), and `rideSchema` also carries `trackingToken` and `geozoneId`.

The payload is opaque uuids and the reader is the ride's own rider, so this is not a leak of driver
identity — I checked `assignment`, which `toRide` hardcodes to `null`, so the dispatcher's free-text
override `reason` does **not** cross. The defect is the claim, in exactly the shape `CLAUDE.md`
warns about: a finding was half-closed and the sentence rewritten around the closed half, leaving an
unqualified "no driver" standing next to a `driverId` on the wire. Round 1's own fix note offered
the alternative — *rewrite the barrel to say what crosses the wire* — which is what the M4 fix did,
and did well.

**Fix:** say what crosses. "Returns the ride row with `split` stripped: no driver record, no
position, no ETA, no plate — `driverId` and `trackingToken` are on it; #17 adds the rest."

### R6 · `apps/rider/app.json:25` — L5 is not closed, and the plan states the false half absolutely

Removing `ACCESS_FINE_LOCATION` from `app.json` does not remove it from the build. `expo-location`'s
config plugin adds it unconditionally:

```ts
// node_modules/expo-location/plugin/src/withLocation.ts:243-249
return AndroidConfig.Permissions.withPermissions(config, [
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  ...
```

and the library's own manifest declares it independently
(`node_modules/expo-location/android/src/main/AndroidManifest.xml:3`), which manifest-merges into the
APK whether or not the plugin runs. Both quoted verbatim from the tree at HEAD.

The runtime consequence is small — a wider ask than `Accuracy.Balanced` needs — which is why this is
Medium and not High. What is wrong is the claim plus the accounting:
`.claude/plans/rider-app-auth-booking-screen-reader-first.md:706` reads "`android.permissions:
["ACCESS_COARSE_LOCATION"]` **and nothing else**", and the build contradicts it; and the PR body says
"**Every one is fixed; nothing was deferred**" of all 22 findings, which is not true of L5. To the
author's credit the report marks the figure `expected` and discloses that the `expo config` run
predates the fix, so this is an unverified claim rather than a false `observed` one. **AC #9 itself
still holds**: no `ACCESS_BACKGROUND_LOCATION`, no `FOREGROUND_SERVICE*`, no
`RECEIVE_BOOT_COMPLETED` — the plugin adds those only behind flags that are off.

**Fix:** `android.blockedPermissions: ["android.permission.ACCESS_FINE_LOCATION"]` in `app.json`
(which emits `tools:node="remove"` and does defeat the library manifest), then run
`npx expo config --type public` and record the result as `observed`. Or drop "and nothing else" and
name the two sources.

---

## Low

**R7 · `rides.service.ts:199-215` — the snapshot is taken before the join, so "closes both holes"
needs a qualifier.** `findWithQuote` (`:199`) reads, then the ownership check, then `joinRideRoom`
(`:205`). An `emitStatus` that fires after the SELECT's snapshot but before `:205` is missed by the
socket **and** absent from the response. Lines 200-205 run in one synchronous continuation, so the
exposure is the DB round trip only — order 1-5 ms. *Scenario:* the driver taps Complete while the
connect read's result is in flight; the socket joins a beat later, the response carries
`in_progress`, nothing emits again, and the screen keeps the Cancel button on a completed ride — the
M6 state, reopened. Not a C1 regression (the wide client-side window is covered, because the
snapshot is taken after it). **Fix:** re-read after the join and return that — the ownership check
still gates the join, so the security argument at `:174-177` survives — or keep the order and state
the window.

**R8 · `rides.integration.spec.ts:547-567` — the one security property of a now-side-effecting GET has
no assertion.** `rides.service.ts:174-177` argues at length that the join must follow the ownership
check, because joining first "would put a stranger's socket in the room the 404 below is about to
deny them". E14 asserts **status codes only** — 404 for rider B, 404 for a fabricated uuid. A future
reorder that hoisted `joinRideRoom` above the check would leak rider A's whole `ride:status` stream
to rider B with every test still green. **Fix:** extend E14 — connect B's socket, `collectStatuses`,
`GET /rides/:aRideId` → 404, `offerTo(ride)`, assert B's `seen` is empty against a CONTROL that the
ride moved. `:695` already has that shape.

**R9 · `rides.service.ts:194` — the type does not carry M3's guarantee.** The signature is
`Promise<Ride>` and `rideSchema.split` is `fareSplitSchema.nullable()`
(`packages/shared/src/schemas/ride.ts:258`), so a future edit returning `found.ride` typechecks
cleanly and only the integration test catches it. `Promise<Omit<Ride, 'split'> & { split: null }>`,
or a named `RiderVisibleRide` in the slice, makes the barrel's guarantee structural.

**R10 · `apps/rider/src/components/Banner.tsx:34, 45` — L7's rewrite kept the driver app's review
codes.** The prose is rewritten and the `expected` labelling is exactly right, but "(review F28)" and
"(review F47)" are findings from **PR #139's** review
(`.claude/code-reviews/pr-139-review-round3.md:18, 73`) and "Plan §C.12" is that plan's section —
neither exists for #16. The rider app's owed TalkBack pass is
`docs/runbooks/rider-a11y-walkthrough.md` step 12, which names it already. Point at the runbook.

**R11 · `.claude/reports/rider-app-auth-booking-screen-reader-first-report.md:315-316` — two stale
figures survived the round-1 re-measure.** §D5 and the line-count section were correctly re-measured
(`lv.ts` **386**, `rides.service.ts` **451** — both confirmed here by `wc -l`). The closing paragraph
still reads "`lv.ts` at 368 lines, `rides.service.ts` at 418", the first-submission values. Harmless
in effect — it is an instruction telling the PR author to re-derive, and the PR body did — but it is
the same "grep the noun, not the sentence" miss.

---

## The numbers pass — every figure in the PR body reproduces

Re-derived at `1eb97f5`, one check per claim, nothing inherited from round 1's report.

| Claim | Re-derived | |
|---|---|---|
| 111 files, +9,404 / −1,511 | `git diff --shortstat origin/main...HEAD` — exact | ✅ |
| 88 added / 21 modified / 2 deleted / 0 renamed | `--diff-filter=A/M/D/R` → 88 / 21 / 2 / 0 | ✅ |
| `rider.*` = 59 keys × 3 languages | 59 in each of lv/ru/en | ✅ |
| "54 at first submission; +6, −`status_changed`" | 54 + 6 − 1 = 59; catalogs 268 → 273 keys (+5) | ✅ |
| lv/ru/en key sets identical | 273 each; `diff` empty both ways | ✅ |
| `rider.a11y.status_changed` removed | no live reference in `apps/rider/src` — two explanatory comments only | ✅ |
| gate exit 0, 22/22 tasks | exit 0, 22 successful / 22 total, 0 cached | ✅ |
| api 691/73 · rider 136/30 · shared 217/23 · dispatch 224/27 · driver 109/27 · db 17/3 | all six exact | ✅ |
| api 0 skipped | `691 passed, 691 total` | ✅ |
| rider 113 → 136 = +23 cases, 29 → 30 suites | 136 − 113 = 23; `--diff-filter=A` on `1eb97f5` → `session-guard.test.tsx` is the **only** added rider test file | ✅ |
| +12 api / +6 shared vs `main`, none removed | added `it(`/`test(` in the diff: 12 and 6; removed: 0 and 0 | ✅ |
| agrees with the gate arithmetic | 691 − 679 = 12; 217 − 211 = 6 | ✅ |
| `f5a8dd1` is 9 commits behind the base, docs only | `rev-list --count` = 9; `diff --stat` = 3 review docs, 1 report line, 1 skill file | ✅ |
| `RIDE_QUOTE_MAX_PER_WINDOW = 30` | `rides.policy.ts:77` | ✅ |
| `geo.module.ts` byte-identical to `main`'s | `git diff origin/main -- <file>` empty | ✅ |
| runbook "12 steps" | 12 numbered step headings | ✅ |
| no `apps/dispatch` file changed | `--name-only \| grep dispatch` → 0 | ✅ |
| `#16` stays open, nothing closes | `closingIssuesReferences` empty | ✅ |
| report: `lv.ts` 386 · `rides.service.ts` 451 · `ride.ts` 372, cap 500 | `wc -l` → 386 / 451 / 372; 500 − 451 = 49 headroom | ✅ |
| report: "+18 for the six new keys" | 386 − 368 = 18 | ✅ |
| C1 repro fails with `timed out waiting for 1 ride:status events, saw 0` | **re-run here**: join deleted → that exact string, `1 failed, 21 passed`; restored → passes; tree clean | ✅ |

**Two things the pass turned up rather than confirmed:** the C1 repro's control half is over-claimed
(R4), and "Every one is fixed; nothing was deferred" is false of L5 (R6). The left-hand sides of the
two deltas (api 689/73, rider 113/29) are labelled in the body as round 1's report figures, not
re-run this round — honest labelling, and I did not re-derive them.

## The guarantees pass

**Trigger: not fired.** Round 1 recorded `**Base** main @ 0a619d3`; Phase 1's `baseRefOid` is
`0a619d3`. The base did not move, so there is no rebase to sweep. Run anyway, because round 1's
pass found four false absolute claims and this round claims to have fixed all of them:

- **"the reconnect hole patched (D4)"** — was false in three places. Now true at
  `use-ride-status.tsx:38`, `rides.service.ts:155-192` and `features/rides/index.ts:16-24`: the read
  performs the join and the client calls it on every connect, first included. Verified by repro, not
  by reading. **Qualified by R1 and R7**, which narrow it rather than reopen it.
- **"returns the ride and nothing else"** — half true. See R5.
- **"`rideQuoteBodySchema` carries none of them"** — retired properly. `apps/rider/CLAUDE.md:13` now
  says "**by choice, not by schema**", names what both schemas would accept, and states the
  consequence ("There is no guard here to trust — adding a field to either call ships it"). This is
  how to close a claim finding.
- **"a timeout" among `current-position.ts`'s handled outcomes** — now implemented (`withDeadline`,
  `Promise.race`, `FIX_TIMEOUT_MS = 10_000`, the deadline starting *after* the permission prompt) and
  labelled `expected, not measured`, with the docblock stating it bounds the wait rather than the
  work because `expo-location` exposes no cancel. Correct on every count.

**New absolute claims in `1eb97f5`, spot-checked at the source:**

- *"`leaveRideRoom` is called only for a REASSIGNED driver, never for the rider"* — the sentence that
  justifies not filtering the join by status. **True:** one production call site,
  `reassign.service.ts:170`, with `previousDriverId`.
- *"nothing emits to it again"* (a terminal ride's room) — **true:** the three `emitToRide` callers
  (`ride-transition.service.ts:109`, `rides.service.ts:434`, `dispatch-notifier.ts:80`) all hang off
  a transition or an assignment, and a terminal ride has neither.
- *"`quoteRetry` … the key is preserved"* — **true:** `booking-draft.ts:125-130` returns
  `{ ...state, quoteState: 'idle', quoteErrorCode: null }` with no `withFreshAttempt`, guarded to
  `failed` so a stray tap cannot cancel a live quote; a corridor change still rotates.
- *"The device's fix NEVER overwrites a pickup the rider chose"* — **true:** `setPickupIfEmpty` tests
  `state.pickup === null` **inside the reducer**, so it reads committed state, not a closure.
- *"the same rule as `booking-draft.ts`'s `quoteRequestId`"* — **false.** R3.
- *"One mechanism closes both the first-connect hole and the reconnect one"* — **true with an
  unstated window.** R7.

## Round 1's 22 findings — 21 closed

Checked against the current source, not the commit message.

| | Finding | Closed by | |
|---|---|---|---|
| C1 | status screen received no event | join after the ownership check (`rides.service.ts:204-213`); client reads on **every** connect. Repro re-run here | ✅ (R1, R7) |
| H1 | failed quote unrecoverable | `quoteRetry` preserving the key, via `Banner.action` | ✅ |
| H2 | late GPS overwrites a hand-picked pickup | `setPickupIfEmpty` in the reducer + a real 10 s `Promise.race` deadline, `clearTimeout` in `.finally()` | ✅ |
| H3 | expired token strands the rider | `SessionGuard` — cannot loop (`PUBLIC_SEGMENTS` incl. `''`, flat routes), cannot bounce on cold start (`stranded` needs `signedOut`; initial state is `loading`); both pinned at `session-guard.test.tsx:48, :59`; `reason` rendered at `login-screen.tsx:84-86` | ✅ |
| H4 | search status never announced; silent on iOS | status line is a `Banner`; `rider.address.results_count` added | ✅ (iOS half stays `expected` — stated) |
| M1 | `phone` typed but absent at runtime | `phone?: string`, `?? null`, guarded submit | ✅ |
| M2 | out-of-order search wipes the list | `abandoned` checked in both `.then` and `.catch` | ✅ |
| M3 | barrel overstates what crosses the wire | `split: null`, integration test with a CONTROL | ⚠️ half — R5, R9 |
| M4 | rules file gives a false reason | rewritten "by choice, not by schema" | ✅ |
| M5 | quote path has no failure log | `ride.quote.failed` (`ride-quote.service.ts:87`), taxonomy-conformant, no PII | ✅ |
| M6 | terminal ride offers a cancel that 409s | `isOver()`, `rider.status.completed`, `router.replace('/book')` | ✅ |
| M7 | pickup row uses the dropoff's copy | `rider.book.pickup_empty`; `booking-screen.test.tsx:193` asserts the two differ | ✅ |
| M8 | denied location reported as a failure | `rider.book.location_unavailable`, D7 cited inline | ✅ |
| M9 | status line spoken twice on iOS | one announcer; key deleted; H4's fix explicitly declines to reintroduce it | ✅ |
| L1 | dead error banner survives a good search | `setError(null)` beside `setResults` | ✅ |
| L2 | quote answers 201 | `@HttpCode(HttpStatus.OK)`; three assertions moved | ✅ |
| L3 | `ROLES_KEY` reaches past the barrel | `from '../auth'` | ✅ |
| L4 | `MIN_CHARS` mirror unqualified | "WHERE THE MIRROR STOPS AGREEING" paragraph | ✅ |
| L5 | `ACCESS_FINE_LOCATION` over-asks | — | ❌ **not closed** — R6 |
| L6 | `draft.dropoff!` | narrowed local, with the reason | ✅ |
| L7 | driver-app docblocks carried over | rewritten for this app; `Banner.action` kept | ✅ (R10) |
| L8 | concurrent saved-place writes | serialised promise chain + refs | ⚠️ new failure mode — R2 |

**Hard-rule sweep — clean.** Integer cents only; no direct status write (`findForRider` reads only);
no commission literal; no seam bypass; contracts still one-way out of `packages/shared`; no
hardcoded user-facing string in the changed screens. Six `eslint-disable` hits, none touching
`max-lines`, no bare file-level disable; largest changed shipped file `rides.service.ts` at 451/500.

## What is good

- **The C1 fix is a better third option than either the review offered**, and the docblock says why:
  one mechanism for both holes, room names stay server-side, and the join sits **after** the
  ownership check with that ordering given as the reason. Reviewing a fix that rejected both
  suggestions and argued the third is the good version of this loop.
- **The repro discipline is real.** Seven findings were run against the unfixed code first. I re-ran
  C1's and got the quoted string — the mechanism holds, not just the digit.
- **New tests carry controls.** The settled-split test checks `commissionCents` is non-null in the
  row before asserting `null` on the wire, so a pass cannot mean "unsettled ride". R4 is about where
  one control sits, not whether it exists.
- **M4 is the model claim retirement** — it names both schemas, states what actually keeps the fields
  out, and says "There is no guard here to trust". Retiring the subject, not the sentence.
- **H2 was fixed in the reducer, not the screen.** "If empty" evaluates against committed state and
  the key-rotation rule stays in one file — something a closure flag could not have achieved.
- **`SessionGuard` renders nothing on purpose**, with the reason written down ("a guard that also
  decided what to render would be a second `GateScreen`"), and `PUBLIC_SEGMENTS` includes `''` so it
  cannot race `GateScreen`'s own redirect.
- **Blocked work is still recorded as blocked.** The runbook's Result is BLOCKED with hardware
  reasons and a date, the ledger says not measured, `closingIssuesReferences` is empty, and H4's fix
  states which half of it is `expected`.

## Summary

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 2 |
| Medium | 4 |
| Low | 5 |

**Request changes.** R1 and R2 are the blockers: each is a round-1 fix that moved its defect rather
than closing it, each reproduces C1's or L8's symptom somewhere new, and neither is visible to the
gate. R1 is one `catch` and one piece of state; R2 is a `.catch` on the queue plus a `maxLength`.
R3–R6 are cheap and can ride the same commit — R6 in particular because the PR body currently claims
all 22 findings are fixed. R7–R11 are the author's call.

Next: `piv-fix-review-findings` on this report, then re-run the gate.
