# Feature: Rider app — auth shell + text-first booking (address search, upfront quote, confirm), screen-reader-first (#16)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

**Branch from `origin/main`.** The plan was written against `origin/main` at `a6481aa` (`Merge pull request #145`). Do NOT branch from `feature/deploy-hetzner-environment` — it predates #139 and has no `apps/driver/src`, which is this ticket's entire pattern source.

---

## Feature Description

The rider app today is the bare Expo template: `App.tsx`, `index.ts`, no `src/`. This ticket makes it a real app — sign in by SMS OTP, then book a ride: pick up where you are, say where you're going, see the price before you commit, confirm, and watch it get matched.

The differentiator is not the feature list, it is the **modality**. Blind riders are a named unserved segment (PRD §5, anketa S5-8) and screen-reader excellence is a launch requirement, not a fast-follow. The published research (`docs/research/rider-ux-evidence.md` §1.2) says the two flows that actually break for blind users are **map-pin pickup placement** and **vehicle identification** — not missing button labels. So this app has no map on the critical path at all: booking is a text field, a saved-address list, and a price. That same build is what serves elderly riders (DiDi elderly mode + Uber Simple Mode converge on exactly this: pre-saved addresses plus one action).

Delivering it needs three things the api does not have yet: a **quote you can see before you book**, **rider access to the address typeahead**, and **a way to re-read your ride after a socket reconnect**. Those are Phase 2 of this plan, and they are the reason this ticket is not confined to `apps/rider/**`.

## User Story

As a rider in Rīga — including one who cannot see the screen
I want to book a taxi by typing or tapping a saved address, see the exact price before I commit, and hear what is happening while a car is found
So that I can travel independently, without a map, without a surprise fare, and without asking anyone for help.

## Problem Statement

Three problems stack.

