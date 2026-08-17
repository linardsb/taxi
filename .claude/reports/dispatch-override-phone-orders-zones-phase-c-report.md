# Implementation Report — Dispatch zones/queue grid, cascade visibility, explainability (#19 Phase C)

**Plan**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks C1–C7)
**Branch**: `feature/dispatch-zones-cascade` (worktree `/Users/Berzins/Desktop/taxi-zones`)
**Base**: `feature/dispatch-override-phone-orders` @ `ced2d30` — **not `main`**, see Deviations D1
**Status**: COMPLETE

## Summary

Dina's board can now answer the two questions #18 left it unable to: *whose turn is
it* and *why this driver*. `DispatchQueueStore` grew a `snapshot()` and a companion
join-timestamp hash; the board frame carries every configured zone's rank (empty ones
included) and each live ride's cascade state; and the "why this driver" sentence is
composed once in `@taxi/shared` so the console and the driver app render the identical
string. The console's zone panel is replaced by a compact zone/queue table, and each
offered ride row gains a cascade strip counting down off the board's existing 1 Hz clock.

## Tasks completed

- **C1** queue store `snapshot()` + join timestamps → `services/api/src/features/dispatch/queue/dispatch-queue.store.ts` (UPDATE), `redis-dispatch-queue.store.ts` (UPDATE), `in-memory-dispatch-queue.store.ts` (UPDATE), `dispatch.policy.ts` (UPDATE — `dispatchQueueJoinedKey`)
- **C2** the one explanation composer → `packages/shared/src/dispatch-explanation.ts` (CREATE), `packages/shared/src/index.ts` (UPDATE), `packages/shared/src/i18n.ts` (UPDATE — 4 `explain.*` keys × LV/RU/EN)
- **C3** frame schema → `packages/shared/src/realtime-events.ts` (UPDATE — `zones[]`, per-ride `cascade`)
- **C4** projections + wiring → `services/api/src/features/dispatch/board/zone-rows.ts` (CREATE), `board/cascade.ts` (CREATE), `board/board.service.ts` (UPDATE), `dispatch.repository.ts` (UPDATE — `findOffersForRides`), `geozones.repository.ts` / `geozones.service.ts` (UPDATE — `listForCity`)
- **C5** zone grid → `apps/dispatch/src/features/zones/zone-grid.tsx` (CREATE), `zones/index.ts` (CREATE), `app/dispatch/page.tsx` (UPDATE); `board/zones-panel.tsx` + its test DELETED, export removed from `board/index.ts`
- **C6** cascade strip → `apps/dispatch/src/features/zones/cascade-strip.tsx` (CREATE), mounted in `board/ride-queue.tsx` (UPDATE)
- **C7** strings + gate → `packages/shared/src/i18n.ts` (UPDATE — 11 `console.*` keys × LV/RU/EN); `.claude/references/realtime-events.md` (UPDATE — the `dispatch:board` row now describes what the frame carries)

## Tests added

| File | Cases | Result |
|---|---|---|
| `services/api/test/dispatch-queue-store.contract.ts` (+5, run against BOTH stores) | snapshot agrees with `positions()`; re-join preserves `joinedAt`; `sendToBack` resets it; `leave` drops it; empty zone | 24/24 (observed) |
| `packages/shared/tests/dispatch-explanation.test.ts` (new, 10) | three strategy branches; LV/RU/EN parity; sub-minute ETA; floored/unknown zone time; two degraded-input failures; schema accept/reject | 10/10 (observed) |
| `packages/shared/tests/realtime-events.test.ts` (+4) | empty zone survives the wire; offline driver keeps rank; live cascade + explanation; position 0 rejected | (observed) |
| `services/api/src/features/dispatch/board/zone-rows.spec.ts` (new, 7) | catalog join; empty zones; verbatim positions incl. gap; null and future `joinedAt`; name→phone; ghost dropped | 7/7 (observed) |
| `services/api/src/features/dispatch/board/cascade.spec.ts` (new, 7) | holder/deadline/next/why; tried-driver skip; auto-match; dispatcher; unheld-with-attempts; never-offered absent; name→phone | 7/7 (observed) |
| `services/api/src/features/dispatch/board/board.service.spec.ts` (+7) | empty configured zone; rank + time-in-queue; offline driver kept; explanation matches the grid; **one** offers query for N rides; unheld cascade; no cascade | 16/16 (observed) |
| `apps/dispatch/src/features/zones/zone-grid.test.tsx` (new, 6) | rank/time/phone; empty zone drawn; positions hidden without queue mode; offline entry; position announced; no-zones message | 6/6 (observed) |
| `apps/dispatch/src/features/zones/cascade-strip.test.tsx` (new, 6) | full line; countdown re-derives from `nowMs`; lapsed floors at 0; unheld; no guess outside queue mode; unknown key dropped not thrown | 6/6 (observed) |
| `apps/dispatch/src/features/board/ride-queue.test.tsx` (+2) | strip mounts on `offered`; absent on `accepted` | (observed) |

