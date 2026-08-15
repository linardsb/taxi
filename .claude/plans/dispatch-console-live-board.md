# Feature: Dispatch console — live board, merged web app, reliability-first (#18)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Dina's primary screen: a live dispatch board in the (newly merged) web app showing the ride queue (requested / offered / active), online drivers grouped by geozone with a map toggle, and operator alerts (unclaimed orders flashing — her S9-4 trigger — plus SMS-send failures). Reliability **is** the feature (S7-4: her autoosta system "often freezes"): a truthful connection pill (Tiešraide / Atjaunojas… / Bezsaistē), exponential backoff + jitter, snapshot-on-reconnect always, and a read-only HTTP-polling fallback so the console never traps data.

This ticket also **opens the merged dispatch+admin web app** (decision 2026-08-07): app shell, dispatcher auth (OTP → JWT), role-gated route groups `/dispatch` + `/admin`; the `apps/admin` workspace retires.

The backend surface the board needs mostly does not exist yet (verified 2026-08-15): a dispatcher socket today receives only `dispatch:unclaimed` and `driver:location`; `dispatch:board` is schema-only with no emit site; there are **zero** REST snapshot endpoints; no online-drivers list function; no dispatcher provisioning path. This plan therefore includes API-side work.

## User Story

As **Dina, the dispatcher**
I want **one screen that always truthfully shows every live ride and every online driver, and flashes when an order goes unclaimed**
So that **I can intervene the moment the platform fails a rider — and trust the screen even when the network doesn't cooperate**.

## Problem Statement

