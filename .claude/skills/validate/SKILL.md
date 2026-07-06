---
name: validate
description: Runs comprehensive project validation — tests, type checks, linting, builds, and a live API smoke test — and reports overall health. Use before committing or after finishing a chunk of work to confirm zero regressions.
---

# Validate

Run comprehensive validation of the monorepo and report results. Adapted for the Sakta Cab stack (pnpm + Turborepo, NestJS API, Expo, Next.js).

## 1. Static gates + tests (all workspaces)

```bash
pnpm turbo run typecheck lint test
```

**Expected:** every task green. Scope to one package while iterating: `pnpm --filter @taxi/api test`.

## 2. Builds

```bash
pnpm turbo run build
```

**Expected:** `@taxi/shared`, `@taxi/api`, and both Next.js apps build clean. (Expo apps have no build task; their gate is typecheck.)

## 3. Live API smoke test

Ensure infra is up, then start the API and probe it:

```bash
docker compose up -d
pnpm --filter @taxi/api start &
sleep 5
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:3001/health
```

**Expected:** `HTTP 200`. Stop with `lsof -ti:3001 | xargs kill -9 2>/dev/null || true`.

## 4. Summary report

- Typecheck / lint / test / build status per workspace
- API smoke-test status
- Any errors or warnings encountered
- Overall health assessment (PASS/FAIL)

**Format the report clearly with sections and status indicators (✅/❌)**

## Notes

- Ports and env come from `.env` (see `.env.example`); API default port 3001.
- Two-attempt cap on fixing a failing gate — after two failed fix attempts, stop and hand back to Linards with the error output.
