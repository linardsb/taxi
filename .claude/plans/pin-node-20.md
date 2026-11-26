# Feature: pin-node-20 (#333)

## Feature Description

Pin the local Node major to the one CI runs (20) so `@taxi/dispatch` tests stop going red on Node 25+, where built-in Web Storage (on by default from Node 25, per the [v25.0.0 release notes](https://nodejs.org/blog/release/v25.0.0); observed on 26) replaces jsdom's `localStorage` in the Vitest workers.

## User Story

As the solo developer
I want the repo to state the Node version it is tested on
So that a local `pnpm check` matches CI instead of failing on Node 26.

## Problem Statement

Issue #333: on Node v26.13.1, `pnpm --filter @taxi/dispatch test` reports 133 failed tests; with `NODE_OPTIONS=--no-experimental-webstorage` all pass (issue, `observed` by its author). CI runs Node 20 (`.github/workflows/ci.yml:50`). The repo has no `.nvmrc`, no `.node-version` and no root `engines` (root `package.json` at `b890929`).

## Solution Statement

Decided in the issue (option O1 from the PR #332 review session), inherited, not re-opened:
1. `.nvmrc` containing `20`.
2. Root `package.json` `"engines": { "node": ">=20 <21" }`.
3. One line under `## Commands` in `CLAUDE.md`.

## Out of Scope / Non-Goals

- Upgrading CI's Node (issue scope).
- Passing the web-storage flag in `apps/dispatch/vitest.config.ts`, or in the stop hook (rejected in the issue).
- `eas.json` `node` pin (see Open Questions).

## Feature Metadata

Type: Bug fix (toolchain). Complexity: Low. Affected: repo root only.

## Related Work

- PR #332 (`chore/cap-test-parallelism`, open): adds `--concurrency=4` to the gate. Not merged at plan time, so the gate here runs without it (AC2).

## CONTEXT REFERENCES

### Relevant Codebase Files

- `package.json` — root manifest; `engines` goes after `packageManager`.
- `.github/workflows/ci.yml:48-50` — `actions/setup-node@v4`, `node-version: 20`. Not edited (AC3).
- `services/api/Dockerfile:36` — `FROM node:20-bookworm-slim`; already Node 20, consistent.
- `.npmrc` — holds `node-linker=hoisted`; `engine-strict` would go here, and is not added (AC4).
- `CLAUDE.md` `## Commands` block.

### Facts verified during planning (`observed`, this session, worktree at `b890929`)

- No Node 20 on this machine: no nvm/fnm/volta/asdf; `/opt/homebrew/bin/node` is v26.13.1. Node 20 for validation is the npm `node@20` package (v20.20.2) fetched with `npx`, symlinked into the scratchpad and put first on `PATH`.
- With the `engines` field and Node 26, `pnpm install --frozen-lockfile --offline` exits 0 and prints ` WARN  Unsupported engine: wanted: {"node":">=20 <21"} (current: {"node":"v26.13.1","pnpm":"10.33.2"})`; `pnpm exec` prints the same warning. (Pre-amendment range; behaviour unchanged. Under the shipped field the warning reads `wanted: {"node":">=20.19.4 <21"}`, observed in the PR #335 review at `57ccd0d`.)
- With `--config.engine-strict=true`, both `pnpm install` and `pnpm --filter @taxi/shared exec node -v` exit 1 with `ERR_PNPM_UNSUPPORTED_ENGINE`.
- Dependency floors: `react-native@0.86.3` and `metro@0.84.5` declare `^20.19.4 || ^22.13.0 || ^24.3.0 || >= 25.0.0`; `next@16.3.4` `>=20.9.0`; all others checked admit 20.
- `apps/*/eas.json` has no `node` key, so EAS builds on the image default. Expo's docs say the default tracks the current LTS; no source found states the SDK 57 image's Node.

## IMPLEMENTATION PLAN

### CREATE `.nvmrc`
- Content: `20` plus newline.
- VALIDATE: `cat .nvmrc` prints `20`.

### UPDATE `package.json`
- Add `"engines": { "node": ">=20.19.4 <21" }` after `packageManager`, 2-space JSON (Q1, amended 2026-11-26).
- VALIDATE: `node -p "require('./package.json').engines.node"` prints `>=20.19.4 <21`.

### UPDATE `CLAUDE.md`
- One line under `## Commands`, before the code block: use Node 20 (≥20.19.4), the version CI runs; `nvm install` reads `.nvmrc` and installs the newest 20.x; Node 25+'s built-in `localStorage` breaks the dispatch tests (#333). (Amended by PR #335 review L1, L2.)
- VALIDATE: `git diff CLAUDE.md` is one added line.

## TESTING STRATEGY

No code changes, so no new test files; the "tests" are the ACs run under Node 20.
- Expected: dispatch suite green under Node 20 with no `NODE_OPTIONS`.
- Edge: Node 26 install still works, with a warning (observed above).
- Failure: `engine-strict` refuses Node 26 (observed above) — the reason it is not enabled.

## VALIDATION COMMANDS

Run in the worktree with `PATH=<scratchpad>/node20/bin:$PATH`, `COMPOSE_PROJECT_NAME=taxi`, the main checkout's `.env`, and `REDIS_TEST_URL` set to its `REDIS_PORT`:

1. `pnpm install --frozen-lockfile` (reinstall under Node 20); `pnpm exec node -v` prints v20.
2. `env -u NODE_OPTIONS pnpm --filter @taxi/dispatch test` — record counts.
3. `pnpm turbo run typecheck lint test build --force` — record result. No `--concurrency=4` while #332 is open.

## ACCEPTANCE CRITERIA

1. Dispatch tests pass under Node 20, no `NODE_OPTIONS`; counts recorded `observed`, with the Node binary named (npx `node@20`, not nvm).
2. Gate green under Node 20.
3. CI `check` green, `ci.yml` unchanged — pending until the PR runs (this loop ends at commit).
4. `engine-strict` decision recorded: **not enabled**. Reason: it turns any non-20 Node into a hard `pnpm install`/`pnpm exec` failure, and EAS builds (`apps/*/eas.json`, no `node` key) run on an image default Node that tracks LTS and is not documented for SDK 57. Strict mode could break the driver APK build. The default warning gives the signal without that risk.

## OPEN QUESTIONS / ASSUMPTIONS

- Q1: `>=20 <21` admits 20.0–20.19.3, below React Native/metro's `^20.19.4` floor. Shipped as the issue specifies; `.nvmrc` `20` resolves to the newest 20.x, which is above the floor. (Holds for `nvm install` and CI's `setup-node` only: `nvm use` picks the newest 20.x already installed, which can be below the floor; PR #335 review L2.) Tighten to `>=20.19.4 <21` if wanted.
- Q2: pin `"node"` in `apps/*/eas.json` build profiles to match? Out of scope here; a candidate follow-up.
- This change does not by itself make the stop hook or local `pnpm check` green on this machine: both use `/opt/homebrew/bin/node` (v26) until Node 20 is installed and on `PATH` (owner action).

## AMENDMENTS

- 2026-11-26: Q1 resolved by the owner. `engines.node` tightened from the issue's `>=20 <21` to `>=20.19.4 <21`, the floor `react-native@0.86.3` and `metro@0.84.5` declare. Supersedes Solution Statement item 2 and the Q1 bullet.