1. **There is no rider surface at all.** Every rider that exists today either phones Dina (#19's console) or is a row in a test. The hypothesis in the PRD is "supply is the whole game; riders follow supply" — but a driver who goes online to zero rider-side demand churns, and the pilot's ≥100 rides/week target has no channel to arrive through.
2. **The accessible booking flow does not exist anywhere on the market.** Uber's and Lyft's apps are technically VoiceOver-operable and still fail at pin placement and "which car is mine" — Uber's own design case study names both as unsolved. A 10-driver operation with a human dispatcher can beat that, but only if the app is built text-first from the first commit. Retrofitting accessibility onto a map-first booking screen is what every incumbent did, and it is why they are still stuck.
3. **The api's rider-facing surface has three holes**, each of which silently breaks an acceptance criterion:
   - `POST /rides` is the only path that produces a quote, and it creates a ride as a side effect. "Upfront quote display; confirm → ride request" is not expressible against it.
   - `GET /geo/address-search` and `POST /geo/places/:placeId/resolve` are `@Roles('dispatcher', 'admin')`. A rider gets a 403 on every keystroke.
   - `roomsOnConnect()` (`services/api/src/features/realtime/room-policy.ts`) never returns a ride room, and `RealtimeService.joinRideRoom()` only moves the sockets that exist **at the moment it is called**. A rider whose socket reconnects — a three-second tunnel, a backgrounded app — is outside the ride room forever, with no REST route to recover state. The "matched/queued feedback" AC is not deliverable on sockets alone.

## Solution Statement

Build the rider app as a near-mirror of `apps/driver` (which shipped in #139 and is the house pattern for an Expo surface here): expo-router file routes that re-export screens from vertical slices, `SecureStore` session, one `ApiClient` with the 401→sign-out rule, `useT()` over the shared LV/RU/EN catalog, and `jest-expo` + RNTL colocated tests.

On top of that shell, one booking screen with **no map**:

- **Pickup** defaults to the device's coarse GPS position, reverse-geocoded to a street line, editable through the same search sheet as dropoff. Never a draggable pin.
- **Dropoff** is a full-screen search sheet: type → suggestions from `GET /geo/address-search` → tap → `POST /geo/places/:placeId/resolve` buys the coordinate.
- **Saved addresses** live on the device. One tap fills the dropoff *and* fires the quote — this is what makes a repeat ride 2 taps.
- **The quote** arrives from a new `POST /rides/quote`: same `PricingService.quote()` the booking path uses, no ride created, its own rate key. Because both calls go through the `'quote'`-caller `CachingMapsProvider` with identical rounded coordinates, confirming after previewing costs **one** paid Routes call, not two.
- **Confirm** sends `POST /rides` with an `Idempotency-Key` minted once per attempt and reused across every retry of that attempt.
- **Status** listens on `ride:status`, and refetches through a new rider-scoped `GET /rides/:rideId` whenever the socket reconnects.

Accessibility is implemented as testable properties, not as a review checklist: focus is moved explicitly on every screen transition (RN does not do it for you), async changes are announced, and every one of those behaviours is pinned by an RNTL test that spies on `AccessibilityInfo`. The manual TalkBack pass then confirms what the tests cannot: that it is actually *pleasant*.

## Out of Scope / Non-Goals

- **Not included: any map.** No `react-native-maps`, no pin, no polyline, no route preview. The 2026-08-07 re-slice killed pin-dragging on the critical path and nothing in this ticket reintroduces it in a different shape. (Supersedes the original AC — see AMENDMENTS.)
- **Not included: ride tracking, driver identity, payment execution, ride history, filters.** All #17. This ticket ends when the ride is `requested`/`offered` and the rider has been told so. `GET /rides/:rideId` ships here because the reconnect hole demands it, but it returns the ride and nothing else — no driver position, no ETA, no plate.
- **Not included: API-backed saved addresses.** Device-local for #16 (decision D3). `savedPlaceSchema` in shared is `customerId`-scoped — the phone channel's record — and wiring riders into it means a new table, a migration and a slice. Follow-up ticket; named in Forward-references.
- **Not included: scheduled rides (#21), multi-taxi (#22), shared-ride discount (#23), rider bid pricing.** `rideRequestBodySchema` carries `scheduledFor` and `vehicleCount`; this app sends neither (`vehicleCount` defaults to 1, and `RidesService` 400s on >1 anyway).
- **Not included: push notifications for riders.** #14's `features/push` is driver-only. A rider gets SMS (#63) and the in-app socket.
- **Not included: the blind-rider arrival protocol** (evidence item 7 — "announce yourself", honk-on-request). It belongs to the active-ride screen, which is #17.
- **Not included: a real Routes/Places provider.** `geo.module.ts:12-13` names #16 as where `StubMapsProvider` gets replaced; #134 owns that now, and #94 (its prerequisite hardening) is CLOSED. This ticket runs on the stub in dev and does not touch the production factory. Widening the geo routes to riders is a `@Roles` change, not a provider change.
- **Not changing:** `POST /rides`'s contract, `rideRequestBodySchema`, the idempotency reservation, the ride state machine, `resolveCommissionPct()`, or any driver-app file.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High — greenfield app surface plus three api additions, with an accessibility bar that is itself the acceptance criterion.
**Primary Systems Affected**: `apps/rider` (everything), `services/api/src/features/{rides,geo}` (three additions), `packages/shared` (schemas + i18n)
**Dependencies**: `expo-router`, `expo-secure-store`, `expo-localization`, `expo-location` (foreground only), `@react-native-async-storage/async-storage`, `socket.io-client`, `jest-expo`, `@testing-library/react-native` — all at the versions `apps/driver` already pins.

## Related Work

**Implements**: [#16](https://github.com/linardsb/taxi/issues/16) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) → `docs/epics/sakta-cab.architecture.md` §"UI surface decisions (2026-08-07)"

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/driver-app-auth-online-location.md` — Why: **the** pattern source. Auth slice, api client, session store, i18n, components, jest-expo/eslint/app.json scaffolding, and its phase ordering (contracts → api → app tooling → app) are all mirrored here.
- `.claude/plans/api-rides-pricing.md` (#9) — Why: the quote path this ticket previews. `PricingService.quote()`, `rideCreatedSchema`, the idempotency reservation.
- `.claude/plans/api-auth-realtime-gateway.md` (#7) — Why: OTP contract, `authSessionSchema`, the socket handshake and the no-client-join room rule.
- `.claude/plans/dispatch-override-phone-orders-zones.md` (#19 Phase B) — Why: `address-field.tsx` in the console is the *only* existing consumer of the Places typeahead. Its session-token discipline and 429 handling are the reference implementation for the rider's search sheet.
- `.claude/plans/harden-maps-seam-spend-controls.md` (#94) — Why: `MAPS_ROUTE_TIMEOUT_MS`, the negative cache, the caller namespacing that makes the preview→booking cache hit possible.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — expected: `rider-saved-places-api.md` (device-local → server-backed, D3), and #17's tracking plan, which takes over `GET /rides/:rideId` and extends it.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**The pattern source — read these first, in this order.** Everything in `apps/rider` is a near-transcription of the driver equivalent.

- `apps/driver/package.json` — Why: **copy the pins verbatim.** `typescript: ~5.9.3` (NOT 6.x — see GOTCHA below), `main: "expo-router/entry"`, the whole `jest` block, `expo.install.exclude: ["typescript"]`, and the `lint`/`test` scripts the rider currently has neither of.
- `apps/driver/tsconfig.json` — Why: `paths: { "@/*": ["./src/*"] }`, `types: ["jest"]`, the `include`/`exclude` lists.
- `apps/driver/eslint.config.mjs` — Why: the restated `max-lines: 500` and its test/scripts override. The comment explains why it cannot inherit `@taxi/config/eslint/base.mjs` — the same is true for rider.
- `apps/driver/jest.setup.ts` — Why: the native-module fakes, the `mockRouter` singleton (a test reads its spies back via `jest.requireMock('expo-router')`), and the **warm-up block at the bottom**. That block's comment cites two real CI runs that timed out at 5 s and 20 s; do not drop it.
- `apps/driver/app.json` — Why: bundle id / package / scheme / plugins / `locales` shape.
- `apps/driver/src/config.ts` — Why: `apiUrl()`, and specifically why it **throws** rather than defaulting in a release build.
- `apps/driver/src/app/_layout.tsx`, `index.tsx`, `login.tsx`, `verify.tsx` — Why: route files are one-line re-exports; providers nest in `_layout`.
- `apps/driver/src/features/auth/api-client.ts` — Why: **transcribe this file.** `ApiError(status, code, retryAfterSeconds, issues)`, the 8 s timeout that covers the body read, 204 handling, `apiErrorBodySchema` parsing, 401-with-token → `onUnauthorized`.
- `apps/driver/src/features/auth/session-store.ts` — Why: SecureStore JSON blob, clean-on-any-miss. Rider changes only the key string.
- `apps/driver/src/features/auth/use-session.tsx` — Why: the module-level `live` object and why it is module-level (react-hooks rules + a singleton provider), single-flight `signOut`, `onBeforeSignOut` hooks.
- `apps/driver/src/features/auth/login-screen.tsx` (lines 30–95) — Why: the 429 → `retryAfterSeconds` → countdown pattern, `errorMessageKey(err?.code ?? 'generic')`, `normalisePhone` gating the button.
- `apps/driver/src/features/auth/verify-screen.tsx` — Why: auto-submit on the 6th digit, clear-and-refocus on failure, `textContentType="oneTimeCode"` + `autoComplete="sms-otp"`.
- `apps/driver/src/features/auth/phone-normalise.ts` — Why: copy unchanged.
- `apps/driver/src/components/{Button,TextField,Screen,Banner}.tsx` — Why: **copy all four.** They already carry the 44 px minimum, the visible focus outline (and the comment explaining why an accent border was wrong), the label-as-accessible-name rule, and Banner's iOS-announce / Android-live-region platform split.
- `apps/driver/src/features/i18n/{device-language,use-t,error-key}.ts` — Why: copy `device-language.ts` and `use-t.ts` unchanged; `error-key.ts` changes exactly one prefix string.
- `apps/driver/src/features/location/socket.ts` (lines 1–45) — Why: `createDriverSocket`'s recipe — `autoConnect: false`, the library's own backoff, `connect_error === 'unauthorized'` → sign out. The rider socket is this minus the ack helper.
- `apps/driver/src/features/availability/use-presence.tsx` — Why: the reference for a provider that owns a socket lifecycle and registers an `onBeforeSignOut` hook.

**The api surface this talks to.**

- `services/api/src/features/rides/rides.controller.ts` — Why: the class is `@Roles('rider')`; the new quote route goes **here**, and the docblock's "there is deliberately NO `:id` route here" is the line this ticket amends.
- `services/api/src/features/rides/rides.service.ts` (lines 60–200) — Why: `request()`'s ordering — reject → reserve → rate-limit → quote → persist. The new `previewQuote()` reuses only the rate-limit + `pricing.quote()` halves and touches neither the reservation nor the repository.
- `services/api/src/features/rides/rides.policy.ts` — Why: the cap/key idiom and the derivation style the new rider caps must match.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` — Why: **per-route `@Roles` on a second controller sharing the `rides` prefix.** If `GET /rides/:rideId` needs a role other than the class default, this is the precedent.
- `services/api/src/features/geo/address-search.controller.ts` — Why: the two routes to widen, the min-chars short-circuit placed *before* the rate limit, the `assertWithinRateLimit` 429 shape.
- `services/api/src/features/geo/address-search.policy.ts` — Why: the cap derivation to mirror, and the resolve-cap docblock's arithmetic on why throttling a resolve *costs* money.
- `services/api/src/features/geo/caching-maps.provider.ts` (lines 1–90) — Why: `COORD_PRECISION = 4`, `MapsCaller = 'quote' | 'eta'`, `renderPoints`/`routeCacheKey`. This is the evidence behind the "preview then book = one paid call" claim.
- `services/api/src/features/pricing/pricing.service.ts` — Why: `quote(request)` returns `{ quote, split }` and reads `platform_config` *before* spending on maps. The preview route calls it unchanged.
- `services/api/src/features/realtime/room-policy.ts` — Why: `roomsOnConnect()` returns no ride room. This is the proof the reconnect hole is real.
- `services/api/src/features/realtime/realtime.service.ts` (lines 59–70) — Why: `joinRideRoom` moves only sockets that exist when it runs.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` — Why: the OTP is logged in full. This is how Level 4 reads a code.

**Contracts.**

- `packages/shared/src/schemas/ride.ts` — Why: `rideRequestBodySchema` (what goes on the wire, `riderId` omitted by construction), `fareQuoteSchema`, `rideCreatedSchema`, `assertFareQuoteConsistent`, `BOOKABLE_PAYMENT_METHODS` narrowing.
- `packages/shared/src/schemas/address-search.ts` — Why: `addressSuggestionSchema` (a suggestion is **not** bookable), `addressSearchQuerySchema` (`session` is a uuid **by contract** — it is interpolated into the provider URL), `resolvePlaceBodySchema`.
- `packages/shared/src/schemas/geo.ts` — Why: `addressPointSchema = { location: LatLng, address: string }`. This is the only bookable address shape.
- `packages/shared/src/schemas/auth.ts` — Why: `SIGNUP_ROLES` includes `'rider'` (self-service signup — no seed row needed), `otpRequestResponseSchema`, `authSessionSchema` (ISO-string wire shape).
- `packages/shared/src/idempotency.ts` — Why: `IDEMPOTENCY_KEY_HEADER` and `idempotencyKeySchema` already exist. **There is no client-side minter** — use `crypto.randomUUID()`; do not add one to shared.
- `packages/shared/src/realtime-events.ts` (lines 90–99) — Why: `rideStatusEventSchema`. `previousStatus` is nullable and **status can move backward**.
- `packages/shared/src/theme.ts` — Why: every colour, spacing, radius and font size. No literals in components.
- `packages/shared/src/i18n/{lv,ru,en}.ts` — Why: `lv` is the reference dictionary; `MessageKey` derives from it and `satisfies` forces the other two to match. Current sizes: lv 296, ru 249, en 245 lines.

**Reference docs.**

- `.claude/references/realtime-events.md` — Why: the `ride:status` row. Read the "status can move BACKWARD" sentence; it is edge case E8.
- `.claude/references/logging-standard.md` — Why: no coordinates, no unmasked phone numbers in any log line the api gains.
- `.claude/references/ui-decisions.md` — Why: where cosmetic questions go instead of being debated mid-implementation.
- `docs/research/rider-ux-evidence.md` §1.2, §1.4, §5, §7, and the Top-10 table — Why: this ticket's UX is a direct transcription of items 4, 5 and 10, and §1.4 is why focus management is manual.
- `docs/ux-metrics-ledger.md`, Rider rows 12 and 13 — Why: the two targets bound to #16 (≤4 taps; 100% SR task success).

### New Files to Create

**`packages/shared`**

- `src/schemas/ride.ts` — UPDATE, not create: add `rideQuoteBodySchema` + `rideQuotePreviewSchema`.
- `src/i18n/{lv,ru,en}.ts` — UPDATE: the `rider.*` key block.

**`services/api`**

- `src/features/rides/rides.controller.ts` — UPDATE: `POST /rides/quote`, `GET /rides/:rideId`.
- `src/features/rides/rides.service.ts` — UPDATE: `previewQuote()`, `findForRider()`.
- `src/features/rides/rides.policy.ts` — UPDATE: `RIDE_QUOTE_MAX_PER_WINDOW`, `rideQuoteRateKey`.
- `src/features/rides/rides.repository.ts` — UPDATE: a rider-scoped single-ride read (check whether `findWithQuote` already suffices before adding one).
- `src/features/geo/address-search.controller.ts` — UPDATE: `@Roles(..., 'rider')` on both routes, rider-sized caps selected by role.
- `src/features/geo/address-search.policy.ts` — UPDATE: `RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW`, `RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW`, and rider key builders.
- `src/features/rides/rides.integration.spec.ts` — UPDATE: quote-preview and ride-read cases.
- `src/features/geo/address-search.controller.spec.ts` — UPDATE: rider-role cases.

**`apps/rider` — scaffolding**

- `eslint.config.mjs`, `jest.setup.ts`, `.prettierrc`, `expo-types.d.ts`
- `locales/{lv,ru,en}.json` (the iOS permission strings for `expo-location` foreground use)
- DELETE `App.tsx`, DELETE `index.ts`

**`apps/rider/src`**

- `config.ts` + `config.test.ts`
- `app/_layout.tsx`, `app/index.tsx`, `app/login.tsx`, `app/verify.tsx`, `app/book/index.tsx`, `app/book/address.tsx`, `app/book/status.tsx`
- `components/{Screen,Button,TextField,Banner}.tsx` + `index.ts` + `{Button,TextField,Banner}.test.tsx`
- `components/use-screen-focus.ts` + `use-screen-focus.test.tsx` — the focus-on-mount hook (new; the driver app has no equivalent)
- `features/i18n/{device-language,use-t,error-key,index}.ts` + `device-language.test.ts` + `error-key.test.ts`
- `features/auth/{api-client,session-store,use-session,phone-normalise,login-screen,verify-screen,index}.ts[x]` + a test per file
- `features/places/{saved-places-store,use-saved-places,search-sheet,address-row,index}.ts[x]` + tests
- `features/booking/{use-booking-draft,use-quote,booking-screen,quote-card,payment-chips,index}.ts[x]` + tests
- `features/ride-status/{use-ride-status,socket,status-screen,index}.ts[x]` + tests

**Docs**

- `docs/runbooks/rider-a11y-walkthrough.md` — the scripted screen-reader audit the ux-metrics-ledger row 13 refers to ("audit script lives in ticket").

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [React Native — Accessibility](https://reactnative.dev/docs/accessibility)
  - Sections: `accessibilityRole`, `accessibilityState`, `accessibilityLiveRegion`, `AccessibilityInfo.setAccessibilityFocus`, `AccessibilityInfo.announceForAccessibility`
  - Why: every a11y property this ticket asserts comes from here. Note that `setAccessibilityFocus` takes a **node handle**, not a ref — `findNodeHandle(ref.current)`.
- [React Native — AccessibilityInfo](https://reactnative.dev/docs/accessibilityinfo)
  - Section: `isScreenReaderEnabled`, `announceForAccessibility`
  - Why: the announce is a no-op with no screen reader running, which is why the tests spy on the call rather than on any rendered output.
- [Expo Router — file-based routing](https://docs.expo.dev/router/introduction/)
  - Sections: Stack layouts, `useLocalSearchParams`, `router.replace` vs `push`
  - Why: `/book/address` returns its result to `/book` via params; `replace` is what stops the back button walking into a signed-out screen.
- [Expo Location — `getCurrentPositionAsync`, foreground permissions](https://docs.expo.dev/versions/latest/sdk/location/)
  - Section: Permissions (foreground only)
  - Why: the rider app must request **only** `ACCESS_COARSE_LOCATION`. `ACCESS_BACKGROUND_LOCATION` must never appear in this manifest — the architecture doc's whole reason for two apps.
- [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) / [AsyncStorage](https://react-native-async-storage.github.io/async-storage/docs/usage)
  - Why: session in SecureStore (a token); saved addresses in AsyncStorage (not a secret, and SecureStore's iOS value ceiling makes a growing list the wrong fit).
- [Testing Library — React Native queries & user events](https://callstack.github.io/react-native-testing-library/docs/api/queries)
  - Sections: `getByLabelText`, `getByRole`, `toBeAccessibilityState`, `userEvent`
  - Why: RNTL 14 is **async by default** (project memory) — `await userEvent.press(...)`, and `findBy*` where a render is awaited.
- [Google Places (New) — Autocomplete session tokens](https://developers.google.com/maps/documentation/places/web-service/session-tokens)
  - Why: the pricing model behind `address-search.policy.ts`'s resolve-cap argument. One token per address field, reused across that field's keystrokes, terminated by the resolve.

### Patterns to Follow

**Route files are one-line re-exports.** The screen lives in its slice; `src/app/**` is routing only.

```tsx
// apps/driver/src/app/login.tsx — the whole file
export { LoginScreen as default } from '@/features/auth';
```

**Every api failure is one `ApiError`.** Screens never see a `Response`, never a network error, never a raw body.

```tsx
// apps/driver/src/features/auth/login-screen.tsx:58-66
} catch (e) {
  const err = e instanceof ApiError ? e : null;
  setError(errorMessageKey(err?.code ?? 'generic'));
  if (err?.retryAfterSeconds) setCooldown(err.retryAfterSeconds);
}
```

**Error copy is keyed off the api's snake_case code, with a fallback that always exists.**

```ts
// apps/driver/src/features/i18n/error-key.ts — rider changes one string
export function errorMessageKey(code: string): MessageKey {
  const key = `rider.error.${code}`;
  return isMessageKey(key) ? key : 'rider.error.generic';
}
```

**Rate limits in the api: INCR-then-check, never GET-then-INCR, with a `Math.max(1, …)` floor on the retry.**

```ts
// services/api/src/features/geo/address-search.controller.ts:129-149
const attempts = await this.kv.incrWithTtl(key, WINDOW_SECONDS);
if (attempts <= maxPerWindow) return;
const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
this.logger.warn({ event, dispatcherId, attempts, at: new Date().toISOString() });
throw new HttpException({ message: 'too_many_requests', retryAfterSeconds } satisfies ApiErrorBody, HttpStatus.TOO_MANY_REQUESTS);
```

**Identity comes from the JWT, never from a body or a param.** `rideRequestBodySchema` omits `riderId` *by construction*, and `RidesService.request` re-parses `{ ...body, riderId }` to make that structural. The quote-preview body must be built the same way.

**Theme tokens only.** `colors.accent`, `spacing.md`, `fontSize.lg` — never a hex, never a magic number. The two documented exceptions live in `Button.tsx` (border and outline widths, logged in `ui-decisions.md`).

**Accessible name composition.** A suggestion row reads as **one** utterance, not two. Blind users consume audio at up to 3× speed; two labels where one would do is a cost (evidence §1.2).

```tsx
<Pressable
  accessibilityRole="button"
  accessibilityLabel={
    suggestion.secondaryText
      ? `${suggestion.primaryText}, ${suggestion.secondaryText}`
      : suggestion.primaryText
  }
>
```

**Focus moves on every screen transition, explicitly.** RN does not reset screen-reader focus for you (evidence §1.4). One hook, used by every screen:

```tsx
// apps/rider/src/components/use-screen-focus.ts
export function useScreenFocus(ref: RefObject<View | Text | null>): void {
  useEffect(() => {
    const handle = ref.current && findNodeHandle(ref.current);
    if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
  }, [ref]);
}
```

---

## DECISIONS (ticket-level; the epic decided the surface, not these)

**D1 — `POST /rides/quote` is added to the api, rider-only, with its own rate key.** The AC reads "upfront quote display; confirm → ride request". `POST /rides` is the only quote path today and it creates a ride, so the AC is not expressible without a preview route. It reuses `PricingService.quote()` unchanged and touches neither the idempotency reservation nor the repository. Its key is `rides:quote:rate:<riderId>` — **never** `rideRequestRateKey` — because sharing would let previewing exhaust the 20-booking quota, which is exactly the failure `dispatcherBookingRateKey`'s docblock was written to prevent.

**D2 — `GET /geo/address-search` and `POST /geo/places/:placeId/resolve` widen to `'rider'`, with rider-sized caps.** The controller docblock frames dispatcher-only as a spend control ("an open route would be a bill with a public endpoint attached"), so widening without resizing would be a regression. The existing caps are sized for one human at a console running a shift; a rider is one person booking one ride. Separate constants, separate key namespaces, selected by `user.role`.

**D3 — Saved addresses are device-local (AsyncStorage) for #16.** Decided by Linards during planning. It meets the ≤4-tap target for a returning device at ~120 lines; API-backed would need a table, a migration and a rider-facing slice, pushing #16 well past its ~1000–1500-line estimate. Cost accepted: addresses are lost on reinstall and do not follow the rider to a second device. Follow-up ticket to be created.

**D4 — `GET /rides/:rideId` (rider-owner-scoped) ships in #16, diverging from the "defer to #17" reading.** `roomsOnConnect()` never joins a ride room and `joinRideRoom()` only moves sockets that exist when it runs, so a rider whose socket reconnects is deaf to every subsequent `ride:status` with no way to recover. Without this route the "matched/queued feedback" AC is true only for a rider whose network never blips. The route returns the `rides` row with `split` forced null — `driverId` and `trackingToken` ARE on it; what is absent is driver identity (name, plate, phone), position and ETA; #17 extends it.

> **CORRECTED at review round 1 (C1).** This decision named only HALF the hole, and the implementation followed it literally into a bug that was green on every gate. `notifyRider`'s join runs inside `POST /rides`, and the status screen's socket is created *after* `book()` resolves — so the FIRST connect is outside the ride room too, not just a reconnected one, and the screen never received a single event. A REST snapshot cannot fix that: it re-reads state, it does not join a room. **The route now performs the join itself** (`RidesService.findForRider` calls `joinRideRoom` after the ownership check) and the app calls it on every `connect`, first included. Q4 below asked exactly this question and answered it wrongly; see its correction. Read D4 as: *the read is also the join.*
>
> **CORRECTED AGAIN at review round 2 (R1, R7).** "The read is also the join" makes delivery depend on a request that can fail, and the first version of it failed silently in two ways. (a) The client swallowed a failed read and only retried on the next `connect` — which never comes while the socket holds — so one failed GET left the socket up and deaf, with the screen reporting itself live. Reads are now retried with backoff, and `joined` is tracked separately from `connected` so the reconnecting banner covers *connected but never joined*. (b) The route took its snapshot BEFORE the join, so a transition inside that round trip reached neither the room nor the body. The snapshot is now taken after the join, in a second read.

**D5 — The i18n split is conditional, with a measurable trigger.** `lv.ts` is 296 lines; the rider block is ~50 keys ≈ 100–150 lines (`expected` — a plan-time key count, not a measurement). That lands at ~400–450, under the 500 cap but with little headroom, and #17 is next. **Trigger: after writing the rider keys, if `lv.ts` exceeds 460 lines, split all three catalogs into `i18n/<lang>/{common,driver,rider}.ts` with `<lang>.ts` as the assembler.** All three move together — `MessageKey` derives from `lv` and `tests/i18n.test.ts` pins placeholder parity across languages.

**D6 — The manual screen-reader pass runs on an Android emulator with TalkBack.** Decided by Linards during planning. This Mac is at the Xcode 26.3 ceiling and SDK 57 does not compile for iOS, so a VoiceOver pass is not performable here. Every assertable a11y property is an RNTL test (the real gate); the TalkBack pass covers what tests cannot. **Bonus:** `Banner.tsx`'s docblock flags its Android live-region behaviour as `expected`, never observed, and PR #139 review F47 owes a TalkBack pass — this run closes that too.

**D7 — Pickup defaults to GPS but is never required to come from GPS.** Permission denied, a timeout, or an indoor fix are all ordinary states, not errors: the pickup field falls back to the same search sheet as dropoff. A booking must be completable with location permission refused outright.

---

## UX (breadboards · states · friction audit)

### Breadboard

```
[app launch]
  └→ src/app/index.tsx (gate)
       ├ session loading → spinner, screen-reader "Loading"
       ├ signedOut       → replace → /login
       └ signedIn        → replace → /book

/login
  [phone field (+371 prefilled, tel keyboard)] → [Send code]
                                                   └→ push → /verify?phone=…&resendAfterSeconds=…

/verify
  [6-digit field, autoFocus, auto-submits on 6th digit] → replace → /book
  [Resend in Ns / Resend]

/book  ← the one booking screen
  ┌ Pickup row      [Current location: «Brīvības iela 45»]  [Change] → /book/address?field=pickup
  ├ Dropoff row     [Where to?]                              → /book/address?field=dropoff
  ├ Saved places    [Home] [Work] [«Māte»]   ← one tap fills dropoff AND fires the quote
  ├ Quote card      «€8.40»  base/distance/time breakdown    ← announced on arrival
  ├ Payment         (•) Cash  ( ) Card                       ← last choice remembered
  └ [Book]                                                   → POST /rides → replace → /book/status

/book/address?field=pickup|dropoff
  [search field, autoFocus] → [suggestion row] × N → resolve → back → /book with the field filled
  [Save this address]  → label prompt → AsyncStorage
  [Use current location]  (pickup field only)

/book/status
  ┌ status line   «Meklējam auto…» / «Auto atrasts» / «Rinda: 3.»   ← live region + announce
  └ [Cancel ride] → POST /rides/:id/cancel → replace → /book
```

### States, per screen

| Screen | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| gate | spinner + "Loading" label | — | session unreadable → treated as signedOut (store self-cleans) | n/a (local read) |
| /login | button spinner, field disabled | button disabled until phone normalises | `rider.error.<code>` under the field, live region | `rider.error.offline` |
| /verify | button spinner | button disabled | field cleared, refocused, error announced | `rider.error.offline`, code preserved? **no** — cleared, same as driver |
| /book | quote card shows a spinner row | no dropoff → Book disabled, no quote requested | quote failed → banner, Book disabled | banner "no connection", Book disabled |
| /book/address | inline spinner in the list header | <3 chars → hint, not an error; 0 results → "nothing found" row | 429 → cooldown copy with seconds; 404 on resolve → row removed + "search again" | banner, list frozen |
| /book/status | "Meklējam auto…" is itself the loading state | — | socket down → "reconnecting" line, refetch on reconnect | same |

### Friction audit

**Repeat ride from a saved address** (the ledger's ≤4 tap row):

| # | Action | Justified? |
|---|---|---|
| 0 | Open app → `/book`, pickup already filled from GPS, payment already at last choice | 0 taps |
| 1 | Tap "Home" in saved places — fills dropoff **and** fires the quote | Irreducible: the app cannot know where you are going |
| 2 | Tap "Book" | Irreducible: an accidental tap dispatches a real car to a real person |

**= 2 taps.** Target ≤4 (`docs/ux-metrics-ledger.md` Rider row 12). Headroom 2. Every other step is defaulted rather than asked. Two decisions, and neither can be removed without either guessing the destination or booking without consent.

**New destination:** tap "Where to?" (1) → type + tap a suggestion (2) → tap "Book" (3). **= 3 taps**, still under target. The quote fires on suggestion selection, not on a separate "Get price" tap — that would be a fourth.

**Rejected for costing a tap:** a separate confirm sheet after "Book" (the quote card *is* the confirmation surface); a "Get price" button (fire on selection instead); a pickup confirmation step (the row is visible and editable in place).

### Accessibility spec (the acceptance criterion, stated as properties)

Every one of these is an RNTL assertion, not a review note:

1. Every screen has exactly one `accessibilityRole="header"` element, and focus lands on it on mount (`useScreenFocus`).
2. Every interactive element has an `accessibilityLabel` from the catalog, a role, and `minHeight`/`minWidth` ≥ 44 (inherited from `Button`/`TextField`).
3. Disabled and busy states are on `accessibilityState`, not conveyed by colour alone.
4. A suggestion row reads as one utterance (`primary, secondary`), never two.
5. The quote reads as one utterance: total first, breakdown after — `«€8.40. Pamatlikme €2.00, attālums €5.40, laiks €1.00.»`
6. `AccessibilityInfo.announceForAccessibility` fires on: quote arrived, quote failed, ride requested, status changed, no-drivers timeout, and the address search's result count. **ONCE each** — corrected at review round 1 (M9): the status line was announced both by `Banner` and by a second effect on the same screen, so every iOS transition spoke twice. `Banner` is the single announcer for anything it renders. **That "once" is `observed` on iOS only** (`status-screen.test.tsx` asserts a single `announceForAccessibility`, and the RN jest preset's `Platform.OS` is `ios`). On Android the removed effect was the only `announceForAccessibility` on this line, and what remains is `Banner`'s `accessibilityLiveRegion` — which `Banner`'s own docblock labels `expected`, not observed, and warns may fire for a content change but not a freshly mounted view. If the TalkBack pass finds the status line silent, the fix is an Android-side announce **in `Banner`**, not a second one on the screen.
7. The status line is an `accessibilityLiveRegion="polite"` container **and** announces on iOS — the exact `Banner` split, reused rather than reinvented.
8. Payment chips are `accessibilityRole="radio"` with `accessibilityState={{ checked }}`.
9. No information is available only through the (absent) map. There is no map.
10. Labels are audio-lean: no "button" suffix (the role says it), no hint that repeats the label.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts (`packages/shared`)

**Independent of:** Phase 3. Different package, no shared file.

The quote-preview wire shapes and the rider message catalog. Both are prerequisites for Phase 2 (api) and Phase 4/5 (app), and neither depends on anything else.

**Tasks:**

- Add `rideQuoteBodySchema` and `rideQuotePreviewSchema` to `schemas/ride.ts`.
- Add the `rider.*` key block to `i18n/{lv,ru,en}.ts` — screens, statuses, and one `rider.error.<code>` per api code this app can actually receive.
- Measure `lv.ts`; split per D5 if it clears 460 lines.
- Extend `tests/schemas.test.ts` and confirm `tests/i18n.test.ts` still passes on placeholder parity.

### Phase 2: API (`services/api`)

**Depends on:** Phase 1 (the quote schemas).
**Independent of:** Phase 3.

Three additions, no changes to existing behaviour.

**Tasks:**

- `POST /rides/quote` on `RidesController` (already class-level `@Roles('rider')`) → `RidesService.previewQuote()` → `PricingService.quote()`, with its own rate key and cap.
- `GET /rides/:rideId` — rider-owner-scoped read; 404 (not 403) for a ride belonging to someone else, so the route is not an existence oracle.
- Widen the two geo routes to `'rider'` with rider-sized caps and separate key namespaces.
- Integration specs for all three, including the negative cases.

### Phase 3: App tooling (`apps/rider`)

**Independent of:** Phases 1 and 2. Different package entirely — this is the parallelisable phase.

Turn the Expo template into a real workspace member. **This phase is where the app first gains `lint` and `test` scripts; without them turbo reports green on an untested app.**

**Tasks:**

- Rewrite `package.json` from `apps/driver`'s: deps, the `jest` block, `main: "expo-router/entry"`, `lint`/`test` scripts, TS pinned at `~5.9.3`.
- `tsconfig.json` paths/types; `eslint.config.mjs` with the restated `max-lines`; `.prettierrc`; `jest.setup.ts` including the warm-up block.
- `app.json`: bundle id `lv.saktacab.rider`, package `lv.saktacab.rider`, scheme `saktacabrider`, plugins, `locales`. **Foreground location permissions only.**
- Delete `App.tsx` and `index.ts`.
- `src/config.ts` + test; `src/components/*` + tests; `use-screen-focus` + test.

### Phase 4: App — i18n and auth

**Depends on:** Phase 1 (catalog keys) and Phase 3 (tooling, components).

**Tasks:**

- `features/i18n` — three files copied, one prefix changed, plus tests.
- `features/auth` — api client, session store, session provider, phone normalise, login and verify screens, route files.
- `src/app/_layout.tsx` with `SessionProvider`; `src/app/index.tsx` as the gate.

### Phase 5: App — places, booking, status

**Depends on:** Phase 2 (all three routes) and Phase 4 (session + api client).

The feature itself.

**Tasks:**

- `features/places` — saved-places store, the search sheet, the address row, session-token discipline.
- `features/booking` — draft state, quote hook, quote card, payment chips, booking screen, the `Idempotency-Key` rule.
- `features/ride-status` — rider socket, `ride:status` subscription, refetch-on-reconnect, status screen.

### Phase 6: Accessibility suite, docs, validation

**Depends on:** Phase 5.

**Tasks:**

- The a11y assertions across every screen test (they are written *with* each screen, not bolted on here — this phase is the sweep that proves none was missed).
- `docs/runbooks/rider-a11y-walkthrough.md`.
- Update `docs/ux-metrics-ledger.md` Rider rows 12 and 13 with the measured tap count and the audit result.
- `.env.example` if any new variable appears (none expected).
- The full gate.

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

### Phase 1 — contracts

### UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**: Two schemas, placed immediately after `rideRequestBodySchema` so the relationship is visible.
  - `rideQuoteBodySchema` — `rideRequestBodySchema.pick({ pickup: true, stops: true, destination: true, category: true, options: true })`. `.pick()` keeps it a plain `ZodObject` (the same reason `rideRequestBodySchema` uses `.omit()`/`.extend()`), so it carries its defaults and the server can re-parse. **No `paymentMethod`** — the fare does not depend on it (evidence §7: cash and card show one identical price, and diverging prices are what creates distrust). **No `scheduledFor`, no `vehicleCount`, no `offeredPriceCents`** — none affects an `upfront_fixed` quote and each would be a lie about what the preview covers.
  - `rideQuotePreviewSchema` — `z.object({ quote: fareQuoteSchema })`. **Deliberately no `split`**, unlike `rideCreatedSchema`: the commission split is the *driver's* transparency card (S2-5), and putting the platform's cut on a rider-facing preview response publishes it to a surface that has no reason to hold it.
- **PATTERN**: `packages/shared/src/schemas/ride.ts:96-120` (`rideRequestBodySchema`'s docblock explains exactly why `.pick()`/`.omit()` must not become `.refine()`).
- **IMPORTS**: nothing new — `fareQuoteSchema` and `rideRequestBodySchema` are both in this file.
- **GOTCHA**: Do **not** reuse `rideRequestBodySchema` wholesale for the quote body. It requires `paymentMethod`, which would force the app to make a payment decision before it has seen a price — inverting the flow the AC describes.
- **GOTCHA — write this coupling into a comment on the `.pick()`.** The preview path calls `PricingService.quote()` directly and therefore skips `RidesService.request`'s guards. `vehicleCount` defaults to 1 today so `multi_taxi_not_supported` is unreachable on a preview — but if `rideQuoteBodySchema` ever gains `vehicleCount` (or `scheduledFor`), the preview would happily price an order the booking path refuses, and the rider would see a quote for a ride they cannot book. Name that in the docblock so the next field added here fails review instead of shipping.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #1 (upfront quote display)

### UPDATE `packages/shared/tests/schemas.test.ts`

- **IMPLEMENT**: Three cases for the new schemas — a valid quote body parses with defaults applied (`stops: []`, `category: 'standard'`); a body carrying `paymentMethod` has it stripped, not rejected (`.pick()` is non-strict — assert the observed behaviour, do not assume it); a preview response with a `split` field parses and drops it.
- **PATTERN**: the existing `rideRequestBodySchema` cases in the same file.
- **GOTCHA**: `tests/schemas.test.ts` was split at #80 for the ~500-line rule. Test files are **exempt** from `max-lines` (#112), but check whether the rider cases belong in the existing split file or a new one before appending blindly.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #1

### UPDATE `packages/shared/src/i18n/lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: The `rider.*` block, LV first (it is the reference dictionary and `MessageKey` derives from it), then RU and EN with **exactly** the same keys.
  - `rider.login.{title,phone_label,send_code}`
  - `rider.verify.{title,hint,code_label,resend,resend_in}` — `hint` and `resend_in` take placeholders; mirror the driver spellings exactly.
  - `rider.book.{title,pickup_label,dropoff_label,use_current_location,change,where_to,saved_header,save_address,save_prompt,searching,no_results,min_chars,quote_total,quote_breakdown,payment_label,payment_cash,payment_card,confirm,confirming}`
  - `rider.status.{searching,still_searching,matched,queued,cancelled,cancel}` — `queued` and `still_searching` take placeholders.
  - `rider.a11y.{quote_arrived,quote_failed,ride_requested}` — the announce strings. ~~`status_changed`~~ was removed at review round 1 (M9): `Banner` announces the status line itself, and a second labelled announce made iOS speak every change twice.
  - `rider.error.<code>` for every code this app can receive: `too_many_requests`, `idempotent_request_in_progress`, `scheduled_in_past`, `multi_taxi_not_supported`, `place_not_found`, `invalid_or_expired_code`, `resend_too_soon`, `sms_delivery_failed`, `session_expired`, `invalid_field`, `offline`, `generic`. Enumerated from api source, not discovered at runtime — a missing key renders `rider.error.generic`, which hides the real cause.
- **PATTERN**: `packages/shared/src/i18n/lv.ts`, the `driver.error.*` block — same fallback contract, same comment.
- **GOTCHA**: The three files must move together and carry identical placeholder sets. `tests/i18n.test.ts` pins placeholder parity across languages and will fail loudly if `{seconds}` appears in LV and not in RU.
- **VALIDATE**: `pnpm --filter @taxi/shared test && pnpm --filter @taxi/shared lint`
- **SATISFIES**: AC #2 (i18n LV/RU/EN)

### MEASURE then conditionally REFACTOR `packages/shared/src/i18n/*`

- **IMPLEMENT**: `wc -l packages/shared/src/i18n/lv.ts`. If > 460, split all three into `i18n/<lang>/{common,driver,rider}.ts` with `i18n/<lang>.ts` reduced to an assembler (`export const lv = { ...common, ...driver, ...rider } as const`). If ≤ 460, do nothing and record the measured number in the execution report.
- **PATTERN**: `packages/shared/src/i18n.ts`'s own docblock — it describes exactly this split happening once already, and why.
- **GOTCHA**: `MessageKey` is `keyof typeof lv`. A spread assembler preserves it; a `Record<string, string>` annotation anywhere in the chain destroys it and every `t('…')` call site widens to `string`.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint && pnpm --filter @taxi/shared test`
- **SATISFIES**: D5

---

### Phase 2 — api

### UPDATE `services/api/src/features/rides/rides.policy.ts`

- **IMPLEMENT**: The quote-preview cap and its key, with the derivation written out in the docblock in the style the file already uses.

  ```
  RIDE_QUOTE_MAX_PER_WINDOW = 30            // per RIDE_REQUEST_WINDOW_SECONDS (600 s)
  rideQuoteRateKey = (riderId) => `rides:quote:rate:${riderId}`
  ```

  **`derived`, with the condition it assumes:** a booking produces 1 preview when the dropoff is chosen, plus 1 per re-edit; a rider who re-edits twice = 3 previews per attempt. A rider comparing destinations across a 10-minute window at 5 attempts = 3 × 5 = **15 previews** — the honest worst case. **30 is 2× that.** Assumes the "a real rider re-quotes a handful of times at most" model `RIDE_REQUEST_MAX_PER_WINDOW`'s docblock already states; that model is itself a guess with no traffic behind it, and carries the same "tune against the first Google bill" trigger as `COORD_PRECISION`.

- **PATTERN**: `services/api/src/features/rides/rides.policy.ts:36-60` (`DISPATCHER_BOOKING_MAX_PER_WINDOW`'s derivation block — match its shape and its honesty about being a guess).
- **GOTCHA**: A **separate key**, not `rideRequestRateKey`. Sharing means a rider who previews 20 times can no longer book — the precise failure `dispatcherBookingRateKey` exists to prevent, stated in its own docblock.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, budget guardrail

### UPDATE `services/api/src/features/rides/rides.service.ts`

- **IMPLEMENT**: `previewQuote(riderId: string, body: RideQuoteBody): Promise<RideQuotePreview>`.
  - Rate-limit on `rideQuoteRateKey(riderId)` **before** the pricing call — the cap exists to bound paid Routes calls, so a throttled request must cost nothing.
  - Build a `RideRequest`-shaped object for `PricingService.quote()`: the schema requires `riderId` and `paymentMethod`, which the quote body does not carry. Pass `riderId` from the JWT and a **fixed** `paymentMethod: 'cash'` — `UpfrontFixedStrategy` does not read it, and evidence §7 says cash and card must show one identical price. Add a comment saying exactly that, so a future strategy that *does* read it fails review rather than silently pricing previews as cash.
  - Return `{ quote }` only — discard the split (see the `rideQuotePreviewSchema` rationale).
  - Log `ride.quote.previewed` with `totalCents` and `category`. **No coordinates, no address** (`logging-standard.md`).
  - **No idempotency reservation, no repository write, no realtime emit.** A preview creates nothing.
- **IMPLEMENT**: `findForRider(riderId: string, rideId: string): Promise<Ride>` — reads the ride, and throws `NotFoundException` when it does not exist **or** belongs to another rider. One shape for both, so the route cannot be used to test whether a ride id exists.
- **PATTERN**: `rides.service.ts:230-270` (`assertWithinRateLimit` — reuse it if the signature allows a key/cap pair; extract rather than duplicate if it does not).
- **IMPORTS**: `rideQuoteBodySchema`, `rideRequestSchema`, types from `@taxi/shared`; `RIDE_QUOTE_MAX_PER_WINDOW`, `rideQuoteRateKey` from `./rides.policy`.
- **GOTCHA — do NOT refactor `assertWithinRateLimit`.** It takes `(subjectId, bookingChannel)` and picks key **and** cap from the channel together, which is load-bearing: `DISPATCHER_BOOKING_MAX_PER_WINDOW`'s whole derivation (30 + 25 = 55; 60 clears it with ~9% headroom) assumes the pair moves as one. Widening it to `(key, maxPerWindow, …)` makes it possible for a later caller to pair the dispatcher key with the rider cap, and it re-derives two **live money caps** inside a rider-app ticket. Give `previewQuote` a **private throttle helper** instead, mirroring `address-search.controller.ts`'s version — same INCR-then-check, same `Math.max(1, …)` floor, same `ApiErrorBody` 429 shape. Ten duplicated lines beat touching the booking caps.
- **GOTCHA**: Adding a third `bookingChannel` value for the preview would be the same mistake by another door — a preview is not a booking channel.
- **VALIDATE**: `pnpm --filter @taxi/api test -- rides.service.spec`
- **SATISFIES**: AC #1, AC #4 (quote failure communicated)

### UPDATE `services/api/src/features/rides/rides.repository.ts`

- **IMPLEMENT**: Check `findWithQuote(rideId)` first — the replay path already uses it and it may be exactly what `findForRider` needs. If it returns the ride, reuse it and filter by `riderId` in the service. Only add a repository method if a rider-scoped `WHERE` genuinely belongs at the query level.
- **PATTERN**: `rides.repository.ts`, existing read methods.
- **GOTCHA**: Do not add an index for this read. It is `WHERE id = $1` on the primary key with an ownership check in the service; the DB-schema checklist's "one index per known hot read path" is already satisfied by the PK.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3 (matched/queued feedback survives reconnect)

### UPDATE `services/api/src/features/rides/rides.controller.ts`

- **IMPLEMENT**: Two routes on the existing class (already `@Roles('rider')`, so both inherit rider-only).

  ```ts
  @Post('quote')
  quote(
    @CurrentUser() user: JwtClaims,
    @Body(new ZodValidationPipe(rideQuoteBodySchema)) body: RideQuoteBody,
  ): Promise<RideQuotePreview> {
    return this.rides.previewQuote(user.sub, body);
  }

  @Get(':rideId')
  read(
    @CurrentUser() user: JwtClaims,
    @Param('rideId', ParseUUIDPipe) rideId: string,
  ): Promise<Ride> {
    return this.rides.findForRider(user.sub, rideId);
  }
  ```

- **PATTERN**: the existing `create` route in the same file; `ride-lifecycle.controller.ts` for `ParseUUIDPipe` on a `:rideId` param.
- **GOTCHA — route ordering.** `@Post('quote')` and `@Get(':rideId')` are different verbs so they cannot collide, but **`@Get(':rideId')` must be declared after any other `@Get` on a literal path** in this controller, or Nest matches the literal as a uuid param. There is none today; keep it that way or reorder.
- **VERIFIED (planning, at `a6481aa`)** — the class-level `@Roles('rider')` is correct here and this route does **not** belong on `RideLifecycleController`. That controller exists because a rider-only class role would lock drivers out of the ride they are driving; no such actor exists for this read. `git grep "Get(':rideId')\|Get(':id')"` over `services/api/src` returns nothing, and the dispatcher's ride reads already come from `GET /dispatch/board`'s full frames and `callerLookup`'s `recentRides`. If #17 or #19 later needs a non-rider single-ride read, **that** is when the route moves and gains per-route `@Roles`.
- **GOTCHA**: The class docblock currently says "There is deliberately NO `:id` route here — ride reads belong to #11/#16". **Update that comment** — #16 is now adding it, and leaving the sentence makes the file lie about itself. State the reconnect reason (D4) and that it returns the ride only.
- **VALIDATE**: `pnpm --filter @taxi/api test -- rides`
- **SATISFIES**: AC #1, AC #3

### UPDATE `services/api/src/features/geo/address-search.policy.ts`

- **IMPLEMENT**: Rider caps and keys, alongside the dispatcher ones.

  ```
  RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW  = 30   // per ADDRESS_SEARCH_WINDOW_SECONDS (60 s)
  RIDER_ADDRESS_RESOLVE_MAX_PER_WINDOW = 10
  riderAddressSearchRateKey  = (riderId) => `geo:search:rate:rider:${riderId}`
  riderAddressResolveRateKey = (riderId) => `geo:resolve:rate:rider:${riderId}`
  ```

  **`derived` from the same debounce model this file already carries** (~5 requests per address field at a 300 ms debounce — `expected`, unmeasured, plan Q5's figure):
  - A rider books one ride at a time. Pickup is GPS-defaulted or a saved place (0 searches typically); dropoff is typed → **~5 searches per booking attempt**.
  - A rider who re-edits the dropoff twice in the same minute: 3 × 5 = **15 searches/min** — the honest worst case.
  - **30 is 2× that.** A client with a broken debounce (~10 req/s ≈ 600/min) is cut at 30 — **4× tighter than the dispatcher's 120**, which is the point: a rider is one person booking one ride, not a console operator running a shift.
  - Resolve: one per completed field, so the same worst case gives **3 resolves/min**. **10 is ~3× that** — sized generously for the reason this file's own resolve docblock gives: a resolve *terminates* the billed Places session, and refusing one converts a $5.00/1,000 completion into 5 × $2.83 = **$14.15/1,000** individual autocomplete requests. Throttling a resolve costs money rather than saving it.
  - Same "tune against the first Google bill" trigger as every other cap here.
- **PATTERN**: this file's existing two blocks — match the derivation style exactly, including naming what each figure assumes.
- **GOTCHA**: Separate key namespaces (`…:rider:<id>`), not shared with the dispatcher keys. One person can hold both roles in a small operator — the reason `dispatcherBookingRateKey` exists as its own key.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, budget guardrail

### UPDATE `services/api/src/features/geo/address-search.controller.ts`

- **IMPLEMENT**: Add `'rider'` to both routes' `@Roles`, and pick the cap and key from `user.role`:

  ```ts
  const isRider = user.role === 'rider';
  await this.assertWithinRateLimit(
    isRider ? riderAddressSearchRateKey(user.sub) : addressSearchRateKey(user.sub),
    isRider ? RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW : ADDRESS_SEARCH_MAX_PER_WINDOW,
    'geo.search.throttled',
    user.sub,
  );
  ```

- **IMPLEMENT**: Rename the log field `dispatcherId` → `actorId` and add `role`, in both `assertWithinRateLimit` and the throttle warn. A line that says `dispatcherId` for a rider is a false log, and the whole point of the field is naming the actor that was actually throttled.
- **PATTERN**: `rides.service.ts:250-265` — where the same "name the actor that was actually throttled" reasoning is already written out for the booking cap.
- **GOTCHA**: Leave the min-chars short-circuit **before** the rate limit, exactly where it is. Its comment explains why: a request that cannot spend must not consume the quota that exists to bound spend. A rider typing "Br" is the common case.
- **GOTCHA**: The class docblock says "Dispatcher/admin only, per ROUTE — … an open route would be a bill with a public endpoint attached." **Rewrite it.** Say that riders are now admitted with their own cap, name the cap constants, and keep the spend argument — it is still the reason the caps exist, and deleting it loses the *why*.
- **GOTCHA**: Do not widen `GET /customers/lookup` or `GET /customers/venues`. Those return other people's PII and stay dispatcher/admin.
- **VALIDATE**: `pnpm --filter @taxi/api test -- address-search`
- **SATISFIES**: AC #1 (dropoff entry with suggestions)

### UPDATE `services/api/src/features/geo/address-search.controller.spec.ts`

- **IMPLEMENT**: expected / edge / failure for the rider path.
  - expected: a rider's search returns suggestions and spends against `geo:search:rate:rider:<id>`.
  - edge: a rider at `RIDER_ADDRESS_SEARCH_MAX_PER_WINDOW` gets a 429 with `retryAfterSeconds ≥ 1`, while a **dispatcher** at the same moment is unaffected (proves the namespaces are separate).
  - failure: a **driver** still gets 403 on both routes.
- **PATTERN**: the existing dispatcher cases in the same file.
- **VALIDATE**: `pnpm --filter @taxi/api test -- address-search`
- **SATISFIES**: AC #1

### UPDATE `services/api/src/features/rides/rides.integration.spec.ts`

- **IMPLEMENT**: expected / edge / failure for both new routes.
  - expected: `POST /rides/quote` returns a `fareQuoteSchema`-valid quote and **creates no ride** — assert the rides table count is unchanged.
  - edge — **the cache claim, pinned (closes R3)**: preview a route, then `POST /rides` with the same pickup/destination, and assert `maps.routeCalls === 1` across both requests. This is the one place the "one paid call, not two" figure becomes `observed` rather than `derived`. **Not optional and not conditional** — the counter already exists.
  - edge: previewing `RIDE_QUOTE_MAX_PER_WINDOW` times then booking still succeeds — the quote cap does not consume the booking quota.
  - failure: a driver JWT gets 403 on `POST /rides/quote`; rider B gets **404** (not 403) on rider A's ride.
  - expected: `GET /rides/:rideId` returns the rider's own ride with its quote.
- **PATTERN**: `rides.integration.spec.ts`'s existing idempotency cases; `services/api/test/harness.ts` for the fakes.
- **VERIFIED (planning, at `a6481aa`)** — `CountingMapsProvider` in `services/api/test/harness.ts:289-311` already exposes `routeCalls` and a `routed[]` log, and `createTestApp` overrides **`MAPS_PROVIDER_SOURCE`, not `MAPS_PROVIDER`**, so the real `CachingMapsProvider` stays in the graph and wraps it. Its own docblock says this is "the only arrangement where 'cache hit on a repeated route' means anything". Nothing needs adding — read `harness.ts:283-311` and use `maps.routeCalls`.
- **GOTCHA**: `CachingMapsProvider` sits **above** the counter, so route coordinates repeated by an earlier case in the same file are already cached and will not increment. Use coordinates no earlier test in the file has routed, or the assertion passes for the wrong reason. The same warning is written on `failNext()`.
- **GOTCHA**: Integration runs are mutually destructive across sessions — global-setup drops the shared test DB. One gate at a time (root `CLAUDE.md`).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- rides.integration`
- **SATISFIES**: AC #1, AC #3, AC #5 (invalid request rejected)

---

### Phase 3 — app tooling

### UPDATE `apps/rider/package.json`

- **IMPLEMENT**: Replace wholesale, modelled on `apps/driver/package.json`, **minus** what the rider must not have.
  - `main: "expo-router/entry"`.
  - deps: `@taxi/shared`, `expo ~57.0.18`, `expo-constants`, `expo-linking`, `expo-localization`, `expo-location`, `expo-router`, `expo-secure-store`, `expo-status-bar`, `react 19.2.3`, `react-native 0.86.3`, `react-native-safe-area-context`, `react-native-screens`, `socket.io-client`, `@react-native-async-storage/async-storage`.
  - **omit**: `expo-task-manager`, `expo-sqlite`, `expo-notifications`, `expo-keep-awake`, `expo-intent-launcher`, `expo-dev-client`. Every one is driver-only, and `expo-task-manager` in particular is what pulls background-location capability into a manifest.
  - devDeps and the whole `jest` block: copy verbatim, including `testTimeout: 20000`, `moduleNameMapper` for `@/`, and `transformIgnorePatterns`.
  - scripts: `start`, `android`, `ios`, `dev`, `typecheck`, **`lint`, `test`**.
  - `expo.install.exclude: ["typescript"]`.
- **GOTCHA — the one that will bite (R1).** The template currently pins `typescript: ~6.0.3`. **Change it to `~5.9.3`.** TS 6 splits typescript-eslint's peer instances (two TypeScripts, one checker) and `@taxi/shared`'s type-aware lint goes red in files this ticket never touches. `expo.install.exclude: ["typescript"]` is what stops `expo install --check` putting it back. The rest of the workspace sits on 5.x (`shared ^5.7.0`, `api ^5.7.3`, `dispatch ^5`, `db ^5.7.0`, `driver ~5.9.3` — observed at `a6481aa`), so a 6.x here is the only second major in the tree.
- **GOTCHA (R2)**: Without the `lint` and `test` scripts, `pnpm turbo run … lint test …` **silently skips this package** — turbo omits a package that has no such script rather than failing. The gate then reports green on an app with zero tests, which is worse than red.
- **VALIDATE — three commands, and each one fails if its risk is live:**
  ```bash
  pnpm install
  pnpm --filter @taxi/rider exec tsc --version          # R1: must print 5.9.x, not 6.x
  pnpm --filter @taxi/shared lint                       # R1: the symptom — red here means TS 6 is back
  pnpm turbo run lint test --filter=@taxi/rider         # R2: output must NAME @taxi/rider:lint and @taxi/rider:test
  ```
  For R2, "2 successful, 2 total" is the pass; "no tasks were executed" means the scripts are missing and the gate is blind to this app.
- **SATISFIES**: AC #6, AC #11, closes R1 and R2 (`pnpm check` green)

### CREATE `apps/rider/eslint.config.mjs`, `.prettierrc`, `expo-types.d.ts`; UPDATE `apps/rider/tsconfig.json`

- **IMPLEMENT**: Copy from `apps/driver`. The eslint config keeps the restated `max-lines: 500` block **with its comment** (this app also extends `eslint-config-expo` rather than `@taxi/config/eslint/base.mjs`) and the test/scripts override. Keep the `no-console` rule but narrow the justification comment to the rider app's own reality — it has no sqlite queue and no push registration, so if nothing needs `warn`/`error`, set it to plain `'error'` and say so.
- **PATTERN**: `apps/driver/eslint.config.mjs`, `apps/driver/tsconfig.json`.
- **VALIDATE**: `pnpm --filter @taxi/rider lint`
- **SATISFIES**: AC #6

### CREATE `apps/rider/jest.setup.ts`

- **IMPLEMENT**: The driver's setup, minus the fakes for modules this app does not install (`expo-sqlite`, `expo-task-manager`, `expo-notifications`, `expo-keep-awake`, `expo-intent-launcher`), plus `expo-location` narrowed to the foreground API (`requestForegroundPermissionsAsync`, `getCurrentPositionAsync`) and a fake for `@react-native-async-storage/async-storage` backed by a `Map`.
- **IMPLEMENT**: Keep `expo-secure-store`, `expo-localization`, `expo-constants`, the `mockRouter` singleton, and — critically — **the warm-up block at the bottom, unchanged.** Add `AccessibilityInfo` to its list of touched getters, since every screen test in this app renders through it.
- **PATTERN**: `apps/driver/jest.setup.ts`.
- **GOTCHA**: The warm-up block's comment cites two real CI runs (33402386433, 33407278413) that blew a 5 s and then a 20 s `testTimeout` because jest-expo transforms `react-native`'s lazy component modules inside the first `render()`. A setup file has no timeout. Do not "clean it up".
- **GOTCHA**: `mockRouter` must be one object per test file, or a test cannot read back the spy it asserted on.
- **VALIDATE**: `pnpm --filter @taxi/rider test`
- **SATISFIES**: AC #6

### UPDATE `apps/rider/app.json`; CREATE `apps/rider/locales/{lv,ru,en}.json`; DELETE `App.tsx`, `index.ts`

- **IMPLEMENT**: `name: "Sakta Cab"`, `slug: "sakta-cab-rider"`, `ios.bundleIdentifier: "lv.saktacab.rider"`, `android.package: "lv.saktacab.rider"`, `scheme: "saktacabrider"`, plugins `["expo-router", "expo-location", "expo-secure-store", "expo-localization", "expo-status-bar"]`, `locales` pointing at the three JSON files.
- **IMPLEMENT**: `android.permissions: ["ACCESS_COARSE_LOCATION"]` **plus `android.blockedPermissions: ["android.permission.ACCESS_FINE_LOCATION"]`**. `ios.infoPlist.NSLocationWhenInUseUsageDescription` only. **Corrected at review round 1 (L5)**: `ACCESS_FINE_LOCATION` was declared alongside it and is a wider ask than the design states — pickup defaults from **coarse** GPS and the code asks for `Accuracy.Balanced` (~100 m), which coarse satisfies. **Corrected AGAIN at review round 2 (R6): removing it from `permissions` does not remove it from the build.** `expo-location`'s config plugin adds `ACCESS_FINE_LOCATION` unconditionally (`plugin/src/withLocation.ts`) and the library's own `android/src/main/AndroidManifest.xml` declares it, which manifest-merges into the APK regardless. Only `blockedPermissions` defeats both, by emitting `tools:node="remove"`. `observed` 2026-09-04: `npx expo config --type public` lists FINE under `permissions` **and** under `blockedPermissions`, and `npx expo prebuild --platform android` writes `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" tools:node="remove"/>` into `android/app/src/main/AndroidManifest.xml` — the merge directive that deletes the library's declaration. The same generated manifest is `observed` clean of `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE*` and `RECEIVE_BOOT_COMPLETED` (AC #9). The final MERGED manifest is AGP's output and needs a Gradle build to read, which no machine here has — so that last step is `expected`, on documented `tools:node` behaviour.
- **IMPLEMENT**: The locale JSONs carry `NSLocationWhenInUseUsageDescription` in LV/RU/EN — "Sakta Cab izmanto jūsu atrašanās vietu, lai ieteiktu iekāpšanas vietu." or equivalent.
- **GOTCHA — the architecture-level rule.** `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE*`, `RECEIVE_BOOT_COMPLETED` and `expo-location`'s `isIosBackgroundLocationEnabled` **must never appear in this app**. The architecture doc's justification for two apps is that permissions are declared per app at build time and Play policy reviews the driver's background location against the rider majority. Adding one here retroactively invalidates that decision.
- **GOTCHA**: Deleting `index.ts` before `main` points at `expo-router/entry` leaves the app with no entry point — do the `package.json` change first (it is the task above).
- **VALIDATE**: `pnpm --filter @taxi/rider typecheck && npx expo config --type public --project-root apps/rider > /dev/null`
- **SATISFIES**: AC #6, architecture inheritance

### CREATE `apps/rider/src/config.ts` + `config.test.ts`

- **IMPLEMENT**: Copy `apps/driver/src/config.ts` verbatim, including the docblock explaining why a release build **throws** instead of falling back to localhost.
- **PATTERN**: `apps/driver/src/config.ts`, `apps/driver/src/config.test.ts`.
- **GOTCHA**: `EXPO_PUBLIC_API_URL` is inlined by Metro at bundle time and is deliberately **not** a turbo `globalEnv` — no turbo task reads it, because Expo apps have no `build` task here. Do not add it to `turbo.json`; that would be cargo-culting the `NEXT_PUBLIC_API_URL` entry, which exists because the dispatch app *does* have a cached build.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- config`
- **SATISFIES**: AC #6

### CREATE `apps/rider/src/components/{Screen,Button,TextField,Banner}.tsx` + `index.ts` + three tests

- **IMPLEMENT**: Copy all four from `apps/driver/src/components/` unchanged, with their docblocks. They already carry the 44 px floor, the visible focus outline, the label-as-accessible-name rule and Banner's platform split.
- **IMPLEMENT**: Copy `Button.test.tsx`, `TextField.test.tsx`, `Banner.test.tsx` too.
- **PATTERN**: the driver files, exactly.
- **GOTCHA**: These are duplicated, not extracted into a shared package. That is deliberate and matches how the driver app got them: `packages/shared` is the **contract** seam (zod, enums, state machine, theme values) and must stay isomorphic — `packages/shared/tsconfig.json` runs a src-only program with `types: []` (#56), so a React Native component cannot live there. If duplication becomes painful at a third app, that is a separate ticket.
- **GOTCHA**: `Banner`'s docblock states its Android live-region behaviour is `expected`, never observed, and that PR #139 review F47 owes a TalkBack pass. **Keep that paragraph** and update it in Phase 6 if the TalkBack run settles it.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- components`
- **SATISFIES**: AC #2 (accessibility), AC #6

### CREATE `apps/rider/src/components/use-screen-focus.ts` + `use-screen-focus.test.tsx`

- **IMPLEMENT**: The hook from Patterns above — `findNodeHandle(ref.current)` then `AccessibilityInfo.setAccessibilityFocus(handle)` in a mount effect.
- **IMPLEMENT**: Test: render a component using it, assert `AccessibilityInfo.setAccessibilityFocus` was called once with the header's node handle; assert it does **not** throw when the ref is null (an unmounted or conditionally-rendered header).
- **PATTERN**: no existing precedent — the driver app has no focus management. This hook is new, and it is the mechanism behind evidence §1.4's finding that "RN does not reset focus to the first element on new screens — must be managed manually".
- **IMPORTS**: `AccessibilityInfo`, `findNodeHandle` from `react-native`; `useEffect` from `react`.
- **GOTCHA**: `setAccessibilityFocus` takes a **node handle number**, not a ref and not a component. `findNodeHandle` returns `number | null` — guard it.
- **GOTCHA**: Under jest, `findNodeHandle` may return null for host components in some renderer configurations. If it does, spy on `AccessibilityInfo.setAccessibilityFocus` and assert it was *called*, then verify the real behaviour in the TalkBack pass rather than asserting on a handle value the test environment invents.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-screen-focus`
- **SATISFIES**: AC #2 (explicit focus management on every screen transition)

---

### Phase 4 — app: i18n and auth

### CREATE `apps/rider/src/features/i18n/{device-language,use-t,error-key,index}.ts` + tests

- **IMPLEMENT**: `device-language.ts` and `use-t.ts` copied verbatim (`tNow()` can be dropped — the rider app has no code running outside React). `error-key.ts` with `rider.error.` as the prefix and `'rider.error.generic'` as the fallback.
- **PATTERN**: `apps/driver/src/features/i18n/*`.
- **IMPLEMENT**: `error-key.test.ts` — a known code maps to its key; an unknown code falls back to generic; a prototype-chain name (`'toString'`) also falls back (the reason `isMessageKey` uses `Object.hasOwn`).
- **VALIDATE**: `pnpm --filter @taxi/rider test -- i18n`
- **SATISFIES**: AC #2

### CREATE `apps/rider/src/features/auth/{api-client,session-store,phone-normalise}.ts` + tests

- **IMPLEMENT**: `api-client.ts` copied verbatim. `session-store.ts` copied with `SESSION_KEY = 'sakta.rider.session'`. `phone-normalise.ts` copied verbatim.
- **PATTERN**: `apps/driver/src/features/auth/*` and their colocated tests.
- **GOTCHA**: The api client's timer must keep running until the **body** is read, not just until headers arrive — a stalled body must read as `offline`, not hang. That is why `clearTimeout` sits in a `finally` after `res.json()`, and why `controller.signal.aborted` is re-checked after. Copy the control flow exactly.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- auth`
- **SATISFIES**: AC #6

### CREATE `apps/rider/src/features/auth/use-session.tsx` + `use-session.test.tsx`

- **IMPLEMENT**: Copy the driver provider. Keep the module-level `live` object and its docblock (react-hooks rules forbid ref reads in render-created closures; the provider is a singleton). Keep single-flight `signOut` and `onBeforeSignOut` — the rider's socket registers a hook to disconnect before the token dies.
- **PATTERN**: `apps/driver/src/features/auth/use-session.tsx`.
- **GOTCHA**: The `api` prop override exists so tests inject a fake client. Keep it.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-session`
- **SATISFIES**: AC #6

### CREATE `apps/rider/src/features/auth/{login-screen,verify-screen}.tsx` + tests; CREATE `src/app/{login,verify}.tsx`

- **IMPLEMENT**: Both screens copied from the driver, with three changes: `role: 'rider'` in the OTP request body, `rider.*` catalog keys, and `useScreenFocus` on the title.
- **IMPLEMENT**: Tests — expected: a valid phone enables the button and pushes to `/verify` with the params; edge: a 429 sets a countdown from `retryAfterSeconds` and disables the button; failure: a bad code clears the field, shows the error, and refocuses the input. Plus an a11y case per screen: the title has `accessibilityRole="header"` and `setAccessibilityFocus` was called on mount.
- **PATTERN**: `apps/driver/src/features/auth/{login-screen,verify-screen}.test.tsx`.
- **GOTCHA**: `SIGNUP_ROLES` is `['rider', 'driver']` and the api's rule is "role is used ONLY when the phone has no user yet; an existing user's stored role wins". So a driver's phone signing into the rider app gets a **driver** session. That is correct api behaviour, and this app must not fight it — but the gate (next task) should route a non-rider role somewhere honest rather than into the booking screen. Simplest correct handling: show `rider.error.generic` and sign out. Log it as **Q2** if a nicer message is wanted.
- **GOTCHA**: RNTL 14 is async by default — `await userEvent.press(...)`, `await screen.findByLabelText(...)`.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- auth`
- **SATISFIES**: AC #1 (auth shell), AC #2

### CREATE `apps/rider/src/app/_layout.tsx` and `src/app/index.tsx`

- **IMPLEMENT**: `_layout.tsx` wraps `<Stack screenOptions={{ headerShown: false }} />` in `SessionProvider` and the saved-places provider (added in Phase 5). No side-effect import at the top — the rider app has no headless task, so the driver's first-line `import '@/features/location/location-task'` has no counterpart.
- **IMPLEMENT**: `index.tsx` is the gate: `loading` → a labelled spinner; `signedOut` → `<Redirect href="/login" />`; `signedIn` with role `rider` → `<Redirect href="/book" />`; `signedIn` with any other role → sign out (see the GOTCHA above).
- **PATTERN**: `apps/driver/src/app/_layout.tsx`, `apps/driver/src/features/onboarding/gate-screen.tsx`.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- app`
- **SATISFIES**: AC #1

---

### Phase 5 — app: places, booking, status

### CREATE `apps/rider/src/features/places/saved-places-store.ts` + test

- **IMPLEMENT**: AsyncStorage-backed CRUD over `{ id, label, point: AddressPoint, placeId: string | null }[]`, under key `sakta.rider.places`. Read parses through a zod array and **clears on any parse miss** — the same self-cleaning contract as `session-store.ts`, for the same reason: a corrupt blob must not break every launch. Cap the list at 10 (a scrollable list of saved places past that is a #17 problem, not a #16 one).
- **PATTERN**: `apps/driver/src/features/auth/session-store.ts`.
- **IMPORTS**: `addressPointSchema` from `@taxi/shared`; `AsyncStorage` from `@react-native-async-storage/async-storage`.
- **GOTCHA**: AsyncStorage, not SecureStore. A saved home address is not a secret, and SecureStore's iOS value ceiling makes a growing list the wrong fit (the session store's own comment sizes one session at ~600 bytes against that ceiling).
- **GOTCHA**: Store `placeId` alongside the point. `place-cache.ts` in the api caches resolutions by place id, so a re-resolve of a saved place is free — but only if the id survived.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- saved-places`
- **SATISFIES**: AC #1 (saved addresses), friction budget

### CREATE `apps/rider/src/features/places/use-saved-places.tsx` + test

- **IMPLEMENT**: A small provider over the store — `{ places, save, remove, loading }`. Loads once on mount.
- **PATTERN**: `apps/driver/src/features/onboarding/use-me.tsx` (a provider over one async read).
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-saved-places`
- **SATISFIES**: AC #1

### CREATE `apps/rider/src/features/places/{address-row,search-sheet}.tsx` + tests

- **IMPLEMENT**: `address-row.tsx` — one `Pressable` per suggestion, `accessibilityRole="button"`, the composed one-utterance label from Patterns, ≥44 px.
- **IMPLEMENT**: `search-sheet.tsx` — the `/book/address` screen. A `TextField`, a debounced (300 ms) `GET /geo/address-search`, a `FlatList` of rows, and a `[Use current location]` button when `field === 'pickup'`.
  - **Session token**: one `crypto.randomUUID()` minted per *field visit*, reused across that field's keystrokes, and consumed by the resolve. Rotate it after a **successful** resolve. On a 429 to the resolve, do **not** rotate — the console's `address-field.tsx` rotated in its `.catch` and that permanently abandoned the session it was about to close, which is the arithmetic `ADDRESS_RESOLVE_MAX_PER_WINDOW`'s docblock costs out.
  - Below `PLACES_SEARCH_MIN_CHARS` (3) the api answers `[]`. Render `rider.book.min_chars` as a hint, not an error — and skip the request entirely, so the client does not spend a round trip to learn what it already knows.
  - On resolve success: navigate back with the `AddressPoint`, offer `[Save this address]`.
- **PATTERN**: `apps/dispatch`'s `address-field.tsx` (#19 Phase B) is the reference implementation for the session-token lifecycle — read it before writing this.
- **GOTCHA**: `addressSearchQuerySchema.session` is a **uuid by contract**, not by habit — it is interpolated into the provider's URL, so a free-form string is a request-forgery surface on a route that spends money. Use `crypto.randomUUID()`.
- **GOTCHA**: A suggestion is **not** bookable. Only `POST /geo/places/:placeId/resolve` returns an `AddressPoint` with a `location`. Never construct one from a suggestion.
- **GOTCHA**: A 404 from resolve means "this place is gone, search again" — remove the row and say so; do not treat it as a generic failure.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- search-sheet`
- **SATISFIES**: AC #1, AC #4, edge cases E4, E9

### CREATE `apps/rider/src/features/booking/use-booking-draft.ts` + test

- **IMPLEMENT**: The draft reducer — `{ pickup, dropoff, paymentMethod, quote, quoteState, idempotencyKey }` with actions `setPickup`, `setDropoff`, `setPaymentMethod`, `quoteRequested`, `quoteArrived`, `quoteFailed`, `confirmStarted`.
- **IMPLEMENT — the rule that matters**: any change to `pickup`, `dropoff` or `stops` **discards the current quote and mints a fresh `idempotencyKey`**. `idempotency.ts`'s docblock is explicit: "Reusing a key after the rider edits the pickup returns the ride the OLD body created; the key is the whole contract, and the server does not re-read the body to second-guess it." A stale key here books the wrong ride, silently.
- **IMPLEMENT**: `paymentMethod` changing does **not** discard the quote and does **not** mint a new key — the fare is identical for cash and card (evidence §7), and the key covers the booking attempt, not the payment choice.
- **PATTERN**: `apps/driver/src/features/availability/presence-state.ts` — a pure reducer with its transitions tested exhaustively, split out of its consumer precisely to stay testable and under the line cap.
- **GOTCHA**: `crypto.randomUUID()` is available in Hermes on RN 0.86 via the standard `crypto` global. If it is not, use `expo-crypto`'s `randomUUID` — **verify at implementation time** rather than assuming, and do not hand-roll a uuid (`idempotencyKeySchema` is `z.string().uuid()` and the api 400s on anything else).
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-booking-draft`
- **SATISFIES**: AC #3 (changing dropoff re-quotes), edge cases E1, E5

### CREATE `apps/rider/src/features/booking/use-quote.ts` + test

- **IMPLEMENT**: Fires `POST /rides/quote` whenever pickup **and** dropoff are both present and the draft has no live quote. Cancels an in-flight request when the draft changes again (an `AbortController`, or a monotonically-increasing request id compared on resolution — the api client already aborts on timeout, so a request id is the simpler fit).
- **IMPLEMENT**: On success, announce via `AccessibilityInfo.announceForAccessibility(t('rider.a11y.quote_arrived', { total }))`. On failure, announce `rider.a11y.quote_failed` and surface `errorMessageKey(err.code)`.
- **GOTCHA**: A late response from a superseded request must never overwrite a newer quote. This is the classic race and the reason for the request id.
- **GOTCHA**: A 429 here carries `retryAfterSeconds`. Show the countdown; do not silently retry — retrying is what produced the throttle.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-quote`
- **SATISFIES**: AC #1, AC #3, edge cases E1, E2, E4

### CREATE `apps/rider/src/features/booking/{quote-card,payment-chips}.tsx` + tests

- **IMPLEMENT**: `quote-card.tsx` — total in `fontSize.xl`, breakdown lines beneath, one composed `accessibilityLabel` on the container so the whole card reads as a single utterance (spec item 5). Money renders from integer cents via a `formatEur` helper — **copy `apps/driver/src/features/availability/format-eur.ts`**, do not write a second one.
- **IMPLEMENT**: `payment-chips.tsx` — two options over `BOOKABLE_PAYMENT_METHODS` (`cash`, `card`), `accessibilityRole="radio"`, `accessibilityState={{ checked }}`, ≥44 px, last choice persisted to AsyncStorage.
- **GOTCHA**: `BOOKABLE_PAYMENT_METHODS` is `['cash', 'card']` — narrower than `PAYMENT_METHOD_TYPES`. Render from the narrow tuple; `balance` and `corporate` are refused by the wire (#70) and offering them would build a booking the settlement cannot finish.
- **GOTCHA**: All money is integer cents. Never a float, never a division that leaves one.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- quote-card payment-chips`
- **SATISFIES**: AC #1, AC #2

### CREATE `apps/rider/src/features/booking/booking-screen.tsx` + test; CREATE `src/app/book/index.tsx`

- **IMPLEMENT**: Composes pickup row, dropoff row, saved places, `QuoteCard`, `PaymentChips`, and the Book button. Pickup is populated on mount from `expo-location`'s foreground `getCurrentPositionAsync` → `POST /geo/places/…`? **No** — reverse-geocoding is not on the widened routes. Use `expo-location`'s own `reverseGeocodeAsync` for the display string and the raw coordinates for the point. Permission denied, timeout, or an error all fall through to an empty pickup row — never a blocking error (D7). It reads `rider.book.pickup_empty`, NOT `rider.book.where_to` (**corrected at review round 1 — M7**): with location refused both rows are empty at once, and a screen reader hearing «Kurp?» twice, told apart only by a trailing role word, is two rows a rider cannot distinguish. The GPS fix is applied through `setPickupIfEmpty`, never `setPickup` (**M2/H2**): `/book` is pushed over rather than unmounted, so a late fix would otherwise overwrite a hand-picked pickup, discard the quote and mint a new idempotency key.
- **IMPLEMENT**: Book → `POST /rides` with `Idempotency-Key` from the draft, body `{ pickup, destination, paymentMethod }` (defaults fill the rest), then `router.replace('/book/status?rideId=…')`.
- **IMPLEMENT**: `useScreenFocus` on the title; announce on ride requested.
- **PATTERN**: `apps/driver/src/features/availability/home-screen.tsx` — a composed screen kept thin by pushing logic into hooks.
- **GOTCHA — the 500-line cap.** This screen composes five things; keep it composition-only. Every piece of logic belongs in `use-booking-draft` or `use-quote`. The `presence-state`/`run-effects` split (#141, commit `ade79d9`) is the precedent for when a screen file starts growing.
- **GOTCHA**: `Idempotency-Key` is **required** — a missing header is a 400, not a pass. The api client needs a way to set a per-request header; add an optional `headers` field to `RequestOptions` rather than a bespoke booking client.
- **GOTCHA**: A 409 `idempotent_request_in_progress` means the first request is still running. Retry with the **same** key after a short delay; do **not** mint a new one — that books a second car, which is the whole failure `RIDE_IDEMPOTENCY_PENDING` exists to prevent.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- booking-screen`
- **SATISFIES**: AC #1, AC #3, edge cases E5, E6, D7

### CREATE `apps/rider/src/features/ride-status/socket.ts` + test

- **IMPLEMENT**: `createRiderSocket(token, { url, onUnauthorized })` — the driver's recipe minus the ack helper: `autoConnect: false`, `transports: ['websocket']`, the library's own backoff (500 ms → 30 s, ±50% jitter), `connect_error === 'unauthorized'` → disconnect + sign out.
- **PATTERN**: `apps/driver/src/features/location/socket.ts:20-42` — copy it.
- **GOTCHA**: Never hand-roll a reconnect loop. The library's backoff is the house rule and the console established it (#18).
- **VALIDATE**: `pnpm --filter @taxi/rider test -- socket`
- **SATISFIES**: AC #3

### CREATE `apps/rider/src/features/ride-status/use-ride-status.tsx` + test

- **IMPLEMENT**: Connects the socket when a rideId is present, subscribes to `RT.rideStatus`, parses each payload through `rideStatusEventSchema`, and keeps `{ status, previousStatus, at }`.
- **IMPLEMENT — the room fix (D4)**: on every `connect` event, **the first included**, call `GET /rides/:rideId` and take the status from the response. That call is what joins this socket to the ride room server-side. ~~after the first~~ — **corrected at review round 1 (C1)**: `roomsOnConnect` returns no ride room and `joinRideRoom` only moved the sockets alive when `POST /rides` ran, which is *before* this screen mounts, so skipping the opening connect left the socket in no room at all and the screen never updated. Also drop a read whose response lands after a `ride:status` event: status can move backward (E8), so only the order says which is newer. **Round 2 (R1, R3, R7)** adds three things this task needed and did not have: retry a FAILED read with backoff (the read is the join, and `connect` fires once per connection, so no retry meant a socket up and deaf); expose `joined` separately from `connected` so the reconnecting banner covers *connected but never joined*; and order the two cold-start reads against **each other** with a monotonic read id — `applied` counts events, and the mount and connect reads usually have no event between them, so the later-arriving response was winning even when it held the older snapshot.
- **IMPLEMENT**: A `still_searching` timer — the rider is **never** told "no drivers". `dispatch:unclaimed` goes to Dina's board, not to the ride room, so the app must derive the message from elapsed time in `requested`. Show `rider.status.still_searching` after 60 s and announce it once.
- **IMPLEMENT**: Register an `onBeforeSignOut` hook that disconnects the socket while the token is still valid.
- **GOTCHA — E8, from `.claude/references/realtime-events.md`**: `status` **can move backward**. #19's dispatcher release emits `accepted → requested`. A consumer that ratchets a progress bar or refuses a "lower" status will be wrong on that event. Compare `previousStatus`; never assume it precedes `status`.
- **GOTCHA**: Wire timestamps are ISO strings, not `Date`. `rideStatusEventSchema.at` is `z.string().datetime()` — parse with `Date.parse` when you need arithmetic.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-ride-status`
- **SATISFIES**: AC #3, AC #4, edge cases E3, E7, E8

### CREATE `apps/rider/src/features/ride-status/status-screen.tsx` + test; CREATE `src/app/book/status.tsx`, `src/app/book/address.tsx`

- **IMPLEMENT**: One status line inside an `accessibilityLiveRegion="polite"` container that also announces on iOS (the `Banner` split — reuse `Banner` itself if the shape fits rather than reimplementing it), plus `[Cancel ride]` → `POST /rides/:rideId/cancel` → `router.replace('/book')`.
- **IMPLEMENT**: `useScreenFocus` on the heading; announce on every status change.
- **IMPLEMENT**: The two remaining route files, one-line re-exports.
- **GOTCHA**: Cancel is `@Roles('rider','driver','dispatcher','admin')` on the lifecycle controller and takes a `{ reason }` body (nullable, defaults null). Send `{ reason: null }`.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- status-screen`
- **SATISFIES**: AC #3, AC #4, AC #2

---

### Phase 6 — accessibility suite, docs, validation

### AUDIT every screen test against the accessibility spec

- **IMPLEMENT**: Walk the ten properties in the Accessibility spec section and confirm each has an assertion in at least one test. Add what is missing. This is a sweep, not a new suite — the assertions are written alongside their screens.
- **VALIDATE**: `pnpm --filter @taxi/rider test`
- **SATISFIES**: AC #2

### CREATE `docs/runbooks/rider-a11y-walkthrough.md`

- **IMPLEMENT**: The scripted audit the ux-metrics-ledger's Rider row 13 promises ("audit script lives in ticket"). One numbered step per screen, each stating the gesture, what should be spoken, and the pass condition. Include the Android emulator + TalkBack setup at the top (D6) and record that a VoiceOver pass is **blocked** on this hardware, with the reason.
- **PATTERN**: `docs/runbooks/hetzner-deploy.md` — numbered, performable, no prose padding.
- **VALIDATE**: a human runs it; the result lands in the execution report.
- **SATISFIES**: AC #4 (documented walkthrough per screen)

### UPDATE `docs/ux-metrics-ledger.md`

- **IMPLEMENT**: Fill "Latest" for Rider row 12 with the tap count **measured against the built app**, not the plan's figure — the plan says 2, and the plan is `derived`. Fill row 13 with the TalkBack result and mark the VoiceOver half blocked.
- **GOTCHA**: The ledger's own rule is that targets are absolute and never ratcheted down. If the built app measures 3 taps, record 3 against a target of 4 — do not move the target.
- **SATISFIES**: friction budget, AC #4

### UPDATE `services/api/src/features/geo/geo.module.ts`

- **IMPLEMENT**: The production guard's throw message names **"#13/#16"** as what binds the real Routes provider ("#13/#16 replace this factory with the Google Routes provider"). #16 explicitly disclaims that work (Out of Scope) and #134 owns it. Change the reference to **#134**.
- **GOTCHA**: This is a message a human reads at 2 a.m. when a production boot fails. Pointing it at a ticket that disclaimed the work sends them to a dead end. The line is prose, so typecheck/lint cannot catch it — this task is the only check.
- **VALIDATE**: `pnpm --filter @taxi/api test -- geo.module`
- **SATISFIES**: AC #6

### UPDATE `apps/rider/CLAUDE.md`

- **IMPLEMENT**: Two lines are now false and must change: "pickup defaults to GPS location (draggable pin)" — there is no pin, and the re-slice killed it; and "multi-stop supported" — the app sends no stops. Also "EUR balance is always visible on the home screen" describes a home screen this ticket does not build (`balance` is not even a bookable payment method) — scope it to #17 or delete it.
- **GOTCHA**: This is the `rules-check-drift` case. A rules file that describes a pin the app deliberately does not have will send the next session building one.
- **SATISFIES**: AC #6

### RUN the gate

- **VALIDATE**: `pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

### Unit Tests

`jest-expo` + RNTL 14, colocated with the slice (`foo.ts` → `foo.test.ts`). Each feature ships **≥1 expected + 1 edge + 1 failure** case (root `CLAUDE.md`).

Pure logic (`use-booking-draft`, `phone-normalise`, `saved-places-store`, `error-key`, `device-language`) is tested without rendering. Screens are tested through RNTL with a fake `ApiClient` injected via `SessionProvider`'s `api` prop.

RNTL 14 is async by default — `await userEvent.press(...)`, `await screen.findByLabelText(...)`. Native modules come from `jest.setup.ts`, never from a per-test mock.

### Integration Tests

Api-side only (`services/api`, jest + the existing harness): the two new rides routes and the widened geo routes, run against the real Postgres. The rider app has no integration tier — its "integration" is Level 4.

`COMPOSE_PROJECT_NAME=taxi` on anything DB-touching. One gate at a time — global-setup drops the shared test DB.

### Edge Cases

Every one names where it is verified.

| # | Edge case | Verified in |
|---|---|---|
| E1 | Dropoff changed after a quote → old quote discarded, fresh idempotency key | `use-booking-draft.test.ts` |
| E2 | Quote request fails (maps down / 500) → error state, Book disabled, announced | `use-quote.test.ts`, `booking-screen.test.tsx` |
| E3 | No drivers online → status stays `requested`; the app derives "still searching" from elapsed time, never claims failure | `use-ride-status.test.tsx` (fake timers) + **Level 4 step 6** |
| E4 | 429 on search / resolve / quote → countdown from `retryAfterSeconds`, no auto-retry | `search-sheet.test.tsx`, `use-quote.test.ts`, `address-search.controller.spec.ts` |
| E5 | 409 `idempotent_request_in_progress` → retry with the **same** key | `booking-screen.test.tsx` |
| E6 | Offline at confirm → `ApiError('offline')`, retryable with the same key | `booking-screen.test.tsx` |
| E7 | **Every** socket connect, first included → `GET /rides/:rideId`, which both refetches the status and joins the ride room (corrected at review round 1 — C1); a FAILED read is retried, and `joined` is what the banner reads (round 2 — R1) | `use-ride-status.test.tsx` (incl. "retries a FAILED connect read" and "keeps the NEWER of two reads in flight") + `ride-lifecycle.integration.spec.ts` ("joins a socket opened AFTER the booking", "does NOT join a socket whose owner the read refuses") + `rides.service.spec.ts` ("reads, joins, then reads AGAIN") + **Level 4 step 7** |
| E8 | `ride:status` moves **backward** (`accepted → requested` on dispatcher release) → screen follows it, no ratchet | `use-ride-status.test.tsx` |
| E9 | `place_not_found` (404) on resolve → row removed, "search again", session token **not** rotated | `search-sheet.test.tsx` |
| E10 | Session expires mid-booking (401 with a token) → `signOut` → `/login` | `use-session.test.tsx` |
| E11 | Location permission denied → pickup falls back to the search sheet, booking still completable | `booking-screen.test.tsx` + **Level 4 step 8** |
| E12 | Corrupt saved-places blob → store self-cleans, app launches | `saved-places-store.test.ts` |
| E13 | Preview then book the same route → **one** paid Routes call | `rides.integration.spec.ts` |
| E14 | Rider B reads rider A's ride → 404, not 403 | `rides.integration.spec.ts` |

**E3, E7, E8 and E11 also carry a manual step** because their unit coverage uses fakes for the thing that actually breaks (a real socket, a real permission dialog, a real empty driver pool).

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/rider typecheck
pnpm --filter @taxi/rider lint
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint
pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/rider test
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm --filter @taxi/api test -- rides.integration address-search
```

Set `REDIS_TEST_URL` to match your `REDIS_PORT`; without it the Redis-backed suites `describe.skip` and a green run is 33 tests short.

### Level 4: Manual Validation

**Prerequisites, stated because two of them are the reason a step can silently never run:**

- `docker compose up -d --wait`; `pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed`.
- `pnpm --filter @taxi/api dev` — the api on 3001, with `StubSmsProvider` bound (no `TWILIO_*` set). **The OTP is logged in full** by `auth.otp.stub_sent`; that is how you read a code.
- `EXPO_PUBLIC_API_URL` set to a host the emulator can reach — `http://10.0.2.2:3001` on the Android emulator, not `localhost`.
- No seed rider row is needed: `SIGNUP_ROLES` includes `'rider'`, so signup is self-service.
- Steps 4–5 need a **second** app running: the driver app (#14) on a second emulator or a device, signed in and online with a location. Steps 6–9 need the api only.

1. **Sign up.** `pnpm --filter @taxi/rider dev` → launch on the Android emulator. Enter `+37120000001` → Send code. Read the code from the api log (`event: auth.otp.stub_sent`). Enter it. **Expect:** land on `/book`.
2. **Pickup default.** Grant location when asked. **Expect:** the pickup row shows a Rīga street line within ~3 s. (The emulator's default position is Google HQ unless you set one — use the emulator's Extended Controls → Location to drop a Rīga coordinate first.)
3. **Search and quote.** Tap "Where to?" → type `Brīvības` → tap a suggestion. **Expect:** the sheet closes, dropoff filled, and a quote appears. Check the api log for **one** `ride.pricing.quote_created`.
4. **Confirm.** Tap Book. **Expect:** a ride is created (`ride.request.created` in the api log) and the app lands on `/book/status`. The preview→booking cache dedupe is **not** checked here — with `StubMapsProvider` bound there is no paid call to count, and E13 in `rides.integration.spec.ts` is what makes that claim `observed`.
5. **Matched.** With the driver app online nearby, book. **Expect:** the status line moves to matched/offered and the change is spoken by TalkBack without touching the screen.
6. **No drivers (the failure path).** Take the driver app offline. Book. **Expect:** the status line stays "searching", and after 60 s reads "still searching" — **never** an error, never "no drivers found". This is the AC's failure case and it needs the api only.
7. **Reconnect.** With a ride in `requested`, toggle the emulator to airplane mode for 5 s, then back. **Expect:** the status line recovers (a `GET /rides/:rideId` in the api log) rather than freezing.
8. **Permission refused.** Reinstall, deny location at the prompt. **Expect:** pickup is empty and tappable, the search sheet fills it, and the booking completes. No blocking error.
9. **Saved address, 2 taps.** Save the dropoff from step 3. Force-quit, reopen. **Expect:** tap the saved place, tap Book — a booked ride in **two** taps. Count them and record the number in the ledger.
10. **TalkBack walkthrough.** Settings → Accessibility → TalkBack on. Run `docs/runbooks/rider-a11y-walkthrough.md` end to end with the screen off or eyes closed. **Expect:** every step completes unassisted. Record failures as findings, not as "mostly worked".

### Level 5: Additional Validation (Optional)

- `npx expo-doctor --project-root apps/rider` — catches a dependency version the SDK disagrees with before a build does.
- `npx expo install --check --project-root apps/rider` — **read the output, do not apply it blindly.** It will try to move TypeScript back to 6.x; `expo.install.exclude` is what prevents that, and if it still offers, the exclude block is wrong.

---

## ACCEPTANCE CRITERIA

Derived from the issue plus the 2026-08-07 re-slice. AC #7 in the original issue body is superseded — see AMENDMENTS.

- [ ] **AC #1 — Booking works end to end against the local api.** OTP sign-in → pickup defaulted from GPS → dropoff chosen from search or a saved address → upfront quote displayed → payment chosen → confirm → ride created. Verified: Level 4 steps 1–5, `rides.integration.spec.ts`, `booking-screen.test.tsx`.
- [ ] **AC #2 — Screen-reader-first, as testable properties.** All ten properties in the Accessibility spec have assertions; focus moves explicitly on every screen transition; async changes are announced. Verified: the RNTL suite (the gate) + Level 4 step 10 (TalkBack).
- [ ] **AC #3 — Changing the dropoff re-quotes** (the edge case, replacing the superseded pin-drag criterion). The old quote is discarded and a fresh idempotency key is minted. Verified: `use-booking-draft.test.ts`, `use-quote.test.ts`.
- [ ] **AC #4 — The no-drivers and quote-failure paths are communicated accessibly.** No-drivers is "still searching", never an error; a quote failure disables Book and is announced. Verified: `use-ride-status.test.tsx`, `use-quote.test.ts`, Level 4 step 6.
- [ ] **AC #5 — i18n LV/RU/EN,** no hardcoded user-facing string, all three catalogs in placeholder parity. Verified: `pnpm --filter @taxi/shared test` (`tests/i18n.test.ts`), grep for string literals in JSX.
- [ ] **AC #6 — Documented screen-reader walkthrough per screen** exists at `docs/runbooks/rider-a11y-walkthrough.md`, has been **run** on TalkBack, and its result is recorded. The VoiceOver half is explicitly marked blocked with its hardware reason.
- [ ] **AC #7 — Friction budget met:** ≤ 4 taps intent→booked for a saved-address repeat ride, **measured on the built app** and recorded in `docs/ux-metrics-ledger.md`.
- [ ] **AC #8 — No map, no pin, anywhere on the critical path.** Verified: no map dependency in `apps/rider/package.json`.
- [ ] **AC #9 — Rider app manifest carries foreground location only.** No `ACCESS_BACKGROUND_LOCATION`, no foreground service, no `expo-task-manager`.
- [ ] **AC #10 — Spend controls hold.** Both new caps have written derivations naming what they assume; the preview→booking cache dedupe is pinned by an integration assertion (E13).
- [ ] **AC #11 — `pnpm turbo run typecheck lint test build --force` green,** with `apps/rider` actually running `lint` and `test` (not skipped for want of a script).
- [ ] No regressions: the driver app, the dispatch app and the api suites are untouched and green.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works — **all ten Level 4 steps run, including TalkBack**
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] `apps/rider/CLAUDE.md` no longer describes a draggable pin
- [ ] Every number in the PR body re-derived at HEAD, not inherited from this plan
- [ ] **Every risk in the register closed by its own command**, and the result recorded:
  - [ ] R1 — `tsc --version` prints 5.9.x; `@taxi/shared` lint exits 0
  - [ ] R2 — `turbo run lint test --filter=@taxi/rider` names both rider tasks
  - [ ] R3 — E13 passes, asserting `maps.routeCalls === 1`; the claim is now `observed`
  - [ ] R4 — `assertWithinRateLimit` is unchanged in the diff
  - [ ] R5 — the walkthrough records who ran it, on what, and when (or AC #6 is marked blocked with its reason)

---

## RISK REGISTER

Each risk names the task that mitigates it and the **command whose failure means the risk is still live**. A risk with no failing command is a wish; these are checkable.

### R1 — TypeScript 6 in `apps/rider` reddens lint in files this ticket never touched

**Mechanism.** The Expo template pins `typescript: ~6.0.3`. Every other workspace member is on 5.x (`shared ^5.7.0`, `api ^5.7.3`, `dispatch ^5`, `db ^5.7.0`, `driver ~5.9.3` — observed at `a6481aa`), so a 6.x here installs a second TypeScript major. typescript-eslint then resolves two peer instances against one checker and `@taxi/shared`'s type-aware rules go red.

**Why it is nasty rather than merely annoying:** the failure surfaces in `packages/shared`, not in `apps/rider`. An implementer who has been editing the rider app all day reads a red `@taxi/shared` lint as an unrelated breakage — or worse, as someone else's concurrent session — and starts debugging the wrong package.

**Owner:** Phase 3, `UPDATE apps/rider/package.json`.
**Mitigation:** pin `~5.9.3` **and** `expo.install.exclude: ["typescript"]`. Both, not either — the pin fixes today, the exclude stops `expo install --check` undoing it at the next SDK bump.
**Closes when:**
```bash
pnpm --filter @taxi/rider exec tsc --version   # prints 5.9.x
pnpm --filter @taxi/shared lint                # exits 0
```
**Residual:** an SDK 58 upgrade could reintroduce it if the exclude block is dropped. Not this ticket's problem, but the exclude comment should say why it is there.

### R2 — turbo reports green on an app with zero tests

**Mechanism.** `apps/rider/package.json` has no `lint` and no `test` script today. Turbo **omits** a package lacking the script rather than failing, so `pnpm turbo run typecheck lint test build --force` passes without ever running a rider test. The gate is not wrong; it is blind.

**Why it matters here specifically:** this ticket's entire acceptance criterion #2 (screen-reader-first) is enforced by RNTL assertions. If the suite never runs, the differentiator ships unverified and the gate says green.

**Owner:** Phase 3, `UPDATE apps/rider/package.json`.
**Mitigation:** add both scripts (`lint: "eslint ."`, `test: "jest"`), matching `apps/driver`.
**Closes when:**
```bash
pnpm turbo run lint test --filter=@taxi/rider
```
names `@taxi/rider:lint` **and** `@taxi/rider:test` in its output. "No tasks were executed" is the failure, and it is a *passing* exit code — read the task list, not the exit code.

### R3 — the "preview then book = one paid Routes call" claim stays `derived` forever

**Mechanism.** The claim behind D1's spend argument is that a preview and its booking share a `routeCacheKey`, so confirming costs one paid call rather than two. It is `derived` from `renderPoints`/`routeCacheKey` construction (`COORD_PRECISION = 4`, caller-namespaced to `'quote'`) plus `geo.module.ts`'s binding. **No run has measured it.** If it is wrong, `RIDE_QUOTE_MAX_PER_WINDOW = 30` was sized against half the true cost, and every preview is a paid call.

**Owner:** Phase 2, edge case E13 in `rides.integration.spec.ts`.
**Mitigation — and the escape hatch is now closed:** `CountingMapsProvider` (`services/api/test/harness.ts:289-311`) already exposes `routeCalls`, and `createTestApp` overrides `MAPS_PROVIDER_SOURCE` rather than `MAPS_PROVIDER`, leaving the real `CachingMapsProvider` in the graph above it. The earlier draft of this plan said "if the harness's maps fake does not expose a call count, add one" — that conditional was **wrong**, and a conditional is exactly how a risk like this survives a whole ticket. The counter exists; write the assertion.
**Closes when:**
```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- rides.integration
```
passes with an E13 case asserting `maps.routeCalls === 1` across a preview + booking of the same corridor.
**Trap:** the cache sits above the counter, so coordinates any earlier case in the file already routed will not increment. Use a fresh corridor or the assertion passes for the wrong reason.
**If it fails:** do not weaken the assertion. Re-derive `RIDE_QUOTE_MAX_PER_WINDOW` on the assumption that every preview is a paid Routes call, and say so in the PR body — the cap is a money control, and a wrong derivation is the defect, not the failing test.

### R4 — refactoring `assertWithinRateLimit` re-derives two live money caps

**Mechanism.** An earlier draft of this plan told the implementer to widen `RidesService.assertWithinRateLimit` from `(subjectId, bookingChannel)` to `(key, maxPerWindow, …)` so the preview could reuse it. That signature change decouples key from cap, and `DISPATCHER_BOOKING_MAX_PER_WINDOW`'s derivation (30 + 25 = 55; 60 clears with ~9% headroom) depends on the channel selecting **both together**. Decoupled, a later caller can pair the dispatcher key with the rider cap of 20 and 429 a venue mid-call.

**Owner:** Phase 2, `UPDATE services/api/src/features/rides/rides.service.ts`.
**Mitigation:** **do not refactor it.** Give `previewQuote` a private throttle helper mirroring `address-search.controller.ts`'s — same INCR-then-check, same `Math.max(1, …)` floor, same `ApiErrorBody` 429 shape. Ten duplicated lines beat touching two live booking caps inside a rider-app ticket.
**Closes when:** `git diff origin/main -- services/api/src/features/rides/rides.service.ts` shows **no change** to `assertWithinRateLimit`'s signature or body.

### R5 — the manual screen-reader pass is hardware-blocked and quietly skipped

**Mechanism.** AC #6 requires a documented walkthrough that has actually been **run**. This Mac is at the Xcode 26.3 ceiling with SDK 57 failing to compile for iOS, so VoiceOver is not reachable here; D6 routes the pass to an Android emulator with TalkBack, which assumes Android Studio is installed or installable. If it is not, the tempting failure is to write the runbook and mark the AC done.

**Owner:** Phase 6, `CREATE docs/runbooks/rider-a11y-walkthrough.md` + Level 4 step 10.
**Mitigation:** the runbook records **who ran it, on what, and when**. A runbook with no run recorded is not a satisfied AC.
**Closes when:** the runbook's result section names the emulator/API level and lists every step as pass or fail.
**If Android Studio is unavailable:** ship the RNTL suite as the gate, mark AC #6 **blocked** in the PR body with the hardware reason, and open a follow-up. Do not write a walkthrough nobody ran — that is the "validation that silently never happens" case, and it lands on the ticket's own success condition.

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes.** Each would change the plan if wrong.

- **A1** — `POST /rides/quote` is acceptable scope inside a "rider app" ticket. Precedent: #14's plan ran a full api phase (presence sweeper, push slice, earnings read) inside a "driver app" ticket. If this is wrong, Phase 2 splits into its own ticket and Phase 5 blocks on it.
- **A2** — Saved addresses are device-local (D3, decided). Lost on reinstall; a follow-up ticket owes the server-backed version.
- **A3** — The manual screen-reader pass runs on an Android emulator with TalkBack (D6, decided). Assumes Android Studio is installed or installable on this Mac. **If it is not, AC #6 is blocked** and the honest outcome is: ship the RNTL suite as the gate, log the walkthrough as blocked, open a follow-up. Do not quietly write a walkthrough nobody ran.
- **A4** — `crypto.randomUUID()` exists in Hermes on RN 0.86. Verify at implementation time; fall back to `expo-crypto`. Never hand-roll — `idempotencyKeySchema` is `z.string().uuid()`.
- **A5** — `expo-location`'s `reverseGeocodeAsync` gives a usable Latvian street line without a Google key. If it does not, the pickup row shows coordinates until the rider edits it — degraded but not blocking, and cheaper than widening a third geo route.
- **A6** — The rider i18n block is ~50 keys / 100–150 lines (`expected`, a plan-time count). D5's 460-line trigger makes the split decision measurable rather than guessed.
- **A7** — The `'quote'`-caller cache dedupe holds. `derived`, not observed. Tracked as **R3** in the risk register, which owns the closure command and the what-if-it-fails path.

**Questions — flagged, not blocking. Proceeding under the stated reading.**

- **Q1** — Should `POST /rides/quote` return the `split`? This plan says **no** (the commission line is the driver's transparency card, S2-5, and a rider surface has no reason to hold it). If fare transparency is meant to run both ways, the schema changes and so does the quote card.
- **Q2** — A driver's phone signing into the rider app gets a driver session (the api's "existing user's stored role wins" rule). This plan signs them out with a generic error. A specific message ("this number is registered as a driver") would be kinder but leaks account existence to anyone who can type a phone number — the exact enumeration oracle `otpRequestResponseSchema` is designed to avoid. Proceeding with the generic message.
- **Q3** — The `still_searching` threshold is **60 s**, chosen to sit above the dispatch cascade's own offer window so the message does not fire while a driver is deciding. Not derived from measured cascade timings — check `dispatch.service.ts`'s `MAX_OFFER_ATTEMPTS` × the offer window at implementation time and adjust, stating the arithmetic.
- **Q4 — ANSWERED, and this plan answered it WRONG (C1, review round 1).** The question was right: "does the rider socket need to be connected before `POST /rides`?" The answer given — "the REST response carries the same data, so nothing is lost … connecting earlier is a cheap improvement" — treats a missed *creation event* as the whole cost. It is not. The join is one-shot: a socket created after `POST /rides` is never in the ride room, so it misses **every** later `ride:status`, not just the first. "A stale first frame" understates a screen that never updates again. The resolution is neither of the two options considered: `GET /rides/:rideId` now performs the join itself, so the socket is joined whenever the app reads — first connect and every reconnect alike. Original text, for the record: *"`notifyRider` joins the rider's live sockets then emits; with no socket, the join is a no-op and the creation event reaches nobody. The REST response carries the same data, so nothing is lost — but connecting on `/book` mount rather than on `/book/status` mount is one fewer missed event. This plan connects on `/book/status` mount and relies on the refetch (D4); connecting earlier is a cheap improvement if the status screen ever shows a stale first frame."*

---

## NOTES (open canvas)

### Why the api work is not scope creep

The issue's "Files touched (estimate)" says `apps/rider/src/features/{auth,booking}/**`. Taken literally, this ticket cannot be delivered: there is no quote to display before confirming, no typeahead a rider may call, and no way to recover a ride after a reconnect. All three are api facts, verifiable by reading three files:

- `rides.controller.ts` — one route, `POST`, and a docblock saying reads belong elsewhere.
- `address-search.controller.ts` — `@Roles('dispatcher', 'admin')` on both routes.
- `room-policy.ts:34-36` — `roomsOnConnect` returns `[userRoom, driverRoom, dispatchRoom].filter(canJoin)`. No ride room, ever.

The precedent for handling this is #14, whose plan carried a six-phase structure with two api phases inside a "driver app" ticket. Estimates in issue bodies are estimates; the AC is the contract.

### Alternatives weighed and rejected

**Quote after creation, not before.** `POST /rides` already returns the quote — the app could create the ride, show the price, and offer a cancel. Rejected: it dispatches a real car to a real driver before the rider has agreed to a price, and the cancellation shows up in the PRD's <15% cancellation guardrail as the rider's fault. It also inverts the evidence's own finding (§7: the payment chip and the price live on the confirm screen, *before* the request).

**Client-side pricing.** The app could compute a fare from a distance estimate and skip the round trip. Rejected outright: commission and tariff are `platform_config` rows resolved server-side by `resolveCommissionPct()`, "never a literal, never a silent default". A client-side price is a literal by definition, and it would be the first thing to drift.

**Reuse `rideRequestBodySchema` as the quote body.** Fewer schemas. Rejected: it requires `paymentMethod`, forcing the rider to choose how to pay before seeing what it costs — the exact inversion the AC forbids.

**Extract the four components into a shared RN package.** The driver and rider apps now hold four identical files. Rejected for this ticket: `packages/shared` must stay isomorphic (`types: []`, a src-only program, #56) and cannot hold RN components; a new `packages/ui-native` is a real option but it is a refactor with two consumers and no third in sight. Duplication is the cheaper correct answer today. Revisit at a third app, as its own ticket.

**Server-side ride-room rejoin instead of `GET /rides/:rideId`.** The gateway could look up a rider's active ride on handshake and join the room. Rejected as larger and less useful: it needs an active-ride query on every connect for every rider, it does nothing for a cold start (the app still needs the ride's *current* state, not just future events), and #17 needs a ride read anyway. `room-policy.ts`'s own comment says "#11 tightens this into a real ride-membership check when rides exist" — that tightening is a separate concern from #16.

### The spend picture, stated honestly

This ticket widens two paid routes to a population instead of one console operator. What actually bounds the bill:

1. **Per-rider caps** (30 searches / 10 resolves per minute; 30 previews per 10 minutes). These bound the *hostile or broken* client, not aggregate spend.
2. **The session token.** N searches terminated by a resolve bill as one $5.00/1,000 completion instead of N × $2.83/1,000 — which is why the resolve cap is generous rather than tight.
3. **The route cache.** `MAPS_ROUTE_CACHE_TTL_SECONDS = 86_400` (24 h), keyed on coordinates rounded to `COORD_PRECISION = 4` (~11 m) within the `'quote'` caller namespace. A preview and its booking share a key exactly.
4. **`RIDE_REQUEST_MAX_PER_WINDOW = 20`** still bounds actual bookings, untouched.

What is **not** bounded: total spend across all riders. At pilot scale that is fine — the PRD targets ≥100 rides/week, and 100 bookings × (5 searches + 1 resolve + 2 quotes, one cached) is a rounding error against €100/mo. It stops being fine at a scale this pilot is not trying to reach, and the honest trigger for revisiting every number here is the same one three other policy files already carry: **the first Google bill.**

### Sequencing note

Phase 3 (app tooling) touches only `apps/rider` and Phases 1–2 touch only `packages/shared` + `services/api`. They are genuinely parallel and could run as two loops in separate worktrees. If you do that: copy `.env` into the worktree and run anything DB-touching with `COMPOSE_PROJECT_NAME=taxi`, or the gate starts a second Postgres against the occupied 5432 — and with no `.env`, a `REDIS_TEST_URL` run **hangs silently** rather than failing (ioredis retries a dead 6381 forever while turbo buffers the output).

Given that this is one ticket and the phases are short, sequential in one worktree is probably the better trade. The annotation is there so the choice is visible, not to recommend the split.

---

## AMENDMENTS

- 2026-09-02 — **Risk register added (R1–R5), each with a closing command.** Three corrections to the plan as first written, all found by re-reading source rather than re-reading the plan: (a) **R3's escape hatch removed** — the draft said "if the harness's maps fake does not expose a call count, add one", but `CountingMapsProvider.routeCalls` already exists at `services/api/test/harness.ts:289-311` and `createTestApp` overrides `MAPS_PROVIDER_SOURCE`, keeping the real cache in the graph; a conditional is how a risk survives a whole ticket. (b) **R4 reverses a Phase 2 instruction** — the draft told the implementer to widen `assertWithinRateLimit`'s signature, which would decouple key from cap and put `DISPATCHER_BOOKING_MAX_PER_WINDOW`'s derivation at risk inside a rider-app ticket; `previewQuote` gets a private helper instead. (c) **Level 4 step 4 rewritten** — it was headed "Cache dedupe, observed" while its own body admitted it measured nothing under `StubMapsProvider`; E13 owns that claim.
- 2026-09-02 — **Original AC "pin drag updates the quote (edge)" is retired.** Superseded by the issue's own 2026-08-07 re-slice: "**the map is never required to complete a booking**; no pin-dragging on the critical path (the #1 documented screen-reader failure)". Evidence: `docs/research/rider-ux-evidence.md` §1.2, where map-pin placement is one of the two flows that actually break for blind users. The edge case it was testing — that changing the destination re-prices the ride — is preserved as **AC #3** (changing the dropoff re-quotes) so nothing is lost but the pin. The **subject** is retired, not the digits: grep `pin`, `drag`, and `map` in the PR body and the issue before closing, not just this plan.
