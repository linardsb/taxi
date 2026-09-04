# Feature: Driver offers, active-ride flow, and earnings (#15)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing. Pay special attention to naming of existing utils, types and models, and import from the right files. Contracts come from `@taxi/shared`; never re-declare a schema locally.

> **Provenance (2026-09-04, third pass).** Every `path:line` below was read against `main` at `c70572b` in this session, and the first draft's citations were re-verified line by line (the corrections are in AMENDMENTS). Branch `feature/driver-offers-active-ride` and `pnpm install` have NOT been run; implementation owns both. Before editing, `git log -1 --format=%h -- <file>` any file whose lines you rely on; the driver slices were last touched by PR #139 and #142.
>
> Stale in-repo comment to ignore: `services/api/src/features/dispatch/board/cascade.ts:44` ("apps/driver has no src/ yet") is false; the app has 85 files in 6 slices.

## Feature Description

The driver app signs in, onboards, toggles online and streams durable background GPS with dark detection and a push nudge (#14 / PR #139). This ticket delivers the three screens that turn a streaming-but-idle driver into an earning one, and makes the flat-15% transparency wedge (S2-5) visible:

1. **Offer screen.** An incoming `ride:offer` surfaces as a full-screen card with a countdown that follows the server's `sentAt → expiresAt` window (config `offerTimeoutSeconds`, default 20). Accept/decline over REST. The API also sends the offer as a push so a backgrounded or killed app still surfaces it; the push carries the offer itself, so a tap can render the card without a read that does not exist. Dark detection stays server-side (`candidate-filter.ts:30`); the app's job is never to send a stale accept and to let a pending offer expire normally.
2. **Active-ride flow.** After accept the driver walks `accepted → arriving → arrived → in_progress → completed`, one REST call per edge, the API guarding each with `guardDriverStep`. The app mirrors the machine, re-reads the ride on every socket connect (which is what re-joins the ride room after a reconnect) and reconciles on `ride:status`, including the backward dispatcher-release edge and Dina's force-assign, which arrives with no offer at all. Pickup/destination detail, payment method prominent (and a change between offer and acceptance announced), navigation hand-off to Google Maps / Waze.
3. **Earnings.** The day total (existing `GET /drivers/me/earnings/today`) and a per-ride receipt with constant arithmetic (`Rider paid → Sakta (pct) → You`) read from `ride.split`, integer cents via `formatEur`, commission from the persisted split, never a literal 15.

Plus two residues from #14's PRs: the #140 sign-out ordering test, and the first emit of the already-typed `driver:queue` event with a queue-position view beside the card.

**What the API and shared contracts gain in this ticket** (none of it exists today; each was verified absent):

| Gap (verified) | Fix in this plan |
|---|---|
| A driver has no ride read: `GET /rides/:rideId` is rider-only (`rides.controller.ts:43-44`, `rides/index.ts` KNOWN GAP "A DRIVER still has no ride read"); the step endpoints return `{ ok: true }`, only `complete` returns `{ ride }` (`ride-lifecycle.controller.ts:36-74`) | The route stays where it is; a per-route `@Roles('rider', 'driver')` and a driver branch in the lifecycle service that joins the ride room (T5). No route registration changes, so the rider path cannot regress by construction |
| Nothing tells a cold-started app it is mid-ride: `DriverMe` = `{ profile, vehicles }` (`schemas/driver.ts:58-62`); `drivers.status` is a derived cache (`rides.repository.ts:215-217`) | `driverMeSchema.activeRideId` read from the rides table (T3) |
| No offer push is sent: `DispatchNotifier.emitOffer` emits the socket event only (`dispatch-notifier.ts:29-45`); `PUSH_PROVIDER` is used by the nudge alone (`drivers.service.ts:274-320`) | `DriversService.sendPush` reused by the notifier, `data.kind = 'offer'` + the wire offer JSON (T6) |
| `driver:queue` is never emitted (`dispatch/index.ts:20-22`) | `QueueNotifier.broadcast(zoneId)` after every queue mutation (T7) |
| The offer carries no payment method (`rideOfferSchema`, `schemas/ride.ts:183-206`) while the evidence makes it "unmissable at accept" | `rideOfferEventSchema.paymentMethod` on the wire only, sourced from `found.ride.paymentMethod` at emit (T2); no `ride_offers` column, no migration; a change by acceptance is detected and announced in-app (T15/T17) |
| `DRIVER_STEPS` is API-local (`ride-lifecycle.policy.ts:52-59`) and the app needs the same status → step table | Moves to `@taxi/shared` `ride-state-machine.ts` (T1) |
| The location runtime exposes no socket-change or latest-fix signal (`location-task.ts:10-14`); the card needs the driver's position (pickup distance) and speed (glance mode) | `RuntimeListener.onSocket` / `onLatestFix`, `RawFix.coords.speed` (T8) |
| `formatEur` is driver-local (`availability/format-eur.ts`) and the push body needs the same money string on the API | `formatEur` moves to `@taxi/shared` `money.ts`; the driver file re-exports it (T6) |

## User Story

As a **working driver (Atis)**
I want to **see the whole fare and exactly what I keep the instant a ride is offered, accept with one tap, and walk the ride to completion without fighting the app**
So that **I can trust the 15% is real, am never penalised for declining, and get paid transparently.**

## Problem Statement

The driver surface streams location but cannot receive or work a ride: it subscribes to none of the nine server → client events (`use-presence.tsx:166-167` handles `connect`/`disconnect` only). Without the offer card the cascade has no phone consumer; without the lifecycle calls the machine never leaves `accepted`; without the receipt the platform's #1 documented switch reason (S6-4) stays invisible. `driver:queue` is typed and never emitted, so queue fairness is invisible to the driver it protects.

## Solution Statement

Three VSA slices in `apps/driver/src/features/` (`offers`, `active-ride`, `earnings`), two long-lived providers mounted in `_layout.tsx` so a card or a ride survives navigation, small additive changes to `location` and `push`, and the eight API/shared changes in the table above. Every socket payload is parsed through its `@taxi/shared` schema before it touches a reducer; every reducer is an exhaustive `switch` with no `default`, mirrored on `presence-state.ts`.

## Out of Scope / Non-Goals

- **Not included: in-app turn-by-turn navigation.** Deep-link out; the return path is the OS switcher plus the provider re-reading the ride on foreground.
- **Not included: any acceptance-rate metric.** Do not add, compute, store or display an accept/decline ratio anywhere (policy; the ledger row at `docs/ux-metrics-ledger.md:49` is an early-warning aggregate, never per driver).
- **Not included: tiers, bidding, heatmaps, IVR** (architecture anti-scope 2026-08-07).
- **Not included: rider rating, trip duration, €/km on the card.** No contract carries them: the only `rating` in shared is the driver's own (`schemas/driver.ts:22`); `fareQuoteSchema` (`schemas/ride.ts:28-39`) has no distance or duration, and `etaSeconds` (`:200`) is the pickup ETA. Follow-up ticket to file: "quote carries `distanceMeters`/`durationSeconds` (pricing slice + persisted quote) and the card shows duration + €/km". The evidence report's "all fields are already in Sakta's data model" (`driver-ux-evidence.md:26`) is wrong for these three.
- **Not included: PIN pickup, blind-rider protocol.** Listed in the ticket's evidence fold-in; no schema, no endpoint, no ride flag exists. Separate tickets.
- **Not included: driver-initiated cancel / no-show.** `rides/index.ts` KNOWN GAPS: cancellation policy is a money question #12 did not answer. The driver phones Dina; #19 shipped all three dispatcher commands.
- **Not included: rider identity for the driver** (name, phone). `Ride` carries `riderId` only. Separate ticket.
- **Not included: a per-ride earnings history list** (Q1 = Option B, confirmed 2026-09-04). The receipt covers the ride just completed, recoverable by re-reading the ride.
- **Not included: refusing a rider's payment-method change while an offer is pending.** The lock is at `accepted` (`isPaymentMethodLocked`) and stays there; the app detects and announces a change instead (T15/T17, Q8).
- **Not changing: the presence reducer** (`presence-state.ts`, 499/500 lines). #140 adds a test only. Offer and ride state live in their own slices; `server_on_ride` does not exist and is not added.
- **Not building: a second push channel or a second socket/`ApiClient`.** The offer push reuses the `presence` Android channel (`AndroidImportance.MAX`, `register-push-token.ts:31-34`) and the provider's hardcoded `priority: 'high'`, `sound: 'default'` (`expo-push.provider.ts:80-95`).
- **Deferred: Level-4 device validation.** Steps are written for the device day (`docs/spikes/04-gps-field-test.md`), not run here.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (expected ~1,600 lines: ~1,000 app, ~350 API, ~80 shared, ~200 tests beyond the app's own)
**Primary Systems Affected**: `apps/driver` (new `offers`, `active-ride`, `earnings`; additive edits to `location`, `push`, `onboarding`, `availability/format-eur.ts`, `app/_layout.tsx`); `services/api/features/{dispatch,rides,drivers}`; `packages/shared` (`ride-state-machine.ts`, `realtime-events.ts`, `money.ts`, `schemas/driver.ts`, i18n catalogs)
**Dependencies**: existing `expo-notifications`, `expo-linking`, `socket.io-client`; **new** `expo-audio ~57.0.4`, `expo-haptics ~57.0.2` (`observed`: `expo/expo` branch `sdk-57`, `packages/expo/bundledNativeModules.json`, fetched 2026-09-04; `expo-av` is absent from that list; the local `npx expo install` pin is authoritative)

## Related Work

**Implements**: #15 (closes #140 by keyword in the PR body) · **Epic**: #1, `docs/epics/sakta-cab.prd.md` §6:68 (fare/split MVP line), `docs/epics/sakta-cab.architecture.md` §"UI surface decisions"

**Back-references**:

- `.claude/plans/driver-app-auth-online-location.md` (#14 / PR #139): the app foundation, presence reducer, uploader, socket, push seam, today card.
- `.claude/plans/driver-toggle-off-mid-ride-held.md` (#141 / PR #142): why `presence-state.ts` is at its cap and on-ride state stays out of it.
- `.claude/plans/api-dispatch-engine.md`, `api-dispatch-close-double-assignment.md` (#10 / #61): cascade, accept/decline, one live card per driver.
- `.claude/plans/api-payments-ledger.md` (#11 / #12): the split, `earnings/today`.
- `.claude/plans/api-ride-lifecycle.md`: lifecycle endpoints, `DRIVER_STEPS`, `guardDriverStep`.
- `.claude/plans/rider-app-auth-booking.md` (#16 / PR #150): C1, the rider status screen that received no `ride:status` because its socket was never in the ride room; the driver read here joins for the same reason.

**Forward-references**: (none yet; file the two follow-ups named under Non-Goals when this PR opens)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Shared contracts (import, never redeclare):**

- `packages/shared/src/realtime-events.ts` (366 lines): 28 `RT` must stay the first `as const` block; 32–42 `RT`; 80–88 `driverQueueEventSchema` (84 `position` 1-based); 91–99 `rideStatusEventSchema` (`previousStatus`, `reason`); **101–119 `rideOfferEventSchema` = `rideOfferSchema.extend({ sentAt, expiresAt })` as ISO strings, with the docblock explaining why `Date.now() < payload.expiresAt` silently renders every offer expired** (T2 extends this schema); 122–128 `rideOfferRevokedEventSchema` (`reason: expired|taken|cancelled`); 139–151 `rideAssignedEventSchema` (to the ride room; the force-assign signal); 293–304 room helpers; 335–353 `ServerToClientEvents`; 356–366 `RT_EVENT_SCHEMAS` (the API parses every emit through it, `realtime.service.ts:81`).
- `packages/shared/src/schemas/ride.ts` (372): 28–39 `fareQuoteSchema` (cents only); 74–89 `rideRequestSchema` (`pickup`/`destination` are `addressPointSchema` = `{ location: { lat, lng }, address }`, `schemas/geo.ts:9-13`); 183–206 `rideOfferSchema` (`id, rideId, driverId, status, source, sentAt, expiresAt, etaSeconds, pickup, destination, quote, split, queuePosition?`; no payment method); 222–232 `isOfferSplitConsistent`; **235–272 `rideSchema`: 252 `paymentMethod` is the OPERATIVE method (docblock 244–251), `request.paymentMethod` at 82 is the immutable snapshot; 254 `quote` nullable; 257 `split` "written at completion, null until then"**; 274–314 the predicates. Shipped precedent: `settlement.service.ts:254` `const method = ride.paymentMethod`.
- `packages/shared/src/enums.ts`: 10 `PAYMENT_METHOD_TYPES`; 71–77 `OFFER_STATUSES` (`pending|accepted|declined|expired|revoked`).
- `packages/shared/src/commission.ts`: 32–41 `resolveCommissionPct`; 51–63 `fareSplitSchema` (`commission + net === total` refined). `money.ts:31` `commissionPctSchema` is a percent double, no `.int()`; 40–42 `commissionCentsFor` (T6 adds `formatEur` beside it). There is no `15` in shipped source (`db/src/seed/riga.ts:178,184` only).
- `packages/shared/src/ride-state-machine.ts` (179): 35–40 `ACTIVE_DRIVER_RIDE_STATUSES`; 67–137 `ALLOWED_TRANSITIONS` (85 `offered → requested`; 98–110 the dispatcher release from `accepted`/`arriving`; **130 `in_progress: ['completed', 'cancelled_by_dispatcher']`**); 153 `assertTransition`; 169 `isPaymentMethodLocked`. New home for `DRIVER_STEPS` (T1).
- `packages/shared/src/schemas/platform-config.ts:40` `offerTimeoutSeconds` default 20 (config, not a constant).
- `packages/shared/src/schemas/driver.ts` (87): 10–32 `driverProfileSchema` (11 `userId`; 12 `status`; 22 `rating` is the driver's); 58–62 `driverMeSchema` (T3 adds `activeRideId`); 81–87 `driverEarningsTodaySchema` (aggregate, net of commission).
- `packages/shared/src/schemas/auth.ts:55-57` `jwtClaimsSchema.role` (the role branch in T5).
- `packages/shared/src/seams/push-provider.ts`: 8–13 `PushMessage` (`data` strings only, forwarded verbatim); 37–43 `send` never throws.
- i18n: `packages/shared/src/i18n.ts:26` the `satisfies` that pins `ru`/`en` to `lv`'s keys; `packages/shared/src/i18n/lv.ts` (386) 212–288 `driver.*`, 215–217 `push.offline_nudge_*`; `ru.ts` (313), `en.ts` (308); `isMessageKey`; parity test `packages/shared/tests/i18n.test.ts`. `apps/driver/locales/*.json` hold native permission strings only.
- `packages/shared/src/format-message.ts:21` `formatMessage(language, key, params)` (the API side of the push copy; the SMS keys with `{link}` prove the params path).

**API (read for request/response, error codes and the hook points):**

- `services/api/src/features/dispatch/dispatch.controller.ts`: 68–76 `POST offers/:offerId/accept` `@Roles('driver')` → `{ rideId }`; 79–86 `decline` → `{ ok: true }`. Identity from `user.sub`.
- `services/api/src/features/dispatch/dispatch.service.ts` (416): 95–110 candidates, tried set, busy set (108–109: one live card per driver); 118–127 `buildOffer`; 131–156 the offer transaction; **158 `this.notifier.emitOffer(offer)` after commit, with `found.ride.paymentMethod` in scope (T2/T6 hook)**; 182–245 `accept` (227 `emitAssigned`; 234–245 the offline-mid-offer seam); 267–300 `decline` (**279–296 `sendToBack` under try/catch: T7 hook**); 386 the sweeper's expiry check.
- `services/api/src/features/dispatch/dispatch-notifier.ts` (109): 29–45 `emitOffer` (serialises `sentAt`/`expiresAt`); 51–108 `emitAssigned` (66 JOIN BEFORE ANY EMIT; 77 `emitStatus`; 80 `ride:assigned` to the ride room; 91–98 `ride:offer_revoked` `'taken'` to losers). Post-commit tail, never throws: the pattern for T6/T7.
- `services/api/src/features/dispatch/strategies/geozone-queue.strategy.ts`: 23–31 DI constructor; **60–73 lazy enrolment (`joinBack` per newcomer): T7 hook**; 79–91 rank.
- `services/api/src/features/dispatch/queue/dispatch-queue.store.ts`: 4–24 `QueueSnapshotEntry`; 51–94 the port (`joinBack`, `sendToBack`, `leave`, `positions`, `snapshot`). `snapshot` is head-first, positions byte-identical to `positions()` (80–93). Nothing calls `leave` today.
- `services/api/src/features/dispatch/dispatch.module.ts` 36–68 (imports `DriversModule`, `GeozonesModule`, `RealtimeModule`; providers list).
- `services/api/src/features/dispatch/index.ts` 20–22 the `driver:queue` KNOWN GAP (retire in T7).
- `services/api/src/features/geozones/geozones.repository.ts`: 44–60 `findContaining`, 78–90 `listForCity` (`ResolvedGeozone` has `slug`); no by-id read (T7 adds `findById`). `geozones.service.ts:17` wraps the repository; `geozones/index.ts` exports `GeozonesService`.
- `services/api/src/features/auth/` roles guard (`roles.guard.ts` or the file `Roles` is defined beside): it already honours per-route metadata, because `RideLifecycleController` has no class-level role and its routes carry their own (`ride-lifecycle.controller.ts:37,84`). Whether it reads with `getAllAndOverride` (method wins) or `getAllAndMerge` (union), a method-level `@Roles('rider', 'driver')` under a class-level `@Roles('rider')` admits both roles; T5's spec pins that rather than the reflector call.
- `services/api/src/features/rides/rides.controller.ts`: 28–42 docblock (36–42: "no such actor exists for this read, so no per-route role is needed", which T5 retires); 43–44 class-level `@Roles('rider')`; 85–103 `GET :rideId` → `findForRider`, declared last and staying last.
- `services/api/src/features/rides/rides.service.ts` (**481 lines, at the cap: add nothing here**): 195–235 `findForRider` (join BEFORE the snapshot read; one 404 shape for missing and foreign).
- `services/api/src/features/rides/index.ts` 13–31 the "A DRIVER still has no ride read" KNOWN GAP (retire in T5); exports `RideLifecycleService`, `RidesRepository`.
- `services/api/src/features/rides/rides.module.ts` 24–41 (controllers, providers, exports).
- `services/api/src/features/rides/rides.repository.ts` (464): 93 `toRide` (split projected only when all five money columns are set); 308–345 `findWithQuote`.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` (115): 32 `@Controller('rides')` with per-route roles; **36–58 `arriving`/`arrived`/`start` → `{ ok: true }`**; 66–74 `complete` → `{ ride: Ride }` with the settled split; 83–84 cancel (four roles on one route); 101 payment-method patch.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts` (447): 64–71 constructor (already has `RealtimeService`, `RidesRepository`, `DriversService`); 90–115 `driverStep`; 130–175 `complete` (157 `writeSettledSplit`); **313–329 `guardDriverStep`: 404 `ride_not_found`, 403 `ride_not_yours`, 409 `ride_not_${from}`**; 111/154 409 `ride_transition_conflict` on a lost race.
- `services/api/src/features/rides/lifecycle/ride-lifecycle.policy.ts` 42–59 `DRIVER_STEPS` + docblock (moves in T1).
- `services/api/src/features/rides/ride-transition.service.ts`: 17–25 `TransitionedRide`; 94–116 `emitStatus` (after commit, never inside the tx).
- `services/api/src/features/drivers/drivers.service.ts` (406): 58–63 `getMe`; **274–320 `sendDueNudges`: the push pattern to mirror** (`no_token` skip, `formatMessage(row.language, …)`, `device_not_registered` → `setPushToken(null)`, warn on failure).
- `services/api/src/features/drivers/drivers.repository.ts` (398): 215–226 `hasActiveRide` (the rides-table read T3 turns into `findActiveRideId`).
- `services/api/src/features/drivers/presence/driver-presence.repository.ts` (94): 52–74 `findDueNudges` (the `pushToken` + `users.language` select to mirror); 88–93 `setPushToken`.
- `services/api/src/features/push/expo-push.provider.ts` 80–95: request body `{ to, title, body, data, priority: 'high', channelId: 'presence', sound: 'default' }`.
- `services/api/src/features/realtime/realtime.service.ts`: 22–35 `emitToRide`/`emitToDriver`; **64–69 `joinRideRoom` = `server.in(userRoom(userId)).socketsJoin(rideRoom)`: it reaches the sockets alive now, so a reconnected socket is NOT in any ride room**; `realtime.gateway.ts:140-150` handshake joins `userRoom` + `driverRoom` only (`room-policy.ts:34-35`).
- `services/api/test/harness.ts`: 426–436 `RecordingPushProvider` (`sent[]`); 479 `createTestApp`; 574 `insertUser`; 597–613 `connectClient(port, token)`; `dispatch.integration.spec.ts` (imports `AuthTokenService`, `DriversService`, drives `DispatchSweeper.tick()`; **reuse its own local helpers for driver sign-in, vehicle, online, position ping and rider booking rather than writing new ones**): the integration pattern to mirror.
- `services/api/src/features/ledger/earnings.controller.ts` 12–20 `GET /drivers/me/earnings/today` (10: "#15's per-ride statement lands beside it": Q1 = B, no endpoint; retire that comment's expectation in T22); `ledger.repository.ts:166-196` (184: `ride_fare` + `commission` only, so `earnedCents` is net); `ledger.policy.ts:12` `LEDGER_DAY_TIMEZONE`.

**Driver app (VSA; mirror these):**

- `apps/driver/src/features/location/location-task.ts` (102): 10–14 `RuntimeListener`; 16–24 `LocationRuntime`; 33–68 `createLocationRuntime` (48–50 `setSocket`; 58–66 `handleLocations`): T8 hook points. `fix-throttle.ts:21-28` `RawFix` (no `speed`). `location/index.ts` re-exports everything the new slices need (`getLocationRuntime`, `createLocationRuntime`, `InMemoryFixQueue`, `DriverSocket`).
- `apps/driver/src/features/location/socket.ts`: 13–16 `DriverSocket` typed both ways; 24–44 `createDriverSocket` (`autoConnect: false`).
- `apps/driver/src/features/availability/use-presence.tsx` (371): 68–97 provider; 108–237 the exhaustive `run` switch; **156–172 `connect_socket`: `runtime.setSocket(socket)` runs BEFORE `socket.connect()`, so a listener attached on `onSocket` sees every event**; 246–252 the runtime subscription; 307–328 `onBeforeSignOut` (315 bare `await deactivateKeepAwake`, no try/catch, unlike 190–195).
- `apps/driver/src/features/availability/presence-state.ts` (**499 lines**): 14–33 `PresenceState`; 162–482 `decide()` with no `default`; 484–499 `serverStatusEvent` folds `on_ride` into `server_online`.
- `apps/driver/src/features/availability/run-effects.ts` 13–26 (reuse as-is for the new effect runners).
- `apps/driver/src/features/availability/index.ts` exports `formatEur`, `EarningsCard`, `useEarnings`, `EARNINGS_REFRESH_MS`: the new slices import via this index; after T6 `format-eur.ts` is a re-export of the shared function and the index line is unchanged.
- `apps/driver/src/features/availability/earnings-card.tsx` 15–40; `use-earnings.ts` 19–55; `format-eur.ts` 6–12 (`Math.trunc`, never rounds; `format-eur.test.ts` stays as the pin); `home-screen.tsx` 30–112 (72 the card's slot) and 114–184 `bannerFor(state, t, act)` the pure state → props mapper to copy.
- `apps/driver/src/features/auth/use-session.tsx` (141): 20–31 `onBeforeSignOut` contract; 42–50 `live`; **99–113 `Promise.allSettled([...hooks])` then `clearSession()`**. `api-client.ts`: 36 `request<T>(method, path, { body?, schema? })`; 13 `ApiError` (`.code` is the api's snake code; 401 → `signOut`). `auth/index.ts` exports `ApiError`, `useSession`, `SessionProvider`.
- `apps/driver/src/features/push/register-push-token.ts` (71): 10 `PRESENCE_CHANNEL`; 31–34 the channel at `AndroidImportance.MAX`; **57–71 `installNotificationHandling`: 58–66 `setNotificationHandler` (foreground presentation), 67–69 `addNotificationResponseReceivedListener` (tap); no `addNotificationReceivedListener`, no `getLastNotificationResponseAsync`, tap always routes to `/`**. `push-registrar.tsx` (45): 24–27 tap wiring; 34–42 the sign-out DELETE hook.
- `apps/driver/src/features/onboarding/onboarding-state.ts` 1–14 `nextRoute`; `gate-screen.tsx` 10–38; `use-me.tsx` 22–27 (`me`, `status`, `refetch`; the fetch parses through `driverMeSchema`, so T3's field arrives typed).
- `apps/driver/src/features/i18n/error-key.ts` 7–10 (`driver.error.<code>` or generic); `i18n/index.ts` (`useT`, `T`, `tNow`, `errorMessageKey`).
- `apps/driver/src/components/Button.tsx` 13–26 props (`size: 'md' | 'lg'` = 44 / 56 px; focus ring 114); `Banner.tsx` 12–25 props, 43–51 live region + `announceForAccessibility`; `Screen.tsx`; `components/index.ts`.
- `apps/driver/src/app/_layout.tsx` (24): provider nesting `Session → Me → Presence → PushRegistrar + Stack`; `app/home.tsx:1` the one-line route re-export.
- `apps/driver/jest.setup.ts` (141): 66–79 `expo-notifications` mock (T9 adds two functions); 101–112 `expo-router` mock (`useRouter`, `useLocalSearchParams`, `Redirect`; T12 adds `usePathname`); 114–141 the warm-list (125–139 the primitives; `Modal`, `FlatList`, `Image`, `Animated` absent).
- `apps/driver/src/features/availability/use-presence.test.tsx` 40–67 `makeSocket`/`mockRuntime` fakes; `apps/driver/eslint.config.mjs` (`max-lines` 500, tests/scripts exempt; `no-console` allows `warn`/`error` in features).
- `apps/driver/app.json`: plugins, `ios.infoPlist` (T10 adds `LSApplicationQueriesSchemes`), `scheme: "saktacabdriver"`.

### New Files to Create

**`packages/shared`**: none (edits only).

**`services/api/src/features/`**:
- `dispatch/queue/queue-notifier.ts` + `queue-notifier.spec.ts` (T7).
- `dispatch/dispatch-notifier.spec.ts` (T6, unit).
- `rides/lifecycle/ride-read.integration.spec.ts` (T5; or extend `ride-lifecycle.integration.spec.ts` if that file exists and is under 800 lines).

**`apps/driver/src/features/offers/`**: `offer-state.ts`, `offer-state.test.ts`, `use-offers.tsx`, `use-offers.test.tsx`, `offer-card-props.ts`, `offer-card-props.test.ts`, `offer-card.tsx`, `offer-card.test.tsx`, `use-offer-alerts.ts`, `queue-position.tsx`, `queue-position.test.tsx`, `index.ts`.
**`apps/driver/src/features/active-ride/`**: `active-ride-state.ts`, `active-ride-state.test.ts`, `use-active-ride.tsx`, `use-active-ride.test.tsx`, `nav-links.ts`, `nav-links.test.ts`, `active-ride-screen.tsx`, `active-ride-screen.test.tsx`, `index.ts`.
**`apps/driver/src/features/earnings/`**: `receipt.tsx`, `receipt.test.tsx`, `earnings-screen.tsx`, `earnings-screen.test.tsx`, `index.ts`.
**`apps/driver/src/features/push/`**: `route-notification.ts`, `route-notification.test.ts`.
**`apps/driver/src/features/auth/`**: `use-session.sign-out.test.tsx` (#140).
**`apps/driver/src/app/`**: `offer.tsx`, `active-ride.tsx`, `earnings.tsx` (one-line re-exports).
**`apps/driver/scripts/make-offer-tone.mjs`** → generates `apps/driver/assets/sounds/offer-tone.wav` (committed).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `.claude/references/realtime-events.md`: every event's direction/room/schema; line 8 the `driver:queue` row to rewrite in T7; 17 "accept/decline are REST"; 24 no client-initiated join, ride rooms server-side.
- `.claude/references/ride-state-machine.md`: the diagram, the release edge, payment lock from `accepted`, `completed` vs `settled`.
- `.claude/references/dispatch-strategies.md`: the cascade, `offerTimeoutSeconds`, one live card per driver; `geozone_queue` FIFO; debt as a limit.
- `.claude/references/conventions.md`: commit/PR rules (`piv-commit`, `piv-create-pr` read it).
- `.claude/references/logging-standard.md`: event names (`dispatch.offer.push_sent`, `dispatch.queue.notify_failed` follow it); no addresses or phones in logs.
- `apps/driver/CLAUDE.md`: 18 route files are thin re-exports; 27 offers arrive with an expiry; 28 earnings; 29 i18n/a11y; 33 test rules; the TS `~5.9` / eslint `^9` pins; `npx expo install --check`. `apps/driver/AGENTS.md` (read the SDK 57 versioned docs first).
- `docs/research/driver-ux-evidence.md`: **§1.3 (23–26) the card's contents; §5.1 (104–106) the timer; §5.2 (108–110) speed gating at ~10 km/h; §5.3 (112–114) whole-card target, sound + flash + haptic, TalkBack/VoiceOver white space; §5.4 (116–120) deep-link, never build; §6.1 (124–126) the number plus an explanation for every deviation.** Binding input.
- `docs/ux-metrics-ledger.md:25-26` the two Driver rows this ticket's ACs bind to (queue position visible; receipt with constant arithmetic on 100% of trips).
- `docs/epics/sakta-cab.prd.md` §6:68 (fare shown + "you keep 85%" is the MVP line); §3 is the thesis, not the card spec.
- `docs/spikes/04-gps-field-test.md` §"Build & run" (18–32): the dev-client build recipe the device day needs after T10 adds two native modules.
- Expo SDK 57 (fetched 2026-09-04): [`expo-audio`](https://docs.expo.dev/versions/v57.0.0/sdk/audio/) `useAudioPlayer(require(asset))`, `player.loop`, `player.seekTo(0); player.play()`, `setAudioModeAsync({ playsInSilentMode: true })`, no config plugin for playback; `expo-av` is gone from SDK 57. [`expo-notifications`](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) `handleNotification(notification)` receives `request.content.data`, returns `{ shouldShowBanner, shouldShowList, shouldPlaySound, shouldSetBadge }` (`shouldShowAlert` deprecated); `addNotificationReceivedListener` (foreground receipt); `getLastNotificationResponseAsync()` (cold-start tap). [`expo-linking`](https://docs.expo.dev/versions/v57.0.0/sdk/linking/) `openURL`/`canOpenURL`; iOS needs `infoPlist.LSApplicationQueriesSchemes` for `canOpenURL` on `comgooglemaps`/`waze`; Android 11+ queries are handled by Expo. [`expo-haptics`](https://docs.expo.dev/versions/v57.0.0/sdk/haptics/) `notificationAsync(NotificationFeedbackType.Warning)`, `impactAsync(ImpactFeedbackStyle.Heavy)`.

### Patterns to Follow

**Naming/VSA**: kebab-case files; `*-state.ts` = pure reducer `decide(state, event) → { state, effects }` with an exhaustive `switch` and no `default`; `use-*.tsx` = provider + effect runner over `runEffects`; `*-screen.tsx` / `*-card.tsx` = view over a pure `*-props.ts` mapper; `index.ts` = the slice's public API; route files are one-line re-exports.
**INTENT vs FACT**: the app owns intent, the server owns fact. Never assume a local transition; the REST answer is authoritative for the step just taken; `ride:status` reconciles everything else.
**Contracts-first**: parse every socket payload (`rideOfferEventSchema.parse`, `rideStatusEventSchema.parse`, `rideAssignedEventSchema.parse`, `driverQueueEventSchema.parse`, `rideSchema` via `api.request({ schema })`); a parse failure is logged with `console.warn` and dropped, never thrown into React.
**Money**: integer cents; `formatEur` (now from `@taxi/shared`); render `FareSplit` fields, never recompute; tests read a config row or build a split through `splitFare`, never a literal 15.
**Post-commit tails on the API**: emit and push AFTER the transaction, inside try/catch, never throw (`dispatch-notifier.ts:14-18`).
**Logging**: structured objects with `event`, ids, `at`; no addresses, phones or free text.
**Tests**: jest-expo + RNTL 14 (async, `await findBy*`), colocated; native modules faked in `jest.setup.ts`; names carry `(expected)` / `(edge)` / `(failure)`; every slice ships ≥ 1 of each.
**a11y**: every interactive element ≥ 44 px (`Button size="md"`), labelled, focus ring; state changes announced via `Banner`'s live region or `AccessibilityInfo.announceForAccessibility`; cosmetic questions go to `.claude/references/ui-decisions.md`, one line each.

---

## IMPLEMENTATION PLAN

Phases run top to bottom unless marked otherwise.

### Phase 0: Shared contracts (T1–T4)

`DRIVER_STEPS` moves to shared; the wire offer gains `paymentMethod`; `DriverMe` gains `activeRideId`; i18n keys land in all three catalogs; `formatEur` moves to shared (inside T6, but do the shared half here). Everything below imports from here. **Run `pnpm --filter @taxi/shared build` after this phase** so the apps see the new exports.

### Phase 1: API (T5–T7)

**Depends on:** Phase 0.
**Independent of:** Phases 2–5 (the app is built against the contracts and fakes; both halves meet at the integration tests and Level 4).
Driver ride read (per-route role + join), `activeRideId`, the offer push, the queue notifier, and the two KNOWN GAP retirements.

### Phase 2: App plumbing (T8–T10)

**Depends on:** Phase 0. **Independent of:** Phase 1.
Location runtime listeners, push routing (`route-notification.ts` + registrar changes), new deps, jest mocks, the tone asset.

### Phase 3: Offers slice (T11–T14)

**Depends on:** Phase 2.

### Phase 4: Active-ride slice + gate + layout (T15–T19)

**Depends on:** Phase 2 (runtime `onSocket`), Phase 0 (`DRIVER_STEPS`, `activeRideId`). The offers slice hands over a `rideId` and the card's payment-method snapshot; build against `useActiveRide().open(rideId, expectedPaymentMethod)` from T16.

### Phase 5: Earnings slice (T20)

**Independent of:** Phases 3–4 (needs only `FareSplit`/`Ride` types and `useEarnings`). Parallelisable in a second worktree.

### Phase 6: #140 + CI budget + docs (T21–T22)

**Independent of:** Phases 1–5.

### Phase 7: Validation (T23)

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. Acceptance criteria are numbered AC1–AC12 in the ACCEPTANCE CRITERIA section.

### T1 · MOVE `DRIVER_STEPS` / `DriverStep` → `packages/shared/src/ride-state-machine.ts`

- **IMPLEMENT**: append `DRIVER_STEPS` (the four `{ from, to }` pairs, `as const satisfies Record<string, { from: RideStatus; to: RideStatus }>`) and `DriverStep` to `ride-state-machine.ts` with the policy's docblock (42–51). In `ride-lifecycle.policy.ts` delete 42–59; in `ride-lifecycle.service.ts:30-31` import both from `@taxi/shared`. Add a test in `packages/shared/tests/ride-state-machine.test.ts`: every `DRIVER_STEPS` pair is an edge of `ALLOWED_TRANSITIONS` (expected); the four `from` statuses are exactly `ACTIVE_DRIVER_RIDE_STATUSES` (edge).
- **PATTERN**: `ride-state-machine.ts:35-40` (`ACTIVE_DRIVER_RIDE_STATUSES` block).
- **GOTCHA**: `packages/shared/src/index.ts:3` is `export *` from this file, so nothing else changes. `ride-state-machine.ts` goes from 179 to ~200 lines.
- **VALIDATE**: `pnpm --filter @taxi/shared test ride-state-machine && pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC4 (the app's step table is the API's, by import).

### T2 · UPDATE `rideOfferEventSchema` += `paymentMethod` (wire only)

- **IMPLEMENT**: `realtime-events.ts:115-119` → `.extend({ sentAt, expiresAt, paymentMethod: z.enum(PAYMENT_METHOD_TYPES) })`, docblock line: "the operative `ride.paymentMethod` at emit time; the rider may still change it until the offer is accepted, so it is a snapshot, not a lock (see `isPaymentMethodLocked`); the app compares it with the accepted ride's method and announces a change". API: `DispatchNotifier.emitOffer(offer, paymentMethod)` adds the field; `dispatch.service.ts:158` passes `found.ride.paymentMethod`. Update the fixture in `packages/shared/tests/realtime-events.test.ts` and the `ride:offer` assertion in `dispatch.integration.spec.ts` (grep `RT.rideOffer`). Shared test: a wire offer without `paymentMethod` fails to parse (failure).
- **PATTERN**: `realtime-events.ts:101-119` (the extend + the ISO override rationale).
- **GOTCHA**: `rideOfferSchema` itself is untouched (it is the `ride_offers` insert shape). The app parses the wire event with `rideOfferEventSchema` first, then `rideOfferSchema.parse(payload)` for the `Date` domain object and carries `paymentMethod` beside it (T11's `PendingOffer` type).
- **VALIDATE**: `pnpm --filter @taxi/shared test realtime-events && pnpm --filter @taxi/api test dispatch`
- **SATISFIES**: AC5 (payment method on the card).

### T3 · UPDATE `driverMeSchema` += `activeRideId`; API fills it

- **IMPLEMENT**: `schemas/driver.ts:58-62` add `activeRideId: z.string().uuid().nullable().default(null)` with a docblock ("read from the rides table, never from `drivers.status`, for the reason at `rides.repository.ts:215-217`"). `drivers.repository.ts:215-226`: add `findActiveRideId(userId): Promise<string | null>` beside `hasActiveRide` (same predicate, `select({ id: rides.id })`). `drivers.service.ts:58-63` `getMe` returns it. Spec: `drivers.service.spec.ts` or the drivers integration spec: a driver with an `accepted` ride gets its id (expected); no ride → `null` (edge); a `completed` ride → `null` (edge).
- **PATTERN**: `drivers.repository.ts:215-226`.
- **GOTCHA**: `.default(null)` keeps every existing fixture parsing. The driver app's `useMe` parses through `driverMeSchema`, so no app change beyond T18.
- **VALIDATE**: `pnpm --filter @taxi/shared test driver && pnpm --filter @taxi/api test drivers`
- **SATISFIES**: AC10.

### T4 · ADD i18n keys to `lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: add to all three (Latvian is the reference; `ru`/`en` fail to compile without parity). Keys (params in braces):
  - `driver.offer.title`, `driver.offer.fare` `{amount}`, `driver.offer.you_keep` `{amount} {pct}`, `driver.offer.pickup` `{address}`, `driver.offer.destination` `{address}`, `driver.offer.eta` `{minutes} {km}`, `driver.offer.payment_cash`, `driver.offer.payment_card`, `driver.offer.countdown` `{seconds}`, `driver.offer.accept`, `driver.offer.decline`, `driver.offer.accepting`, `driver.offer.revoked_taken`, `driver.offer.revoked_expired`, `driver.offer.revoked_cancelled`, `driver.offer.a11y_card` `{amount} {net} {seconds}` (the whole-card label).
  - `driver.queue.position` `{position} {size} {zone}`.
  - `driver.ride.title_accepted`, `driver.ride.title_arriving`, `driver.ride.title_arrived`, `driver.ride.title_in_progress`, `driver.ride.step_arriving`, `driver.ride.step_arrived`, `driver.ride.step_start`, `driver.ride.step_complete`, `driver.ride.navigate_maps`, `driver.ride.navigate_waze`, `driver.ride.payment` `{method}`, `driver.ride.payment_changed` `{method}`, `driver.ride.released`, `driver.ride.cancelled` `{reason}`, `driver.ride.completed_title`, `driver.ride.reload`.
  - `driver.earnings.title`, `driver.earnings.today` `{amount} {rides}`, `driver.earnings.receipt_paid` `{amount}`, `driver.earnings.receipt_commission` `{amount} {pct}`, `driver.earnings.receipt_net` `{amount}`, `driver.earnings.none_yet`, `driver.action.earnings`.
  - `driver.error.offer_not_pending`, `driver.error.ride_not_accepted`, `driver.error.ride_not_arriving`, `driver.error.ride_not_arrived`, `driver.error.ride_not_in_progress`, `driver.error.ride_transition_conflict`, `driver.error.ride_not_yours`, `driver.error.ride_not_found`.
  - `push.offer_title`, `push.offer_body` `{amount}` (the API's copy, T6).
- **PATTERN**: `lv.ts:212-288`, `lv.ts:215-217`; `i18n.ts:26`.
- **GOTCHA**: `lv.ts` is 386 lines; ~46 keys keeps it under 500. Placeholder parity across languages is pinned by `tests/i18n.test.ts`. `driver.error.*` keys are the api's snake codes verbatim (`error-key.ts`).
- **VALIDATE**: `pnpm --filter @taxi/shared test i18n && pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC12.

### T5 · UPDATE `GET /rides/:rideId` in place: per-route `@Roles('rider', 'driver')` + driver branch

- **IMPLEMENT**: the route does not move (R1). In `rides.controller.ts:95-103` add `@Roles('rider', 'driver')` on `read`, inject `RideLifecycleService` beside `RidesService`/`RideQuoteService` (same module providers), and branch: `user.role === 'driver' ? this.lifecycle.findForDriver(user.sub, rideId) : this.rides.findForRider(user.sub, rideId)`; return type `Promise<Ride>` (the rider branch's `RiderVisibleRide` is assignable). `RideLifecycleService.findForDriver(driverId, rideId): Promise<Ride>`: `this.realtime.joinRideRoom(driverId, rideId)` in try/catch (log `ride.read.join_failed`), THEN `this.rides.findWithQuote(rideId)`; `!found || found.ride.driverId !== driverId` → `NotFoundException('ride_not_found')` (one shape, no existence oracle, as `findForRider`); return `found.ride` (split included when settled). Rewrite `rides.controller.ts:36-42` (an actor now exists; the per-route decorator is why the class role is not enough; the route still declares last) and the "A DRIVER still has no ride read" paragraph in `rides/index.ts:13-31`. Tests, in an integration spec: **"driver socket reconnects after accept → `GET /rides/:rideId` → `POST arriving` → `ride:status` arrives on the NEW socket" (connection order: connect socket A → accept (joins A) → close A → connect socket B → `POST arriving` → assert B got NOTHING → GET as the driver → `POST arrived` → assert B received `{ status: 'arrived', previousStatus: 'arriving' }`)** (expected + the C1 edge); a driver reading a ride assigned to someone else → 404 (failure); a rider token still gets 200 with `split: null` and a driver token on their own settled ride gets the split (expected, and the assertion that pins the guard semantics whichever reflector call it uses); a dispatcher token → 403 (failure); the spec that covers the rider read today (grep `.get(\`/rides/` under `services/api/src`) passes unchanged (regression).
- **PATTERN**: `rides.service.ts:195-235` (join before read, one 404); `ride-lifecycle.controller.ts:83-84` (a route listing several roles); `dispatch.integration.spec.ts` + `test/harness.ts:597` for the socket pattern.
- **GOTCHA**: no route registration changes: "DECLARED LAST" (`rides.controller.ts:91-94`) still holds and nothing new shadows a literal. `rides.service.ts` is at 481 lines: the driver branch goes in the lifecycle service (447). `JwtClaims.role` is `USER_ROLES`; a `dispatcher`/`admin` on this route is refused by `@Roles` before the branch. The guard reads method-level metadata today (`ride-lifecycle.controller.ts:37,84` prove it); under `getAllAndOverride` the method list replaces the class list, under `getAllAndMerge` it is unioned, and both admit `rider` and `driver`.
- **VALIDATE**: `pnpm --filter @taxi/api test rides`
- **SATISFIES**: AC1, AC9 (receipt recovery), AC10.

### T6 · ADD the offer push: `formatEur` to shared, `DriversService.sendPush`, `DispatchNotifier.emitOffer`

- **IMPLEMENT**: (a) `packages/shared/src/money.ts`: add `formatEur(cents: number): string`, the exact body of `apps/driver/src/features/availability/format-eur.ts:6-12` (integer arithmetic, `Math.trunc`, symbol first, dot decimal) with its docblock; `apps/driver/.../format-eur.ts` becomes `export { formatEur } from '@taxi/shared';` (its test stays and now pins the shared function; `availability/index.ts` unchanged). (b) `driver-presence.repository.ts`: `findPushTarget(userId): Promise<{ pushToken: string | null; language: Language } | undefined>` (the `findDueNudges` select for one id). (c) `drivers.service.ts`: `async sendPush(driverId, build: (language: Language) => PushMessage, event: string): Promise<void>`: no row or no token → `logger.log({ event: \`${event}_skipped\`, driverId, reason: 'no_token', at })`; send; `device_not_registered` → `presence.setPushToken(driverId, null)`; failure → warn; never throws. (d) `DispatchNotifier.emitOffer(offer, paymentMethod)`: after the socket emit, `void this.drivers.sendPush(offer.driverId, (language) => ({ title: formatMessage(language, 'push.offer_title'), body: formatMessage(language, 'push.offer_body', { amount: formatEur(offer.split.driverNetCents) }), data }), 'dispatch.offer.push')` where `data = { kind: 'offer', offerId: offer.id, rideId: offer.rideId, expiresAt: wire.expiresAt, ...(Buffer.byteLength(json, 'utf8') <= 2048 ? { offer: json } : {}) }` and `json = JSON.stringify(wire)` (the same object the socket got). Fire-and-forget with `.catch(() => undefined)` so the sweeper tick never waits on Expo's 5 s timeout. Inject `DriversService` into `DispatchNotifier` (`DispatchModule` already imports `DriversModule`, which exports the service). Specs: `dispatch-notifier.spec.ts` (new, unit, fake `DriversService`): push sent with `data.kind === 'offer'` and `data.offer` parsing through `rideOfferEventSchema` (expected); a 2,100-byte address → `data.offer` absent, ids present (edge); provider failure → no throw (failure). Integration (`dispatch.integration.spec.ts`): after `tick()` the harness's `RecordingPushProvider.sent` holds one message for the offered driver. Shared: `money.test.ts` gains `formatEur(1240) === '€12.40'`, `formatEur(-186) === '-€1.86'`, `formatEur(5) === '€0.05'`.
- **PATTERN**: `drivers.service.ts:274-320`; `dispatch-notifier.ts:29-45`; `harness.ts:426-436`.
- **GOTCHA**: Expo's push payload limit is 4,096 bytes (`derived`: title + body ≤ ~120 B, ids + kind ≤ ~200 B, so `offer` ≤ 2,048 B leaves headroom; addresses are the only unbounded strings, `addressPointSchema.address` has no max). `data` values must be strings. `drivers.service.ts` is 406 lines; `sendPush` is ~30. The push reuses the `presence` channel; log the naming question in `ui-decisions.md`. `money.ts` stays a types-and-integers file: no `Intl`, no locale.
- **VALIDATE**: `pnpm --filter @taxi/shared test money && pnpm --filter @taxi/driver test format-eur && pnpm --filter @taxi/api test dispatch`
- **SATISFIES**: AC6.

### T7 · CREATE `dispatch/queue/queue-notifier.ts` and emit `driver:queue`

- **IMPLEMENT**: `@Injectable() QueueNotifier { constructor(@Inject(DISPATCH_QUEUE_STORE) queue, GeozonesService geozones, RealtimeService realtime) }` with `async broadcast(geozoneId): Promise<void>`: `snapshot(geozoneId)`; `geozones.findById(geozoneId)` (add `GeozonesRepository.findById(id): Promise<ResolvedGeozone | undefined>` and a `GeozonesService.findById` passthrough; unknown zone → warn + return); for every entry `realtime.emitToDriver(entry.driverId, RT.driverQueue, { driverId, geozoneId, geozoneSlug, position: entry.position, size: entries.length, at })`. Whole body in try/catch, warn `dispatch.queue.notify_failed`, never throws. Call sites: `geozone-queue.strategy.ts:68` after the newcomer loop (`if (newcomers.length) await this.queueNotifier.broadcast(zoneId)`); `dispatch.service.ts:286` after `sendToBack`. Register in `dispatch.module.ts` providers. Rewrite `dispatch/index.ts:20-22` (the gap is closed; say what still is not: no zone-entry enrolment, so the first event a driver sees is when dispatch first ranks them) and `.claude/references/realtime-events.md:8`. Specs: `queue-notifier.spec.ts` with `InMemoryDispatchQueueStore` + a recording realtime fake: three queued drivers → three events, positions 1..3, `size` 3, each parsing under `driverQueueEventSchema` (expected); empty queue → no emit (edge); realtime throws → no throw (failure). `dispatch.service.spec.ts`: decline on a `geozone_queue` offer → `broadcast` called with the ride's zone; `auto_match` → not called.
- **PATTERN**: `dispatch-notifier.ts:14-45`; `dispatch-queue.store.ts:80-93` (`snapshot`); `realtime.service.ts:30-35`.
- **GOTCHA**: emit every driver in the zone, not only the mutated one: a `sendToBack` shifts everyone behind. `RealtimeService.emit` parses through `RT_EVENT_SCHEMAS`, so a bad payload throws inside the try. Sweeper `tick()` is sequential; ≤ 10 drivers per zone at pilot means one `LRANGE` + ≤ 10 emits per mutation (`expected`).
- **VALIDATE**: `pnpm --filter @taxi/api test dispatch`
- **SATISFIES**: AC8.

### T8 · UPDATE `location-task.ts` + `fix-throttle.ts`: `onSocket`, `onLatestFix`, `speed`

- **IMPLEMENT**: `RawFix.coords` gains `speed?: number | null` (m/s; iOS `-1` = unknown). `RuntimeListener` gains `onSocket?(socket: DriverSocket | null): void` and `onLatestFix?(fix: LatestFix): void` with `export interface LatestFix { lat: number; lng: number; speedMps: number | null; atMs: number }` (speed `null` when absent, `null`, or `< 0`). `setSocket` notifies listeners after assigning; `handleLocations` notifies `onLatestFix` from the LAST raw location BEFORE throttling (so speed is fresh every OS delivery, ~1 s, while the wire stays at 4 s). Export `LatestFix` from `location/index.ts`. Tests in `location-task.test.ts`: `setSocket(s)` → listener sees `s`, `setSocket(null)` → `null` (expected); a throttled-away location still updates `onLatestFix` (edge); `speed: -1` → `speedMps: null` (edge).
- **PATTERN**: `location-task.ts:33-68`; `location-task.test.ts` (existing fake queue usage).
- **GOTCHA**: `use-presence.tsx:246-252` subscribes with the existing three callbacks and is unaffected (all optional). Nothing here may import a React component.
- **VALIDATE**: `pnpm --filter @taxi/driver test location-task`
- **SATISFIES**: AC5 (distance, glance mode), AC1/AC4 (listener attachment).

### T9 · CREATE `push/route-notification.ts`; UPDATE `register-push-token.ts`, `push-registrar.tsx`, `jest.setup.ts`

- **IMPLEMENT**: pure `routeNotification(data: unknown): NotificationRoute` returning `{ kind: 'offer', offer: RideOfferEvent | null, offerId, rideId } | { kind: 'gate' }`: `kind === 'offer'` with a `data.offer` string that `JSON.parse`s and passes `rideOfferEventSchema.safeParse` → the parsed event; malformed or absent → `offer: null`; anything else → `gate`. `installNotificationHandling({ onTap, onReceived })`: `setNotificationHandler` returns `shouldShowBanner/shouldPlaySound: false` when `data.kind === 'offer'` and `AppState.currentState === 'active'` (the socket path already showed and sounded it), `true` otherwise; `addNotificationResponseReceivedListener` → `onTap(routeNotification(response.notification.request.content.data))`; `addNotificationReceivedListener` → `onReceived(routeNotification(...))`; on install, `getLastNotificationResponseAsync()` → `onTap` once (cold start). `PushRegistrar` takes the two callbacks from `useOffers()` (T12): `offer` with a payload → `offers.receive(offer)` then `router.push('/offer')`; `offer` without a payload → `router.push('/offer')` (the card shows whatever is pending, or the screen redirects home); `gate` → `router.replace('/')` as today. Add `addNotificationReceivedListener` and `getLastNotificationResponseAsync` (resolving `null`) to the `expo-notifications` mock at `jest.setup.ts:66-79`. Tests: `route-notification.test.ts` (offer with JSON → parsed event (expected); offer with 3 KB payload dropped server-side → `offer: null` (edge); `kind: 'offline_nudge'` → gate; junk JSON → `offer: null` (failure)); extend `register-push-token.test.ts` (handler suppresses an active-state offer banner; a nudge still shows).
- **PATTERN**: `register-push-token.ts:57-71`; `push-registrar.tsx:24-27`.
- **GOTCHA**: `PushRegistrar` must be mounted INSIDE `OffersProvider` (T19). `data` values are strings. `getLastNotificationResponseAsync` fires the same response again on every mount of the registrar: guard with a ref so a cold-start tap routes once.
- **VALIDATE**: `pnpm --filter @taxi/driver test push`
- **SATISFIES**: AC6.

### T10 · ADD deps, tone asset, `app.json` schemes, jest mocks, dev-client rebuild note

- **IMPLEMENT**: in `apps/driver`: `npx expo install expo-audio expo-haptics` (expected pins `~57.0.4` and `~57.0.2`; whatever `expo install` writes is the pin), then `npx expo install --check` (must report nothing; never `--fix`). `scripts/make-offer-tone.mjs` (node, no deps): writes `assets/sounds/offer-tone.wav`, 16-bit mono 22.05 kHz, 1,000 ms = 150 ms 880 Hz sine + 850 ms silence; commit the WAV; add `"make:tone": "node scripts/make-offer-tone.mjs"` to `package.json`. `app.json` `ios.infoPlist.LSApplicationQueriesSchemes: ["comgooglemaps", "waze"]`. `jest.setup.ts`: mock `expo-audio` (`useAudioPlayer: () => ({ play, pause, seekTo, loop: false, remove })`, `setAudioModeAsync`) and `expo-haptics` (`notificationAsync`, `impactAsync`, `NotificationFeedbackType`, `ImpactFeedbackStyle`); add `Modal` and `Animated` to the warm-list only if T13 uses them. Neither package needs a config plugin for what this ticket uses (playback, haptics), so `app.json` `plugins` is unchanged. **Two new native modules mean the dev client must be rebuilt** (`docs/spikes/04-gps-field-test.md` §"Build & run", 18–32) before the device day; CI needs only the jest mocks. Say so in the PR body.
- **PATTERN**: `apps/driver/CLAUDE.md` install rules; `jest.setup.ts:61-64` (small mocks).
- **GOTCHA**: the eslint `max-lines` exemption covers `**/scripts/**`; `no-console` does not apply outside `src/features`. Keep `typescript ~5.9` and `eslint ^9` pinned (`expo install --check` excludes `typescript` via `expo.install.exclude`). Both packages are in the SDK 57 bundled list (`observed`, see Feature Metadata), so `expo install` cannot introduce an SDK mix.
- **VALIDATE**: `cd apps/driver && npx expo install --check && pnpm typecheck && pnpm lint && pnpm test`
- **SATISFIES**: AC5 (sound, haptic), AC4 (nav).

### T11 · CREATE `offers/offer-state.ts` (+ test)

- **IMPLEMENT**: `export interface PendingOffer { offer: RideOffer; paymentMethod: PaymentMethodType; receivedAtMs: number; durationMs: number }` where `durationMs = expiresAt.getTime() - sentAt.getTime()` (server-relative; immune to phone clock skew). State `{ phase: 'idle' | 'pending' | 'accepting' | 'declining'; pending: PendingOffer | null; remainingMs: number; banner: 'taken' | 'expired' | 'cancelled' | 'error' | null; errorCode: string | null; speedMps: number | null; queue: DriverQueueEvent | null }`. Events: `offer_received(pending)`, `tick(nowMs)`, `accept_pressed`, `accepted(rideId)`, `decline_pressed`, `declined`, `rejected(code)`, `revoked(offerId, reason)`, `queue(event)`, `speed(mps)`, `banner_dismissed`. Effects: `post_accept(offerId)`, `post_decline(offerId)`, `open_ride(rideId, paymentMethod)`, `route_offer`, `route_home`, `alert_start`, `alert_stop`, `announce(key)`. Rules: `offer_received` with the same `offer.id` as the pending one is a no-op (push + socket both deliver); an offer whose `durationMs - (nowMs - receivedAtMs) <= 0` at receipt is dropped; a different id replaces the pending card; `tick` → `remainingMs = max(0, durationMs - (nowMs - receivedAtMs))`, at 0 → `idle` + `banner: 'expired'` + `alert_stop` + `route_home` (no decline call: the server's sweeper owns expiry); `accept_pressed` only from `pending` with `remainingMs > 0` → `accepting` + `post_accept`; `accepted` → `idle` + `alert_stop` + `open_ride(rideId, pending.paymentMethod)`; `rejected` → `idle` + banner `'error'`/`'taken'` (`offer_not_pending` → `taken`) + `route_home`; `revoked` for the pending id → `idle` + banner per reason; for another id → no-op.
- **PATTERN**: `presence-state.ts:162-482` (exhaustive switch, `Decision` shape); `presence-state.test.ts`.
- **IMPORTS**: `RideOffer`, `DriverQueueEvent`, `PaymentMethodType` from `@taxi/shared`.
- **GOTCHA**: the reducer only ever sees a parsed `RideOffer` (`Date`s); the effect runner parses. No `Date.now()` inside the reducer; time arrives on `tick`. Tests: receive → pending with `remainingMs === durationMs` (expected); tick to zero → expired, no `post_decline` effect (edge); accept after zero → no effect (failure); duplicate id → identical state (edge); stale offer at receipt → dropped (edge); `rejected('offer_not_pending')` → `taken` (failure); `accepted` carries the card's payment method into `open_ride` (expected).
- **VALIDATE**: `pnpm --filter @taxi/driver test offer-state`
- **SATISFIES**: AC1, AC2, AC3, AC7.

### T12 · CREATE `offers/use-offers.tsx` (`OffersProvider`, `useOffers`) (+ test)

- **IMPLEMENT**: provider holding the T11 reducer with `dispatch` + `runEffects` (mirror `use-presence.tsx:68-97`). Subscribes `getLocationRuntime().subscribe({ onSocket, onLatestFix })`: on a non-null socket attach `socket.on(RT.rideOffer, …)`, `socket.on(RT.rideOfferRevoked, …)`, `socket.on(RT.driverQueue, …)`; each handler `safeParse`s through the matching `RT_EVENT_SCHEMAS[...]`/`rideOfferEventSchema`, warns and drops on failure, else dispatches (`offer_received` built as `{ offer: rideOfferSchema.parse(payload), paymentMethod: payload.paymentMethod, receivedAtMs: Date.now(), durationMs }`); detach on `null` or unmount (`socket.off` per handler). A 1 s `setInterval` while `phase !== 'idle'` dispatches `tick`. Effects: `post_accept` → `api.request('POST', \`/dispatch/offers/${offerId}/accept\`, { schema: z.object({ rideId: z.string().uuid() }) })` → `accepted(rideId)`; `ApiError` → `rejected(code)`; `post_decline` symmetric → `declined` (any error → `declined` too; the card is gone either way); `open_ride` → `activeRide.open(rideId, paymentMethod)` (T16) then `router.replace('/active-ride')`; `route_offer` → `router.push('/offer')` unless `usePathname() === '/offer'`; `route_home` → `router.replace('/home')` if on `/offer`; `alert_*` → `useOfferAlerts` (T13). Exposes `{ state, accept, decline, dismissBanner, receive(offerEvent) }` (`receive` is the push path's entry, T9). Add `usePathname: () => '/home'` to the `expo-router` mock (`jest.setup.ts:101-112`). Tests (`use-offers.test.tsx`, RNTL, fake runtime with a captured `onSocket` and a fake socket whose `on` stores handlers): **"an offer emitted on the socket the runtime handed over renders the card with the fare" (expected; attach order: provider mounts → runtime `setSocket(socket)` → server-style `handlers['ride:offer'](wirePayload)` → `await findByText(/€12\.40/)`)**; expired offer → no `POST accept` on tap (edge); accept 409 `offer_not_pending` → `driver.offer.revoked_taken` banner, no crash (failure); the push path `receive()` with the same id after the socket → one card (edge).
- **PATTERN**: `use-presence.tsx:68-97, 156-172`; `run-effects.ts`; `use-presence.test.tsx:40-67`.
- **IMPORTS**: `getLocationRuntime`, `DriverSocket`, `LatestFix` (`@/features/location`); `useSession`, `ApiError` (`@/features/auth`); `RT`, `RT_EVENT_SCHEMAS`, `rideOfferEventSchema`, `rideOfferSchema` (`@taxi/shared`); `useActiveRide` (`@/features/active-ride`); `useRouter`, `usePathname` (`expo-router`).
- **GOTCHA**: never emit accept for a cleared/expired offer (the reducer refuses; the runner just executes effects). The app's test replaces the socket with a handler map: that pins wiring; delivery is proven by the API integration tests (T5/T6/T7) and Level 4, and the plan says so in TESTING STRATEGY. `socket.io-client`'s typed `on` needs the handler typed `(payload: RideOfferEvent) => void`; parse anyway.
- **VALIDATE**: `pnpm --filter @taxi/driver test use-offers`
- **SATISFIES**: AC1, AC2, AC3, AC6, AC8.

### T13 · CREATE `offers/offer-card-props.ts`, `offer-card.tsx`, `use-offer-alerts.ts` (+ tests)

- **IMPLEMENT**: `offerCardProps(state, latest: LatestFix | null, t): OfferCardProps | null`: `fare = formatEur(offer.quote.totalCents)`, `youKeep = t('driver.offer.you_keep', { amount: formatEur(offer.split.driverNetCents), pct: 100 - offer.split.commissionPct })` (percent shown from the split, integer when whole), `pickupAddress`, `destinationAddress`, `eta = { minutes: Math.ceil(offer.etaSeconds / 60), km }` where `km` is the haversine from `latest` to `offer.pickup.location` in km to one decimal (a `haversineKm` in the same file; `null` without a fix), `payment = t(offer.paymentMethod === 'cash' ? 'driver.offer.payment_cash' : 'driver.offer.payment_card')` (see `PAYMENT_METHOD_TYPES` for the exact members), `seconds = Math.ceil(remainingMs / 1000)`, `glance = speedMps !== null && speedMps > GLANCE_SPEED_MPS` (`GLANCE_SPEED_MPS = 10 / 3.6`, `derived`: evidence §5.2 says ~10 km/h), `queue = t('driver.queue.position', …)` from `state.queue` or `offer.queuePosition`. `OfferCard`: `<Screen scroll={false}>`; the whole card is one `Pressable` with `accessibilityRole="button"`, `accessibilityLabel={t('driver.offer.a11y_card', …)}`, `onPress={accept}`, `minHeight` the full screen; inside: fare (largest type), you-keep line, payment method as a high-contrast pill above the fold, addresses + ETA + queue line hidden when `glance`; a `Button size="md" variant="secondary"` decline at the bottom (outside the accept pressable); countdown text with `accessibilityLiveRegion="polite"` updated every 5 s and at ≤ 5 s every second (not every tick: a screen reader announcing 20 numbers is noise); flash = card background alternating `colors.accent`/`colors.bgSurface` at 1 Hz while pending (≤ 3 Hz, photosensitivity). `useOfferAlerts(active: boolean, remainingMs)`: `setAudioModeAsync({ playsInSilentMode: true })` once; `useAudioPlayer(require('../../../assets/sounds/offer-tone.wav'))` with `loop = true`, `play()` on `active`, `pause()` + `seekTo(0)` off; `Haptics.notificationAsync(Warning)` on activation; `Haptics.impactAsync(Heavy)` on each second ≤ 5. Tests: `offer-card-props.test.ts` (fare/you-keep/pct from a split built with `splitFare(1240, resolveCommissionPct(driver, config))` and a 15% config row (expected); a 0% override renders "you keep €12.40 (100%)" (edge); no fix → `km: null` (edge); 12 km/h → `glance` (edge)); `offer-card.test.tsx` (accept target has the a11y label, decline button ≥ 44 px, payment pill present in glance mode).
- **PATTERN**: `home-screen.tsx:114-184` (pure mapper); `Button.tsx`; `Banner.tsx:43-51` (announce); `earnings-card.tsx` (live region).
- **IMPORTS**: `formatEur` (`@/features/availability`); `useT` (`@/features/i18n`); `Screen`, `Button` (`@/components`); `useAudioPlayer`, `setAudioModeAsync` (`expo-audio`); `* as Haptics` (`expo-haptics`); `colors`, `spacing`, `fontSize`, `radius` (`@taxi/shared`).
- **GOTCHA**: never recompute the split; never a literal 15 or 85 (the pct is `100 - commissionPct` from the split). Log three cosmetic lines in `ui-decisions.md`: flash colours, tone length/pitch, haptic cadence. `offer-card.tsx` stays under 500 lines by keeping the mapper and alerts in their own files.
- **VALIDATE**: `pnpm --filter @taxi/driver test offer-card`
- **SATISFIES**: AC5.

### T14 · CREATE `offers/queue-position.tsx`, `offers/index.ts`, `app/offer.tsx`

- **IMPLEMENT**: `QueuePosition({ queue }: { queue: DriverQueueEvent | null })` renders `driver.queue.position` (`position`, `size`, `zone = geozoneSlug`) or nothing; `accessibilityLiveRegion="polite"`. Also rendered on the home screen under the toggle (T19) so the position is "always visible" (ledger row 25), not only on a card. `index.ts` exports `OffersProvider`, `useOffers`, `OfferScreen` (the route view: `useOffers().state.phase === 'idle'` → `<Redirect href="/home" />`, else `<OfferCard …/>`), `QueuePosition`, `offerCardProps`, `decide as decideOffer`. `app/offer.tsx`: `export { OfferScreen as default } from '@/features/offers';`.
- **PATTERN**: `home-screen.tsx:55-59` (pill); `app/home.tsx:1`.
- **GOTCHA**: `position` is 1-based (`driverQueueEventSchema:84`); the view never adds 1. Hidden until the first event (T7's KNOWN GAP successor: no zone-entry enrolment).
- **VALIDATE**: `pnpm --filter @taxi/driver test queue-position && pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC8.

### T15 · CREATE `active-ride/active-ride-state.ts` (+ test)

- **IMPLEMENT**: state `{ rideId: string | null; expectedPaymentMethod: PaymentMethodType | null; ride: Ride | null; loading: boolean; busy: boolean; notice: 'payment_changed' | null; ended: { kind: 'released' | 'cancelled'; reason: string | null } | { kind: 'completed'; ride: Ride } | null; errorCode: string | null }`. Events: `open(rideId, expectedPaymentMethod?)`, `loaded(ride)`, `load_failed(code)`, `step_pressed`, `step_done(step)`, `step_failed(code)`, `completed(ride)`, `status(event: RideStatusEvent)`, `assigned(event: RideAssignedEvent, myDriverId)`, `socket_connected`, `foreground`, `dismissed`. Effects: `fetch_ride(rideId)`, `post_step(step, rideId)`, `post_complete(rideId)`, `route_ride`, `route_home`, `announce(key)`. Rules: `stepFor(status)` = the `DRIVER_STEPS` entry whose `from === status` (`accepted → arriving`, …, `in_progress → complete`); `step_pressed` with `busy` or no step → no-op; `step_done(step)` → `ride.status = DRIVER_STEPS[step].to` (REST is authoritative for the step just taken; `ride:status` will agree); **`loaded(ride)` with `expectedPaymentMethod !== null && ride.paymentMethod !== expectedPaymentMethod` → `notice: 'payment_changed'` + `announce('driver.ride.payment_changed')`, then `expectedPaymentMethod = null` so it fires once (R2: the rider switched between the card and acceptance; the lock at `accepted` makes the loaded value final)**; `status` for `rideId`: `previousStatus`/`status` both honoured, never ratcheted: `status ∈ ACTIVE_DRIVER_RIDE_STATUSES` → mirror; `'requested'` → `ended: released` + `route_home` (the dispatcher release, `ALLOWED_TRANSITIONS.accepted[1]`); `cancelled_*` → `ended: cancelled` with `reason`; `'completed'` while no `post_complete` answer yet → keep `ride.status = 'completed'` and wait (the receipt comes from REST; on `step_failed` after a timeout → `fetch_ride` re-read, whose `split` is set at completion, `ride-lifecycle.service.ts:157`); `status` for another ride id → ignore; `assigned` with `driverId === me` and `rideId !== state.rideId` → `open(rideId)` (Dina's force-assign arrives with no offer); `socket_connected`/`foreground` while `rideId` → `fetch_ride` (re-join + reconcile); `load_failed('ride_not_found')` → `ended: released`.
- **PATTERN**: `presence-state.ts:162-482`; `ride-state-machine.ts:67-137`.
- **IMPORTS**: `DRIVER_STEPS`, `ACTIVE_DRIVER_RIDE_STATUSES`, `Ride`, `RideStatusEvent`, `RideAssignedEvent`, `PaymentMethodType` from `@taxi/shared`.
- **GOTCHA**: `in_progress` allows `completed` and `cancelled_by_dispatcher` only (`ride-state-machine.ts:130`); no driver cancel anywhere in this slice. Do not assume monotonic status. Tests: each of the four steps maps to its endpoint and advances (expected); `status(accepted → requested)` clears and routes home (edge); `status` for a foreign ride is ignored (edge); `step_failed('ride_not_arrived')` → `errorCode`, ride intact (failure); force-assign `assigned` opens the ride (edge); `completed` via socket then `step_failed` → `fetch_ride` (edge); **`open(id, 'cash')` then `loaded(ride with paymentMethod 'card')` → `notice: 'payment_changed'` + announce, and a second `loaded` does not repeat it (edge)**; `open(id)` with no expectation → no notice (expected).
- **VALIDATE**: `pnpm --filter @taxi/driver test active-ride-state`
- **SATISFIES**: AC3, AC4, AC9, AC10.

### T16 · CREATE `active-ride/use-active-ride.tsx` (`ActiveRideProvider`, `useActiveRide`) (+ test)

- **IMPLEMENT**: provider + effect runner. Runtime subscription (`onSocket`): attach `RT.rideStatus` and `RT.rideAssigned` handlers (parse via `RT_EVENT_SCHEMAS`), and `socket.on('connect', () => dispatch({ type: 'socket_connected' }))`; `AppState` `'active'` → `foreground`. Effects: `fetch_ride` → `api.request('GET', \`/rides/${rideId}\`, { schema: rideSchema })` → `loaded` / `load_failed(code)`; `post_step` → `POST /rides/:rideId/{arriving|arrived|start}` → `step_done`; `post_complete` → `POST /rides/:rideId/complete` with `schema: z.object({ ride: rideSchema })` → `completed(ride)`; `ApiError` → `step_failed(code)`; `route_*` via the router; `announce` → `AccessibilityInfo.announceForAccessibility(t(key))`. Exposes `{ state, open(rideId, expectedPaymentMethod?), step(), dismiss() }`. On a cold start T18 calls `open(me.activeRideId)` from the gate (no expectation). Tests (`use-active-ride.test.tsx`): open → GET called with the id and the screen shows the pickup address (expected); a `socket_connected` re-fires GET (edge, the room re-join); `POST arriving` 409 `ride_not_accepted` → banner copy, status unchanged (failure); `complete` → receipt values from the returned `split` (expected).
- **PATTERN**: `use-presence.tsx:68-97`; T12.
- **IMPORTS**: `rideSchema`, `RT`, `RT_EVENT_SCHEMAS` (`@taxi/shared`); `useSession`, `ApiError` (`@/features/auth`); `useMe` (`@/features/onboarding`) for `me.profile.userId`; `getLocationRuntime` (`@/features/location`).
- **GOTCHA**: emit-after-commit means `ride:status` can precede or follow the REST answer; both orders are handled by the reducer (T15). The `GET` on every connect is what puts a reconnected socket in the ride room (`realtime.service.ts:64-69`); without it the driver is deaf to every later `ride:status`, exactly #16's C1.
- **VALIDATE**: `pnpm --filter @taxi/driver test use-active-ride`
- **SATISFIES**: AC4, AC9, AC10.

### T17 · CREATE `active-ride/nav-links.ts`, `active-ride-screen.tsx`, `index.ts`, `app/active-ride.tsx` (+ tests)

- **IMPLEMENT**: `nav-links.ts`: `googleMapsUrl({ lat, lng })` → Android `google.navigation:q=${lat},${lng}&mode=d`, iOS `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`, fallback `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`; `wazeUrl` → `waze://?ll=${lat},${lng}&navigate=yes`; `openNavigation(url, fallback)` = `Linking.openURL(url).catch(() => Linking.openURL(fallback))`; Waze button shown only when `Linking.canOpenURL(wazeUrl)` resolves true. Target = pickup while `status ∈ {accepted, arriving}`, destination from `arrived` on. `ActiveRideScreen`: header per status (`driver.ride.title_*`), payment method pill (`ride.paymentMethod`, never `ride.request.paymentMethod`), **a `Banner tone="warning"` with `driver.ride.payment_changed { method }` while `notice === 'payment_changed'` (dismissable; the pill already shows the locked value)**, pickup + destination (`ride.request.pickup.address`, `.destination.address`), fare (`ride.quote?.totalCents`), one primary `Button size="lg"` labelled `driver.ride.step_*` for `stepFor(ride.status)` with `loading={busy}`, nav buttons, an error `Banner` from `errorMessageKey(errorCode)` with retry, and the `ended` views: released/cancelled → banner + "back to home"; completed → `<Receipt split={ride.split} paymentMethod={ride.paymentMethod} />` (T20) + a done button → `/home`. `index.ts` exports `ActiveRideProvider`, `useActiveRide`, `ActiveRideScreen`, `decide as decideActiveRide`, `stepFor`. `app/active-ride.tsx` one-line re-export. Tests: `nav-links.test.ts` (URLs per platform, fallback on rejection); `active-ride-screen.test.tsx` (payment pill text for a `cash` ride (expected); button label follows status (expected); 409 → banner with `driver.error.ride_not_arrived` (failure); released → no step button (edge); `notice: 'payment_changed'` → the warning banner names the new method (edge)).
- **PATTERN**: `vehicle-screen.tsx:44-116` (`ApiError` branching + `Banner`); `home-screen.tsx:62-71` (the 56 px primary).
- **GOTCHA**: `Linking` from `react-native` is already used at `home-screen.tsx:3`; `expo-linking` adds nothing here. `canOpenURL('waze://…')` on iOS returns false without `LSApplicationQueriesSchemes` (T10). Every control ≥ 44 px, labelled, focus ring via `Button`.
- **VALIDATE**: `pnpm --filter @taxi/driver test active-ride`
- **SATISFIES**: AC4, AC5 (payment method), AC9.

### T18 · UPDATE `onboarding-state.ts`, `gate-screen.tsx` (+ test)

- **IMPLEMENT**: `GateRoute` += `'/active-ride'`; `nextRoute({ signedIn, vehicles, activeRideId: string | null })`: `!signedIn → /login`; `activeRideId → /active-ride`; `vehicles === 0 → /onboarding/profile`; else `/home`. `GateScreen` passes `me.activeRideId` and, when set, calls `useActiveRide().open(me.activeRideId)` before redirecting. Tests: a driver mid-ride with zero vehicles still lands on `/active-ride` (edge: the ride exists, the car was deleted); `null` → unchanged routes (expected).
- **PATTERN**: `onboarding-state.ts:1-14`; `onboarding-state.test.ts`.
- **GOTCHA**: `onboarding` now imports from `active-ride`'s index (one direction; `active-ride` must not import `onboarding`'s gate; it imports `useMe` only). `useMe` is already used by the gate.
- **VALIDATE**: `pnpm --filter @taxi/driver test onboarding-state gate`
- **SATISFIES**: AC10.

### T19 · UPDATE `app/_layout.tsx`, `home-screen.tsx`

- **IMPLEMENT**: nesting becomes `Session → Me → Presence → ActiveRideProvider → OffersProvider → (PushRegistrar + Stack)`. `PushRegistrar` receives `onOffer`/`onGate` from `useOffers()`/router (T9). Home: `<QueuePosition queue={useOffers().state.queue} />` under the toggle; `EarningsCard` gets `onPress={() => router.push('/earnings')}` (a `Pressable` wrapper with `accessibilityRole="button"`, label `driver.action.earnings`, `minHeight: 44`; it already is 44); an offers banner (`taken`/`expired`/`cancelled`/`error`) rendered through a second `bannerFor`-style mapper in the offers slice (`offerBannerFor`) so `home-screen.tsx` stays a composer. The `_layout.tsx` first import (`location-task`) stays first.
- **PATTERN**: `_layout.tsx:1-24`; `home-screen.tsx:39-45, 61`.
- **GOTCHA**: `OffersProvider` is inside `ActiveRideProvider` because `open_ride` calls `useActiveRide()`; `PushRegistrar` is inside both. Keep `presence-state.ts` untouched.
- **VALIDATE**: `pnpm --filter @taxi/driver test home-screen && pnpm --filter @taxi/driver typecheck`
- **SATISFIES**: AC6, AC8, AC9.

### T20 · CREATE `earnings/receipt.tsx`, `earnings-screen.tsx`, `index.ts`, `app/earnings.tsx` (+ tests)

- **IMPLEMENT**: `Receipt({ split, paymentMethod })`: three lines in this fixed order and no other: `driver.earnings.receipt_paid {amount: formatEur(split.totalCents)}`, `driver.earnings.receipt_commission {amount: formatEur(split.commissionCents), pct: split.commissionPct}`, `driver.earnings.receipt_net {amount: formatEur(split.driverNetCents)}`, plus the payment method line; `accessibilityRole="summary"`. `EarningsScreen`: `useEarnings(online)` day total (the existing hook, refreshed on focus) + the last completed ride's receipt held by `useActiveRide().state.ended` when `kind === 'completed'` (else `driver.earnings.none_yet`), + a back button. `index.ts` exports `Receipt`, `EarningsScreen`. Tests: `receipt.test.tsx` builds the split with `splitFare(1240, { pct: 15, source: 'platform' })` from a config-shaped input (not a bare 15 in the assertion: assert `commission + net === total` and that the rendered strings equal `formatEur` of each field) (expected); a 0% override renders `€0.00 (0%)` (edge); `formatEur(-186)` is `-€1.86` (existing test, cite it); `earnings-screen.test.tsx` renders the day total to the cent from a fixture `earnedCents: 8420, rideCount: 7` (expected) and the empty state (edge).
- **PATTERN**: `earnings-card.tsx`; `use-earnings.ts:40-52`.
- **IMPORTS**: `formatEur`, `useEarnings` (`@/features/availability`); `FareSplit`, `splitFare`, `driverEarningsTodaySchema` (`@taxi/shared`); `useActiveRide` (`@/features/active-ride`).
- **GOTCHA**: `earnedCents` is net of commission (`ledger.repository.ts:184`); never present it as gross. `formatEur` truncates. `commissionPct` is a double; render with `Number.isInteger(pct) ? pct : pct.toFixed(1)`.
- **VALIDATE**: `pnpm --filter @taxi/driver test earnings receipt`
- **SATISFIES**: AC9, AC12.

### T21 · CREATE `auth/use-session.sign-out.test.tsx` (#140); UPDATE `jest.setup.ts` warm-list

- **IMPLEMENT**: render `SessionProvider` (with a fake `api` whose `DELETE /drivers/me/push-token` rejects) → `PresenceProvider` with the real `use-presence` module but `@/features/location` mocked as in `use-presence.test.tsx:40-67`, plus a recording `queue.clear`, `uploader.stop`, `stopStreaming`, `deactivateKeepAwake`, `writeIntent`, and the offline `PUT`; bring presence to `intent: 'online'` (dispatch `toggle_pressed` through the provider's `toggle` with the permission mock granting), then `signOut()`. Assert: the presence chain ran in the order stop-stream → socket teardown → `uploader.stop` → `queue.clear` → keep-awake off → `writeIntent('offline')` → `PUT status offline` (a shared `calls: string[]` pushed by every fake); `queue.clear` ran although the push DELETE rejected (`Promise.allSettled`); `clearSession` ran last (expected + failure). A second test (edge): `deactivateKeepAwake` rejecting skips `writeIntent` and the PUT with current code; write it as `test.failing` (jest 29) so it documents the hazard at `use-presence.tsx:315` without failing the suite, and say so in the PR body for the reviewer to decide on a one-line `.catch`. Add any RN primitive a #15 screen introduced (`Modal`, `Animated`; `Pressable` is present) to `jest.setup.ts:125-139`.
- **PATTERN**: `use-presence.test.tsx`; `use-session.tsx:99-113`.
- **GOTCHA**: `testTimeout` is a global 20 s; the warm-list is the lever, not a timeout bump. Do not change `use-presence.tsx` in this ticket unless the reviewer asks (scope).
- **VALIDATE**: `pnpm --filter @taxi/driver test use-session`
- **SATISFIES**: AC11.

### T22 · UPDATE docs and comments whose subject this ticket retires

- **IMPLEMENT**: `apps/driver/CLAUDE.md` slices table += `offers`, `active-ride`, `earnings`, and the `push` row ("token registration, notification routing: offer → card, nudge → gate"); the earnings rule (28) now says `formatEur` comes from `@taxi/shared`; `.claude/references/realtime-events.md:8` (`driver:queue` now emitted by `QueueNotifier` on enrolment and demotion) and add a line under the join rule: "a driver's ride-room membership is re-established by `GET /rides/:rideId` on every socket connect, as the rider's is"; `services/api/src/features/dispatch/index.ts:20-22` and `rides/index.ts:13-31` (T5/T7 already rewrote them: re-read once more for leftover "never"/"no ride read" phrasing; grep `driver:queue`, `no ride read`, `#15`); `rides.controller.ts:36-42` (T5 rewrote it; confirm); `earnings.controller.ts:10` (the per-ride statement did not land beside it: say the receipt reads `ride.split` from `complete()` and `GET /rides/:rideId`, and that a history endpoint is unassigned); `.claude/references/ui-decisions.md` += the four cosmetic lines (push channel naming, flash colours, tone, haptic cadence); `docs/spikes/04-gps-field-test.md` += a `## #15 device day` section with the Level-4 steps below and the dev-client rebuild prerequisite; `docs/ux-metrics-ledger.md:25-26` status column → "shipped #15, device-day verification pending".
- **GOTCHA**: retire the SUBJECT, not the digits: grep the nouns (`driver:queue`, `never emitted`, `no ride read`, `per-ride statement`, `no such actor exists`) across `docs/`, `.claude/references/`, `services/api/src`, `apps/driver`.
- **VALIDATE**: `grep -rn "never emitted\|no ride read\|per-ride statement lands\|no such actor exists" services/api/src .claude/references docs apps/driver/CLAUDE.md` returns nothing.
- **SATISFIES**: AC12.

### T23 · Validate

- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/driver typecheck lint test && pnpm --filter @taxi/api typecheck lint test`, then the parity gate from cleared dist (see VALIDATION COMMANDS).

---

## TESTING STRATEGY

jest-expo + RNTL 14 in `apps/driver`; jest in `services/api` (unit + integration behind `createTestApp`); vitest in `packages/shared`. Colocated `*.test.ts(x)` / `*.spec.ts`; native modules faked in `jest.setup.ts`; no app test touches sqlite, the real socket or `expo-location`.

### Unit Tests

- Shared: `DRIVER_STEPS` ⊂ `ALLOWED_TRANSITIONS`; wire offer requires `paymentMethod`; `driverMeSchema.activeRideId` defaults null; `formatEur` three cases; i18n parity.
- API: `dispatch-notifier.spec.ts` (push payload, size guard, no throw); `queue-notifier.spec.ts`; `dispatch.service.spec.ts` (decline → broadcast); drivers `getMe.activeRideId`.
- App: T11 reducer (receive, tick/expire, accept gating, duplicate id, stale-at-receipt, revoke, 409 → taken, payment method carried into `open_ride`); T13 props (split-derived figures from a config row, 0% override, glance, km); T15 reducer (four steps, release, foreign ride, 409, force-assign, completed-then-timeout, payment-changed notice once); T17 nav URLs + the payment-changed banner; T18 gate; T9 `routeNotification`; T8 runtime listeners; T20 receipt arithmetic; T21 #140.

### Integration Tests

- **`ride-read.integration.spec.ts` (T5), the named socket test: "driver socket B, connected AFTER accept, receives `ride:status` only once `GET /rides/:rideId` has run"**. Order: driver socket A connects → rider books → sweeper `tick()` → driver accepts over REST (A joins the ride room) → A closes → socket B connects (handshake joins `driverRoom` + `userRoom` only) → `POST arriving` → assert B got NOTHING → `GET /rides/:rideId` as the driver → `POST arrived` → assert B received `ride:status { status: 'arrived', previousStatus: 'arriving' }`. This is the app's real order (reconnect, then re-read, then keep stepping), not the harness's convenient one. Same spec: rider 200 with `split: null`; driver 404 on a foreign ride; driver 200 with `split` on a settled own ride; dispatcher 403.
- `dispatch.integration.spec.ts` additions: after `tick()`, `RecordingPushProvider.sent[0].message.data.kind === 'offer'` and the `ride:offer` payload carries `paymentMethod` (T2/T6); a `geozone_queue` ride's enrolment emits `driver:queue` to the queued driver's socket with `position: 1` (T7).
- App (`use-offers.test.tsx`, T12): the wiring test named in T12. It replaces the socket with a handler map, which pins wiring only; delivery is proven by the API tests above and by Level 4.

### Edge Cases

- Offer expiry clears without a decline call → `offer-state.test.ts`.
- Offer already expired at receipt (late push) → dropped → `offer-state.test.ts`.
- Duplicate delivery (socket + push, same id) → one card → `offer-state.test.ts`, `use-offers.test.tsx`.
- `ride:offer_revoked` `taken`/`expired`/`cancelled` → card clears with the matching banner → `use-offers.test.tsx`.
- Accept vs revoke race → REST answer wins; 409 `offer_not_pending` → `taken` banner → `offer-state.test.ts`.
- Dark driver: server-side (`candidate-filter.ts:30`, #14 API specs); app half = no accept for a cleared/expired offer → `offer-state.test.ts`.
- Payment method changed between card and acceptance → notice once + banner → `active-ride-state.test.ts`, `active-ride-screen.test.tsx`.
- Dispatcher release `accepted|arriving → requested` → `active-ride-state.test.ts`.
- Force-assign with no offer (`ride:assigned`) → `active-ride-state.test.ts`.
- Reconnected socket deaf until re-read → `ride-read.integration.spec.ts` (API) + `use-active-ride.test.tsx` (GET on `socket_connected`).
- `complete` REST times out after the server committed → socket `completed` + re-read recovers the split → `active-ride-state.test.ts`.
- Cold start mid-ride with zero vehicles → `/active-ride` → `onboarding-state.test.ts`.
- Push payload too large → `offer: null`, tap still routes → `route-notification.test.ts` + `dispatch-notifier.spec.ts`.
- `queue.clear()` survives a rejected push DELETE → `use-session.sign-out.test.tsx`.
- Glance mode above 10 km/h → `offer-card-props.test.ts` (the visual gate on a moving phone is Level 4 step 9; no device-speed harness exists, stated).
- Speed unknown (`-1`/absent) → full card, never glance → `location-task.test.ts` + `offer-card-props.test.ts`.
- 0% commission override → receipt and card render the real pct → `receipt.test.tsx`, `offer-card-props.test.ts`.
- Rider and driver both allowed on `GET /rides/:rideId`, dispatcher refused → `ride-read.integration.spec.ts`.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared lint
pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint
pnpm --filter @taxi/driver typecheck && pnpm --filter @taxi/driver lint
cd apps/driver && npx expo install --check   # must print nothing to fix; never --fix
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/driver test
pnpm --filter @taxi/api test -- dispatch drivers   # unit specs
```

### Level 3: Integration Tests

```bash
docker compose up -d --wait
REDIS_TEST_URL=redis://localhost:6381 pnpm --filter @taxi/api test -- rides dispatch   # set the port to your REDIS_PORT
```

### Parity gate (before the PR)

```bash
rm -rf packages/*/dist services/api/dist apps/dispatch/.next
pnpm turbo run typecheck lint test build --force
```

Memory: `pnpm check` omits `build` and rides a warm dist; a red api suite hangs turbo rather than exiting (read the buffered log past ~3 min); concurrent sessions share the test DB, one gate at a time.

### Level 4: Manual Validation (device day; append to `docs/spikes/04-gps-field-test.md`, NOT run in this ticket)

Prerequisite: a dev client rebuilt after T10 (two new native modules), per the spike doc's "Build & run" section (18–32).

Means that already exist and produce the needed state: a provisioned dispatcher (`pnpm --filter @taxi/api provision:dispatcher +371…`), Dina's console phone-booking form (`apps/dispatch/src/features/phone-orders/booking-form.tsx`, `POST /dispatch/bookings` → the normal cascade, `bookings.service.ts:7-17`), the OTP code read from the API console (stub SMS). No new script is needed; the earlier draft's mint-offer script is withdrawn.

1. Device A: driver signed in, online, streaming (pill «Tiešraide»). No other driver online in the city.
2. Console: book a phone order with a pickup within ~2 km of device A. Expect within ~2 s: the full-screen card with fare, «you keep €X (85%)», pickup + destination, ETA + km, payment method pill, countdown starting near 20; tone playing, card flashing, one haptic.
3. Let it expire untouched. Expect: card clears at 0, banner «offer expired»; the console's board shows the cascade moving on (re-offer after `MAX_OFFER_ATTEMPTS` or unclaimed alert). Book again; accept with one tap on the card. Expect: active-ride screen at `accepted`, payment pill, «Arriving» button.
4. Background the app before a third booking. Expect: a push with the fare in the body; tapping it opens the card (if still within the countdown). Force-stop the app, book again, tap the push. Expect: the card renders from the notification payload; accepting works.
5. Walk «Arriving → Arrived → Start → Complete». Expect: each tap advances; the board mirrors each status; the maps button opens Google Maps at the pickup (then the destination from `arrived`); returning to the app shows the ride unchanged. Toggle airplane mode for 30 s mid-ride and back: expect the screen to re-read (spinner) and the next `ride:status` to arrive.
6. Complete. Expect: the receipt `Rider paid → Sakta (15%) → You` to the cent, equal to the ride's `split` row; `/earnings` shows today's total including this ride.
7. Console: force-assign a fresh booking to device A (override picker). Expect: the active-ride screen opens with no card shown first.
8. Console: reassign the ride to another driver while device A is `arriving`. Expect: device A shows «ride reassigned» and returns home.
9. Drive above 10 km/h with a pending offer (passenger seat). Expect: the card collapses to fare + you-keep + payment + accept/decline.
10. Kill the app ~75 s. Expect: no new offer reaches it; the «you've gone offline» push arrives; reopening re-asserts online (#14 behaviour unchanged).
11. Kill the app mid-ride, reopen. Expect: the gate lands on the active-ride screen at the right status.
12. With a geozone-queue pickup (RIX zone in the seed), two devices online in the zone: expect both to show «N. of 2 in rix» on home, updating when one declines.
13. Rider app on a second phone: book, and while device A's card is up switch the payment method from cash to card; device A accepts. Expect: the active-ride screen opens with the «card» pill and a one-time «payment method changed to card» banner, announced by the screen reader.

### Level 5: Additional Validation

None required.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1** Accept within the countdown: `POST /dispatch/offers/:offerId/accept` → `{ rideId }` → `GET /rides/:rideId` → active-ride screen at `accepted`. (expected)
- [ ] **AC2** Countdown expiry clears the card locally with no accept possible afterwards; the server's sweeper continues the cascade. (edge)
- [ ] **AC3** A stale/cancelled offer or ride (409 `offer_not_pending`, `ride_not_*`, `ride_transition_conflict`; 403 `ride_not_yours`) → a recoverable banner, never a crash. (failure)
- [ ] **AC4** Active ride walks `arriving → arrived → start → complete` through the four endpoints; the app mirrors and reconciles `ride:status` including the dispatcher release and cancellations; a force-assign opens the ride with no offer; a payment method that changed between the card and acceptance is announced once on entry.
- [ ] **AC5** The card shows: full fare, «you keep €X (pct)» from `offer.split`, pickup + destination, pickup ETA + straight-line km, payment method (wire snapshot), queue position when known, a server-relative countdown; whole-card accept target ≥ the screen, decline ≥ 44 px; tone + flash + haptic; glance mode above 10 km/h.
- [ ] **AC6** The API pushes every offer with `data.kind = 'offer'` and the wire offer when ≤ 2,048 B; a background tap opens the card, a cold-start tap hydrates it from the payload, a foreground duplicate is a no-op with its banner suppressed.
- [ ] **AC7** Dark detection respected: no fresh offer to a dark driver (server, unchanged); a pending offer expires normally in the app.
- [ ] **AC8** `driver:queue` is emitted to every driver in a zone on enrolment and demotion; the position is visible on home and beside the card.
- [ ] **AC9** Day total matches `GET /drivers/me/earnings/today` to the cent; the receipt shows `total → commission (pct) → net` from `ride.split` with `commission + net === total` and `ride.paymentMethod`; a timed-out `complete` recovers the receipt via `GET /rides/:rideId`.
- [ ] **AC10** Cold start mid-ride lands on `/active-ride` via `me.activeRideId`; every socket connect re-reads the ride, which re-joins the ride room (integration test named in T5); the rider path of `GET /rides/:rideId` is unchanged.
- [ ] **AC11** #140: the sign-out order test is green and `queue.clear()` survives a rejected push DELETE.
- [ ] **AC12** All new copy in `lv`/`ru`/`en`; every interactive element ≥ 44 px, labelled, focus ring; retired comments and docs rewritten (T22); parity gate green.

---

## COMPLETION CHECKLIST

- [ ] T1–T23 done in order, each VALIDATE green at the time
- [ ] Level 1–3 commands and the parity gate green from cleared dist
- [ ] Level 4 steps appended to the spike doc (not run)
- [ ] AC1–AC12 ticked with the test or step that proves each
- [ ] `piv-review-changes` clean; PR body re-derives every figure at HEAD (the 2,048 B guard, the 10 km/h threshold, the dependency pins, line counts) and names its provenance

---

## RISKS (each with the control that closes it)

- **R1 · Regressing the shipped rider read.** Closed by design: `GET /rides/:rideId` does not move; a per-route `@Roles('rider', 'driver')` is added and the rider branch is untouched (`findForRider` as before). Controls: the existing rider-read spec passes unchanged; the T5 spec asserts rider 200 (`split: null`), driver 200 on own ride, driver 404 on a foreign ride, dispatcher 403. Both known reflector semantics admit both roles (T5 GOTCHA).
- **R2 · Payment method changes between the card and acceptance.** Closed in-app: the card's snapshot travels with `open_ride`; the first `loaded` after acceptance compares it with the locked `ride.paymentMethod` and, on a difference, sets a one-time notice, shows a warning banner naming the new method and announces it to the screen reader (T15/T17, Level 4 step 13). The lock itself is unchanged.
- **R3 · New native modules on the SDK 57 pin line.** Closed by provenance and process: both packages are in SDK 57's bundled list (`expo-audio ~57.0.4`, `expo-haptics ~57.0.2`, `observed` on `expo/expo` `sdk-57` 2026-09-04), `npx expo install` writes the pins, `npx expo install --check` is a Level-1 gate, `typescript` stays excluded from that check, neither needs a config plugin, both are mocked in `jest.setup.ts`, and the dev client is rebuilt before the device day (T10, Level 4 prerequisite).
- **R4 · Line caps.** `rides.service.ts` (481) and `presence-state.ts` (499) receive nothing; every addition names its host file and current length (T3, T5, T6, T1). `max-lines` is an eslint error, so the gate catches a miss.
- **R5 · Cross-slice import direction.** `offers → active-ride → onboarding(useMe)`, `onboarding(gate) → active-ride`, `push → offers`; no cycle: `active-ride` never imports `offers`, `onboarding` or `push`. `pnpm --filter @taxi/driver typecheck` fails on a circular type import; eslint `import/no-cycle` is not configured, so keep the direction by hand.

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions**

- A1: The API already emits `ride:offer`, `ride:offer_revoked`, `ride:assigned`, `ride:status` (verified: `dispatch-notifier.ts:31/80/92`, `dispatch.service.ts:157`, `ride-transition.service.ts:109`). This ticket adds the phone consumer, the offer push, the queue emitter and the driver read.
- A2: `formatEur` moves to `@taxi/shared` (T6) and the driver file re-exports it; consumers keep importing through `@/features/availability`.
- A3: The offer push reuses the `presence` channel and the provider's hardcoded `priority`/`sound`; a distinct `offers` channel is a settings question logged in `ui-decisions.md`.
- A4: `DriverMe.activeRideId` is read from the rides table (`ACTIVE_DRIVER_RIDE_STATUSES`), never from `drivers.status`, so the offline-mid-offer accept seam (`dispatch.service.ts:234-245`) still routes the driver to their ride.
- A5: Q1 = Option B and Q2 = include `driver:queue` (Linards, 2026-09-04, see AMENDMENTS).
- A6: The roles guard honours method-level `@Roles` (proven by `ride-lifecycle.controller.ts:37,84`); T5's spec is the check, whichever reflector call it uses.

**Questions (ordering/timing answered with the worst case)**

- **Q3 (accept vs revoke):** worst case, the app shows «accepted» while the server revoked. Answer: the REST answer is authoritative; a 409 `offer_not_pending` clears the card as `taken`; there is no optimistic accepted state (the card stays `accepting` until the answer).
- **Q4 (countdown source):** worst case, the phone clock is minutes ahead and every offer renders expired. Answer: the countdown is `expiresAt - sentAt` (server-relative) anchored at local receipt; the residual error is one network latency L, so a tap in the last L ms gets a 409 and the recoverable banner (`derived`).
- **Q5 (`complete` REST vs socket `completed`):** worst case, the REST times out after the server committed and the receipt never shows. Answer: the reducer accepts `completed` from either side; a `step_failed` after a socket `completed` triggers a re-read, whose `split` is written at completion (`ride-lifecycle.service.ts:157`); if that read also fails the screen keeps a «reload» button, never a dead end.
- **Q6 (reconnect mid-ride):** worst case, the driver never receives another `ride:status` (Dina reassigns, the app keeps showing `arriving`). Answer: `GET /rides/:rideId` on every socket connect re-joins the room (T5/T16), pinned by the T5 integration test; on `foreground` the same read reconciles what was missed.
- **Q7 (push vs socket order):** worst case, an old offer's push arrives after a newer socket offer and replaces it. Answer: the reducer drops any offer already expired at receipt and ignores a duplicate id; a live older offer cannot exist because the server keeps one live card per driver (`dispatch.service.ts:108-109`).
- **Q8 (payment method changes after the offer):** worst case, the card said cash, the rider switched to card 3 s before accept, the driver accepted a card ride thinking cash and never learns. Answer (closed, R2): the driver learns on entering the active-ride screen, before moving: the locked value is on the pill and the change is banner-announced once. Not closed, by choice: refusing the rider's change while an offer is pending would move the lock earlier than `accepted` and is a rider-app product question.
- **Q9 (Dina's force-assign to a driver holding a card):** worst case, the driver sees a card AND an active ride at once. Answer: the server refuses to offer a busy driver but force-assign does not re-check the card (KNOWN GAP, ms-wide); the app lets `assigned` open the ride and clears any pending card with the `cancelled` banner.

## NOTES (open canvas)

- **Why the driver read stays in place rather than moving.** The two docblocks (`rides.controller.ts:36-42`, `rides/index.ts:13-31`) anticipated a move; a per-route decorator reaches the same end with zero route-registration change, so the rider path cannot regress by construction (R1). The docblocks are rewritten to say so. `rides.service.ts` is at the cap, so the driver branch lives in the lifecycle service and is injected into the controller.
- **Why the push carries the offer.** Without it a tap on a killed app lands on an empty screen (there is no pending-offer read, and adding one buys nothing during a 20 s window). With it, the push is a second delivery channel: whichever arrives first shows the card, the other is a no-op by id. The 2,048 B guard keeps the payload under Expo's 4,096 B with headroom (`derived`, see T6).
- **Why no decline on local expiry.** The local countdown ends ≥ the server's by one latency, so a decline would always hit an already-expired offer (409). The sweeper owns expiry (`dispatch.service.ts:386`).
- **Why `QueueNotifier` broadcasts the whole zone.** A `sendToBack` shifts everyone behind the demoted driver; emitting to the mutated driver alone would leave the others reading a stale number, which is the "unexplained skip" failure the evidence warns about (§6.1). At ≤ 10 drivers per zone the cost is one `LRANGE` and ≤ 10 room emits per mutation.
- **Why `formatEur` moves to shared now.** The push body is the first non-app consumer of the money string; two implementations of "€ + truncation" would drift on the first brand-copy change. The driver file re-exports so no import path changes and its test keeps pinning the behaviour.
- **`server_on_ride` is a myth to retire.** It appears only in #139's review as a proposed reducer state. Shipped code folds `on_ride` into `server_online` (`presence-state.ts:484-499`); offer and ride state live in their own slices.
- **The keep-awake throw hazard** (`use-presence.tsx:315`): `deactivateKeepAwake` is unwrapped in `onBeforeSignOut`; an Android throw skips the intent write and the offline PUT. T21 documents it as `test.failing`; the fix is one `.catch(() => undefined)` and is the reviewer's call, not this ticket's scope creep.
- **Commission is a double and `15` is seed-only** (`money.ts:31`, `db/src/seed/riga.ts:178`). Card and receipt render `split.commissionPct` and `100 - commissionPct`; tests build splits through `splitFare` from a config-shaped input.
- **Wire `expiresAt` is an ISO string**; `rideOfferSchema.parse(payload)` before any date math or every offer renders expired (`realtime-events.ts:101-114`).
- **Speed for glance mode** comes from the OS location object, not the 4 s throttled wire stream, so the gate reacts within ~1 s of the OS delivery cadence (`expected`; the throttle keeps the wire at 4 s).
- **CI**: `testTimeout` is a global 20 s; the `jest.setup.ts` warm-list is the lever. `apps/driver` gains two native deps, both mocked in the setup file.
- **Confidence basis (10/10 for one-pass, stated as a claim with its conditions).** Every cited line was read at `c70572b`; every gap has a task with a named host file under the cap; every ordering question has a worst-case answer and a test; R1–R5 each name the control that catches a miss; the two facts not readable from the repo in this session (the reflector call in the roles guard, the exact `expo install` pins) are both pinned by a test or a gate rather than by the plan's word. What would still break a first pass is outside the plan's reach: a `main` that moved past `c70572b` (re-run the provenance step), or the shared test DB being held by another session (one gate at a time).
- **Alternatives rejected**: a `Modal` overlay for the card instead of a route (routes are testable through the existing router mock and survive the gate); `expo-notifications` local notification as the tone (plays once, cannot loop for the card's lifetime, and would double with the server push); haversine €/km on the card (straight-line overstates the rate; wait for the quote to carry the routed distance); moving `GET /rides/:rideId` between controllers (R1); refusing payment changes during an offer (Q8).

## AMENDMENTS

- 2026-09-04 — Linards confirmed Q1 = Option B (no per-ride earnings endpoint; receipt = just-completed ride) and Q2 = include the driver:queue emit (Phase 2). Both match the plan as written; no scope change.
- 2026-09-04 — Second pass (planning session, `main` at `c70572b`): every citation re-verified. Corrected: `rideSchema` is 235–272 (not 235–314); the "written at completion" docblock is `ride.ts:257`; the i18n parity file is `packages/shared/src/i18n.ts:26` (there is no `src/i18n/i18n.ts`); the driver-step 409 is `guardDriverStep` at `ride-lifecycle.service.ts:313-329` → `ride_not_${from}` (not `:209 canTransition`, which is the cancel path); `in_progress` allows `completed` and `cancelled_by_dispatcher`; `arriving`/`arrived`/`start` return `{ ok: true }` (only `complete` returns `{ ride }`); the jest warm-list is 114–141; the mint script has no `onlineDriver`; PRD §3 is the thesis, the card spec is `driver-ux-evidence.md` §1.3. Added the seven verified gaps (driver ride read, `activeRideId`, offer push, queue emitter, wire `paymentMethod`, `DRIVER_STEPS` to shared, runtime listeners) as tasks. Withdrawn: the mint-offer dev script (the console's phone booking already produces the state), the `formatEur` relocation, rider rating / duration / €/km on the card (no contract), decline-on-expiry. Level 4 rewritten against existing means.
- 2026-09-04 — Third pass (Linards: "increase confidence to 10 and address all risks"). R1 closed by keeping `GET /rides/:rideId` in place with a per-route role (T5 rewritten; the reflector semantics are pinned by a spec, not assumed). R2 closed in-app: the card's payment-method snapshot travels into `open_ride`, the first `loaded` after acceptance compares and announces once (T11/T15/T17, `driver.ride.payment_changed`, Level 4 step 13). R3 closed with `observed` SDK 57 pins (`expo-audio ~57.0.4`, `expo-haptics ~57.0.2`, `expo-av` absent), the `expo install --check` gate, jest mocks and the dev-client rebuild prerequisite (T10). `formatEur` moves to `@taxi/shared` so the push body and the app format money identically (T6; A2 reversed from the second pass). R4/R5 (line caps, import direction) added with their controls. RISKS section added; confidence basis recorded in NOTES.
