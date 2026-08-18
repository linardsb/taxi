# Feature: Dispatch console — force-assign/override UI, phone-order entry, zone/queue view (#19)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Three of the human-dispatch differentiators that make Sakta Cab's console a competitive weapon rather than a fallback, layered onto #18's live board:

1. **Force-assign / override UI** — Dina picks a ride, picks a driver, assigns. Two verbs (Offer vs Force-assign, evidence F3.2), reassign, cancel-as-dispatcher, with the S9-2 audit trail visible.
2. **Phone-order entry** — a keyboard-first booking form that creates a ride on behalf of a caller. Caller-ID lookup prefills a repeat caller's record; venue accounts (hotels/bars/restaurants) book in one keystroke. The first-class phone channel: "can both call and use the app" is riders' #2 switch reason (S10-3).
3. **Zone/queue view** — per-district driver queue positions and time-in-queue, plus per-ride cascade visibility and one-line explainability ("why this driver").

Plus the **telephony seam** (`packages/shared/src/seams/telephony-provider.ts`), the architecture's named missing piece: a click-to-dial + caller-ID contract with a stub implementation, so SIP/VoIP screen-pop can land later behind the same UI.

## User Story

As Dina, a professional taxi dispatcher taking a booking call
I want to take the caller's order, see who the algorithm is offering it to and why, and override onto the car I choose — all without leaving the keyboard
So that a phone caller gets the same service quality as an app rider, and the drivers see a fair, explainable queue.

## Problem Statement

#18 gave Dina a board she can **watch**. She cannot **act** on it. Today:

