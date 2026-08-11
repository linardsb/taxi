# Feature: Rider comms — SMS ride statuses + no-login live-tracking web page

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files.

> **Concurrency note (2026-08-10, updated):** the dispatch split (#69) is committed on `feature/api-split-dispatch-service-69` — **PR #82, open**. This plan deliberately **touches no file in `features/dispatch/`**, and the chosen hook point was **verified against the post-split code**: both assignment paths funnel through `DispatchNotifier.emitAssigned` ("the shared post-commit emit tail for both assignment paths" — `dispatch-notifier.ts:77` calls `RideTransitionService.emitStatus`), invoked from `dispatch.service.ts:225` (accept) and `force-assign.service.ts:148` (force-assign); lifecycle (`ride-lifecycle.service.ts:163, :249`) and settlement (`settlement.service.ts:168`) call `emitStatus` directly. **Every `accepted`/`arrived` transition therefore passes through the one hook this plan adds — no grep needed at implement time.** **Update, later same day: PR #82 has MERGED** (`main @ 96599e7`, #69 closed) — all dispatch line refs above re-verified on merged main (`dispatch-notifier.ts:77`, `dispatch.service.ts:225`, `force-assign.service.ts:148`). Branch for this ticket from current `main`; the usual `git reflog -8` concurrent-sessions check still applies.

## Feature Description

Two thin pieces that make every ride trackable without installing anything (issue #63, from the 2026-08-07 surface re-slice — the load-bearing half of the "rider ships native" decision):

1. **SMS ride statuses** through the existing `SmsProvider` seam: booking-confirmed + driver-arrived SMS for all rides; phone-booked rides additionally get the live-tracking link with driver name, plate, ETA (the Uber call-to-ride pattern).
2. **No-login live-tracking web page** at a token URL: driver name + photo, vehicle plate, live position on a map, ETA, dispatch phone. Server-rendered, deliberately boring, polls REST (no socket). One page serves phone-booked riders, share-trip from the rider app (#17 reuses it), and blind riders' sighted assistants.

## User Story

As an **elderly/hotel rider who booked by phone** (and, later, a family member receiving a share-trip link)
I want to **receive an SMS confirming my taxi and a link that shows the car, plate and live position without installing anything**
So that **I can trust the ride is actually coming and identify it at the kerb**.

## Problem Statement

Phone-booked riders today have zero visibility after hanging up. The rider app is native-only (PWA rejected), so the no-install reach job — the whole reason a PWA was considered — is unserved. PRD §5 phone-segment JTBD ("I want to call a real person … so I can trust it will actually come") needs a delivery mechanism.

## Solution Statement

- Mint an unguessable tracking token on every ride at creation; store it on the ride row.
- Add a `bookingChannel` (`app` | `phone`) to rides — needed for SMS policy *and* the PRD §7 "phone-channel share" metric. The rider-app path always writes `app`; #19's dispatcher controller will write `phone` (tests exercise `phone` through the service layer directly).
- New `features/notifications` slice in the API: sends templated LV/RU/EN SMS from two hook points (ride creation post-commit; `RideTransitionService.emitStatus` filtered to `accepted`/`arrived`), and serves a `@Public()` `GET /track/:token` read model (ride status + driver + plate + live position + ETA + dispatch phone).
- New `positionOf()` method on the `DriverLocationStore` port (Redis GEOPOS + ZSCORE) — today there is no single-driver position read.
- Minimal LV/RU/EN message catalog in `@taxi/shared` — the first real consumer of the mandated-but-nonexistent catalogs.
- Public page `apps/dispatch/src/app/t/[token]/` (the merged web app per the 2026-08-07 surface decision): server-rendered status line, Leaflet map island polling a same-origin Next route-handler proxy (no CORS changes).
- SMS failure never fails a booking: fire-and-forget, `logger.error` alarm (`ride.notifications.sms_send_failed`) — that structured error IS the "alarm to console" for now; a Dina-console alert can ride #18 later.

## Out of Scope / Non-Goals

- Not included: **#19's dispatcher phone-order entry** (the upstream that will set `bookingChannel='phone'` via its own controller — explicitly deferred there; `rides.controller.ts:14-21` records that decision). Tests simulate phone bookings at the service layer.
- Not included: a **real SMS provider** (Twilio/LV gateway). The stub + boot-refusal-in-production factory pattern stays; widening the seam is in scope, implementing a paid provider is a later ticket.
- Not included: **share-trip UI** in the rider app (#17 reuses this page + token; do not build any rider-app surface here).
- Not included: driver **photo upload pipeline** — only a nullable `drivers.photo_url` column + graceful absence on the page; admin CRUD (#20) can set it later.
- Not included: SMS **cost rows in the ledger** — `features/ledger` models claims between parties, not platform expenses (`ledger/index.ts:1-37`); the €/week metric is measured from `ride.notifications.sms_sent` logs per `docs/ux-metrics-ledger.md`.
- Not included: cancellation SMS, rider-app push, `driver:location` fan-out to ride rooms (deferred to #11/#17 — the page polls REST, so it doesn't need it).
- Not changing: anything in `features/dispatch/` (see concurrency note), the auth OTP flow's behavior, the realtime JWT-only handshake.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (three workspaces + a migration + a new slice + first web page)
**Primary Systems Affected**: `packages/shared`, `db`, `services/api` (new `notifications` slice, `rides` hook points, `drivers/location` port), `apps/dispatch` (first real page)
**Dependencies**: `leaflet` (new, apps/dispatch only — free OSM tiles, no key). No other new external deps.

## Related Work

**Implements**: [#63](https://github.com/linardsb/taxi/issues/63) · **Epic**: #1 — architecture decisions inherited from `docs/epics/sakta-cab.architecture.md` (§Key decisions, §UI surface decisions 2026-08-07)

**Back-references**:

- `docs/epics/sakta-cab.architecture.md:34-43` — the surface decision that created this ticket; "one web app" is why the page lives in `apps/dispatch`
- `docs/research/rider-ux-evidence.md:59-76` (§3) — the Uber call-to-ride + SMS-link evidence; §3.3 fixes the send policy: *confirm + arrival SMS by default, link SMS only for phone bookings*
- `docs/ux-metrics-ledger.md` Rider rows — the ≤30 s SMS criterion + "SMS spend €/week" measured from api logs

**Forward-references** (append as created):

- #17 — share-trip reuses this exact page + token (consider exposing `trackingToken` on a rider-facing read then, not now)
- #19 — dispatcher phone-order controller sets `bookingChannel='phone'`; SMS then flows with zero notifications-slice changes
- #20 — admin CRUD for `drivers.photo_url` + `platform_config.dispatch_phone`
- (future) real SMS provider ticket — swaps the stub inside the factory only
- #86 → .claude/plans/api-ride-vehicle-stamp.md — resolves OPEN QUESTIONS #4: the ride now records its vehicle at assignment

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

**Contracts & state machine (packages/shared):**

- `packages/shared/src/ride-state-machine.ts:1-16` (`RIDE_STATUSES` — exact names: `arriving`/`arrived`/`in_progress`, four distinct `cancelled_by_*` terminals), `:117-119` (`assertTransition`), `:121-127` (`isTerminal`/`isCancelled`)
- `packages/shared/src/schemas/ride.ts:188-215` (`rideSchema` — extend here), `:72-88` (`rideRequestSchema` — pickup/dropoff for ETA), `:49-53` + `:220-225` (WHY predicates instead of `.refine()` — keep new schemas plain `ZodObject`)
- `packages/shared/src/enums.ts:4-5` (`LANGUAGES`), `:85` (`ASSIGNMENT_SOURCES` — do NOT confuse with booking channel; it means how the ride got its driver)
- `packages/shared/src/schemas/user.ts:5-14` (`phoneSchema` E.164, `language` default `'lv'`)
- `packages/shared/src/schemas/platform-config.ts:9-43` (extend with `dispatchPhone`)
- `packages/shared/src/realtime-events.ts:11-17` (wire-vs-domain date rule: wire schemas use `z.string().datetime()` ISO strings — the tracking view is a wire schema)
- `packages/shared/src/seams/sms-provider.ts` (whole file, 7 lines — the seam to widen)
- `packages/shared/src/seams/payments-provider.ts:31-35, 76-92` (the house style for seam failure taxonomies — read for calibration; this plan deliberately keeps `send(): Promise<void>` throwing instead, matching `sendOtp`)
- `packages/shared/src/theme-css.ts:1-20` (`themeCssVars()` — the page is its first consumer)
- `packages/shared/src/index.ts` (the barrel is total and manual — new files are invisible until added)
- `packages/shared/tsconfig.build.json:1-16` (isomorphic fence: NO `node:crypto`/Buffer in shared src — token *minting* lives in the API)

**DB (db workspace):**

- `db/src/schema/rides.ts:30-84` (rides columns; `:69-73` — `updated_at` is trigger-maintained, do NOT add `.$onUpdate()`)
- `db/src/schema/users.ts:5-28` (`phone` NOT NULL UNIQUE is the identity; `language`; `display_name` = driver name source)
- `db/src/schema/drivers.ts:13-28` (PK `user_id`; NO name, NO photo column today)
- `db/src/schema/vehicles.ts:14-38` (plate + category; NO rides→vehicles FK — resolve plate via `rides.driver_id → vehicles.driver_id`)
- `db/src/schema/platform-config.ts:15-49` (+ policy at `:21-36`: no column defaults for knobs, seed supplies values)
- `db/src/schema/index.ts:1-10` (schema barrel — new columns' files are already listed; only new *tables* would need adding)
- `db/migrations/0006_harsh_donald_blake.sql` (precedent: generated migration hand-edited to `ADD COLUMN … DEFAULT` then `DROP DEFAULT`, with a comment why)
- `db/src/seed/riga.ts:8-23` (deterministic fixed UUIDs — extend seed for `dispatch_phone`, driver photo)

**API (services/api):**

- `services/api/src/features/rides/rides.service.ts:125-156` (`createRide` — the `// ---- POST-COMMIT: nothing below may throw ----` section at `:141` holds `recordIdempotency` + `notifyRider`; **hook #1 is one line after `notifyRider`**), `:297-303` (why post-commit effects never throw). The public entry threads `bookingChannel` down to `rides.create` with default `'app'`
- `services/api/src/features/rides/ride-transition.service.ts:48-56` (the two-halves design), `:101-125` (`emitStatus` — hook #2 goes here; `:116` the `notify_failed` catch pattern to mirror)
- `services/api/src/features/rides/ride-entry.ts:27` (`entryStatusFor` — creation is machine *entry*, not a transition; that's why creation needs its own hook)
- `services/api/src/features/rides/rides.repository.ts:17, 43, 63-82` (`toRide` — jsonb re-parsed through zod, never cast; extend mapping for new columns), `:126-146` (`create(input: CreateRideInput)` — extend `CreateRideInput` with `trackingToken` + `bookingChannel`)
- `services/api/src/features/rides/index.ts:68-87` (how cross-slice barrel exceptions are documented — imitate in the new slice's `index.ts`)
- `services/api/src/features/auth/auth.module.ts:20-27, 49-53` (`smsProviderFactory` — production boot-refusal; reuse the exported factory, do not fork the pattern)
- `services/api/src/features/auth/sms/stub-sms.provider.ts:18-23` (stub logging shape), `auth/sms/sms.tokens.ts:1` (`SMS_PROVIDER` token), `auth/index.ts:9` (token re-export)
- `services/api/src/features/auth/decorators/public.decorator.ts:1-6` + `guards/jwt-auth.guard.ts:20-24` (`@Public()` — the ONLY way to an unauthenticated route; do NOT combine with `@Roles`)
- `services/api/src/features/auth/phone-mask.ts` (`maskPhone` — every log with a phone uses it)
- `services/api/src/features/drivers/location/driver-location.store.ts:25-51` (the port — add `positionOf`), `redis-driver-location.store.ts:10-14, 31-45` (key builders; replies validated never cast)
- `services/api/src/features/platform-config/index.ts` + `platform-config.module.ts` (**verified**: exports `PlatformConfigService` only — the repository is deliberately private; module is deliberately NOT `@Global()`, so `NotificationsModule` must `imports: [PlatformConfigModule]` and inject the service; `forCity` throws on a missing row, no fallback)
- `services/api/src/features/drivers/index.ts` (**verified**: exports `DRIVER_LOCATION_STORE` + `DriverLocationStore` type; `drivers.module.ts:39` exports the token — `NotificationsModule` imports `DriversModule`. Vehicles have NO exported read API — the notifications repository owns its own `vehicles` query via `DRIZZLE`, like every repo owns its queries)
- cityId convention (**verified**, 8 call sites): always `this.env.DEFAULT_CITY_ID` (e.g. `drivers.service.ts:89`, `force-assign.service.ts:61`) — `TrackingService` does the same for `positionOf` and `forCity`
- `services/api/src/common/config/env.schema.ts:22-124` (`PUBLIC_TRACKING_BASE_URL` goes here + `.env.example`; note the `.optional().transform().refine()` order dependency `:64-70`)
- `services/api/src/app.module.ts:18-43` (module registration — order is documented and load-bearing; `NotificationsModule` must precede `RidesModule`)
- `services/api/test/harness.ts:217-228` (`RecordingSmsProvider` — extend with `send()` + `sentMessages`), `:158-163` (fake's `positionOf` — promote from "test-only helper" to port method), `:319-343` (what the harness swaps), `:389-410` (override self-checks)
- `services/api/test/driver-location-store.contract.ts` (contract runs against fake + Redis — add `positionOf` cases here)
- `services/api/src/features/rides/rides.service.spec.ts:159-200, 293+` (the unit-spec house style: `build()` factory, shared `calls: string[]`, `(expected)/(edge)/(failure)` titles, AC cited inline)
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts:29-36` (E.164 range registry — claim `+371270…` for the new spec and add it to this registry comment), `:69-80` (integration boot + cleanup pattern)
- `services/api/src/features/dispatch/dispatch.service.ts:236-256` (the `driver_not_claimed` warn — the actionable-log calibration bar; read-only, do not edit this file)

**Web (apps/dispatch):**

- `apps/dispatch/AGENTS.md` — **"This is NOT the Next.js you know"** (Next 16.2.10): read the bundled docs BEFORE writing page code
- `apps/dispatch/src/app/globals.css:1-13`, `layout.tsx` (Tailwind v4 zero-config; `@theme inline` block)
- `apps/dispatch/CLAUDE.md` (Vertical Slice `src/features/<name>/`; strings in catalogs)

### New Files to Create

**packages/shared:**
- `src/schemas/tracking.ts` — `trackingTokenSchema`, `TRACKING_PAGE_STATES`, `trackingViewSchema` (wire: ISO strings)
- `src/i18n.ts` — `MessageKey`, `MESSAGES` (lv/ru/en), `formatMessage()` — the first catalog
- `tests/tracking.test.ts`, `tests/i18n.test.ts`
- (edits: `enums.ts` +`BOOKING_CHANNELS`, `schemas/ride.ts`, `schemas/platform-config.ts`, `seams/sms-provider.ts`, `index.ts` barrel)

**db:**
- `migrations/0007_*.sql` via `pnpm --filter @taxi/db generate`, then hand-check (defaults policy)
- (edits: `schema/rides.ts`, `schema/drivers.ts`, `schema/platform-config.ts`, `schema/enums.ts` +pg enum, `seed/riga.ts`)

**services/api — `src/features/notifications/`:**
- `index.ts` (slice public API: `NotificationsModule`, `RideNotificationsService` — with a docblock naming who may cross and why, per the rides barrel style)
- `notifications.module.ts` (binds `SMS_PROVIDER` with auth's exported `smsProviderFactory`; provides + exports `RideNotificationsService`; registers `TrackingController`)
- `ride-notifications.service.ts` (the two hooks' target: `onRideCreated(ride)`, `onStatus(ride, from)`)
- `notifications.repository.ts` (rider phone+language, driver displayName+photo, plate resolution)
- `sms-templates.ts` (pure: `formatMessage` + link building)
- `notifications.policy.ts` (constants: terminal grace seconds, ETA speed m/min, page-state mapping)
- `tracking/tracking.controller.ts` (`@Public() @Get('track/:token')`)
- `tracking/tracking.service.ts` (token lookup → view model; mints tokens too: `node:crypto` lives HERE, not shared)
- `ride-notifications.service.spec.ts`, `tracking/tracking.integration.spec.ts`
- (edits: `rides.service.ts` +2 lines in post-commit block, `ride-transition.service.ts` +hook in `emitStatus`, `rides.repository.ts` toRide/insert mapping, `driver-location.store.ts` port +`positionOf`, `redis-driver-location.store.ts` impl, `app.module.ts`, `env.schema.ts`, `.env.example`, `test/harness.ts`)

**apps/dispatch:**
- `src/app/t/[token]/page.tsx` (server component: `await params`, `await searchParams`, fetch API `cache: 'no-store'`, render status line SSR)
- `src/app/t/[token]/data/route.ts` (route-handler proxy → API `GET /track/:token`; same-origin polling, zero CORS work)
- `src/features/tracking/tracking-map.tsx` (`'use client'`: Leaflet init + 5 s poll + aria-live status updates + offline banner)
- `src/features/tracking/states.tsx` (searching / active / completed / cancelled / expired / not-found renderings)
- (edits: `layout.tsx` or a `t/[token]` layout to inject `themeCssVars()`; `package.json` +`leaflet` +`@types/leaflet`)

### Relevant Documentation — READ BEFORE IMPLEMENTING

- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/dynamic-routes.md` — **`params` is a `Promise` in Next 16**: `const { token } = await params`; `PageProps<'/t/[token]'>` typing helper
- `node_modules/next/dist/docs/01-app/01-getting-started/06-fetching-data.md` — server-component fetch + `cache: 'no-store'` for per-request freshness
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` — the `data/route.ts` proxy (**verified** `:195`: handler context params are awaited too — `const { token } = await ctx.params`; `RouteContext<'/t/[token]/data'>` types it)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md` — **verified** `:13-14`: BOTH `params` AND `searchParams` are `Promise`s in Next 16 — `await` each; `searchParams` values are `string | string[] | undefined`, so normalize `lang` before `z.enum(LANGUAGES)` parsing
- `docs/research/rider-ux-evidence.md:59-76` — the send-policy sentence this plan implements verbatim
- `.claude/references/logging-standard.md` — extend domains with `notification`? No — see Patterns: stay inside the `ride` domain
- `.claude/references/ride-state-machine.md`, `.claude/references/realtime-events.md` — context only; this feature adds NO socket events
- Leaflet quick start (offline knowledge is fine — stable API): `L.map`, `L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png')`, `L.marker.setLatLng`

### Patterns to Follow

**Seam widening (minimal, matching the existing seam's error style):**

```ts
// packages/shared/src/seams/sms-provider.ts — sendOtp stays untouched
export interface SmsProvider {
  sendOtp(phoneE164: string, code: string): Promise<void>;
  /** Free-form notification SMS. Throws on delivery failure — callers on the
   *  ride path MUST catch: an SMS failure never fails a booking. */
  send(phoneE164: string, body: string): Promise<void>;
}
```

**Post-commit hook, never-throws (mirror `emitStatus`'s own catch at `ride-transition.service.ts:116`):**

```ts
// inside RideTransitionService.emitStatus, after the socket emit:
void this.notifications.onStatus(ride, from); // fire-and-forget; onStatus catches everything itself
```

**Logging** — stay in the standard's `ride` domain (component `notifications`), `event` first, `at` last, phones masked:
`ride.notifications.sms_sent` (log: `rideId`, `kind: 'booking_confirmed'|'driver_assigned'|'driver_arrived'`, `channel`, `phone: maskPhone(...)`) · `ride.notifications.sms_send_failed` (**error** level — this IS the alarm-to-console) · `ride.notifications.track_view_denied` (warn; `reason: 'unknown'|'expired'`, token NEVER logged in full — first 4 chars only).

**Token**: `randomBytes(16).toString('base64url')` (22 chars) minted in `TrackingService`; shared only validates shape: `z.string().regex(/^[A-Za-z0-9_-]{22}$/)`.

**Schema evolution that can't break existing parses**: `bookingChannel: z.enum(BOOKING_CHANNELS).default('app')`, `trackingToken: trackingTokenSchema.nullable().default(null)` on `rideSchema` — legacy objects/rows still parse. Keep plain `ZodObject` (no `.refine()`).

**Naming**: `*Cents` for money (none here), `*.policy.ts` for pure constants, `(expected)/(edge)/(failure)` test titles with ACs cited inline, `as const satisfies` on enum tuples (never a type annotation).

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts (packages/shared)

**Tasks:**
- `BOOKING_CHANNELS = ['app', 'phone'] as const` in `enums.ts`
- `schemas/tracking.ts`: token schema; `TRACKING_PAGE_STATES = ['searching','assigned','arriving','arrived','in_progress','completed','cancelled','expired'] as const`; `trackingViewSchema` (wire — ISO strings): `{ state, driverName: string|null, driverPhotoUrl: string|null, vehiclePlate: string|null, position: {lat,lng,at}|null, etaMinutes: number|null, dispatchPhone: string, updatedAt: string }`
- Extend `rideSchema` (+`bookingChannel`, +`trackingToken`) and `platformConfigSchema` (+`dispatchPhone: phoneSchema`)
- Widen `SmsProvider` with `send()`
- `src/i18n.ts`: `MESSAGES` for lv/ru/en with `{placeholder}` interpolation via `formatMessage(lang, key, params)`. Keys: `sms.booking_confirmed`, `sms.booking_confirmed_phone` (includes `{link}`), `sms.driver_assigned` (`{driver} {plate} {eta} {link}`), `sms.driver_arrived`, and the page strings (`page.title`, `page.searching`, `page.driver`, `page.plate`, `page.eta_minutes`, `page.call_dispatch`, `page.completed`, `page.cancelled`, `page.expired`, `page.not_found`, `page.position_updated`, `page.connection_lost`). LV copy drafts: "Jūsu taksometrs ir rezervēts." · "Jūsu taksometrs ir rezervēts. Sekojiet līdzi: {link}" · "Jūsu šoferis {driver}, {plate}, būs pēc ~{eta} min. Sekojiet līdzi: {link}" · "Jūsu taksometrs ({plate}) ir klāt." (RU/EN translated equivalents; short — SMS are billed per segment)
- Barrel: add both new files to `src/index.ts`

### Phase 2: DB migration + seed

**Depends on:** Phase 1 (schema field names must match)

**Tasks:**
- Drizzle schema edits: `rides.tracking_token` text + UNIQUE index (nullable — legacy rows never get one), `rides.booking_channel` pg-enum `booking_channel` NOT NULL DEFAULT `'app'` (the default is legitimate here: it is a fact about legacy rows, not a config knob), `drivers.photo_url` text nullable, `platform_config.dispatch_phone` text NOT NULL (migration: `ADD COLUMN … DEFAULT '+37160000000'` then `DROP DEFAULT` — the 0006 precedent; seed supplies the real value)
- `pnpm --filter @taxi/db generate` → hand-check `0007_*.sql`, then `migrate`, update `seed/riga.ts` (dispatch phone; one seeded driver gets a `photo_url`)

### Phase 3: API — notifications slice + hooks

**Depends on:** Phases 1–2

**Tasks:**
- `positionOf(cityId, driverId)` on the `DriverLocationStore` port + Redis impl (GEOPOS + ZSCORE, validated replies) + promote the in-memory fake's helper to the interface + contract-test cases
- Notifications slice (files listed above). `RideNotificationsService` policy: creation → `booking_confirmed` SMS to rider's `users.phone` in `users.language` (phone-channel body carries the link, built from `PUBLIC_TRACKING_BASE_URL` + `?lang=` when ≠ lv); `to === 'accepted'` AND `bookingChannel === 'phone'` → `driver_assigned` SMS (driver first word of `displayName`, plate, haversine ETA); `to === 'arrived'` → `driver_arrived` SMS (all channels). Everything else: no-op. Wrap the entire body in try/catch → `sms_send_failed` error log.
- Plate resolution (documented assumption): driver's vehicles filtered to `ride.category`, else first vehicle, else null.
- `TrackingService.view(token)`: lookup by token → 404 unknown; terminal ride older than `TRACKING_TERMINAL_GRACE_SECONDS` (86 400, policy file) by `updatedAt` → 410 expired; else build `trackingViewSchema` payload. Position: `positionOf(env.DEFAULT_CITY_ID, driverId)`; ETA: haversine × `TRACKING_ETA_SPEED_MPM` (417 m/min ≈ 25 km/h, policy file, comment: v1 estimate, upgrade path = maps seam with quantized cache) to pickup while `accepted/arriving/arrived`, to dropoff while `in_progress` (coords from `rideRequestSchema.parse(ride.request)`).
- Token minting wired into ride creation (`RidesService` insert path via `RidesRepository`) — every ride gets one (share-trip #17 reuses).
- Hooks: 2-line additions in `rides.service.ts` post-commit block and `RideTransitionService.emitStatus`. Coverage already **verified on the post-split #82 code** (see the concurrency note): all `accepted` paths reach `emitStatus` via `DispatchNotifier.emitAssigned`, all `arrived` paths via the lifecycle service — no further verification needed.
- `app.module.ts`: register `NotificationsModule` before `RidesModule` with an order comment; `env.schema.ts` + `.env.example`: `PUBLIC_TRACKING_BASE_URL` (default `http://localhost:3000`); auth barrel: export `smsProviderFactory`; harness: `RecordingSmsProvider.send()` + `sentMessages`.

### Phase 4: Web page (apps/dispatch)

**Independent of:** Phase 3 can be finished/validated first, but the page only needs the endpoint's *contract* (Phase 1) — parallel-safe in principle; sequential is fine solo.

**Tasks:**
- Read the three Next 16 doc files (mandatory — `AGENTS.md`).
- `t/[token]/page.tsx`: SSR fetch of `${process.env.API_URL}/track/:token` (`no-store`), render status + driver card + `tel:` dispatch-phone link (≥44 px, visible focus) per state; `<html lang>` per `?lang`; map island only when position exists. 404/410 → dedicated states.
- `data/route.ts` proxy; `tracking-map.tsx` client island: Leaflet + OSM tiles, 5 s poll of the proxy, `aria-live="polite"` status region, map `aria-hidden` with a text alternative ("driver ~{eta} min away"), offline banner on poll failure showing last-updated time.
- Theme: inject `themeCssVars()` (a `<style>` in the segment layout); reference `var(--color-*)`/`var(--spacing-*)` — no hardcoded colors. Log any cosmetic question to `.claude/references/ui-decisions.md` instead of debating it.

**UX section (hard-rule requirements):**

- Breadboard: `SMS [tracking link] → /t/:token (status line · driver card · map · [Zvanīt dispečeram tel:])`; terminal states end the flow in place.
- States: loading (SSR — none client-side; map placeholder box), empty/searching (no driver yet), error (not-found · expired · API-down generic retry), offline (poll-failure banner + stale timestamp).
- Friction audit: intent→done = **1 tap** (open SMS link). Zero decisions. No lower-friction option exists.
- Touch targets ≥44 px + visible focus on the only interactive element (call button + language links); page must read cleanly under VoiceOver (it will be used BY assistants).

### Phase 5: Tests & validation — see TESTING STRATEGY / VALIDATION COMMANDS

---

## STEP-BY-STEP TASKS

### UPDATE `packages/shared/src/enums.ts` + CREATE `src/schemas/tracking.ts` + `src/i18n.ts`; UPDATE `schemas/ride.ts`, `schemas/platform-config.ts`, `seams/sms-provider.ts`, `src/index.ts`

- **IMPLEMENT**: Phase 1 exactly as specified; `as const satisfies` on tuples; plain `ZodObject`s; wire schema ISO strings
- **PATTERN**: `enums.ts:26-28` (tuple style), `realtime-events.ts:11-17` (wire dates), `payments-provider.ts` docblock style for the seam comment
- **GOTCHA**: zod **v3** APIs only; no Node globals (isomorphic fence); imports in tests from `../src/<module>`, never the barrel
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared typecheck` (typecheck runs tsc twice — both must pass)
- **SATISFIES**: foundations for AC #1–#3

### CREATE shared tests `tests/tracking.test.ts`, `tests/i18n.test.ts`

- **IMPLEMENT**: token format (expected/edge/failure); view-schema ISO rejection of `Date`; i18n completeness — every key present in all three languages, identical `{placeholder}` sets across languages (property-test style)
- **PATTERN**: `tests/theme.test.ts` (property assertions), `tests/ride-state-machine.test.ts:15-40`
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #3 test bar; hard rule "contract change ships with tests"

### UPDATE `db/src/schema/{rides,drivers,platform-config,enums}.ts` → GENERATE migration 0007 → UPDATE `seed/riga.ts`

- **IMPLEMENT**: Phase 2 columns; run `pnpm --filter @taxi/db generate`; hand-check SQL (DEFAULT-then-DROP for `dispatch_phone`; keep `booking_channel` DEFAULT); `pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed`
- **GOTCHA**: `updated_at` trigger — no `.$onUpdate()`; docker compose must be up. **Verified**: `db-schema.spec.ts` is only an import smoke test (tables + `createDb` defined) — no drizzle↔shared parity assertions, nothing to update there
- **VALIDATE**: `pnpm --filter @taxi/db test && cd services/api && npx jest db-schema`
- **SATISFIES**: AC #1 (channel), AC #2 (token, photo, phone)

### UPDATE `driver-location.store.ts` port + `redis-driver-location.store.ts` + `test/harness.ts` fake + `test/driver-location-store.contract.ts`

- **IMPLEMENT**: `positionOf(cityId, driverId): Promise<{ location: LatLng; atMs: number } | null>`; Redis = GEOPOS + ZSCORE with validated replies; contract cases: recorded→returned (expected), unknown driver→null (edge), offline-but-recorded driver still readable (edge — tracking outlives presence)
- **PATTERN**: `redis-driver-location.store.ts:31-45` reply validation; contract file structure
- **VALIDATE**: `cd services/api && npx jest driver-location` (Redis half needs `REDIS_TEST_URL`; without it the fake half still proves the contract)
- **SATISFIES**: AC #2 live position

### CREATE `services/api/src/features/notifications/` (slice per file list) + UPDATE `auth/index.ts`, `test/harness.ts`

- **IMPLEMENT**: Phase 3; `notifications.module.ts`: `imports: [DriversModule, PlatformConfigModule]` (verified exports: `DRIVER_LOCATION_STORE` from drivers, `PlatformConfigService` from platform-config — the latter is deliberately not `@Global()`), binds `SMS_PROVIDER` via auth's `smsProviderFactory` (add factory to auth barrel with a one-line docblock; the duplicate binding is deliberate — two stub instances are harmless, and `overrideProvider(SMS_PROVIDER)` in the harness overrides the token globally so `RecordingSmsProvider` captures both OTP and ride SMS); `StubSmsProvider.send()` logs body + masked phone; `RecordingSmsProvider.send()` records `{phone, body}`
- **GOTCHA**: `@Public()` route must NOT carry `@Roles`; `@CurrentUser()` is undefined there; route path `track/:token` cannot shadow anything (new controller); typed-lint requires the new files to be inside the api tsconfig include (they are, under `src/`)
- **VALIDATE**: `cd services/api && npx jest notifications`
- **SATISFIES**: AC #1, #2, #3

### UPDATE `rides.service.ts` (+hook, +token mint via repository insert) · `ride-transition.service.ts` (+hook) · `rides.repository.ts` (column mapping) · `app.module.ts` · `env.schema.ts` · `.env.example`

- **IMPLEMENT**: two fire-and-forget hook lines in the existing post-commit blocks; `bookingChannel` param on the service create path defaulting `'app'` (`rideRequestBodySchema` gains NOTHING — the wire contract for riders is unchanged; #19 passes `'phone'` server-side)
- **PATTERN**: `rides.service.ts:297-303` (post-commit never throws); module-order comment style at `app.module.ts:18-36`
- **GOTCHA**: do NOT touch `features/dispatch/` (that's #69/PR #82 territory — coverage of `accepted` through `emitStatus` is already verified there). `PUBLIC_TRACKING_BASE_URL` defaults to `http://localhost:3000` (the dispatch app's dev origin, already first in the seeded `CORS_ORIGINS`); API dev port is `3001` (`env.schema.ts:43`). Note `.env.example` already lists `TWILIO_*` vars that `env.schema.ts` does not know — pre-existing drift, leave it alone
- **VALIDATE**: `cd services/api && npx jest rides`
- **SATISFIES**: AC #1 (≤30 s — send fires inside the creation request, so delay ≈ 0), AC #2

### CREATE `tracking/tracking.integration.spec.ts` + `ride-notifications.service.spec.ts`

- **IMPLEMENT**: integration — boot `createTestApp()`, claim phone range `+371270…` (register it at `ride-lifecycle.integration.spec.ts:29-36`); phone-channel ride via `RidesService` with `bookingChannel:'phone'` → assert `RecordingSmsProvider` got confirm SMS whose body contains the `/t/<token>` link (expected, AC #1); walk accepted→arrived, assert `driver_assigned` + `driver_arrived` SMS and `GET /track/:token` 200 with plate+driver+position at each state; complete → terminal `completed` state (AC #2); backdate `updated_at` via raw SQL → 410 (edge, AC #3); unknown token → 404; unit — SMS provider `send` throws → creation still resolves + `ride.notifications.sms_send_failed` logged (failure, AC #3); app-channel ride gets NO link and NO `driver_assigned` SMS (edge)
- **PATTERN**: `ride-lifecycle.integration.spec.ts` boot/cleanup; `rides.service.spec.ts` build-factory style
- **GOTCHA** (**verified**, migration `0003`): the trigger is `BEFORE UPDATE … NEW.updated_at = now()` — **unconditional**, so a plain backdating `UPDATE` is silently overwritten. The spec must wrap the backdate: `ALTER TABLE rides DISABLE TRIGGER rides_set_updated_at` → `UPDATE rides SET updated_at = now() - interval '2 days' WHERE id = …` → `ALTER TABLE rides ENABLE TRIGGER rides_set_updated_at`. Safe because jest runs serially (`maxWorkers: 1`); keep the re-enable in a `finally`
- **VALIDATE**: `cd services/api && npx jest notifications`
- **SATISFIES**: AC #3's ≥1 expected + 1 edge + 1 failure, binding AC #1/#2

### CREATE the page: `apps/dispatch/src/app/t/[token]/{page.tsx,data/route.ts}` + `src/features/tracking/` + UPDATE layout/theme + `package.json` (+leaflet)

- **IMPLEMENT**: Phase 4 as specified; `pnpm add leaflet @types/leaflet --filter @taxi/dispatch`
- **PATTERN**: none in-repo (first real page) — the Next 16 bundled docs are the pattern source; strings via `formatMessage` from `@taxi/shared` (first app import of the package)
- **GOTCHA**: `await params` / `await searchParams`; Leaflet CSS must be imported in the client component; Leaflet touches `window` — the island must be client-only (`'use client'` + mount in `useEffect`); `API_URL` is read server-side at request time (dynamic page — fine), add it to `apps/dispatch` env handling and document in root `.env.example`
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck && pnpm --filter @taxi/dispatch lint && pnpm --filter @taxi/dispatch build`
- **SATISFIES**: AC #2

### Manual E2E + gate

- **IMPLEMENT**: `docker compose up -d --wait` → api dev + dispatch dev → create a phone-channel ride (script or REPL against `RidesService`), read the stub-SMS log for the link, open it, drive the lifecycle via the REST lifecycle routes with a driver JWT, watch the page through searching→assigned→arrived→in_progress→completed; kill the SMS stub (throw) and confirm booking still succeeds + error log
- **VALIDATE**: `pnpm turbo run typecheck lint test build --force` from cleared dist (CI parity; `pnpm check` is NOT the gate)
- **SATISFIES**: all ACs + Done definition

---

## TESTING STRATEGY

### Unit Tests
`ride-notifications.service.spec.ts` with the `build()` fake-factory style: template/language selection, channel policy, never-throws guarantee. Shared: schema + i18n property tests (vitest).

### Integration Tests
`tracking.integration.spec.ts` on the real `AppModule` via `createTestApp()` — the full SMS + page-endpoint story against real Postgres (serial jest, own E.164 range). `positionOf` via the store contract file (fake always; Redis under `REDIS_TEST_URL` — set it locally, a green gate can otherwise run short).

### Edge Cases
Expired token (410) · unknown token (404) · ride with no driver yet (searching state, `position: null`) · driver with no `photo_url` (placeholder) · driver with multiple vehicles (category match, else first) · app-channel ride (no link SMS, no assigned SMS) · SMS provider down (booking succeeds, error log) · stale GPS (page shows last-updated time) · `lang=ru|en` overrides · legacy ride row with NULL token (page unreachable — by design)

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
`pnpm turbo run typecheck lint --force`

### Level 2: Unit Tests
`pnpm --filter @taxi/shared test` · `cd services/api && npx jest notifications rides driver-location`

### Level 3: Integration Tests
`REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test` (port per your `.env` `REDIS_PORT`)

> ⚠️ Integration runs are **mutually destructive across concurrent Claude sessions**: `test/global-setup.ts` opens with `DROP DATABASE … WITH (FORCE)`, which kills any other session's in-flight run (signature: `terminating connection due to administrator command`, varying failed-suite sets, all green in isolation). Check no other session is testing before running the gate.

### Level 4: Manual Validation
The Manual E2E task above; plus `curl -s localhost:<API_PORT>/track/<token>` for the three response classes (200/404/410), and a VoiceOver pass over the page.

### Level 5: Full gate
`pnpm turbo run typecheck lint test build --force` — the Done definition.

---

## ACCEPTANCE CRITERIA

- [ ] AC #1 — 100% of phone bookings produce confirmation + tracking-link SMS ≤ 30 s from booking save (link rides IN the confirmation SMS, sent synchronously-adjacent at creation; measured via `ride.notifications.sms_sent` logs vs `rides.created_at`)
- [ ] AC #2 — page shows plate + driver + live position for the full active lifecycle, then a terminal "completed" state
- [ ] AC #3 — ≥1 expected + 1 edge (expired token) + 1 failure (SMS provider down → booking still succeeds, alarm to console) test
- [ ] SMS budget policy: 2 SMS/ride app channel (confirmed + arrived), 3 phone channel (+ driver-assigned with link) — asserted in specs
- [ ] No rider PII on the page beyond nothing-at-all (page shows only driver/vehicle/position/ETA/dispatch phone — the ticket permits first name; we expose none)
- [ ] All strings via the new shared catalog; theme via `themeCssVars()`; ≥44 px targets; visible focus; aria-live status
- [ ] `pnpm turbo run typecheck lint test build --force` green

## COMPLETION CHECKLIST

- [ ] All tasks executed top-to-bottom, each VALIDATE run at the time
- [ ] Branched from `main` AFTER PR #82 (#69 split) merged — `git pull` + `git reflog -8` checked first per the concurrent-sessions rule
- [ ] New E.164 range registered in the registry comment
- [ ] `.env.example` + `env.schema.ts` in sync (`PUBLIC_TRACKING_BASE_URL`, dispatch `API_URL` documented)
- [ ] `.claude/references/realtime-events.md` untouched (no new events) — confirm no accidental drift
- [ ] PR body links `Closes #63`

---

## OPEN QUESTIONS / ASSUMPTIONS

Flagged for Linards; the plan proceeds on the starred resolutions — override before execution if wrong:

1. ★ **SMS timing interpretation**: the ticket's "link SMS (driver name, plate, ETA)" cannot be sent ≤30 s from save if no driver has accepted. Resolution: the link travels in the **confirmation** SMS at save (meets the ≤30 s ledger row); the driver-details message goes at `accepted` (the Uber follow-up text). 3 SMS/phone booking, 2/app — matches the ticket's budget line.
2. ★ **Page host = `apps/dispatch`** (the "one web app" from the 2026-08-07 decision; public route, no auth exists there yet anyway). Rejected: serving HTML from NestJS (violates surface separation), a third app (violates the merge decision).
3. ★ **Token lifetime**: live while active; terminal state visible for 24 h after `updated_at`, then 410. "Expires with the ride" left the grace unstated.
4. ★ **Plate resolution heuristic** (category match → first vehicle) until a ride records its vehicle at acceptance — a future dispatch-side improvement, not this ticket (dispatch is frozen under #69).
5. ★ **`dispatch_phone` lives in `platform_config`** (config-not-constant doctrine, admin-editable via #20), not env.
6. ★ **ETA is a haversine estimate** at 25 km/h — zero maps spend on a page polled every 5 s. Upgrade path documented in the policy file.
7. **Driver photo**: nullable `photo_url` + placeholder. If even the column is unwanted now, drop it and render initials only — page copes either way.
8. **`sendOtp` untouched / no seam result-union**: SMS failures throw (caught by the notifications service). If the PaymentsProvider-style result union is preferred, it's a contained change to `sms-templates`/service.

## NOTES (open canvas)

- **Why hook `emitStatus` and not each caller's post-commit block** (against the research agent's lean): three call sites reach `accepted`/`arrived` (dispatch accept, force-assign, lifecycle), and `features/dispatch` was restructured by #69 (PR #82) while this plan was written. One filtered hook in the stable `RideTransitionService` = zero contention with that PR and automatic coverage of any future accept path — **and the bet held**: on the post-split code, both assignment paths converge on `DispatchNotifier.emitAssigned → emitStatus` (verified, see concurrency note), so the split changed nothing for this plan. The churn concern (offered↔requested loop) is neutralized by filtering on target status — `accepted` and `arrived` are each reachable at most once per ride (all cancellations are terminal; the re-offer loop never passes through either).
- **Why a Next route-handler proxy for polling** instead of CORS: `CORS_ORIGINS` exists in env, but the proxy keeps the page origin-only, hides the API base from the client, and needs zero API changes. Cost: one extra hop on a 5 s poll — irrelevant at pilot scale.
- **Why not socket for the page**: realtime is JWT-only by design (handshake middleware rejects anonymous connections; ride rooms are server-joined). A public-namespace socket would be a security-surface change for zero v1 benefit. Ticket says polling is fine.
- **SMS spend measurement**: `ride.notifications.sms_sent` carries `kind` + `channel` → €/week derivable per the metrics ledger ("api logs (SMS provider seam)"). No DB changes for cost.
- **Rejected: outbox/dedupe table** for SMS idempotency — transitions are race-guarded by the conditional UPDATE, so `emitStatus` fires once per applied transition; a crash between commit and send loses at most one SMS, same accepted risk as socket emits.
- **Doc-drift warning inherited from research**: `services/api/CLAUDE.md`'s slice list includes not-yet-existing slices (`notifications` among them — we make one of them true) and `test/harness.ts:325-327` has a stale "no guarded routes yet" comment. Don't "fix" unrelated drift in this PR; `rules-check-drift` can catch it separately.
- **`dispatch.service.ts` is 612 lines** and over the limit — another reason this plan never touches it (#69 is the fix).
- Post-merge follow-ups worth logging as issues: real SMS provider factory branch (Twilio/LV gateway), Dina-console SMS-failure alert (#18), ride-records-vehicle-at-accept, maps-based ETA with quantized cache.

## CONFIDENCE

**9.5/10** for one-pass implementation. Every integration point is verified at file:line against the code the implementer will inherit (post-#82 for dispatch, `main @ e81b807` for everything else); the three formerly-open mechanics (hook coverage, `updated_at`-trigger interaction, Next 16 `params`/`searchParams`/route-handler contracts) are resolved above with the exact technique to use. The residual 0.5: first-ever page in a stub Next 16 app (no in-repo pattern to mirror) and the LV/RU translation quality of the SMS copy (drafted, but a native check is warranted before pilot).

## AMENDMENTS

<!-- append-only after first approval; newest at the bottom -->