Five existing fixtures were extended with the two new required frame fields
(`board-state.test.ts`, `use-board.test.tsx`, `dispatch-page.test.tsx`,
`ride-queue.test.tsx`, `assign-state.test.ts`) — no assertions changed.

## Validation results

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

**Green — `Tasks: 18 successful, 18 total`, `Cached: 0 cached` (`--force`), 53.5 s.**
All four packages `observed` on that single run:

| Package | Suites/files | Tests |
|---|---|---|
| `@taxi/api` | 59 passed / 59 | **541 passed / 541** |
| `@taxi/shared` | 20 passed / 20 | **181 passed / 181** |
| `@taxi/dispatch` | 21 passed / 21 | **158 passed / 158** |
| `@taxi/db` | 3 passed / 3 | **17 passed / 17** |

**Provenance, stated separately because the two halves are not the same kind of claim:**

- The **totals** above are `observed` — read off that gate run's output.
- The **deltas** are `derived` from what this phase added, and each is checkable against
  the file list in "Tests added":
  - api `(5 contract cases × 2 stores) + 7 board.service + 7 zone-rows + 7 cascade` = **+31**
  - shared `10 dispatch-explanation + 4 realtime-events` = **+14**
  - dispatch `6 zone-grid + 6 cascade-strip + 2 ride-queue − 3 retired with zones-panel.test.tsx` = **+11**
- Phase A's baseline (`510 api / 167 shared / 147 dispatch / 17 db`) is **not** re-observed
  here — it is inherited from `ced2d30`'s commit message and **corroborated by
  subtraction**: 541 − 31 = 510, 181 − 14 = 167, 158 − 11 = 147, and db is untouched at 17.
  That is corroboration, not measurement; no gate was run on the untouched base branch.

