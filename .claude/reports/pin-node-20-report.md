# Implementation Report — pin-node-20 (#333)

**Plan**: `.claude/plans/pin-node-20.md`   **Branch**: `fix/pin-node-20-333` (worktree `../taxi-node20-333`, base `origin/main` `b890929`)   **Status**: COMPLETE (AC3 pending CI)

## Summary
Pinned local Node to CI's major: `.nvmrc` = `20`, root `engines.node` = `>=20 <21`, and one line under `## Commands` in `CLAUDE.md`. `engine-strict` is not enabled (AC4).

## Tasks completed
- `.nvmrc` (CREATE)
- `package.json` (UPDATE): `engines` after `packageManager`
- `CLAUDE.md` (UPDATE): one line under `## Commands`

## Tests added
None. The change has no code; the ACs are runs under Node 20.

## Validation results
Node 20 here is the npm `node@20` package (v20.20.2), fetched with `npx` and put first on `PATH`. nvm is not installed on this machine, so `nvm use` was not what selected it. `pnpm exec node -v` printed `v20.20.2` through that `PATH`. `pnpm install --frozen-lockfile` ran under v20.20.2 and reported `added 0`, so it reused the existing install.

- AC1 `observed`: `env -u NODE_OPTIONS pnpm --filter @taxi/dispatch test` under v20.20.2 → `Test Files 37 passed (37)`, `Tests 347 passed (347)`, exit 0. The counts are lower than the issue's 38/367 because the issue ran on `feature/protected-record-layer-316`, and this base is `origin/main` `b890929`.
- Control `observed`: the same command and tree under `/opt/homebrew/bin/node` v26.13.1 → `Test Files 15 failed | 22 passed (37)`, `Tests 129 failed | 218 passed (347)`, exit 1. Only the Node binary changed between the two runs.
- AC2 `observed`: `pnpm turbo run typecheck lint test build --force` under v20.20.2, with `COMPOSE_PROJECT_NAME=taxi` and `REDIS_TEST_URL=redis://localhost:6379` → exit 0, `Tasks: 23 successful, 23 total`. `@taxi/api` reported `Tests: 999 passed, 999 total` with 0 skipped, because `REDIS_TEST_URL` was set. No `--concurrency=4`, because PR #332 was still open.
- AC3: pending. CI runs on the PR. `ci.yml` is untouched (`git diff --stat` lists no workflow file).

## Deviations from the plan
None.

## Issues encountered
- A fresh worktree has no built `@taxi/shared`. A bare `pnpm --filter @taxi/dispatch test` fails all 37 files with `Failed to resolve entry for package "@taxi/shared"` until `pnpm turbo run build --filter=@taxi/shared --filter=@taxi/db` has run. The gate builds dependencies itself.
- The hook refuses to copy the main checkout's `.env`, so the worktree uses `.env.example`. Its `REDIS_PORT=6379` matches the running `taxi-redis-1`.
- Owner action: this change does not make local `pnpm check` or the stop hook green on this machine. Both still resolve `/opt/homebrew/bin/node` (v26) until Node 20 is installed and on `PATH` (for example nvm, then `nvm use`).
