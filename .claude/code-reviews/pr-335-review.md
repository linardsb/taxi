# PR #335 review, round 1: fix(config): pin local Node to 20 to match CI

**Head** `57ccd0d` · **Base** `main` @ `b8909290ae2c93660fd0bfa127c188a5eeb064e1` · Fixes #333 · Reviewed 2026-11-26

**Recommendation: Approve.** 0 Critical, 0 High, 0 Medium, 5 Low. All five are prose fixes or follow-ups. None of them changes the shipped config (`.nvmrc`, `engines`).

## Summary

The PR adds `.nvmrc` = `20`, a root `engines.node` of `>=20.19.4 <21`, and one line in `CLAUDE.md`. It matches the issue's chosen option O1, apart from one documented deviation: the floor is tightened to 20.19.4 (plan AMENDMENTS, owner-approved). `ci.yml` is unchanged. `engine-strict` is off on purpose (AC4). Its refusal was observed, not assumed, and the reason not to enable it (the EAS image's Node is undocumented) is argued in the plan.

This is the first round, so the guarantees pass and the fix-mechanism pass do not apply. The base is unmoved: the live tip `origin/main` equals `baseRefOid`, both `b890929`.

## Validation

| Check | Result | Provenance |
|---|---|---|
| `pnpm turbo run typecheck lint test build --force`, Node v20.20.2 (npm `node@20` on `PATH`), `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://localhost:6379`, worktree at `57ccd0d` | exit 0, `Tasks: 23 successful, 23 total`, `Cached: 0 cached`, `Time: 48.677s` | observed, this review |
| Per-package tests in that run | shared 320/320 (31 files), driver 364/364 (46 suites), dispatch 347/347 (37 files), rider 231/231 (37 suites), db 17/17 (3 files), api 999/999 (95 suites, 0 skipped) | observed, this review |
| Control: `env -u NODE_OPTIONS pnpm --filter @taxi/dispatch test` under `/opt/homebrew/bin/node` v26.13.1, same tree | exit 1, `Test Files 15 failed \| 22 passed (37)`, `Tests 129 failed \| 218 passed (347)`; prints `WARN Unsupported engine: wanted: {"node":">=20.19.4 <21"}` | observed, this review |
| CI `check` | pass (3m14s) | observed, `gh pr checks 335` |
| CI `audit-diff`, `codeql`, `CodeQL` | pass | observed, `gh pr checks 335` |

## Issues

### Low