**Skipped suites: 0** — `REDIS_TEST_URL=redis://localhost:6381` was set on the gate run,
so `redis-dispatch-queue.store.spec.ts` executed rather than `describe.skip`ping. That
suite is exactly where C1's new behaviour meets real `LRANGE`/`HGETALL`/`HSETNX`/`MULTI`,
so a gate without the variable would report green having never run it (AC #11).

### Board cost per frame (AC-adjacent, and the number C4 asked for)

`derived`, counted from `buildBoardState` before and after, and asserted for the offers
read by a test (`reads every ride's offers in ONE query`):

| | Postgres per frame | Redis per frame |
|---|---|---|
| Before (#18) | `1 rides + 1 contacts + N ST_Contains` = **2 + N** | 1 `listOnline` |
| After (#19 C) | `1 rides + 1 catalog + 1 contacts + 1 offers + N ST_Contains` = **4 + N** | 1 `listOnline` + Z × (LRANGE + HGETALL) |

N = online drivers with a position; Z = configured zones. The two added Postgres queries
are **flat** — neither scales with rides, drivers or queue depth. The pre-existing `N`
fan-out is untouched and still carries its own fleet-cap warning. At 2 s cadence that is
30 frames/min, so #19 adds 60 queries/min at any fleet size (`derived`: 2 × 30).

Query count is not the only cost, so the volume behind the flat one: `findOffersForRides`
reads every offer row for the frame's rides, bounded by `BOARD_RIDES_LIMIT` = 100 rides ×
`MAX_OFFER_ATTEMPTS` = 5 offers = **≤500 rows per frame** (`derived`, worst case at the
cap; pilot volume is single-digit live rides so the real figure is ~tens). Seven scalar
columns, no jsonb — the four blob columns are deliberately not selected.

**Frame size is not measured.** C3 asked for a re-measurement rather than inheriting
#18's "a few kB"; that was not run, so no figure is claimed here in either direction.
`expected`, not observed: at ≤6 zones × ≤10 entries plus ≤N rides × 6 cascade fields the
frame roughly doubles and stays low single-digit kB. Measure it before treating the
localStorage persistence budget as settled.

## Deviations from the plan

**D1 — Branched from Phase A, not from `main`.** The ticket said "cut from main AFTER
#19 Phase A merges". Phase A has **not** merged: it sits unpushed on
`feature/dispatch-override-phone-orders` @ `ced2d30` with no PR. Cutting from `main` was
not merely suboptimal but impossible — the plan file itself is on that branch (`6b9cac6`),
and C6 mounts into the `ride-queue.tsx` Phase A rewrote. Stacked instead, after checking
that worktree was quiet (clean tree, last file write 20:45, commit 21:24, checked 21:33).
**Consequence for `piv-create-pr`:** targeting `main` puts Phase A's 2 commits in this
PR's diff; targeting `feature/dispatch-override-phone-orders` gives a clean diff that
cannot merge until Phase A does. Decide deliberately — do not open a two-phase PR by
accident. If Phase A is amended or rebased during review, this branch needs a rebase.

**D2 — Report filename.** Written to `…-zones-phase-c-report.md`, not the slug-derived
`…-zones-report.md`, which Phase A already wrote, committed and points its PR body at.
Overwriting it would have destroyed another PR's artifact.

**D3 — `explain.*` is a new i18n namespace, not `console.*`.** C7 lists the three
explanation keys among the console strings. They are not console strings: #15's driver
app renders the same keys, and the module exists precisely so both surfaces read one
sentence. A `console.` prefix on a string the driver sees would be actively misleading.

**D4 — Four explanation keys, not three.** `explain.eta_only` was added for the case
where queue mode ran but the rank is not knowable (`OfferRef.queuePosition` is nullable,
so the type forces the branch). It does **not** fall through to `explain.auto_match`:
that would assert a distance ranking which never ran. It states only the ETA.

**D5 — `phone` added to each zone entry.** The plan's `zones[].entries` field list has no
phone, but C5 also requires keeping `zones-panel.tsx`'s always-visible phone links. The
entry that most needs a number is a driver who went offline still holding position 1 —
who by definition is not in `frame.drivers`, so a lookup there would fail in exactly the
case that matters.

**D6 — `snapshot()` returns `joinedAt: string | null`, not `string`.** Drivers already
queued when this ships have a list entry and no timestamp, and `joinBack` cannot
back-fill them without claiming a 40-minute wait just started. Null means unknown; the
projection renders it as 0 seconds. The store never *manufactures* that state: `joinBack`
writes the list entry and its stamp in one `MULTI`, so a crash between them cannot leave
a permanently unstamped entry (the early return on re-join would never revisit it).

**D7 — `explainAssignment` takes `AssignmentSource`, not its own tuple.** The plan's
signature inlines `'auto_match' | 'geozone_queue' | 'dispatcher'`, which is exactly
`ASSIGNMENT_SOURCES`. Reusing it keeps one list to maintain.

**D8 — `isMessageKey()` added to `i18n.ts`.** `cascade.explanation.key` is the one place
a message key arrives over the wire. An api deployed ahead of the console bundle would
otherwise reach `MESSAGES[lang][key]` as `undefined` and throw inside `.replace`, taking
down the whole ride queue over one missing sentence. Guarded, the strip drops a clause.

**D9 — The strip is drawn only on `offered`/`queued`, though the frame carries a cascade
for tried-and-dropped `requested` rides too.** AC #15 scopes the strip to a live cascade,
and `dispatch:unclaimed` is what escalates the other case. The wire data is the honest
shape; rendering it is a one-line change if wanted.

**D10 — `snapshot()` and `positions()` agree by construction.** Both report a duplicated
driver once, at their first occurrence, and both count the duplicate when numbering
everyone behind — so a transient double-append leaves a visible gap (1, 3) rather than
two different rankings on Dina's screen and the driver's phone. The shared rule lives in
`snapshotFrom()` so the fake cannot drift from Redis.

## Issues encountered

- **Task 0's `.env` copy had to be handed to Linards.** The repo's `PreToolUse` hook
  blocks any Bash command whose text contains that filename (it matches command text, not
  intent), and working around a security hook was not appropriate. He ran it. The gate was
  then re-run with the file in place and produced the **identical** result — 18/18 tasks,
  541 / 181 / 158 / 17, 53.3 s (`observed`). So the earlier runs, which used inline
  `COMPOSE_PROJECT_NAME` + `REDIS_TEST_URL` against the already-running shared
  `taxi-db-1` / `taxi-redis-6381`, were not measuring a degraded environment.
- **One gate run out of four went red on cross-session interference, not on this code.**
  A run between the two green ones failed 2 of 541 with `socket hang up` and
  `Parse Error: Expected HTTP/, RTSP/ or ICE/` — transport errors, in
  `payments.integration.spec.ts` and `tracking.integration.spec.ts`, two slices Phase C
  does not touch. Re-run in isolation both passed (23/23, observed), and the full gate
  passed either side of it. This is the hazard root `CLAUDE.md` names: seven worktrees
  share one Postgres and integration global-setup drops the shared test DB, so a
  concurrent session's gate tears this one's server down mid-request. Worth knowing when
  reading a red gate here; it is not a flake in the new suites.
- **Turbo's cache is shared across worktrees.** `pnpm turbo run build` reported a cache
  hit replaying logs from `/Users/Berzins/Desktop/taxi-dispatch-override`; the outputs
  were restored into this worktree correctly (verified by `ls db/dist/index.js`), but the
  log path is misleading when reading a failure.
- **Nothing in production calls `DispatchQueueStore.leave()`** (only `joinBack` and
  `sendToBack` have live callers). The grid therefore shows drivers who joined a rank and
  went offline. That is treated as the feature — it is the thing Dina resolves — but it
  means the queue, and now its timestamp hash, are pruned by nothing.
- Manual validation (plan Level 4) was **not run**: those steps exercise Phase B's booking
  form, which does not exist yet. Nothing in Phase C was verified against a live browser.

## Not done / out of this phase's scope

- AC #13's ledger rows and AC #12's phone-channel query belong to Phase D.
- Frame-size re-measurement (see above) — stated as `expected`, not claimed as observed.
