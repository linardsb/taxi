# PR #196 — review fix pass (round 1)

**Review** the round-1 comment on the PR — https://github.com/linardsb/taxi/pull/196#issuecomment-5653012419 — and
`.claude/code-reviews/pr-196-review.md` on branch `docs/pr-196-review` (not in this branch's tree)
**Reviewed head** `a35d339` · **Fix commits** `7aa91ae` (F6, comments in two test files) and this file's own
commit (F1–F5, `.claude/reports/` only) · **Base** `main` @ `d5bbea1`
**Worktree** `/Users/Berzins/taxi-worktrees/wt-193` · **Ran** 2026-09-13

## Verdict

All six findings fixed, including the **HUMAN DECIDES** item (F6), taken with the reviewer's own wording: it
only weakens a claim, which is the safe direction for a comment, and it is one commit to revert. The three
FYIs are noted, not fixed. Nothing was dropped as noise.

One stale reference the review did not list turned up in the sweep: the PR body's *Notes* cited
`api-gate-flake-193-report.md:80` for the "bind count `3`" row, which is `:81`. Corrected with the rest.

Every closing command below was run against the fixed tree before its sentence was written; each quotes the
command, the sha or time, and the output.

## Gate

`observed` — `record-gate.sh --clean` at `7aa91ae`, `COMPOSE_PROJECT_NAME=taxi`,
`REDIS_TEST_URL=redis://localhost:6381`, 12:47:40–12:49:21 local on 2026-09-13, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m38.707s
```

    @taxi/dispatch  Test Files 27 passed (27)
    @taxi/dispatch  Tests 224 passed (224)
    @taxi/driver  Test Suites: 41 passed, 41 total
    @taxi/driver  Tests: 218 passed, 218 total
    @taxi/rider  Test Suites: 29 passed, 29 total
    @taxi/rider  Tests: 140 passed, 140 total
    @taxi/db  Test Files 3 passed (3)
    @taxi/db  Tests 17 passed (17)
    @taxi/shared  Test Files 24 passed (24)
    @taxi/shared  Tests 231 passed (231)
    @taxi/api  Test Suites: 77 passed, 77 total
    @taxi/api  Tests: 724 passed, 724 total

Counts identical to the `5aa4159` run in `pr-194-review-fixes.md`, as expected: `7aa91ae` changes comment
text only (`observed`, `git diff --numstat a35d339 7aa91ae`: `4 4` in `payments.integration.spec.ts`,
`2 2` in `test/harness.ts`). This file's own commit is docs-only and lands after the run.

## Fixed

### F1 — Medium · the `.listen(` sweep was stamped on a tree it did not describe

`pr-194-review-fixes.md:266-280` (was `:253-261`). The block listed three calls under
`observed` at `0df5e51`, with pre-comment line numbers; that tree has four.

**Fix** — re-run at `a35d339` and stamped there; four lines pasted; a sentence names the missing call
(`test/app.e2e-spec.ts:22`, this PR's own F8) and why the old line numbers were off.

Closing command, 2026-09-13 12:47 local — `git grep -n "\.listen(" 7aa91ae -- 'services/api/*.ts'`:

```
services/api/scripts/mint-tracked-ride.ts:434:    await app.listen(0, '127.0.0.1');
services/api/src/main.ts:21:  await app.listen(env.API_PORT);
services/api/test/app.e2e-spec.ts:22:    await app.listen(0, '127.0.0.1');
services/api/test/harness.ts:570:  await app.listen(0, '127.0.0.1');
```

The same four lines at `a35d339`, the sha the block is stamped with (`observed`, same command).

### F2 — Medium · "already covered" retracted

`pr-194-review-fixes.md:92-99` (was `:84-87`) and the PR body, *Notes for the reviewer*.
The claim that `src/test-harness.spec.ts:55` catches an `address()` read inserted between `init()` and the
listen was false: `:55` runs after `createTestApp` has returned, by which point `harness.ts:570` has listened.

Reproduced twice before the retraction was written, at `a35d339` and again at `7aa91ae`, by inserting
after `await app.init();` in `test/harness.ts`:

```
const probeAddress = (app.getHttpServer() as { address(): unknown }).address();
console.log(`PROBE address() between init and listen = ${JSON.stringify(probeAddress)}`);
```

`COMPOSE_PROJECT_NAME=taxi npx jest src/test-harness.spec.ts`, both runs:

```
PROBE address() between init and listen = null
Tests:       3 passed, 3 total
```

Probe reverted with `git checkout -- test/harness.ts`; `git status --porcelain` empty before the gate ran.

**Fix** — both places now say: not covered by a test; the comment at `harness.ts:568-569` is the only guard,
acceptable for a developer-error path; the "no `listen` at all" tree under F3 is a different tree.

Closing: `grep -n "No new test needed\|already covered" .claude/reports/pr-194-review-fixes.md` → 1 hit,
`:14`, the header note naming the retracted phrase. Body: 1 hit, `:38`, the *What changed* bullet
naming it. Neither is the claim.

### F3 — Low · `file:line` figures that described a different tree, and a miscount

| Where (now) | Was | Is | Checked against |
|---|---|---|---|
| `pr-194-review-fixes.md:26`, `:123`, `:259`; PR body `:101` | `api-gate-flake-193-report.md:80` | `:81` | `sed -n 81p` = the "no `listen` at all — pre-fix" row |
| `:142`, `:262` | `api-gate-flake-193-report.md:241` | `:275` | `grep -n "The branch was renamed"`; the file gained six lines above it in this pass (F5), which is why it is not the review's `:269` |
| `:103` | `payments.integration.spec.ts:66-70` | `:67-71` | `git show 7aa91ae:…payments.integration.spec.ts \| sed -n 67,71p` = the five comment lines |
| PR body *What changed*; `:184` | `mint-tracked-ride.ts:432` | `:434`; `:184` keeps `:432` in a "before the comment above it grew" clause | the sweep under F1 |
| `:28-30` | "four more stale sites … `:159`, `:245`, `:263` and `:307`" | "two more … `:159` and `:245`"; `:263`/`:307` (today's `:290`/`:334`) named as kept | `git diff d5bbea1 a35d339 -- docs/issues/issue-193.md`: hunks at `:159`, `:245`, `:257`, `:269→:296`, `:305→:332`; none at `:263` or `:307` |
| `:178-179` | kept list `:257` and `:290` | `:257`, `:290` and `:334` (`g02`) | `sed -n 334p docs/issues/issue-193.md` reads "**19** binds — 17 plus the two extra apps" |

The last row goes one past the review: F6's kept-list omitted `:334`, the third run record that keeps its `17`.

### F4 — Low · `build` does not cover `scripts/`

`pr-194-review-fixes.md:188-190`. `services/api/tsconfig.build.json` excludes `scripts`;
`typecheck` (`tsc --noEmit`, no `include` in `tsconfig.json`, so the whole directory) and `lint`
(`{src,test,scripts}/**/*.ts`) cover it.

Closing: `git show 7aa91ae:services/api/tsconfig.build.json | grep exclude` →
`"exclude": ["node_modules", "test", "dist", "scripts", "**/*spec.ts"]`.
`grep -n 'and \`build\` cover' .claude/reports/pr-194-review-fixes.md` → 0.

### F5 — Low · the commits-after-gate sentence

`pr-194-review-fixes.md:60-64`; `api-gate-flake-193-report.md:138-142` (a new
paragraph — the file had no such sentence, only the stamp, so the provenance was silent rather than wrong;
the section heading at `:117` now says "the first gate", not "the only gate"); PR body, *Validation*.

Closing, `git diff --stat 5aa4159 a35d339`:

```
 .claude/reports/api-gate-flake-193-report.md |  8 ++-
 .claude/reports/pr-194-review-fixes.md       | 93 +++++++++++++++++++---------
 2 files changed, 68 insertions(+), 33 deletions(-)
```

`git diff --numstat a35d339 7aa91ae` → the two comment-only files above. The PR body's gate block is now the
`7aa91ae` run; the `5aa4159` stamp stays in both reports as a record.
`grep -n "One commit lands" .claude/reports/pr-194-review-fixes.md` → 0.

### F6 — Low · the payments comment stated an inference as history *(HUMAN DECIDES — taken)*

`services/api/src/features/payments/payments.integration.spec.ts:67-71` and `services/api/test/harness.ts:566-567`,
commit `7aa91ae`. Old: the #74-era responses "were" supertest re-binding a never-listening server. New: they
"are what the #193 RCA reproduces". The `init()` half is unchanged. In `harness.ts`, "with the listen above"
→ "with the listen in its old place". Line counts unchanged in both files, so no `file:line` reference moved.

Taken rather than left because the reviewer's wording is the weaker claim and the revert is one commit. Say
so if the original certainty was intended.

Closing: `git grep -n "listen above" 7aa91ae -- services/api` → 0. `grep -rn "double init were" services/api`
→ 0. `git show 7aa91ae:…payments.integration.spec.ts | sed -n 67,71p`:

```
    // #193: the harness inits AND listens; never init or listen again here.
    // The malformed responses this comment once blamed on a double init are
    // what the #193 RCA reproduces: supertest re-binding a never-listening
    // server per request, onto the wildcard, over a foreign 127.0.0.1 listener.
    // `init()` early-returns once initialized; a second call was never the cause.
```

## FYI — noted, not fixed

- **FYI-1**, commit subjects 73–75 chars against the `≤72` rule. Not touched; the rule is what to re-observe,
  in `conventions.md`, and that is its own PR. This pass's two subjects are 69 and 68 chars (`observed`, `wc -m`; the second is 70 bytes, its en dash being three).
- **FYI-2**, the "17 failed suites / 185 failed tests" figure from the discarded probe. Left: it is a run's
  output, the instrument was discarded, and the sentence says so.
- **FYI-3**, `CLAUDE.md`'s Redis-gated line and `piv-validate`'s `--forceExit`. Still deferred to the
  `system-evolution-review` the PR names; unchanged from `pr-194-review-fixes.md`'s Deferred table.

## Deferred

Nothing new. `pr-194-review-fixes.md`'s Deferred table stands.

## Needs a human look

- **F6's wording** — taken with the reviewer's text; revert `7aa91ae` if the original certainty was intended.
- **The PR body was edited in place** (2026-09-13 11:52:59Z, `gh pr edit --body-file`); the old Validation
  block (`5aa4159`) survives in `pr-194-review-fixes.md`, the rest of the old body only in the edit history.

## The retired-value sweep

Tree column — `grep -rn "<pat>" docs/ .claude/ services/api --include='*.md' --include='*.ts' | grep -v
node_modules | grep -v pr-196-review-fixes`; this file quotes every pattern in order to report on it and is
excluded for that reason, as `pr-194-review-fixes.md` excluded itself. Body column —
`gh pr view 196 --json body --jq .body` after the edit at 11:52:59Z. Run at `7aa91ae` plus the docs edits
this file's commit carries.

| Pattern | Tree | Body | Verdict |
|---|---|---|---|
| `report.md:80\b` | **0** | **0** — 1 before the body edit, the *Notes* cite the review's F3 table did not list | retired |
| `report.md:241` / `report:241` | **0** | 0 | retired |
| `:66-70` | **0** | 0 | retired |
| `mint-tracked-ride.ts:432` | **2** — `.claude/code-reviews/pr-194-review.md:51`, `:218`, the review's own record | 0 | retired; `pr-194-review-fixes.md:184` keeps it in a "before the comment grew" clause |
| `four more` | **4** — `pr-65-review.md:194`, two plans, `pr-34-review-fixes.md:66`, all unrelated | 0 | retired |
| `One commit lands` | **0** | 0 | retired |
| `already covered` | **4** — three unrelated plans/reports, plus `pr-194-review-fixes.md:14`, the header note naming the retracted phrase | 1 — `:38`, the bullet naming it | retired as a claim |
| `No new test needed` | **0** | 0 | retired |
| `and \`build\` cover` | **0** | 0 | retired |
| `harness.ts:564` | **0** | 0 | retired |
| `listen above` | **0** in `services/api` | 1 — `:75`, the F1 table's "listen above the checks (#194 as merged)" row, which describes the unfixed tree and is correct | retired in code |
| `double init were` | **0** | 0 | retired |
| `the only gate stamped` | **0** | 0 | retired |
| `0df5e51\` is docs-only` | **0** | 0 | retired |

Positives, present where they should be: `report.md:81` 3 (`pr-194-review-fixes.md:26`, `:123`, `:259`);
`report:275` / `report.md:275` 1 each (`:262`, `:142`); `:67-71` 1 (`:103`);
`mint-tracked-ride.ts:434` 2 + body 1; `Two docs-only commits` 2 (`api-gate-flake-193-report.md:138`,
`pr-194-review-fixes.md:60`); `app.e2e-spec.ts:22` 2 (`:273`, `:278`).

## Validation

| Check | Command | Result |
|---|---|---|
| CI-parity gate at `7aa91ae` | `record-gate.sh --clean`, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL` set | ✅ exit 0 · `22 successful, 22 total` · 1m38.707s · api `77 passed, 77 total` / `724 passed, 724 total` |
| F2's probe, at `a35d339` and `7aa91ae` | `npx jest src/test-harness.spec.ts` with the `address()` read inserted | ✅ `null` and `3 passed, 3 total` both times — the retracted claim is false, the retraction stands |
| Tree after each probe | `git status --porcelain` | ✅ empty |
| Line counts of the F6 edit | `git diff --numstat a35d339 7aa91ae` | ✅ `4 4`, `2 2` |
| Live body equals the edited file | `diff` against `gh pr view --json body` | ✅ identical bar one trailing newline |
| Base drift | `git fetch --prune`; PR base vs `origin/main` | ✅ `d5bbea1` both |
| GitHub checks | `gh pr checks 196` | pending at push time; CI re-runs on this head |
