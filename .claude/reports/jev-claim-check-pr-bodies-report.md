# Implementation Report — Jev claim check for PR bodies (log-only, #302)

**Plan**: `.claude/plans/jev-claim-check-pr-bodies.md`   **Branch**: `feature/jev-claim-check-302` (worktree `~/taxi-worktrees/wt-302`, cut from `origin/main` `96053d0`)   **Status**: COMPLETE

## Summary

`claim-check.mjs` is a dependency-free Node 20 script beside `inherited-figures.sh`. It finds the claim units in a
draft PR body and resolves every `file:line` against `git show HEAD:<path>`. It then asks Jev (`jev-1.13.0`) the
`provenance`, `not_measured`, `worst_case` and `citation` questions, and lists extreme-case claims for
re-derivation by hand with no model. It always exits 0 except on usage (2). The scripts directory is now the
private workspace package `@taxi/pr-scripts`, so the gate runs the offline suite. A 50-row labelled set and its
eval are committed.

## Tasks completed

- Task 1 → `.claude/skills/piv-create-pr/scripts/package.json` (CREATE), `pnpm-workspace.yaml`, `pnpm-lock.yaml` (UPDATE)
- Tasks 2–4 → `.claude/skills/piv-create-pr/scripts/claim-check.mjs` (CREATE)
- Task 5 → `.claude/skills/piv-create-pr/scripts/claim-check.test.mjs` (CREATE)
- Task 6 → `.claude/skills/piv-create-pr/scripts/claim-check-labelled.jsonl` (CREATE, 50 rows)
- Task 7 → `.claude/reports/jev-claim-check-eval-2026-09-29.md` (CREATE)
- Task 8 → `.claude/skills/piv-create-pr/SKILL.md` Phase 2.5 (UPDATE)
- Task 9 → `.claude/skills/piv-review-pr/SKILL.md` "The numbers pass" (UPDATE)
- Task 10 → `CLAUDE.md`: `test/harness.ts:454,541` → `:534,546` (UPDATE; digits only)
- Task 11 → `.claude/skills/piv-validate/SKILL.md:36` (UPDATE)

## Tests added

`claim-check.test.mjs`: 12 offline tests (1–11 as in the plan, plus 10b) and 3 live tests (L1–L3) at `acb3f63`.
The PR #308 fix pass adds 10 offline tests (2b, 4b, 12–18, 16b), so 22 offline at `260e57c`: see
`.claude/reports/pr-308-review-fixes.md`. Round 2's fix pass adds 4 more (19–22), so 26 offline (22 + 4): see
`.claude/reports/pr-308-review-fixes-round-2.md`.

