# PR #308 review fixes, round 1

**Review**: `.claude/code-reviews/pr-308-review.md` (round 1 plus the base-moved addendum) · **Fix commits** `a068261`,
then the L1 eval half and the plan amendment in the commit after `89d485a`
on `feature/jev-claim-check-302` · 2026-09-30

**Scope**: no steer was given, so the review's own recommendation applies. Fix H1, M1 and M2, and pick up
L1–L4 and L-new. L5 gets its cheap parts. L6 needs no action. Nothing is deferred, so nothing was filed.

## Fixed

Each new test was run twice. First against the unfixed script (`git show acb3f63:…/claim-check.mjs` beside the new
test file): 8 red, 13 green (`observed`). Then against the fixed script with **only its own mechanism mutated
back**, one mutation per run (scratchpad `mutate.sh`, `observed`): each target test goes red. The second run
matters because the unfixed `formatReport` returns a string, so test 13 is red there for a shape reason as
well as for the missing redaction.

| Code | What was wrong | Fix | Test | Mutation → red |
|---|---|---|---|---|
| H1 | A key containing a newline was echoed into the `<details>` block via undici's `Headers.append` message | `main` refuses a key that fails `/^[\x21-\x7e]+$/` with a note that names no value. `runAll` replaces the key with `[redacted]` before flattening (empty-key guard, so `replaceAll('')` never runs) | 12 (CLI: note, no `SECRETKEY`, `stub.hits === 0`), 13 (`checkBody` directly, past the CLI check: `[redacted]`, one line) | CLI check → `if (false)`: 12 red. Redaction → `String(s)`: 13 red |
| M1 | `200 {}` logged as "No claim units to judge." with `0 flagged`. Failures were counted per question. An aborted body read became `{}` | One `failed` entry per request. `unavailable` is set whenever there are no verdicts. `askJev` rethrows when `signal.aborted`. The no-units line only prints when there are no units | 14 (`200 {}`), 15 (headers sent, body never finished, `TIMEOUT_MS=300` → `timeout 0.3 s`) | `unavailable` never set: 14 red. Rethrow removed: 15 red |
| M2 | The PR body had been cut at the first `<details>` in stdout, which is a quoted one | `--details-out <file>` writes the block alone. A failed write is a note, exit 0. Phase 2.5 says paste the file | 17 (the file starts `<details><summary>` and ends `</details>\n` even with a quoted `<details>`; stdout ends with the same block), 18 (ENOENT is a note, exit 0) | Both red on the unfixed script (flag absent) |
| L1 | `200 null` crashed the run; so did a `null` JSONL row under `--eval` (`evalSet`, the review's second half, missed in `a068261` and caught before round 2: `observed`, `note: claim-check crashed … reading 'state'`) | `askJev` rejects a non-object body; `runEval` skips a row with no `state` object, with a note | 16, 16b | Check → `if (false)`: 16 red; row check → `if (false)`: 16b red |
| L2 | A ```` fence closed on an inner ```; a ```js line closed a ``` fence | Close only on a bare run of the opener's character, at least as long | 2b | Reverted to `startsWith(fence)`: 2b red |
| L3 | Server strings entered the block raw | `oneLine` (key scrub, whitespace collapse, 200-char cap) on the failure reason, `choice` and `model` | 13's one-line assertion | (with H1) |
| L4 | Phase 2.5 said "always exits 0" | "exits 0 on every path except usage (2)" in `SKILL.md` and the plan's task text | none (prose) | — |
| L5 (part) | Test 4 did not pin that untracked or `../` citations are never read. Test 9's title described a case it did not build | 4b: a reader spy stays empty, `readAtHead` throws `not tracked`, and a dirty tracked file reads its HEAD content. Test 9 retitled. The report's D13 records that the derived-figure acceptance case is live-only | 4b | `readAtHead` → `readFileSync`: 4b red |
| L-new | The Size command was a two-dot diff | The body's Size command became three-dot, `origin/main...<head>`; its head and totals are the body's, re-derived each push, not restated here | none (prose) | — |

**H1, step 4: what new failure mode does the fix's mechanism have?**
- **The format check can refuse a real key.** The note makes that visible, so it is not silent. Keys are printable tokens, and the live key used here passed the check.
- **Redaction depends on the literal key.** A runtime that escaped the newline (`\n` as two characters) would slip past `replaceAll`. The CLI check stops that key before any call, and test 12 pins it.

**Not done from L5**:
- The crash handler is still unexercised. No test drives it. That is not a claim that it is unreachable: the
  first version of this report said it was, and L1's eval half disproved it.
- An offline assertion for the derived-figure case was not added. D13 records the gap.

## Verbatim review probes on the fixed tree

Run 2026-09-30T08:25Z (`observed`):

- **H1**: `CLAIM_CHECK_BASE_URL=http://127.0.0.1:9 TYPESAFE_API_KEY=$'SECRETKEY\nx' node claim-check.mjs b.md | grep -c SECRETKEY` prints `0` (it was 4 before the fix).
- **M1**: a stub answering `200 {}` to `Gate took 58 s (observed).` prints:
  - `note: L1 provenance,not_measured,worst_case: no answer for provenance,not_measured,worst_case`
  - `Jev unavailable: 1 of 1 requests failed, first: no answer for …`
  - `… flagged 0 · … · failed 1 …`
- **L1**: a `null` stub prints `Jev unavailable … response body is not a JSON object` (test 16). The old output was `claim-check crashed`.
- **M2**:
  - `--details-out` on PR #308's published body writes a file whose first line is `<details><summary>Claim check (log-only, #302): 9 flagged, 1 to re-derive</summary>`.
  - The shell had a live `TYPESAFE_API_KEY` (length 108). This was therefore a real Jev call on the already-public body: `units 72 · questions 90`.
  - The file holds 2 `<details>`: the summary line, and one inside the fenced text.
  - The PR body's rendered HTML check is below, under "PR body".

## Validation

`observed` 2026-09-30:

- **`node --test`** in the package: `# tests 25`, `# pass 22`, `# fail 0`, `# skipped 3` (after 16b; `# pass 21` at `89d485a`).
- **Under turbo**: `pnpm turbo run test --filter @taxi/pr-scripts --force` at `a068261`: `# pass 21`, `Tasks: 1 successful, 1 total`, `0 cached`.
- **Live**: `CLAIM_CHECK_LIVE=1` gives `# pass 24`, `# fail 0`, `# skipped 0` (08:25Z). L2 is #302's derived-figure edge case.
- **Full gate**: not run locally.
  - `wt-302` has no env file, and the hook blocks copying one in.
  - Other sessions were live: `ps aux | grep -c "[c]laude"` printed 23. That count includes any process line containing "claude", so it is an upper bound on sessions, not a count of them.
  - The gate for this change is CI's `check` job on the pushed head, cited in the PR body.
  - The diff touches only `.claude/` and the `@taxi/pr-scripts` package. No `package.json`, `turbo.json` or workspace file changed, so the task count stays 23.

## Stale-copy sweep

Every `grep -n` below ran on the fixed tree, 2026-09-30. "Body" means the published body before the edit, `gh pr view 308 --json body`.

| Retired value or noun | Plan | Report | Body before | Resolution |
|---|---|---|---|---|
| `always exits 0` | `:29` "except on a usage error" (true, kept). `:653` now quotes it as corrected | `:10` "except on usage (2)" (true, kept) | 0 | `SKILL.md` Phase 2.5 corrected |
| `origin/main..HEAD` (two-dot) | 0 | 0 | 3 | Size bullet → three-dot. The 2 hits inside log entry 1 are its quoted sentence, a record of the `acb3f63` run, kept. The fragment copy was deleted with M2 |
| `1897` | 0 | 0 | 6 | Size bullet re-derived at `a068261` (the body carries the current head's total). The other hits are log entry 1 (kept) and the deleted fragment |
| `12 offline` | 0 | `:28` now says "at `acb3f63`" and adds 21 | 3 | Tests bullet re-derived at `a068261` (the body carries the current count) |
| `pass 12` | 0 | `:32`, `:53` are gate runs at named heads (kept) | 3 | The body's line sits under the `acb3f63` gate it came from, kept. The fix-pass figures are added |
| `487` | 0 | D6 now adds 516 | 9 | D6 → "487 at `acb3f63`" plus the final head's count. The per-file split is re-derived |
| `claim-check.mjs:<n>` citations | 0 | 0 | 0 | none to move |
| `Paste its` (`<details>` from stdout) | `:654` → "the `--details-out` file" | 0 | 0 | `SKILL.md` corrected |

## PR body

- **M2**: body lines 123–197 (the fragment plus the outer copy of the verdict list) are deleted. Log entry 1 is kept byte-for-byte from its `<details><summary>` line, with a sentence saying it records the `acb3f63` run.
- **L-new**, and the figures that the fix commit changed: re-derived as in the sweep table.
- The check on the rendered HTML follows the edit. Its result is in the PR comment for this round.

## Needs a human look

- Log entry 1's six flags were rejected 6 of 6 by the review. Round 2 compares against the same entry. No new entry was pasted, because the fix pass changed no body claim that the check judges.
