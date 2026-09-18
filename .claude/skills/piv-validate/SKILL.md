---
name: piv-validate
description: Runs this project's full validation suite — tests, type checks, and linting across every part of the stack — then reports overall health. Use before committing, before opening a PR, or after finishing a chunk of work to confirm zero regressions.
---

# Validate

Run every check this project has and report a single PASS/FAIL verdict.

This is a pnpm/turbo monorepo. **One command is the gate** — `pnpm turbo run typecheck lint test build
--force` at the repo root, which is what `.github/workflows/ci.yml` runs and what CLAUDE.md calls the
validation gate. Run it from the repo root.

**`pnpm check` is NOT the gate, and this skill said it was until #229.** `pnpm check` is
`typecheck lint test` — it omits `build`, and without `--force` it can ride a warm `dist`. Two of the
signatures in step 3 cannot fire under it at all: the TS6053 stale-`.next` race needs `next build` to be
running, and a package whose `build` is broken while its tests pass is invisible. Use `pnpm check` for
the quick inner loop; run the gate before a commit, a PR, or any PASS verdict this skill reports.

**Prerequisite:** integration tests (e.g. `@taxi/db` against Postgres/PostGIS) need the docker services up:

```bash
docker compose up -d --wait   # postgres+postgis, redis — idempotent, safe to re-run; needs .env for REDIS_PORT
```

Run the checks in order. Keep going after a failure so the report covers everything, and capture the
output of any command that fails.

## 1. The gate — full monorepo check

```bash
pnpm turbo run typecheck lint test build --force   # CI parity — all packages, cold
```

**Expected:** every task green. Turbo's summary names any failing package/task, and the task count is
the check on the run itself: `Tasks: 22 successful, 22 total` at 2026-09-18's head. Fewer tasks than the
graph is a *short* gate, not a pass — `.claude/skills/piv-create-pr/scripts/record-gate.sh` derives the
expected count from `turbo --dry=json` and prints the holes, so prefer it when the number will be
quoted anywhere.

In a worktree, prefix `COMPOSE_PROJECT_NAME=taxi` — compose names its project after the directory and
otherwise starts a second Postgres against the occupied 5432.

Redirect to a scratchpad log; cap the Bash timeout at ~10 min (the gate is 60–90 s of test time but
`--force` rebuilds every package). A quiet gate is read from the log (step 3).

## 2. Narrow a failure (only if step 1 failed)

Re-run just the failing package to get clean output:

```bash
pnpm --filter @taxi/shared test       # or @taxi/api, @taxi/db, @taxi/rider, …
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/api lint
```

## 3. Environment or code? (classify before touching the diff)

Turbo's `Failed: <task>` line names the task that actually failed; the other `ELIFECYCLE` lines are
siblings it killed, so one dead service reads as a broad code failure. None of the signatures below is
your diff — report it with that line as evidence, do not edit toward green.

- `@taxi/db#test` red with `Cannot connect to the Docker daemon` — docker is down (#94). `colima start`;
  on a stale disk lock, `LIMA_HOME=~/.colima/_lima limactl disk unlock colima` first.
- No output past ~3 min, `@taxi/api:test` still running — a red api suite, not a slow one: jest holds
  sockets open (healthy: 60–90 s, PR #139). `grep -E "Tasks:|Test Suites:|FAIL |●.*›"` the log, re-run those alone with `--forceExit`.
- The same silence in a worktree with `REDIS_TEST_URL` set — no `.env`, so `taxi-redis-1` never came up
  and ioredis retries a closed port forever (#19). `docker ps` first; the hook blocks the agent, so
  Linards runs `cp ../taxi/.env .`.
- `@taxi/dispatch#typecheck` TS6053 `.next/types/*.ts not found` at ~25 s — a stale `apps/dispatch/.next`
  racing `next build`, not code. `find apps/dispatch/.next -delete`, re-run.

## 4. Optional — live API smoke test

Only when the change touches `services/api` bootstrap, routing, or middleware; skip when the jest
suite already exercises the app in-process (it usually does via `@nestjs/testing`).

```bash
# from repo root, docker services already up
pnpm --filter @taxi/api dev
```

Prefer starting the server in a second shell, confirm Nest logs a clean startup (no unresolved
providers, listening on its port), then stop it with Ctrl-C. There is no dedicated health endpoint
yet — a clean boot is the smoke signal.

## 5. Summary report

Report each check with a ✅ or ❌, then an overall verdict:

- One line per check (typecheck / lint / test, plus smoke test if run)
- **Overall: PASS or FAIL**

For every ❌, include the failing command and the relevant output. Do not fix anything here —
this skill reports; fixing is a separate step.

## Notes

- Keep this skill fast. It runs before every commit; if a step gets slow, that is a signal to fix the
  slow step, not to drop it from the checker. Fast does not mean `pnpm check`: dropping `build` to save
  a minute is dropping a check, which is the previous bullet's trade in the other direction.
- A checker that cannot fail is worthless. If the gate passes suspiciously fast, confirm turbo actually
  ran the tasks: `Tasks: N successful, N total` is where you read that, and `Cached: 0 cached, N total`
  beside it is what says the run was cold (`observed` — both `record-gate.sh` runs on 2026-09-18, at
  `b392188` and `900dd19`, printed `0 cached, 22 total`). A count short of the graph is a *short* gate,
  not a pass.
- **A green gate is not a green CI.** On a PR that touches `compose.yml`, `.github/workflows/*.yml` or a
  healthcheck, run `gh run list --branch $(git branch --show-current) --limit 1` and report CI's verdict
  beside your own: on a cold volume a container healthcheck can report healthy before the real server is
  up — #6, and why compose's db probe is TCP `pg_isready`, not the socket.
