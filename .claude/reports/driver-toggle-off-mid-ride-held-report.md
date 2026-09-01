# Implementation Report — driver: tapping OFF mid-ride must not tear the stream down (#141)

**Plan**: `.claude/plans/driver-toggle-off-mid-ride-held.md`
**Branch**: `fix/driver-toggle-off-mid-ride` (worktree `../taxi-141`, base `origin/main` = `660b833`)
**Status**: COMPLETE

## Summary

A `driver_on_ride` 409 on the *offline* `put_status`, while the app is actually streaming, now means
what it says: the server is holding us online, so we stay online and keep streaming. The teardown
and the uploader stop both queue **behind** the put in `drained`, and the effect chain's `'stop'`
predicate generalises from "a refused *online* put" to "the answer left intent disagreeing with what
we asked for", which covers the new case and F32's original one with one rule. The 500-line cap
forced `pillFrom`/`Connection`/the pill windows and `runEffects` out of `presence-state.ts` into two
siblings first, landed as its own gate-green commit.

## Tasks completed

**Phase 1 — the split** (commit `ade79d9`, behaviour-preserving)

- `presence-pill.ts` — `Connection`, `LIVE_WINDOW_MS`, `RECONNECTING_WINDOW_MS`, `pillFrom` (CREATE)
- `run-effects.ts` — `runEffects` (CREATE)
- `presence-pill.test.ts`, `run-effects.test.ts` — the two moved `describe` blocks (CREATE)
- `presence-state.ts` — moved code deleted (UPDATE)
- `index.ts`, `home-screen.tsx`, `use-presence.tsx` — imports re-pointed (UPDATE)
- `presence-state.test.ts` — moved blocks and their imports removed (UPDATE)

**Phase 2 — the reducer and runner**

- `presence-state.ts` — `stop_uploader` on the `Effect` union; `drained` emits
  `put_status → stop_uploader → TEAR_DOWN`; `error` gains `status?: Intent`; the held branch (UPDATE)
- `use-presence.tsx` — `case 'stop_uploader'`; `runtime.uploader.stop()` removed from
  `drain_then_clear`; `status: effect.status` on the `put_status` catch; the generalised `'stop'`
  predicate (UPDATE)

**Phase 3 — tests** · **Phase 4 — the stale claims**

- `drivers.service.ts:109-112` — present tense → resolved (comment only, UPDATE)
- `apps/driver/CLAUDE.md:25` — the `driver_on_ride`-while-streaming exception (UPDATE)
- `.claude/plans/driver-app-auth-online-location.md` §Level 4 C.14 — marked superseded (UPDATE)

## Tests added

`apps/driver/src/features/availability/presence-state.test.ts` — four cases into
`describe('decide — the server holds us')`:

1. `a refused offline put while streaming holds us online: no teardown, no lie about the server (failure — #141/F38)`
   — drives the real chain (`toggle_pressed` → `drained` → the 409), asserts the drained list is
   `['put_status','stop_uploader','stop_stream','disconnect_socket','keep_awake']` and the held
   result is `toEqual(['persist_intent','kick_uploader'])`.
2. `the same refusal with no stream still flips offline: we cannot prove life (edge)`
3. `a network failure on the offline put leaves intent offline and emits nothing — the chain, not the reducer, does the teardown (edge)`
4. `a half-torn-down app is NOT restored: the effect_failed fold has no stream to offer (failure — the F31 guard)`

`apps/driver/src/features/availability/use-presence.test.tsx` — two cases, plus a named
`stopStreaming` spy and a status-aware `refuseOfflinePutWith` helper:

5. `a refused offline put mid-ride stops the chain: the location task is never stopped (failure — #141/F38)`
6. `an offline put that fails on the network still tears down (edge — the ordinary go-offline path)`

One pre-existing assertion changed: the `drained` effect list gained `'stop_uploader'`. It was the
**only** one that broke, which is the plan's own check that `stop_uploader` did not leak into
`TEAR_DOWN`.

### Mutation checks (both `observed`, not reasoned)

| Mutation | Expected | Observed |
|---|---|---|
| Delete `state.streaming` from the held branch's guard | reducer case 4 red | **red** — cases 2 *and* 4: `Expected: "offline" / Received: "online"`; `Tests: 2 failed, 17 passed` |
| Revert the `'stop'` predicate to its `effect.status === 'online'` form | hook case 5 red | **red** — `mockRuntime.uploader.stop`: `Expected number of calls: 0 / Received number of calls: 1`; `Tests: 1 failed, 5 passed` |

