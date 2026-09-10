# PR #163 — round 1 review fixes

Review: `.claude/code-reviews/pr-163-review.md` (on `docs/pr-163-review`, PR #164), against head
`1403135`. Direction from Linards: **fix all**.

PR #163 is **OPEN** (`observed` — `gh pr list --head fix/pr-154-deferred-lows`), so the fixes land
on it. Worktree was clean at the start and no `MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD`
existed (`observed` — `git status --porcelain` empty; `ls "$(git rev-parse --git-dir)"/…` no match).

## Triage

| # | Severity | Call | Why |
|---|---|---|---|
| L1 | Low | **Fixed** | Direct consequence of a change this PR makes; two sibling files already carry the fix. |
| L2 | Low | **Fixed** | One event name for two different meanings of `driverId`. |
| L3 | Low | **Fixed** | Barrel advertises a route nothing takes — the last remnant of the claim this PR retires. |
| N1 | nit | **Fixed, both sites** | The reviewer's own condition: "touch both or neither". |
| N2 | nit | **Won't-fix** | Not a fix request in the review, and the guard it would need is error handling for an impossible state. See below. |
| N3 | nit | **Manual — device day** | A "polite" live region inside a collapsed `Pressable`; only a real phone answers it. |

Also raised and correctly left alone by the review: `receipt.test.tsx`'s third test is named for
behaviour its body does not assert. Confirmed pre-existing (`main` carries the same body), declared
in the PR body, and **not touched here** — it belongs to the next driver-slice ticket, not to a
fix round for this one.

---

## L1 — the third `@/features/active-ride` mock was a full replacement

**What was wrong.** `apps/driver/src/features/push/push-registrar.test.tsx` mocked
`@/features/active-ride` as a full replacement while importing the `@/features/offers` barrel,
which loads `offer-card-props.ts` → `paymentMethodLabel` and `pctLabel`. Both resolved to
`undefined` inside that file. It passed only because nothing there drew the card.

**Fix.** The `jest.requireActual` spread the two sibling files carry
(`offers/use-offers.test.tsx:42-47`, `earnings/earnings-screen.test.tsx:36-41` — the review printed
that second path as `availability/earnings-screen.test.tsx`, which does not exist).

**Test.** A fourth case, *the card the tap lands on draws through the real active-ride labels
(edge)*: `mount()` takes an optional child, the case passes `<OfferScreen />`, and it asserts the
payment pill (`paymentMethodLabel`) and the you-keep line (`pctLabel`) against the `lv` catalog.
This is the landmine standing on something, so the mock cannot silently regress again.

**Probe — `observed` 2026-09-09.** Spread removed, file re-run:

```
✕ the card the tap lands on draws through the real active-ride labels (edge)
  TypeError: (0 , _activeRide.paymentMethodLabel) is not a function
Tests: 1 failed, 3 passed, 4 total
```

The three existing tap-routing cases stayed green either way, which is why the hole was quiet.
Spread restored; re-run: `Tests: 4 passed, 4 total`.

**New failure mode of the fix.** The spread makes this file evaluate the real `active-ride` barrel
for the first time — a module-scope throw there would now fail all four cases rather than none.
Covered by the same run: all four pass, and `@taxi/driver` is 41 suites / 217 tests green in the
gate below.

## L2 — one event name, two different meanings of `driverId`

**What was wrong.** `dispatch-notifier.ts:142` (the ride-room emit, naming the newly **assigned**
driver) and `:169` (the revoke loop, naming a **revoked** driver) both logged
`dispatch.assign.notify_failed`. Grouping by `event` + `driverId` conflated two failures with
different blast radii; the only discriminator was whether `offerId` happened to be present.

**Fix.** `event: 'dispatch.assign.revoke_failed'` in the loop's catch — `domain.component.
action_state`, verb + state, as `logging-standard.md:8` specifies and as every other failure site
in this slice already does (`join_failed`, `leave_failed`, `driver_not_claimed`). The payload is
unchanged. The comment that credited `offerId` as the discriminator went with it (it now credits
the event name, which is the mechanism that actually does the work).

**Tests.** `dispatch-notifier.spec.ts:303` updated to the new name, plus a new case *names the
ride-room failure and a revoke failure apart in the log (edge)* where **both** emits throw: two
warns, `dispatch.assign.notify_failed` + `DRIVER_ID` and `dispatch.assign.revoke_failed` +
`REVOKED[0].driverId` + `offerId`. That is the pair the old naming collapsed, so it is the case
that pins the fix.

**Probe — `observed` 2026-09-09.** Event name reverted to `notify_failed` in the source:

```
● …› clears the LATER cards too when one revoke throws (failure)
● …› names the ride-room failure and a revoke failure apart in the log (edge)
Tests: 2 failed, 7 passed, 9 total
```

Restored; re-run: `Tests: 9 passed, 9 total`.

**New failure mode of the fix.** A rename retires the old name for that site: anything keyed on
`dispatch.assign.notify_failed` stops seeing revoke failures. `observed` — the sweep below finds no
alert, dashboard or config keyed on it; the only non-code hit is a historical review document.

## L3 — the barrel re-exported `formatEur` to nobody

**What was wrong.** `apps/driver/src/features/availability/index.ts:3` exported `formatEur` with no
consumer outside the slice, while `format-eur.ts`'s own docblock (corrected in this PR) says the
claim that every consumer routes through here "was never true".

**Fix.** The one line deleted. `format-eur.ts` is untouched, so `apps/driver/CLAUDE.md:34`
("`availability/format-eur.ts` re-exports it") stays true, and so does the docblock — it names
`earnings-body.ts` and `format-eur.test.ts`, both of which import the **file**, not the barrel.

**Test.** None, honestly: there is no behaviour to pin. Deleting a used export is a typecheck
error, so the gate is the proof, together with the grep list below showing no importer.

## N1 — `stop()` / `off()` skipped on a failing run

**What was wrong.** Both detaches were the last statement of a test body, so an earlier assertion
failure skipped them and the listener fired into a closing socket during teardown — noise on
exactly the run whose output you need to read.

**Fix, both sites** (the review's condition — a lone divergence would be worse than the shared
weakness):

- `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts` — body wrapped in
  `try` / `finally { stop(); }`.
- `services/api/src/features/dispatch/dispatch.integration.spec.ts` — the two ticks and their
  assertion wrapped in `try` / `finally { dispatchSock.off(…) }`.

**Test.** None. Proving it needs a deliberately failing integration test, which would have to stay
red to keep proving it; the guarantee is `finally` semantics, and both suites pass unchanged
(`ride-read.integration.spec.ts` and `dispatch.integration.spec.ts` both PASS in the gate below).
Stated rather than dressed up as a regression test.

**What a mechanical re-indent could have broken, checked.** The `finally` now runs the detach on
paths that previously skipped it, so a read of the collected events placed *after* the block would
have been silently reordered against it. `observed` — read back: every use of `seen` / `mine()` is
inside the `try` (`mine` is even declared there), and nothing follows the block; likewise `extra` in
the dispatch spec. No read moved relative to the detach.

## N2 — nothing pins the revoke loop against a throwing `emitStatus` — **won't-fix**

The review filed this explicitly as *not* a request for a third `try`, and that reading holds:
`RideTransitionService.emitStatus` (`ride-transition.service.ts:103-126`) catches its own emit and
fires `notifications.onStatus` as `void`, so it cannot throw. A guard would be error handling for
an impossible state, which root `CLAUDE.md`'s KISS rule rules out. The remaining question — whether
a *spec* case is worth it — is answered no: it would pin a cross-service guarantee from the wrong
side of the seam, and that guarantee is already pinned in `RideTransitionService`'s own spec. Left
as the review recorded it, so the next round does not rediscover the unguarded line.

## N3 — is the live region still heard? — **manual, device day**

`apps/driver/src/features/availability/earnings-card.tsx:17` keeps
`accessibilityLiveRegion="polite"` inside a collapsed `Pressable` that now carries an explicit
`accessibilityLabel`. Not a regression (the collapse predates this PR), and not answerable from a
test — React Native does not announce `accessibilityLabel` changes and a collapsed child is not its
own accessibility node. Added to the device-day check already booked in
`.claude/references/ui-decisions.md` for the two label states.

---

## Numbers and guarantees: the copies sweep

Two claims were retired. Chased by **value** and by **subject**, with the literal commands and
their hits.

**Retired: `dispatch.assign.notify_failed` as the revoke-loop's event name.**

```
$ grep -rn "dispatch\.assign\.notify_failed" --include="*.ts" --include="*.md" .
.claude/code-reviews/pr-82-review.md:29:  … `dispatch.assign.notify_failed` …
services/api/src/features/dispatch/dispatch-notifier.ts:142
services/api/src/features/dispatch/dispatch-notifier.spec.ts:326
services/api/src/features/dispatch/dispatch-notifier.spec.ts:357
```

All three code hits are the **ride-room** site, which keeps the name — correct, not stale. Two of
them are pre-existing (`dispatch-notifier.ts:142` and its assertion at `spec.ts:326`); the third,
`spec.ts:357`, is the ride-room half of the both-throw case **added in this round**, so it is my
own line, not an inherited hit that survived the sweep. `pr-82-review.md:29` is a review of PR #82
describing that PR's tree; historical record, left.

```
$ grep -rn "notify_failed" services/api/src/features/dispatch/
… dispatch.service.ts:369 unclaimed · :407 offer · dispatch-notifier.ts:57 offer · :142 assign
… queue-notifier.ts:48,:87 + spec :104,:123 — all other domains, untouched
```

Subject sweep (the mechanism the old comment credited): the `offerId`-tells-them-apart sentence at
`dispatch-notifier.ts:167-168` was the one copy, and it is rewritten in the same hunk.

**PR body** (no working-tree grep reaches it): it carried the claim *"The per-revoke warn keeps the
event name `dispatch.assign.notify_failed`"*. Now false — **updated in the same push**, naming
`dispatch.assign.revoke_failed` and the review finding that changed it.

**Retired: the `availability` barrel's `formatEur` export.**

```
$ grep -rn "formatEur" apps/driver/src -l
offers/offer-card-props.ts · active-ride/receipt.tsx · active-ride/receipt.test.tsx
availability/format-eur.test.ts · active-ride/active-ride-screen.tsx
availability/earnings-body.ts · availability/format-eur.ts
$ grep -rn "features/availability" apps/driver --include="*.ts" --include="*.tsx" --include="*.md" | grep -i formateur
(no hits)
```

Nothing imported it from the barrel. `format-eur.ts`'s docblock re-read in full: it claims the file
is "THIS slice's import (`earnings-body.ts`), plus the anchor for `format-eur.test.ts`" — both take
the file directly, so the docblock stays true. `apps/driver/CLAUDE.md:34` names the **file**'s
re-export, also still true. Neither edited.

**Test totals moved** (`+1` driver, `+1` api):

```
$ grep -rn "216 tests\|720 tests\|/ 216\|/ 720" .claude docs
(no hits)
```

The only copies are in the PR #163 body — **updated in this push** — and in
`.claude/code-reviews/pr-163-review.md`, which is anchored to head `1403135` and stays as observed
of that commit.

---

## Validation

`observed` 2026-09-09 — full CI-parity gate on the fixed tree, from cleared `dist`, `.next`,
`.turbo` and `tsconfig.tsbuildinfo`:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 \
  pnpm turbo run typecheck lint test build --force
```

| Task | Result |
|---|---|
| Tasks | **22 successful, 22 total**, exit 0, 0 cached, 1m30.096s |
| `@taxi/api` test | ✅ 76 suites / **721 tests**, 0 failed, 0 skipped (was 720 — L2's new case) |
| `@taxi/driver` test | ✅ 41 suites / **217 tests** (was 216 — L1's new case) |
| `@taxi/shared` test | ✅ 24 files / 231 tests |
| `@taxi/rider` test | ✅ 30 suites / 143 tests |
| `@taxi/dispatch` test | ✅ 27 files / 224 tests |
| `@taxi/db` test | ✅ 3 files / 17 tests |
| typecheck · lint · build | ✅ all packages; `@taxi/api` lint `✖ 12 problems (0 errors, 12 warnings)`, all pre-existing `no-unsafe-argument` in integration specs |

`REDIS_TEST_URL` was set, so the 33 Redis-gated tests ran rather than `describe.skip`-ing — 721
total, 0 skipped.

The review's own gate drew a `drivers.integration` supertest flake
(`Parse Error: Expected HTTP/, RTSP/ or ICE/`). It did **not** recur here: that suite passed inside
the full run, so no isolated re-run was needed.

## Closing commands, run against the fixed tree

| Finding | Command | When | Result |
|---|---|---|---|
| L1 | `pnpm --filter @taxi/driver test -- src/features/push/push-registrar.test.tsx` | after the fix | `Tests: 4 passed, 4 total` |
| L2 | `pnpm --filter @taxi/api test -- dispatch-notifier.spec` | after the fix | `Tests: 9 passed, 9 total` |
| L3 | the gate (`typecheck` + `lint` + `build`, all packages) | after the fix | 22/22, exit 0 |
| N1 | the gate's `@taxi/api` run | after the fix | `PASS …/ride-read.integration.spec.ts`, `PASS …/dispatch.integration.spec.ts` |
| N2 | — | — | not run: won't-fix, no change made |
| N3 | — | — | not run: needs a physical device |

Nothing was deferred to a new issue. Two items are open by decision, not by omission: **N2**
(won't-fix, reasoning above) and **N3** (device day, logged in `ui-decisions.md`).
