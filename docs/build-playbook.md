# Sakta Cab — Build Playbook

**Status:** the step-by-step execution guide from spec to demo. Written 2026-07-10, after the PRD gate passed. Numbers updated 2026-08-03 per `docs/epics/sakta-cab.prd.md` (commission locked: 15% flat; driver target ≥10). Sequencing decision (all 8 MVP components before pilot, linear) in `docs/epics/sakta-cab.architecture.md`. The slice lists below are the *expected* shape — `/piv-slice-epic` (Step 1) finalizes them as GitHub Issues; where they disagree, the epic docs (`docs/epics/sakta-cab.prd.md` + `sakta-cab.architecture.md`) win.

**The rhythm (memorize this, everything else is detail):** every slice = one PIV cycle in a fresh tab. Prime → Plan → Execute → Validate → Review → Commit. Never two execute-sessions in the same package at once. `pnpm check` green before every commit, no exceptions.

---

## Step 0 — One-time chores (before anything)

| # | Action | Who | Check |
|---|---|---|---|
| 0.1 | Paste `backend/Code.flat.gs` into script.google.com → Deploy → **New version** (fixes digest recipients + email deep links) | Linards | Send yourself a test digest; Dina's address receives it |
| 0.2 | `cp .env.example .env` (fill values; set `REDIS_PORT=6381` if 6379 is taken) | Linards | `pnpm --filter @taxi/api dev` boots, `curl localhost:3001/health` → 200 |
| 0.3 | `docker compose up -d --wait` — after 0.2, compose reads `REDIS_PORT` from `.env` | either | `docker ps` shows postgis + redis |
| 0.4 | `pnpm install && pnpm check` | either | 12/12 turbo tasks green (baseline) |

## Step 1 — Slice the epic into tickets (one session, new tab)

Paste:

```
/piv-slice-epic docs/epics/sakta-cab.prd.md

Context: the lean PRD gate has passed. Already decided and recorded: launch
commission = 15% flat, no penalty fees (config, not constant). The precizējumi
round is still out — treat driver weekly economics and the pilot guarantee
amount (candidates: €15/h or €500/week) as unsettled CONFIG inputs, not
blockers. Scope the tickets to the PRD's Demo experiment: one ride end-to-end
across all four surfaces plus the three differentiators (scheduled ride,
multi-taxi order, shared-ride price knock-down), incorporating the validated
feature signals from docs/prd/anketa-findings.md — hybrid dispatch with
dispatcher override on unclaimed orders, geozone/district queue fairness,
phone-booking channel as first-class, fare transparency to the driver,
screen-reader-first rider flows, dispatcher console reliability over features.
Shape the tickets as PIV cycles with named slices and a dependency graph.
```

**Your review checklist for the ticket set (~30 min):**
- [ ] Scope: everything the demo needs, nothing beyond it (non-goals respected)
- [ ] Every slice traces to a PRD differentiator or an anketa signal
- [ ] Phase order respects dependencies (contracts → api → clients → console → differentiators)
- [ ] Unsettled numbers (guarantee, weekly economics) marked as config
- [ ] Each ticket's validation criteria are executable, not vibes

Then: `/piv-commit` in that tab.

## Step 2 — The per-slice loop (the template you repeat ~25–35 times)

For **every** slice in the spec, fresh tab:

```
1.  /prime-app <surface>                  # rider|driver|dispatch|admin|api|shared
2.  /piv-plan-implementation <ticket #N or one-sentence slice statement>
        → writes .claude/plans/<slice>.md; read it (5 min) — sanity-check
          file list, patterns, validation commands
3.  (new tab, or clear context)
    /piv-implement .claude/plans/<slice>.md
4.  /piv-validate                         # or: pnpm check + targeted filter run
5.  /piv-review-changes → /piv-fix-review-findings   # fix anything real it finds
6.  /piv-commit
7.  Nontrivial slice or something diverged?
    /system-execution-report → /system-evolution-review   # apply 1–2 of its suggestions
```

