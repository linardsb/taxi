# PR #196 — review fix pass (round 3)

**Review** the round-3 comment on the PR — https://github.com/linardsb/taxi/pull/196#issuecomment-5661585061
(the report is `.claude/code-reviews/pr-196-review-round3.md` on branch `docs/pr-196-review`, PR #198, not in this tree)
**Reviewed head** `fce06ba` · **Fix commit** this file's own (`.claude/reports/` only — this file,
`pr-194-review-fixes.md`, `api-gate-flake-193-report.md`, `pr-196-review-fixes-round2.md`; no source change) ·
**Base** `main` @ `d5bbea1`
**Worktree** `/Users/Berzins/taxi-worktrees/wt-193` · **Ran** 2026-09-14, 10:20–10:45 local

## Verdict

F1, F2 and F3 fixed, all in prose, each closing command run against the fixed tree before its sentence was
written. The one **HUMAN DECIDES** item (F4, a clause in the `test/harness.ts` listen comment) is **not taken**:
it is additive rather than a retraction, the review itself called either choice defensible, and it is the only
item that would touch source. The defect F1's sentence was about — the e2e file's non-exit — is filed as
**#200** with the corrected subject, which closes a "worth an issue" that had stood in two PR bodies since
2026-09-12. FYI-1 was done by the reviewer in PR #198; FYI-2 is in #200's body; FYI-3 and FYI-4 need nothing.
Nothing was dropped as noise.

Every edit here keeps its file's line count: F1's paragraph was rewritten as the same four lines, F2 and F3
are same-line substitutions (`git diff --numstat`: `4 4`, `5 5`, `2 2`). That is deliberate — the round-2 fix
report and the round-3 review cite `pr-194-review-fixes.md` by line below `:214`, and a paragraph that grew
would have moved every one of them.

## Ground check

PR #196 **OPEN**, base `main`, head `fce06ba` = `origin/fix/pr-194-review-findings-193`, not draft. The main
checkout is on `fix/backup-crypt-149` (#149), so this pass ran in `wt-193`, which was clean; no `MERGE_HEAD`
/ `REBASE_HEAD` / `CHERRY_PICK_HEAD` (through `git rev-parse --git-dir`). No `turbo run`, `record-gate.sh` or
`vitest` process before the gate (`ps`, 0 matches). `taxi-db-1` and `taxi-redis-1` `Up (healthy)`, Redis
published on `6381`. `origin/main` = `d5bbea1`, unmoved since round 1.

## Gate

`observed` — `record-gate.sh --clean` at `fce06ba` with this pass's three docs edits in the working tree (the
script prints its own dirty-tree warning for that), `COMPOSE_PROJECT_NAME=taxi`,
`REDIS_TEST_URL=redis://localhost:6381`, 10:37:29–10:38:53 local, exit 0, 84 s wall:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m21.762s
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

Counts identical to the round-3 review's run at the same sha (2m12.017s, on a busier machine) and to the
`bd733b0`, `7aa91ae` and `5aa4159` stamps. The source at `fce06ba` is the source at this pass's head, so the
stamp covers every source file on the branch. This file's commit is docs-only and lands after the run;
`git diff --stat fce06ba HEAD` is the reviewer's closing command (expected: four files, all `.claude/reports/`).

## Fixed

### F1 — Medium · "so it is a Drizzle pool, not the socket"

`pr-194-review-fixes.md:211-214` (the paragraph; `:213` carried the sentence) and `:231` (the deferred-table
row); PR body, *Notes for the reviewer*, "One pre-existing defect found and left alone" (now `:143-150` live).

