# PR #110 review — `feat(api): make mint:ride's unquantized counterfactual measurable (#108)`

**Branch** `feature/mint-ride-sub-cell-jitter` → `main` · 7 files, +1794/−67 · state OPEN
**Reviewed in** the worktree `/Users/Berzins/Desktop/taxi-jitter`, fresh context, with the `code-reviewer`
agent doing the deep diff pass.

## Verdict

**Approve after the fixes on this branch.** The mechanism is right and well argued: per-poll jitter derived
from `COORD_PRECISION`, a second pass through the *same* `MAPS_PROVIDER_ETA` instance with quantization
replaced by identity, pass A frozen and asserted before pass B exists, and the corridor-distinctness check
read from the hashes the provider emitted rather than recomputed script-side. Nothing was broken on the
default path.

What the review found was a cluster in exactly the area the ticket is about — **which figures may wear which
tag, and which claims survive their own edit**. Fourteen findings, no Critical, no High in the code; the two
that matter most are a *derived* ratio printed as `[observed]`, and an env-var typo path that prints a
fabricated attribution above a green `PASS`. Twelve are fixed on this branch (commits below) and re-validated.
Two are left open for the author: a restructure that is not a review fix (D1), and a rules-file line outside
this PR's subject (D2).

| Severity | Found | Fixed on branch |
|---|---|---|
| Critical | 0 | — |
| High | 1 — A1, a false compliance claim in the PR body | ✅ |
| Medium | 7 — A2–A8 | ✅ |
| Low | 4 — A9–A12 | ✅ |
| Open, needs the author's call | 2 — D1 file length, D2 `CLAUDE.md:46` | ❌ flagged |

---

## AGENT FIXES — applied on this branch, gate re-run green

**A1 · High · `.claude/reports/mint-ride-sub-cell-jitter-report.md:233` (was) + PR body Notes #5 — "AC #9 is
met as written" is false.** AC #9 reads *"Level 4 steps 1-6 all pass, with **step 5's result** (pass B = 6,
1×) recorded in the report as the control it is"* (`.claude/plans/mint-ride-sub-cell-jitter.md:836-837`). It
pins the figure to **step 5's result**, and step 5's result is R3's pre-spend refusal — as the report itself
correctly argues. The `6 / 1×` that was observed came from `MINT_POLLS_PER_CELL=1`, a different run. A correct
figure filed under the wrong subject is the shape of the #107 defect this ticket exists to close, reproduced
in the artifact that closes it. → AC #9 now declared **met with an amendment**, with the amendment recorded in
the plan's `AMENDMENTS` and the reasoning kept intact in Deviations #5.

**A2 · Medium · `services/api/scripts/mint-tracked-ride.ts:1140-1145` — the ratio wore an `[observed]` tag.**
The two counts are observed; the ratio is arithmetic on them, i.e. `derived` under CLAUDE.md's taxonomy — and
it was the one figure in the block showing no arithmetic. → `reduction 5× = 30 ÷ 6 … [derived — pass B ÷
pass A]`.

**A3 · Medium · `mint-tracked-ride.ts:1130` — `unquantized cost 30 = 6 cells × 5 polls [observed — pass B]`
merged an observed count with a derived identity under one tag.** `reportSummary` runs *before*
`assertUnquantizedInvariants`, so a short pass B would have printed the false equation `29 = 6 × 5`, tagged
`[observed]`, directly above the assertion that catches it. (Pass A has no such gap — its assertions run
first.) → count and expectation now on separate lines with separate tags.

**A4 · Medium · `mint-tracked-ride.ts:1136-1145` — the grid attribution was printed unconditionally.** At
`MINT_POLLS_PER_CELL=1` there is no jitter (`jitterSteps(0) = 0`), both passes key the identical corridor set,
and the 1× is an identity. The report conceded this in prose while the script printed "attributable to #87's
ETA grid" anyway. → the clause is withheld below 2 polls per cell, and the run says why.

**A5 · Medium · `mint-tracked-ride.ts:128-129, 453-464` — degenerate `MINT_CELLS` produced a fabricated
attribution behind a green `PASS`.** `MINT_CELLS=0`, or any non-numeric value (`NaN` passes every `>`
comparison), walked no cells: the positive control lives inside the loop and never fired, both assertion halves
passed on empty sets, and the summary printed `reduction 0×` under `[observed]` followed by `PASS`. → a named
refusal for both counts, before any spend. Observed: `MINT_CELLS=0` and `MINT_CELLS=abc` both refuse before
`── actors ──`, costing no OTP request.

**A6 · Medium · `mint-tracked-ride.ts:75-91` — the deep-import comment asserted something this PR made false**
("the geo barrel exports only the DI tokens" — it exports `COORD_PRECISION` as of this PR, and the new spec
case imports it from there). The script alone still reached past the barrel. → `COORD_PRECISION` now comes
through `'../src/features/geo'` (`:88`), and the sanctioning comment is narrowed to the two key builders that
genuinely are not on the barrel.

