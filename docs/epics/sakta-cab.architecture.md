# Architecture — Sakta Cab

Intent: [sakta-cab.prd.md](./sakta-cab.prd.md)
Predecessor: [docs/skeleton-proposal.md](../skeleton-proposal.md) (approved 2026-07-06; its stack decisions stand — this doc records the delta the 2026-08-03 PRD created, and supersedes the skeleton where they disagree).
**Decisions made:** 2026-08-03, Linards, in the plan-architecture session.

## Problem & goals

Prove that a flat-15%, no-penalty, fare-transparent, human-dispatched platform gets ≥10 Rīga drivers active and ≥100 rides/week within 3 months of a Q4 2026 pilot. Every decision below is judged against one lens: **does it get the full 8-component MVP shipped by one builder in time for that pilot, without breaking the differentiators the driver pitch depends on** (fare transparency, phone dispatch, screen-reader-first, district fairness).

## Approaches considered

Stack, monorepo shape, seams, and VSA conventions were decided and scaffolded in the skeleton proposal — not relitigated here. The open architecture call was **sequencing the fat MVP** (PRD open question #1):

- **A — Demo → Pilot, two milestones**: core loop + 3 differentiators → demo gate → the rest. Natural feedback checkpoint, degrades gracefully if the date slips. Recommended by the advisor.
- **B — Pilot-thinnest**: cut shared knock-down, radar, return matching, loyalty from MVP. Safest date, weakest driver pitch (radar + return matching attack empty-km, a top driver pain).
- **C — All 8 before pilot, linear** ← **chosen (Linards, 2026-08-03)**. Matches the PRD as written; quality-first over date-first. Mitigation for the lost checkpoint: the demo to Atis & Dina stays in the sequence as a *checkpoint*, not a scope gate — feedback lands as backlog re-cuts, the build keeps moving.

## Recommended approach

Continue on the existing Phase 0 scaffold exactly as laid out in the skeleton proposal (`@taxi/shared` contracts → API core loop → driver app → rider app → dispatch console → admin → differentiators), extended with the three subsystems the PRD added after the skeleton was written. All 8 MVP components ship before pilot; the demo checkpoint sits after the first three differentiators. `docs/build-playbook.md` remains the execution guide (numbers corrected to 15% / ≥10 in this session).

## Key decisions

- **Stack & libraries** — reaffirmed from the skeleton, no changes: Expo/RN (rider, driver), Next.js App Router (dispatch, admin), NestJS + Drizzle + PostGIS + Redis + Socket.IO (api), zod contracts in `@taxi/shared`. Alternatives were weighed in the skeleton session; familiarity + AI-friendliness won.
- **Hosting** — **Railway** (decided 2026-08-03; skeleton left Railway-or-Fly open). Managed Postgres+PostGIS and Redis, git-push deploys, WebSockets out of the box; ~€20–40/mo fits the €100 guardrail. Fly.io rejected as more ops surface for a solo builder. Deploy when a shared environment is first needed — local docker carries development until then.
- **Commission** — 15% flat, **config not constant**: a platform-config table read at quote time, with a pure `resolveCommissionPct(driver, config)` resolver in `@taxi/shared`. The loyalty differentiator is *the same resolver* consulting tenure/quality inputs — no separate subsystem.
- **Demand-wave radar** — a `demand-signals` slice in `services/api`: polling ingestors behind a `DemandSignalProvider` seam (RIX arrivals, autoosta buses) → Redis → one socket event → "position yourself now" banner in the driver app. Seam exists precisely because the data source is unverified (spike 1). Fallback implementation of the same seam: dispatcher-posted manual wave alerts from Dina's console.
- **Return-ride matching** — an extension inside the existing dispatch slice, not a new engine: an out-of-Rīga dropoff registers a time-boxed return-offer window keyed on the dropoff location; incoming requests near it match against the window before the normal cascade. No new infra.
- **Data model additions** (shape level): `platform_config` (commission, loyalty tiers, guarantee placeholders) · `demand_signals` (ephemeral, Redis) · `return_offer_windows` (driver, dropoff point, expiry) · everything else per the skeleton's entities and ride state machine.
- **Boundaries & contracts** — unchanged hard rules: providers only via `packages/shared/src/seams/` (maps, SMS, payments, telephony, + new `DemandSignalProvider`); payment method locks at acceptance; status changes via `assertTransition`; Stripe test mode until SIA; integer cents EUR; contracts only in `@taxi/shared`.
- **Skipped** — auth posture, i18n/a11y policy, dispatch strategy plugin design: all decided in the skeleton and unchanged.

## Missing pieces

What the chosen approach needs that doesn't exist yet:

- `db/` migrations + Rīga geozone seed (scaffold has none).
- The entire API feature layer (scaffold is a hello-world NestJS app).
- The three new-subsystem contracts in `@taxi/shared`: `DemandSignalProvider` seam, commission resolver, return-window types.
- Railway environment (when first needed).
- Telephony seam interface (click-to-dial/caller-ID stub for Dina's console).

## Spikes & experiments

All three mandated (Linards, 2026-08-03), each before its dependent phase:

1. **RIX/autoosta arrival data** (~½ day, before the radar slice)
   Question: does a free, stable arrivals feed exist for RIX flights and autoosta buses?
   Decision rule: usable feed → automated ingestors; no feed / brittle scraping → ship the manual dispatcher-alert implementation of the seam and revisit post-pilot.
2. **Expo background GPS** (~1 day field test, before the driver-app phase)
   Question: does `expo-location` + task-manager stream reliably from a phone in a moving car (backgrounded, locked screen, LV networks)?
   Decision rule: reliable → proceed as designed; lossy → escalate to a foreground-service pattern / bare workflow *before* building the driver app on sand.
3. **Driver payout rails** (research, before the payments phase)
   Question: Stripe Connect for LV individual drivers vs SEPA batch — entangled with Atis's unresolved tax status (PRD open question).
   Decision rule: Connect supports the drivers' actual legal form at acceptable cost → Connect; otherwise SEPA batch from the platform account with the ledger as source of truth.

## Open questions

Deferred deliberately (owned by the PRD unless noted):

- Unit economics at 15% — does the pilot need to self-sustain? (business call, pre-pilot)
- Rider acquisition plan for the first 500 riders. (business track with Atis)
- Cash-ride commission settlement *policy* detail — mechanics (net against card earnings, negative balance blocks) are decided; thresholds/grace go to the spec.
- Atis's legal/tax status — feeds spike 3.
- ATD registration obligations for a dispatch platform. (legal, pre-pilot)
- First pilot geozones — decide with Dina against the evidenced hotspots.