There is no dispatcher surface at all: `apps/dispatch` contains only the public tracking page, `apps/admin` is untouched boilerplate. The dispatch engine (#10) already raises `dispatch:unclaimed`, but nobody is listening. The top operator complaint about the closest comparable product (TaxiCaller) is *silent staleness* — a console that looks alive while stale is worse than dead (dispatch-ops-ux-evidence F1.2/F6.1).

## Solution Statement

**Full-state broadcast + snapshot REST, one payload shape.** The API builds a board snapshot (`rides[]` + `drivers[]` per city) in one service and serves it two ways: `GET /dispatch/board` (dispatcher/admin-guarded REST) and a cadenced `dispatch:board` socket emission to the `dispatch:<cityId>` room. The client replaces state wholesale on every frame — no event-sourcing merge bugs, and the cadence doubles as a staleness heartbeat for the truthful pill. On every (re)connect the client fetches the REST snapshot (CSR is off server-side — Redis pub/sub adapter doesn't support it — so `recovered` is always false and full resync is mandatory anyway, exactly what the re-slice prescribes). When the socket won't come back, the same REST endpoint becomes a 5 s read-only poll. `dispatch:unclaimed` and a new `dispatch:sms_failed` event drive the alert panel directly (event-driven, not cadence-bound).

## Out of Scope / Non-Goals

- **Not included: queue positions + time-in-zone in the zones panel** — needs new Redis state (zone-entry timestamps) + a queue read model; defer to #19's zone/queue view (scope decision by Linards, 2026-08-15: #18 groups drivers by zone only).
- Not included: force-assign/override UI, reassign, dispatcher-cancel, phone-order entry, telephony seam, cascade explainability strings (all #19; the API deliberately has no reassign/cancel commands — `services/api/src/features/dispatch/index.ts:36-40`).
- Not included: any `/admin` content beyond a role-gated placeholder page (#20).
- Not included: booking-form draft persistence (`docs/ux-metrics-ledger.md` row "#18/#19") — #18 ships no booking form; the mechanism lands with #19's form.
- Not included: token refresh / logout endpoint (30 d JWT, no revocation — pre-existing posture, `env.schema.ts:8-9`).
- Not included: enabling Socket.IO Connection State Recovery (unsupported on the pub/sub Redis adapter — evidence F6.2; snapshot-always makes it unnecessary).
- Not included: the `DEFAULT_CITY_ID` orphaned-driver fix (needs a `cityId` column on `drivers` — issue #18 comment 1; single-city pilot; cheap sweep documented there if ever needed).
- Not included: rider leg of `driver:location` fan-out (`driver-location.service.ts:61-62`, future work), `driver:queue` emission (#19+), Playwright (#88 non-goal), audio files/complex alert sounds (one Web-Audio beep behind a mute toggle is included; anything richer → `.claude/references/ui-decisions.md`).
- Not changing: the public tracking page (`t/[token]/**`) including its segment-level theme injection; the react 19.2.3 pnpm override vs 19.2.4 manifest discrepancy (pre-existing, all-web-apps); dispatch engine cascade logic.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High
**Primary Systems Affected**: `apps/dispatch` (becomes the merged web app), `services/api` (dispatch board read model, notifications alert, realtime), `packages/shared` (event catalog, i18n), `apps/admin` (deleted), root docs
**Dependencies**: `socket.io-client` (new, apps/dispatch — first browser socket client in the monorepo); everything else already installed (leaflet 1.9.4, vitest 3, RTL 16)

## Related Work

**Implements**: GitHub issue #18 (`Closes #18` in the PR) · **Epic**: #1, decisions inherited from `docs/epics/sakta-cab.architecture.md` ("UI surface decisions (2026-08-07)": one web app, role-gated route groups, admin workspace retires; "Key decisions": stack reaffirmed, contracts only in `@taxi/shared`)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/api-auth-realtime-gateway.md` (#7) — the gateway/room-policy the socket client must satisfy
- `.claude/plans/api-dispatch-engine.md` (#10) — the sweeper + unclaimed alert this board displays
- `.claude/plans/rider-comms-sms-tracking-page.md` (#63) — origin of every existing `apps/dispatch` pattern (leaflet island, proxy route, i18n usage)
- `.claude/plans/dispatch-test-runner-vitest-rtl.md` (#88) — the test runner this plan's tests run on; recorded the admin-retirement note at :1080-1084
- `.claude/plans/dispatch-tracking-429-throttle-ux.md` (#100) — ref-based poll-backoff pattern reused by the fallback poller

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #19 (zone/queue view, force-assign UI, phone orders) builds directly on this board
- #20 (/admin routes) fills the placeholder route group this ticket creates

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Contracts (packages/shared):**
- `packages/shared/src/realtime-events.ts` — the whole file. `RT` (:22-31), `dispatchBoardEventSchema` (:132-151, "#18 owns … will widen"), `dispatchUnclaimedEventSchema` (:155-164), `driverLocationEventSchema` (:48-50), room helpers (:167-178), `ServerToClientEvents` (:203-212), `RT_EVENT_SCHEMAS` (:223-232, closed via `satisfies` — the 9th event must be added in all four places). Wire timestamps are ISO strings, never `Date` (:11-16).
- `packages/shared/src/i18n.ts` — `lv` reference dictionary (:15-44), `MessageKey` (:46), `MESSAGES … satisfies` (:48,107) forces RU/EN key parity, `formatMessage` (:114-121).
- `packages/shared/src/ride-state-machine.ts` — `RIDE_STATUSES` (:1-16), `ACTIVE_DRIVER_RIDE_STATUSES` (:35-40), terminal/cancelled helpers (:20-25, :121-125).
- `packages/shared/src/enums.ts` — `DRIVER_STATUSES` (:44), `BOOKING_CHANNELS` (:99), `LANGUAGES` (:4).
- `packages/shared/src/schemas/geo.ts` — `latLngSchema` (:3-6), `addressPointSchema` (:9-13).
- `packages/shared/src/schemas/auth.ts` — `AuthSession` (:42-46), `JwtClaims` (:55-60, no phone), `SIGNUP_ROLES` (:10, dispatcher excluded by design).
- `packages/shared/src/theme-css.ts` — `themeCssVars()` (:12-20).

**API (services/api):**
- `src/features/realtime/realtime.gateway.ts` — handshake (:107-126, token from `handshake.auth.token` then Bearer header), rooms on connect (:140-158), token sweep (:49, :84-100).
- `src/features/realtime/room-policy.ts` — `canJoin` (:14-26): dispatch room = dispatcher|admin; ride rooms `false` for everyone (:25).
- `src/features/realtime/realtime.service.ts` — `emitToDispatch` (:38), private `emit` parses via `RT_EVENT_SCHEMAS` and **throws on mismatch** (:63-75); every caller catches + logs `*_notify_failed`.
- `src/features/realtime/index.ts` — "Do not add the missing join handler" (:1-10).
- `src/features/dispatch/dispatch.service.ts` — `raiseUnclaimed` (:314-357): dedupe first (:315-319), emit (:327-340), catch→log (:341-348).
- `src/features/dispatch/dispatch.sweeper.ts` — pass structure (:74-89), **no auto-start under NODE_ENV=test** (:57), pass-failure logging (:96).
- `src/features/dispatch/dispatch.policy.ts` — `SWEEP_INTERVAL_MS = 1_000` (:38), platform-config knobs incl. `unclaimedAlertSeconds` default 60 (:4-8).
- `src/features/dispatch/dispatch.controller.ts` — guard/route patterns; force-assign `POST /dispatch/rides/:rideId/assign` `@Roles('dispatcher','admin')` (:64-65).
- `src/features/drivers/location/redis-driver-location.store.ts` — keys (:10-14), Lua `record` (:59-62, :89-94), `findNearby`/`positionOf` port (:25-63; **no list-all exists**).
- `src/features/drivers/location/driver-location.policy.ts` — `DRIVER_LOCATION_TTL_SECONDS = 60` (:15, read-time filter).
- `src/features/drivers/location/driver-location.service.ts` — emit site for `driver:location` (:65-70), hot path never touches Postgres (:16-23 spec trick).
- `src/features/rides/rides.repository.ts` — `findAwaitingDispatch` (:185) — the pattern to MIRROR for the board rides query.
- `src/features/notifications/ride-notifications.service.ts` — the `ride.notifications.sms_send_failed` `logger.error` (:171) where the new event is emitted; `src/features/notifications/index.ts:24` assigns the console alert to #18.
- `src/features/auth/auth.controller.ts` — `POST /auth/otp/request` (:21), `POST /auth/otp/verify` (:30). `src/features/auth/auth.repository.ts:47-63` — stored role always wins on `findOrCreate` (this is why a provisioned dispatcher can log in with `role:'rider'` in the request body).
- `src/common/config/env.schema.ts` — `DEFAULT_CITY_ID` (:45), `CORS_ORIGINS` (:178-186, default already includes `http://localhost:3000`), `JWT_EXPIRES_IN` 30d (:42).
- `src/features/realtime/redis-io.adapter.ts` — socket CORS is separate from REST CORS (:12-17, :45-54).
- `scripts/mint-tracked-ride.ts` — the scripted-ride-flow driver for manual validation; also the pattern for the new provisioning script.

**Web app (apps/dispatch):**
- `src/features/tracking/tracking-map.tsx` — THE prior art: `'use client'` leaflet island, dynamic `await import('leaflet')` in useEffect (:131), imperative marker updates (:144-147), unmount cleanup (:154-161), `aria-hidden` map div + text alternative (:310-319), ref-based poll backoff (:82-123), `POLL_MS = 5_000` (:15).
- `src/app/t/[token]/page.tsx` — async-RSC page shape, `langFrom` (:26-31), inline `style` with `var(--color-*)` (everywhere), 44px+focus conventions.
- `src/app/t/[token]/layout.tsx` — segment-level `themeCssVars()` injection (:14) + focus-visible outline CSS (:16-21). MIRROR for the console segment; do not touch this file.
- `src/app/t/[token]/data/route.ts` — server-proxy pattern (stays; the console uses direct browser→API instead — see NOTES).
- `src/features/tracking/*.test.tsx` + `vitest.config.ts` + `vitest.setup.ts` — every test convention (see Patterns).
- `apps/dispatch/CLAUDE.md` (needs updating), `apps/admin/CLAUDE.md` (scope prose to carry over before deletion), root `CLAUDE.md` monorepo map (:10-14 table).
- Root `turbo.json` — `test`/`build` tasks (:12-28); `globalEnv` (:3-10) has no `NEXT_PUBLIC_*` yet.
- `.env.example` — dispatch web app block (`API_URL` around :43), `CORS_ORIGINS` (:36), `DEFAULT_CITY_ID` (:35).

### New Files to Create

**packages/shared** — widen in place (`realtime-events.ts`, `i18n.ts`); no new files.

**services/api:**
- `src/features/dispatch/board/board.service.ts` — snapshot builder + cadenced emitter
- `src/features/dispatch/board/board.policy.ts` — `BOARD_EMIT_INTERVAL_MS`, `BOARD_RIDES_LIMIT`
- `src/features/dispatch/board/board.service.spec.ts`, `board.controller.spec.ts` (or fold the GET route into `dispatch.controller.ts` + its spec — prefer folding: one controller per slice)
- `src/features/drivers/location/…` — `listOnline(cityId)` added to the existing store port + Redis impl (+ gated spec)
- `scripts/provision-dispatcher.ts` — upsert a user with `role='dispatcher'` by phone (scripts are uncapped/outside max-lines)

**apps/dispatch:**
- `src/features/auth/session.ts` — token+user persistence (localStorage), parse/expiry helpers
- `src/features/auth/use-session.ts`, `src/features/auth/login-form.tsx`, `src/features/auth/require-role.tsx` (client guard)
- `src/features/auth/*.test.tsx`
- `src/features/board/use-board.ts` — socket lifecycle, snapshot fetch, polling fallback, pill state
- `src/features/board/board-state.ts` — pure state module (frame replace, `driver:location` patch, alert list, staleness calc) — keep pure for cheap tests
- `src/features/board/connection-pill.tsx`, `ride-queue.tsx`, `zones-panel.tsx`, `board-map.tsx`, `alerts-panel.tsx`
- `src/features/board/*.test.tsx` (one per component + `board-state.test.ts` + `use-board.test.tsx`)
- `src/app/login/page.tsx`, `src/app/dispatch/layout.tsx`, `src/app/dispatch/page.tsx`, `src/app/admin/layout.tsx`, `src/app/admin/page.tsx`
- Root `src/app/layout.tsx` + `src/app/page.tsx` — REPLACED (de-boilerplate), not new

**Deleted:** `apps/admin/**` (whole workspace).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- Next.js 16 local docs — `apps/dispatch/AGENTS.md` mandates: *read the relevant guide in `node_modules/next/dist/docs/` before writing any code* (App Router redirects, route groups, `use client` boundaries changed vs trained knowledge).
- [Socket.IO client options — reconnection](https://socket.io/docs/v4/client-options/#reconnection)
  - `reconnectionDelay`, `reconnectionDelayMax`, `randomizationFactor` — the built-in backoff implements F6.1's 500 ms → 30 s + jitter spec; do not hand-roll a retry loop.
- [Socket.IO client socket instance — connect_error](https://socket.io/docs/v4/client-socket-instance/#connect_error)
  - middleware rejections (our `unauthorized`) arrive here; distinguish them from network errors (`err.message`).
- [Socket.IO Connection State Recovery](https://socket.io/docs/v4/connection-state-recovery)
  - Why we ignore `socket.recovered`: unsupported on the pub/sub Redis adapter (which the API uses), so full REST resync on every reconnect (evidence F6.2 verdict).
- [websocket.org reconnection guide](https://websocket.org/guides/reconnection/) — F6.1's source: status surfaced *after the first failed retry*; manual reconnect after max retries.
- `docs/research/dispatch-ops-ux-evidence.md` §1 (F1.1 Autocab anatomy), §4 (F4.1 alarm budgets), §6 (F6.1-6.3) — the binding UX evidence.
- `docs/ux-metrics-ledger.md` — Dispatch rows this ticket's ACs bind to.
- `.claude/references/realtime-events.md` — read it, then FIX it (three rows are false — Task 14).
- `.claude/references/logging-standard.md` — for the two new API log events.

### Patterns to Follow

**VSA + file cap:** one folder per feature, `index.ts` public API; **max 500 lines per shipped-source file** (`eslint.config.mjs:21`; tests/scripts uncapped). `tracking-map.tsx` is 338 lines — split board components as listed above rather than one mega-file.

**Wire timestamps:** every socket/REST payload datetime is `z.string().datetime()` — never `Date` (`realtime-events.ts:11-16`). The widened schema keeps this for `at`, `requestedAt`, `lastSeenAt`.

**Leaflet island (MIRROR exactly for `board-map.tsx`):**
```ts
// 'use client'; type-only static import; runtime import inside useEffect
import type { Map as LeafletMap, Marker } from 'leaflet';
const L = (await import('leaflet')).default;          // tracking-map.tsx:131
// first run: L.map(node,{zoomControl:false}) → tileLayer(OSM) → markers
// updates: marker.setLatLng(...) — imperative, never re-create      (:144-147)
// unmount-only effect: map.current?.remove()                        (:154-161)
// <div ref={mapNode} aria-hidden="true" …> — text alternative carries a11y (:310-319)
```

**Test conventions (from the #88 seed suite — all mandatory):**
- vitest + RTL + jsdom, co-located `src/features/<name>/*.test.tsx`; **no `globals: true`** — import `describe/it/expect/vi` explicitly; `vitest.setup.ts` already does `afterEach(cleanup)`.
- Per-file structural `vi.mock('leaflet', …)` stub (duplicated on purpose — `tracking-page.test.tsx:6-8`); flush the dynamic import with `await act(async () => {})`.
- `vi.stubGlobal('fetch', vi.fn())` in `beforeEach`; `vi.unstubAllGlobals()` + `vi.clearAllMocks()` in `afterEach`.
- Fake timers: `vi.useFakeTimers()` + `vi.setSystemTime(...)`; advance with `await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })`.
- Async RSC pages: call the component as a function, await, `render(tree)` (`tracking-page.test.tsx:48-59`).
- Route-handler tests: `// @vitest-environment node` pragma.
- Every `it()` title ends `(expected)` / `(edge)` / `(failure)`.
- **Assert catalog-derived strings, never literals**: `screen.getByRole('link', { name: formatMessage('lv', 'console.retry') })`.
- New pattern this ticket introduces (socket): per-file `vi.mock('socket.io-client', …)` returning a hand-rolled fake with `on/off/close/connected` + a test-side `fire(event, payload)` — same structural-stub philosophy as the leaflet mock.

**API patterns:** guards `@Roles('dispatcher','admin')` (`dispatch.controller.ts:64-65`); emit-and-log-never-throw (`dispatch.service.ts:341-348`); log events `domain.component.action_state` with `rideId/driverId` when known, phones masked to last 3 digits (`logging-standard.md`); Redis-backed specs gated on `REDIS_TEST_URL` (`describe.skip` when absent); business knobs = `platform_config` columns, code constants only for mechanics (`dispatch.policy.ts:4-8`).

**Styling/i18n/a11y:** inline `style={{}}` with `var(--color-*)` etc. (no Tailwind utilities in feature components — matches tracking); every string via `formatMessage(lang, key)` with new `console.*` keys in all three languages (the `satisfies` forces parity); LV default; ≥44px touch targets; `:focus-visible` outline via segment layout CSS (mirror `t/[token]/layout.tsx:16-21`); `aria-live="polite"` for status, `role="alert"` for action-required.

---

## UX — breadboard, states, friction audit

**Breadboard:**
```
/login (phone) → [tālrunis input + «Sūtīt kodu» btn] → /login (code)
/login (code)  → [6-digit input + «Pieslēgties» btn] → /dispatch   (role ok)
/login (code)  → [same]                              → /login (error: «Nav piekļuves»)  (role not dispatcher/admin)
/dispatch      → [«Zonas»|«Karte» toggle]            → /dispatch (map view ⇄ zones view)
/dispatch      → [alert row «Apstiprināt»]           → /dispatch (alert acknowledged)
/dispatch offline → [«Mēģināt vēlreiz» btn]          → /dispatch (reconnect attempt)
/ , /admin (no session) → auto                       → /login
```
Layout (decided 2026-08-15, Autocab F1.1 scaled to ~10 drivers / ~6 zones): header = connection pill + view toggle; left = ride queue bucketed requested/offered/active; right = zones panel (per-geozone cards: zone name, count, driver name chips; `(tukšs)` when empty) ⇄ map; bottom/side = alerts panel.

**States (all four, per surface):**
- *Loading:* board skeleton + «Ielādē…» until first snapshot resolves.
- *Empty:* zero rides → catalog empty-copy in each bucket; zone card `(tukšs)`; zero alerts → panel hidden.
- *Error:* snapshot fetch fails while socket up → inline retry row (not full-screen); login errors inline under field.
- *Offline/degraded:* pill «Bezsaistē», persistent banner with last-updated time, polling fallback active, all data still rendered (stale-marked) — **driver names+phones always visible** (Dina dispatches by voice), from the last snapshot persisted to localStorage.

**Friction audit:** monitoring = 0 interactions (the board is a monitor). Login = 4 inputs/taps (phone, send, code, submit) — OTP minimum, no captcha/extra steps. Alert acknowledge = 1 click. View toggle = 1 click. No confirmation dialogs anywhere. This is the lowest-count option; nothing to cut.

**Alarm discipline (ISA-18.2, F4.1):** toast + row-flash + one short beep ONLY for: `dispatch:unclaimed`, `dispatch:sms_failed`, socket→offline transition. Ride-progress changes recolor in place, zero toasts. Beep = Web Audio oscillator (~200 ms), muted by default until the mute-toggle is switched on (browsers block audio before a user gesture anyway — the toggle click IS the unlock gesture). Budget: <6 alerts/hour in normal ops — measured post-pilot via the alert log line, not asserted now.

---

## IMPLEMENTATION PLAN

### Phase 1: Shared contracts (packages/shared)

Widen the board event, add the 9th event, add console i18n keys. Everything downstream imports these.

### Phase 2: API — board read model, emission, SMS alert, provisioning

**Depends on:** Phase 1 (schemas).

### Phase 3: Web shell + auth + admin retirement

**Depends on:** Phase 1 (i18n keys only).
**Independent of:** Phase 2 — can run in parallel with it (different packages; hygiene rule allows parallel loops in different packages, but within one session just do 2 then 3).

### Phase 4: Board feature slice (client)

**Depends on:** Phases 2 + 3.

### Phase 5: Docs truth + validation

**Depends on:** everything above.

---

## STEP-BY-STEP TASKS

### Task 1 — UPDATE `packages/shared/src/realtime-events.ts` (widen board event, add `dispatch:sms_failed`)

- **IMPLEMENT**:
  - Widen `dispatchBoardEventSchema` (:132-151) to:
    - `rides[]`: keep `rideId/status/pickup/driverId/unclaimedSeconds`; ADD `requestedAt` (ISO), `driverName: z.string().nullable()`, `bookingChannel` (from `BOOKING_CHANNELS`).
    - `drivers[]`: keep `driverId/status`; make `location` **nullable** (online driver without a fresh GEO position); ADD `name: z.string()`, `phone: z.string()` (operator UI needs the real phone — masking is a *log* rule), `lastSeenAt` ISO nullable, `zoneName: z.string().nullable()`.
  - Add the 9th event in **all four places**: `RT.dispatchSmsFailed = 'dispatch:sms_failed'`, `dispatchSmsFailedEventSchema = z.object({ rideId: uuid, at: ISO })` (extend with the notification kind if the call site has one), `ServerToClientEvents`, `RT_EVENT_SCHEMAS`.
- **PATTERN**: existing schemas in the same file; ISO-string rule :11-16.
- **GOTCHA**: `RT_EVENT_SCHEMAS` uses `satisfies Record<keyof ServerToClientEvents, z.ZodType>` — TS errors until all four places agree. Nothing emits or consumes `dispatch:board` yet, so widening is migration-free.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared build`
- **SATISFIES**: AC #1 (board data), AC-comment (SMS alert)

### Task 2 — UPDATE `packages/shared/src/i18n.ts` (console catalog)

- **IMPLEMENT**: add `console.*` keys to `lv` (:15-44) and mirror in `ru`/`en`: pill (`console.live` «Tiešraide», `console.reconnecting` «Atjaunojas…», `console.offline` «Bezsaistē»), buckets (`console.queue_requested/offered/active`), zones (`console.zones`, `console.map`, `console.zone_empty`), alerts (`console.alert_unclaimed`, `console.alert_sms_failed`, `console.alert_ack`, `console.alerts_muted/unmuted`), degraded (`console.stale_banner` with `{time}` placeholder, `console.retry`), auth (`console.login_title`, `console.phone`, `console.send_code`, `console.code`, `console.sign_in`, `console.no_access`, `console.wrong_code`), shell (`console.title`, `console.loading`, `console.empty_queue`).
- **PATTERN**: `lv` is the reference dictionary; the `satisfies` at :48/:107 breaks the build until RU/EN carry every key.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: hard rule "nothing user-facing hardcoded"

### Task 3 — ADD `listOnline` to the driver-location store (`services/api/src/features/drivers/location/`)

- **IMPLEMENT**: port method `listOnline(cityId): Promise<Array<{driverId, location: LatLng|null, lastSeenMs: number|null}>>` — `SMEMBERS drivers:online:<cityId>`, then pipelined `GEOPOS` + `ZSCORE seen` for the members. Return **all** online members; null location/lastSeen when GEO/seen has no entry (do NOT filter by the 60 s TTL here — the board wants the full phone list; staleness is presentation).
- **PATTERN**: `redis-driver-location.store.ts:25-63` port + impl; key builders :10-14.
- **GOTCHA**: plain pipeline is fine (read-only, no atomicity need — the Lua ceremony at :59-62 exists only for the online-gate write race).
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api` (spec gated with the repo's `describe.skip` convention)
- **SATISFIES**: AC #1 (drivers on board)

### Task 4 — CREATE `services/api/src/features/dispatch/board/board.service.ts` + `board.policy.ts`

- **IMPLEMENT**: `buildBoardState(cityId)` →
  1. rides: new `RidesRepository.findBoardRides(limit)` MIRRORING `findAwaitingDispatch` (:185) with `status IN (requested, offered, queued, accepted, arriving, arrived, in_progress)`, cap `BOARD_RIDES_LIMIT = 100` (safety valve; pilot target is ~100 rides/week so live rides ≈ single digits — `expected`, epic §7);
  2. drivers: `listOnline` (Task 3) + a `DriversRepository` lookup for `{name, phone, status}` by ids (driver→user join for phone) + zone names;
  3. zone per driver: **research step** — find the point-in-geozone resolution #10's geozone_queue mode uses (`services/api/src/features/dispatch/**`, `db/`); reuse it. Only if none is reusable, add a `zonesFor(points[])` PostGIS `ST_Contains` query to the geozones repository;
  4. `unclaimedSeconds` = `max(0, now - requestedAt)` for `requested` rides, else 0 — same arithmetic as `dispatch.sweeper.ts isStale` (:143-151);
  5. return the Task-1 schema shape (ISO strings, server clock).
  Emitter: `onModuleInit` interval `BOARD_EMIT_INTERVAL_MS = 2_000` (chosen constant: keeps ride-state freshness ≤ ~2 s + delivery on the board — the ≤2 s *unclaimed* AC is carried by `dispatch:unclaimed` directly, worst case ≈ 1 s sweep interval + emit latency, `derived` from `SWEEP_INTERVAL_MS = 1_000` assuming a healthy sweeper); skip build+emit when the local dispatch room is empty (`derived` assumption: single API node — see Open Questions); **no auto-start under `NODE_ENV=test`** (mirror `dispatch.sweeper.ts:57`); emit via `RealtimeService.emitToDispatch`, wrapped catch→log `dispatch.board.emit_failed` (mirror `dispatch.service.ts:341-348`).
- **GOTCHA**: `RealtimeService.emit` throws on schema drift and every caller swallows it into a log (`realtime.service.ts:63-75`) — a drifted widened payload vanishes silently. The service spec MUST assert the built object `dispatchBoardEventSchema.parse()`s cleanly.
- **VALIDATE**: `pnpm --filter @taxi/api test -- board.service` (per that package's runner conventions)
- **SATISFIES**: AC #1, ledger "zero silent staleness" (heartbeat)

### Task 5 — ADD `GET /dispatch/board` to `services/api/src/features/dispatch/dispatch.controller.ts`

- **IMPLEMENT**: `@Get('board')` `@Roles('dispatcher','admin')` → `boardService.buildBoardState(env.DEFAULT_CITY_ID)`. Same payload as the socket event — one shape, two transports.
- **PATTERN**: guards/routes in the same controller (:30-65).
- **VALIDATE**: controller spec — 200 for dispatcher JWT (expected), 403 for driver JWT (failure), snapshot equals schema (edge).
- **SATISFIES**: AC #2 (resync), AC #3 (unauthorized role blocked)

### Task 6 — UPDATE `services/api/src/features/notifications/ride-notifications.service.ts` (emit `dispatch:sms_failed`)

- **IMPLEMENT**: at the `:171` failure site, after the `logger.error`, `emitToDispatch(env.DEFAULT_CITY_ID, RT.dispatchSmsFailed, { rideId, at })` in its own try/catch → log `ride.notifications.sms_alert_emit_failed`. Import `RealtimeModule` into the notifications module (mirror how `DispatchModule` gets `RealtimeService`).
- **GOTCHA**: `services/api/src/features/notifications/index.ts:24` documents this exact deferral — update that comment.
- **VALIDATE**: spec — failing SMS provider ⇒ event emitted to dispatch room (expected); emit failure ⇒ logged, not thrown (failure).
- **SATISFIES**: issue-comment AC (SMS alert on board)

### Task 7 — CREATE `services/api/scripts/provision-dispatcher.ts`

- **IMPLEMENT**: CLI (`tsx scripts/provision-dispatcher.ts +371XXXXXXXX [name]`) that upserts a `users` row with `role='dispatcher'` via `@taxi/db`. Print what it did. Scripts are uncapped and outside eslint's max-lines.
- **PATTERN**: `scripts/mint-tracked-ride.ts` header/arg style.
- **GOTCHA**: no dispatcher-creation mechanism exists anywhere (`SIGNUP_ROLES` excludes it; seed creates no users) — without this script the login flow is untestable end-to-end. `findOrCreate` never upgrades roles (`auth.repository.ts:47-63`), so the upsert must write the role explicitly.
- **VALIDATE**: run it against local docker; then `POST /auth/otp/request {phone, role:'rider'}` + verify → JWT `role='dispatcher'` (stored role wins).
- **SATISFIES**: AC #1-3 (all need a dispatcher session)

### Task 8 — REPLACE `apps/dispatch/src/app/{layout.tsx,page.tsx}` (shell) + CREATE `/login`

- **IMPLEMENT**:
  - Root layout: `lang="lv"`, `title` from `formatMessage('lv','console.title')`, drop create-next-app splash; root `page.tsx` → `redirect('/dispatch')`.
  - `src/features/auth/session.ts`: save/load/clear `{accessToken, user}` in `localStorage` (`taxi.console.session`); `expiresAt` check.
  - `login/page.tsx` + `login-form.tsx`: phone → `POST {API}/auth/otp/request` with `role:'rider'` (see GOTCHA) → code → `POST {API}/auth/otp/verify` → if `user.role ∈ {dispatcher, admin}` save session, `router.push('/dispatch')`; else show `console.no_access` and DISCARD the token.
  - API base: `NEXT_PUBLIC_API_URL` (default `http://localhost:3001`) — the browser talks to the API directly; the socket cannot ride the server-proxy pattern (see NOTES).
- **GOTCHA #1**: `otpRequestSchema` only accepts `role: 'rider'|'driver'`; the stored role wins on existing rows (`auth.repository.ts:47-63`), so a provisioned dispatcher logs in fine with `role:'rider'`. An unprovisioned phone silently creates a rider account — the role check above is the gate.
- **GOTCHA #2**: `NEXT_PUBLIC_*` is baked at build time — add it to the `build` task `env` in root `turbo.json` (currently absent from `globalEnv` :3-10) or CI builds cache-poison across env changes. Add to `.env.example` next to `API_URL`.
- **GOTCHA #3**: keep `t/[token]/**` byte-untouched; its tests are the canary.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch` (login-form tests: happy path (expected), wrong code (failure), rider-role rejection (edge)); `pnpm --filter @taxi/dispatch build`.
- **SATISFIES**: AC #3; re-slice "app shell, auth"

### Task 9 — CREATE `/dispatch` + `/admin` route groups with role guard

- **IMPLEMENT**: `require-role.tsx` client guard (reads session; no/expired/wrong role → `router.replace('/login')`); `dispatch/layout.tsx` = guard(dispatcher|admin) + `<style>{themeCssVars()}</style>` + focus-visible CSS (mirror `t/[token]/layout.tsx:14-21`) + header chrome (pill slot, toggle slot); `admin/layout.tsx` = guard(admin) + theme; `admin/page.tsx` = one-line placeholder («#20») from catalog.
- **GOTCHA**: no `middleware.ts` — localStorage tokens are invisible to edge middleware; real enforcement is API-side (`@Roles`), the client guard is UX only. State this in a comment… no — state it in `apps/dispatch/CLAUDE.md` (Task 13), not code comments.
- **VALIDATE**: guard test — unauthenticated render redirects (failure case).
- **SATISFIES**: AC #3; re-slice "role-gated route groups"

### Task 10 — CREATE `src/features/board/` state + socket hook

- **IMPLEMENT**:
  - `board-state.ts` (pure): `applyFrame(state, boardEvent)` (wholesale replace + `lastFrameAt`), `applyDriverLocation(state, ev)` (position patch between frames), `pushAlert(state, alert)` (unclaimed/sms_failed/offline; cap list at 50), `staleness(nowMs, lastFrameAtMs)`.
  - `use-board.ts`: create socket once (`io(NEXT_PUBLIC_API_URL, { auth: { token }, reconnectionDelay: 500, reconnectionDelayMax: 30_000, randomizationFactor: 0.5 })` — Socket.IO's built-in exponential backoff; `randomizationFactor: 0.5` gives ±50% jitter, the library's max, approximating F6.1's "50–100%"); on `connect` AND every reconnect → fetch `GET /dispatch/board` (bearer) and `applyFrame` (**snapshot-on-reconnect always**); subscribe `dispatch:board`, `driver:location`, `dispatch:unclaimed`, `dispatch:sms_failed`; `connect_error` with `err.message === 'unauthorized'` → clear session → `/login`.
  - Pill state (derived, one place): `live` = connected ∧ `lastFrameAt` within `STALE_MS = 5_000` (`derived`: 2 × `BOARD_EMIT_INTERVAL_MS` + 1 s allowance — two consecutive missed frames before the pill stops claiming live; worst-case detection lag 5 s); `reconnecting` = reconnect in progress ∨ connected-but-stale (surfaced only after the first failed retry, per F6.1); `offline` = `reconnect_failed`-class state after ≥5 attempts (chosen) ∨ `navigator.onLine === false` → start polling fallback: `GET /dispatch/board` every `POLL_MS = 5_000` (mirrors `tracking-map.tsx:15`), ref-based gate (mirror :82-123), manual retry button re-arms `socket.connect()`.
  - Persist last frame to `localStorage` (`taxi.console.board-snapshot`); hydrate on mount marked stale.
- **GOTCHA**: socket.io-client keeps retrying forever by default — "offline" is a UI state, not a stopped socket; leave reconnection running while polling. Clean up interval + socket in one unmount effect (mirror `tracking-map.tsx:154-161`).
- **VALIDATE**: `use-board.test.tsx` with the socket fake + fake timers: first frame renders (expected); silent socket >5 s flips pill to reconnecting (edge); disconnect→reconnect refetches snapshot (edge); retries exhausted → polling fallback fetches + offline banner (failure); unauthorized → redirect (failure).
- **SATISFIES**: AC #2, ledger "zero silent staleness"

### Task 11 — CREATE board components (`connection-pill`, `ride-queue`, `zones-panel`, `board-map`, `alerts-panel`) + `/dispatch/page.tsx`

- **IMPLEMENT**:
  - `connection-pill.tsx`: three states from catalog; `aria-live="polite"`; visually distinct (colors from theme vars).
  - `ride-queue.tsx`: three buckets (requested / offered+queued / `ACTIVE_DRIVER_RIDE_STATUSES`); per-ride row: pickup address, status recolored in place, driver name when assigned, age; unclaimed rides get the flash treatment (CSS animation class driven by `unclaimedSeconds > 0` or an active unclaimed alert).
  - `zones-panel.tsx`: card per zone (group `drivers[]` by `zoneName`, `null` → «Ārpus zonām» card): name, count, driver chips (name + status color); `(tukšs)` for empty zones. **No queue positions, no time-in-zone** (#19 — scope decision 2026-08-15).
  - `board-map.tsx`: leaflet island, one marker per driver with a position (MIRROR tracking-map exactly incl. `aria-hidden` + the zones panel as text alternative); toggle `Zonas ⇄ Karte` in the layout header, zones default (F1.1).
  - `alerts-panel.tsx`: newest-first list; unclaimed + sms_failed + went-offline entries; `role="alert"` on arrival; acknowledge button (≥44px); mute-toggle + Web-Audio beep (~200 ms oscillator) on action-required alerts only.
  - `dispatch/page.tsx`: compose; loading skeleton until first frame; every interactive element ≥44px with focus-visible.
- **GOTCHA**: driver phone must render in the drivers surface (chips' detail or list row) — degraded-mode requirement "Dina can dispatch by voice". Ride-progress events must NOT toast (ISA-18.2) — only recolor.
- **VALIDATE**: component tests per file: pill three states (expected/edge/failure via catalog strings); queue bucketing incl. empty (expected/edge); zones grouping incl. null-zone + empty (expected/edge); alerts render + ack + no-toast-for-status (expected/edge/failure); map mirrors tracking's leaflet-stub tests.
- **SATISFIES**: AC #1, S9-4 flash, ISA-18.2 budget

### Task 12 — REMOVE `apps/admin/**`

- **IMPLEMENT**: `git rm -r apps/admin`. First carry its `CLAUDE.md` scope prose (statistics, config surfaces, driver onboarding review — `apps/admin/CLAUDE.md:7-9`) into `apps/dispatch/CLAUDE.md` as the `/admin` route-group section. Then `grep -r "@taxi/admin\|apps/admin"` across the repo (CI workflows, README, docs) and fix hits.
- **GOTCHA**: nothing imports `@taxi/admin` (verified 2026-08-15) — expect hits only in prose/docs. `CORS_ORIGINS` default still lists `:3002`; harmless, leave it.
- **VALIDATE**: `pnpm install` (lockfile updates) then `pnpm turbo run typecheck lint test build --force` — the gate proves the workspace graph is intact.
- **SATISFIES**: re-slice "apps/admin workspace retires"

### Task 13 — UPDATE `apps/dispatch/CLAUDE.md` + root `CLAUDE.md`

- **IMPLEMENT**: dispatch CLAUDE.md — it's now the merged web app (route groups `/dispatch` `/admin` + public `t/[token]`); auth model (localStorage session, client guard = UX, API guards = enforcement); socket usage (`NEXT_PUBLIC_API_URL`, no client-initiated joins); admin scope prose from Task 12. Root CLAUDE.md — monorepo map: update the `apps/dispatch` row (merged web app), delete the `apps/admin` row.
- **VALIDATE**: proofread; `rules-check-drift` can verify later.
- **SATISFIES**: docs-truth hard rule

### Task 14 — UPDATE `.claude/references/realtime-events.md` (fix 3 false rows, add the 9th event)

- **IMPLEMENT**: fix `:9` (`ride:status` does NOT reach dispatch — `canJoin` returns false for ride rooms for every role, `room-policy.ts:25`); fix `:13` (`dispatch:board` now emitted on a 2 s cadence by the board service); fix `:7` (rider leg still future); add the `dispatch:sms_failed` row; update "all 8 events" (:3) to 9.
- **GOTCHA**: this file is what the next frontend session reads first — the three false rows were found by code sweep, not by reading the doc. Do not add a `ride:status`-to-dispatch claim back "for symmetry"; the board deliberately doesn't need it (full-state frames carry ride status).
- **VALIDATE**: cross-check every row against `realtime-events.ts` + emit sites.
- **SATISFIES**: docs-truth hard rule

### Task 15 — VALIDATE end-to-end (the reliability drill)

- **IMPLEMENT** (manual, scripted where possible): docker compose up → `pnpm --filter @taxi/api dev` + `pnpm --filter @taxi/dispatch dev` → provision dispatcher (Task 7) → log in → run `scripts/mint-tracked-ride.ts` (per its header) → watch the ride appear/progress on the board (expected). **Kill the API process mid-session**: pill must go «Atjaunojas…» after the first failed retry, then «Bezsaistē» + polling banner + intact (stale-marked) driver phone list; **restart the API**: pill returns to «Tiešraide» and the board resyncs with no reload (edge). Log in with a driver-role phone: `/dispatch` redirects/denies and `GET /dispatch/board` is 403 (failure). Let a ride go unclaimed (do not accept the offer; `unclaimedAlertSeconds` = 60 from seed config): flash + alert arrive.
- **VALIDATE**: the full gate — `pnpm turbo run typecheck lint test build --force` with `REDIS_TEST_URL` set (else 24 tests silently skip — root CLAUDE.md). In a worktree: `COMPOSE_PROJECT_NAME=taxi`.
- **SATISFIES**: all three ticket ACs + `pnpm check` green

---

## TESTING STRATEGY

### Unit Tests

- **shared**: widened schema round-trips; 9-event catalog integrity (`RT_EVENT_SCHEMAS` keys = `ServerToClientEvents` keys); `console.*` keys exist, distinct, non-empty across all `LANGUAGES` (mirror `states.test.tsx`).
- **api**: `board.service.spec` — bucketing, null-location driver, unclaimedSeconds arithmetic, output `.parse()`s against `dispatchBoardEventSchema` (the anti-silent-drift assertion), emit-failure logged-not-thrown; controller spec — 200/403; notifications spec — sms_failed emitted on provider failure.
- **dispatch app**: pure `board-state` tests (frame replace, location patch, alert cap, staleness); component tests per Task 11; hook tests per Task 10; every suite 1 expected + 1 edge + 1 failure minimum.

### Integration Tests

- API: Redis-gated `listOnline` spec (`REDIS_TEST_URL` describe.skip convention); board route through the real guard chain (existing controller-spec harness).
- Web: `use-board.test.tsx` is the integration seam — fake socket + stubbed fetch + fake timers exercising the full connect → frame → disconnect → resync → fallback lifecycle.

### Edge Cases

- Driver online with no GEO position (location null) — renders in zones panel («Ārpus zonām») and phone list, absent from map.
- Board frame arrives while polling fallback active (socket recovered first) — polling stops, no duplicate state.
- `connect_error: unauthorized` vs network `connect_error` — only the former logs out.
- Empty board (0 rides, 0 drivers) — all empty states render, no crash.
- Alert dedupe: server dedupes unclaimed per ride/300 s (`dispatch.policy.ts:50`); client must still tolerate a re-alert after the window (same ride, new entry).
- JWT expires mid-session: server sweep disconnects within 60 s (`realtime.gateway.ts:49`); reconnect gets `unauthorized` → clean logout, not a stuck «Atjaunojas…».

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
```bash
pnpm turbo run lint typecheck --filter @taxi/shared --filter @taxi/api --filter @taxi/dispatch
```

### Level 2: Unit Tests
```bash
pnpm turbo run test --filter @taxi/shared --filter @taxi/dispatch
```

### Level 3: Integration Tests
```bash
docker compose up -d --wait
REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} pnpm turbo run test --filter @taxi/api
```

### Level 4: Manual Validation
Task 15's reliability drill (scripted ride → API kill → recovery → role block).

### Level 5: The gate (CI parity — done means this, not say-so)
```bash
pnpm turbo run typecheck lint test build --force   # with REDIS_TEST_URL exported
```

---

## ACCEPTANCE CRITERIA

- [ ] Board reflects a scripted ride flow live — ride appears on request, recolors through offer/accept/arrive/complete, driver dots/chips move (expected).
- [ ] API kill/restart → truthful pill («Atjaunojas…» → «Bezsaistē» + banner + polling fallback) → auto-resync on restart without reload (edge). Zero silent staleness: pill state is derived from frame receipt, not socket flags alone.
- [ ] Unauthorized role blocked: driver/rider session cannot render `/dispatch` and gets 403 from `GET /dispatch/board`; driver socket is never placed in the dispatch room (failure).
- [ ] Unclaimed order flashes on the board; alert path is event-driven (`dispatch:unclaimed`), server worst-case ≈ 1 s sweep + delivery (`derived` from `SWEEP_INTERVAL_MS = 1_000`; the ledger's ≤ 2 s bound holds under a healthy sweeper — `expected` until measured in Task 15).
- [ ] SMS-send failure surfaces as an operator alert (issue comment / `notifications/index.ts:24` deferral closed).
- [ ] Alarm discipline: toasts/beep only for unclaimed, sms_failed, socket-down; ride-progress recolors in place (ISA-18.2).
- [ ] Merged app shell: `/login`, role-gated `/dispatch` + `/admin`, `apps/admin` deleted, docs updated.
- [ ] Every feature ships ≥1 expected + 1 edge + 1 failure test; all strings from the catalog; ≥44px targets + focus-visible; map has a text alternative.
- [ ] `pnpm turbo run typecheck lint test build --force` green with `REDIS_TEST_URL` set.

## COMPLETION CHECKLIST

- [ ] All tasks completed in order (Phase 3 may interleave with Phase 2)
- [ ] Each task validation passed immediately
- [ ] Full gate green from a cleared dist (CI parity, not `pnpm check`)
- [ ] Manual reliability drill performed and outcomes reported faithfully
- [ ] `.claude/references/realtime-events.md` rows verified against emit sites
- [ ] PR body: `Closes #18` (NOT backticked — backticks break the auto-close link), numbers carry provenance

---

## OPEN QUESTIONS / ASSUMPTIONS

- **S9-1 gate (from the ticket)**: Dina's console drawing is still pending. Per the playbook: **when it arrives, review this plan (and #19's) against it before executing.** If it contradicts the F1.1 layout, amend here first.
- **Zones scope**: decided 2026-08-15 (Linards): zone-grouped driver panel in #18; queue positions + time-in-zone in #19.
- **Single API node assumed** for the room-occupancy check (local adapter room size; a second node's dispatchers would be invisible to it). True for the pilot (one Hetzner box per `.claude/plans/deploy-hetzner-environment.md`); revisit if the API ever scales out — worst case is emitting to an empty local room or skipping while a remote room has members.
- **Dispatcher login rides the `role:'rider'` OTP request** (stored role wins). Slightly ugly; the alternative (accepting `dispatcher` in `SIGNUP_ROLES`) would weaken the provisioning-only defence. Kept as-is, documented in `apps/dispatch/CLAUDE.md`.
- **Bearer token in localStorage** (not httpOnly cookie): the socket handshake needs the raw token client-side (`handshake.auth.token`), and the API has no cookie support. XSS exposure accepted for an internal operator console; enforcement is server-side.
- **Size estimate exceeds the ticket's** ~900–1400 lines: that figure predates the 2026-08-07 re-slice which added the merged-app shell/auth and (implicitly) the API read model. `expected`: apps/dispatch ~1,200–1,600 + services/api ~450–650 + shared ~150–250, tests included in the app figures. Flag in the PR if it balloons past this.
- **Production CORS/origins**: `CORS_ORIGINS` must include the deployed console origin, and `NEXT_PUBLIC_API_URL` the deployed API origin — deploy-ticket concern (#13/Hetzner plan), noted here so it isn't lost.

## NOTES (open canvas)

**Full-state broadcast vs event-sourcing.** Rejected applying granular `ride:status`/`ride:assigned` events client-side: those events don't reach the dispatch room today, adding them means touching every emit site and writing a client-side reducer whose bugs are exactly the "console lies to Dina" failure mode this ticket exists to prevent. A 2 s full-frame replace is self-healing (any missed change corrected next frame), doubles as the staleness heartbeat, and at pilot scale the payload is small (10 drivers + single-digit live rides; evidence F6.2 estimates "a few KB" — `expected`, verify in Task 15 devtools). The widened `dispatch:board` was designed for exactly this (its own comment says so). Cost: ~0.5 rides/sec DB read while a dispatcher is connected — trivial; skipped entirely when the room is empty.

**Why not the same-origin proxy for the console (tracking page's pattern)?** WebSockets don't ride Next rewrites/route handlers reliably, and hiding the API origin buys nothing once the client holds a JWT anyway. Direct browser→API with `NEXT_PUBLIC_API_URL` + existing `CORS_ORIGINS` (already defaults to `localhost:3000`). The tracking page keeps its proxy — different threat model (public, unauthenticated).

**Why cadence, not on-change emission?** On-change requires hooks in rides/dispatch/drivers slices (fan-in), each a place to forget one. Cadence is one code path, bounded load, and directly powers the truthful-pill guarantee: "no frame in 5 s ⇒ say so" (`STALE_MS = 5_000`, derived: 2 × cadence + 1 s). Action-latency-critical signals (unclaimed, sms_failed) stay event-driven, so the cadence bounds only *status* freshness, never *alarm* latency.

**Socket.IO built-in reconnection vs hand-rolled**: built-ins chosen (`reconnectionDelay: 500 → reconnectionDelayMax: 30_000`, exponential, `randomizationFactor: 0.5` = ±50% jitter). F6.1 asks 50–100% jitter; 0.5 is the library's semantics — noted honestly rather than claiming spec-exact compliance. Manual "click to reconnect" is still surfaced in the offline state per F6.1.

**localStorage snapshot persistence** makes the "never traps data" guarantee hold even on a cold refresh while the API is down: phone list renders instantly, stale-marked. Cheap (one JSON blob, replaced per frame… actually throttle the write to every 10th frame or on visibilitychange if profiling shows churn — decide during implementation, don't prematurely optimize).

**Deferred cosmetic questions** (log in `.claude/references/ui-decisions.md` if they surface mid-build): zone card ordering, alert sound choice, dark mode, ride-row column set.

## AMENDMENTS

<!-- Append-only after first approval/execution. -->