**A7 · Medium · `mint-tracked-ride.ts:160` — the pin `mint-tracked-ride-dev-script.md:297` was stale, broken
by this PR's own amendment.** The +2-line Forward-references edit moved the ±0.0004° GOTCHA to line 299; 297 is
now an unrelated GOTCHA. Same failure `bea4222` just landed a fix for. → cited by its text, here and at the
two matching spots in the plan (`:92-93`, `:145`, `:316`).

**A8 · Medium · `.claude/plans/mint-ride-sub-cell-jitter.md:771` (was) — an inherited, wrong short-gate
figure.** "five Redis-backed suites `describe.skip`", copied from `CLAUDE.md:46` without re-derivation — the
inheritance failure CLAUDE.md's own rule names, committed inside the ticket about that rule. Measured by this
review: **2 suites / 24 tests**. → corrected in the plan with the measurement, and the report's "the documented
short-gate (24 tests skipped)" — which called the observation and the document the same thing — reworded.

**A9 · Low · `mint-tracked-ride.ts:180, 518, 1163-1168` — `±maxSteps`, and a `0.0005` literal.** For an even
`POLLS_PER_CELL` the offsets are lopsided (8 polls → −3…+4), so `±4` overstated the negative excursion in both
the boot log and the summary. Separately, the half-cell was a literal in two printed strings, in the ticket
whose jitter step is deliberately *derived and never a literal*. → `HALF_CELL_DEG` derived from
`TRACKING_ETA_GRID_DECIMALS` (`:180`), and both surfaces now say "furthest offset" and print the real offsets.

**A10 · Low · `mint-tracked-ride.ts:1172` and `:472` — two figures that named the wrong thing.** The dev-spend
line said "36 route calls" while the same summary counts a paid `quote` call four lines earlier (it is 37); and
the poll-budget line said "+ 1 page load" for a request the restructured `walkCell` does not make. → 37 with
the quote broken out; "(+1 head-room)".