- `pnpm --filter @taxi/pr-scripts test`: `# pass 11`, `# skipped 3`, `# fail 0` (observed, 2026-09-29, head `87987da`); `# pass 12` after 10b.
- `pnpm turbo run test --filter @taxi/pr-scripts --force` (the gate's path, strict env): `# pass 11`, `# fail 0`, `# skipped 3`, `Tasks: 1 successful, 1 total` (observed at `2b04bf6`, before 10b).
- `CLAIM_CHECK_LIVE=1 node --test …/claim-check.test.mjs`: `# pass 14`, `# fail 0` (observed, 2026-09-29, head `eff2aea`).
- **Mutation 1** (the no-key early return deleted): test 7 red, `expected: 0, actual: 1` on the request counter.
  Tests 5 and 6 stayed green (observed).
- **Mutation 2** (the budget timer set to 60 s): test 10 red, `duration_ms: 20154`, output
  `timeout 20 s … Jev unavailable`, so the run waited out the 20 s per-request timeout. Test 8 stayed green
  (observed, after the timer fix below). The first run of this mutation, before the fix, went red at
  **60094 ms**, not ~20 s. That exposed the defect in Deviation D1.
- The new splitter assertion in test 2 goes red when the `*` is reverted (observed).
- **Test 10b** (hanging stub, `TIMEOUT_MS=300`, `BUDGET_MS=20000` → `timeout 0.3 s`, under 10 s) stays **green 3 of 3** with D1 reverted to `AbortSignal.timeout()` (observed). The GC collection needs heap pressure that a 300 ms run does not produce. 10b pins the timeout path, **not** the D1 fix; D1 stands on the `--expose-gc` probe and the first mutation-2 run.

## Validation results

- Level 1: `node --check` passes on both files (observed).
- Task 1: `pnpm ls -r --depth -1` lists `@taxi/pr-scripts` at the scripts path. The dry-run task count is
  **23** (`turbo run typecheck lint test build --dry=json`, tasks with a command, observed at `96053d0` plus
  Task 1).
- Level 2: see Tests.
- **Level 3** (observed): `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 record-gate.sh --clean`
  at `ad27eef`, 2026-09-30T05:50–05:53Z. Exit 0, `Tasks: 23 successful, 23 total`, `0 cached`, `short_gate` false,
  2m46.359s. `@taxi/pr-scripts:test` gave `# pass 12`, `# fail 0` and `# skipped 3`. `tasks_not_in_graph` adds
  `@taxi/pr-scripts#build`, `#lint` and `#typecheck` (legitimate; the package defines only `test`) to the six
  already there. The record's head is the pre-commit `wip:` sha: `piv-create-pr` must re-run the gate at the
  final head.
- Level 4 (observed, head `e2d5733`, live key):
  1. PR #128: the original "`i18n.ts` dropped 454 → 47" sentence is no longer in the published body; only
     the review-fix paragraph quoting it is. 28 units, 5 flagged. That paragraph (L49) got `not_measured`
     0.54 on "16 new keys per language", `provenance` 0.39, and `worst_case` 0.09–0.15.
  2. The scratch body carrying CLAUDE.md's old `test/harness.ts:454,541` sentence: `:454` → `not_established`
     0.79, `:541` → `not_established` 0.99. Neither is `supports`.
  3. A body with no digits and no provenance words, base URL `http://127.0.0.1:9`: `units 0`, no
     "unavailable" note, exit 0.
  4. Dogfood: pending `piv-create-pr`.
- PR #300 live run: 18 units, 45 questions, 4 flagged, 1.0 s wall (observed, head `96053d0` plus the script).
  The closest call the plan's probes predicted (0.40) came out as `provenance` 0.50–0.86 on four mutation
  bullets and their intro. That is the Q7 false-positive signal the 10-PR log is meant to measure.
- Eval (Task 7): 10 of 50 rows (all negatives) carry a question the live selector would never ask; the eval report lists them and recounts in-path. In-path at 0.5: `provenance` P 0.86 / R 1.00, `not_measured` P 1.00 / R 0.50, `worst_case` P 1.00 / R 0.14 (`derived`, arithmetic in the report). All-rows figures: see `.claude/reports/jev-claim-check-eval-2026-09-29.md` (observed, head `b801c7b`, `jev-1.13.0`,
  3.1 s). At 0.5:
  - `provenance`: P 0.75, R 1.00 (6 TP, 2 FP).
  - `not_measured`: P 0.67, R 0.50.
  - `worst_case`: P 1.00, R 0.14 (1 of 7 positives).
  - `citation`: 9 of 12 on the diagonal.
- AC9: `git diff origin/main | grep -ciE "bearer [a-z0-9_-]{20,}"` → `0` (observed).
- Labelled set: `wc -l` 50, `jq` valid, the phone/email grep empty, the MISSING loop empty (observed). Mix:
  - `provenance`: 6 true, 7 false.
  - `not_measured`: 4 true, 7 false.
  - `worst_case`: 7 true, 7 false.
  - `citation`: 5 `supports`, 5 `not_established`, 2 `contradicts`.

## Deviations from the plan

- **D1: the per-request timeout is not `AbortSignal.timeout()`.** Inside `AbortSignal.any()` on Node
  v20.20.2, that signal is garbage-collected and never fires. Observed with a scratch probe under
  `--expose-gc`: 8006 ms until the budget, against a 1000 ms timeout. Mutation 2 also first ran 60094 ms. The
  fix is an `AbortController` per request, aborted by its own `setTimeout` and cleared in `finally`. The budget
  still bounds the total, so AC4 held either way. Without the fix, though, `TIMEOUT_MS` did nothing.
- **D2: the figure detector ignores file names with digits and reference codes** (`L2`, `T11`, `AC1`,
  `pr-300-review-fixes.md`). On PR #300, the planned definition sent 27 units, most of them code labels like
  "Q6 (assumed)" asked `worst_case`. After the change it sent 18.
- **D3: a unit is kept only if its own text has a figure, a provenance word or a citation.** The plan checks
  the provenance word across the sentence, heading, intro and header. Kept literally, every sentence under an
  `observed` heading would be sent, including ones with no figure. The heading, intro and header still decide
  which questions are asked (test 2 pins the #107 header case).
- **D4: the splitter also breaks before `*`** (a bold lead-in like `**L3** —`). Found in Level 4 step 1: a
  `cascade.ts:180-181` citation attached to the wrong sentence. One assertion in test 2 pins it.
- **D5: the `<details>` block also carries the `note:` lines**, so a no-key or failed run is visible in the log.
  The plan listed items 1–4 only.
- **D6: `claim-check.mjs` is 484 lines (`wc -l`, observed at `eff2aea`), against the plan's ≤ 450 target.** `scripts/` is outside `max-lines`.
- **D7: labelled set shortfalls and judgement calls** (from the building agent, spot-checked):
  - `not_measured` true is 4, against a target of ≥ 5. The only other candidate's `observed` label lives in
    `docs/spikes`, outside the allowed sources.
  - Five `worst_case` rows (`w-298-*`, `w-121-*`, `w-139-dark-latency`) take the sentence from a code docblock
    the review cited, which is not on the plan's source list. The verdicts are the reviews'.
  - `m-107-eta`'s label rests on `pr-107-review.md:75`, not on H1 directly.
  - `m-107-views` was added.
  - Rows to eyeball: `p-218-lockfile`, `w-99-throttle`, `w-113-complete-diff`.
  - Several pairs share one review verdict across two questions.
- **D8: exports.** `gitContext` and `questionsFor` are exported beyond the plan's list, for tests 2–4 and L1–L2.
- **D10: test 10b added** (see Tests). It does not pin D1.
- **D11: the eval report gained an in-path recount**, because `--eval` asks every row's question unconditionally and the body check does not. No labels or questions changed.
- **D12: a wrapped list item is one unit.** A plain line right after a list item continues that item. Found by
  dogfooding on this PR's own body: its continuation lines had become separate paragraphs, which split
  sentences mid-clause and set a bogus section intro. Test 2 pins it; the assertion goes red with the fix stashed
  (observed).
- **D13: #302's acceptance edge case (a `derived` figure is not flagged) is pinned only by live test L2**, which
  always skips under the gate because turbo's strict env strips the key. The offline half (`questionsFor` asks it
  `worst_case` only) is not asserted offline either. Found by PR #308's review (L5). It ran green live on
  2026-09-30 in the fix pass.
- **D6 after the PR #308 fix passes**: `claim-check.mjs` is 516 lines at `260e57c` and 521 after round 2's fixes (`wc -l`, observed on each tree).
- **D9: the eval baseline.** The eval ran at `b801c7b`, and the report is committed after it.

## Issues encountered

- **The `.env` copy was blocked by the PreToolUse hook.** Linards copied it by hand, and the gate then ran.
- Several sessions were live in the main checkout, so this work used a worktree from the start.
- Latest migration at base: `db/migrations/0014_redundant_mandroid.sql` (this ticket adds none).
- After merge, the memory file `taxi-pr-figures-gate-scripts.md` ("gate task count … (22)") goes stale. Name
  it in the PR body's reviewer notes.
- `record-gate.sh` is expected to list `@taxi/pr-scripts#typecheck`, `#lint` and `#build` under
  `tasks_not_in_graph`. Those absences are legitimate; name them in the PR body.
