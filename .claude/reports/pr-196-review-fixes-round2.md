# PR #196 — review fix pass (round 2)

**Review** the round-2 comment on the PR — https://github.com/linardsb/taxi/pull/196#issuecomment-5653231985
(the round-1 report is `.claude/code-reviews/pr-196-review.md` on branch `docs/pr-196-review`, PR #198, not in this tree)
**Reviewed head** `bd733b0` · **Fix commit** this file's own (`.claude/reports/` only — this file and
`pr-194-review-fixes.md`; no source change) · **Base** `main` @ `d5bbea1`
**Worktree** `/Users/Berzins/taxi-worktrees/wt-193` · **Ran** 2026-09-13, 13:40–14:10 local

## Verdict

Both findings fixed, in prose, and each one's run reproduced here before its sentence was rewritten. The
**HUMAN DECIDES** item — F1's code half, the `try/catch` + `await app.close()` shape — is **not taken**:
it is issue **#199**, and the issue carries the runs this pass made of that shape (it exits, both with
Redis and without), so the decision is one read away instead of "unrun". FYI-2 is taken (the body's
*Review rounds* line). FYI-1 and FYI-3 are other files' fixes and are left, with pointers below. Nothing
was dropped as noise.

Why the code half is deferred and not taken: the review routed it to the human; the shape has now run on
two spec files and not on the gate; the PR's gate stamp is at the current source and a source change would
move it; and the mechanism has a failure mode of its own that nobody has decided on yet (a `close()` that
throws inside the `catch` masks the self-check's error with its own). #199 lists all four.

## Ground check

PR #196 **OPEN**, base `main`, head `bd733b0` = `origin/fix/pr-194-review-findings-193`. The main
checkout is on `fix/backup-crypt-149` (#149), so this pass ran in `wt-193`, which was clean; no
`MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD` (through `git rev-parse --git-dir`). No `turbo run`,
`jest`, `vitest` or `record-gate` process before any probe or the gate (`ps`, 0 matches each time).
`taxi-db-1` and `taxi-redis-1` `Up (healthy)`, Redis published on `6381`. `git fetch --prune`:
`origin/main` = `d5bbea1`, unmoved since both rounds. `.claude/last-gate.json` is gitignored
(`.gitignore:25`) and is not in the commit.

## Gate

`observed` — `record-gate.sh --clean` at `bd733b0` with this pass's docs edits in the working tree (the
script prints its own "dirty tree" line for that), `COMPOSE_PROJECT_NAME=taxi`,
`REDIS_TEST_URL=redis://localhost:6381`, 14:02:21–14:04:13 local, exit 0, 112 s wall:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m50.498s
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

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build`
— the legitimate set, same as both rounds. Counts identical to the round-2 review's run at the same sha
(1m28.903s) and to the `7aa91ae` and `5aa4159` stamps. The three probes below mutated `test/harness.ts`
before this run; each was reverted with `git checkout -- services/api/test/harness.ts` and
`git status --porcelain | wc -l` printed `0` after each, before the next step. The gate ran on the
reverted tree: `git status --porcelain` at commit time lists `pr-194-review-fixes.md` and this file only.
This file's commit is docs-only and lands after the run; `git diff --stat bd733b0 HEAD` is the reviewer's
closing command (expected: two files, both `.claude/reports/`).

## Fixed

### F1 — Medium · "the listening socket was only what turned that leak into a hang"

`pr-194-review-fixes.md:85-87` (the paragraph is now `:84-98`) and the PR body, *Notes for the reviewer*,
first paragraph (now `:92-101` of the live body). The sentence was false for the Redis-gated block of
`redis-io.adapter.spec.ts`, whose `installAdapter` (`:41-45`) opens two ioredis clients in `configure`,
before `init()` (`redis-io.adapter.ts:37-38`); only `RedisIoAdapter.close()` quits them (`:58`).

**Reproduced before the sentence was rewritten**, not copied from the review. `observed` at `bd733b0`,
from `services/api`, `test/harness.ts` mutated by a script (`probeCalls` counter at module scope; the queue
self-check throws on the process's second `createTestApp` call, which is nodeB), then reverted:

| Probe | Tree | Command | Result |
|---|---|---|---|
| A | head as shipped (listen below the checks, no `try/catch`) | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout 75 npx jest src/features/realtime/redis-io.adapter.spec.ts` | ❌ `2 failed, 3 passed, 5 total` (run finished in 1.629 s), then `Jest did not exit one second after the test run has completed.`, held until `timeout`: **exit 124, 75 s wall**. The two `DISPATCH_QUEUE_STORE override did not take` throws and the `TypeError: Cannot read properties of undefined (reading 'app')` from `afterAll` (`:57`, `nodeB.app.close()`) present, as the review documents. |
| B | head + `try {…} catch (err) { await app.close(); throw err; }` around both self-checks | same | ✅ `2 failed, 3 passed, 5 total`, **exit 1, 5 s wall**, zero "did not exit" lines. Same two throws, same `TypeError` (nodeB is still unassigned; nodeA closes in `afterAll` and the harness closed nodeB). |
| C | head + the same `try/catch`, queue check forced to throw (`if (true \|\| …)`), Redis off | `COMPOSE_PROJECT_NAME=taxi timeout 75 npx jest src/test-harness.spec.ts` | ✅ `3 failed, 3 total`, **exit 1, 3 s wall**, zero "did not exit" lines. |

Row A is the review's F1 run, to the digit. Rows B and C are what #199 carries: the shape closes the
Redis-gated hang and the Redis-off one, and `close()` retires the pool leak with them
(`onModuleDestroy` → `pool.end()`, `RedisIoAdapter.close()` → `quit()` × 2). Not run: the gate with that
shape in place, which is #199's first item.

**Fix** — the sentence in both places now reads that the socket was what turned the leak into a hang "for
every consumer but one", names the block and what it opens before `init()`, gives probe A as its
provenance, says it is not a regression (the block hung with the listen in its old place too), and points
the `try/catch` at #199 with rows B and C. The report's *Needs a human look* bullet (`:295-299`) said the
shape "has never been run"; it now says "at the time it had never been run" and names #199.

Closing, 14:0x local, after the edit:

```
grep -c 'only what turned' .claude/reports/pr-194-review-fixes.md                       → 0
grep -c 'nodeB still leaks\|unchanged in the same way' .claude/reports/pr-194-review-fixes.md → 0
grep -c 'has never been run' .claude/reports/pr-194-review-fixes.md                     → 0
grep -c 'every consumer but one' .claude/reports/pr-194-review-fixes.md                 → 1   (:85)
grep -c '#199' .claude/reports/pr-194-review-fixes.md                                   → 2   (:98, :297)
grep -rn 'only what turned\|nodeB still leaks\|unchanged in the same way' services/api --include='*.ts' → 0
```

Live body (`gh pr view 196 --json body --jq .body` after the edit at 13:05:44Z): `only what turned` → 1,
`:41`, the *What changed* bullet naming the retracted phrase; `consumer but one` → 1, `:94` (the new
sentence wraps after "every"); `nodeB still leaks\|unchanged in the same way` → 0; `#199` → 3 (`:44`,
`:99`, `:158`).

### F2 — Low · the sweep's `node_modules` filter ate a content line

`pr-194-review-fixes.md:245` (the exact form, now `:252-253`), `:249` (the `-E`/`-F` note, now
`:256-261`), `:264` (the row, now `:275`); PR body `:111` (now `:121-123`).

**Reproduced** at `bd733b0` before any edit, same scope and second exclusion as the report's form:

| Filter | `listen(0)` lines |
|---|---|
| `\| grep -v node_modules` (as written) | **26** |
| `--exclude-dir=node_modules` on the `grep -rn` | **27** |

The difference is `docs/issues/issue-193.md:96`, the RCA quoting supertest's own `listen(0)` line, whose
content names `node_modules`. Per file under the corrected filter: `issue-193.md` 13,
`api-gate-flake-193-report.md` 4, five `.claude/plans/*.md` 7 (1 + 3 + 1 + 1 + 1), code 3
(`harness.ts`, `test-harness.spec.ts`, `mint-tracked-ride.ts`) — 27. So "12 are RCA prose" was 13. Every
other row of the table returns the same count under both filters (`observed`, the eleven patterns looped:
`0 1 1 0 0 0 0 0 3 17` and `Seventeen` 0, identical in both columns). `git grep -F "listen(0)"` with the
same scope and exclusions at `d5bbea1`, `5b676d6`, `5aa4159`, `0df5e51`, `a35d339`, `7aa91ae`, `bd733b0`:
**27** at each — the figure is stable across the branch and the base, so the 26 described the instrument.

**Fix** — three edits to the report and one to the body:

- the exact form (`:252-253`) takes `--exclude-dir=node_modules` on the `grep -rn` and loses the piped
  `grep -v node_modules`;
- **one instrument change beyond the review's**, disclosed here so it can be diffed: the second exclusion
  gains `pr-196-review-fixes`, because both #196 fix-pass reports quote the row in order to correct it
  (this file does, several times) and would otherwise inflate the count at the next head. That is the same
  reason the pr-194 report excludes itself, and the note at `:260-261` says so. Every other row is
  unchanged by it: the loop above ran with the new exclusion and printed the same eleven counts;
- the note next to the `-E`/`-F` trap (`:256-261`) records this second trap beside the first, with the
  eaten line named;
- the row (`:275`) reads **27**, 13 RCA prose, with `observed` at `bd733b0` under the corrected form and
  the 26 named as the first form's output;
- the body (`:121-123`): "With `-F` it is 27, and only with `node_modules` excluded by directory".

Closing, after the edit — the corrected exact form, verbatim from `:252-253` with `-F` and the pattern:

```
grep -rFn --exclude-dir=node_modules "listen(0)" docs/ .claude/ services/api --include='*.md' --include='*.ts' \
  | grep -v 'pr-194-review-fixes\|code-reviews/pr-194-review\|pr-196-review-fixes' | wc -l   → 27
grep -c '12 are RCA' .claude/reports/pr-194-review-fixes.md                                  → 0
grep -n 'grep -v node_modules' .claude/reports/pr-194-review-fixes.md                        → 1, :258 (the note naming the trap)
grep -nw '26' .claude/reports/pr-194-review-fixes.md                                         → :260, :275 (the note and the row, both naming it as the old form's output)
```

Live body: `it is 27` → 1 (`:121`); `-w 26` → `:43`, `:123`, both naming the old figure as retired.

## FYI — taken or noted

- **FYI-1** — commit subjects. Not touched; round 1 routed the rule to `conventions.md`. This pass's one
  subject is measured in the commit step, not here (a length written before the commit exists is a claim
  about nothing).
- **FYI-2** — **taken**: the body's *Review rounds* section has the round-2 line (`:155-159` live), and
  *What changed* has a bullet for this commit (`:41-44`), with the round-1 bullet re-labelled `bd733b0`
  since it is no longer the head.
- **FYI-3** — round 1's report, `pr-196-review.md:138`, states "0 vs 26" under the same filter. That
  file is on `docs/pr-196-review` (PR #198, worktree `wt-review196`), not in this tree; a one-line edit
  there when that PR is next touched. Left, with this pointer.

## Deferred

| Item | Where | Why not here |
|---|---|---|
| F1's code half — `try/catch` + `await app.close()` in `createTestApp` | **#199**, `review-residue`, with probes A–C in its body | HUMAN DECIDES per the review; the gate has not run with the shape; the PR's gate stamp is at the current source; the mechanism's own failure mode (a throwing `close()` masks the original error) is undecided |
| FYI-3, `pr-196-review.md:138` "0 vs 26" | PR #198's file | not in this tree |
| `CLAUDE.md`'s Redis-gated line (`33 / 582 / 615` vs `35 / 689 / 724`) and `piv-validate/SKILL.md:51`'s `--forceExit` | `system-evolution-review`, as in both earlier fix reports | unchanged |

## Needs a human look

- **#199** — take it in a later PR, or here if the source change and a fresh gate stamp are wanted in this
  one. The runs are in the issue; the shape is four lines.
- **The instrument change** — the pr-194 report's exact form now excludes `pr-196-review-fixes` as well.
  If the sweep should count the fix-pass reports, revert that one word in `:253` and expect the row to
  rise by this file's own mentions.
- **The PR body was edited in place** (2026-09-13 13:05:44Z, `gh pr edit --body-file`). The `7aa91ae`
  Validation block it replaced survives in `pr-196-review-fixes.md`; the `bd733b0` block is the gate above.

## The retired-value sweep

Tree column — `grep -rn "<pat>" .claude/reports/pr-194-review-fixes.md services/api --include='*.md'
--include='*.ts'`, this file excluded because it quotes every pattern to report on it. Body column — the
live body after the 13:05:44Z edit. Run at `bd733b0` plus this pass's edits.

| Pattern | Tree | Body | Verdict |
|---|---|---|---|
| `only what turned` | **0** | 1 — `:41`, the bullet naming the retracted phrase | retired as a claim |
| `nodeB still leaks` / `unchanged in the same way` | **0** | 0 | retired |
| `has never been run` | **0** | 0 | retired |
| `12 are RCA` | **0** | 0 | retired |
| `With \`-F\` it is 26` | **0** | 0 | retired |
| `grep -v node_modules` | **1** — `:258`, the note naming the trap | 1 — `:122`, the same | retired as an instrument |
| `\b26\b` | `:260`, `:275` — both name it as the old form's output | `:43`, `:123` — same | retired as a figure |
| `at \`7aa91ae\`, exit 0` | n/a | **0** — the Validation block is the `bd733b0` run; `7aa91ae` survives at `:73` as an earlier stamp | retired as the current stamp |

Positives, present where they should be: `every consumer but one` / `consumer but one` 1 + 1;
`#199` 2 + 3; `1m50.498s` `:54` in the body; `27` in the row (`:275`) and the body (`:43`, `:121`);
`**Round 2**` at body `:155`.

## Validation

| Check | Command | Result |
|---|---|---|
| CI-parity gate at `bd733b0` + docs edits | `record-gate.sh --clean`, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL` set, 14:02:21–14:04:13 | ✅ exit 0 · `22 successful, 22 total` · `0 cached` · 1m50.498s · api `77 passed, 77 total` / `724 passed, 724 total` |
| Probe A — the review's F1 run, head as shipped, Redis on | `timeout 75 npx jest src/features/realtime/redis-io.adapter.spec.ts`, queue check throwing on the second `createTestApp` | ❌ reproduced: `2 failed, 3 passed, 5 total`, `Jest did not exit`, exit 124, 75 s |
| Probe B — the `try/catch` shape, same mutation, Redis on | same | ✅ exit 1, 5 s, `2 failed, 3 passed, 5 total`, 0 "did not exit" lines |
| Probe C — the `try/catch` shape, check forced to throw, Redis off | `timeout 75 npx jest src/test-harness.spec.ts` | ✅ exit 1, 3 s, `3 failed, 3 total`, 0 "did not exit" lines |
| Tree after each probe | `git checkout -- services/api/test/harness.ts`; `git status --porcelain \| wc -l` | ✅ `0`, three times |
| F2 — both filters at the clean tree | the report's form, as written vs `--exclude-dir` | ✅ 26 vs 27; the eaten line is `issue-193.md:96` |
| F2 — the other eleven rows under old vs corrected form | loop | ✅ identical counts |
| F2 — stability across shas | `git grep -F "listen(0)" <sha> -- 'docs/*.md' '.claude/*.md' 'services/api/*.ts' 'services/api/*.md'`, same exclusions, 7 shas | ✅ 27 at each |
| Live body equals the edited file | `diff` against `gh pr view --json body` | ✅ identical bar one trailing newline |
| Base drift | `git fetch --prune`; `origin/main` | ✅ `d5bbea1` |
| Docs-only commit | `git status --porcelain` before commit | ✅ `pr-194-review-fixes.md` (26 insertions, 14 deletions, `git diff --numstat`) and this file |
| GitHub checks | `gh pr checks 196` | pending at push time; CI re-runs on this head |