**A11 · Low · `mint-tracked-ride.ts:355, 947` — `CellRow.location` was dead** (assigned, never read; dead since
#107). → removed.

**A12 · Low · `.claude/reports/mint-ride-sub-cell-jitter-report.md:222` and `:89` — two counts were off by
one.** "OTP budget actually spent: 5 of 5" enumerated five runs
but the report transcribes six (the `MINT_POLLS_PER_CELL=1` edge run is missing from the list), which cannot
fit one 5-per-hour window; and "`identity function` survives in exactly three places" missed a fourth
occurrence that is **line-wrapped**, so `grep "identity function"` skips it — the "grep the noun, not the
sentence form" hazard, tripped inside the ticket that cites it. → both recounted, with the reason each was
missed recorded rather than quietly corrected.

---

## HUMAN DECIDES

**D1 · `services/api/scripts/mint-tracked-ride.ts:1-1414` — the file is 1414 lines against CLAUDE.md's ~500
line rule.** Pre-existing (~899 before #108), worsened by roughly half again here, and the rule is
unconditional. The file has three clean seams: the jitter geometry and its guards, the run itself, and the
report/assertion halves. **Not fixed** — a split is a restructure with its own review surface, not a review
fix, and it is your call whether `scripts/` gets an explicit exemption instead. Leaving it undiscussed is the
one option this ticket's own standards argue against.

> **RESOLVED — #112, 2026-08-14 (B-broad).** Decided cold, on a closed ticket with no PR open. The rule now
> binds *shipped source* — what each package's build compiles — and specs, `test/`/`tests/` and `scripts/` are
> outside it and uncapped; it is enforced by `max-lines: ['error', { max: 500 }]` — effective in all five
> packages that run eslint, via the shared base for `services/api`/`db`/`packages/shared` and restated in
> `apps/dispatch`/`apps/admin`, which do not consume it — rather than by a reviewer's judgement. **The file
> is unchanged at 1414 lines**, and is now compliant by amendment, not by edit.
> On the split this finding proposed: the three seams are real — they land on the
> file's own section banners — but they do not reach compliance. `observed` (banner line numbers,
> `grep -n "^// ─"` at `origin/main` `085ef88`): jitter geometry + guards `102–208` = **107** lines,
> report + assertions `1047–1346` = **300** lines. Remainder is `derived`: `1414 − 107 − 300` = **1007**
> lines left in one file, still 2.0× the cap. A compliant split needs ~5 files, since `main()` alone is
> 348 lines. See `.claude/plans/file-length-rule-shipped-source.md` for the full decision record — including
> the residual risk this accepts: nothing now bounds the script's growth, and the review agent is explicitly
> told not to flag it for length.

**D2 · `CLAUDE.md:46` — "a green gate can be five tests short" is stale.** Measured: 2 suites / 24 tests. It is
outside this PR's subject (the rules file is not part of #108), so it is flagged rather than edited here. It
wants a one-line docs commit — and it is the upstream source of A8, so fixing it stops the next ticket
inheriting the same wrong number.

---

## HUMAN READS

**R1 · `mint-tracked-ride.ts:1130-1152` — the headline block.** This is the deliverable of the whole ticket and
it is the surface the review changed most. Read it against the run output pasted in the report: two
`[observed]` counts, one `[derived — asserted below]` expectation, one `[derived — pass B ÷ pass A]` ratio, and
an attribution clause that is present only when the run can earn it.

**R2 · `mint-tracked-ride.ts:453-464` — the new degenerate-input guard.** It is the only *behaviour* the review
added (everything else is print text or an import). Confirm the bound is where you want it: it refuses
non-positive-integer `MINT_CELLS`/`MINT_POLLS_PER_CELL`, and `POLLS_PER_CELL = 1` is deliberately still
*allowed* as a smoke run, with the attribution suppressed rather than the run refused.

**R3 · `mint-tracked-ride.ts:1279-1345` (`assertUnquantizedInvariants`) — the wrong-target detector.** Not
changed by the review, but it is the load-bearing claim of the PR: it reads the `cell` hashes the provider
emitted, and it correctly documents its own two blind spots (a `routeCacheKey` that drifts for *both* passes,
and vacuity at one poll per cell).

---

## HUMAN TESTS

**T1 · Re-run `pnpm --filter @taxi/api mint:ride` at the default once the OTP window clears.** The default-path
summary block in the report was observed at 11:43, *before* A4 (the conditional attribution) landed. On the
`POLLS_PER_CELL >= 2` branch the template concatenates to a byte-identical string, so the block is argued
identical rather than re-observed — a confirming run was attempted and refused by
`OTP_MAX_REQUESTS_PER_HOUR` (`too_many_requests`), the instrument's own ceiling doing its job. This is the one
figure on the branch that is not `observed` under the current commit, and it is stated as such in the report.

**T2 · Idempotence, once, after T1.** The review's runs left warm corridors; the report's step-3 idempotence
control was run against the pre-review code. It should still hold (both clears are unchanged) but it is the
only place a missed clear ever surfaces.

---

## FYI

- The `heading:` block moved **byte-identical** out of the old `report()` into `reportSummary` — verified
  against `git show 4964ab0`. Nothing was silently edited while the function was split.
- Every `notifications.policy.ts` citation resolves and every quoted figure re-derives: `:34` (coarseness),
  `:41-46` (anisotropy, ~2× at 12 polls/min), `:49` (±10–20 m GPS); 111.3/417 = 16.0 s N/S, 60.6/417 = 8.7 s
  E/W, 7.66 s at 61.4° off north, 8.9 s uniform. `tracking.service.ts:125` and `:192` also resolve.
- No new cross-slice violation: `notifications` already imports the `geo` barrel
  (`notifications.module.ts:5`, `tracking/tracking.service.ts:23`), so the new spec case follows the existing
  shape rather than opening a door.
- Housekeeping, untouched: the main checkout `/Users/Berzins/Desktop/taxi` holds a stray untracked copy of
  `.claude/plans/mint-ride-sub-cell-jitter.md` on `feature/dev-env-redis-doc`. Another session's tree — left
  alone, mentioned so it does not get committed there by accident.

---

## Validation — run by this review, not inherited from the PR body

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force`, `REDIS_TEST_URL` set, from the worktree, before the fixes | **21/21 tasks, 0 cached · 54 suites / 462 tests** — matches the PR body exactly |
| Same gate, after the fixes | **21/21 tasks, 0 cached · 54 suites / 462 tests** |
| Same, **without** `REDIS_TEST_URL` | 2 suites skipped, 24 tests skipped, 438 passed — the short gate, measured (this is A8) |
| `pnpm --filter @taxi/api typecheck` / `lint` after the fixes | clean · 0 errors, 7 pre-existing spec warnings |
| `MINT_CELLS=0` / `MINT_CELLS=abc` | refused by name before `── actors ──`; no OTP spent (this is A5) |
| `MINT_POLLS_PER_CELL=10` | refused at the jitter guard; no OTP spent |
| `mint:ride` default (`6 × 5`) | `PASS` · 6 / 30 / 5× · table, hashes and offsets identical to the implementation round |
| `mint:ride` at `MINT_POLLS_PER_CELL=1` | `PASS` · 6 / 6 / 1× with the "NOT attributable to anything" caveat printed (this is A4) |

Run against docker Postgres by LAN IP and Redis on 6381, `COMPOSE_PROJECT_NAME=taxi`, in the worktree — no
other gate was live (checked before starting; three other worktrees exist).

## What is good, and worth keeping as pattern

- **Ordering as the mitigation, not discipline.** Pass A's count is frozen before `unquantizedPass` exists;
  every downstream figure arrives as an argument; `passBEvents` is sliced at the frozen length. A later edit
  cannot reach a cumulative read, rather than being merely discouraged from it.
- **Failing in the flattering direction *before* paying.** The pre-spend corridor-distinctness check refuses
  the pass rather than letting it under-report, and the error names both causes.
- **Reading the provider-emitted `cell` hash** instead of recomputing the key script-side, with the reason
  stated: a recomputation only proves the script agrees with itself.
- **The report recording that R3 made the plan's own step-5 prediction unreachable**, instead of quietly
  rewriting the prediction. That honesty is what made A1 a wording fix rather than a discovery.

---

**Posted on the PR. A human now reviews the code + this review and merges.**
