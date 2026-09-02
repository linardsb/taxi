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
- **Hosting** — ~~**Railway**~~ **SUPERSEDED 2026-08-16 → [Hosting decision revised](#hosting-decision-revised-2026-08-16)**. *(Original, decided 2026-08-03; skeleton left Railway-or-Fly open: managed Postgres+PostGIS and Redis, git-push deploys, WebSockets out of the box; ~€20–40/mo fits the €100 guardrail. Fly.io rejected as more ops surface for a solo builder. Deploy when a shared environment is first needed — local docker carries development until then.)* The "deploy when first needed" half still stands; the platform does not.
- **Commission** — 15% flat, **config not constant**: a platform-config table read at quote time, with a pure `resolveCommissionPct(driver, config)` resolver in `@taxi/shared`. The loyalty differentiator is *the same resolver* consulting tenure/quality inputs — no separate subsystem.
- **Demand-wave radar** — a `demand-signals` slice in `services/api`: polling ingestors behind a `DemandSignalProvider` seam (RIX arrivals, autoosta buses) → Redis → one socket event → "position yourself now" banner in the driver app. Seam exists precisely because the data source is unverified (spike 1). Fallback implementation of the same seam: dispatcher-posted manual wave alerts from Dina's console.
- **Return-ride matching** — an extension inside the existing dispatch slice, not a new engine: an out-of-Rīga dropoff registers a time-boxed return-offer window keyed on the dropoff location; incoming requests near it match against the window before the normal cascade. No new infra.
- **Data model additions** (shape level): `platform_config` (commission, loyalty tiers, guarantee placeholders) · `demand_signals` (ephemeral, Redis) · `return_offer_windows` (driver, dropoff point, expiry) · everything else per the skeleton's entities and ride state machine.
- **Boundaries & contracts** — unchanged hard rules: providers only via `packages/shared/src/seams/` (maps, SMS, payments, telephony, + new `DemandSignalProvider`); payment method locks at acceptance; status changes via `assertTransition`; Stripe test mode until SIA; integer cents EUR; contracts only in `@taxi/shared`.
- **Skipped** — auth posture, i18n/a11y policy, dispatch strategy plugin design: all decided in the skeleton and unchanged.

## UI surface decisions (2026-08-07)

Decided by Linards in the surface-consolidation grilling session; research + evidence in `docs/research/` (`ui-surface-consolidation.md` + three evidence reports). Functionality preservation tracked in `mvp-traceability.md`.

- **Why two mobile apps** (rider+driver merge rejected): app-store permissions are declared per app at build time, not per user role — the driver app's `ACCESS_BACKGROUND_LOCATION` + foreground service + iOS "Always" mode must never ship in the rider install (Play policy review judged against the rider majority, privacy optics, OEM battery baggage). Also: release decoupling, and the driver app's store-free APK/internal-track distribution (proven by the GPS spike kit) dies in a single binary. Industry default (Bolt/Uber/Lyft: two apps) exists for these reasons.
- **One web app, not two**: `apps/dispatch` and `apps/admin` merge into a single Next.js app with role-gated route groups `/dispatch` and `/admin` — one shell, one auth, one deploy. The manifest-permission argument doesn't exist on web. CLAUDE.md's separation intent holds as route/role boundaries (stats/config/legal never render in the operational console). `apps/admin` workspace retires.
- **Rider app ships native** (Expo → TestFlight + Play internal/APK; EAS Update for OTA pilot iteration). PWA-first rejected on evidence: iOS web push requires add-to-home-screen (the exact users who won't), react-native-web has open ARIA gaps vs the screen-reader-first launch requirement, and no major operator went PWA 2022–2026. The no-install job is done better by the **SMS + no-login live-tracking web page** (token URL: driver, plate, live position, ETA, dispatch phone) which also serves share-trip and phone bookings — new ticket. Full verdict: `docs/research/rider-ux-evidence.md`.
- **Admin is minimal bespoke**: driver/vehicle approval + CRUD, trips list + CSV, platform-config editor (still through `resolveCommissionPct()`-compatible `platform_config` rows). Stats delegated to self-hosted Metabase (read-only Postgres user) when the first recurring stats question appears; rider-visible legal/terms = public static pages; support-inbox stub deferred (see traceability map).
- **UX evidence is binding input to surface tickets**: the three evidence reports' top-10 lists were folded into tickets #14–#21 on 2026-08-07 (offer-card contents, FIFO queue transparency, caller-ID pop, keyboard-first console, alarm-budget discipline, PIN pickup, blind-rider arrival protocol, scheduled-ride guarantee). Anti-scope is explicit: no heatmaps, no in-app navigation, no IVR/voice-AI, no gamified tiers tied to acceptance rate, no bidding.
- **Measurement**: experiential/outcome UX metrics live in `docs/ux-metrics-ledger.md` (weekly review during pilot), per the outcomes-not-outputs rule.

## Hosting decision revised (2026-08-16)

**Decided by Linards, 2026-08-16.** Supersedes the Railway line under Key decisions. Evidence:
[`docs/research/hosting-sms-cost-research.md`](../research/hosting-sms-cost-research.md) (researched
2026-08-14), whose §8.1 required this amendment rather than a silent divergence inside ticket #13.

**Hosting is a Hetzner VPS — CX22 (2 vCPU / 4 GB / 40 GB NVMe) now, resize in place to CX33 when
load says so.** OVH VPS-2 is the recorded runner-up (free daily backups, but annual commitment for
the headline price). Contabo was disqualified on a 24-month minimum against a hypothesis the PRD
makes falsifiable at 3 months.

### Why this reverses a decision that is only 13 days old

Three things the 2026-08-03 session did not weigh:

1. **The production boot gate.** `mapsProviderSourceFactory` (`services/api/src/features/geo/geo.module.ts:22`)
   throws under `NODE_ENV=production` because no real `MapsProvider` exists in the tree. Any deploy
   needs one. On a managed platform that means Google Routes, billed per call from the first quote;
   on a box we control it means **self-hosted OSRM on the Latvia OSM extract — €0 marginal, forever**.
   This is a capability argument, not a price one, and it did not surface until the cost research.
2. **The cost gap is ~6×, not marginal.** `derived` (§5.1–5.2 of the research, from vendor rates
   `observed` 2026-08-14): Hetzner **€5.49/mo** (CX22 €4.49 + IPv4 €0 running IPv6-only behind
   Cloudflare's free proxy + backups €0 via `pg_dump` to a free object-storage tier + domain ~€1)
   against Railway at **$33.25/mo** at pilot load ($8.55 idle). The original ~€20–40/mo estimate for
   Railway was not wrong; the alternative is simply much cheaper than it looked.
3. **Hourly billing with no commitment.** The box can be created for a testing session or a demo day
   and destroyed after, keeping a snapshot at €0.0143/GB/mo — a demo day costs roughly €0.30
   (`derived`). The meter need not start before there is a product.

**Pilot all-in: ~€20.64/mo** — €5.49 infra + €15.15 SMS (`derived`, §4.3). That SMS figure assumes
*both* volume levers are applied and the PRD's month-3 target ride rate, i.e. the busiest month the
pilot aims at, not its average. Without the levers the same month is **€47.38**. Either way the
€100/mo guardrail is not the binding constraint, and **SMS — not hosting — is the largest line item
at pilot and the only component that cannot run on our own hardware.**

### The objection this decision accepts

The 2026-08-03 session rejected Fly.io as **"more ops surface for a solo builder."** A VPS is *more*
ops surface than Fly, so this decision does not resolve that objection — **it overrides it**, and the
reasoning above is what it is traded against. Stating it plainly so a future reader does not mistake
it for an oversight. What we now own that Railway owned before:

| Responsibility | Mitigation |
|---|---|
| Backups | `pg_dump` cron → Cloudflare R2 / Backblaze B2 free tier. **The one item that must not be skipped outright** — pilot data is real rides and a money ledger. Hetzner's own +20% add-on snapshots whole disks; a dump is what we would actually restore from. |
| TLS / DDoS | Cloudflare free proxy in Full (strict) mode; Caddy terminates with a Cloudflare Origin CA certificate (#13 — plain HTTP to the origin was rejected because OTP codes and JWTs would cross Cloudflare → Hetzner in the clear; `Caddyfile` header) |
| Deploys | No git-push. `workflow_dispatch` GitHub Action: build → ghcr.io → SSH pull + migrate + `up` — `docs/runbooks/hetzner-deploy.md` (#13). Auto-deploy on merge deferred until the first manual run succeeds |
| OS patching, uptime | Uptime Kuma / GlitchTip, both self-hosted, €0 |

### Carried forward unchanged

`docs/research/hosting-sms-cost-research.md` §7 records Railway-specific findings (PostGIS template,
`ioredis` IPv4 lookup, `PORT` injection, migrations-in-image, seeding policy). **Most are host-agnostic
and still live on Hetzner** — migrations-in-image, seeding policy, `PORT`, and
`PUBLIC_TRACKING_BASE_URL` in particular. Kept rather than deleted so a reversal costs nothing.

### Open decisions this leaves — and how #13 closed them (2026-08-25)

Decided by Linards in the #13 planning session (2026-08-14) and shipped by #13; recorded here so the
epic carries the posture, not just the ticket.

1. **Routing packaging — DECIDED: its own ticket, #134.** `OsrmMapsProvider` + the OSRM container
   ship beside #13, not inside it (#13's AC says nothing about maps, and its own comment concedes the
   stub replacement is a prerequisite of a *later* step). In the interim #13 ships
   **`ALLOW_STUB_MAPS_PROVIDER`** — a documented, single-purpose config switch on the routes clause of
   `mapsProviderSourceFactory` (the #103 precedent: code-level kill switch → config-level). Default
   `false`; production still refuses to boot on the stub unless the switch says otherwise, and the
   switch does **not** cover a missing `GOOGLE_MAPS_API_KEY`. **This is debt with a due date**: it is
   defensible only while no money moves off a quote (no Stripe key) and the pilot is closed, and
   #134 deletes it. Quotes are straight-line × 1.35 with no polyline until then.
2. **ARM vs x86 — DECIDED: x86.** CX22 is x86; the OSRM amd64-only verification moves to #134, and the
   box must not move to the ARM CAX line before that ticket resolves it.
3. **Payments posture — DECIDED: refuse, never pretend.** Production with no `STRIPE_SECRET_KEY` binds
   `CardPaymentsDisabledProvider`, which answers every card charge `ok: false` (`provider_error`,
   `card_payments_disabled`) and moves nothing — a card settlement is a 502, never a silent 201. The
   stub (which reports success) still never binds in production; what changed is that "no card rail"
   is a legitimate production posture for a cash-only pilot where "pretend to charge" is not. The SIA
   plus a test-mode key restores `StripePaymentsProvider` with no code change. Corollary the pilot
   must honour at booking: **do not offer card while cash-only** — a card ride cannot settle and the
   method locks at acceptance.
4. **SMS provider and the two volume levers — filed as #137 (bake-off), #135 (skip SMS for
   app-booked rides), #136 (1-segment templates + short domain + shorter token).** Twilio trial through
   testing. **Transliteration is rejected** (Linards, 2026-08-14) — Latvian lettering and Russian
   both stay. #13 buys the short domain #136 needs, because `PUBLIC_TRACKING_BASE_URL` is set there.

Also taken in #13 (runbook §1.1): **IPv4 for the first deploy** (+~€0.60/mo `observed` 2026-08-14),
so the €5.49 above becomes ≈ €6.09 `derived` — a lockout on day one costs more than a year of the
saving. Revisit once the box is boring.

## Missing pieces

What the chosen approach needs that doesn't exist yet:

- `db/` migrations + Rīga geozone seed (scaffold has none).
- The entire API feature layer (scaffold is a hello-world NestJS app).
- The three new-subsystem contracts in `@taxi/shared`: `DemandSignalProvider` seam, commission resolver, return-window types.
- Hetzner environment — **built by #13** (`services/api/Dockerfile`, `compose.prod.yml`, `Caddyfile`, `.github/workflows/deploy.yml`, `scripts/backup-db.sh`, `docs/runbooks/hetzner-deploy.md`). What remains is the box itself: provisioning, domain, Cloudflare and the first manual deploy are runbook steps, not code.
- `OsrmMapsProvider` — #134. Until it lands, production boots the stub for routes behind `ALLOW_STUB_MAPS_PROVIDER=true` (see the decisions above); #134 deletes the switch and makes the `geo.module.ts` gate unconditional again.
- Telephony seam interface (click-to-dial/caller-ID stub for Dina's console).

## Spikes & experiments

All three mandated (Linards, 2026-08-03), each before its dependent phase (spike 2's run deferred 2026-08-26 — see its entry):

1. **RIX/autoosta arrival data** (~½ day, before the radar slice)
   Question: does a free, stable arrivals feed exist for RIX flights and autoosta buses?
   Decision rule: usable feed → automated ingestors; no feed / brittle scraping → ship the manual dispatcher-alert implementation of the seam and revisit post-pilot.
2. **Expo background GPS** (~1 day field test, before the driver-app phase)
   Question: does `expo-location` + task-manager stream reliably from a phone in a moving car (backgrounded, locked screen, LV networks)?
   Decision rule: reliable → proceed as designed; lossy → escalate to a foreground-service pattern / bare workflow *before* building the driver app on sand. *Amended 2026-08-26 (Linards): the run is deferred — no pilot phone to run it on, no paid Apple account before the app exists; #14 ships the superset (harness options + keep-awake while online + server-side gap tolerance) regardless of a later outcome, see `docs/spikes/04-gps-field-test.md`.*
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
