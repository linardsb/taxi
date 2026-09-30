# PR #308 review, round 2: feat(skills): log-only Jev claim check for PR bodies (#302)

**Head** `260e57c` · **Base** main @ `96053d0` (`baseRefOid`; live tip `025c31f`, the same tip round 1's addendum recorded) · reviewed 2026-09-30 in a detached worktree · **Recommendation: approve** (no Critical, High or Medium; four Lows, all optional before merge)

## Summary

The fix pass closes every round-1 finding, and each closure holds on a re-run of round 1's own probes against the fixed tree. The new mechanisms introduce nothing above Low. Three Lows are behavioural and two of those reproduce (`observed`); one is a stale figure in the fixes report.

## Round-1 findings, re-run on `260e57c`

| Round 1 | Probe (all `observed`, 2026-09-30) | Result |
|---|---|---|
| H1 key in the block | `TYPESAFE_API_KEY=$'SECRETKEY\nx'`, closed port, `grep -c SECRETKEY` | `0` (round 1: 4); script exit 0 |
| M1 `200 {}` logged clean | stub answering `200 {}` to `Gate took 58 s (observed).` | `Jev unavailable: 1 of 1 requests failed`, `failed 1` |
| M2 body in a stray `<details>` | published body's rendered HTML (`gh api …/pulls/308 -H "Accept: application/vnd.github.html+json"`) | one `<details>` at 17593, closed at 36307; "My reading…" at 36332, "Notes for the reviewer" at 37432, "Linked" at 43309, all outside it |
| M2 script half | `--details-out` on the M1 stub run | file's first line is `<details><summary>…` |
| L1–L5, L-new | read against the fix diff and the fixes report | closed as the report states; the crash handler is still untested (the report says so) |

Constraint pass: `grep -in "do not modify|…|frozen"` on the plan hits `:315`, `:495`, `:690`, `:704`; none is touched by a fix below. `:478` fixes the summary line's shape (`F flagged, E to re-derive`), which N3's fix must keep as a prefix.

## Fix-mechanism pass (what the round-1 fixes newly permit)

Checked and clear (traced by the code-reviewer agent; the first two also run by me):
- **`unavailable` cannot fire on a legitimate body.** `claim-check.mjs:339` returns before it when there are no requests. `observed`: a body with no figures prints `No claim units to judge.`, and a body with only an extreme-case sentence prints `No questions to ask of the 1 claim units.` with the sentence in the re-derive list. Both exit 0.
- **The abort rethrow cannot swap `budget` and `timeout`.** `:325` checks the budget signal first.
- **No remaining key-leak path.** Once `:499` refuses a key with a control character, undici's header error, which quotes the value, cannot fire. The `--details-out` file is the same scrubbed string as stdout.
- **The fence rule** handles `~~~` against backticks, longer closers, info strings on a closer, and unclosed fences.

## Issues

### Low

**N1 · `claim-check.mjs:499` — the key check refuses a key that worked before the fix.**
- In plain terms, a key with a stray line ending, such as one read from an env file saved with Windows line endings, used to work and is now refused.
- Mechanism: `fetch` trims leading and trailing whitespace from a header value before validating it, so `Bearer realkey\r` was sent as `Bearer realkey`. The new regex `/^[\x21-\x7e]+$/` runs on the untrimmed value.
- `observed`, against a stub that logs the `Authorization` header:
  - `acb3f63` sent `Bearer realkey`.
  - `260e57c` prints `note: TYPESAFE_API_KEY holds whitespace or a control character (value not printed): no Jev call made` and sends nothing.
- It is not silent, because the note is printed. That is why it is Low.
- **Fix:** trim `[\t\n\r ]` at both ends before the test. An interior newline, round 1's H1 case, is still refused, so test 12 stays green.

**N2 · `claim-check.mjs:494-503,514` + `SKILL.md:90` — a crash leaves the previous run's `--details-out` file in place, and the skill's fallback text does not cover it.**
- In plain terms, if the script crashes, the agent can paste an old claim-check result into a new PR body.
- `observed`:
  1. A run with `--details-out dd.md` writes the file.
  2. `chmod 000` the draft and run again.
  3. The second run prints `note: claim-check crashed, nothing judged: Error: EACCES …` with a stack trace, and exits 0.
  4. `dd.md` still holds the first run's block. Its totals line carries the first run's time.
- `SKILL.md:90` says "If the file was not written, stdout says so; paste from its `<details><summary>` line". On this path stdout has neither the "not written" note nor a `<details><summary>` line. Phase 2.5 uses a fixed file name, so the old file is what gets pasted.
- **Fix:** truncate or delete `detailsOut` right after argument parsing. Also add the crash note to the `SKILL.md:90` fallback sentence.

**N3 · `claim-check.mjs:402` — M1's harm survives in the collapsed summary line.**
- In plain terms, on a run where Jev never answered, the one line a reader sees with the box closed is identical to a clean run's.
- `observed` (M1 stub, `--details-out`): the file's first line is `<details><summary>Claim check (log-only, #302): 0 flagged, 0 to re-derive</summary>`. The `Jev unavailable` line only appears once the box is opened.
- A run with no key reads the same way. That is the default in CI and in any session without the key.
- **Fix:** keep the plan's `:478` shape as a prefix and append the state when `r.unavailable` is set or nothing was sent, e.g. `0 flagged, 0 to re-derive · Jev unavailable`.

**N4 · `.claude/reports/pr-308-review-fixes.md:28,76,77` — the fixes report states body figures the body no longer carries.**
- The report says the Size bullet became `origin/main...a068261` and 2027 lines, and the Tests bullet became 21.
- The published body says `origin/main...260e57c`, +2143, and 22. The body is correct: `git diff --shortstat origin/main...260e57c` gives `14 files changed, 2143 insertions(+), 7 deletions(-)`.
- This is the known pattern of a fix report quoting PR body figures that its own later commit moved.
- **Fix:** mark those three cells "at `a068261`", or point them at the body instead of restating it.

**N5 (optional, `derived`, not run) · `claim-check.mjs:420,422,448,451` — `--eval` prints `model` and `choice` without `oneLine`.**
- The L3 fix covered `checkBody`'s output only.
- This leaks no secret, and the output is not the pasted block.

## Numbers pass

| Figure | Check | Result |
|---|---|---|
| 14 files, +2143 −7 | `git diff --shortstat origin/main...260e57c` | observed, matches |
| per-file split, sum 2143, deletions 7 | `gh pr view --json files`; re-added | matches |
| 22 offline tests = 12 + 10 (2b, 4b, 12–18, 16b) | count; local `node --test` | observed `# tests 25`, `# pass 22`, `# fail 0`, `# skipped 3` |
| CI 23/23, 0 cached, 3m20.151s at `260e57c` | run 36690884994, job `check` log | observed, matches; the same log has `# pass 22`, `# skipped 3` |
| D6: 516 lines at `260e57c` | `wc -l` | observed, 516 |
| Live `# pass 24` "on the fix-pass tree" | fixes report: 08:25Z, which is before 16b landed (24 = 21 offline + 3 live) | consistent, but that tree is `89d485a`, not the head, and the head has 25 tests. The label is imprecise, not wrong |

### Claim-check comparison

This round has no new log entry. Log entry 1 (`acb3f63`) is unchanged, and round 1 already scored it: flags confirmed 0 of 6, flags rejected 6 of 6, figure findings it missed 0. It also could not have caught N4, which is in a report, not the body.

## Guarantees pass

- **Trigger:** the live tip `025c31f` against round 1's newest recorded base, the addendum's `025c31f`. They are equal, so the base has not moved since the addendum.
- The head did move, so I rechecked the merge:
  - `git merge-tree --write-tree origin/main 260e57c` merges cleanly.
  - `comm -12` of main's delta since `96053d0` and the PR's files prints nothing.

## Validation

| Check | Result |
|---|---|
| CI `check` (full gate, parity) at `260e57c` | pass, 23/23, 0 cached (run 36690884994) |
| `audit-diff`, `codeql`, CodeQL, `ready` | pass |
| `@taxi/pr-scripts` offline suite, local | 25 tests: 22 pass, 0 fail, 3 skipped |
| Local full gate | not run: other sessions share the test DB, and the diff touches only `.claude/` and `@taxi/pr-scripts`. CI's gate is on this head |

## What is done well

- Every fix has a test and a mutation that turns that test red. The fixes report records both, and it notes where the unfixed script fails a test for a shape reason rather than the bug.
- The report retracts its own earlier claim that the crash handler is unreachable, and says what disproved it.
- The body now pastes log entry 1 from its `<details><summary>` line. It also says that entry records the `acb3f63` run and was not re-run.

## Recommendation

**Approve.** Nothing blocks the merge. N2 and N3 are the ones worth folding in before the 10-PR log starts accumulating entries, since both can produce a log entry that misleads. N1, N4 and N5 are optional.

---

**Posted on the PR. A human now reviews the code and this review, and merges.**
