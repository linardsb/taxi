# PR #236 — round-2 review fixes

**Review** [round 2](https://github.com/linardsb/taxi/pull/236#issuecomment-5750803078) (`.claude/code-reviews/pr-236-review-round-2.md`) ·
**Base** `b8d62c58` · **Head reviewed** `0de221f` · **Fixes** `da13602`, `b707e0a` · **Applied** 2026-09-20 ·
Round 1's report: `.claude/reports/pr-236-review-fixes.md`

**All seven applied. Nothing deferred, nothing disputed.** Two corrections beyond the review's list,
both caused by this PR and both found by the sweep rather than by the reviewer.

| # | Sev | Finding | Verdict |
|---|---|---|---|
| M1 | Medium | Four provenance refs broken by this PR's 10-line shift | **Fixed** — and a **fifth** the review missed |
| M2 | Medium | `boardStale` inherited `pill === 'offline'`, blanking the panel while the REST fallback kept the board current | **Fixed** — reproduced first |
| M3 | Medium | The live region announced «Klusē» for a never-streamed driver | **Fixed** |
| L1 | Low | The slice barrel exported the derivation F1 proved insufficient | **Fixed** |
| L2 | Low | The AC #2 test's closing assertion compared two catalog constants | **Fixed** — payoff smaller than the review implied, see below |
| L3 | Low | The empty state asserts current knowledge on a stale board | **Fixed by the comment route**, deliberately — argument recorded in code |
| L4 | Low | "Four atomic commits" does not count the PR's commits | **Fixed by dropping the count**, not by correcting it |

---

## M1 · Five provenance refs, not four

This PR's `3615a9a` adds an import and an expanded re-export docblock to the top of
`driver-location.policy.ts`, shifting every constant down by exactly 10 lines. The review listed four
broken citations. The noun grep it prescribed found a **fifth**, in the same file as two of them.

Base-vs-head, `observed` 2026-09-20 (`git show b8d62c58:…` against the working tree):

| what | base `b8d62c58` | head |
|---|---|---|
| `DRIVER_LOCATION_TTL_SECONDS` | declared `:15` | **not declared here** — re-exported `:25`; declared `packages/shared/src/driver-presence.ts:26` |
| `PRESENCE_DARK_AFTER_SECONDS` | `:30` | `:40` |
| `PRESENCE_SWEEP_INTERVAL_MS` | `:36` | `:46` |
| `OFFLINE_NUDGE_DELAY_SECONDS` | `:42` | `:52` |
| api-only Redis rationale (paragraph) | `:7-14` | `:19-23` |
| `PRESENCE_DARK_AFTER_SECONDS` docblock | `:23-29` | `:33-39` |

Sites corrected, all inside this PR's diff:

1. `docs/runbooks/driver-device-day.md:318` — `:36,42` → **`:46,52`**.
2. `docs/runbooks/driver-device-day.md:320-322` — `(:15,30)` → **`driver-location.policy.ts:40`** for
   `PRESENCE_DARK_AFTER_SECONDS`, and the TTL re-pointed at
   **`packages/shared/src/driver-presence.ts:26`** with the re-export at `:25` named, since moving it
   is this PR's AC #3.
3. `.claude/plans/board-driver-freshness-234.md:29` — `:30,33` → **`:40,46`**. The twin of the site
   round 1's sweep corrected; `:33` was never right, `PRESENCE_SWEEP_INTERVAL_MS` was `:36` even at
   base.
4. `.claude/plans/board-driver-freshness-234.md:179` — the GOTCHA's `:7-14` → **`:19-23` at the head**,
   with the base value kept and labelled so the instruction still reads against the tree it was
   written for.
5. **`.claude/plans/board-driver-freshness-234.md:470` — not in the review's list.** It quotes
   `PRESENCE_DARK_AFTER_SECONDS`'s docblock at `:24-29`; that is `:34-39` at the head, the same +10.
   Verified against both shas before editing, exactly as the other four.

**Closing command, run against the fixed tree** (`observed` 2026-09-20, the noun grep M1 prescribed):

```
grep -rn "driver-location\.policy\.ts:" docs/ .claude/plans/ .claude/reports/ packages/ apps/ services/
```

13 hits. The five above now read `:46,52` · `:40` + `:25` · `:40,46` · `:19-23` · `:34-39`. The
remaining eight are correct or out of scope:

| hit | why it stands |
|---|---|
| `board-driver-freshness-234.md:468` (`:15`) | sha-anchored — *"`observed` at `b8d62c5`"*. The form that survives exactly this move; the review agreed. |
| `board-driver-freshness-234.md:557`, `pr-236-review-fixes.md:162` | round 1's own records of the `:474` correction. **Re-anchored by subject** this round — see *Two corrections beyond the list*. |
| `driver-device-day-prep.md:371` (`:36,42`) | #141's plan, **not in this diff**. Genuinely stale; belongs to that ticket. |
| `driver-app-auth-online-location.md:24` (`:15`) | not in this diff. |
| `dispatch-override-…-phase-c-report.md:319` (`:15`) | historical record anchored to its own head. |
| `pr-218/142/139/121-review*.md` | review records, anchored to their own heads. |

## M2 · Reproduced before fixed, then fixed by reading frame age

**The repro, run against the unfixed code** (`observed` 2026-09-20). The review marked this `derived`;
this makes it `observed`. Pill `offline`, frame **one second** old:

```
npx vitest run --root apps/dispatch src/features/board/dispatch-page.test.tsx

 × DispatchPage — a deaf console … > keeps reading the rows while the REST fallback is current (failure)
   → Unable to find an element with the text: Klusē 01:30
   … rendered: "Nav signāla" ×2, live region empty
 Tests  1 failed | 10 passed (11)
```

Both rows blanked with a board one second old. The mechanism is as the review argued: `pill` goes
`offline` on `!connected && failedAttempts >= OFFLINE_AFTER_FAILURES`, which says nothing about frame
age, and `use-board.ts`'s poll then runs `applyFrame(s, frame, Date.now())` on every success — so
`lastFrameAtMs` is current *because* the pill is offline.

**The fix.** The panel now reads **frame age**, not the banner's condition. `page.tsx` passes
`isPanelStale(nowMs, board.lastFrameAtMs)`; `board-state.ts` gains:

```ts
export const PANEL_STALE_MS = 2 * POLL_MS + STALE_MS;   // 5 000 + 5 000 + 5 000 = 15 000 ms
```

**The window, `derived`, with the bound it has to clear.** `pollBusy` **skips** every interval tick
landing in `(T, T+R]` for a fetch started at tick `T` taking round trip `R`, so the worst gap between
two successful `applyFrame` calls is `POLL_MS × (1 + floor(R / POLL_MS))`. Under the stated condition
— `R` no longer than `STALE_MS` — that is `5 000 × (1 + 1)` = **10 000 ms**, leaving 5 000 ms of
margin under the constant. Coverage holds while `R < 2 × POLL_MS` and fails at exactly
`R = 2 × POLL_MS`, where the gap reaches 15 000 and the comparison is `>=`; an API that slow reads as
stale, which is the safe direction.

**The formula was wrong once before it was right.** It was first written with `ceil`, which
over-states the gap for every non-multiple `R` (`ceil` gives 20 000 at `R = 10 001` where the real
worst case is 15 000) and mis-places the cutoff. Corrected against a direct simulation of the tick
schedule rather than by re-reading the algebra (`observed`):

| `R` | simulated worst gap | `floor` formula | `ceil` formula | blanks (`>= 15 000`) |
|---|---|---|---|---|
| 4 999 | 5 000 | 5 000 | 10 000 | no |
| 5 000 (`= STALE_MS`) | **10 000** | 10 000 | 10 000 | no |
| 9 999 | 10 000 | 10 000 | 15 000 | no |
| 10 000 (`= 2 × POLL_MS`) | **15 000** | 15 000 | 15 000 | **yes** |
| 10 001 | 15 000 | 15 000 | 20 000 | yes |

The review **prescribed no window** — it named two directions and declined to pick, so nothing here is
a rejected suggestion of its own.

**What a 15 s lag costs the signal.** `lastSeenAt` is the api's clock and does not move when the frame
does, so a late frame can only make the panel **under**-report freshness — «Klusē» for a driver who has
since reported, never «Raida» for one who has not. Worst case a row flips to «Klusē» up to 15 s late,
inside the 75 s the sweeper takes to drop the driver anyway.

**The new failure mode this mechanism introduces**, per the Critical/High discipline (M2 is a Medium,
but it is this round's riskiest edit): the panel no longer notices a **dead socket with a dead poll** —
if `fetchSnapshot` fails silently (`!res.ok` returns early by design) the only thing that catches it is
frame age crossing 15 s. Pinned by `isPanelStale(NOW, NOW - PANEL_STALE_MS) === true` and by the
page-level case at 16 s. The `!browserOnline` arm is covered the same way: no poll succeeds, so the
frame ages out.

**Tests.** One page-level regression (the repro above, now green) and three `isPanelStale` unit cases —
expected / edge / failure — asserted against `POLL_MS`, `STALE_MS` and `PANEL_STALE_MS` rather than
against digits, so they move with the constants. The edge case pins the **gap** itself:

```ts
expect(isStale(NOW, NOW - STALE_MS)).toBe(true);        // banner has given up
expect(isPanelStale(NOW, NOW - STALE_MS)).toBe(false);  // panel has not
```

**One existing fixture moved.** `'shows «Nav signāla» … once the board is stale (failure)'` used
`lastFrameAtMs: NOW - 6_000`, which is past `STALE_MS` but inside `PANEL_STALE_MS` — it would now be
asserting the gap rather than the deaf console. Bumped to `NOW - 16_000`, past both, with the reason in
the comment. Its intent is unchanged and it still reddens if the thread is cut.

**Five prose sites asserted the old union and were swept with it** — the class this repo keeps missing:

| site | was |
|---|---|
| `page.tsx`, JSX comment above `<DriverList>` | *"the SAME condition the banner renders on … reduces to `pill === 'offline' \|\| isStale(…)` exactly"* |
| `driver-list.tsx`, prop docblock | *"`page.tsx`'s `showStaleBanner`"* |
| `driver-list.tsx`, `rowFreshness`'s `boardStale` paragraph | no mention of which condition |
| `driver-list.tsx`, "SILENT WHILE THE BOARD ITSELF IS STALE" | *"the console's own dead socket"* — now *"frame gap"*, since a dead socket is no longer sufficient |
| plan `:501`'s SUPERSEDED note | *"The panel now takes `boardStale` (the same condition the stale banner renders on)"* |

The plan note is **amended, not rewritten** — round 1's correction is kept and a round-2 amendment
records why its last clause stopped being true.

## M3 · One catalog string, three files, scoped exactly as prescribed

`console.drivers_silent_summary` names every driver whose freshness is `!== 'live'` — `stale` **∪**
`unknown` — and used the stopped-streaming word for both. The row refuses to: an `unknown` driver reads
«Nav signāla». Round 1's F1 is what made this routine rather than a deploy ghost.

| catalog | was | now |
|---|---|---|
| `lv.ts` | `Klusē: {names}` | **`Nav datu: {names}`** |
| `ru.ts` | `Молчат: {names}` | **`Без данных: {names}`** |
| `en.ts` | `Silent: {names}` | **`Not reporting: {names}`** |

`console.driver_silent` («Klusē {age}») is **untouched** — the review warned that a `Klusē` grep
sweeping both would undo round 1's F4/F5/F10 runbook wording.

**Closing command, run against the fixed tree** (`observed` 2026-09-20). A grep alone would not have
caught this, because the dispatch app resolves `@taxi/shared` from **`dist`** — so it was run through
the rebuilt package:

```
pnpm --filter @taxi/shared build
node -e "…formatMessage(l,'console.drivers_silent_summary',{names:'Jānis, Anna'})…"

lv summary = "Nav datu: Jānis, Anna"   row = "Klusē 01:30" | "Nav signāla"
ru summary = "Без данных: Jānis, Anna"  row = "Молчит 01:30" | "Нет сигнала"
en summary = "Not reporting: Jānis, Anna" row = "Silent for 01:30" | "No signal"
```

Retired-value sweep, `observed` at the same head:

| grep | hits |
|---|---|
| `grep -rn "Klusē:" docs/ .claude/plans/ apps/ packages/shared/src` | 1 — the plan's AMENDED note quoting the old value. Correct by design. |
| `grep -rn "Молчат:\|'Silent:" packages/shared/src apps/ docs/ .claude/plans/` | same single note. |
| `grep -rn "drivers_silent_summary':" packages/shared/src` | 3, all the new values. |

No code change and no test change, as the review predicted: the four assertions referencing the key
build their expectation through `formatMessage` and follow the catalog. **Verified rather than
assumed** — the board specs were re-run *after* rebuilding `@taxi/shared`, because before the rebuild
both the component and the test were reading the same stale `dist` and would have stayed green on a
change that had not landed.

The plan's two copies moved with it: the catalog table (with an AMENDED note quoting the old row) and
the breadboard's «Nav datu: Jānis, Anna».

## L1 · Two tokens dropped from the slice's front door

`index.ts` published `driverFreshness` and `DriverFreshness` — the derivation F1 proved insufficient —
while `rowFreshness`, the one that refuses «Raida» without evidence, stayed module-private.

**Verified before deleting** (`observed`): every hit of either symbol across `apps/dispatch/src`,
`packages/shared/src` and `services/api/src` outside the board slice is a single **prose** mention in
`packages/shared/src/driver-presence.ts:13` — no import. Inside the slice, both consumers
(`driver-list.tsx:11`, `board-state.test.ts`) import from `./board-state`, reaching past the barrel.
Zero consumers, so the removal cannot break the suite; the gate's `build` is what proves it.

`index.ts:1-3`'s *"the /dispatch page composes exactly these"* is now true. `isPanelStale` is added in
the same edit and **is** composed by the page.

## L2 · The tautology is gone — and its replacement's payoff is smaller than the review implied

The assertion compared two `formatMessage` calls to each other. **Vacuity proved, not argued**
(`observed` 2026-09-20): the same two lines in a spec that renders nothing at all pass.

```
✓ L2 probe — the replaced assertion with no component on screen > passes without rendering DriverList at all
 Tests  1 passed (1)
```

Replaced with a read of the rendered rows — the freshness span is each row's last child, and both
fixtures share a zone name, so losing the span makes the two equal and reddens the case.

**The honest limit, run rather than claimed.** Probed the replacement against the defect the review
named — both states rendering the same label (`FRESHNESS_KEY[freshness]` → `FRESHNESS_KEY['live']`):

```
× DriverList > distinguishes silent from reporting in TEXT, not colour alone (failure)
  AssertionError: expected '…Klusē: AnnaJānis+37129999001CentrsRaidaAnna+37129999002CentrsRaida'
                  to contain 'Klusē 01:30'
  ❯ driver-list.test.tsx:147   ← the toContain line ABOVE it, not the new assertion
 Tests  7 failed | 5 passed (12)
```

The case does redden, but on the `toContain` line that was already there; the new assertion never runs.
So the fix buys **non-vacuity, not new coverage** — the third line now does real work instead of none,
and per-row discrimination is separately covered by the first case in the file. Recorded this way
rather than credited with a payoff it does not have (`taxi-review-payoffs-are-claims`).

## L3 · Comment route, with the argument that makes it sound

The review offered two answers and called the comment legitimate. Taken — but only after checking that
**M2 did not break its premise.** The old argument was *"the banner is on screen by construction,
because `boardStale` **is** `showStaleBanner`"*. That identity is gone. The subset relation survives it:

> `boardStale` is `isPanelStale` (15 s); the banner is `isStale` (5 s) or «Bezsaistē». Frame age ≥ 15 s
> implies frame age ≥ 5 s, so **`boardStale` ⟹ banner**, strictly.

So the caveat is still guaranteed beside the empty string, and the heading's `(0)` with it. The comment
states the relation and names the condition under which it stops holding — if the banner's condition
ever narrows, the string needs the guard. A fourth catalog string would restate what the banner says.

## L4 · Count dropped, not corrected

The body said "Four atomic commits"; the PR had 7. **Correcting it to seven would be wrong by
construction** — this round's own commit changes the number, which is `taxi-report-restating-pr-body-figures`
exactly. Took the review's second option: the count is gone and the three groups stay.

## Two corrections beyond the review's list

Both caused by **this round's own edits**, found by re-running the sweep rather than trusting it.

1. **My M3 and M2 plan edits moved the plan's line numbers, staling two references to them.** Plan
   `:557` and `pr-236-review-fixes.md:162` both cited *"`:474`'s 75 s derivation"*; the M3 amendment
   pushed it to `:476`. Re-anchored **by subject** (*"§D2's 75 s derivation"*) rather than by new
   digits, so the next edit cannot re-stale them. This is the third time in this PR's history that a
   line ref moved under a correction.
2. **Round 1's S3 grep row lists plan line numbers that this round moves.** `pr-236-review-fixes.md:150`
   records a grep's hits at `0de221f`. The record is kept (rewriting it would falsify a run) and
   labelled as round-1-head-relative, with a pointer to this round's re-run.

## Validation

`observed` 2026-09-20, worktree `/Users/Berzins/Desktop/taxi-wt-234` on `feature/board-driver-freshness-234`.

Board specs, after rebuilding `@taxi/shared` so the catalog change is actually exercised:

```
npx vitest run --root apps/dispatch \
  src/features/board/board-state.test.ts \
  src/features/board/driver-list.test.tsx \
  src/features/board/dispatch-page.test.tsx

 Test Files  3 passed (3)
      Tests  45 passed (45)
```

45 = 22 + 12 + 11, against round 1's 19 + 12 + 10 = 41. **+4**: three `isPanelStale` cases and one M2
page-level regression.

**Full gate**, `observed` 2026-09-20, same worktree, containers `taxi-db-1` / `taxi-redis-1` up.
**Run twice** — once at `da13602` and again at `b707e0a` after the `floor`/`ceil` correction, rather
than asserting a comment-only commit could not move it:

```
env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force

at da13602:   Tasks: 22 successful, 22 total   Time: 1m24.914s   EXIT=0
at b707e0a:   Tasks: 22 successful, 22 total   Time: 1m17.326s   EXIT=0
```

Every per-package total below is byte-identical across the two runs. Wall time differs by 7.6 s —
machine load, not a signal.

| check | result | vs round 1 |
|---|---|---|
| typecheck · lint · test · build (22 tasks) | ✅ 22/22, exit 0 | same |
| `@taxi/api` | ✅ 2 skipped, 75 passed suites · 39 skipped, 694 passed, 733 total | **identical** — the catalog and board edits touch no api test |
| `@taxi/dispatch` | ✅ 28 files, **250 passed** | 246 → 250 (**+4**, this round's) |
| `@taxi/shared` | ✅ 24 files, 231 passed | **identical** — the catalog change adds no test, as expected |
| `@taxi/driver` | ✅ 44 suites, 250 passed | same |
| `@taxi/rider` | ✅ 30 suites, 145 passed | same |
| `@taxi/db` | ✅ 3 files, 17 passed | same |

The 39 skipped are the documented Redis-gated suites with `REDIS_TEST_URL` unset, matching CLAUDE.md's
baseline. No suite flaked; no re-run needed. Wall time differs from round 1's `2m22.845s` — machine
load, not a discrepancy; task count and every per-package total are exact.

`max-lines` 500 re-checked after this round's additions (`observed`): `driver-list.tsx` 315,
`board-state.ts` 308, `page.tsx` 350, `index.ts` 11, `driver-presence.ts` 26. All clear.

## Not fixed here, and why

- **`.claude/plans/driver-device-day-prep.md:371`** carries the same `:36,42` M1 corrects, but belongs
  to **#141** and is not in this diff. Genuinely stale; it needs #141's own pass.
- **Both of this PR's review reports** (`.claude/code-reviews/pr-236-review.md` and
  `-round-2.md`) are untracked in the **main** checkout and ride on no branch —
  `taxi-pr-review-report-location`'s orphan case. Correctly placed (not in the PR's worktree, so the
  author's commits cannot sweep them into the PR they review), but they still need a `docs/` PR to
  land. Out of scope for a fix pass; flagged rather than silently folded in.
