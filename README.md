# Sakta Cab (working repo name: taxi)

Taxi booking platform for Latvia — driver-first Bolt competitor. Rider + driver mobile apps (Expo), dispatcher portal + admin panel (Next.js), realtime backend (NestJS + PostGIS + Redis).

**Start here:** `CLAUDE.md` (conventions) · `docs/skeleton-proposal.md` (architecture + all decisions) · `docs/prd/00-lean-prd.md` (the hypothesis gate, living draft pending anketa results).

> The root `app/` + `backend/` folders are the **Sakta Cab anketa** — a separate research questionnaire mini-project (see `PLAN.md`, `DEPLOY.md`). Not part of the monorepo workspace.

## Quick start

```bash
cp .env.example .env     # first — compose reads REDIS_PORT from it; set 6381 if 6379 is taken
docker compose up -d --wait   # postgres+postgis :5432, redis :$REDIS_PORT — blocks until healthy
pnpm install
pnpm check               # typecheck + lint + test everywhere
pnpm --filter @taxi/api dev        # API on :3001
pnpm --filter @taxi/dispatch dev   # dispatcher portal on :3000
pnpm --filter @taxi/rider dev      # Expo dev server (rider app)
```

## Workspaces

| Package | Surface |
|---|---|
| `@taxi/rider` | client mobile app (Expo) |
| `@taxi/driver` | driver mobile app (Expo) |
| `@taxi/dispatch` | web app: dispatcher console + admin routes (Next.js) |
| `@taxi/api` | backend (NestJS) |
| `@taxi/shared` | contracts: schemas, ride state machine, seams |
| `@taxi/config` | tsconfig presets |