Both were restored and the suites re-run green. AC10 satisfied by observation.

## Validation results

All `observed` in the worktree, `COMPOSE_PROJECT_NAME=taxi`, `@taxi/shared` built.

| Check | Result |
|---|---|
| `pnpm --filter @taxi/driver typecheck` | pass |
| `pnpm --filter @taxi/driver lint` | pass (`max-lines` 500 is an **error** here) |
| `pnpm --filter @taxi/driver test` — baseline at `660b833` | 98 passed, 25 suites |
| — after the split (Phase 1) | **98 passed**, 27 suites — count unchanged, AC6 |
| — at the implementation head `b843671` | **104 passed**, 27 suites (98 + 6 new) |
| — final, after the review round-1 fixes | **109 passed**, 27 suites (104 + 5 new) |
| Phase 1 gate: `pnpm turbo run typecheck lint test build --force` | **exit 0**, 20/20 tasks, 1m21.857s |
| Gate at `b843671` (before the review) | **exit 0**, 20/20 tasks, 58.395s |
| Final gate: same command, after the review fixes | **exit 0**, 20/20 tasks, 1m5.096s |
| `@taxi/api` inside the final gate | 626 passed, 35 skipped, 70 of 72 suites (Redis-gated, no `REDIS_TEST_URL`) |
| `git diff --stat services/api` | 1 file, 6 insertions / 4 deletions — comment lines only (re-checked after F5) |

### Line counts (`observed`, `wc -l` at HEAD — not inherited from the plan)

| File | Before | After split | At `b843671` | Final (after review fixes) |
|---|---|---|---|---|
| `presence-state.ts` | 480 | 432 | 485 | **496** |
| `use-presence.tsx` | 362 | — | 371 | 371 |
| `presence-pill.ts` | — | 26 | 26 | 26 |
| `run-effects.ts` | — | 26 | 26 | 26 |

`presence-state.ts` has **4 lines of headroom** under the 500 cap (`derived`: 500 − 496). The five
review fixes cost 11 lines; fitting them meant tightening the held branch's comment to the claim it
actually has to carry now that F2's hole is closed. **The next change to this file needs a split
first** — that consequence, flagged as a deviation below, is now four lines from being forced.
`use-presence.tsx` was not measured between the two phases: the split was net zero lines on it (one
name out of the `./presence-state` import list, one `./run-effects` import in), so its post-split
count is `derived`, not observed.

The split is a move, not a rewrite: `git diff --cached --stat origin/main -- apps/driver/src/features/availability`
reported **142 insertions / 131 deletions** across 9 files. The +11 is the two module docblocks, the
two type-only imports, and the ~8-line `online()` builder duplicated into `presence-pill.test.ts`.
The exported name set off `index.ts` is byte-identical before and after (22 names, diffed).

## UX states

No new surface. The plan's Out-of-Scope holds: no new i18n string, no `announce` effect
(`Banner.tsx:42-47` announces its own text on change; announcing a *status* would be a lie, since
nothing about the status changed), and `home-screen.tsx`'s `driver_on_ride → tone: 'info'` mapping
is untouched.

The one user-visible change on the driver home screen: tapping the toggle OFF mid-ride now leaves it
**ON** with the existing blue «Jūs pašlaik izpildāt braucienu.» banner, instead of flipping OFF and
showing the same banner. Loading (`busy` spinner), error (generic banner) and offline (the pill)
states are unchanged and were not re-implemented. **No declared UX state was skipped** — this ticket
declared none.

The banner's **exit** was missing and the review caught it (F1): `driver_on_ride` maps to
`{ tone: 'info', text }` with no `action` and no `secondary`, so `banner_dismissed` has no UI route
from it — `Banner.tsx:42-70` renders a button only when one is supplied. `server_offline` on a
non-online intent now clears it, so it lives exactly as long as the hold does.

## Deviations from the plan

