# Sakta Cab (repo: taxi) — Global Rules

Taxi booking platform for Latvia (Bolt competitor, driver-first). Venture name **Sakta Cab**; repo keeps the working name `taxi`. Solo build: Linards + Claude.

## Monorepo map

| Path | What | Stack | Own CLAUDE.md |
|---|---|---|---|
| `apps/rider` | Client mobile app | Expo / React Native, TS | yes |
| `apps/driver` | Driver mobile app | Expo / React Native, TS | yes |
| `apps/dispatch` | Dispatcher web portal (Dina's console) | Next.js App Router, Tailwind | yes |
| `apps/admin` | Admin panel (stats, config, legal) | Next.js App Router, Tailwind | yes |
| `services/api` | Backend: REST + Socket.IO + dispatch engine | NestJS, Drizzle, PostGIS, Redis | yes |
| `db` | Persistence: Drizzle schema, PostGIS migrations, Rīga seed (`@taxi/db`) | Drizzle, PostGIS | no |
| `packages/shared` | **Contract seam**: zod schemas, ride state machine, enums, provider interfaces | TS + zod | yes |
| `packages/config` | tsconfig presets | — | — |
| `app/` + `backend/` + `DEPLOY.md` + `JAUTAJUMI.md` | **Sakta Cab anketa** — separate research mini-project (vanilla JS + Apps Script). NOT part of the monorepo; do not refactor it into the workspace. | — | see PLAN.md |

### How the pieces talk

```
apps/rider   ─┐                                    ┌─ Postgres + PostGIS  (rides, drivers, geo)
apps/driver  ─┤                                    ├─ Redis               (dispatch state, presence)
              ├─→ services/api ────────────────────┤
apps/dispatch─┤   REST + Socket.IO + dispatch engine└─ seams: maps · SMS · payments
apps/admin   ─┘

every surface ──imports (build-time)──> packages/shared   zod schemas · ride state machine · enums · seam interfaces
```

Contracts flow one way: apps and `services/api` import from `packages/shared`; **`shared` imports from nothing in the workspace**. The four apps never talk to each other or to the database — only to `services/api`. Postgres is reached only through `@taxi/db`; `services/api` has no direct `pg` dependency.

## Commands

```bash
cp .env.example .env          # first — compose reads REDIS_PORT from it (set 6381 if 6379 is taken)
docker compose up -d --wait   # postgres+postgis, redis — blocks until both are healthy
pnpm install                  # root, once
pnpm turbo run typecheck lint test build --force   # ← the validation gate (CI parity)
pnpm check                    # typecheck + lint + test — quick loop, NOT the gate: no build
pnpm dev                      # all dev servers (or: pnpm --filter @taxi/api dev)
pnpm --filter @taxi/shared test   # one package
pnpm --filter @taxi/db generate   # drizzle-kit: migration from schema changes (then migrate, seed)
```

Redis-backed suites are **opt-in**: without `REDIS_TEST_URL` they `describe.skip`, so a green gate can be five tests short. CI sets it; set it locally to match your `REDIS_PORT`.

## Hard rules

- **Payment method locks at ride acceptance** — enforced by `isPaymentMethodLocked()` in `@taxi/shared`; never bypass it.
- Read the payment method from `ride.paymentMethod` (operative), never `ride.request.paymentMethod` (the immutable request snapshot) — the two legitimately diverge once a rider switches before acceptance.
- All money is **integer cents, EUR**. Never floats.
- Commission % is a `platform_config` row resolved by `resolveCommissionPct()` — never a literal, never a silent default (seed data aside).
- Every cross-surface contract (schema, socket event, enum) lives in `packages/shared` — never duplicate a type an app can import.
- Ride status changes go through `assertTransition()` — no direct status writes.
- Provider calls (maps, SMS, payments) go through the seam interfaces in `packages/shared/src/seams/` — no direct SDK imports outside the implementing feature slice.
- Nothing user-facing is hardcoded: strings come from the LV/RU/EN catalogs, colors/spacing/radii/font sizes from the `@taxi/shared` theme's semantic names. The theme's values are neutral placeholders — the brand-identity epic lands by editing that one file. Every rider-app screen must be fully usable with VoiceOver/TalkBack; screen-reader-excellent is a launch differentiator.
- Every feature plan's UX section uses breadboard notation (place → [affordance] → place), lists loading/empty/error/offline states, and requires minimum 44px touch targets plus visible focus states on every interactive element. It also includes a friction audit: state the tap/decision count from intent to done, justify every step, and prefer the flow option with the lowest count. Cosmetic questions that come up mid-feature are not debated — log them in `.claude/references/ui-decisions.md`.
- Vertical Slice Architecture inside every app/service: one folder per feature owning routes/service/schemas/tests; `index.ts` is the slice's public API. Max ~500 lines per file.
- Tests mirror slices; each feature ships ≥1 expected + 1 edge + 1 failure case. Done = `pnpm turbo run typecheck lint test build --force` green, never say-so.
- **A number or a guarantee in a comment, plan or PR body is a claim, not decoration** — show the arithmetic behind it and name the case it describes (`~16 s due N/S`, not `~15 s`); if you give one figure, give the worst case or say which one it is. typecheck/lint/test cannot read prose, so you are the only check on it. #87 shipped a best-case interval labelled worst-case and a cache guarantee the cache's own code contradicts — and the plan then de-scoped a control on the strength of the second.

## Workflow (PIV loop)

Research → Plan → Implement → Validate — **one ticket per loop, fresh session per phase**; load only the surface you're working on. Epic level runs `plan-create-prd` → `plan-architecture` → `piv-slice-epic` (→ GitHub Issues), in that order.

All PIV artifacts live under `.claude/`, **never `.agent/`** — `plans/` · `reports/` · `code-reviews/` · `execution-reports/` · `system-reviews/`. After a nontrivial slice ships, close the outer loop (`system-execution-report` → `system-evolution-review`) and act on **1–2** of its suggestions, not all.

> Skills in `.claude/skills/` carry their own descriptions — don't re-document them here.

## On-demand context

| When touching | Read first |
|---|---|
| Ride lifecycle | `.claude/references/ride-state-machine.md` |
| Sockets/realtime | `.claude/references/realtime-events.md` |
| Dispatch/matching | `.claude/references/dispatch-strategies.md` |
| Emitting logs | `.claude/references/logging-standard.md` |
| Committing / opening a PR | `.claude/references/conventions.md` (piv-commit & piv-create-pr read it at run time) |
| Product intent | `docs/epics/sakta-cab.prd.md` (supersedes `docs/prd/00-lean-prd.md`) |
| Anketa evidence / feature signals | `docs/prd/anketa-findings.md` (EN translation + synthesis of the answers) |
| Architecture & decisions | `docs/epics/sakta-cab.architecture.md` (supersedes `docs/skeleton-proposal.md` where they disagree) |

## Notes

- Budget guardrail: <€100/mo — cache maps calls, watch SMS volume.
- No SIA yet: Stripe stays in test mode; personal store accounts for TestFlight only.
