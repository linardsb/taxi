# Sakta Cab (working repo name: taxi) — Skeleton Proposal

**Status: APPROVED 2026-07-06 — all open decisions answered in the kickoff Q&A; Phase 0 scaffolding underway. Gated by `docs/prd/00-lean-prd.md`.**
**Naming:** venture name **Sakta Cab** (Linards, 2026-07-06, per PLAN.md); repo/package scope stays `taxi` as a working name — rename is cheap until store submission.
**Date:** 2026-07-06
**Sources:** Atis's Drive outline (Latvian, folder `1dUvtaagLbM1-0IIZhHzT5HPJUhpA6dwG`) · workshops best-practices scan (`~/Desktop/cloned_repos/archon/workshops`) · second-brain PRD canon (`~/Desktop/claude-code-second-brain/docs/PRD`) · Linards's decisions 2026-07-06 (recorded below).

---

## 1. Decisions made (2026-07-06, Linards)

| Area | Decision |
|---|---|
| Mobile | **React Native + Expo** — one TS codebase each for rider and driver apps |
| Backend | **TypeScript monorepo** — Node + PostgreSQL/PostGIS + Redis + WebSockets |
| Maps | **Google Maps Platform**, behind a `MapsProvider` seam (swappable later) |
| Payments | **All four**: Stripe in-app cards, cash, prepaid EUR balance, corporate invoicing |
| MVP surfaces | **All four thin**: rider app, driver app, dispatcher web, admin web |
| Dispatch | **Hybrid**: auto-match (nearest driver) + dispatcher override **and** geozone queue mode — pluggable strategies |
| Pricing | **All three**: upfront fixed, taximeter, rider-offers-price — pluggable strategies |
| Region | **Rīga first, multi-city ready** — city/geozone in the data model from day 1 |
| Driver model | **100% platform for licensed independent drivers**; owned-fleet support baked into the schema as an extension |
| Team | **Linards + Claude solo build** — optimize for one-person maintainability |
| i18n / a11y | **LV + RU + EN day 1** · **blind-user accessibility day 1** (differentiator) · driver language badges · rider↔driver chat auto-translation later |

### Round 2 decisions (kickoff Q&A, 2026-07-06 evening)