**Session hygiene rules:**
- One slice per tab. Kill the tab when the slice is committed.
- Never run two `piv-implement` sessions that touch the same package concurrently. Parallel work across *different* surfaces is fine once contracts are stable.
- If `/piv-implement` hits two failed fix attempts on a gate, stop — hand the error output back to a fresh session with the plan, don't let it thrash.
- Every slice ships ≥1 expected + 1 edge + 1 failure test (hard rule).
- New socket event or schema? It goes in `packages/shared` **and** `.claude/references/realtime-events.md` in the same slice.

## Step 3 — Phase 1: Contracts (`@taxi/shared`) — ~3–4 slices

Everything downstream imports from here; do it first, keep it thin.

| Slice | Contents | Validate |
|---|---|---|
| 1.1 ride schemas | zod: RideRequest, Quote, Offer, Assignment, RideRecord; statuses already in state machine — extend only via `assertTransition` table | `pnpm --filter @taxi/shared test` |
| 1.2 socket event catalog | Typed event names + payload schemas for the full event list in `.claude/references/realtime-events.md` (ride lifecycle, driver location, dispatch offers, dispatcher overrides) | same |
| 1.3 geozone + queue types | Geozone polygon refs, queue-position types, district enums (Rīga pilot zones: center, RIX, autoosta, Old Town/nightlife) | same |
| 1.4 money + config schema | Integer-cents helpers (exist — extend), platform config schema: `commissionPct` (launch value 15, **config not constant**), guarantee placeholders | same |

**Phase gate:** `pnpm check` green; no app imports anything ride-shaped from anywhere but `@taxi/shared`.

## Step 4 — Phase 2: API core loop (`services/api`) — ~6–8 slices

The heart. Order matters (each slice depends on the previous):

| Slice | Contents | Notes |
|---|---|---|
| 2.1 auth | Mechanism per spec; roles rider/driver/dispatcher/admin; guards per role | SMS OTP goes through the SmsProvider seam — stub impl in dev |
| 2.2 realtime gateway | Socket.IO skeleton: auth handshake, rooms (per-ride, per-driver, dispatch board), typed emit helpers from 1.2 | Events no-op until later slices emit them |
| 2.3 drivers | Profile + vehicle CRUD, online/offline, location ingestion (socket → Redis), PostGIS driver-position queries | Location writes are hot-path — Redis, not Postgres per ping |
| 2.4 rides + pricing | POST ride request → upfront-fixed quote via PricingStrategy seam → persist via `assertTransition` → emit `ride:requested` | Maps seam for route/ETA — cache aggressively (<€100/mo guardrail) |
| 2.5 dispatch engine | Auto-match strategy (nearest + geozone queue fairness), offer→accept/decline with timeout, retry cascade; **unclaimed-order alert** to dispatch board | Strategies pluggable per `.claude/references/dispatch-strategies.md` |
| 2.6 dispatcher override | Force-assign endpoint + audit trail; the anketa-validated human override (S9-2/S9-4) | Dispatcher-off fallback = pure auto-match |
| 2.7 ride lifecycle | accept → arrived → started → completed → paid; **payment method locks at acceptance** (`isPaymentMethodLocked` — never bypass); fare split record: full fare visible to driver, 15% commission line | The fare-transparency wedge (S2-5) is born here |
| 2.8 payments + ledger | Cash + Stripe test mode through the payments seam; one ledger, integer cents; cash rides net against card earnings, negative balance blocks driver | Stripe stays test mode until SIA |

**Phase gate:** scripted end-to-end ride via curl/socket client: request → match → accept → lifecycle → completed, all events observed. Live API smoke test in `/piv-validate` passes.

## Step 5 — Phase 3: Driver app (`apps/driver`) — ~4 slices

Atis's surface. Thin, fast, glanceable.

- 3.1 auth + onboarding shell · 3.2 online toggle + location streaming · 3.3 offer screen (accept/decline with countdown) + active-ride flow · 3.4 earnings screen — **full fare shown, commission line explicit** ("you keep 85%")
- LV-first UI, i18n catalogs from day one. Test on Atis's actual phone early — he's the pilot user.