1. **`presence-state.ts` is 496 lines, not the plan's `derived` ~461 — 4 lines of headroom, not
   ~39.** The plan budgeted ~28 lines in; the implementation landed 53 (485), and the review round-1
   fixes added another 11. The difference against the plan is comment length: the plan itself
   required GOTCHA 1 (the no-stream routes and the F31 ghost toggle) and GOTCHA 2 (why the
   fallback's `server: 'offline'` is deliberate) on the page. The held branch's comment was trimmed
   twice (488 → 485, then again for the review fixes) and stopped rather than cut required
   reasoning; a third module split was weighed for the review pass and rejected as scope creep on a
   fix round. **Consequence to flag: the next change that touches this file will need a split.**
2. **Phase 1 was committed with `git add -A`, not the plan's `git commit -am`.** `-a` stages tracked
   modifications only; the four new files are untracked, so the plan's command would have landed
   `presence-state.ts`'s deletions without the modules replacing them — a split commit that does not
   compile, defeating AC11.
3. **The plan file was committed to the branch first** (`de0b60a`), before the split. It was
   untracked in the main checkout, so without this the branch — and the PR — would carry no plan.
4. **Four reducer cases, not three.** Phase 3's task list says "three reducer cases"; the
   STEP-BY-STEP task then specifies four. Shipped four, per STEP-BY-STEP.
5. **`use-presence.test.tsx` gained a named `stopStreaming` spy and a `refuseOfflinePutWith`
   helper.** The plan's two hook cases assert on `mockStopStreaming`, which does not exist — the
   mock factory creates `stopStreaming` as an anonymous `jest.fn()` (only `startStreaming` delegates
   to a named const). Added it with the file's own existing pattern (the `writeIntent` accessor at
   lines 94-97). The helper is the plan's GOTCHA 1 (status-aware mock) factored once for both cases.
6. **`run-effects.test.ts` imports `decide` and `initialPresence` as well as `runEffects`.** The plan
   said the moved block "needs the `Effect` type"; the first moved case also drives `decide` for the
   busy-clearing tail. Assertions and titles are untouched.
7. **`.claude/plans/driver-app-auth-online-location.md` §Level 4 C.14 was annotated as superseded.**
   Beyond the plan's named Phase 4 tasks, which cover source comments, `CLAUDE.md` and `docs/`. That
   step is a live instruction to a human that says "expected to FAIL" for the behaviour this ticket
   fixes; leaving it would have produced a false ❌ on the next manual pass. One appended clause, the
   original text preserved.
8. **Test *suites* went 25 → 27.** AC6's "the test count is unchanged by the split" is satisfied —
   98 → 98. The suite count necessarily grows by the two new files.
9. **`home-screen.tsx`'s `PresenceState` import was converted to `import type`.** The split left it
   importing only a type through a value import (`import { type PresenceState }`), which was correct
   in its original combined form but inconsistent once `pillFrom`/`Connection` moved out. Now matches
   `presence-pill.ts` and `run-effects.ts`. Lint and typecheck re-run green after the change.
10. **AC3's named behaviour change, restated here because the PR body reads from this report.** On
    the ordinary go-offline path the uploader's `stop()` moves from grace-expiry (inside
    `drain_then_clear`) to put-resolution (the `stop_uploader` effect). When the queue is still
    non-empty as `DRAIN_GRACE_MS` expires, the uploader now keeps emitting for the put's round trip —
    **up to 8 s** (`derived`: `api-client.ts:62`, `timeoutMs` default `8_000`, `observed` at HEAD; the
    typical case is far shorter). Benign, and arguably better: those emissions are real positions and
    the server still holds the driver `online` for exactly that window, so they are acked rather than
    refused `not_online`. But it is a change on a path this ticket did not set out to touch, so it is
    stated rather than hidden.

The two past-tense `tear the stream down` comments (`drivers.service.ts:104`,
`drivers.integration.spec.ts:426`) were read and **left alone**: both describe the *online re-assert*
path that review F3 already closed, in the past tense, and read true at this HEAD.
`.claude/reports/driver-app-auth-online-location-report.md` lines 90 and 170 were left alone as
historical records, stamped to the round-3 head, per the plan.

## Owed, not passed

**Level 4 §1 — the device proof (AC9).** Not runnable here: no Android phone, no paid Apple account,
and the agent cannot drive the Simulator. The residual it buys is one claim wide — that the OS
background location task **survives a chain the app stopped**. The hook test proves `stopStreaming`
is never called; only a phone proves the task is still emitting fixes afterwards, because
`jest.setup.ts` fakes every native module by design. Filed with #14's outstanding Level 4 §C/§D.
The self-contained 8-step run sheet is in the plan (§Level 4 Step 1) — **any ❌ on steps 4, 5 or 7
means the fix did not land.**

**Level 4 §2 — the api half still refuses** (`observed`, runnable): the three `driver_on_ride`
assertions in `drivers.integration.spec.ts` (399, 499, 655) and `dispatch.integration.spec.ts:1052`
are green and unmodified inside the full gate. The api's control flow was not touched.