- Every booking must come through the rider app (`POST /rides` is `@Roles('rider')`, rider-self only) — the phone channel the PRD's whole secondary-user thesis rests on has no entry point at all.
- `POST /dispatch/rides/:rideId/assign` exists and is tested (#10) but nothing calls it — the S9-2 override is an endpoint with no UI.
- The board's zone panel groups drivers by district but shows no queue position and no time-in-zone, so S7-2 fairness — Dina's top autoosta carry-over — is invisible to the person who arbitrates it.
- A ride sitting in `offered` shows a status pill and nothing else: no "who has it", no "how long left", no "who's next", no "why them". Evidence F3.3: dispatchers override confidently only when they can see the logic.

## Solution Statement

Three independently shippable phases on top of #18's frame-and-pill architecture:

- **Phase A — Override.** A new `apps/dispatch/src/features/override/` slice driving the existing `POST /dispatch/rides/:rideId/assign` and `POST /rides/:rideId/cancel`, plus one new read (`GET /dispatch/drivers` — the full roster, including offline drivers the board frame deliberately omits). Promote `forceAssignBodySchema` into `@taxi/shared` as #10's comment invites. Adds one guarded state-machine transition (`accepted|arriving → requested`) so reassign after acceptance is a release-and-recascade rather than a cancellation.
- **Phase B — Phone orders.** A dispatcher-booking controller (`POST /dispatch/bookings`), a `customers`/`saved_places` pair of tables backing caller-ID lookup and venue quick-book, an address-search extension on the `MapsProvider` seam bound to Google Places Autocomplete (New) behind the existing cache, and a keyboard-first booking form whose draft survives disconnect. The telephony seam ships here, stubbed.
- **Phase C — Zones & cascade.** Extend the board frame with per-zone queue rows and per-ride cascade state, add `snapshot()` + join timestamps to `DispatchQueueStore`, and compose the "why this driver" explanation string **once**, server-side, so drivers and Dina read the identical sentence.

## Out of Scope / Non-Goals

- **Not included: SIP/VoIP screen-pop automation.** The telephony seam ships with a stub; caller-ID works day-1 by Dina typing the number. Evidence's own "can wait" list, and the ticket's kickoff note ("manual entry acceptable only as the very first step") — the UI is identical either way.
- **Not included: IVR, AI-voice booking, call recording, call history playback.** Evidenced as enterprise bloat at 10 drivers; automating Dina away removes the differentiator.
- **Not included: driver-facing queue-position UI.** That is #15's screen (ledger row "Driver can state their queue position"). Phase C composes the shared explanation string; #15 renders it.
- **Not included: optimistic-UI mutation queue.** Day-1 slice is: draft never lost, actions disabled-with-reason when offline. (Evidence F6.3.)
- **Not included: scheduled rides in the booking form.** `scheduledFor` is on `rideRequestSchema` and the form may carry the field, but the promoting timer is #21's — a past-dated pickup is already a 400 and a future one sits at `scheduled`. Book ASAP only until #21.
- **Not included: multi-taxi orders from the console.** `vehicleCount > 1` throws `multi_taxi_not_supported` (#22 owns it).
- **Not changing: force-assign's eligibility bypass.** #10 documents "deliberately NOT filtered through the eligibility rules … the audit row is what makes that safe." The console warns and confirms; the API keeps its behaviour. See Open Question Q1.
- **Not changing: the board's 2 s wholesale-replace frame contract, the pill derivation, or `applyFrame`'s ordering rule.** Phase C adds fields to the frame; it does not touch how the frame is applied.
- **Not building: a phone-channel counter.** `rides.booking_channel` already exists with a `'phone'` value. The AC needs a query, not plumbing (see AC #12).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (three shippable increments; the ticket's own 900–1400-line estimate counts no api and no db work — see Open Question Q3)
**Primary Systems Affected**: `apps/dispatch` · `services/api` (dispatch, rides, geo, drivers slices) · `packages/shared` (schemas, seams, i18n, realtime events, state machine) · `db` (2 new tables + 1 migration)
**Dependencies**: `@googlemaps` — none needed; Places API (New) is a plain REST POST via `fetch`. No new npm dependency in any phase.

## Related Work

**Implements**: [#19](https://github.com/linardsb/taxi/issues/19)   ·   **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) / `docs/epics/sakta-cab.architecture.md`

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/dispatch-console-live-board.md` (#18) — Why: this plan extends its board frame, its slice conventions, its pill/staleness rules and its localStorage-PII discipline. Read its UX section before drawing anything.
- `.claude/plans/api-dispatch-engine.md` (#10) — Why: owns `ForceAssignService`, the offer cascade, and the queue store this plan reads from. Its force-assign semantics are inherited, not re-decided.
- `.claude/plans/api-rides-pricing.md` (#9) / `.claude/plans/api-rides-idempotency.md` (#46) — Why: Phase B's dispatcher booking mirrors `RidesService.request()` exactly, including the mandatory `Idempotency-Key`.
- `.claude/plans/harden-maps-seam-spend-controls.md` (#94) — Why: Phase B adds a method to the seam this plan hardened; its timeout/negative-cache/miss-counter machinery is the pattern to mirror.
- `.claude/plans/dispatch-test-runner-vitest-rtl.md` (#88) — Why: the console's test harness (jsdom, no globals, structural stubs).

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — #21 (scheduled rides), #22 (multi-taxi), #25 (demand radar) all extend the booking form built here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The board this builds on**

- `apps/dispatch/CLAUDE.md` — Why: auth model, console surfaces, styling and test conventions. Line 19 is this ticket's brief.
- `apps/dispatch/src/features/board/board-state.ts` — Why: THE pattern to mirror. Pure state module, no React/socket/clock; every reliability rule testable in isolation. Phase B's booking draft and Phase C's zone derivation copy this shape.
- `apps/dispatch/src/features/board/use-board.ts` (lines 84–237) — Why: socket lifecycle, snapshot-on-reconnect, poll fallback, `pill` derivation. Phase C's new frame fields flow through here unchanged; Phase A/B mutations must respect `pill`.
- `apps/dispatch/src/features/board/index.ts` — Why: the slice's public API shape — copy it for `override/`, `phone-orders/`, `zones/`.
- `apps/dispatch/src/app/dispatch/page.tsx` — Why: the composition point. Every new panel mounts here; note the existing 2-column grid, the flash `<style>` block and the stale banner.
- `apps/dispatch/src/features/board/zones-panel.tsx` (lines 71–143) — Why: Phase C **replaces** this component's internals. Its docblock names exactly what it deferred to #19 ("queue positions and time-in-zone are #19's", "a card for every configured-but-empty zone needs a zone catalog the frame doesn't carry").
- `apps/dispatch/src/features/board/ride-queue.tsx` (lines 17–47) — Why: the `Record<BoardRideStatus, MessageKey>` totality trick, and the row shape Phase A adds an assign affordance to.
- `apps/dispatch/src/features/board/zones-panel.test.tsx` — Why: the exact RTL test shape (fixture builder, explicit `describe/it/expect` imports, expected/edge/failure naming).
- `apps/dispatch/src/features/auth/session.ts` (lines 21–47) — Why: `BOARD_SNAPSHOT_STORAGE_KEY` is declared in the AUTH slice so `clearSession()` can drop it without a slice cycle. Phase B's booking draft key follows the same rule — it holds caller PII.
- `apps/dispatch/src/features/auth/index.ts` — Why: where the new draft key export goes.

**The API this drives**

- `services/api/src/features/dispatch/dispatch.controller.ts` (whole file, ~100 lines) — Why: `forceAssignBodySchema` lives here and its docblock invites #19 to promote it to shared. Also the per-ROUTE `@Roles` pattern.
- `services/api/src/features/dispatch/force-assign.service.ts` (whole file) — Why: the exact semantics Phase A's UI must not misrepresent — offline drivers assign successfully, the 409 is the real failure, `requested → offered → accepted` is the walk.
- `services/api/src/features/dispatch/board/board.service.ts` (lines 62–120) — Why: Phase C extends `buildBoardState`. Note the fleet-cap warning on the `Promise.all` zone fan-out — do not make it worse.
- `services/api/src/features/dispatch/queue/dispatch-queue.store.ts` — Why: the port Phase C extends. Its docblock explicitly licenses #19: "Resist adding `size()`/`snapshot()` — nothing reads them until #19 draws a zone view."
- `services/api/src/features/dispatch/queue/redis-dispatch-queue.store.ts` — Why: the LIST-per-zone implementation. It stores **no timestamps** — Phase C adds a companion hash.
- `services/api/src/features/dispatch/queue/in-memory-dispatch-queue.store.ts` — Why: the test-only twin. Every store method added must be mirrored here or the queue suite silently skips.
- `services/api/src/features/dispatch/dispatch.repository.ts` (lines 79–108, 233) — Why: `findPendingForRide`, `countAttempts`, `findTriedDriverIds`, `insertAudit` — the reads Phase C's cascade panel needs.
- `services/api/src/features/dispatch/offer-builder.ts` — Why: where `queuePosition` and `etaSeconds` are set on an offer — the raw material of the "why this driver" line.
- `services/api/src/features/rides/rides.controller.ts` (lines 13–20) — Why: states in prose that "dispatcher-created phone orders (#19) get their own controller because they book ON BEHALF OF someone else." Do not add a route here.
- `services/api/src/features/rides/rides.service.ts` (lines 57–125) — Why: the exact orchestration Phase B mirrors — `rideRequestSchema.parse({...body, riderId})`, the `setIfAbsent` idempotency reservation, the rate limit, the release-on-failure `catch`. Note `bookingChannel` is already a server-side parameter defaulting to `'app'`, with a docblock naming #19 as the one caller passing `'phone'`.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (line 83–84) — Why: `POST /rides/:rideId/cancel` already accepts `dispatcher`/`admin`. Cancel-as-dispatcher is UI-only work.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (lines 83–85, 155–160, 230–245) — Why: `claimDriver` / `drivers.releaseFromRide` — the pair Phase A's reassign composes.
- `services/api/src/features/geo/caching-maps.provider.ts` (lines 1–80, 400–415) — Why: the caching facade Phase B extends. `geocode`/`reverseGeocode` currently pass straight through uncached with the comment "nothing calls these yet".
- `services/api/src/features/geo/geo.module.ts` (whole file) — Why: the production-refusal factory Phase B must satisfy, and the two-facades-one-source rule that keeps the spend counter honest.
- `services/api/src/features/geo/stub-maps.provider.ts` — Why: the stub whose `geocode()` throws; Phase B adds a `searchAddress()` that throws the same way, plus a seeded test double.
- `services/api/src/common/config/env.schema.ts` (lines 40–110) — Why: where `GOOGLE_MAPS_API_KEY` and the new Places knobs go; mirror the existing `MAPS_*` docblock density.

**Contracts**

- `packages/shared/src/realtime-events.ts` (lines 60–68, 152–179, 245–276) — Why: `dispatchBoardEventSchema` is the frame Phase C extends; `driverQueueEventSchema` already exists and is the driver-side twin; `EVENT_SCHEMAS` must stay total.
- `packages/shared/src/ride-state-machine.ts` (lines 60–120) — Why: `BOARD_LIVE_RIDE_STATUSES`, `ALLOWED_TRANSITIONS`. Phase A adds `'requested'` to the `accepted` and `arriving` rows — read the docblocks before touching it.
- `packages/shared/src/schemas/ride.ts` (lines 74–135) — Why: `rideRequestSchema` / `rideRequestBodySchema` and the `.omit()`-keeps-it-a-ZodObject rule Phase B's dispatcher body must respect; `rideAssignmentSchema`'s dispatcher refine.
- `packages/shared/src/schemas/geo.ts` (lines 9–40) — Why: `addressPointSchema` requires BOTH a `location` and a non-empty `address` — this is why free-text address entry is not an option.
- `packages/shared/src/seams/sms-provider.ts` — Why: the shape to mirror for `telephony-provider.ts`. Tiny, prose-heavy, no implementation.
- `packages/shared/src/seams/maps-provider.ts` — Why: where `searchAddress` is added.
- `packages/shared/src/i18n.ts` (lines 44–80) — Why: the `console.*` key block this plan roughly doubles. LV first.
- `packages/shared/src/enums.ts` (line 99) — Why: `BOOKING_CHANNELS = ['app','phone']` already exists.

**Persistence**

- `db/src/schema/rides.ts` (lines 30–100) — Why: `bookingChannel` and `trackingToken` already carry the phone channel; the jsonb-vs-column rule Phase B's new tables follow.
- `db/src/schema/users.ts` — Why: phone is the identity, E.164, unique. Phase B's caller record is a `users` row, not a parallel identity.
- `db/src/schema/dispatch-audit.ts` — Why: the audit row Phase A's UI reads back.
- `db/src/schema/geo.ts` (lines 20–40) — Why: `geozones` is the zone catalog Phase C's frame needs for empty-zone cards.

**Project rules**

- `CLAUDE.md` (root) — the hard rules, especially the numbers-are-claims rule and the 500-line cap on shipped source.
- `.claude/references/dispatch-strategies.md`, `.claude/references/realtime-events.md`, `.claude/references/logging-standard.md`, `.claude/references/conventions.md`.
- `docs/research/dispatch-ops-ux-evidence.md` — every UX decision below cites an F-number from it.
- `docs/ux-metrics-ledger.md` (Dispatch section) — the four rows this ticket owns.

### New Files to Create

**Phase A**

- `packages/shared/src/schemas/dispatch.ts` — promoted `forceAssignBodySchema`, `dispatcherRosterSchema`, `reassignBodySchema`
- `services/api/src/features/dispatch/roster.service.ts` — the full driver roster read (`GET /dispatch/drivers`)
- `services/api/src/features/dispatch/roster.service.spec.ts`
- `services/api/src/features/dispatch/reassign.service.ts` — release-and-recascade
- `services/api/src/features/dispatch/reassign.service.spec.ts`
- `apps/dispatch/src/features/override/assign-state.ts` — pure: selection, eligibility warnings, error mapping
- `apps/dispatch/src/features/override/assign-state.test.ts`
- `apps/dispatch/src/features/override/use-assign.ts` — the mutation hook (fetch + in-flight + result)
- `apps/dispatch/src/features/override/use-assign.test.tsx`
- `apps/dispatch/src/features/override/assign-dialog.tsx` — ride → driver picker → confirm
- `apps/dispatch/src/features/override/assign-dialog.test.tsx`
- `apps/dispatch/src/features/override/driver-picker.tsx`
- `apps/dispatch/src/features/override/driver-picker.test.tsx`
- `apps/dispatch/src/features/override/cancel-dialog.tsx`
- `apps/dispatch/src/features/override/cancel-dialog.test.tsx`
- `apps/dispatch/src/features/override/index.ts`

**Phase B**

- `packages/shared/src/seams/telephony-provider.ts` — the click-to-dial + caller-ID contract
- `packages/shared/src/schemas/customer.ts` — `customerSchema`, `savedPlaceSchema`, `callerLookupSchema`, `dispatcherBookingBodySchema`
- `packages/shared/src/schemas/address-search.ts` — `addressSuggestionSchema`
- `db/src/schema/customers.ts` — `customers`, `saved_places`
- `db/migrations/<n>_customers_saved_places.sql` (generated by `drizzle-kit`)
- `services/api/src/features/customers/` — `customers.controller.ts`, `customers.service.ts`, `customers.repository.ts`, `customers.module.ts`, `index.ts`, `customers.service.spec.ts`, `customers.integration.spec.ts`
- `services/api/src/features/dispatch/bookings/bookings.controller.ts` — `POST /dispatch/bookings`
- `services/api/src/features/dispatch/bookings/bookings.service.ts`
- `services/api/src/features/dispatch/bookings/bookings.service.spec.ts`
- `services/api/src/features/dispatch/bookings/bookings.integration.spec.ts`
- `services/api/src/features/geo/google-places.provider.ts` — Autocomplete (New) + Place Details
- `services/api/src/features/geo/google-places.provider.spec.ts`
- `services/api/src/features/geo/address-search.controller.ts` — `GET /geo/address-search`
- `services/api/src/features/geo/address-search.controller.spec.ts`
- `services/api/src/features/telephony/stub-telephony.provider.ts`
- `services/api/src/features/telephony/telephony.module.ts`
- `services/api/src/features/telephony/index.ts`
- `apps/dispatch/src/features/phone-orders/booking-draft.ts` — pure draft state + persistence
- `apps/dispatch/src/features/phone-orders/booking-draft.test.ts`
- `apps/dispatch/src/features/phone-orders/use-booking-form.ts`
- `apps/dispatch/src/features/phone-orders/use-booking-form.test.tsx`
- `apps/dispatch/src/features/phone-orders/booking-form.tsx`
- `apps/dispatch/src/features/phone-orders/booking-form.test.tsx`
- `apps/dispatch/src/features/phone-orders/address-field.tsx` — typeahead combobox
- `apps/dispatch/src/features/phone-orders/address-field.test.tsx`
- `apps/dispatch/src/features/phone-orders/caller-panel.tsx` — lookup result + last-3-jobs + venues
- `apps/dispatch/src/features/phone-orders/caller-panel.test.tsx`
- `apps/dispatch/src/features/phone-orders/index.ts`

**Phase C**

- `services/api/src/features/dispatch/board/cascade.ts` — per-ride cascade projection
- `services/api/src/features/dispatch/board/cascade.spec.ts`
- `services/api/src/features/dispatch/board/zone-rows.ts` — per-zone queue projection
- `services/api/src/features/dispatch/board/zone-rows.spec.ts`
- `packages/shared/src/dispatch-explanation.ts` — the ONE "why this driver" composer
- `packages/shared/src/dispatch-explanation.test.ts`
- `apps/dispatch/src/features/zones/zone-grid.tsx` — replaces `board/zones-panel.tsx`
- `apps/dispatch/src/features/zones/zone-grid.test.tsx`
- `apps/dispatch/src/features/zones/cascade-strip.tsx`
- `apps/dispatch/src/features/zones/cascade-strip.test.tsx`
- `apps/dispatch/src/features/zones/index.ts`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Places API — Autocomplete (New)](https://developers.google.com/maps/documentation/places/web-service/place-autocomplete)
  - Specific section: request body (`input`, `locationBias`, `includedRegionCodes`, `languageCode`, `sessionToken`) and the `suggestions[].placePrediction` response shape.
  - Why: Phase B's `GooglePlacesProvider.searchAddress()` is a plain `POST https://places.googleapis.com/v1/places:autocomplete` with `X-Goog-Api-Key` and `X-Goog-FieldMask` headers. No SDK.
- [Places API — Autocomplete (New) and session pricing](https://developers.google.com/maps/documentation/places/web-service/session-pricing)
  - Specific section: what starts/terminates a session, the 12-request rule, which terminating SKU voids the session.
  - Why: the cost model below depends on terminating with **Place Details Essentials** (which includes `location`), not IDs-Only (which voids the session).
- [Google Maps Platform core services pricing list](https://developers.google.com/maps/billing-and-pricing/pricing)
  - Why: the exact per-1000 SKU prices this plan's budget arithmetic uses.
- [Google Maps Platform pricing — free monthly usage](https://mapsplatform.google.com/pricing/)
  - Specific section: "10K free calls per SKU monthly" (Essentials tier).
  - Why: the reason this feature is expected to cost €0 at pilot volume.
- [Places API policies — caching](https://developers.google.com/maps/documentation/places/web-service/policies)
  - Specific section: "the place ID … is exempt from the caching restrictions. You can therefore store place ID values indefinitely."
  - Why: `saved_places` stores `place_id` permanently and refreshes coordinates rather than pinning them forever.
- [Socket.IO v4 — Connection State Recovery](https://socket.io/docs/v4/connection-state-recovery)
  - Why: reconfirms #18's snapshot-always rule that Phase C's larger frame inherits.
- [WAI-ARIA APG — Combobox with listbox popup](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/)
  - Specific section: keyboard interaction table (Down/Up/Enter/Escape/Alt+Down).
  - Why: `address-field.tsx` must be operable with zero mouse; the APG table IS the acceptance spec for its keyboard tests.
- [WAI-ARIA APG — Dialog (Modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
  - Why: the assign/cancel dialogs need focus trapping and Escape-to-close, and a dispatcher on a call must never be trapped.

### Patterns to Follow

**Slice public API** — every new slice ends with an `index.ts` that names exactly what the page composes:

```ts
/**
 * The board slice's public API — the /dispatch page composes exactly these.
 */
export { AlertsPanel } from './alerts-panel';
export { isStale } from './board-state';
export type { BoardAlert, BoardState, PillState } from './board-state';
```

**Pure state module + hook + components** — the `board-state.ts` / `use-board.ts` split. All decision logic lives in the pure module with time passed in; the hook owns effects; components render. This is also how the 500-line cap is met without contorting anything.

**Total records over `Partial`** (`ride-queue.tsx:17-34`) — when the api decides a set, type the console's map as a total `Record<…>` so a new member is a build failure, not a silent blank.

**Server-side identity, never body-supplied** (`rides.controller.ts:18-20`, `dispatch.controller.ts:22-30`) — `dispatcherId` comes from the JWT. A body-supplied dispatcher id makes the S9-2 audit trail forgeable. Phase B's booking body carries the **caller's phone**, never a `riderId`.

**Idempotency-Key is required, not optional** (`rides.controller.ts:27-31`) — a missing header is a 400. Phase B's dispatcher booking takes the same header, for the same reason with more force: a keyboard-first form on a flaky console is exactly the double-submit case.

**Structured logging** (`force-assign.service.ts` tail) — one object, `event` first, ISO `at` last, no free-form provider text, no coordinates:

```ts
this.logger.log({
  event: 'dispatch.assign.forced',
  rideId: input.rideId,
  driverId: input.driverId,
  dispatcherId: input.dispatcherId,
  revokedOffers: revoked.length,
  at: new Date().toISOString(),
});
```

**Styling** — inline `style={{}}` with `var(--color-*)` / `var(--spacing-*)` / `var(--radius-*)` / `var(--font-size-*)`. No Tailwind utilities in feature components. Minimum 44px touch targets. Focus-visible is handled by the layout's `.console` CSS — every new interactive element must be inside `.console`.

**Strings** — `formatMessage(LANG, 'console.<key>')` with `const LANG: Language = 'lv'`. Never a literal.

**Tests** — co-located, `import { describe, expect, it, vi } from 'vitest'`, a fixture builder at the top, and test names ending `(expected)` / `(edge)` / `(failure)`.

---

## IMPLEMENTATION PLAN

Phases run **top to bottom by default**. Each of A, B and C is independently shippable and ends on a green gate — the recommended execution is three PRs (see Open Question Q3), but the plan is written so a single long loop also works.

> **"Independent" means dependency order, NOT parallel worktrees.** All three phases edit `packages/shared/src/i18n.ts` and `packages/shared/src/index.ts`, and the epic's working rule is explicit: *parallel = different packages only; never two execute sessions in the same package.* Run A, B and C **back-to-back**, in any order. Do not fan them out into three simultaneous worktrees — the merge conflicts land in the one file every surface's typecheck depends on.

### Phase A: Force-assign / override UI

**Depends on:** #10 (shipped), #18 (shipped).
**Independent of:** Phases B and C. Touches `dispatch` (api) + `override/` (console) + one state-machine row. Nothing here blocks B.

The board's ride rows become actionable. Contract promotion first, then the roster read, then reassign, then the UI.

**Tasks:**

- Promote `forceAssignBodySchema` from the controller into `@taxi/shared`.
- Add `GET /dispatch/drivers` — the FULL roster, including offline drivers (the board frame carries only the Redis online set, and force-assign onto an offline driver is the feature).
- Add the `accepted|arriving → requested` release transition + `ReassignService`.
- Build the `override/` slice: pure `assign-state.ts`, `use-assign.ts` hook, dialog + picker components.
- Wire the assign/cancel affordances into `ride-queue.tsx` rows.

### Phase B: Phone orders, customers, address search, telephony seam

**Depends on:** Phase A only for the shared `packages/shared/src/schemas/dispatch.ts` file existing (trivial — create it in either phase).
**Independent of:** Phase C.

The biggest phase. Order matters: seam → provider → db → api → console.

**Tasks:**

- Add `searchAddress()` to the `MapsProvider` seam; implement `GooglePlacesProvider`; bind it via env; keep `StubMapsProvider` throwing.
- Add `GET /geo/address-search` (dispatcher-role) proxying the seam with a session token.
- Create `customers` + `saved_places` tables, migration, and the `customers` slice with caller lookup.
- Create `POST /dispatch/bookings` mirroring `RidesService.request()` with `bookingChannel: 'phone'`.
- Ship the telephony seam + stub.
- Build the `phone-orders/` console slice: draft persistence, keyboard-first form, address combobox, caller panel.

### Phase C: Zone/queue grid + cascade visibility + explainability

**Depends on:** #10's queue store (shipped), #18's frame (shipped).
**Independent of:** Phases A and B.

**Tasks:**

- Extend `DispatchQueueStore` with `snapshot()` and join timestamps; mirror in the in-memory twin.
- Compose the explanation string once in `@taxi/shared`.
- Extend `dispatchBoardEventSchema` with `zones[]` and per-ride `cascade`.
- Build `zones/` slice: zone grid replacing `zones-panel.tsx`, cascade strip on ride rows.

### Phase D: Validation & metrics closure

**Depends on:** whichever phases shipped.

- The three AC scenarios end-to-end.
- The phone-channel-share query written down (AC #12).
- Ledger rows measured and filled in with `observed` figures.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### Task 0 — SETUP the worktree

- **IMPLEMENT**: A worktree already exists at `/Users/Berzins/Desktop/taxi-dispatch-override` on branch `feature/dispatch-override-phone-orders`, cut from `origin/main` at `30d057b`. Copy `.env` in from the main checkout (`cp ../taxi/.env .env`), then `pnpm install`.
- **PATTERN**: Root `CLAUDE.md`, "Concurrent Claude sessions share this checkout".
- **GOTCHA**: A worktree with no `.env` fails `@taxi/db#test`, and turbo then kills every sibling task — the failure reads as unrelated. Also export `COMPOSE_PROJECT_NAME=taxi` (already in `.claude/settings.local.json` env) or compose starts a second Postgres against the occupied 5432.
- **GOTCHA**: Set `REDIS_TEST_URL` to match your `REDIS_PORT` (6381 locally). Without it the Redis-backed suites `describe.skip` and the gate is green 28 tests short (`observed` on this branch, `env -u REDIS_TEST_URL`: `28 skipped, 492 passed, 520 total`) — the queue-store work in Phase C is exactly what gets skipped.
- **VALIDATE**: `cd /Users/Berzins/Desktop/taxi-dispatch-override && docker compose up -d --wait && pnpm install && pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: prerequisite for every AC.

---

## PHASE A — Force-assign / override UI

### Task A1 — CREATE `packages/shared/src/schemas/dispatch.ts`

- **IMPLEMENT**: Move `forceAssignBodySchema` here verbatim from `dispatch.controller.ts` (`{ driverId: uuid, reason: string.max(280).nullable().default(null) }`), keeping its docblock about why there is no `dispatcherId` field. Add:
  - `dispatchDriverSchema` — `{ driverId, name, phone, status: z.enum(DRIVER_STATUSES), vehiclePlate: z.string().nullable(), zoneName: z.string().nullable(), activeRideId: z.string().uuid().nullable() }`
  - `dispatchRosterSchema` — `z.object({ at: z.string().datetime(), drivers: z.array(dispatchDriverSchema) })`
  - `reassignBodySchema` — `{ driverId: uuid, reason: z.string().max(280).nullable().default(null) }` (same shape, distinct name so the two routes cannot be confused).
- **PATTERN**: `packages/shared/src/schemas/ride.ts` — docblock density, `.omit()`/`.extend()` keeping plain `ZodObject`s.
- **IMPORTS**: `import { z } from 'zod'; import { DRIVER_STATUSES } from '../enums';`
- **GOTCHA**: Export from `packages/shared/src/index.ts` or nothing can import it. `shared` imports from nothing in the workspace — keep it that way.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm turbo run typecheck --filter @taxi/shared`
- **SATISFIES**: AC #1

### Task A2 — UPDATE `services/api/src/features/dispatch/dispatch.controller.ts`

- **IMPLEMENT**: Delete the local `forceAssignBodySchema` and import it from `@taxi/shared`. Replace the "deliberately NOT a shared contract" docblock with one noting #19 promoted it and why (the console now posts this body).
- **PATTERN**: the file's own per-ROUTE `@Roles` comment stays untouched.
- **GOTCHA**: `ZodValidationPipe` usage is unchanged; only the import moves. Do not change the route path or the response shape — #10's integration spec asserts both.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch`
- **SATISFIES**: AC #1

### Task A3 — CREATE `services/api/src/features/dispatch/roster.service.ts` + spec

- **IMPLEMENT**: `listRoster(cityId): Promise<DispatchRoster>` — every approved driver (not just the online set), joined to `users` for name/phone, with `status` from `drivers.status`, current zone from the location store where a position exists, and `activeRideId` from the rides table where the driver holds an `ACTIVE_DRIVER_RIDE_STATUSES` ride.
- **PATTERN**: `board.service.ts:buildBoardState` — one read pass, `Promise.all`, timestamps serialized here off the server clock.
- **IMPORTS**: `DriversService`, `DRIVER_LOCATION_STORE`, `GeozonesService`, `RidesRepository`, `APP_ENV`.
- **GOTCHA**: This is a **request-scoped read, not a 2 s cadence** — it is fetched when the picker opens, not pushed on the frame. Do not add it to `dispatchBoardEventSchema`: the frame is the live board (online drivers), and pushing the full roster every 2 s spends bandwidth on data that changes hourly.
- **GOTCHA**: Reuse `GeozonesService.resolveForPoint` but note `board.service.ts`'s fleet-cap warning — same `Promise.all` fan-out shape, same ceiling. At ≤10 pilot drivers this is bounded; do not raise the fleet cap without batching both call sites.
- **VALIDATE**: `pnpm --filter @taxi/api test -- roster`
- **SATISFIES**: AC #2

### Task A4 — ADD `GET /dispatch/drivers` to `dispatch.controller.ts`

- **IMPLEMENT**: `@Get('drivers') @Roles('dispatcher','admin') roster(): Promise<DispatchRoster>` returning `this.rosterService.listRoster(this.env.DEFAULT_CITY_ID)`.
- **PATTERN**: the existing `@Get('board')` route immediately above it — same single-city rule ("the city is the deployment's, never the caller's").
- **GOTCHA**: Register `RosterService` in `dispatch.module.ts` providers.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch.integration`
- **SATISFIES**: AC #2

### Task A5 — UPDATE `packages/shared/src/ride-state-machine.ts` — the dispatcher release transition

- **IMPLEMENT**: Add `'requested'` to the `accepted` and `arriving` rows of `ALLOWED_TRANSITIONS`. Write a docblock naming it: **the dispatcher release** — the only path back into the cascade after acceptance, used by reassign so a wrong-car assignment is corrected without cancelling the rider's ride. State that no other actor may perform it (enforced at the service layer, not the DDL — same rule as `rideAssignmentSchema`'s dispatcher refine).
- **PATTERN**: the `offered → requested` re-offer loop already in the table, and its docblock.
- **GOTCHA**: This is a **cross-surface contract change**. Every surface reads `ALLOWED_TRANSITIONS`. Check `assertTransition()` consumers and the rider/driver apps' status handling: a rider watching an `accepted` ride can now see it return to `requested`. #16/#17 have not shipped, so the only live consumer is the driver app (#15, also unshipped) and the tracking page — verify `apps/dispatch/src/features/tracking/states.tsx` renders `requested` after `accepted` sanely.
- **GOTCHA**: Do NOT add `arrived → requested` or `in_progress → requested`. A driver physically at the pickup, or mid-ride, is not reassignable — that is a cancellation.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm turbo run typecheck --force`
- **SATISFIES**: AC #3

### Task A6 — CREATE `services/api/src/features/dispatch/reassign.service.ts` + spec

- **IMPLEMENT**: `reassign({ dispatcherId, rideId, driverId, reason })`:
  1. Read the ride; 404 if missing.
  2. In one transaction: `transitionInTx(tx, rideId, from, 'requested')` where `from` is the ride's current status, guarded to `accepted`/`arriving` — anything else throws `ConflictException('ride_not_reassignable')`.
  3. `drivers.releaseFromRide(previousDriverId, tx)` — the outgoing driver goes back to `online`.
  4. Clear `rides.driver_id` (and `vehicle_id`).
  5. `insertAudit({ rideId, driverId: previousDriverId, source: 'dispatcher', dispatcherId, reason, payload: { event: 'released' } })`.
  6. After commit, delegate to `ForceAssignService.forceAssign({ dispatcherId, rideId, driverId, reason })` for the new driver.
- **PATTERN**: `force-assign.service.ts` end to end — the transaction shape, the `// ── committed ──` marker, the notifier call after commit, the structured log.
- **IMPORTS**: `DRIZZLE`, `RidesRepository`, `RideTransitionService`, `RideLifecycleService`, `DispatchRepository`, `DispatchNotifier`, `ForceAssignService`.
- **GOTCHA**: Two transactions, not one — the release commits before the re-assign starts, so a failed re-assign leaves the ride in `requested` and the **cascade picks it up automatically**. That is the correct failure mode: the rider still gets a car. Say so in a comment; a reader will otherwise "fix" it into one transaction and turn a self-healing failure into a stuck ride.
- **GOTCHA**: Emit `ride:status` for the release so the outgoing driver's app drops the ride — `DispatchNotifier` already owns this; do not emit from the service directly.
- **VALIDATE**: `pnpm --filter @taxi/api test -- reassign`
- **SATISFIES**: AC #3

### Task A7 — ADD `POST /dispatch/rides/:rideId/reassign` to `dispatch.controller.ts`

- **IMPLEMENT**: `@Roles('dispatcher','admin')`, body `reassignBodySchema`, dispatcher id from `@CurrentUser()`.
- **PATTERN**: the `forceAssign` route directly above.
- **VALIDATE**: `pnpm --filter @taxi/api test -- dispatch.integration`
- **SATISFIES**: AC #3

### Task A8 — CREATE `apps/dispatch/src/features/override/assign-state.ts` + test

- **IMPLEMENT**: Pure module, no React:
  - `type AssignTarget = { rideId: string; currentDriverId: string | null; status: BoardRideStatus }`
  - `assignVerb(status): 'assign' | 'reassign'` — `requested`/`offered`/`queued` → assign; `accepted`/`arriving` → reassign; `arrived`/`in_progress` → `null` (not assignable).
  - `driverWarning(driver): 'offline' | 'on_ride' | null` — what the confirm step must surface.
  - `assignErrorKey(status: number, code: string): MessageKey` — maps 404 `driver_not_found` / 404 `ride_not_found` / 409 `ride_not_assignable` / 409 `ride_already_assigned` / 409 `ride_not_reassignable` to LV strings. An unmapped code falls back to a generic key rather than rendering the raw code.
  - `sortRoster(drivers, ride)` — online first, then by zone match with the pickup, then by name (`localeCompare(…, 'lv')`).
- **PATTERN**: `board-state.ts` — pure, time passed in, exhaustively testable.
- **GOTCHA**: `assignVerb` must be TOTAL over `BoardRideStatus` (`Record`, not `Partial`) for the same reason `ride-queue.tsx` is — a new board status must break the build here.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- assign-state`
- **SATISFIES**: AC #1, AC #4

### Task A9 — CREATE `apps/dispatch/src/features/override/use-assign.ts` + test

- **IMPLEMENT**: Hook owning the roster fetch (`GET /dispatch/drivers`, on dialog open, not on mount) and the three mutations (`assign`, `reassign`, `cancel`). Exposes `{ roster, loadingRoster, submit, submitting, error, reset }`. 401/403 → `clearSession()` + `router.replace('/login')`, exactly as `use-board.ts:fetchSnapshot` does.
- **PATTERN**: `use-board.ts:102-122` — the auth-failure branch and the `loadSession()` null guard are copied verbatim in spirit.
- **IMPORTS**: `apiUrl`, `loadSession`, `clearSession` from `@/features/auth`; `dispatchRosterSchema` from `@taxi/shared`.
- **GOTCHA**: **Parse the response** with `dispatchRosterSchema.parse()` — never trust the body's shape, same as the board's `dispatchBoardEventSchema.parse`.
- **GOTCHA**: Disable submission entirely when `pill === 'offline'` and say why (`console.assign_offline`). A write that silently fails while the console shows «Bezsaistē» is the trap #18 exists to prevent.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- use-assign`
- **SATISFIES**: AC #1, AC #5

### Task A10 — CREATE `driver-picker.tsx` + `assign-dialog.tsx` + tests

- **IMPLEMENT**: 
  - `DriverPicker` — a listbox of `sortRoster()` output, each row showing name, status dot, zone, phone, and the driver's active ride if any. Type-to-filter on name/plate/phone. Full keyboard: Up/Down/Enter/Escape per the ARIA APG combobox pattern.
  - `AssignDialog` — `role="dialog" aria-modal="true"`, focus trapped, Escape closes. Two steps: pick driver → confirm. The confirm step shows `driverWarning()` as a `role="alert"` when the driver is offline or on a ride, with the LV text «{name} nav tiešsaistē — piešķirt tik un tā?» and two 44px buttons. A reason field (optional, max 280) feeds the audit row.
- **PATTERN**: `zones-panel.tsx` for the chip/card styling and the `role="img" aria-label` status dot; `dispatch/page.tsx`'s `toggleStyle` for button shape.
- **GOTCHA**: The warning is a **confirm**, not a block. #10 documents force-assign's eligibility bypass as the feature. See Open Question Q1 — the ticket's AC text says "clear error"; this plan deliberately ships warn-and-confirm and calls the 409 the error.
- **GOTCHA**: 500-line cap — if `assign-dialog.tsx` approaches it, the confirm step moves to its own file. Do not raise the cap.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- assign-dialog driver-picker`
- **SATISFIES**: AC #1, AC #2, AC #4

### Task A11 — CREATE `cancel-dialog.tsx` + test

- **IMPLEMENT**: Confirm dialog posting `POST /rides/:rideId/cancel` with a reason. The route already accepts `dispatcher`/`admin` — no api work.
- **PATTERN**: `assign-dialog.tsx`.
- **GOTCHA**: Read `ride-lifecycle.controller.ts:83-99` for the body shape before writing the fetch; do not guess it.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- cancel-dialog`
- **SATISFIES**: AC #4

### Task A12 — UPDATE `ride-queue.tsx` and `dispatch/page.tsx` to mount the override slice

- **IMPLEMENT**: Each ride row gets an assign/reassign affordance (44px, keyboard reachable) whose label comes from `assignVerb()`; rows where the verb is `null` render no button. A `⌥A` / hotkey opens the dialog for the selected row. `page.tsx` owns the dialog's open state and renders `<AssignDialog>` / `<CancelDialog>`.
- **PATTERN**: the existing `flashRideIds` prop threading — add props, do not reach into the board slice's internals.
- **GOTCHA**: `ride-queue.tsx` is already dense; keep it under 500 lines by putting the row's action cluster in the override slice, imported into the row.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch && pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #1, AC #4

### Task A13 — ADD the LV strings for Phase A to `packages/shared/src/i18n.ts`

- **IMPLEMENT**: `console.assign`, `console.reassign`, `console.assign_pick_driver`, `console.assign_confirm`, `console.assign_reason`, `console.assign_offline_warning`, `console.assign_on_ride_warning`, `console.assign_offline` (disabled-because), `console.cancel_ride`, `console.cancel_confirm`, plus one key per `assignErrorKey` outcome.
- **PATTERN**: the existing `console.*` block (lines 44–80). LV first; every key present in all three catalogs.
- **GOTCHA**: `MessageKey` is derived from the catalog — a missing key in RU/EN is a typecheck failure, which is the point.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #10

### Task A14 — GATE Phase A

- **VALIDATE**: `cd /Users/Berzins/Desktop/taxi-dispatch-override && REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #11

---

## PHASE B — Phone orders, customers, address search, telephony seam

### Task B1 — CREATE `packages/shared/src/seams/telephony-provider.ts`

- **IMPLEMENT**: Mirror `sms-provider.ts`'s shape and prose density:

```ts
/**
 * Seam over a SIP/VoIP gateway (the architecture's named missing piece).
 * NOTHING is bound at pilot: Dina types the caller's number and the console
 * behaves identically. The seam exists so screen-pop automation is a binding
 * change, not a UI rewrite — evidence F2.2's PhoneLink is exactly this shape.
 */
export interface TelephonyProvider {
  /** Places an outbound call from the dispatcher's handset to `phoneE164`.
   *  Throws on gateway failure — the console falls back to a `tel:` link. */
  dial(phoneE164: string): Promise<void>;
  /** The number currently ringing the dispatcher, or null when the gateway
   *  reports no active inbound call. POLLED by the console, not pushed:
   *  a push contract would pin the seam to WebSocket-capable gateways. */
  currentCaller(): Promise<string | null>;
}
```

- **PATTERN**: `packages/shared/src/seams/sms-provider.ts` — interface only, no implementation, the "why this seam exists" comment carrying the decision date.
- **GOTCHA**: Export from `packages/shared/src/index.ts`.
- **VALIDATE**: `pnpm turbo run typecheck --filter @taxi/shared`
- **SATISFIES**: AC #8

### Task B2 — CREATE `services/api/src/features/telephony/` — stub + module

- **IMPLEMENT**: `StubTelephonyProvider implements TelephonyProvider` — `dial()` logs a structured `telephony.dial.stubbed` line and resolves; `currentCaller()` resolves `null`. A `TELEPHONY_PROVIDER` token and a module binding it. **Unlike the maps factory, this does NOT refuse to boot in production** — a stubbed telephony provider degrades to manual entry, which is the documented day-1 plan, not a money bug.
- **PATTERN**: `services/api/src/features/geo/stub-maps.provider.ts` and `geo.module.ts` — but note and explain the deliberate difference in the production-refusal rule.
- **VALIDATE**: `pnpm --filter @taxi/api test -- telephony`
- **SATISFIES**: AC #8

### Task B3 — UPDATE `packages/shared/src/seams/maps-provider.ts` — add `searchAddress`

- **IMPLEMENT**:

```ts
export interface AddressSuggestion {
  /** Provider place id — the ONLY field that may be stored indefinitely
   *  (Places policy: place IDs are exempt from the caching restrictions). */
  placeId: string;
  /** What the dispatcher reads: "Brīvības iela 45". */
  primaryText: string;
  /** Disambiguator: "Rīga, Latvija". */
  secondaryText: string;
}

export interface AddressSearchOptions {
  /** Bias results to the pilot city; NOT a restriction — Pierīga/Jūrmala
   *  pickups are in scope (PRD §6 geography). */
  bias: { center: LatLng; radiusMeters: number };
  /** Groups keystrokes + the terminating details call into ONE billed
   *  session. Minted per address FIELD, not per form. */
  sessionToken: string;
}

/** Typeahead for the dispatcher's booking form (#19). */
searchAddress(
  query: string,
  language: Language,
  options: AddressSearchOptions,
): Promise<AddressSuggestion[]>;

/** Resolves a chosen suggestion to a bookable point. TERMINATES the session. */
resolvePlace(
  placeId: string,
  language: Language,
  sessionToken: string,
): Promise<AddressPoint | null>;
```

- **PATTERN**: the file's existing `GeocodeResult`/`RouteResult` interface style and its "WHOLE UNITS" invariant-in-prose approach.
- **GOTCHA**: Adding two methods to `MapsProvider` breaks **every** implementer — `StubMapsProvider`, `CachingMapsProvider`, and the integration harness's fake source. Fix all of them in this task or typecheck fails.
- **VALIDATE**: `pnpm turbo run typecheck --force`
- **SATISFIES**: AC #6

### Task B4 — UPDATE `stub-maps.provider.ts` and `caching-maps.provider.ts`

- **IMPLEMENT**: 
  - Stub: `searchAddress()` and `resolvePlace()` throw the same "no geocoder bound" error the existing `geocode()` throws, with the message naming #19.
  - Caching facade: pass `searchAddress` straight through **uncached** (see gotcha), and cache `resolvePlace` by `placeId` — the one Places field policy permits storing indefinitely — with a TTL from a new `MAPS_PLACE_CACHE_TTL_SECONDS` env knob defaulted to 30 days.
- **PATTERN**: the existing pass-through block at `caching-maps.provider.ts:400-415` and the `renderPoints`/`cellOf` key discipline (never `JSON.stringify` a float).
- **GOTCHA**: **Do not cache autocomplete predictions.** Places policy forbids pre-fetching/caching Places content beyond the stated exceptions, and predictions are content. Session tokens + debounce are the spend control here, not a cache. `resolvePlace` results are cached because the coordinate for a `placeId` is stable and re-resolving on every prefill would spend for nothing — but bound it by TTL rather than storing forever (`expected`: the ToS 30-day content rule; verify the exact clause against the Maps Service Terms before production).
- **VALIDATE**: `pnpm --filter @taxi/api test -- caching-maps`
- **SATISFIES**: AC #6, AC #7

### Task B5 — CREATE `services/api/src/features/geo/google-places.provider.ts` + spec

- **IMPLEMENT**: `GooglePlacesProvider` implementing only `searchAddress` and `resolvePlace` (compose it beside the routes provider; it is not a full `MapsProvider`).
  - Autocomplete: `POST https://places.googleapis.com/v1/places:autocomplete`, headers `X-Goog-Api-Key`, `Content-Type: application/json`, `X-Goog-FieldMask: suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat`. Body: `{ input, languageCode: 'lv', includedRegionCodes: ['lv'], locationBias: { circle: { center, radius } }, sessionToken }`.
  - Resolve: `GET https://places.googleapis.com/v1/places/{placeId}?sessionToken=…` with `X-Goog-FieldMask: location,formattedAddress`.
  - Both wrapped in the same `AbortController` timeout race as `CachingMapsProvider.route()` uses, and both emitting the structured miss-path log `geo.places.request_completed` (renamed in the #122 review — `domain.component.action_state` wants a verb AND a state; failures are `geo.places.request_failed`). It counts calls that RETURNED A STATUS, so it is a floor on spend, not a total: a timeout throws before it.
- **PATTERN**: `caching-maps.provider.ts` — the timeout race, `MapsFailureReason`'s closed-enum discipline, and the coordinate-free error rule (never let a provider's free-text message reach a log).
- **IMPORTS**: `node:crypto` for `randomUUID()` session tokens; global `fetch` (Node 20+).
- **GOTCHA**: Terminate every session with **Place Details Essentials** (field mask including `location`), not IDs-Only. IDs-Only voids the session and bills every keystroke individually — the opposite of the intent.
- **GOTCHA**: `structuredFormat.mainText.text` / `.secondaryText.text` — the response nests text two levels deep. Parse the response through a zod schema; do not index blindly.
- **VALIDATE**: `pnpm --filter @taxi/api test -- google-places`
- **SATISFIES**: AC #6

### Task B6 — UPDATE `env.schema.ts` and `.env.example`

- **IMPLEMENT**: Add `GOOGLE_MAPS_API_KEY: z.string().min(1).optional()`, `PLACES_BIAS_RADIUS_METERS` (default 30000 — greater Rīga incl. Jūrmala), `PLACES_SEARCH_MIN_CHARS` (default 3), `MAPS_PLACE_CACHE_TTL_SECONDS` (default 2592000 = 30 days). Bind `GooglePlacesProvider` in `geo.module.ts` when the key is present, else the stub.
- **PATTERN**: the existing `MAPS_*` block's docblock density — each knob says what moving it costs.
- **GOTCHA**: `mapsProviderSourceFactory` already refuses to boot in production with the stub bound. Extend that refusal to the address-search binding: production without `GOOGLE_MAPS_API_KEY` must throw at boot, not 500 on Dina's first keystroke.
- **GOTCHA**: `.env.example` edits and commit messages that quote them trip the PreToolUse hook — write commit bodies via `-F` from the scratchpad (see `taxi-pretooluse-hook-blocks-dotenv-strings`).
- **VALIDATE**: `pnpm --filter @taxi/api test -- env.schema geo.module`
- **SATISFIES**: AC #6, AC #7

### Task B7 — CREATE `services/api/src/features/geo/address-search.controller.ts` + spec

- **IMPLEMENT**: `GET /geo/address-search?q=…&session=…` `@Roles('dispatcher','admin')` → `AddressSuggestion[]`; `POST /geo/places/:placeId/resolve` (body `{ session }`) → `AddressPoint`. Reject `q` shorter than `PLACES_SEARCH_MIN_CHARS` with an empty array, **not** a 400 — a dispatcher mid-word is not an error.
- **PATTERN**: `dispatch.controller.ts` per-route `@Roles`.
- **GOTCHA**: This route spends money on every call. Add the same rate-limit shape `rides.policy.ts` uses (`RIDE_REQUEST_MAX_PER_WINDOW`) keyed on the dispatcher — a runaway client loop must be bounded server-side, not only by the client's debounce.
- **VALIDATE**: `pnpm --filter @taxi/api test -- address-search`
- **SATISFIES**: AC #6, AC #7

### Task B8 — CREATE `db/src/schema/customers.ts` + generate the migration

- **IMPLEMENT**:

```ts
/**
 * The phone channel's customer record (#19). NOT a parallel identity —
 * `user_id` points at the `users` row whose phone the caller rang from, so a
 * caller who later installs the app is the same person with the same history.
 * This table holds what the APP path has no place for: the venue flag, the
 * display label Dina reads aloud, and dispatcher notes.
 */
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id),
  /** What Dina sees on the pop: "Hotel Roma" or "Anna B. (regulārā)". */
  label: text('label'),
  /** A venue books from a fixed address; a person does not. */
  isVenue: boolean('is_venue').notNull().default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A customer's reusable address. `place_id` is stored INDEFINITELY (the one
 * Places field the caching policy exempts); `location` is a refreshable
 * derivation of it, re-resolved when older than the Places content window.
 */
export const savedPlaces = pgTable('saved_places', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerId: uuid('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  kind: savedPlaceKindEnum('kind').notNull(),   // 'pickup' | 'dropoff'
  label: text('label'),
  address: text('address').notNull(),
  placeId: text('place_id'),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  /** When `location` was last resolved from `place_id`. */
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('saved_places_customer_idx').on(t.customerId)]);
```

- **PATTERN**: `db/src/schema/rides.ts` — the jsonb-vs-typed-column rule, docblocks explaining every nullable, indexes named `<table>_<col>_idx`.
- **IMPORTS**: add `savedPlaceKindEnum` to `db/src/schema/enums.ts`; mirror it as `SAVED_PLACE_KINDS` in `packages/shared/src/enums.ts`.
- **GOTCHA**: Run `pnpm --filter @taxi/db generate`, then migrate, then seed. Do not hand-write the SQL.
- **GOTCHA**: `users.phone` is unique — find-or-create is an upsert on phone, and it must NOT overwrite an existing rider's `displayName` or `language`.
- **VALIDATE**: `pnpm --filter @taxi/db generate && pnpm --filter @taxi/db test`
- **SATISFIES**: AC #5

### Task B9 — CREATE the `customers` api slice

- **IMPLEMENT**: 
  - `GET /customers/lookup?phone=+371…` `@Roles('dispatcher','admin')` → `{ customer, savedPlaces, recentRides }` or `null`. `recentRides` = the caller's last 3 rides projected to `{ pickup, destination, completedAt }` — **stable fields only**, per evidence F2.2's "Clean jobs" lesson (pickup/dropoff/passenger/phone; never per-trip fields like payment method or notes).
  - `GET /customers/venues` → venue customers for the quick-book list.
  - `POST /customers` / `PATCH /customers/:id` for Dina to name a caller or flag a venue.
- **PATTERN**: `services/api/src/features/drivers/` slice layout (controller/service/repository/module/index) and its `@Roles` discipline.
- **GOTCHA**: The lookup returns another person's PII. Log the lookup as a structured event (`dispatch.customers.lookup_completed` — renamed in the #122 review; `customers.lookup` was two segments against a closed domain list) with the dispatcher id **and the phone MASKED to its last 3 digits**. `.claude/references/logging-standard.md` says mask, not omit: a record with no subject cannot answer whose data was read, which is the only question a PII-access log exists to answer. The route is also rate-limited per dispatcher, or the endpoint is a phone-number → identity oracle.
- **GOTCHA**: Normalize the phone to E.164 before lookup, and validate with the same schema `otpRequestSchema` uses — two normalizations would make a caller invisible to their own record.
- **VALIDATE**: `pnpm --filter @taxi/api test -- customers`
- **SATISFIES**: AC #5

### Task B10 — CREATE `services/api/src/features/dispatch/bookings/` — `POST /dispatch/bookings`

- **IMPLEMENT**: `dispatcherBookingBodySchema` = `rideRequestBodySchema.extend({ callerPhone: e164, callerName: z.string().max(120).optional(), dispatcherNote: z.string().max(280).nullable().default(null) })` — note it **omits `riderId` by inheritance**, exactly like the rider body.
  `BookingsService.book(dispatcherId, idempotencyKey, body)`:
  1. Find-or-create the `users` row for `callerPhone` with `role: 'rider'`.
  2. Find-or-create the `customers` row.
  3. Delegate to `RidesService.request(riderId, idempotencyKey, rideBody, 'phone')` — **reuse, do not reimplement**. The quote, the idempotency reservation, the rate limit, the tracking token and the SMS all come free and identical.
  4. Write a `dispatch_audit_log` row recording who booked on whose behalf.
- **PATTERN**: `rides.service.ts:57-125` — read it in full; this task's whole job is to add an identity resolution step in front of it and change nothing else.
- **IMPORTS**: `IdempotencyKeyHeader`, `idempotencyKeySchema`, `ZodValidationPipe`, `CurrentUser`, `Roles`.
- **GOTCHA**: The `Idempotency-Key` header is **required** here too. Do not make it optional because "a dispatcher wouldn't double-submit" — she is typing fast, on a call, on a console that reconnects.
- **GOTCHA**: The rate limit in `RidesService` is keyed on the RIDER. A busy Friday where one venue books 25 rides in 10 minutes would hit `RIDE_REQUEST_MAX_PER_WINDOW = 20` and block a legitimate venue. Decide explicitly: either key the dispatcher path on the dispatcher id instead, or raise the window for `bookingChannel === 'phone'`. Recommended: key on the dispatcher — one human is a natural rate limit, and a venue's 25 bookings are 25 different riders' rides. Write the reasoning in the code.
- **GOTCHA**: `vehicleCount > 1` still throws `multi_taxi_not_supported` — the console must not offer the field until #22.
- **VALIDATE**: `pnpm --filter @taxi/api test -- bookings`
- **SATISFIES**: AC #5, AC #12

### Task B11 — CREATE `apps/dispatch/src/features/phone-orders/booking-draft.ts` + test

- **IMPLEMENT**: Pure module: the draft shape, `emptyDraft()`, field setters, `isBookable(draft)` (both address points resolved, phone valid), `serialize`/`deserialize` with a zod parse on read, and the storage key. **Declare the key in `features/auth/session.ts`** as `BOOKING_DRAFT_STORAGE_KEY` and drop it in `clearSession()` — it holds the caller's phone, name and addresses.
- **PATTERN**: `board-state.ts` (purity) + `session.ts:21-47` (the key-in-auth rule and the PII rationale comment).
- **GOTCHA**: Persist on **every keystroke** (debounced ~200 ms), not on blur. The ledger row is "Booking form data lost on disconnect/refresh: 0". Blur-only persistence loses the field being typed, which is the field that matters.
- **GOTCHA**: Wrap `localStorage` writes in try/catch — a full quota must never break the form (`use-board.ts:persistFrame` is the precedent).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- booking-draft`
- **SATISFIES**: AC #9

### Task B12 — CREATE `address-field.tsx` + test — the typeahead combobox

- **IMPLEMENT**: An ARIA APG combobox: `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, a `role="listbox"` popup. Debounce 300 ms; do not query below `PLACES_SEARCH_MIN_CHARS`; mint one session token per field instance and reuse it across keystrokes; on selection call the resolve endpoint with the same token, then discard the token.
- **PATTERN**: ARIA APG keyboard table — Down opens/moves, Up moves, Enter selects, Escape closes-then-clears, Alt+Down opens without moving.
- **GOTCHA**: The Latvian typing pattern is "iela + number" (evidence F2.4: Autocab teaches "house number, space, first few letters of the street"). Do not strip digits from the query or reorder tokens — pass the raw input; Places handles it.
- **GOTCHA**: Offline behaviour: when `pill === 'offline'` the field must accept **free text** into `address` and mark the draft not-bookable, with a visible reason. Silently dropping the typed address is the exact "console traps data" failure.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- address-field`
- **SATISFIES**: AC #6, AC #9, AC #10

### Task B13 — CREATE `caller-panel.tsx` + test

- **IMPLEMENT**: Phone input → lookup → shows the customer label, last 3 jobs (each one keystroke to reuse as pickup/dropoff), and the venue quick-book list. A venue selection sets the fixed pickup and jumps focus to the destination field.
- **PATTERN**: `zones-panel.tsx` card/chip styling.
- **GOTCHA**: Prefill **stable fields only** — pickup, dropoff, passenger name, phone. Never payment method, never notes, never category (evidence F2.2's "Clean jobs" toggle exists precisely because prefilling per-trip fields causes wrong bookings).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- caller-panel`
- **SATISFIES**: AC #5, AC #13

### Task B14 — CREATE `use-booking-form.ts` + `booking-form.tsx` + tests

- **IMPLEMENT**: Hook wires draft ↔ lookup ↔ submit (`POST /dispatch/bookings` with a `crypto.randomUUID()` Idempotency-Key minted **once per draft**, not per submit attempt — that is what makes a retry idempotent). Form tab order is **phone → pickup → destination → time → notes**, matching how callers speak (evidence F2.4). One hotkey (`⌥N`) opens the form from anywhere on the board; Escape closes with the draft intact.
- **PATTERN**: `use-board.ts` for the hook's effect discipline; `dispatch/page.tsx` for mounting.
- **GOTCHA**: **Zero-mouse completion is an acceptance criterion, not a nicety.** Every control reachable and operable by keyboard, including the venue list and the last-3-jobs chips. Write the keyboard test first.
- **GOTCHA**: 500-line cap. `booking-form.tsx` renders 5+ fields — if it approaches the cap, split per field group. The cap covers shipped source; the `.test.tsx` files are uncapped.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- booking-form use-booking-form`
- **SATISFIES**: AC #5, AC #9, AC #10, AC #13

### Task B15 — ADD the LV strings for Phase B; GATE Phase B

- **IMPLEMENT**: `console.new_order`, `console.caller_phone`, `console.caller_lookup_none`, `console.recent_jobs`, `console.venues`, `console.pickup`, `console.destination`, `console.book`, `console.booking_saved_offline`, `console.address_offline`, plus error keys.
- **VALIDATE**: `cd /Users/Berzins/Desktop/taxi-dispatch-override && REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #10, AC #11

---

## PHASE C — Zone/queue grid, cascade visibility, explainability

### Task C1 — UPDATE `DispatchQueueStore` — add `snapshot()` and join timestamps

- **IMPLEMENT**: 
  - `snapshot(geozoneId): Promise<Array<{ driverId: string; position: number; joinedAt: string }>>`
  - A companion Redis hash `dispatch:queue:<zone>:joined` written by `joinBack` (only when the driver is newly added — an idempotent re-join must NOT reset the timestamp, same reason the position isn't reset) and cleared by `leave`. `sendToBack` **does** rewrite it: going to the back is losing your earned time, which is the point.
  - Mirror all of it in `in-memory-dispatch-queue.store.ts`.
- **PATTERN**: `redis-dispatch-queue.store.ts` — the `LREM … 0` discipline and the "race-tolerant rather than atomic, deliberately" comment style.
- **GOTCHA**: Update the store's docblock — it currently says "Four methods, deliberately. Resist adding `size()`/`snapshot()` — nothing reads them until #19 draws a zone view." #19 is now drawing it; replace the prohibition with the reason it was lifted.
- **GOTCHA**: The Redis suite `describe.skip`s without `REDIS_TEST_URL`. This task's tests are exactly the ones that vanish. Set it before claiming green.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- dispatch-queue`
- **SATISFIES**: AC #14

### Task C2 — CREATE `packages/shared/src/dispatch-explanation.ts` + test

- **IMPLEMENT**: One function composing the "why this driver" line from structured inputs, returning a `MessageKey` + params rather than a pre-formatted string, so LV/RU/EN all work:

```ts
/**
 * THE one-line answer to "why this driver" (evidence F3.3). Composed HERE,
 * in shared, because Dina and the driver must read the IDENTICAL sentence —
 * that identity is what closes the fairness loop (S7-2). Two composers would
 * drift and the console would explain a different reason than the driver saw.
 */
export function explainAssignment(input: {
  strategy: 'auto_match' | 'geozone_queue' | 'dispatcher';
  zoneName: string | null;
  queuePosition: number | null;
  secondsInZone: number | null;
  etaSeconds: number;
}): { key: MessageKey; params: Record<string, string | number> }
```

Renders as «Āgenskalns rinda #1 · zonā 47 min · 4 min attālumā» for the queue case, «Tuvākais · 4 min attālumā» for auto-match, «Dispečera izvēle» for the override.

- **PATTERN**: `packages/shared/src/i18n.ts`'s `formatMessage(lang, key, params)` signature — return its inputs, do not call it.
- **GOTCHA**: `secondsInZone` is **time in the QUEUE** (from the hash added in C1), not Autocab's time-since-last-job (which lives in Postgres and is a different number). Label it that way in the LV string («zonā») and in the docblock — do not let a reader assume they are the same metric.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- dispatch-explanation`
- **SATISFIES**: AC #15

### Task C3 — UPDATE `dispatchBoardEventSchema` — add `zones[]` and per-ride `cascade`

- **IMPLEMENT**:

```ts
zones: z.array(z.object({
  geozoneId: z.string().uuid(),
  slug: z.string().min(1),
  name: z.string().min(1),
  queueModeEnabled: z.boolean(),
  entries: z.array(z.object({
    driverId: z.string().uuid(),
    name: z.string(),
    position: z.number().int().min(1),
    secondsInZone: z.number().int().nonnegative(),
    status: z.enum(DRIVER_STATUSES),
  })),
})),
```

and on each ride:

```ts
cascade: z.object({
  offeredToDriverId: z.string().uuid().nullable(),
  offeredToName: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
  nextDriverName: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  explanation: dispatchExplanationSchema.nullable(),
}).nullable(),
```

- **PATTERN**: the existing frame schema and the `EVENT_SCHEMAS` totality check at the bottom of `realtime-events.ts`.
- **GOTCHA**: **Every zone in the city appears, including empty ones** — that is what `zones-panel.tsx`'s docblock said it could not do without a catalog. Source the catalog from `geozones`, not from the drivers present.
- **GOTCHA**: The frame is emitted every 2 s and persisted to localStorage on every receipt. Adding zone entries and cascade state roughly doubles its size at pilot scale (`derived`: ~6 zones × ≤10 entries + ≤N rides × 6 fields; still low single-digit kB, per #18's "a few kB" premise — but re-measure rather than inherit that figure).
- **GOTCHA**: `applyDriverLocation` patches `frame.drivers` only. It must not silently desync `frame.zones` — the next full frame is ≤2 s away and self-heals, which is already the documented rule; state it for zones too.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/api test -- board`
- **SATISFIES**: AC #14, AC #15

### Task C4 — CREATE `board/zone-rows.ts` and `board/cascade.ts` + specs; UPDATE `board.service.ts`

- **IMPLEMENT**: Two pure projection modules called from `buildBoardState`. `zone-rows.ts` joins the geozone catalog to `snapshot()` output and driver names. `cascade.ts` joins `findPendingForRide` / `countAttempts` / `findTriedDriverIds` to names and composes `explainAssignment(...)`.
- **PATTERN**: `board.service.ts`'s "one read pass" structure and its serialization-here rule.
- **GOTCHA**: `board.service.ts`'s existing `Promise.all` zone fan-out already carries a documented fleet-cap warning. Do **not** add a second per-driver fan-out. Fetch queue snapshots per ZONE (≤6 calls) and pending offers in one batched query, not one per ride.
- **GOTCHA**: The board builds every 2 s. Every query added here runs 30 times a minute forever. Count them before and after and put the number in the PR body.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- board`
- **SATISFIES**: AC #14, AC #15

### Task C5 — CREATE `apps/dispatch/src/features/zones/zone-grid.tsx` + test; RETIRE `board/zones-panel.tsx`

- **IMPLEMENT**: The Autocab-shaped compact table (evidence F1.1/F5.1): one row per zone showing slug, queue-mode flag, and the ordered driver list with position and `mm` time-in-zone. Keeps `zones-panel.tsx`'s always-visible phone links — degraded mode still means Dina dispatches by voice.
- **PATTERN**: `zones-panel.tsx` (which this replaces) — copy the `DriverChip` and the `role="img" aria-label` status dot; delete the old file and its test, and remove the export from `board/index.ts`.
- **GOTCHA**: The zones view is the **primary** work surface, map secondary (evidence F1.1, and `apps/dispatch/CLAUDE.md`). `page.tsx`'s default `view` state stays `'zones'`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- zone-grid`
- **SATISFIES**: AC #14

### Task C6 — CREATE `cascade-strip.tsx` + test; mount in `ride-queue.tsx`

- **IMPLEMENT**: A one-line strip under each `offered`/`queued` ride row: «piedāvāts Jānim · 12 s · nākamais: Māra», with the explanation line beneath it. The countdown re-derives from `nowMs` (already ticking at 1 Hz in `use-board`) against `cascade.expiresAt` — no second timer.
- **PATTERN**: `ride-queue.tsx:ageOf` — digits-only rendering so nothing needs translating.
- **GOTCHA**: This is **status, not an alarm** (ISA-18.2, evidence F4.1). It recolors in place; it must not flash, toast or beep. Only `dispatch:unclaimed`, `dispatch:sms_failed` and the socket going offline may alarm.
- **GOTCHA**: A negative countdown (expired offer, frame not yet updated) renders as `0`, never as a negative number.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch -- cascade-strip`
- **SATISFIES**: AC #15

### Task C7 — ADD Phase C strings; GATE Phase C

- **IMPLEMENT**: `console.zone_queue_position`, `console.zone_time`, `console.zone_queue_mode`, `console.cascade_offered_to`, `console.cascade_next`, `console.cascade_attempts`, plus the three `explainAssignment` keys.
- **VALIDATE**: `cd /Users/Berzins/Desktop/taxi-dispatch-override && REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #10, AC #11

---

## PHASE D — Acceptance closure

> **Reconciled 2026-08-18, after Phase A (#120) and Phase B (#122) merged.** Task
> D1's three scenarios are largely already delivered — two by tests that predate
> #19, one by Phase B — and Phase A added four integration tests of its own that
> D1 never listed. Nothing below has been deleted; each item says where it went.
> Tests are cited **by name, not by line**, because later commits move the lines.

### Task D1 — WRITE the three AC scenarios as integration tests

**Status: two delivered, one partial. Do not re-write the delivered two.**

- **IMPLEMENT**: In `services/api/src/features/dispatch/dispatch.integration.spec.ts` (or a new `bookings.integration.spec.ts`):
  - **expected** — a phone order created via `POST /dispatch/bookings` enters the cascade and is offered to a driver exactly as an app booking is, with `bookingChannel === 'phone'` on the row.
    → **PARTIAL — delivered by Phase B (#122)** in `services/api/src/features/dispatch/bookings/bookings.integration.spec.ts`, test *"creates a phone-channel ride for a caller who has never rung (expected — AC #5, AC #12)"*. It asserts `bookingChannel === 'phone'`, `status === 'requested'`, a positive `totalCents`, the rider + customer records, and the dispatcher audit row. **Still open:** it does not drive `DispatchSweeper.tick()`, so the "enters the cascade and is offered to a driver" half is unproven. That half is the only remaining work in D1.
  - **edge** — force-assign lands cleanly mid-cascade: a ride in `offered` with a pending offer to driver X is force-assigned to driver Y; X's offer is revoked, Y holds the ride, the audit row names the dispatcher.
    → **ALREADY DELIVERED, pre-#19.** `dispatch.integration.spec.ts`, test *"force-assigns mid-cascade and clears the overridden card (AC #4)"*, shipped with #10. Phase A checked it and deliberately did not duplicate it.
  - **failure** — force-assign onto a driver who went offline **succeeds** (per #10's documented design) and the audit row records it; the console-side failure is the 409 when the ride has already moved on, which re-enters the cascade. See Open Question Q1.
    → **ALREADY DELIVERED, pre-#19.** Same file, test *"force-assigns a pooled ride to an OFFLINE driver and still audits it (edge)"*, shipped with #10.
- **PATTERN**: `dispatch.integration.spec.ts`'s existing harness.
- **GOTCHA**: Integration runs are mutually destructive across sessions (global-setup drops the shared test DB). One gate at a time.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- integration`
- **SATISFIES**: AC #1, AC #3, AC #5 — AC #3 and AC #5 are met by the above; AC #1's cascade-entry half is what remains.

### Task D1b — Phase A's four integration tests (DELIVERED IN PHASE A, listed so D does not re-scope them)

D1 never named these four. Phase A judged them necessary because
`reassign.service.spec.ts` asserts the two-transaction **order** against a fake
`db.transaction` that merely invokes its callback, and so cannot prove how the
real conditional UPDATEs interlock — `unassignDriver` guarded on
`eq(rides.driverId, previousDriverId)`, `assignDriver` on
`isNull(rides.driverId)`, across two separately-committed transactions. All four
live in `services/api/src/features/dispatch/dispatch.integration.spec.ts`:

1. *"reassigns an accepted ride: releases the first driver, stamps the second (#19)"*
2. *"refuses to reassign once the driver has reached the pickup (#19, failure)"*
3. *"lists offline drivers in the override roster (#19)"*
4. *"blocks a driver from reading the override roster (#19, failure)"*

The changelog below calls these "pulled forward from Phase D". That phrasing is
loose and is corrected here: they were **added in Phase A**, not moved from a
Phase D task, because no Phase D task listed them.

### Task D2 — WRITE DOWN the phone-channel-share query

- **IMPLEMENT**: Add the SQL to `docs/ux-metrics-ledger.md`'s Dispatch section (or a runbook), e.g. `SELECT booking_channel, count(*) FROM rides WHERE created_at >= … GROUP BY 1` — and state that no counter, event or column was added because `rides.booking_channel` already carries it.
- **GOTCHA**: The AC says "phone-channel share countable", not "a dashboard exists". Metabase is the stats delegate (evidence F7.3); do not build a stats endpoint.
- **VALIDATE**: run the query against the dev database with at least one phone-booked ride present.
- **SATISFIES**: AC #12

### Task D3 — MEASURE the ledger rows and record them with provenance

- **IMPLEMENT**: Time a repeat-caller booking, a new-caller booking, and a venue booking on the running console; record each in `docs/ux-metrics-ledger.md`'s `Latest` column with the date and the word `observed`. Run the disconnect chaos check (kill the API mid-typing, refresh, confirm the draft survives) and record `0 lost`.
- **GOTCHA**: These are the numbers the PR body will inherit. Per root `CLAUDE.md`, a figure under an **Observed** heading that no run produced is the defect even when the arithmetic is right. If a row was not measured, write `not measured`, not an estimate.
- **VALIDATE**: the ledger rows are filled and each carries `observed`/`derived`/`expected`.
- **SATISFIES**: AC #13

### Task D4 — FINAL gate + PR

- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
- **GOTCHA**: A backticked `` `Closes #19` `` merges without closing the issue. Write it unbackticked and verify with `gh pr view <n> --json closingIssuesReferences`.
- **GOTCHA**: `gh pr review --approve` always fails on this repo (solo, self-authored) — use `gh pr comment`.
- **GOTCHA**: GitHub did **not** auto-retarget the stacked PRs when #120 merged — this repo has `deleteBranchOnMerge: false`, and retargeting only fires when the base branch is deleted. `gh pr edit <n> --base main` had to be run by hand for both #121 and #122 (`observed` 2026-08-18). Verify the base; do not assume it.
- **SATISFIES**: AC #11, AC #16

---

## TESTING STRATEGY

### Unit Tests

Vitest everywhere. Each new module ships ≥1 expected + 1 edge + 1 failure case (root `CLAUDE.md`).

- **`packages/shared`** — `dispatch-explanation.ts` (each strategy branch, null zone, zero ETA), the new schemas (accepts a valid body, rejects a `riderId` smuggled into the dispatcher booking body, rejects a 281-char reason).
- **`services/api`** — pure services with stubbed repositories, following `force-assign.service.spec.ts`. `roster.service`, `reassign.service`, `zone-rows`, `cascade`, `google-places.provider` (with `fetch` stubbed — assert the field mask and the session token are sent, and that a malformed response is rejected by the zod parse rather than indexed into).
- **`apps/dispatch`** — RTL + jsdom, structural stubs per file (`leaflet`, `socket.io-client`). Pure modules (`assign-state`, `booking-draft`) tested without rendering at all.

### Integration Tests

`services/api/src/features/**/*.integration.spec.ts` against the real Postgres+Redis, per `dispatch.integration.spec.ts`. The three AC scenarios (Task D1) plus:

- A dispatcher booking replayed with the same `Idempotency-Key` returns the same ride and creates no second one.
- `POST /dispatch/bookings` as a `rider` role → 403.
- `GET /customers/lookup` as a `driver` role → 403.
- Reassign from `accepted` releases the outgoing driver's `drivers.status` back to `online`.

### Edge Cases

- Force-assign a driver who is **on another ride** — succeeds (design), and `claimDriver` returning `false` is the ordinary outcome, not an error.
- Force-assign a ride that reached `accepted` between the picker opening and the submit → 409 → the console shows the error and the board's next frame already reflects reality.
- Reassign a ride in `arrived` → 409 `ride_not_reassignable` (deliberately not permitted).
- A caller whose phone matches an existing **driver's** user row — the booking must not turn a driver into their own rider. Reject with a clear error.
- Address search while `pill === 'offline'` — free text accepted into the draft, submit disabled with a reason.
- Two zones where the same driver appears (transient Redis double-append) — the grid shows the earned position once, per `positions()`'s first-occurrence rule.
- A zone with `queueModeEnabled: false` — renders with drivers listed but no positions, so nobody reads a rank that dispatch does not honour.
- Draft restored after a browser restart with a stale resolved address (>30 days) — re-resolve or clear; never book a coordinate whose provenance expired.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
cd /Users/Berzins/Desktop/taxi-dispatch-override
pnpm turbo run lint --force
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm turbo run test --filter @taxi/dispatch
REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- integration
```

### Level 4: Manual Validation

```bash
pnpm --filter @taxi/api provision:dispatcher +37129999000 Dina   # if not already provisioned
pnpm dev
```

1. Log in at `/login` as the dispatcher; land on `/dispatch`.
2. Press `⌥N` — the booking form opens with focus in the phone field. Complete a booking **without touching the mouse**; time it.
3. Type a known caller's number → the panel shows their label and last 3 jobs; reuse one; time it.
4. Pick a venue from the quick-book list → pickup is fixed, focus lands on destination; time it.
5. Watch the new ride appear on the board with the cascade strip counting down and an explanation line.
6. Force-assign it to an **offline** driver → the warning appears → confirm → the ride is assigned and the audit row exists.
7. Reassign the accepted ride to a different driver → the first driver's app loses it, the second gains it.
8. Mid-typing, `docker compose stop` the API → the pill goes «Bezsaistē», the form disables submit with a reason, the typed draft stays. Refresh the page → the draft is still there.
9. `docker compose start` → the pill returns to «Tiešraide» and submission re-enables.

### Level 5: Additional Validation (Optional)

- `pnpm --filter @taxi/api run mint:ride` to script board traffic without a driver app.
- Run the console with `prefers-reduced-motion` forced and confirm nothing new animates.
- Keyboard-only pass with VoiceOver on the booking form (the rider app's a11y bar applied to Dina's screen — she is the one who uses it 8 hours a day).

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — Force-assign UI drives `POST /dispatch/rides/:rideId/assign`; a ride can be assigned from the board in ≤3 keystrokes from selection, and the audit row records the dispatcher.
- [ ] **AC #2** — The driver picker lists **all** drivers including offline ones, sourced from `GET /dispatch/drivers`, sorted online-first then zone-matched then by name.
- [ ] **AC #3** — Reassign moves an `accepted`/`arriving` ride to a new driver, releasing the first; `arrived`/`in_progress` are refused with a distinct error.
- [ ] **AC #4** — Cancel-as-dispatcher works from the board with a reason, using the existing `POST /rides/:rideId/cancel`.
- [ ] **AC #5** — A phone order created via `POST /dispatch/bookings` flows through **normal dispatch** — quoted, cascaded, offered — indistinguishable from an app booking except for `bookingChannel === 'phone'` (the ticket's *expected* case).
- [ ] **AC #6** — Address typeahead returns Latvian addresses for "iela + number" input, resolves to a bookable `AddressPoint`, and is fully keyboard-operable per the ARIA APG combobox pattern.
- [ ] **AC #7** — Spend controls are in place and stated: session tokens, ≥3-char minimum, 300 ms debounce, server-side rate limit, and no caching of predictions. The expected monthly cost at PRD §7 pilot volume is written in the PR body with its arithmetic.
- [ ] **AC #8** — `packages/shared/src/seams/telephony-provider.ts` exists with a stub implementation bound; no direct SIP/VoIP SDK import exists anywhere.
- [ ] **AC #9** — The booking draft survives an API kill, a socket drop and a full page refresh (ledger row: 0 lost).
- [ ] **AC #10** — Every user-facing string comes from the LV catalog; every interactive element is ≥44px, keyboard-reachable and focus-visible.
- [ ] **AC #11** — `pnpm turbo run typecheck lint test build --force` green **with `REDIS_TEST_URL` set**, and the skipped-suite count reported.
- [ ] **AC #12** — Phone-channel share is countable from `rides.booking_channel` and the query is written down; no new counter was built.
- [ ] **AC #13** — The four Dispatch ledger rows (repeat caller ≤30 s, new caller ≤60 s, venue ≤15 s, 0 data lost) are measured and recorded with `observed` provenance, or explicitly marked `not measured`.
- [ ] **AC #14** — The zone grid shows every configured zone (including empty ones) with per-driver queue position and time-in-queue, correctly labelled as time-in-**queue**, not time-since-last-job.
- [ ] **AC #15** — Each `offered`/`queued` ride shows who holds it, the countdown, who is next, and a one-line explanation composed by the single shared `explainAssignment()`.
- [ ] **AC #16** — No file of shipped source exceeds 500 lines; the eslint `max-lines` rule passes without a disable comment.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration) **with `REDIS_TEST_URL` set**
- [ ] No linting or type checking errors
- [ ] Manual testing (Level 4, steps 1–9) confirms the feature works
- [ ] Acceptance criteria all met, or explicitly deferred with a reason
- [ ] Every number in the PR body re-derived, not inherited from this plan
- [ ] `Closes #19` unbackticked; `gh pr view <n> --json closingIssuesReferences` confirms the link
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

**Q1 — The ticket's failure-case AC contradicts shipped #10. (Resolved 2026-08-17: warn-and-confirm.)**
The ticket says "assigning a just-went-offline driver → clear error + re-offer". `force-assign.service.ts` deliberately does the opposite: "overriding the algorithm — including onto an offline or otherwise ineligible driver — is the feature, not a hole in it." An offline driver assigns successfully today; the only errors are 404 (`driver_not_found`, `ride_not_found`) and 409 (`ride_not_assignable`, `ride_already_assigned`).
**Decision:** the console warns and requires a second confirm; the API is unchanged. The "clear error + re-offer" case is mapped to the **409**, where the ride has already moved on and the cascade resuming *is* the re-offer. This is an explicit divergence from the ticket text and must be stated in the PR body, not glossed. If Linards wants the literal AC, that is a change to #10's documented decision (Task A-none; would reverse `force-assign.service.ts`) and should be its own ticket.

**Q2 — `accepted|arriving → requested` is a cross-surface contract change. (Resolved 2026-08-17: ratified — release, not reassign-as-cancel.)**
Task A5 modifies `ALLOWED_TRANSITIONS`, which every surface reads. **Decision:** keep the release. The tracking token is minted once per ride at creation and #17's share-trip reuses it, so cancel-and-rebook takes away the rider's live link and SMS thread at the exact moment their car changed; a ride that briefly reads "searching" is the smaller and truer loss. `TRACKING_STATE_BY_STATUS` already maps `requested → 'searching'`, so the tracking page needs no change.

Blast radius **re-derived, not inherited** (`observed` 2026-08-17): `apps/rider` and `apps/driver` have no `src/` directory at all — the transition's only live consumers are the tracking page and the api's own guards. #15/#16/#17 inherit it as a contract, not as a fix.

Two invariants elsewhere in the repo assumed ride status only moves forward. Both are decided here rather than left for the reviewer to find:

- **The payment-method lock re-opens during the release window.** `isPaymentMethodLocked()` is a pure function of status, so `accepted → requested` makes the ride payment-editable again until a driver re-accepts. **Kept deliberately**, not overlooked: no driver is committed during that window, nothing is written to the ledger at `accepted` (settlement runs at `completed`), and the incoming driver reads the operative `ride.paymentMethod` at acceptance. Making the lock sticky would cost a column and a migration to guard a window measured in seconds. If that trade is ever revisited, the change belongs in `isPaymentMethodLocked()`, never in a caller.
- **`RideNotificationsService.onStatus` documents "each is reachable at most once per ride (the re-offer loop never passes through either), so there is no dedupe table".** #19 falsifies that premise: a reassign walks `accepted → requested → offered → accepted`, so `accepted` is now reachable twice and the rider on a phone booking gets a second `sms.driver_assigned` carrying the new driver, plate and ETA. That second SMS is the behaviour the rider needs — there is no "your car changed" key, and the message already states every fact that changed. **Follow-up A15 (must land with Phase A):** rewrite that comment so the no-outbox decision rests on "twice is intended — each send names the ride's current assignment, so a repeat is a correction, not a duplicate", not on an invariant this ticket removed. Leaving the old sentence is the #87/#107 failure shape — a retired claim still justifying a live decision.

**Q3 — Scope. (Resolved 2026-08-17: one plan, three shippable phases.)**
The ticket's 900–1400-line estimate counts only `apps/dispatch/src/features/{override,phone-orders,zones}` plus the seam — no api, no db. The real span adds a dispatcher-booking controller, two tables and a migration, a Places provider, a roster read, a reassign service, board-frame extensions and queue-store changes. **Recommendation:** execute as three PRs (A, B, C), each ending on its own green gate. The plan is written so that works without replanning. A single PR is possible and will be very large to review.

**Q4 — Dina's S9-1 console drawing. (Resolved 2026-08-17: not arrived; proceeding on the Autocab/TaxiCaller substitute.)**
#18's own ticket says: "When Dina's S9-1 console drawing arrives, review this + #19 plans against it before executing." The pre-execution check ran on 2026-08-17 and found nothing, on four independent signals (`observed`):
- the anketa responses sheet *Sakta Cab — atbildes* was last modified `2026-07-09T21:27:14Z` — the same minute the precizējumi mail was sent, i.e. no submission has landed since;
- zero inbound mail in 90 days matching Dina / anketa / precizējumi / konsole / dispečer;
- no image, PDF or Drive drawing owned by Atis modified anywhere after 2026-07-09; the shared `TAXI/Dispečers` folder holds only Atis's own Q&A doc;
- the `uzdevumi Dinai` task sheet Atis created 2026-07-22 is **empty (0/0 tasks)** — the chase from anketa-findings row 9 was never written down, so the drawing is **dropped, not pending**.

Scope of that claim: no drawing exists in any channel reachable from this machine. WhatsApp, Messenger and paper are not excluded — if Linards has one there, this resolution reopens.

**Consequence:** proceed. The drawing gates the **Phase B form layout and the Phase C zone grid only** — nothing in Phase A touches a screen it would have described. Re-open this question before Phase B if it arrives in the meantime. The chase itself is a product action, not a build one: it belongs in the (currently empty) `uzdevumi Dinai` sheet, and Dina has never been written to directly — both precizējumi mails went to `atisvikis@gmail.com`.

**Q5 — Google Places spend, at pilot volume.**
`observed` (Google core-services pricing list + pricing page, both fetched 2026-08-17): Autocomplete Requests **$2.83/1,000**; Place Details Essentials **$5.00/1,000**; Autocomplete Session Usage and Place Details Essentials (IDs Only) **no charge**; Essentials tier includes **10,000 free calls per SKU per month**.
`derived`, **conditional on all four of these holding**: PRD §7's month-3 target of 100 completed rides/week; every one of them phone-booked; 2 address fields per booking; ≤5 debounced keystrokes reaching the API per field.
- bookings/month = 100 × 52 ÷ 12 = **433**
- Autocomplete requests = 433 × 2 × 5 = **4,330** → inside the 10,000 free SKU allowance → **€0**
- Place Details Essentials = 433 × 2 = **866** → inside the 10,000 free allowance → **€0**
Break-even: the free allowance is exhausted at ~11.5 debounced requests per address field (10,000 ÷ (433 × 2)), after which each extra 1,000 costs $2.83.

**This is a worst case only for the console, and only while the rider app is unshipped.** Two things it does not model, both of which push the real number up:
- The free allowance is **per SKU, per project** — not per surface. #16's rider-side address search consumes the *same* Autocomplete Requests SKU, so the two features share one 10,000 budget. Whoever binds Places for #16 inherits this ceiling.
- **Abandoned searches are unmodelled.** A dispatcher who types, changes their mind and retypes bills autocomplete requests that never reach a terminating Place Details call. Every such session is pure autocomplete spend with no booking attached, and the 433-bookings denominator does not see it.
**Assumption to check against the first real bill:** the 5-requests-per-field figure is `expected`, not measured — a slow typist with a 300 ms debounce may well produce more. Instrument the miss-path counter (the #94 pattern) from day one so the second month's figure is `observed`, and re-derive rather than inherit this number when it reaches the PR body.

**Q6 — Places caching policy.**
`observed`: place IDs are explicitly exempt and storable indefinitely. `expected`: the 30-day limit on other Places content — the policy page points at the Maps Service Terms for the duration, and the terms page was not readable in full. Verify the exact clause before production; `MAPS_PLACE_CACHE_TTL_SECONDS` exists so the number is one env change.

**Q7 — Rate limiting the dispatcher booking path.**
`RIDE_REQUEST_MAX_PER_WINDOW = 20 per 10 min per rider` is keyed on the rider. A venue booking 25 cars in ten minutes creates 25 rides for 25 *different* riders, so the rider key never trips — but a single caller rebooking would. **Recommendation in Task B10:** key the dispatcher path on the dispatcher id. Flagging it because it is a security-relevant default being changed, not a detail.

**Q8 — Assumed: no new npm dependency.** Places API (New) is plain REST over `fetch`; the ARIA combobox is hand-rolled per the APG (the repo has no component library and adding one is out of scope). If the combobox proves fiddly, that is an argument to be made explicitly, not a silent `pnpm add`.

## NOTES (open canvas)

### One-pass confidence, per phase

A single score across this span would be dishonest — the three phases are not equally mapped.

| Phase | Confidence | Why |
|---|---|---|
| **A** — Override | **9.5/10** | Every endpoint it drives is shipped and tested. The one novel piece is the `accepted → requested` transition, and the state machine is small and well-documented. Failure modes are known 404/409s. |
| **B** — Phone orders | **7.5/10** | Three genuinely new things at once: a first-ever Places binding (field masks, session-token termination, an untested cost model), two new tables with a find-or-create identity path, and a hand-rolled ARIA combobox. Any of the three can eat a pass on its own. |
| **C** — Zones & cascade | **9/10** | Bounded and local. The queue store's own docblock names the work; the risk is the board query count creeping on a 2 s loop, which Task C4 calls out explicitly. |
| **Aggregate** | **~8/10** | Dominated by B. Executing B as its own loop, with its own gate, is what keeps a miss there from stalling A and C. |

This sits below the skill's "should not be below 9/10" bar, and that is the honest reading rather than a rounding-up: root `CLAUDE.md` treats a confidence number as a claim like any other. Phase A alone clears the bar comfortably.

### Why the roster is a separate endpoint, not frame fields

The board frame is pushed every 2 s and persisted to localStorage on every receipt. The roster changes when a driver is approved or deactivated — hourly at best. Putting it on the frame would multiply a slow-moving list by 30 emissions a minute and grow the PII blob on Dina's disk for no benefit. It is fetched when the picker opens. The counter-argument (10 drivers is nothing) is true today and stops being true at the fleet cap the board service already warns about; this is the cheap side to be on.

### Two verbs, and why only one is built

Evidence F3.2 documents Offer vs Force-assign as two distinct dispatcher verbs shipped independently by Onro and Onde. #10 built force-assign. A manual **Offer** (dispatcher picks a driver, driver still gets accept/decline in the timer) is not in this plan — the endpoint doesn't exist, the ticket doesn't ask for it, and the cascade already offers automatically. Worth naming as the obvious follow-up: the parts (offer builder, timers, revocation) are all present, so it is a small service and a second button.

### The reassign two-transaction decision, restated

```text
tx1: accepted → requested ; release old driver ; clear driver_id ; audit
     └── commit
tx2: ForceAssignService.forceAssign(newDriver)
     └── on failure: ride sits in `requested`, the cascade takes it
```

One transaction would be tidier and strictly worse: a failure in the second half would roll back the release, leaving the ride pinned to a driver Dina has already decided is wrong. The two-transaction shape makes the failure mode "the rider gets a car by the normal route", which is the outcome anyone would choose.

### What was considered and rejected for address entry

| Option | Verdict |
|---|---|
| Saved places + venues only (Postgres) | Free, but a brand-new caller's address is unbookable — fails the ledger's new-caller row outright. Kept as the *first* source in the typeahead, so most lookups never reach Google. |
| Nominatim self-hosted | €0/call but ~2 GB RAM on the Hetzner box and a weaker match on informal LV names. Reconsider if the first bill surprises. |
| Free-text address, no coordinates | Structurally impossible: `addressPointSchema` requires a `location`, and without one there is no quote, no ETA, no zone and no auto-match. |
| Google Places, cached | Chosen. Free at pilot volume, best LV coverage, and it pulls forward the binding #16 needs anyway. |

The typeahead should query **saved places and venues first, locally**, and only fall through to Places when the local sources return nothing — that is both the fastest path for the repeat-caller case (the ledger's ≤30 s row) and the reason the cost model has headroom.

### Alarm discipline is a constraint on this ticket, not just #18

Everything added here is **status**: the cascade strip, the queue positions, the assign result. None of it may toast, flash or beep. The alarm budget is <6/hour and the only three alarms are `dispatch:unclaimed`, `dispatch:sms_failed` and the socket going offline. A "ride assigned!" toast would be the exact regression ISA-18.2 exists to prevent, and it is the most natural thing in the world to add.

### The explanation string is a fairness artifact, not a tooltip

`explainAssignment()` lives in `shared` because the sentence Dina reads must be byte-identical to the one the driver reads (#15). That identity is the mechanism that converts "why did Jānis get that job?" from a phone argument into a self-service answer — evidence F5.1 and the arxiv transparency study both land on it. If it ever gets composed twice, the feature quietly stops working while every test stays green.

## AMENDMENTS

- 2026-08-17 — **Q2 and Q4 closed before Phase A shipped.** Q2 ratified the dispatcher release over reassign-as-cancel (the tracking token is minted once per ride, so cancel-and-rebook takes the rider's live link at the moment their car changes) and recorded the two forward-only assumptions the new transition breaks: the payment-method lock re-opening during the release window (kept, deliberately) and `RideNotificationsService.onStatus`'s "reachable at most once per ride" premise (falsified — **follow-up A15**). Q4 recorded four independent `observed` signals that Dina's S9-1 drawing is dropped rather than pending, and that it gates Phase B/C layout only.
- 2026-08-17 — **Task A15 added and executed with Phase A**: rewrote `onStatus`'s docblock so the no-outbox decision rests on "twice is intended — each send names the ride's current assignment" instead of the invariant #19 removed. Leaving the old sentence would have been the #87/#107 shape — a retired claim still justifying a live decision.
- 2026-08-17 — **Phase A executed and gated.** Four integration tests were pulled forward from Phase D into Phase A, because the unit specs assert transaction *order* against a fake `db` and cannot prove how the real conditional UPDATEs (`unassignDriver` on the outgoing driver id, `assignDriver` on `driver_id IS NULL`) interlock across two committed transactions. Report: `.claude/reports/dispatch-override-phone-orders-zones-report.md`.
