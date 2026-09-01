# Code review — PR #142

**Head** `b843671` · **Base** `main` @ `660b833d1e12be751f3924d6344b82b9095d882c`
**Title**: fix(driver): a refused offline put mid-ride holds the driver online instead of tearing the stream down (#141)
**Round**: 1 (no prior review report — the guarantees pass does not apply)
**Reviewed in**: worktree `../taxi-141`, clean at head. Deep pass by the `code-reviewer` agent; every
finding below independently re-derived, and every failure scenario **observed** via throwaway specs run
against head and deleted (`git status` clean after each).

## Summary

The central mechanism is correct and unusually well argued. Making `drained` emit
`put_status → stop_uploader → TEAR_DOWN` so everything after the put queues behind its answer is the
right shape, and generalising the chain-stop predicate to "the answer left intent disagreeing with what
we asked for" is a real simplification rather than a special case. I walked all eight `put_status`
emission sites: the predicate does not over-stop. Both of the author's mutation checks reproduce
verbatim when I run them. Every figure in the PR body re-derives at head.

No Critical, no High. Three Mediums, and none is about the new branch itself — all three are about state
the reducer **stops maintaining around** it: a banner nothing clears (F1), a `streaming` belief no
go-offline path resets (F2), and a live location task `cold_launch` throws away (F3).

**F1 is the one to fix before merge**, because the PR's own manual acceptance sheet fails on it.

## Issues

### F1 — Medium · the `driver_on_ride` banner is sticky, and Level 4 step 8 will read ❌ because of it

`presence-state.ts:281-290` · `home-screen.tsx:162-163`

`home-screen.tsx:162-163` maps the banner to `{ tone: 'info', text }` with **no `action` and no
`secondary`** — so `banner_dismissed` has no UI route for this kind. The only paths that clear it are
`toggle_pressed` offline→online (`:199-203`), `flipOffline` and the `effect_failed` fold. `server_online`
clears **only** `marked_offline` (`:275`), and `server_offline`'s `intent !== 'online'` branch
(`:282-289`) does not touch `banner` at all.

**Failure scenario** (`observed`):

1. Driver taps OFF mid-ride → 409 → held branch → `banner: { kind: 'driver_on_ride' }`, toggle stays ON.
   Correct, and the point of the PR.
2. Dispatch completes the ride. A foreground refetch dispatches `server_online` — banner survives.
3. Driver taps OFF again → drain → put **200** → `server_offline` → `server: 'offline'`, `busy: false`,
   banner untouched → chain tears down normally.
4. The home screen now reads «Bezsaistē» **with «Jūs pašlaik izpildāt braucienu.» still displayed**,
   with no way to dismiss it, until the driver toggles back ON.

The plan's own run sheet, `.claude/plans/driver-toggle-off-mid-ride-held.md:743`, step 8:

> | 8 | Now tap the toggle OFF again | It goes OFF normally, **no banner** — the hold was ride-scoped, not sticky |

That step will read ❌ against behaviour that is otherwise correct — which is worse than a cosmetic bug,
because the PR body tells Linards that a ❌ on the manual sheet means the fix did not land.

**Fix** — mirror how `server_online` drops `marked_offline`, in `server_offline`'s `intent !== 'online'`
branch:

```ts
state: {
  ...state,
  server: 'offline',
  busy: false,
  banner: state.banner?.kind === 'driver_on_ride' ? null : state.banner,
},
```

`home-screen.test.tsx` has no coverage of the `driver_on_ride` banner at all — the new banner state is
pinned only at the reducer level. Worth one case with the fix.

### F2 — Medium · the held branch's guard is asserted, not enforced — and three surfaces state it as fact

`presence-state.ts:335` (the guard) · `:222-247` (`permission/foreground_denied`)

`state.streaming` is not an observation, it is an intention: set true at `:170` (`cold_launch`) and
`:254` (`permission` granted / `background_denied`), cleared only at `:38` (initial), `:124`
(`flipOffline`) and `:407` (the fold). **Every other path that runs `stop_stream` leaves it true.**

| Path | emits `stop_stream` | clears `state.streaming` |
|---|---|---|
| `drained` → put 200 → `server_offline` (`:282-289`) | yes (in the chain) | **no** |
| `drained` → put network-fails → `error/offline` (`:377-380`) | yes (chain continues) | **no** |
| `permission/foreground_denied` + serverOnline (`:238-246`) | yes | **no** |

So after any completed ordinary go-offline the flag says the stream is up while it is down.
`use-presence.test.tsx`'s own new case 6 sits right on this: it asserts `stopStreaming` called once and
`intent === 'offline'`, and does not assert `streaming` — because it is still `true`.

The comment at `:349-356` states the consequence as settled fact:

> Two routes reach here with no stream: the `effect_failed` fold below (it emits the offline put off the
> PRE-fold `server`, then sets `streaming: false`) and `permission/foreground_denied` with the server
> already online.

The first is guaranteed — `:407` sets `streaming: false` before the effects run. **The second is not.**

**Failure scenario** (`observed`):

1. Online, streaming. Tap OFF → drain → offline put **fails on the network**. `error/offline` (`:377`)
   clears `busy` only, leaving `server: 'online'` and `streaming: true`. Intent stays `offline`, so the
   chain does **not** stop: `stop_uploader` and `TEAR_DOWN` run and the stream really dies.
2. Tap ON → `request_permissions`.
3. The driver denies foreground → `permission/foreground_denied` with `serverOnline` true (stale from
   step 1) → emits `persist_intent`, `put_status offline`, `TEAR_DOWN`, `streaming` still `true`.
4. They were force-assigned a ride meanwhile, so that put returns **409 `driver_on_ride`**.
5. The held branch fires off the stale flag: `intent: 'online'`, the `foreground_denied` banner is
   replaced by `driver_on_ride`, `persist_intent online` is written, and the new predicate stops the
   chain so step 3's `TEAR_DOWN` never runs.

Result: toggle ON, foreground location permission denied, no stream — review **F31's ghost toggle,
rebuilt through the guard written to prevent it**. It self-heals only on the next cold launch, where
`isStreaming()` re-syncs the flag (`use-presence.tsx:265-270`).

Four coincidences deep, so this is a latent hole rather than a live regression — hence Medium. Its real
weight is the invariant: **any future emitter of `put_status offline` inherits a guard that can read a
flag that lies**, and the comment above it will tell the next maintainer the case is handled.

**The same unenforced claim is carried on three surfaces**, which is the pattern this repo keeps
hitting — grep the subject, not the sentence:

- the branch comment at `presence-state.ts:349-356`;
- the plan's blast-radius table, `.claude/plans/driver-toggle-off-mid-ride-held.md:937` — the
  `permission/foreground_denied + serverOnline` row is marked **old: continue / new: same**. It is not
  "same": the old predicate could not stop an offline-put chain at all, and the new one can, by exactly
  this route. The row's "intent after the answer = offline" column is the assumption, restated;
- **the PR body**, "Guarded on `state.streaming`: two routes reach that branch with no stream" — the
  most-read surface and the only one not in the working tree.

**Tightest fix** — one line, in a branch that has already committed to offline, which makes the comment
true for the route it names (`:230-236`):

```ts
state: { ...state, intent: 'offline', streaming: false, busy: serverOnline, banner: { kind: 'foreground_denied' } },
```

**Fuller fix**, if you would rather close the class than the case: dispatch a `stream_stopped` event from
the `stop_stream` handler so the flag tracks the world. `drained` cannot set it itself — the teardown
there is conditional on the put's answer, which is the whole point of this PR. That is a design choice;
your call, not the reviewer's.

Either way the comment, the plan row and the PR body need correcting to match whichever lands.

### F3 — Medium · `cold_launch` discards a live location task when intent is `offline`

`presence-state.ts:164-191`

`:166` is `if (event.intent !== 'online') return noop(base);` — `base` carries `streaming: false` from
`initialPresence`, and **no `stop_stream` is emitted**. `isStreaming()` was read at
`use-presence.tsx:262` and thrown away, so the app is then permanently blind to a live OS task: fixes
keep uploading while the home screen reads «Bezsaistē» and the driver has no control that stops it.
That is the "offline with a live stream" mode — the worst failure class here.

**Observed**: `cold_launch` with `intent: 'offline'`, `streaming: true` → state `streaming: false`,
effects `[]`.

Pre-existing. What this PR changes is that it routes a **normal, expected user action** through the
window where SecureStore says `offline` while the task is alive:

- `toggle_pressed` writes `persist_intent offline` at t≈0 (`:215-219`);
- the held branch's `persist_intent online` (`:366`) lands at worst **t ≈ 13 s** — `derived`:
  `DRAIN_GRACE_MS` = 5 000 ms (`use-presence.tsx:48`) + the api client's default `timeoutMs` = 8 000 ms
  (`api-client.ts:62`), both `observed` at head. Typical case is a sub-second put after an empty-queue
  drain.

A process kill in that window (Android LMK on a ride, a crash) lands in exactly the discarded case.

**Fix**:

```ts
if (event.intent !== 'online') {
  return event.streaming
    ? { state: base, effects: [{ type: 'stop_stream' }] }
    : noop(base);
}
```

Reasonable to argue this is its own ticket rather than #142's — it predates the PR. But the PR is what
makes tapping OFF mid-ride a routine way in, so it should not merge unnoticed.

### F4 — Low · the held branch leaves `reasserted` armed

`presence-state.ts:357-369`

`flipOffline` (`:126`) and `toggle_pressed`→online (`:201`) both reset `reasserted`; the held branch does
not. **Observed**: arm it the ordinary way (one `ack_not_online`, one accepted re-assert — `server_online`
does not clear it, only an accepted fix does), then get held; a single subsequent `ack_not_online` goes
straight to `flipOffline` at `:311`, emitting `stop_stream` — tearing the stream down mid-ride, the exact
harm this PR exists to prevent, through a different door.

Narrow: `server_online` fires `kick_uploader`, an accepted fix clears the flag, and
`drivers.service.ts:123`'s `markOnline` re-seed exists precisely so `not_online` should not recur while
held. **Fix**: add `reasserted: false` to the held state, for symmetry with `flipOffline`.

### F5 — Low · the new api comment overstates the app behaviour

`services/api/src/features/drivers/drivers.service.ts:109-112` — "The app now reads this refusal as 'the
server is holding you' and keeps the stream up … so the tap costs the driver a banner and nothing else."
True **only when `state.streaming` is true**; with no stream the app still folds through `flipOffline`
and goes offline, deliberately (`presence-state.ts:353-356`). One clause adds the condition.

### F6 — Low · the superseded run-sheet step still leads with "expected to FAIL"

`.claude/plans/driver-app-auth-online-location.md:837` — the supersede clause is appended to the end of a
five-sentence paragraph whose **bold heading still reads** `**Toggle OFF mid-ride (issue #141, expected
to FAIL)**`, with "Known defect: the app tears the stream down before the api refuses… Recorded, not
fixed in this PR" still in the body.

This is the one acceptance criterion not met as literally written: **AC7** asks that "no source comment or
doc in the tree still says the stream is torn down". **Fix**: change the heading to `**Toggle OFF
mid-ride (issue #141 — SUPERSEDED, see below)**`, or move the clause to the front.

`driver-app-auth-online-location-report.md:170` also still describes the harm in the present tense, but
that is a historical record stamped to the round-3 head and the implementation report names the decision
to leave it. Correct call; not part of F6.

### F7 — Low · the springs-back toggle has no reliable screen-reader announcement

The held branch deliberately emits no `announce`, leaning on `Banner.tsx:43-47` — argued in the plan's
non-goals, and the reasoning ("announcing a *status* would be a lie") is sound. But the toggle's
`accessibilityState.checked` goes `true → false → true` across the tap, and `announceForAccessibility` is
**iOS-only** there; `Banner.tsx:36-40` labels the Android live-region path `expected, NOT observed`. On
Android/TalkBack the driver may get no spoken feedback at all for a tap that appears to do nothing.
Belongs on #14's owed TalkBack pass (§C.12, review F47) rather than silently under "the Banner already
announces".

## Validation

All `observed` in `../taxi-141` at `b843671`, `COMPOSE_PROJECT_NAME=taxi`.

| Check | Command | Result |
|---|---|---|
| Full gate (CI parity) | `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` | **exit 0**, 20/20 tasks, 1m4.301s |
| Driver suite | inside the gate | **104 passed, 27 suites** |
| api suite | inside the gate | 626 passed, 35 skipped, 70 of 72 suites (Redis-gated) |

The PR body records 58.395s against my 1m4.301s — wall-clock under different machine load. The claims
that carry weight (exit 0, 20/20 tasks) reproduce exactly.

### The numbers pass

Every figure in the PR body and the implementation report re-derived at head. **All reproduce.**

| Claim | Verdict |
|---|---|
| Gate exit 0, 20/20 tasks | reproduced |
| Driver 104 passed / 27 suites; api 626 passed / 35 skipped / 70 of 72 | reproduced exactly |
| `presence-state.ts` 480 → 485; `use-presence.tsx` 362 → 371; two new files at 26 | `wc -l` at `660b833` and head — all four correct |
| "15 lines of headroom (`derived`: 500 − 485)" | correct, **and the subject checks out**: `apps/driver/eslint.config.mjs:17-20` sets `max-lines` with `skipBlankLines: false, skipComments: false`, so `wc -l` is the unit the cap reads. 20 at `origin/main` (500 − 480) likewise |
| Diff decomposition, 15 files / 1535 / 149 | every bucket reproduced. Shipped source 6 files / 132 / 70 is `derived` and correct: 363 − 231, 143 − 73 |
| `services/api` comment-only → 0 non-comment changed lines | reproduced with the author's own command |
| "up to 8 s" on the AC3 path | `api-client.ts:62`, `deps.timeoutMs ?? 8_000` — correct, and correctly labelled `derived` |
| `vehicles.service.ts:90` throws `driver_on_ride` on a path no put started | correct — `remove()` a vehicle while `on_ride`. The `status` discriminator is justified, not defensive padding |
| `uploader.ts:49-50` — `kick()` early-returns on `running` **before** clearing `stopped` | correct as written, and it is the reason `stop_uploader` had to leave `drain_then_clear` |
| `drivers.integration.spec.ts` 399/499/655 + `dispatch.integration.spec.ts:1052` | all four assert `driver_on_ride`, all green in the gate |
| `Banner.tsx` announces its own text | correct (iOS only — see F7) |
| 90 s manual step "chosen to clear the 60 s freshness window" | `RECONNECTING_WINDOW_MS = 60_000`, holds |
| `index.ts` export name set unchanged by the split | diffed — same names, `decide`/`initialPresence` re-homed, `Connection` a type export |
| Driver test count 98 → 98 → 104 | 104 at head `observed`. The 98 baseline is `derived`, not independently re-observed (needs a `@taxi/shared` build at `660b833`). Structural cross-check supports it: `it(` occurrences across `apps/driver/src` go 96 → 102, **delta +6**, exactly the six claimed new cases |

The one figure that did **not** re-derive is in the plan, not the PR body: the blast-radius table row at
`:937` — see F2.

### The mutation claims — re-run, not taken on trust

Both reproduce verbatim, including the failure text. Restored after each; `git status` clean.

| Mutation | Reported | I observed |
|---|---|---|
| Delete `state.streaming` from the held branch's guard | cases 2 and 4 red, `Expected: "offline" / Received: "online"`, `Tests: 2 failed, 17 passed` | identical |
| Revert the `'stop'` predicate to `effect.status === 'online'` | hook case 5 red, `Expected number of calls: 0 / Received number of calls: 1`, `Tests: 1 failed, 5 passed` | identical |

AC10 is satisfied and the record is in the tree — the implementation report carries the mutation table
with its exact failure text, and I reproduced both independently. (The deep-pass agent reported this as
missing; it had no shell and could not run them. Disregard that one.)

## Checked, not findings

- **`stateRef.current` is not a stale-closure race.** `dispatch` writes it synchronously at
  `use-presence.tsx:89` before `runEffects`, and a nested chain suspends at its first `await` before it
  can mutate further — so the predicate at `:144` reads exactly the state the nested dispatch wrote.
  Worth stating because the generalised predicate leans on this much harder than the old one.
- **The generalised predicate does not over-stop.** All eight `put_status` sites walked. It changes
  behaviour on exactly two offline-put sites (`drained`, `permission/foreground_denied`), and on both
  only via the held branch. No path has intent legitimately differing from the put's status for a
  non-refusal reason during the RTT: `toggle_pressed` is gated on `busy` (`:194`), the foreground
  refetch on `busy` (`use-presence.tsx:293`), `ack_not_online`/`server_offline` both require
  `intent === 'online'`, and `socket_connect` never writes intent. Sound — **conditional on F2**.
  The one incidental change is a `put_status offline` succeeding while intent has flipped back to
  `online` on a fast double-tap: the old predicate let `TEAR_DOWN` kill the stream the driver had just
  re-enabled, the new one stops. An improvement.
- **`error.status` producers are clean.** Only two in shipped source: `use-presence.tsx:95`
  (`effect_failed`, no `status`) and `:130-134` (the put catch). An absent `status` is `undefined`, and
  `undefined !== 'offline'`, so it cannot fall into the held branch. Optional rather than required is
  the right call precisely because `effect_failed` answers no put.
- **The uploader is stopped on every path that should stop it.** A refused offline put with no stream
  falls through to `flipOffline`, which leaves intent `offline`, so the chain continues and
  `stop_uploader` runs. Only the held branch skips it, which is the point. No leak.
- **`kick_uploader` on the held branch cannot kick over a `stop()`** — `stop_uploader` sits behind the
  put, so a refusal never reaches it. The `uploader.ts:48-55` race is genuinely unreachable here.
- **`drivers.service.ts:140`** is a second `driver_on_ride` producer, reachable on an *online* put
  (`setOnlineIfEligible` falsy + `hasActiveRide`). It routed to `flipOffline` before this PR and still
  does; the `status === 'offline'` discriminator leaves it alone. No change.
- **`drivers.service.ts:104`** reads true at head: past tense, and about the *online re-assert* 409 that
  review F3 removed, not this one. Correctly left alone.
- **The hard rules hold**: contracts stay in `@taxi/shared`, the one-way import flow is intact, no seam
  bypass, no money handling, no `assertTransition` bypass, no PII in logs.
  `driver.error.driver_on_ride` exists in all three catalogs (`lv.ts:235`, `ru.ts:198`, `en.ts:194`) — no
  hardcoded string.
- **AC1–AC11**: all met on my reading, bar the second half of AC7 — see F6.
- `Intent` (`intent-store.ts:3`) duplicates the shape of `DriverPresenceStatus` in shared, and the PUT
  body at `use-presence.tsx:125` is hand-built rather than typed through `driverStatusUpdateSchema`.
  Both predate this PR and `Intent` carries a genuinely app-local meaning. Cleanup ticket at most.

## What's good

- **The ordering insight is the right one.** "Nothing after the offline put is committed before its
  answer" is stronger and simpler than the issue's Option 1 (hold `TEAR_DOWN` at five call sites), and
  the PR states plainly what would flip that trade-off — a third refusal reason. That is how to leave a
  rejected design.
- **It answers F38 as raised, including the part that was a warning.** #139's round-3 review proposed
  this design and warned that "a blanket stop would break the ordinary offline-with-network-error path".
  The predicate here *is* blanket-shaped — and does not break that path, because the reducer leaves
  intent `offline` on a network error so the chain carries on. Hook case 6 exists to pin exactly that.
  The warning was read, not just the recommendation.
- **It closes round 3's F48 in passing** — the F32 predicate had no test; it now has two.
- **`uploader.stop()` moving out of `drain_then_clear`** is the non-obvious half of the fix, and the
  reason given is exactly right at `uploader.ts:49-50`. The whole chain was verified end to end:
  `presence-state.ts:321-328` emits the order, `run-effects.ts:18-25` executes strictly in order and
  returns on the first `'stop'`, `use-presence.tsx:200-202` handles it.
- **The `status` discriminator is properly motivated** — `vehicles.service.ts:90` is a real second
  producer, not a hypothetical one. Checked.
- **The tests assert whole effect lists, not `not.toContain`** (`presence-state.test.ts:269` says so and
  means it), and `:311-327` states what it does *not* prove rather than over-claiming. Hook case 6
  exists purely to pin the ordinary path against the AC3 change — the case most authors leave out.
- **The mutation checks are real**, and both reproduced under an independent run.
- **The refactor is a move, not a rewrite.** Both extracted modules are the original bodies plus a
  docblock and a type-only import; type-only imports of `presence-state`, so no cycle. `runEffects`
  correctly stays out of `index.ts`.
- **The owed manual validation is scoped honestly** — one claim wide, load-bearing steps named, with an
  explicit instruction not to close #141 on the automated cover alone.
- **Deviations are documented, including the ones that cost something** (AC3's up-to-8 s emission window;
  the 15-line headroom being less than planned, with the consequence spelled out). None of the eight is
  an undocumented divergence.

## Recommendation

**Request changes.** No Critical, no High; the approach is right and the validation record is stronger
than most. Two things before merge, both small reducer edits:

- **F1** — the sticky banner. Fix this one regardless: without it the PR's own Level 4 step 8 reads ❌
  against correct behaviour, which is exactly the signal the PR body tells Linards means the fix failed.
- **F2** — the unenforced `streaming` guard. One line in `foreground_denied` closes the reachable case;
  the fuller `stream_stopped` design is a judgment call. Whichever lands, correct the branch comment,
  the plan's blast-radius row at `:937`, and the PR body's "two routes reach that branch with no stream".

**F3** is real and observed but predates this PR — reasonable to split into its own ticket, as long as
that is a decision rather than an oversight.

F4–F7 are one-liners; take them in the same pass or defer them.

The device proof stays owed either way — steps 4, 5 and 7 of the run sheet, per the PR's own framing.
Add step 8 to that list once F1 is fixed.