## Issues encountered

- The worktree's driver suite reported **16 failed suites** on first run — `Cannot find module
  '@taxi/shared'`. That is environment, not a regression: a fresh worktree has no built `shared`
  dist. `pnpm --filter @taxi/shared build` fixed it, and the recorded 98-test baseline is from after
  that build.
- The main checkout `/Users/Berzins/Desktop/taxi` is on `feature/deploy-hetzner-environment` with
  ~23 modified and ~14 untracked files (#13). All work was done in the `../taxi-141` worktree, as
  Phase 0 required; the main checkout was not touched.

## Review round 1 — findings fixed

`.claude/code-reviews/pr-142-review.md` (in the main checkout, not this branch). No Critical, no
High; three Mediums and four Lows. Six fixed here, one deferred.

| # | Fix | Where |
|---|---|---|
| F1 | `server_offline` on a non-online intent clears a `driver_on_ride` banner — it has no dismiss affordance, so nothing else ever could. Plan §Level 4 step 8 would have read ❌ against correct behaviour | `presence-state.ts` `server_offline` |
| F2 | `permission/foreground_denied` sets `streaming: false` — the branch already tore the stream down, and the held branch's guard reads that flag on the put's answer. Unfixed, a four-step trace rebuilt F31's ghost toggle *through the guard written to prevent it* | `presence-state.ts` `permission` |
| F3 | `cold_launch` with intent `offline` and a live OS task emits `stop_stream` instead of discarding it. Pre-existing; this PR made a normal tap a routine way into the window (≤13 s — `derived`: `DRAIN_GRACE_MS` 5 000 + `api-client.ts:62` `timeoutMs` 8 000) | `presence-state.ts` `cold_launch` |
| F4 | The held branch clears `reasserted`, for symmetry with `flipOffline`. Left armed, a single later `ack_not_online` went straight to `flipOffline` and tore the stream down mid-ride — this PR's harm through another door | `presence-state.ts` `error` |
| F5 | The api comment now names its condition: the app keeps the stream up *when it can still prove life*; with no stream it folds offline deliberately. Comment-only, re-verified | `drivers.service.ts` |
| F6 | #14's §C.14 heading now leads with **SUPERSEDED** instead of «expected to FAIL», with the historical text kept below. This was AC7's unmet half | `driver-app-auth-online-location.md` |

**F7 (Low) — deferred, not dropped.** The springs-back toggle has no reliable TalkBack announcement:
`accessibilityState.checked` goes `true → false → true` and `Banner.tsx`'s explicit announce is
iOS-only. Already owed at plan §C.12 / #14 review F47, which exists to decide exactly this — no new
issue opened, because it would duplicate one.

**F2's claim was corrected on all three surfaces it was stated on**, not just at the fix: the branch
comment, the plan's blast-radius row (the `permission/foreground_denied` row now reads *enforced*,
not assumed), and the PR body. The true statement is narrower than the old one — every route emitting
`put_status offline` with no stream clears the flag first, so the guard cannot read a stale `true`.
The flag is still an intention rather than an observation on the two `drained` paths; that is
unreachable, not fixed, and the comment says so.

### The fixes were watched to fail (`observed`)

Each fix reverted in turn, `pnpm --filter @taxi/driver test -- presence-state` re-run, file restored
(`git status` clean after; the runner asserts it). Each mutation kills **exactly one** case — no
collateral, so each test pins its own fix:

| Mutation | Observed |
|---|---|
| Drop the `driver_on_ride` banner clear from `server_offline` | **red** — F1's case only; `Tests: 1 failed, 22 passed, 23 total` |
| Drop `streaming: false` from `permission/foreground_denied` | **red** — F2's case only; same tally |
| Restore `cold_launch`'s bare `return noop(base)` | **red** — F3's case only; same tally |
| Drop `reasserted: false` from the held branch | **red** — F4's case only; same tally |

The sixth new case — `home-screen.test.tsx`'s ride-scoped banner — is a **premise** test, not a
regression test: it pins that `driver_on_ride` renders with no dismiss button, which is *why* F1's
reducer fix is required. It does not go red under any of the four mutations, and is not claimed to.

### Ready for the next step

Next: re-run `piv-review-pr` on the updated PR. The device proof stays **owed** — steps 4, 5, 7 and
now 8 of the run sheet (step 8 is what F1 makes passable).