| Area | Decision |
|---|---|
| Name | **Sakta Cab** (from anketa session); repo stays `taxi` for now |
| Hosting | ~~**Railway or Fly.io** (managed Postgres/Redis, WebSockets, git deploy)~~ — **superseded 2026-08-16: Hetzner CX22**, see `docs/epics/sakta-cab.architecture.md` → *Hosting decision revised* |
| Store accounts | Personal Apple/Google accounts exist — fine for TestFlight; company accounts after SIA |
| Timeline | **No hard deadline — quality first**, PIV-gated phases |
| Commission | **% per ride** (exact rate: anketa output; Bolt's ~30% is the wedge) |
| Cash settlement | **Net against card earnings** (Bolt model): cash-ride commission deducted from card payouts; negative balance blocks new rides |
| Driver supply | **From zero** — onboarding funnel is a top priority; Atis's network is the seed |
| Dispatch ops | **Dina** (Rīga autoosta dispatcher, Atis's wife) is the launch dispatcher |
| Budget | **Under €100/mo** — aggressive caching of maps calls, watch SMS spend |
| Demo scope | **Differentiators in the first demo**: scheduled rides + multi-taxi orders + shared rides v1 (route-overlap price knock-down, student-friendly) |
| Shared rides | Pulled **earlier** (differentiator), v1 = price knock-down on overlapping routes, not a pooling engine |
| AI complaints | **Stub in MVP** — support inbox with a clean seam; AI agent plugs in later |
| Telephony | **Click-to-dial + caller-ID early** (phase 2–3); full call-center integration eventually; manual entry acceptable only as the very first step |
| Ride options | **Female-driver preference + child-seat filters in MVP** (attributes + matching filter) |
| SMS | **Twilio** behind an `SmsProvider` seam |
| Blind a11y | **Screen-reader-excellent** in MVP (VoiceOver/TalkBack everywhere); voice-guided flow later |
| Demo pricing | **Upfront fixed** powers the demo; taximeter + rider bidding built later on the PricingStrategy seam |
| Legal entity | **No SIA yet — will form one** before pilot (blocks Stripe live, Apple company acct, ATD) |
| Process | **Lean PRD gate → scaffold** (both same session); **git + private GitHub repo** from day one |

## 2. Product source (from the Drive outline, translated)

Differentiators vs Bolt/competitors: professional 24/7 dispatcher · scheduled ("uz laiku") rides · multiple taxis in one order (transfers) · geozone driver queues · shared rides (later) · safety escalation via dispatcher · excellent blind-user accessibility · prepaid balance always visible.

Hard rules from the outline worth encoding early:
- **Payment method is locked once a driver accepts the ride** (explicit in "Kl.atverot app" §4).
- Start location defaults to GPS position, draggable pin; recent/frequent addresses suggested; multi-stop supported.
- Vehicle categories: fastest / limo / VIP / child seat / female-driver preference / multiple taxis, each with ETA + driver & car photos.
- Driver pre-shift check: photograph the car before going online.
- Dispatcher takes phone orders and intervenes live; complaints triaged by AI.

## 3. Tech stack detail

| Layer | Choice | Notes |
|---|---|---|
| Package manager / monorepo | **pnpm workspaces + Turborepo** | standard, AI-friendly |
| Mobile apps | **Expo (React Native, TypeScript)** | EAS builds + OTA updates; `expo-location` + task-manager for driver background GPS; Expo push notifications |
| Web apps | **Next.js (App Router)** | dispatcher portal + admin panel |
| API | **NestJS** | conventional structure, DI, WebSocket gateways, BullMQ queues — best fit for AI-assisted solo work |
| DB | **PostgreSQL + PostGIS** | geozones, nearest-driver queries; **Drizzle ORM** (native postgis geometry support) |
| Realtime | **Socket.IO** (NestJS gateway) + Redis adapter | driver location stream, ride status, dispatcher live board |
| Live driver locations | **Redis** (GEO sets) | ephemeral positions; Postgres only for trip-recorded tracks |
| Auth | SMS OTP + Google Sign-In (per outline), JWT sessions | SMS provider behind a seam (Twilio vs local — open question) |
| Payments | **Stripe** SDK (cards, Apple/Google Pay, top-ups) + cash + balance ledger + corporate invoices | ledger table is the source of truth; Stripe Connect for driver payouts is an open question |
| Maps | Google Maps SDKs (RN + JS) + Routes/Geocoding/Places APIs | behind `packages/shared` `MapsProvider` interface |
| i18n | i18next (apps) + shared translation catalogs LV/RU/EN | language auto-detected from device |
| Infra (MVP) | docker-compose locally; deploy target TBD (open question) | Postgres, Redis, API, web apps |

## 4. Repo skeleton

```
taxi/
├── CLAUDE.md                    # global rules: stack table, commands, conventions, monorepo map
├── README.md
├── .claude/
│   ├── skills/                  # PIV loop copied from workshops: prime-<app>, plan-feature,
│   │                            #   execute, validate, code-review, code-review-fix, commit
│   └── references/              # on-demand context: api-contracts.md, realtime-events.md,
│                                #   ride-state-machine.md, dispatch-strategies.md, logging-standard.md
├── .claude/plans/                # living per-feature plans (plan-format canon from second-brain)
├── docs/
│   ├── prd/                     # 00-lean-prd.md (hypothesis gate) → 01-spec.md (after gate)
│   ├── domain/                  # ride lifecycle, geozones, pricing, LV/ATD regulatory notes
│   └── decisions/               # ADRs (this file's table becomes ADR-0001)
├── apps/
│   ├── rider/                   # Expo — client app        (own CLAUDE.md, VSA features/)
│   ├── driver/                  # Expo — driver app        (own CLAUDE.md, VSA features/)
│   ├── dispatch/                # Next.js — dispatcher     (own CLAUDE.md, VSA features/)
│   └── admin/                   # Next.js — admin panel    (own CLAUDE.md, VSA features/)
├── services/
│   └── api/                     # NestJS (own CLAUDE.md), vertical slices:
│       └── src/features/        #   auth, users, drivers, vehicles, fleets(ext), rides,
│                                #   dispatch, pricing, payments, ledger, geo, geozones,
│                                #   notifications, support, stats
├── packages/
│   ├── shared/                  # THE contract seam: zod schemas, API + socket event types,
│   │                            #   ride state machine, enums (categories, payment methods),
│   │                            #   i18n catalogs, MapsProvider/PricingStrategy/DispatchStrategy interfaces
│   └── config/                  # shared tsconfig / eslint presets
├── db/                          # drizzle migrations + seed (Rīga geozones)
├── docker-compose.yml           # postgres+postgis, redis, api
├── .env.example                 # one per app too; documented inline
├── turbo.json / pnpm-workspace.yaml / package.json
```

Conventions (from the workshops scan, adopted):
- **Vertical Slice Architecture** inside every app/service — one folder per feature owning routes/service/schemas/tests; `index.ts` is the public API.
- **Per-app CLAUDE.md** + focused `prime-<app>` skills so a session loads only one surface.
- **Deterministic validation gates**: typecheck + lint + tests run every iteration; done = executable check passing.
- Tests mirror slices: minimum 1 expected / 1 edge / 1 failure case per feature.
- Structured logging taxonomy `domain.component.action_state` (critical for dispatch debugging).

## 5. Core seams (where the "everything" scope becomes manageable)

1. **`DispatchStrategy`** — `AutoMatchStrategy` (nearest eligible driver, Bolt-style offer cascade) and `GeozoneQueueStrategy` (rank-order within geozone). Selected per city/geozone config. Dispatcher override = privileged commands (assign, reassign, cancel) that work under either strategy.
2. **`PricingStrategy`** — `UpfrontFixed` (route estimate → locked price), `Taximeter` (base + per-km + per-min, finalized at dropoff), `RiderBid` (rider offers, drivers accept/counter). Selected per ride category/config; all write to the same fare-breakdown structure.
3. **`PaymentMethod`** — card (Stripe), cash, balance, corporate invoice — all settle through one **ledger** (double-entry-ish rides/commissions/top-ups table). Cash rides debit driver commission owed. Locked at ride acceptance per the outline.
4. **`MapsProvider`** — geocode, reverse-geocode, route, ETA. Google behind it.
5. **Driver ↔ Fleet** — `driver.fleet_id` nullable; independent drivers are the launch case, fleet entity exists for the owned-fleet extension.
6. **Ride state machine** (in `packages/shared`, consumed by all 5 surfaces):
   `requested → offered/queued → accepted → arriving → arrived → in_progress → completed → settled`, with `cancelled_by_{rider,driver,dispatcher,system}` branches and `scheduled` entry path for timed orders.

## 6. Build phases (re-sequenced 2026-07-06 — differentiators pulled into the demo)

- **Phase 0 — Foundation:** monorepo scaffold, CLAUDE.md + PIV skills, `packages/shared` with schemas + ride state machine + strategy seams, docker-compose (Postgres/PostGIS + Redis), CI (typecheck/lint/test), git + private GitHub.
- **Phase 1 — Core loop (happy path):** auth (SMS OTP via Twilio seam) · rider requests ride (upfront fixed price, cash) · auto-match · driver accepts/completes · live tracking · dispatcher board watches · screen-reader a11y baked in · female-driver/child-seat filters. *One ride end-to-end across all four surfaces.*
- **Phase 2 — Demo differentiators:** scheduled rides ("uz laiku") · multi-taxi orders (transfers) · shared rides v1 (route-overlap price knock-down for students) · dispatcher phone-order entry with caller-ID/click-to-dial · reassign/override. **→ THE DEMO to Atis & Dina ships here.**
- **Phase 3 — Money:** Stripe cards + Apple/Google Pay, prepaid balance, ledger with cash-commission netting (negative balance blocks driver), corporate invoicing.
- **Phase 4 — Depth:** geozone queue dispatch mode, rider bidding, taximeter pricing, family profiles, driver language badges, stats dashboards, AI complaints agent (fills the Phase-1 stub), voice-guided a11y flow, full call-center integration.

Gate: `docs/prd/00-lean-prd.md` (drafted 2026-07-06) — review with Atis; pilot numbers (RIGHT/WRONG conditions) to be pressure-tested against anketa findings.

## 7. Remaining open items (all else answered — see §1 tables)

1. Exact commission % — anketa output decides.
2. Driver payout rails — Stripe Connect for LV vs SEPA batch transfers (research in Phase 3).
3. ATD registration requirements for a dispatch platform — legal research before pilot.
4. SIA formation timing — blocks Stripe live mode + Apple company account, nothing in Phases 0–2.
5. First pilot geozones (center + RIX + autoosta?) — decide with Dina.
6. Rider acquisition plan for launch — business track with Atis.
