# Feature: driver — tapping OFF mid-ride must not tear the stream down (#141)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

A driver who is `on_ride` and taps the availability toggle OFF currently loses their position
feed. The app commits its teardown *before* the api has answered; the api then refuses the
offline `PUT` with a 409 `driver_on_ride` (correctly — #11 owns that status), so the driver reads
«Jūs pašlaik izpildāt braucienu» on a phone that has already stopped streaming.

This ticket makes the refusal mean what it says: **the server is holding us online, so we stay
online and keep streaming.** The teardown is not committed until the offline intent is settled —
either the server accepted it, or the attempt failed for a reason that is not "you are on a ride".

## User Story

As a **driver on a ride**
I want to **know that tapping the toggle off mid-ride did nothing except tell me why**
So that **my passenger's tracking page and Dina's board keep seeing me, and I do not get a push
nudge for a ride I just finished**

## Problem Statement

`presence-state.ts:311-317` (`drained`) emits `[{ put_status offline }, ...TEAR_DOWN]` — the
teardown is queued *behind* the put in the same chain, so it runs whatever the answer is.
`presence-state.ts:319-325` (`error`) folds `driver_on_ride` through `flipOffline`, which itself
emits `TEAR_DOWN` and writes `server: 'offline'` — a statement the server contradicts.
`use-presence.tsx:139-142` (the review-F32 stop) fires only for `effect.status === 'online'`, so a
refused *offline* put lets the outer chain carry on.

Result: Postgres row `on_ride`, Redis presence intact, phone not streaming.

- The tracking page (#63) and the board freeze on the last position, which `findNearby`'s
  read-time filter drops after 60 s.
- The dark sweep cannot rescue it — `markOfflineByServer` returns at `if (status !== 'online')`
  for an `on_ride` row.
- Then `releaseFromRide` (`drivers.repository.ts:275-282`) sets the row back to `online` while the
  app is locally offline and streaming nothing, so the driver re-enters the swept population with
  no proof of life and gets flipped offline **plus a push nudge for a ride they just completed**.

Bounded and recoverable today: one tap back ON is a 200 (PR #139's F3 fix) and `GO_ONLINE`
restarts the stream. But the passenger has already lost the feed, and the nudge is a false alarm.

There is no test cover: `grep -rn driver_on_ride apps/driver/src --include='*.test.ts*'` is empty;
the only 409 reducer case is `vehicle_required`.

## Solution Statement

Three changes, all small, plus a file split the 500-line cap forces.

1. **The refusal carries which put it refused.** `PresenceEvent['error']` gains an optional
   `status?: Intent`; `use-presence.tsx`'s `put_status` catch already has `effect.status` in hand.

2. **`driver_on_ride` on an offline put, while we are actually streaming, means HELD.** The
   reducer restores `intent: 'online'`, keeps `server: 'online'` (honest — `on_ride` reads as
   online per `serverStatusEvent`), keeps `streaming` true, clears `busy`, shows the
   `driver_on_ride` banner, and emits **no teardown**. Every other `driver_on_ride` — and all
   `vehicle_required` — still goes through `flipOffline` unchanged.

3. **The chain stop generalises instead of gaining a special case.**
   `use-presence.tsx:139-142` becomes `stateRef.current.intent !== effect.status ? 'stop' : undefined`
   — "the put's answer left intent disagreeing with what we asked for, so the rest of this chain is
   about a world that no longer exists". That is F32's rule stated once instead of twice, and it
   covers the new case for free.

Plus **the uploader stop moves out of `drain_then_clear` and into the reducer's `drained` effect
list**, between the put and the teardown, so the stop is skipped exactly when the teardown is.

Rejected: reordering `drained` so `TEAR_DOWN` waits for a settling event. It would move the
teardown to five call sites (server-confirmed offline, network error, generic error, …), and
missing one leaves a phone streaming while the driver believes they are offline — a wider blast
radius than the bug. See NOTES.

## Out of Scope / Non-Goals

- **Not included**: any change to the api's refusal. `setPresence` 409ing an `offline` PUT while
  `on_ride` is correct and stays (`drivers.service.ts:113`). Only its stale docblock changes.
- **Not included**: a new i18n string. «Jūs pašlaik izpildāt braucienu.» reads correctly under the
  new behaviour (the toggle stays ON, and the banner says why the tap did nothing). See Q2.
- **Not included**: an `announce` effect on the held branch. `Banner.tsx:42-47` already announces
  its own text on change (iOS outright, Android live region), and announcing a *status* would be a
  lie — nothing about the status changed. See NOTES.
- **Not included**: making `flipOffline`'s `TEAR_DOWN` stop the uploader. Today it does not; that
  is unchanged, and out of scope.
- **Not included**: fixing `kick()`'s early-return-without-clearing-`stopped` race
  (`uploader.ts:48-51`). This plan is designed so that hazard is never reached — see F1 in NOTES.
- **Not changing**: the drain-before-offline ORDER, `GO_ONLINE`, the one-re-assert rule, cold
  launch (D14), or anything in `features/location`.

## Feature Metadata

**Feature Type**: Bug Fix (with a mechanical refactor the line cap forces)
**Estimated Complexity**: Medium — the reducer edit is ~25 lines; the file split and the effect-list
assertions it ripples into are the bulk of the work.
**Primary Systems Affected**: `apps/driver/src/features/availability` (reducer + effect runner),
docs in `services/api/src/features/drivers/drivers.service.ts` and `apps/driver/CLAUDE.md`
**Dependencies**: none new

## Related Work

**Implements**: [#141](https://github.com/linardsb/taxi/issues/141) · **Epic**: #14 (driver app) —
`.claude/plans/driver-app-auth-online-location.md`

**Back-references**:

- `.claude/plans/driver-app-auth-online-location.md` — the plan that built this reducer; its NOTES
  carry the "re-assert semantics" and "intent vs fact" rules this change must not break.
- `.claude/code-reviews/pr-139-review-round3.md` — **F38** is this ticket verbatim (the trace, the
  two candidate fixes, the headroom arithmetic). Read F3's entry too: the api half of the same
  problem, already closed.
- `.claude/code-reviews/pr-139-review.md`, `-round2.md` — F31/F32/F36/F37 built the `'stop'`
  predicate and the `effect_failed` fold this change generalises. Do not regress them.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

All paths are from the repo root. **Line numbers are at `origin/main` = `660b833`** (the #139
merge). Re-check them — a concurrent session may have moved main.

- `apps/driver/src/features/availability/presence-state.ts` (whole file, 480 lines) - Why: the
  file being changed. Specifically `Effect` (74-88), `TEAR_DOWN` (104-108), `flipOffline` (112-136),
  `drained` (311-317), `error` (319-381), `serverStatusEvent` (419-434), and the three exports that
  move out: `Connection` (5), `runEffects` (436-458), `LIVE_WINDOW_MS`/`RECONNECTING_WINDOW_MS`/
  `pillFrom` (460-480).
- `apps/driver/src/features/availability/use-presence.tsx` (whole file, 362 lines) - Why: the
  effect runner. `put_status` and the F32 stop predicate (122-142), `kick_uploader` (195-197),
  `drain_then_clear` (212-217), the `dispatch` re-entry (87-97).
- `apps/driver/src/features/availability/presence-state.test.ts` (427 lines) - Why: every reducer
  assertion. `describe` boundaries: going online 22-89, server disagrees 91-141, going offline +
  cold launch 143-210, **pillFrom 212-223**, **server holds us 225-282** (where the new cases go),
  effect failures 284-369, **runEffects 371-427**. The `drained` effect-list assertion at 150-155
  changes.
- `apps/driver/src/features/availability/use-presence.test.tsx` (248 lines) - Why: **this file owns
  the predicate you are changing.** Its docblock (11-18) names F32/F48a as what only a render can
  reach. Read the mock harness (20-90) before adding a case; the real `ApiError` is required
  (`instanceof` in `run`'s catch).
- `apps/driver/src/features/availability/home-screen.tsx` (195 lines) - Why: imports `pillFrom` and
  `type Connection` from `./presence-state` (9-13) — the split re-points these. Banner mapping for
  `driver_on_ride` at 165-166 (`tone: 'info'`), unchanged.
- `apps/driver/src/features/availability/index.ts` (23 lines) - Why: the slice's public API;
  re-export list must be re-pointed after the split.
- `apps/driver/src/features/location/uploader.ts` (lines 31-112) - Why: read `kick` (47-55), `stop`
  (57-60), `whenIdle` (62-68) and the `drain` loop (70-112) before touching `drain_then_clear`.
  **`stop()` sets only `stopped`; it does not clear `running`, and `kick()` early-returns on
  `running` BEFORE clearing `stopped`** — that pairing is the hazard this design avoids (NOTES F1).
- `apps/driver/src/features/location/location-task.ts:66` - Why: every new fix calls
  `uploader.kick()`. This is why the held branch does not need to restart anything from cold.
- `apps/driver/src/features/auth/api-client.ts:13-23, 100-114` - Why: `ApiError.code` is the 409
  body's `message`, so a refused offline put arrives as `code: 'driver_on_ride'`. Confirmed.
- `services/api/src/features/drivers/drivers.service.ts:99-121` - Why: the api's on_ride gate.
  **Lines 109-112 describe this bug in the present tense and name issue #141** — that comment is a
  task in this plan.
- `apps/driver/src/components/Banner.tsx:29-52` - Why: the banner announces its own text; this is
  why no `announce` effect is added.
- `apps/driver/CLAUDE.md:25` - Why: the contract sentence about 409s flipping the toggle. Needs the
  `driver_on_ride`-while-streaming exception.
- `apps/driver/eslint.config.mjs:11-33` - Why: `max-lines` 500 is an **error** here and restated
  locally (this app does not consume `@taxi/config/eslint/base.mjs`); `*.test.ts(x)` is exempt.

### New Files to Create

- `apps/driver/src/features/availability/presence-pill.ts` - `Connection`, `LIVE_WINDOW_MS`,
  `RECONNECTING_WINDOW_MS`, `pillFrom` moved verbatim out of `presence-state.ts` (~28 lines).
- `apps/driver/src/features/availability/run-effects.ts` - `runEffects` moved verbatim out of
  `presence-state.ts` (~26 lines).
- `apps/driver/src/features/availability/presence-pill.test.ts` - the `describe('pillFrom')` block
  moved from `presence-state.test.ts:212-223`, imports re-pointed, assertions untouched.
- `apps/driver/src/features/availability/run-effects.test.ts` - the `describe('runEffects')` block
  moved from `presence-state.test.ts:371-427`, imports re-pointed, assertions untouched.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

No external docs are needed — this is a pure-TypeScript reducer change inside an existing slice.
The load-bearing references are internal:

- `.claude/code-reviews/pr-139-review-round3.md`, finding **F38** (~line 46) and the headroom row
  (~line 99)
  - Why: the full trace and the two candidate fixes; the headroom row names the exact split this
    plan performs.
- `apps/driver/CLAUDE.md` §Rules (lines 22-33)
  - Why: intent-vs-fact, drain-before-offline, the 4 s throttle as the api's heartbeat, and the
    test conventions (jest-expo, colocated, no native).
- Repo `CLAUDE.md` §Hard rules
  - Why: max 500 lines of shipped source; ≥1 expected + 1 edge + 1 failure test per feature; every
    number in a plan/PR body is a claim with provenance.

### Patterns to Follow

**Reducer shape** — every branch returns `{ state, effects }`; `noop(state)` for the no-effect
case. Never mutate; always spread. Effects are data, never closures.

**The comment culture is load-bearing here.** Every non-obvious branch in `presence-state.ts`
carries a comment naming the harm it prevents and the review finding that found it
(`presence-state.ts:330-347` is the model). The held branch must do the same and cite #141/F38.

**Effect-list assertions read as `types(d.effects)`** — the helper at `presence-state.test.ts:11`
maps effects to their `type` strings. Order is asserted with `toEqual`, membership with
`toContain`. Keep that split.

**Test naming** — `it('… (expected)' | '… (edge)' | '… (failure)')`, with the review finding in
parentheses where one exists. E.g.
`it('a refused offline put while streaming holds us online — no teardown (failure — #141/F38)')`.

**Slice public API** — `index.ts` re-exports; nothing outside the slice imports a file directly.
Small single-purpose files are idiomatic (`format-eur.ts` is 12 lines, `intent-store.ts` is 27), so
two ~27-line modules are in keeping, not fragmentation.

**No import cycles** — `presence-pill.ts` and `run-effects.ts` import *types* from
`presence-state.ts`; `presence-state.ts` must import nothing from either.

---

## IMPLEMENTATION PLAN

### Phase 0: Set up an isolated checkout

**Independent of:** everything — do this first, before reading further.

The main checkout `/Users/Berzins/Desktop/taxi` is on `feature/deploy-hetzner-environment` with
~23 modified and ~14 untracked files (the #13 deploy work, likely a live session). Do not branch
in it.

**Tasks:**

- `git fetch origin`, confirm `origin/main` is `660b833` or later and contains the #139 merge.
- `git worktree add ../taxi-141 -b fix/driver-toggle-off-mid-ride origin/main`
- Copy `.env` into the worktree (a worktree without one makes a `REDIS_TEST_URL` gate hang
  silently) and export `COMPOSE_PROJECT_NAME=taxi` for anything DB-touching.
- `pnpm install` in the worktree.

### Phase 1: The file split (mechanical, behaviour-preserving)

**Independent of:** Phase 2's logic — but do it FIRST, so Phase 2 has line headroom to land in.

Move `Connection`/windows/`pillFrom` and `runEffects` out of `presence-state.ts` into two sibling
modules, re-point every importer, move the two test blocks. **Zero behaviour change.** The gate
must be green at the end of this phase alone.

**Tasks:**

- Create `presence-pill.ts` and `run-effects.ts`; delete the moved code from `presence-state.ts`.
- Re-point `index.ts`, `home-screen.tsx`, `use-presence.tsx`.
- Move `describe('pillFrom')` and `describe('runEffects')` into their own test files.
- `wc -l apps/driver/src/features/availability/presence-state.ts` — record the number.

### Phase 2: The reducer and runner change

**Depends on:** Phase 1 (needs the headroom).

**Tasks:**

- Add `stop_uploader` to the `Effect` union and to `drained`'s effect list, between the put and
  `TEAR_DOWN`.
- Move `runtime.uploader.stop()` out of `drain_then_clear` into the new `stop_uploader` case.
- Add `status?: Intent` to the `error` event and populate it at the `put_status` catch.
- Add the held branch to the `error` case's `driver_on_ride` handling.
- Generalise the `'stop'` predicate.

### Phase 3: Tests

**Depends on:** Phase 2.

**Tasks:**

- Update the `drained` effect-list assertion for `stop_uploader`.
- Add three reducer cases (held / not-streaming falls back / network-error offline put still tears
  down) to `describe('decide — the server holds us')`.
- Add one hook case to `use-presence.test.tsx` proving the chain stops on a refused offline put.

### Phase 4: Retire the stale claims

**Depends on:** Phase 2 (the claims are only false once the code changes).

**Tasks:**

- `services/api/src/features/drivers/drivers.service.ts:109-112` — present tense → resolved, cite
  this ticket as landed.
- `apps/driver/CLAUDE.md:25` — add the `driver_on_ride`-while-streaming exception.
- `presence-state.ts`'s `toggle_pressed` (209-210) and `drained` comments — say where the teardown
  now commits.
- `grep -rn "#141\|F38" services apps packages .claude` and check every hit still reads true.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### CREATE `apps/driver/src/features/availability/presence-pill.ts`

- **IMPLEMENT**: Move, verbatim, from `presence-state.ts`: the `Connection` type (line 5),
  `LIVE_WINDOW_MS` and `RECONNECTING_WINDOW_MS` with their doc comments (460-463), and `pillFrom`
  with its docblock (465-480). Add a one-line module docblock: the connection pill, read from
  RECEIPT (the last ack), never socket flags.
- **PATTERN**: `apps/driver/src/features/availability/format-eur.ts` — a single-purpose module with
  one exported function and a short docblock.
- **IMPORTS**: `import type { PresenceState } from './presence-state';`
- **GOTCHA**: Type-only import, and `presence-state.ts` must NOT import back — a value cycle here
  would be a Metro runtime hazard, not just a lint warning.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC6

### CREATE `apps/driver/src/features/availability/run-effects.ts`

- **IMPLEMENT**: Move `runEffects` and its docblock verbatim from `presence-state.ts:436-458`.
- **PATTERN**: same as above.
- **IMPORTS**: `import type { Effect } from './presence-state';`
- **GOTCHA**: The docblock's last paragraph explains the `'stop'` contract and cites review F32.
  Keep it — a later task widens what `'stop'` means, and this is where a reader looks.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC6

### UPDATE `apps/driver/src/features/availability/presence-state.ts` (delete the moved code)

- **IMPLEMENT**: Remove line 5 (`Connection`) and lines 436-480 (`runEffects`, the two window
  constants, `pillFrom`). Leave `serverStatusEvent` in place — it is reducer vocabulary.
- **GOTCHA**: `Connection` is not referenced anywhere else inside this file — confirm with
  `grep -n Connection` before deleting.
- **VALIDATE**: `wc -l apps/driver/src/features/availability/presence-state.ts` — **expect ~433**
  (`derived`: 480 − 47 moved lines; re-observe rather than trusting this figure).
- **SATISFIES**: AC6

### UPDATE `apps/driver/src/features/availability/index.ts`

- **IMPLEMENT**: `LIVE_WINDOW_MS`, `pillFrom`, `RECONNECTING_WINDOW_MS` and `type Connection` now
  come from `'./presence-pill'`. The slice's *external* surface is unchanged — same names, same
  file. Do not export `runEffects` (nothing outside the slice used it, and nothing should).
- **PATTERN**: existing grouping in `index.ts` — value exports then `export type { … }`, both
  alphabetical.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint`
- **SATISFIES**: AC6

### UPDATE `apps/driver/src/features/availability/home-screen.tsx`

- **IMPLEMENT**: Split the import at lines 9-13 — `pillFrom` and `type Connection` from
  `./presence-pill`, `type PresenceState` stays on `./presence-state`.
- **GOTCHA**: import ordering is lint-enforced (`eslint-config-expo`); `./presence-pill` sorts
  before `./presence-state`.
- **VALIDATE**: `pnpm --filter @taxi/driver lint`
- **SATISFIES**: AC6

### UPDATE `apps/driver/src/features/availability/use-presence.tsx` (import only)

- **IMPLEMENT**: `runEffects` now comes from `./run-effects`; drop it from the
  `./presence-state` import list (lines 36-44).
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC6

### CREATE `apps/driver/src/features/availability/presence-pill.test.ts` + `run-effects.test.ts`

- **IMPLEMENT**: Move `describe('pillFrom')` (`presence-state.test.ts:212-223`) and
  `describe('runEffects')` (371-427) into their own files. Carry over whatever local helpers they
  use — `pillFrom`'s block needs the `online()` builder and `initialPresence`;
  `runEffects`'s block needs the `Effect` type. **Do not change a single assertion or title.**
- **PATTERN**: `format-eur.test.ts` — a 19-line colocated test for a 12-line module.
- **GOTCHA**: `presence-state.test.ts`'s `online()` helper (lines 13-20) is used by both the moved
  pill block and blocks that stay. Duplicate the ~8-line builder into `presence-pill.test.ts`
  rather than exporting it from the test file — test files are uncapped and a shared test helper
  module for eight lines is not worth the indirection.
- **VALIDATE**: `pnpm --filter @taxi/driver test` — **the total test count must be unchanged from
  before this task.** Record it both times.
- **SATISFIES**: AC6

### GATE + COMMIT the split — do not start Phase 2 until this passes

- **IMPLEMENT**: Prove Phase 1 changed nothing, then commit it on its own.

  ```bash
  # 1. behaviour identical: same tests, same count, all green
  pnpm --filter @taxi/driver test 2>&1 | tail -5

  # 2. the moved code is a MOVE, not a rewrite — expect the added and deleted
  #    line counts to be within a handful of each other (the new module
  #    docblocks and the type imports are the whole difference)
  git diff --stat origin/main -- apps/driver/src/features/availability

  # 3. every export the slice had, it still has
  git diff origin/main -- apps/driver/src/features/availability/index.ts

  # 4. the full gate, from the worktree with .env copied in
  COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force

  git commit -am "refactor(driver): split pillFrom and runEffects out of presence-state (#141)"
  ```

- **GOTCHA**: This gate exists because Phases 1 and 2 edit the same file. Combined, the diff is a
  ~100-line move with a 25-line logic change buried inside it, and neither the reviewer nor
  `git log -p` in six months can separate them. **If the logic change is already written when you
  reach this task, you have skipped the gate** — `git stash` it, land the split, unstash.
- **VALIDATE**: the four commands above; the test count from step 1 must equal the count recorded
  before the split, and step 3 must show only changed import paths, no changed names.
- **SATISFIES**: AC6, AC11

### UPDATE `apps/driver/src/features/availability/presence-state.ts` — the `stop_uploader` effect

- **IMPLEMENT**: Add `| { type: 'stop_uploader' }` to the `Effect` union (after `kick_uploader`).
  Change `drained`'s effect list to
  `[{ type: 'put_status', status: 'offline' }, { type: 'stop_uploader' }, ...TEAR_DOWN]`.
  Extend the `drained`/`toggle_pressed` comment: the drain runs to the grace, then the server is
  told — and **everything after the put is conditional on the answer**, which is what #141 fixes.
- **PATTERN**: `kick_uploader` (line 84) — the existing uploader effect; mirror its shape.
- **GOTCHA**: Do **not** add `stop_uploader` to `TEAR_DOWN`. That would change `flipOffline`,
  `permission/foreground_denied` and `error/effect_failed` too, rippling into four more effect-list
  assertions for no benefit this ticket needs. Keeping it in `drained` alone is what makes the
  change surgical.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck` (the switch in `run` is now non-exhaustive —
  the next task fixes it; a red typecheck here is expected and informative).
- **SATISFIES**: AC5

### UPDATE `apps/driver/src/features/availability/use-presence.tsx` — own the uploader stop

- **IMPLEMENT**: In `run`, add `case 'stop_uploader': runtime.uploader.stop(); return;`. In
  `drain_then_clear` (212-217), **delete** `runtime.uploader.stop()` — the kick, the `whenIdle`
  grace and the `drained` dispatch stay.
- **GOTCHA**: This is the load-bearing half of the fix. With the stop inside `drain_then_clear`,
  the held branch would restore intent to online over a **stopped** uploader, and
  `uploader.kick()` cannot reliably restart it: `kick()` returns early at
  `if (this.running) return` (uploader.ts:49) *before* clearing `stopped` (line 50), so a kick that
  lands while a stopped drain is still unwinding does nothing and the loop then exits for good.
  Moving the stop behind the answer means it is simply never called in the held case, so that race
  is not reached. Read `uploader.ts:47-60` and confirm this before you touch anything.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC5

### UPDATE `apps/driver/src/features/availability/presence-state.ts` — the error event carries its put

- **IMPLEMENT**: `| { type: 'error'; code: string; status?: Intent }` — "the `put_status` this
  refusal answers, when it was one". One line of comment: the reducer must not infer it from state,
  because `driver_on_ride` is thrown by `vehicles.service.ts:90` too.
- **IMPORTS**: `Intent` is already imported at line 3.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC1

### UPDATE `apps/driver/src/features/availability/use-presence.tsx` — populate it

- **IMPLEMENT**: In `put_status`'s catch (129-134), add `status: effect.status` to the dispatched
  error event.
- **GOTCHA**: Only this site. `dispatch({ type: 'error', code: 'effect_failed' })` at line 95 stays
  as-is — it is not answering a specific put, and the field is optional for exactly that reason.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC1

### ADD the held branch to `presence-state.ts`'s `error` case

- **IMPLEMENT**: Before the existing `vehicle_required || driver_on_ride → flipOffline` check
  (319-325), add:

  ```
  if (
    event.code === 'driver_on_ride' &&
    event.status === 'offline' &&
    state.streaming
  ) {
    return {
      state: {
        ...state,
        intent: 'online',
        server: 'online',
        busy: false,
        banner: { kind: 'driver_on_ride' },
      },
      effects: [
        { type: 'persist_intent', intent: 'online' },
        { type: 'kick_uploader' },
      ],
    };
  }
  ```

  With a comment carrying: the server is holding us on a ride and we can prove life, so the tap
  does nothing except say why. `server: 'online'` is honest — `serverStatusEvent` already maps
  `on_ride` to online. `persist_intent online` undoes `toggle_pressed`'s write, or a cold launch
  reads a false «marked offline». `kick_uploader` closes the ≤4 s gap if the pre-put drain ended
  early (empty queue, `!socket`, or a `not_online` return) — it is a plain restart of an
  un-stopped uploader, never a kick over a `stop()`.
- **PATTERN**: `presence-state.ts:330-347` (the `effect_failed` fold) — the house style for a
  branch that needs its reasoning on the page.
- **GOTCHA 1**: `state.streaming` is the whole guard, and it is **not** defensive padding — two
  routes reach this branch with no stream, and dropping the guard re-opens review F31's ghost
  toggle (ON, no location task, then a spurious offline nudge) on both:
  - **`error/effect_failed`, the race-free one** (`presence-state.ts:330-371`, re-read at
    `660b833`). The fold returns `streaming: false, server: null`, but emits `put_status offline`
    off the **pre-fold** `state.server === 'online'`. So the 409 lands against a state where
    `streaming` is already false. Without the guard, a half-torn-down app would be restored to
    `intent: 'online'` with nothing streaming.
  - **`permission/foreground_denied` + `serverOnline`** (`presence-state.ts:220-244`). Reachable
    only via the race its own comment describes — a foreground refetch re-asserting `online` while
    the permission dialog is up — so it is the weaker of the two, but `streaming` is false there
    too.

  Task "ADD four reducer cases" pins both. If you change the guard, those two go red first.
- **GOTCHA 2**: The fallback still writes `server: 'offline'` while the server holds `on_ride`.
  That is deliberate, not a leftover: with no stream we cannot prove life, and folding to offline is
  the safe wrong. Say so in the comment or the next review reopens it as F38 residue.
- **GOTCHA 3**: Do not add an `announce` effect. Nothing about the driver's status changed, and
  `Banner.tsx:42-47` already announces the banner text on change.
- **VALIDATE**: `pnpm --filter @taxi/driver typecheck && wc -l apps/driver/src/features/availability/presence-state.ts`
  (**must be < 500**; `derived` estimate ~461)
- **SATISFIES**: AC1, AC2, AC4

### UPDATE the `'stop'` predicate in `use-presence.tsx`

- **IMPLEMENT**: Replace lines 135-142's predicate with
  `return stateRef.current.intent !== effect.status ? 'stop' : undefined;`
  and rewrite the comment: the put's answer left intent disagreeing with what we asked for, so the
  rest of this chain is about a world that no longer exists — a refused *online* put whose
  `flipOffline` already tore down (review F32), or a refused *offline* put the server held us
  through (#141/F38), where carrying on would tear down the stream the refusal exists to protect.
- **GOTCHA**: Verify by hand against every `put_status` site before you trust it — GO_ONLINE (96-102),
  `cold_launch` alive (168-175), `permission/foreground_denied` + serverOnline (237-242),
  `drained`, `error/effect_failed` (362-369), and the three single-effect re-asserts
  (`server_offline` 291, `ack_not_online` 305, `socket_connect` 388). The only behaviour that may
  change is the held case; a network-failed offline put must still fall through to the teardown.
- **VALIDATE**: `pnpm --filter @taxi/driver test`
- **SATISFIES**: AC1, AC3

### UPDATE `presence-state.test.ts` — the `drained` effect list

- **IMPLEMENT**: At lines 150-155, insert `'stop_uploader'` between `'put_status'` and
  `'stop_stream'`.
- **GOTCHA**: This should be the **only** pre-existing assertion that changes. If `test` reports
  others failing, `stop_uploader` leaked into `TEAR_DOWN` — go back and fix that instead of
  editing the assertions.
- **VALIDATE**: `pnpm --filter @taxi/driver test`
- **SATISFIES**: AC3

### ADD four reducer cases to `describe('decide — the server holds us')`

- **IMPLEMENT**: In `presence-state.test.ts`, after the existing F3 cases (225-282):

  1. **expected/failure** — `'a refused offline put while streaming holds us online: no teardown, no
     lie about the server (failure — #141/F38)'`. Drive the real chain:
     `decide(online(), { type: 'toggle_pressed' })` → `decide(…, { type: 'drained' })` (assert the
     effect list is `['put_status','stop_uploader','stop_stream','disconnect_socket','keep_awake']`)
     → `decide(…, { type: 'error', code: 'driver_on_ride', status: 'offline' })`. Assert:
     `intent === 'online'`, `server === 'online'`, `streaming === true`, `busy === false`,
     `banner.kind === 'driver_on_ride'`, and
     `expect(types(d.effects)).toEqual(['persist_intent','kick_uploader'])` — the `toEqual` is what
     proves no teardown, where a `not.toContain('stop_stream')` would not.
  2. **edge** — `'the same refusal with no stream still flips offline: we cannot prove life (edge)'`.
     `decide(online({ streaming: false, busy: true }), { type: 'error', code: 'driver_on_ride',
     status: 'offline' })` → `intent === 'offline'`, effects contain `'stop_stream'`.
  3. **edge** — `'a network failure on the offline put leaves intent offline and emits nothing —
     the chain, not the reducer, does the teardown (edge)'`. From the drained state,
     `{ type: 'error', code: 'offline', status: 'offline' }` → `busy === false`,
     `effects` is `[]`, `intent === 'offline'`.
     **This case does NOT prove the teardown runs** — in this branch the reducer emits no effects
     at all; the teardown comes from the outer chain continuing past the `'stop'` predicate, which
     lives in `use-presence.tsx`. All it proves is that `intent` stays `'offline'`, which is the
     value the predicate reads. The teardown claim itself is E3, owned by the hook test below.
  4. **failure** — `'a half-torn-down app is NOT restored: the effect_failed fold has no stream to
     offer (failure — the F31 guard)'`. **This is the case that pins GOTCHA 1's guard**, so write
     it as a real chain, not a hand-built state:
     `decide(online(), { type: 'error', code: 'effect_failed' })` → assert the fold emitted
     `put_status offline` (it reads the pre-fold `server: 'online'`) and that the folded state has
     `streaming === false`. Then feed that state
     `{ type: 'error', code: 'driver_on_ride', status: 'offline' }` and assert `intent === 'offline'`
     — the fallback, not the held branch.
- **PATTERN**: the surrounding block's style — drive `decide` through real event sequences, not
  hand-built states, wherever a sequence exists.
- **GOTCHA**: Case 4 is a **mutation check**, not a coverage line. Before moving on, delete the
  `state.streaming` condition from the reducer, watch case 4 go red, and put it back. A guard
  nobody has seen fail is a guard nobody knows is wired up — that is how review F39 shipped a test
  whose assertion could not support its comment. Record the observed red in the report.
- **VALIDATE**: `pnpm --filter @taxi/driver test`
- **SATISFIES**: AC1, AC2, AC3, AC4, AC10

### ADD two hook cases to `use-presence.test.tsx`

- **IMPLEMENT**:
  1. `'a refused offline put mid-ride stops the chain: the location task is never stopped
     (failure — #141/F38)'`. Go online through the provider, then toggle off with the offline PUT
     rejecting as `new ApiError(409, 'driver_on_ride')`. Assert `mockStopStreaming` was **not**
     called, `mockRuntime.uploader.stop` was **not** called, and the context's `state.intent` is
     back to `'online'`.
  2. `'an offline put that fails on the network still tears down (edge — the ordinary go-offline
     path)'` — **this is E3's real owner.** Same setup, but the offline PUT rejects as
     `new ApiError(0, 'offline')`. Assert `mockStopStreaming` **was** called and
     `mockRuntime.uploader.stop` **was** called. A reducer test cannot make either assertion: in
     that branch the reducer emits no effects, and the teardown comes from the chain continuing.
- **PATTERN**: the existing F32 case in this file — same mock harness, same `act`/`waitFor` shape.
- **GOTCHA 1**: `mockRequest` must be **status-aware**, not `mockRejectedValueOnce`. Both cases
  need the go-online half to succeed first (that is what sets `streaming: true`, the held branch's
  whole guard), so branch on the body:
  `mockRequest.mockImplementation((_m, _p, opts) => opts.body.status === 'online' ? Promise.resolve(profile) : Promise.reject(err))`.
  A blanket rejection fails the online PUT and neither case reaches the state it is testing.
- **GOTCHA 2**: Use the **real** `ApiError` (the harness already `requireActual`s it at lines
  20-30); a locally re-declared class fails `run`'s `instanceof` and every rejection degrades to
  `code: 'generic'`.
- **GOTCHA 3**: `mockRuntime.uploader.whenIdle` resolves immediately, so the drain grace needs no
  fake timers.
- **VALIDATE**: `pnpm --filter @taxi/driver test`
- **SATISFIES**: AC1, AC3, AC5

### UPDATE `services/api/src/features/drivers/drivers.service.ts` (comment only)

- **IMPLEMENT**: Lines 109-112 currently say the harm is *still live* in the present tense and
  point forward to #141. Rewrite: the app now reads this refusal as "the server holds you" and
  keeps the stream up (#141), so the 409 costs the driver a banner and nothing else. Keep the
  first half — why `offline` is refused at all (#11 owns the status) — verbatim.
- **GOTCHA**: Comment only. **Do not touch the `throw`, the `markOnline` re-seed, or any control
  flow in this file.** A behaviour change here would break `drivers.integration.spec.ts:399, 499,
  655` and `dispatch.integration.spec.ts:1052`.
- **VALIDATE**: `git diff --stat services/api` — must show one file, comment lines only.
- **SATISFIES**: AC7

### UPDATE `apps/driver/CLAUDE.md:25`

- **IMPLEMENT**: The sentence "a 409 (`vehicle_required`) wins and flips the toggle with the
  reason" needs the exception: a `driver_on_ride` 409 on the *offline* put, while the app is
  streaming, does **not** flip — intent goes back to online and the stream stays up (#141). Keep it
  to one clause; this file is a contract sheet, not a changelog.
- **VALIDATE**: read lines 22-33 back and check no other sentence on the page is now false.
- **SATISFIES**: AC7

### VERIFY no stale claim survives

- **IMPLEMENT**: `grep -rn "#141\|F38\|tears the stream\|tear the stream" services apps packages docs .claude --include='*.ts' --include='*.tsx' --include='*.md' | grep -v node_modules`
  and read every hit. Review reports under `.claude/code-reviews/` are historical records — leave
  them alone. Source comments, `CLAUDE.md` files and `docs/` must read true at this HEAD.
- **GOTCHA**: The PR body is the most-read surface and the only one not in the working tree. When
  you open the PR, re-derive every figure you quote (`wc -l`, the test count) at HEAD rather than
  copying this plan's `derived` estimates.
- **VALIDATE**: the grep output, read one hit at a time.
- **SATISFIES**: AC7

---

## TESTING STRATEGY

### Unit Tests

jest-expo, colocated `*.test.ts(x)`, run with `pnpm --filter @taxi/driver test`. The reducer is
pure, so `presence-state.test.ts` proves the decisions with no mocking at all — that is where the
three new cases go.

### Integration Tests

`use-presence.test.tsx` is the integration layer for this slice: a real React render over the
provider, with `@/features/location`, `@/features/auth` and `./intent-store` mocked. It is the only
place the `'stop'` predicate and the effect runner's wiring can be observed, so the one new hook
cases belong there — **both of them**, including the one that proves the ordinary network-failure
teardown still runs (E3). The reducer cannot own that claim: its `error/offline` branch emits no
effects, so the teardown is only observable as chain behaviour.

**No new api-side tests.** The api half is unchanged and already covered:
`drivers.integration.spec.ts:399, 499, 655` and `dispatch.integration.spec.ts:1052` all assert the
409 body is `driver_on_ride`. If any of them goes red, you changed api behaviour and should not
have.

### Edge Cases

Every case names where it is verified.

| # | Edge case | Verified by |
|---|---|---|
| E1 | Refused offline put **while streaming** → held, no teardown | `presence-state.test.ts`, new case 1 |
| E2 | Refused offline put **with no stream** → still flips offline (the F31 ghost-toggle guard) | `presence-state.test.ts`, new case 2 (the state) **and case 4** (the reachable `effect_failed` route, verified by deleting the guard and watching it go red) |
| E3 | Offline put fails with a **network error** → teardown still runs | **`use-presence.test.tsx`, new case 2** — not the reducer: that branch emits no effects, so only the chain can be observed |
| E4 | Refused **online** put still stops the chain (F32, unchanged) | `run-effects.test.ts` (the `'stop'` case moved from `presence-state.test.ts:403` in Phase 1) + `use-presence.test.tsx`'s existing F32 case |
| E5 | The location task is never stopped in the held case | `use-presence.test.tsx`, new case |
| E6 | The uploader is not stopped in the held case | `use-presence.test.tsx`, new case (`mockRuntime.uploader.stop` not called) |
| E7 | `effect_failed` mid-teardown still folds without looping (F37) | `presence-state.test.ts:284-369`, unchanged — must stay green |
| E8 | The pill and `runEffects` behave identically after the split | the moved test blocks, assertions untouched; **the total test count must not change** |
| E9 | **A real phone, on a real ride, keeps its pin moving after a tap OFF** | **Level 4 §1 — owed to Linards, no automated owner.** See below. |

E9 has no automated owner and cannot get one: the harm is a *device* behaviour (a background
location task surviving a chain that was stopped). The reducer and hook tests prove the decision
and the wiring; only a phone proves the task. It is bundled with #14's already-outstanding Level 4
§C/§D rather than pretended away.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/driver typecheck
pnpm --filter @taxi/driver lint          # max-lines 500 is an ERROR here
wc -l apps/driver/src/features/availability/*.ts apps/driver/src/features/availability/*.tsx
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/driver test
```

Record the total test count **before** the split and **after**, and state both in the report. The
split must move tests, not lose them.

### Level 3: Integration Tests / the gate

```bash
# from the worktree, with .env copied in:
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
```

CI parity. `pnpm check` is **not** the gate — it omits `build`. Expect 60-90 s; past ~3 min read
the buffered log rather than assuming a hang (a failing `@taxi/api` jest run never exits and turbo
waits). Redis-gated api suites `describe.skip` without `REDIS_TEST_URL`; set it to your
`REDIS_PORT` to match CI.

### Level 4: Manual Validation

**Step 1 — the device proof (OWED TO LINARDS, not runnable by the implementing agent).**

Both halves of the setup exist: the dispatch console ships the force-assign dialog
(`apps/dispatch/src/features/override/assign-dialog.tsx`, wired at
`apps/dispatch/src/app/dispatch/page.tsx:273-291`) and the api endpoint is
`dispatch.controller.ts:97`. What is missing is a device: there is no Android phone available, no
paid Apple account, and the agent cannot drive the Simulator. **Do not write this step as if it
will run during this ticket.**

**Exactly what the device adds** (the residual — everything else is already pinned by a test):
that the OS background location task **survives a chain the app stopped**. The hook test proves
`stopStreaming` is never called; only a phone proves the task is still emitting fixes afterwards,
because `jest.setup.ts` fakes every native module by design (`apps/driver/CLAUDE.md:33`). The
decision, the effect list, the predicate and the uploader are all covered above. This step is one
claim wide.

**Run sheet — self-contained, ~10 minutes, no agent needed.** Two devices or two browser tabs:
the driver phone, and `/dispatch` on a laptop.

| # | Do | Expect | ✅/❌ |
|---|---|---|---|
| 1 | Sign in on the driver phone; tap the toggle ON | Status reads «Tiešsaistē», pill «Tiešraide» | |
| 2 | Open `/dispatch`, find that driver on the board | The pin moves, at least every ~4 s | |
| 3 | Create/pick a pending ride; open its row → **Assign** → pick that driver | The board row goes to an assigned/accepted state | |
| 4 | On the phone, note the time. **Tap the availability toggle OFF** | The toggle **springs back to ON**; a blue info banner «Jūs pašlaik izpildāt braucienu.» appears | |
| 5 | Watch `/dispatch` for **90 s** without touching the phone | The pin **keeps moving** the whole time. 90 s is chosen to clear the 60 s `findNearby` freshness window — a pin that only survives 30 s proves nothing | |
| 6 | Open the rider's tracking page `t/<token>` for that ride | The car keeps moving there too | |
| 7 | Complete the ride from `/dispatch` | No offline push nudge arrives on the phone in the following 2 min | |
| 8 | Now tap the toggle OFF again | It goes OFF normally, no banner — the hold was ride-scoped, not sticky | |

**Any ❌ on 4, 5 or 7 means the fix did not land — do not close #141 on the automated cover alone.**
Step 8 catches the opposite failure: a held state that outlives the ride.

Blocked on hardware, not on this ticket: no Android phone, no paid Apple account, and the agent
cannot drive the Simulator. File this sheet with #14's outstanding Level 4 §C/§D and note it in the
PR body as **owed**, not as passed.

**Step 2 — the api half still refuses (runnable now).** Automated, no device:

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- drivers.integration
```

Expect the three `driver_on_ride` assertions (`drivers.integration.spec.ts:399, 499, 655`) green
and unmodified. This is the standing proof that the 409 this ticket reinterprets is still thrown.

### Level 5: Additional Validation (Optional)

```bash
# the reducer diff, one branch at a time — the review will read it this way
git diff origin/main -- apps/driver/src/features/availability/presence-state.ts
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** — A `driver_on_ride` 409 on an *offline* `put_status`, while `state.streaming` is
      true, leaves `intent: 'online'` and emits **no** teardown effect
      (`stop_stream`/`disconnect_socket`/`keep_awake off`/`stop_uploader`).
- [ ] **AC2** — The app never records `server: 'offline'` in that case; it records `'online'`,
      which is what `serverStatusEvent` already maps `on_ride` to.
- [ ] **AC3** — The ordinary go-offline paths still reach `TEAR_DOWN`: a successful offline put and
      a network-failed offline put both tear down, and the F32 online-put stop still fires. **One
      thing does change on those paths** — the uploader's stop moves from grace-expiry to
      put-resolution, up to 8 s later (`derived`: `api-client.ts`'s `timeoutMs` default). Benign,
      and stated rather than hidden: see NOTES.
- [ ] **AC4** — A `driver_on_ride` 409 with `streaming: false` still flips offline via
      `flipOffline` — no ghost toggle (review F31).
- [ ] **AC5** — The uploader is not stopped in the held case, and the location task keeps feeding it.
- [ ] **AC6** — `presence-state.ts` is under 500 lines; `pillFrom`/`Connection`/the windows and
      `runEffects` live in siblings; the slice's `index.ts` exports the same names as before; the
      test count is unchanged by the split.
- [ ] **AC7** — `drivers.service.ts:109-112` and `apps/driver/CLAUDE.md:25` no longer describe the
      harm as live, and no source comment or doc in the tree still says the stream is torn down.
- [ ] **AC8** — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` green
      from the worktree.
- [ ] **AC9** — Level 4 §1 is recorded in the PR body as **owed**, with #14's §C/§D, not as passed,
      and the run sheet is attached so Linards can run it without an agent.
- [ ] **AC10** — The `state.streaming` guard is pinned by reducer case 4, and its failure has been
      **observed**: the guard was deleted, the case went red, the guard was restored. State the
      observed red in the report — a guard nobody has watched fail is unproven (review F39).
- [ ] **AC11** — Phase 1 landed as its own commit, gate-green, with the test count unchanged and
      `index.ts` exporting the same names. The logic change is not in that commit.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Phase 1 gate-green and **committed on its own** before Phase 2 started (the split is
      behaviour-preserving or it is not a split)
- [ ] The `state.streaming` guard watched to fail: deleted → reducer case 4 red → restored
- [ ] Full gate green: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`
- [ ] `wc -l` on `presence-state.ts` re-observed and quoted, not inherited from this plan
- [ ] Test count before/after the split re-observed and equal
- [ ] Acceptance criteria all met
- [ ] Every figure in the PR body re-derived at HEAD (one grep per claim)

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

- **A1** — `origin/main` at `660b833` (the #139 merge) is the base. If a concurrent session has
  moved main, re-check every line number in CONTEXT REFERENCES before trusting one.
- **A2** — A `driver_on_ride` 409 on the presence endpoint can only ever be an *offline* put
  (`drivers.service.ts:113`; an `online` re-assert while held returns the profile). The plan does
  not rely on this — it passes `status` explicitly — but the assertion in new case 1 assumes it.
- **A3** — `on_ride` continues to read as `server: 'online'` app-side (`serverStatusEvent`,
  `presence-state.ts:419-434`). If that ever changes, the held branch's `server: 'online'` becomes
  a lie and must change with it.

**Questions — none blocking; each names its default:**

- **Q1** — Should the toggle refuse the tap locally once the `driver_on_ride` banner is up, instead
  of running the 5 s drain and the put again on a second tap? **Default: no.** The app has no
  reliable signal that the ride ended (`releaseFromRide` sets the row back to `online`, which the
  app already models as `'online'`), so a local refusal would outlive the ride and strand the
  driver. The repeated tap is bounded and correct.
- **Q2** — Is «Jūs pašlaik izpildāt braucienu.» / "You are on a ride right now." still the right
  copy now that the toggle stays ON? **Default: yes, unchanged.** It reads as the explanation for
  why the tap did nothing. If Linards wants "you can go offline once the ride is finished", that is
  a three-catalog copy change and a separate, trivial ticket — not this one.
- **Q3** — Should `flipOffline`'s `TEAR_DOWN` also stop the uploader? **Default: no, out of scope.**
  It does not today; the drain self-limits at `if (!socket) return` once `disconnect_socket` has
  run. Worth its own ticket if a review wants the reducer to own the uploader everywhere.

---

## NOTES (open canvas)

### Why not Option 1 from the issue

The issue's Option 1 — "hold `TEAR_DOWN` until the offline put is accepted" — is the right
*instinct* and the wrong *scope*. Moving `TEAR_DOWN` out of `drained` means every path that settles
an offline intent has to re-emit it: `server_offline` while `intent === 'offline'`, `error/offline`
(network), the generic `error` fallback, and `ack_not_online`. Miss one and the phone streams while
the driver believes they are offline — the server still holds them online, so they stay
dispatchable, and the harm is worse than the bug being fixed.

What this plan takes from Option 1 is the *principle* (nothing after the put is committed before
the answer) applied to exactly the two things that must not be committed early: the teardown, which
`'stop'` already skips once the predicate is right, and the uploader stop, which moves behind the
put. `drained`'s effect list is otherwise untouched and its ordering comment stays true.

**When to revisit — the one condition, so this is not re-argued from scratch.** Option 1 becomes
the right shape the moment a **third** refusal reason has to hold the app online. With one
(`driver_on_ride`) the exception is cheaper than the restructure; with three, the `'stop'` predicate
and the held branch stop being an exception and start being the rule, and `TEAR_DOWN` genuinely
belongs on a settling event. Anyone reopening this: check the count first. If it is still one,
the answer has not changed and the reasoning above is the answer.

The issue also floats moving this to #11. **#11 is CLOSED** (verified: `gh issue view 11` →
`"state":"CLOSED"`), so that route is gone and #141 owns the fix outright.

### Why not Option 2 alone

Option 2 — "extend the F32 stop to a refused offline put when the code is `driver_on_ride`" —
cannot work on its own, because `flipOffline` emits `TEAR_DOWN` **inside its own effect list**, run
by the re-entrant `dispatch` at `use-presence.tsx:87-97`. Stopping the outer chain stops the
*duplicate* teardown, not the real one. The reducer has to change whatever else does. Given that,
generalising the predicate is strictly better than special-casing it: one rule instead of two, and
F32's own case falls out of it.

### The uploader hazard this design routes around (advisor F1)

`uploader.ts`:

```
kick(): void {
  if (this.running) return;     // 49 — early return...
  this.stopped = false;         // 50 — ...BEFORE this
  this.running = true;
  void this.drain().finally(() => { this.running = false; });
}
stop(): void { this.stopped = true; }   // 58-60 — does NOT clear `running`
```

An earlier draft of this fix kept `runtime.uploader.stop()` inside `drain_then_clear` and had the
held branch emit `kick_uploader` to undo it. That is broken on the slow-drain path: when the queue
does not empty inside `DRAIN_GRACE_MS`, `whenIdle` returns with `running === true`, `stop()` sets
`stopped`, and a `kick()` arriving before the loop unwinds hits line 49 and returns **without
clearing `stopped`**. The drain then exits and nothing restarts it — fixes land in the queue and
never upload. The pin freezes anyway, by a different route.

Moving the stop behind the put removes the pairing entirely: in the held case `stop()` is never
called, so `stopped` is never true, so the `kick_uploader` in the held branch is a plain restart of
an idle-but-live uploader (or a documented no-op mid-drain). No change to `features/location` is
needed, and none should be made here — fixing `kick()` is its own ticket if anyone wants it.

### What the uploader move DOES change on the ordinary path

Moving `uploader.stop()` from `drain_then_clear` to behind the put is not free. On a go-offline
where the queue is still non-empty when `DRAIN_GRACE_MS` expires, the uploader now keeps emitting
for the put's round trip — up to 8 s (`derived`: `api-client.ts`'s `timeoutMs` default of 8 000 ms;
the observed case is far shorter).

It is benign, and arguably better than what it replaces: those extra emissions are real positions,
and the server still holds the driver `online` for exactly that window, so they are acked rather
than refused `not_online`. The old order stopped uploading *before* the server knew, throwing away
several seconds of valid proof-of-life. But it is a change on a path this ticket did not set out to
touch, so AC3 names it rather than claiming those paths are untouched.

### Why `kick_uploader` is still in the held branch

Not to undo a stop — to close a small gap. `drain_then_clear` kicks and waits; the drain can end
early on an empty queue, a `!socket`/`disconnected` return, or a `not_online` (which dispatches
`ack_not_online`, a `noop` here because intent is already `'offline'`). In any of those the
uploader sits idle with `running === false` until the next fix arrives from
`location-task.ts:66` — up to `MIN_FIX_INTERVAL_MS` (4 s). One line closes it.

### Blast-radius check on the generalised predicate

Walked by hand against every `put_status` emission at `660b833`:

| Site | put | intent after the answer | old | new |
|---|---|---|---|---|
| `GO_ONLINE` (96-102) | online | online (ok) / offline (409 → flipOffline) | continue / stop | same |
| `cold_launch` alive (168-175) | online | same | continue / stop | same |
| `permission/foreground_denied` + serverOnline (237-242) | offline | offline — **enforced**, not assumed: the branch clears `streaming` before the put, so the held branch's guard cannot fire on this route (review F2; before the fix it could, and the new predicate then stopped the chain) | continue | same |
| `drained` (311-317) | offline | offline (ok/network) / **online (held)** | continue | continue / **stop** |
| `error/effect_failed` (362-369) | offline | offline (`streaming` already false) | continue | same |
| `server_offline` re-assert (291) | online | — single-effect list | moot | moot |
| `ack_not_online` re-assert (305) | online | — single-effect list | moot | moot |
| `socket_connect` (388) | online | — single-effect list | moot | moot |

One row changes. That is the ticket.

### Line arithmetic

`derived`, not observed — re-measure with `wc -l` at each step.

- Out of `presence-state.ts`: `Connection` + blank (2) + `runEffects` block 436-458 with its
  trailing blank (24) + windows and `pillFrom` 460-480 (21) = **47**. 480 − 47 = **433**.
- Into it: `stop_uploader` in the union (1), `status?: Intent` on the error event (1), the
  `drained` effect entry (1), comment edits (~3), the held branch with its comment (~22) = **~28**.
- **433 + 28 ≈ 461**, leaving ~39 under the 500 cap. The round-3 review measured 459 at `d9e04fa`
  with 41 left, so this lands in the same neighbourhood by a different route.

### Sequencing risk

Phase 1 (the split) and Phase 2 (the logic) both touch `presence-state.ts`. Do them as **two
commits**, gate-green between: a split that changes no behaviour is reviewable in seconds, and a
combined diff hides a 25-line logic change inside a 100-line move. The reviewer will thank you, and
so will `git log -p` in six months.

## AMENDMENTS

<!-- newest at the bottom; append after this plan is first executed -->
