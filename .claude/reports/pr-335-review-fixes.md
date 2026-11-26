# PR #335 review fixes, round 1

**Review** `.claude/code-reviews/pr-335-review.md` (0 Critical, 0 High, 0 Medium, 5 Low) · **Base of fixes** `57ccd0d` · 2026-11-26

No scope steer was given. Triage follows the review's own split: L1–L3 fixed (prose only), L4–L5 deferred. No shipped config changed (`.nvmrc`, `engines`), so there is no new test; each finding closes on a grep, listed below.

## Fixed

**L1 "newer Node" covers more versions than break.** Replaced with "Node 25+" in `CLAUDE.md:32`, plan `:5`, plan `:67` and PR body `:3`. Provenance: Web Storage on by default from v25.0.0 per the [release notes](https://nodejs.org/blog/release/v25.0.0) (fetched via web search this session); observed breaking on v26.13.1 (review control run). Issue #333 does not name the version, so it is not cited for it. Node 21–24 are not claimed either way.

**L2 `nvm use` does not guarantee the 20.19.4 floor.** `CLAUDE.md:32` now says "Node 20 (≥20.19.4)" and `nvm install` (reads `.nvmrc`, installs and switches to the newest 20.x). Report `:30` says `nvm install` and why `nvm use` can land below the floor. Plan Q1 (`:94`) keeps its pre-amendment sentence with a qualifier that it holds for `nvm install` and `setup-node` only. Plan `:67` updated to the new line.

**L3 plan `:51` records a pre-amendment warning.** Marked "(pre-amendment range; behaviour unchanged)" with the re-observed `wanted: {"node":">=20.19.4 <21"}` from the review run at `57ccd0d`.

## Sweep (run 2026-11-26T19:48Z, against the fixed tree and the edited PR body)

Files: `CLAUDE.md`, `.claude/plans/pin-node-20.md`, `.claude/reports/pin-node-20-report.md`, PR body.

| `grep -n` | Hits | Disposition |
|---|---|---|
| `'newer Node'` | 0 | L1 closed |
| `'nvm use'` | plan `:94`, report `:17`, report `:30`, PR body `:23` | `:94` and `:30` now state the limitation (L2). Report `:17` and PR body `:23` say `nvm use` did *not* select the Node used in validation, which is still true. |
| `'">=20 <21"'` | plan `:21`, plan `:51` | `:21` is Solution item 2, superseded by AMENDMENTS `:100`. `:51` is marked pre-amendment (L3). |

## Deferred

L4 (`services/api` `@types/node` `^24` against Node 20 runtime) and L5 (Node 20 EOL; move CI, Docker, `.nvmrc`, `engines` together, `node-version-file: .nvmrc`) are Low. Appended as two checklist lines to **#13** (Deploy: Hetzner, a ticket of epic #1), which owns `services/api/Dockerfile:36,80`, the runtime Node both findings depend on. L5's EOL date is labelled `expected` there, as in the review.

## Manual look

None.

## Validation

`observed`, 2026-11-26, worktree at `57ccd0d` plus these edits, Node v20.20.2 (npm `node@20` first on `PATH`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6379`, no `--concurrency=4` (#332 open): `pnpm turbo run typecheck lint test build --force` → exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached, 23 total`, `Time: 49.316s`. Test counts unchanged from the review: shared 320, driver 364, rider 231, db 17, dispatch 347, api 999 (95 suites, 0 skipped).
