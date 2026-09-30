# PR #308 review fixes, round 2

**Review**: PR comment 5909667624 (round 2 at `260e57c`; local copy `.claude/code-reviews/pr-308-review-round-2.md` in the main checkout) · **Fix commit** `5010e80` · 2026-09-30

## Triage

No scope steer came with the review. All five findings are Low and each is a few lines inside this PR's own files, so all five were fixed here. Nothing was deferred and no issue was filed.

## Fixed

| Finding | What was wrong | Fix | Test | Red on `260e57c` |
|---|---|---|---|---|
| N1 | A key with a trailing CR (a CRLF env file) was refused. Before the H1 check, fetch trimmed it and sent it | `main` trims leading and trailing `[\t\n\r ]` before the printable-ASCII check. An interior newline is still refused (test 12 unchanged, green) | 19: key `' dummy\r\n'`, stub records `Authorization: Bearer dummy`, 1 hit, no refusal note | yes: the refusal note printed |
| N2 | A crash left the previous run's `--details-out` file in place, and Phase 2.5's fallback did not cover it | `main` deletes a set `--details-out` file right after argument parsing (`rmSync`, `force`). `SKILL.md` Phase 2.5: on `claim-check crashed`, write `Claim check: crashed, nothing judged` and never paste an earlier file | 20: seed a stale file, `chmod 000` the draft, run: crash note printed, file gone | yes: `existsSync` true |
| N3 | The collapsed summary line of a run Jev never judged read like a clean run | The summary keeps the plan's `F flagged, E to re-derive` prefix and appends ` · Jev unavailable` (no verdicts) or ` · Jev not called` (requests but no key). Plan task text updated | 21: `200 {}` stub and a no-key run, both through `--details-out`, first line asserted | yes: summary had no suffix |
| N4 | The round-1 fixes report restated body figures (`origin/main...a068261`, 2027, 21) that later commits moved | Those cells now say the figures were re-derived at `a068261` and that the body carries the current head's values | none (prose) | — |
| N5 | `--eval` printed `model` and `choice` raw | `evalSet` passes both through `oneLine` | 22: stub answers `model` and `choice` with an embedded newline; output holds them on one line | yes: `\ninjected` in stdout |

**Reviewer's own inputs, run verbatim** (scratchpad `probe.mjs`, 2026-09-30, fixed tree then `260e57c` via `git stash`):

- N1, key `realkey\r`: fixed sends `Bearer realkey`, no note. `260e57c` sends nothing and prints the refusal note.
- N2, run with `--details-out dd.md`, `chmod 000` the draft, run again: fixed prints the crash note and `dd.md` is gone. `260e57c` prints the crash note and `dd.md` is still there.
- N3 and N5 are covered by tests 21 and 22 against the reviewer's stated shapes (`200 {}`, no key; a multi-line server string).

**New behaviour to know about (N2):** the file is deleted before the body path is checked. Passing the draft itself as `--details-out` now deletes it and exits 2 (`cannot read file`); before, the draft was overwritten with the block after it was read. Both destroy the draft; only the order changed.

## Validation

- `pnpm turbo run typecheck lint test build --force` in the worktree with `COMPOSE_PROJECT_NAME=taxi`, on the tree committed as `5010e80`: exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached, 23 total`, `Time: 1m47.773s` (observed 2026-09-30). No other gate was running (`ps`).
- In the same log, `@taxi/pr-scripts:test`: `# tests 29`, `# pass 26`, `# fail 0`, `# skipped 3`. 26 = 22 offline at `260e57c` + 4 (tests 19–22); the 3 skipped are the live tests.
- `claim-check.mjs` is 521 lines (`wc -l`), up from 516. `scripts/` is outside `max-lines`.

## Figure sweep

Retired or moved values: `grep -nE "22 offline|\b516\b|pass 22|2143|260e57c|F flagged, E to re-derive"` over the plan and both reports on the fixed tree (line numbers are after the edit), and the published body before its edit (`gh pr view 308 --json body`):

| Value | Plan | Impl report | Round-1 fixes report | Body before | Resolution |
|---|---|---|---|---|---|
| `22` offline | 0 | `:29` ("at `260e57c`", then 26) | `:59` `# pass 22` (dated "after 16b", kept) | `:29`, `:66` | Impl report: "22 at `260e57c`" plus 26. Body Tests bullet → 26; `:66` sits under the `260e57c` CI run it quotes, replaced by this head's run |
| `516` | 0 | `:122` (both heads named) | `:79` ("D6 now adds 516", still true) | `:49`, `:52`, `:264` | Impl report D6 adds 521. Body size split and D6 re-derived at the new head |
| `2143` | 0 | 0 | 0 | `:46`, `:52` | Body Size bullet re-derived at the new head |
| `260e57c` (as current head) | 0 | 0 | 0 | `:46`, `:58`, `:264` | Body moved to the new head |
| summary shape `F flagged, E to re-derive` | `:478` | 0 | `:50` (a quoted run, kept) | log entry 1 (a record of `acb3f63`, kept) | Plan `:478` notes the suffix |

## Needs a human look

- None beyond the merge. Log entry 1 in the body still records the `acb3f63` run and was not re-run; no body claim the check judges changed in this pass.