The run behind the sentence ruled out the socket only. The reviewer's handle dump at `fce06ba` — two ioredis
sockets to `127.0.0.1:6379` and the http `Server` open when the last `app.close()` resolves, no Postgres
socket, all gone by t+500 ms — and the code reading (pool lazy at `db/src/client.ts:9`; `GET /` runs no query;
`db.module.ts:40-42` ends the pool in `onModuleDestroy`) are taken as given; this pass did not re-run the dump,
because the sentence it replaces is retracted rather than re-attributed. The new text says what was observed
(not the socket, not the pool), why the e2e app is the one file with this shape (raw `AppModule`, none of
`createTestApp`'s overrides, three real Redis stores against `REDIS_URL`), and that the cause is not yet
pinned.

**Fix** — the paragraph rewritten as four lines with the same first and last line count; the table row gains
`#200`; the body paragraph rewritten with the same content and `Issue #200` in place of "Worth an issue".

**Filed** — **#200** `api: test/app.e2e-spec.ts does not exit after its one test — not the socket, not the pool`,
label `review-residue`, carrying the dump, the three Redis store constructors, the foreign-`6379` observation
(FYI-2), and the closing evidence a fix needs (the hand run, since the gate never collects the file).

Closing, 10:41 local, after the edits:

```
grep -rn "Drizzle pool, not the socket\|It is a Drizzle pool" .claude/reports docs services/api \
  --include='*.md' --include='*.ts' | grep -v pr-196-review-fixes-round3 | wc -l         → 0
grep -n '#200' .claude/reports/pr-194-review-fixes.md                                     → :214, :231
grep -n 'not the pool either' .claude/reports/pr-194-review-fixes.md                      → :212
wc -l .claude/reports/pr-194-review-fixes.md                                              → 301 (was 301)
```

Live body (`gh pr view 196 --json body --jq .body` after the edit at 10:43 local): `Drizzle pool, not the
socket` → 0; `orth an issue` → 0; `a Drizzle pool` → 1, `:46`, the *What changed* bullet naming the retracted
phrase; `#200` → 3 (`:47`, `:150`, `:173`); `not the pool either` → 1 (`:144`).

### F2 — Low · four `file:line` figures in `api-gate-flake-193-report.md`

| Line | Was | Is | Checked at `fce06ba` |
|---|---|---|---|
| `:28` | `(line 539)` | `(line 570)` | `sed -n 570p services/api/test/harness.ts` = `await app.listen(0, '127.0.0.1');` |
| `:32` | `(line 619)` | `(line 627)` | `sed -n 627p` = `const client = io(\`http://127.0.0.1:${port}\`, {` |
| `:64` | `line 350` | `line 380` | `sed -n 380p docs/issues/issue-193.md` = "**One instrument defect is worth recording…" |
| `:114` | `RCA line 306` | `RCA line 335` | `sed -n 335p` = "  - ~~One qualification on that run…" |

Same-line substitutions; `git diff --numstat` → `4 4`. Closing:
`grep -n 'line 539\|line 619\|line 350\|line 306' .claude/reports/api-gate-flake-193-report.md` → 0;
`grep -n 'line 570\|line 627\|line 380\|line 335'` → `:28`, `:32`, `:64`, `:114`.

### F3 — Low · two off-by-one references in `pr-196-review-fixes-round2.md`

`:103` `(:85)` → `(:86)`; `:104` `:297)` → `:298)`. Closing: `grep -n 'every consumer but one'
.claude/reports/pr-194-review-fixes.md` → `:86`; `grep -n '#199'` → `:98`, `:298` (F1's rewrite kept the
paragraph at four lines, so neither moved); `grep -n '(:85)\|:297)' .claude/reports/pr-196-review-fixes-round2.md`
→ 0.

## Not taken

### F4 — Low · a clause in the listen comment pointing at #199 *(HUMAN DECIDES)*

`services/api/test/harness.ts:564-569`. Left as is. The comment is true of the case it names and claims
nothing about others (round 2's reading, which the round-3 review repeats); the proposed clause adds a claim
rather than retracting one, so the safe direction is to leave the human the choice. The one-line edit, if
wanted, is: after "(#194 review F1, `observed` both ways)", add "— except an app whose `configure` opened
handles of its own, #199". Comment-only, so the gate stamp would not move in substance, but the source sha
would.

## FYI — taken or noted

- **FYI-1** — the round-1 review report's inherited sentences. Done by the reviewer: a dated correction note
  at the end of `pr-196-review.md` on `docs/pr-196-review` (PR #198, `51038ae`). Nothing here.
- **FYI-2** — the foreign Redis on `6379`. In #200's body, as the review asked.
- **FYI-3** — gate wall time. This run's 1m21.762s is inside the earlier stamps' range; the review's 2m12s was
  the busier machine. Nothing to do.
- **FYI-4** — no source change, no test. Same for this pass.

## Deferred

| Item | Where | Why not here |
|---|---|---|
| The e2e non-exit itself | **#200**, `review-residue` | pre-existing, outside the gate's collection, and its cause is not yet established — the handle dump is the instrument, the fix is a separate change |
| F4 — the `test/harness.ts` comment clause | this file, *Not taken* | HUMAN DECIDES |
| F1's code half (`try/catch` + `await app.close()`) | **#199** | unchanged since round 2 |
| `CLAUDE.md`'s Redis-gated line; `piv-validate/SKILL.md:51`'s `--forceExit` | `system-evolution-review` | unchanged since #194 |

## Needs a human look

- **F4** — say if the clause is wanted; one comment line, then a fresh gate stamp.
- **#200** — it names the two candidates (the ioredis `quit()`s draining; the server's close) and the second
  hazard (three clients against whatever holds `6379`). Worth a look at whether the e2e spec should just go
  through `createTestApp`.
- **The PR body was edited in place** (2026-09-14, ~10:43 local, `gh pr edit --body-file`). The `bd733b0`
  Validation block it replaced survives in `pr-196-review-fixes-round2.md`; the `fce06ba` block is the gate above.

## The retired-value sweep

Tree column — `grep -rn --exclude-dir=node_modules "<pat>" .claude/reports docs services/api --include='*.md'
--include='*.ts'`, this file and `.claude/code-reviews/` excluded (this file quotes every pattern to report on
it; the review files are records of what the reviews found, as the earlier sweeps treated them). Body column —
the live body after the 10:43 edit. Run at `fce06ba` plus this pass's edits.

| Pattern | Tree | Body | Verdict |
|---|---|---|---|
| `Drizzle pool, not the socket` | **0** | 0 | retired |
| `It is a Drizzle pool` | **0** | 0 | retired |
| `a Drizzle pool` | **0** | 1 — `:46`, the bullet naming the retracted phrase | retired as a claim |
| `orth an issue` | **0** | 0 | retired — replaced by `#200` |
| `line 539` / `line 619` / `line 350` / `line 306` | **0** each | 0 | retired |
| `(:85)` / `:297)` | **0** | 0 | retired |

Positives, present where they should be: `#200` tree `pr-194-review-fixes.md:214,:231`, body `:47`, `:150`,
`:173`; `not the pool either` `:212` + body `:144`; `line 570` `:28`, `line 627` `:32`, `line 380` `:64`,
`line 335` `:114`; `(:86)` `:103`, `:298)` `:104`; `1m21.762s` body `:60`; `**Round 3**` body `:171`;
`source at \`fce06ba\`` body `:78`.

## Validation

| Check | Command | Result |
|---|---|---|
| CI-parity gate at `fce06ba` + docs edits | `record-gate.sh --clean`, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL` set, 10:37:29–10:38:53 | ✅ exit 0 · `22 successful, 22 total` · `0 cached` · 1m21.762s · api `77 passed, 77 total` / `724 passed, 724 total` |
| Line counts preserved | `git diff --numstat` | ✅ `4 4` flake report · `5 5` pr-194 fix report · `2 2` round-2 fix report; `wc -l` 301 → 301 |
| F2 targets | `sed -n` at `:570`, `:627` of `test/harness.ts`; `:380`, `:335` of `issue-193.md` | ✅ each is the line the sentence describes |
| F3 targets | `grep -n` for the two phrases in `pr-194-review-fixes.md` | ✅ `:86`; `:98`, `:298` |
| Retired values | the sweep above | ✅ 0 in tree and body for every retired pattern |
| Live body equals the edited file | `diff` against `gh pr view --json body` | ✅ identical bar one trailing newline |
| Issue | `gh issue view 200` | ✅ OPEN, `review-residue` |
| Base drift | `git fetch --prune`; `origin/main` | ✅ `d5bbea1` |
| GitHub checks | `gh pr checks 196` | pending at push time; CI re-runs on this head |
