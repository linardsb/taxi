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
| `packages/shared` | **Contract seam**: zod schemas, ride state machine, enums, provider interfaces | TS + zod | — |
| `packages/config` | tsconfig presets | — | — |
| `app/` + `backend/` + `DEPLOY.md` + `JAUTAJUMI.md` | **Sakta Cab anketa** — separate research mini-project (vanilla JS + Apps Script). NOT part of the monorepo; do not refactor it into the workspace. | — | see PLAN.md |

## Commands

```bash
docker compose up -d          # postgres+postgis, redis
pnpm install                  # root, once
pnpm check                    # turbo: typecheck + lint + test  ← the validation gate
pnpm dev                      # all dev servers (or: pnpm --filter @taxi/api dev)
pnpm --filter @taxi/shared test   # one package
```

## Hard rules

- **Payment method locks at ride acceptance** — enforced by `isPaymentMethodLocked()` in `@taxi/shared`; never bypass it.
- All money is **integer cents, EUR**. Never floats.
- Every cross-surface contract (schema, socket event, enum) lives in `packages/shared` — never duplicate a type an app can import.
- Ride status changes go through `assertTransition()` — no direct status writes.
- Provider calls (maps, SMS, payments) go through the seam interfaces in `packages/shared/src/seams/` — no direct SDK imports outside the implementing feature slice.
- i18n: user-facing strings in LV/RU/EN catalogs, never hardcoded. Accessibility: every rider-app screen must be fully usable with VoiceOver/TalkBack (screen-reader-excellent is a launch differentiator).
- Vertical Slice Architecture inside every app/service: one folder per feature owning routes/service/schemas/tests; `index.ts` is the slice's public API. Max ~500 lines per file.
- Tests mirror slices; each feature ships ≥1 expected + 1 edge + 1 failure case. Done = `pnpm check` green, never say-so.

## Workflow (PIV loop)

Prime → Plan → Implement → Validate. Skills in `.claude/skills/`: run `prime` (or the focused `prime-app <surface>`) before planning, `plan-feature` writes `.agent/plans/<name>.md`, `execute` implements it, `validate` runs the gates. After a nontrivial slice ships, close the loop: `execution-report` (→ `.agent/execution-reports/`) then `system-review` (→ `.agent/system-reviews/`) — that pair evolves the skills and this file. `create-spec` writes `docs/prd/01-spec.md` once the lean PRD gate passes; `vertical-slice-audit` scores a slice against the VSA rules. Fresh session per phase; load only the surface you're working on.

## On-demand context

| When touching | Read first |
|---|---|
| Ride lifecycle | `.claude/references/ride-state-machine.md` |
| Sockets/realtime | `.claude/references/realtime-events.md` |
| Dispatch/matching | `.claude/references/dispatch-strategies.md` |
| Product intent | `docs/prd/00-lean-prd.md` (living draft — features finalize from the anketa) |
| Anketa evidence / feature signals | `docs/prd/anketa-findings.md` (EN translation + synthesis of the answers) |
| Architecture & decisions | `docs/skeleton-proposal.md` |

## Notes

- Budget guardrail: <€100/mo — cache maps calls, watch SMS volume.
- No SIA yet: Stripe stays in test mode; personal store accounts for TestFlight only.
- Exact commission % and final feature list arrive from the anketa (JAUTAJUMI.md) — treat related code as config, not constants.