**L1. `CLAUDE.md:32`: "newer Node" covers more versions than break.** Web Storage is on by default only from Node 25 (issue #333). Node 21 to 24 keep it behind a flag. As written, the line suggests that 22 and 24 also break the dispatch tests, and the repo's claim rule asks for the case to be named.
Fix: "Node 25+'s built-in `localStorage` replaces jsdom's…".

**L2. `CLAUDE.md:32`, plan `:94`, report `:30`: `nvm use` does not guarantee the 20.19.4 floor.** With `.nvmrc` = `20`, `nvm use` picks the newest 20.x *already installed*, so a machine with only 20.18 gets a version below `engines`, and pnpm only warns. With no 20.x installed it errors, which is this machine's state. Plan Q1's "`.nvmrc` `20` resolves to the newest 20.x" holds only for `nvm install` and for CI's `setup-node`. The AMENDMENTS entry supersedes the Q1 bullet but leaves that sentence standing.
Fix: in `CLAUDE.md:32` and report `:30`, say `nvm install` (it reads `.nvmrc`, installs the newest 20 and switches to it), or name the floor: "Node 20 (≥20.19.4)".

**L3. Plan `:51`: a recorded output that the shipped file no longer produces.** The line records `wanted: {"node":">=20 <21"}`, observed before the amendment. Under the field as shipped, pnpm prints `>=20.19.4 <21` (observed in this review's control run). AMENDMENTS (`:100`) supersedes Solution item 2 and Q1, but not this line.
Fix: mark it "(pre-amendment range; behaviour unchanged)", or replace it with the re-observed output above.

**L4. Pre-existing, follow-up: `services/api/package.json:56` has `"@types/node": "^24.0.0"`.** The API typechecks against Node 24 type definitions but runs on 20 everywhere: `engines`, `ci.yml:50`, and `services/api/Dockerfile:36,80`. So typecheck can accept an API call that exists only in Node 22 or 24 and fails at runtime on 20. `apps/dispatch/package.json:27` already uses `^20`. This PR did not cause it, but it is now the only place in the repo that states a Node version different from the pin.
Fix: a separate ticket that moves `services/api` to `@types/node` `^20` and runs the gate.

**L5. Follow-up: Node 20 is past end-of-life.** The Node release schedule gives 2026-04-30 as Node 20's end-of-life date (expected; recalled from the published schedule, not fetched in this review). This PR correctly matches CI rather than upgrading it, which is out of scope per the issue. The pin now makes the EOL major explicit, so a ticket to move CI, Docker and `.nvmrc` together to a supported LTS is the natural next step. `ci.yml:50` could then read `node-version-file: .nvmrc`, so the version lives in one place.

## Checked, no finding

- `services/api/Dockerfile:36,80` use `node:20-bookworm-slim`. That tag floats to the newest 20.x, above the floor.
- `.github/workflows/deploy.yml` has no `setup-node`. `ci.yml:50` is `node-version: 20`, and the citation is correct.
- `.npmrc` holds only `node-linker=hoisted`, with no `engine-strict` (AC4).
- There is no `.node-version`, `.tool-versions`, `volta` or `use-node-version` file. No workspace package declares its own `engines`. `apps/*/eas.json` has no `node` key, and the plan scopes that out as Q2.
- Dependency floors re-read from `node_modules`: `react-native@0.86.3` and `metro@0.84.5` declare `^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`, and `next@16.3.4` declares `>=20.9.0`. All three match the plan.
- PR #332 is still `OPEN`, so it is correct that the gate ran without `--concurrency=4`.

## Numbers pass

| Figure (PR body / report) | Label | Re-derived |
|---|---|---|
| Node 20: 37/37 files, 347/347 tests | observed | reproduced exactly |
| Node 26: 15 failed of 37 files, 129 failed of 347 tests | observed | reproduced exactly |
| Gate: 23/23 tasks, per-package counts, api 999 with 0 skipped | observed | reproduced exactly (time differs: 49.9 s vs 48.7 s) |
| Issue's 38 files / 367 tests vs 37 / 347 here | explained by a different base (`feature/protected-record-layer-316` vs `b890929`) | not re-run on that branch; the explanation is plausible and the PR does not depend on it |
| `engines` floor 20.19.4 | derived from dependency `engines` | confirmed from `node_modules` |
| Node 26 `WARN Unsupported engine … >=20.19.4 <21` at `57ccd0d` | observed | reproduced exactly |

The Node 20 vs Node 26 control changes only the Node binary, so it does isolate the cause it is credited with.

### Claim-check comparison

Claim check flagged 0. Confirmed 0, rejected 0. Figure findings it missed in the PR body: 0. L3 is a figure finding, but it sits in the plan, which claim check does not scan.

## What is done well

- The control run isolates the cause. The tree and command were held constant, and only the Node binary changed.
- The `engine-strict` refusal was observed before it was rejected, and the EAS risk behind the decision is stated with sources.
- The floor comes from what the dependencies declare, not from a guess.
- The report says plainly that the change does not make local `pnpm check` or the stop hook green on this machine until Node 20 is on `PATH`.
- The diff is minimal: no CI or vitest edits, as the issue chose.

## Next

Optional: run `piv-fix-review-findings` for L1 to L3, which are prose only. L4 and L5 are candidate follow-up issues. A human reviews and merges.
