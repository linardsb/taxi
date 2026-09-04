---
name: piv-validate
description: Runs this project's full validation suite — tests, type checks, and linting across every part of the stack — then reports overall health. Use before committing, before opening a PR, or after finishing a chunk of work to confirm zero regressions.
---

# Validate

Run every check this project has and report a single PASS/FAIL verdict.

This is a pnpm/turbo monorepo. **One command is the gate** — `pnpm check` at the repo root fans out
`typecheck`, `lint`, and `test` to every workspace package via turbo. Run it from the repo root.

**Prerequisite:** integration tests (e.g. `@taxi/db` against Postgres/PostGIS) need the docker services up:

```bash
docker compose up -d --wait   # postgres+postgis, redis — idempotent, safe to re-run; needs .env for REDIS_PORT
```

Run the checks in order. Keep going after a failure so the report covers everything, and capture the
output of any command that fails.

## 1. The gate — full monorepo check

```bash
pnpm check                    # turbo run typecheck lint test — all packages
```

**Expected:** every task green. Turbo's summary names any failing package/task.

Redirect to a scratchpad log; cap the Bash timeout at ~5 min. A quiet gate is read from the log (step 3).

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
  sockets open (healthy: 60–90 s, PR #139). `grep -E "Tasks:|●.*›"` the log, re-run those alone with `--forceExit`.
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
  slow step, not to drop it from the checker.
- A checker that cannot fail is worthless. If `pnpm check` passes suspiciously fast, confirm turbo
  actually ran the tasks (cache hits are fine; missing tasks are not).
- A green gate is not a green CI: on a cold volume a container healthcheck can report healthy before
  the real server is up — #6, and why compose's db probe is TCP `pg_isready`, not the socket.