## Step 6 — Phase 4: Rider app (`apps/rider`) — ~4–5 slices

- 4.1 auth shell · 4.2 booking flow (pickup/dropoff, quote, confirm) · 4.3 live tracking + ride status · 4.4 payment method choice (locks at acceptance) + history · 4.5 filters (female driver, child seat — MVP per kickoff decisions)
- **Hard rule per screen: fully usable with VoiceOver/TalkBack.** The a11y pass is part of each slice's validation, not a cleanup phase — blind riders are a named unserved segment (S5-8).

## Step 7 — Phase 5: Dispatch console (`apps/dispatch`) — ~4 slices

Dina's surface. Her anketa answers are the requirements doc.

- 5.1 board: live ride queue + driver map (unclaimed orders flash — her S9-4 trigger) · 5.2 force-assign/override UI · 5.3 **phone-order entry**: create ride on behalf of a caller (elderly/hotels/bars/restaurants segment, S9-3) + click-to-dial/caller-ID stub via telephony seam · 5.4 zone/queue view (district fairness, S7-2)
- Reliability beats features (her S7-4: "the system often freezes"): error boundaries, reconnect logic, offline banner — test by killing the API mid-shift.
- **When her S9-1 console drawing arrives, review 5.x plans against it before executing.**

## Step 8 — Phase 6: Admin (the `/admin` route group in `apps/dispatch` — the workspace merged per the 2026-08-07 decision) — ~2–3 slices

- 6.1 platform config UI (commission %, zones, guarantee — the config-not-constants) · 6.2 driver approval + document check · 6.3 basic stats (rides/week, active drivers — the PRD's RIGHT/WRONG counters from day one)

## Step 9 — Phase 7: The three differentiators — ~4–6 slices

Only now — on top of a working core loop:

- 7.1 **Scheduled rides**: book for later, dispatch pre-assigns from zone queue, reminder events (unreliable scheduling is a named competitor gap)
- 7.2 **Multi-taxi orders**: one booking → N vehicles, group lifecycle handling
- 7.3 **Shared-ride knock-down**: route-overlap detection → price reduction (the basic version — PRD non-goal excludes a pooling engine)
- Each spans shared + api + one or two clients — the spec slices them per surface.

## Step 10 — Phase 8: Demo hardening — ~2–3 sessions

- 8.1 Seed script: demo drivers/riders/zones, Rīga map data
- 8.2 The demo runbook: scripted scenario touching all four surfaces + all three differentiators; run it start-to-finish twice
- 8.3 **Demo to Atis & Dina.** Their feedback → PRD/findings update → backlog re-cut. This is PRD experiment #2 — quality-first, no deadline.

## Step 11 — After the demo (non-code track resumes)

1. Fold demo feedback + remaining precizējumi answers into `anketa-findings.md`
2. **Driver LOI test** (PRD experiment #3): pitch "Bolt keeps 25%+, we keep 15%" through Atis's network; count commitments vs the ≥10-driver RIGHT condition — runs in parallel with the build, not a gate (PRD decision 2026-08-03)
3. SIA formation + ATD platform registration (unblocks Stripe live, Apple company account)
4. Dina onboarding: console training on the demo build (her S9-5 asks: schedule, equipment, training)
5. **Rīga soft pilot** (PRD experiment #4): limited zones, staffed dispatcher hours, measure RIGHT/WRONG conditions for 3 months

## Standing rules for every session (violations = stop)

- Money: integer cents EUR, never floats
- Status changes only via `assertTransition()`; payment lock never bypassed
- Contracts only in `packages/shared`; providers only via seams
- i18n LV/RU/EN, no hardcoded strings; rider screens screen-reader-complete
- VSA: slice owns routes/service/schemas/tests; `index.ts` = public API; ≤500 lines/file of shipped source (.spec/.test files, test/, tests/, scripts/ exempt)
- Done = `pnpm check` green, never say-so
- Budget: cache maps calls, watch SMS volume (<€100/mo)
