# Feature: arrival-announce protocol — ride flag, driver prompt at `arrived`, rider "call out" request (#259)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every `file:line` below was read on `origin/main` at `d6deaa6` (2026-09-24). Re-read before editing; lines drift. Where this plan says **`observed`**, the check was run in the planning worktree `~/taxi-worktrees/wt-259` on 2026-09-24 and then reverted. Its evidence is in §De-risking record.

## Feature Description

A rider can opt in, per booking, to the **arrival-announce protocol**.

- When the ride reaches `arrived`, the driver app tells the driver to get out of the car and say aloud «Sakta, {rider name}!». If the rider has no name (every rider today, #269), the driver says «Sakta, uz {destination}!» instead.
- While the car is at `arrived`, the rider's status screen offers one button, «Palūgt šoferi pieteikties». Pressing it reaches the driver by three routes, deduplicated:
  - a socket event, which is live;
  - a push, for a backgrounded driver app;
  - a replay on the driver's next read of the ride, when the app returns to the foreground or reconnects.

  On any of these the driver's phone vibrates and shows «Pasažieris jūs meklē: izkāpiet un skaļi sauciet „Sakta”.»

The flag names a **procedure, not a diagnosis**. Nothing in the contract, database, logs or copy says "blind". Blind riders are who it is for (PRD §1, §5, anketa S5-8), but a sighted rider in a crowd can use it, and the platform never stores a disability.

**The horn is not part of it.** Latvian traffic rules, point 172 (in force), allow the horn in built-up areas only to prevent a dangerous situation. Point 170's light signals are visual and useless to a blind rider. The protocol is therefore voice-only.

## User Story

As a rider who cannot see which car is mine
I want the driver to get out and announce themselves when they arrive, and to be able to ask them to call out again
So that I can find my car at the kerb without looking at anything or asking strangers

## Problem Statement

`docs/research/rider-ux-evidence.md:21-22` names "which car is mine" and the last 50 feet as the flows that break for blind riders on every incumbent app. Its item 7 (`:134`) and `:30` specify the adaptation: a flag set at booking, a driver prompt, and a rider-triggered request. `.claude/plans/driver-offers-active-ride.md:52` deferred it out of #15. Nothing in the code carries it: grepping `blind`, `honk` and `announce` finds only `announceForAccessibility` calls (`observed` at `d6deaa6`). The PRD cites it as a reason the product wins (`sakta-cab.prd.md:13,26,60`).

## Solution Statement

- **Contract** (`@taxi/shared`):
  - `rideOptionsSchema.announceArrival: z.boolean().default(false)`.
  - A server→driver event, `RT.rideAnnounceRequested = 'ride:announce_requested'`, with payload `{ rideId, at }`. The catalog goes from 9 events to 10.
  - A push envelope, `announcePushDataSchema = { kind: 'announce_requested', rideId, at }`.
  - `driverRideSchema` gains `announceRequestedAt: string | null` (default `null`).
  - LV/RU/EN copy.
- **No migration.** Options live in the `request` jsonb snapshot (`db/src/schema/rides.ts:57-58`). A legacy row lacks the key and parses to `false`. The replay timestamp lives in Redis (KV) with a TTL, not in Postgres.
- **Reveal after accept only (D2), and it is structural.** The flag reaches a driver only through `driverRideSchema.request.options`, and that read is served only to the assigned driver (`lifecycle/driver-ride.ts:69-116`). `rideOfferSchema` (`schemas/ride.ts:194-217`) has no `request`. The offer has two legs, and each strips unknown keys by a different parse:
  - the socket leg: every emit is parsed through `RT_EVENT_SCHEMAS` (`realtime.service.ts:76-88`);
  - the push leg (`dispatch-notifier.ts:72-99`, `JSON.stringify(wire)`) is not parsed by `RealtimeService`. It is clean because `offer-builder.ts:64` builds the offer through `rideOfferSchema.parse`.

  An integration test checks both legs on the wire (T8).
- **Rider request**: `POST /rides/:rideId/announce-request`, rider-only. `ArrivalAnnounceService` runs these checks in order:
  1. owner, else 404 `ride_not_found`
  2. flagged, else 409 `announce_not_requested`
  3. `arrived` with a driver, else 409 `ride_not_arrived`
  4. at most 1 per ride per 20 s, else 429 `too_many_requests` with `retryAfterSeconds`

  It then records `at` in KV (TTL 600 s), emits to `driver:<id>`, sends a push, logs, and returns `{ ok: true }`.
- **Three delivery legs, one dedupe key.** The socket event, the push and the replay all carry the same `at`. The driver reducer keeps `lastAnnounceAt` and ignores a repeat. So a foreground driver with a live socket who also receives the push, then reconnects, gets one notice and one vibration.
- **Driver**:
  - The prompt is derived in render from `(status, flag, displayName)`, so a reload at `arrived` still shows it.
  - A request becomes a reducer `notice`, with a `haptic` and an `announce` effect, shown in a `Banner` with `announce={false}`. The reducer runs app-wide, so the notice is spoken even if the driver has left `/active-ride` (T0's rule for choosing the speaker).
  - No extra announcement at `arrived`, because `step_done` already speaks «Esat klāt».
- **Rider**:
  - A persisted switch, rendered through `PreferenceSwitch`, which is extracted from #258's PIN row. The extraction was run in planning: `observed`, rider suite 176/176 unedited.
  - At `arrived` a flagged ride shows the request button. Success says «Pieprasījums nosūtīts šoferim.», meaning **sent, never delivered**.

**Decisions (the user's, 2026-09-24):**

- **D1. Procedure, not diagnosis.** `announceArrival`, «Šoferis pieteiksies balsī». No field, log key or string says blind. No GDPR Art. 9 data.
- **D2. The driver learns of it after accepting, never on the offer.** Declining is unpenalised (#15). NFB's 2026 survey reports that refusals persist (`rider-ux-evidence.md:24`).
- **D3. The request button exists on flagged rides only.**
- **D4. Name fallback.** «Sakta, {name}!» when `rider.displayName` is set, «Sakta, uz {destination}!» when it is not. It switches by itself when #269 lands.

**Calls this plan makes, each with its evidence:**

- **D5. One request kind, voice only.** The issue says "honk / announce". The horn is out by law: CSN point 172, quoted in §De-risking record. A second kind would therefore be a light signal, which is useless to the person the feature serves. **Reversal cost** if Linards wants a separate kind anyway: `kind` joins the event, push and request body, and one button and one copy key are added. Nothing is persisted.
- **D6. Legal at `arrived` only.** At `arriving` the driver is driving, and #15's speed-gating rule applies. The car is at the kerb only at `arrived`.
- **D7. Dina's board badge and phone-form checkbox go to #275** (T20). The board carries only the pickup (`rides/board-ride.ts:21`). The form keeps a type-forced `announceArrival: false`. The api side of the phone path is built and tested here.

## Out of Scope / Non-Goals

- **Not included: Android push delivery itself.** Neither `apps/driver/app.json` nor `apps/rider/app.json` declares `googleServicesFile` (`observed`, grep exit 1), so an Android build cannot obtain an Expo push token. `driver-device-day.md` §"What still cannot be reached here" assigns that to **#14** (open). This ticket sends the push by the same path as the offer push (`dispatch-notifier.ts:72-99`). It reaches iOS as soon as an iOS build exists, and Android when #14 adds FCM. The replay leg covers Android today.
- **Not included: an acknowledgement back to the rider.** The driver's voice is the acknowledgement.
- **Not included: a stored rider preference or settings screen.** The opt-in is per booking and remembered on the device, as #258 did.
- **Not included: setting a rider name** (#269), or a "Call dispatch" button for the rider (evidence item 5, its own ticket).
- **Not included: a sound on the driver notice.** The offer tone means "new work", so the notice uses haptic and Banner only (`ui-decisions.md`, T17).
- **Not changing:** the SMS templates, the tracking page, `NotifiableRide`, or `rider.status.arrived`.
- **Not fixing:**
  - #258's disabled-Start TalkBack gap, which #276 already owns.
  - `accessibilityLiveRegion` on views that are not `Banner`: `TextField.tsx:51` (both apps), `offers/queue-position.tsx:20`, `earnings/earnings-screen.tsx:34`. R11 suggests they are equally silent on Android (`derived`, not run). Note them in the report for #276.
- **Fixed here although not #259's:** the paired announcements T0 would otherwise extend to Android. Its caller audit lists them. The driver's `payment_changed` double on iOS (`active-ride-state.ts:244` plus the Banner) is one of them.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium (four surfaces, no migration; every new piece mirrors a shipped one)
**Primary Systems Affected**:
- `packages/shared`: options, realtime, push envelope, driver read, i18n
- `services/api`: rides lifecycle slice
- `apps/rider`: booking and ride-status slices
- `apps/driver`: active-ride and push slices

**Dependencies**: none new. `expo-haptics ~57.0.2` is already a driver dependency (`apps/driver/package.json:12`). `apps/driver/package.json` is unchanged since `7ee13e5` (2026-09-22), and #258's EAS build succeeded on it on 2026-09-24.

## Related Work

**Implements**: [#259](https://github.com/linardsb/taxi/issues/259) · **Epic**: #1 via #15's re-slice. `sakta-cab.architecture.md:42` lists the protocol among the binding UX-evidence items. The architecture decides nothing on disability data, so D1–D7 are ticket-level.

**Back-references**:
- `.claude/plans/pickup-pin.md` (#258): same shape end to end. Its report `.claude/reports/pickup-pin-report.md` §T18 is the emulator run this plan's Level 4 inherits.
- `.claude/plans/driver-ride-rider-identity.md` (#261): `rider.displayName` and its window.
- `.claude/plans/driver-offers-active-ride.md:52`: the deferral.
- `docs/runbooks/driver-device-day.md` §"Driving TalkBack from `adb`" (`:463-500`).

**Forward-references**:
- #269: names, so the prompt stops falling back to the destination.
- #275: form checkbox plus board badge (T20).
- #14: Android FCM, which makes the push leg real on Android.
- #257 / #276: iOS VoiceOver and the rider-app speech checks, if T24's rider leg cannot run.

---

## De-risking record (planning, 2026-09-24, `observed` unless marked)

| # | Risk as first planned | What was run | Result | Status |
|---|---|---|---|---|
| R1 | A backgrounded driver misses the request (socket only) | Read the driver app: `foreground` and `socket_connected` both dispatch `fetch_ride` (`active-ride-state.ts:414-422`). The push pipeline for offers is `dispatch-notifier.ts:72-99` → `push-registrar.tsx:31-58` → `register-push-token.ts:85-128`. `grep googleServicesFile apps/*/app.json` gives exit 1. | Redesigned as three legs. **Replay** works on Android today: a re-read carries `announceRequestedAt`. **Push** mirrors the offer push. It is testable end to end in the harness (`RecordingPushProvider`, `test/harness.ts:426-431`), but it cannot deliver on Android until #14 adds FCM. | Retired for foreground, reconnect and return-to-app. Residual: a driver who **never** reopens the app while on Android. That is owned by #14, and at `arrived` it means a driver who has stopped working the ride. |
| R2 | Rider app has no device build (Expo Go guess) | `taxi-f0` built the rider app locally for #276 (`observed` by that session: Gradle `BUILD SUCCESSFUL in 12m 50s`). This session then drove that installed debug build from its own Metro (`observed` 17:18–17:31 BST). | A rider device leg exists; recipe in T24 | Retired |
| R11 | **Found while de-risking**: the rider's `Banner` is silent under TalkBack on Android, so «Auto ir klāt» and T11's «Pieprasījums nosūtīts šoferim.» are never spoken | Four variants were run on `sakta224` against the installed rider debug build, with TalkBack's verbose log. A fresh Metro bundle was confirmed by an on-screen `[P]` marker; the first two variant runs were discarded because the app was still on a stale bundle. **V0** (main): the `arriving`/`arrived` text changes came in with `nodeLiveRegion=0` and **0 utterances**. **V1** (live region on `Text`): still 0; RN 0.86.3's `Text` has no live-region prop. **V3** (`announceForAccessibility` on Android as well): TalkBack spoke «Auto ir klāt» with subtype **`TYPE_ANNOUNCEMENT`**, on API 36 / `targetSdk=36`. | Fix = T0. The driver `Banner` has identical code on the same RN 0.86.3 (`derived`, not run), so T0 fixes both apps, and T23 observes the driver's | Retired by T0 (rider `observed`; driver checked in T23) |
| R3 | The `lv.ts` split conflicts with an open branch | `gh pr list --state open`: none. Remote branches whose diff against main touches `i18n/lv.ts`: only #258 and #261, both merged. | No live conflict. Re-check at T1. | Retired |
| R4 | Horn at night | likumi.lv, CSN (274865), in force: **p. 172** «Skaņas signālu atļauts lietot, tikai lai novērstu ceļu satiksmei bīstamas situācijas, bet ārpus apdzīvotām vietām – arī lai pievērstu citu ceļu satiksmes dalībnieku uzmanību.» | Honking to find a rider in Rīga is not permitted. | Retired by design (D5): voice-only copy |
| R5 | T1 catalog split | The split was run with the T1 script, then reverted. `lv.ts` 494 → 394 lines, `lv-rider.ts` 109. `Object.entries(lv)` gives **344 keys, sha256 prefix `2a276af52559cb83` before and after**. `tsc --noEmit` passes. `@taxi/shared` test: **29 files, 276 tests passed**. Lint passes. | Pure move proven | Retired |
| R6 | T8 `PreferenceSwitch` extraction touching #258's hardened row | The extraction was run with the exact component in T8, then reverted. `booking-screen.tsx` 294 → 255 lines. Rider typecheck clean. Lint clean after prettier `--fix` (one import-wrap). `@taxi/rider` test: **32 suites, 176 tests passed, no test edited**. | Proven. The `pickup-pin-row` testID and accessibility props are preserved. | Retired |
| R7 | EAS driver build fails | `apps/driver/package.json` last changed at `7ee13e5` (2026-09-22). #258's EAS `preview` build `0df8edea-…` **finished on the first attempt** on 2026-09-24, 807 s (`pickup-pin-report.md:106`), with the same `expo install --check` drift (16 packages behind, on main). This ticket adds no native module. | Same native tree as a build that passed today | Retired. Budget 807 s plus queue, not a failure |
| R8 | TalkBack speech unreachable | `driver-device-day.md:463-500`: TalkBack **is** on the `google_apis` image, enabled over `adb`, with a verbose utterance log through the `pref_log_level` file. #258 T18(e) used it on 2026-09-24. | The Android speech leg is performable here | Retired. Only iOS VoiceOver stays impossible here (Xcode 26.3 ceiling, `observed` 2026-08-25) and is owed by #257/#276 |
| R9 | Gate count copied from memory | `npx turbo run typecheck lint test build --dry=json`: 28 tasks, **22** with a real command | 22/22 is the target | Retired |

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

Shared:
- `packages/shared/src/schemas/ride.ts`:
  - 23-32 `rideOptionsSchema`
  - 88-92 default literal
  - 194-217 `rideOfferSchema`
  - 292-298 `driverRideRiderSchema`/`driverRideSchema`
- `packages/shared/src/schemas/offer-push.ts` (the whole file): the envelope pattern `announcePushDataSchema` mirrors. Its values are strings only (`:15-17`). It is exported from `src/index.ts:22`.
- `packages/shared/src/ride-state-machine.ts` 35-58
- `packages/shared/src/realtime-events.ts`:
  - 29-43 `RT` (first `as const` block)
  - 92-99 ISO-`at` shape
  - 368-378 `ServerToClientEvents`
  - 389-399 `RT_EVENT_SCHEMAS`
- `packages/shared/tests/realtime-events.test.ts:529-547` (hand-listed catalog, `toHaveLength(9)`)
- `packages/shared/src/i18n.ts`, `i18n/lv.ts` (494 lines; `rider.*` at 394-486; `driver.ride.*` 345-366; `push.*` 238-239, 314-323; `driver.action.done` = «Gatavs» at `:266`), `en.ts` (381), `ru.ts` (388)

API:
- `services/api/src/features/rides/lifecycle/ride-lifecycle.controller.ts` 35-37, 39-47, 105-118
- `services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts`:
  - 470 lines
  - 62-69 constructor
  - 229-234 `complete` → `toDriverRide`
  - 317-357 owner-or-404
  - 387-394 `findForDriver` → `readDriverRide` deps
- `services/api/src/features/rides/lifecycle/driver-ride.ts` 31-48 `toDriverRide`, 50-56 `DriverRideReadDeps`, 79-116 `readDriverRide`
- `services/api/src/features/rides/lifecycle/ride-lifecycle.repository.ts` 22-49, 51-61
- `services/api/src/features/rides/rides.repository.ts:51-58` (`rideRequestSchema.parse(row.request)`: parse, never cast)
- `services/api/src/features/rides/rides.service.ts` 55-61 (KV injection), 406-452 (INCR-then-check, 429 body)
- `services/api/src/common/kv/kv.store.ts:9-23` (`get`, `setWithTtl`, `incrWithTtl`, `ttl`)
- `services/api/src/features/rides/rides.module.ts` 24-33 (imports `DriversModule`, which exports `DriversService` per `drivers.module.ts:50`)
- `services/api/src/features/drivers/drivers.service.ts:80-125` (`sendPush`: logs `${event}_sent|_skipped|_failed` and never throws)
- `services/api/src/features/dispatch/dispatch-notifier.ts` 53-54 (emit in try/catch), 72-99 (`pushOffer`: `void …sendPush(…).catch(() => undefined)`)
- `services/api/src/features/realtime/realtime.service.ts` 30-36, 76-88; `realtime/room-policy.ts:27-38`
- `services/api/src/features/rides/lifecycle/ride-pickup-pin.integration.spec.ts`: helpers 112-165, `waitForEvent` 266-285
- `services/api/src/features/dispatch/dispatch.integration.spec.ts:998-1010` (asserting `ctx.push.sent`)
- `services/api/src/features/drivers/push-token.integration.spec.ts:47-56` (`PUT /drivers/me/push-token` → 204)
- `services/api/test/harness.ts` 50 (`InMemoryKeyValueStore`), 426-431 (`RecordingPushProvider.sent`), 496, 717-738

Rider app:
- `apps/rider/src/features/booking/pickup-pin-preference.ts` (49 lines)
- `apps/rider/src/features/booking/booking-screen.tsx` 1-38, 61-62, 231-269, 274, 280-293
- `apps/rider/src/features/booking/use-book-ride.ts` 43, 61
- `apps/rider/src/features/ride-status/use-ride-status.tsx` 45-64, 116-121, 159-173 (`pickupPin` is set **before** the staleness guard on purpose, `:162-171`)
- `apps/rider/src/features/ride-status/status-screen.tsx` 86-87, 111-129, 131-172
- `apps/rider/src/features/i18n/error-key.ts`, `apps/rider/src/components/Banner.tsx:51-56`

Driver app:
- `apps/driver/src/features/active-ride/active-ride-state.ts`:
  - 32 `notice`
  - 47-61 initial state
  - 64-81 events
  - 83-96 effects
  - 112-114 `needsPin`
  - 234-245 notice pattern
  - 293-303 `step_done` announce
  - 414-422 `socket_connected`/`foreground` → `fetch_ride`
  - 431-432 `notice_dismissed`
- `apps/driver/src/features/active-ride/use-active-ride.tsx` 32-45 (context API), 150-163 (effect runner), 165-214 (socket intake)
- `apps/driver/src/features/active-ride/active-ride-screen.tsx` 144-155, 164-172, 188-212
- `apps/driver/src/features/push/route-notification.ts` (whole), `register-push-token.ts:85-128` (`quiet` rule, listeners), `push-registrar.tsx:19-58`
- `apps/driver/src/app/_layout.tsx:15-31` (`PushRegistrar` sits inside `ActiveRideProvider`, so it can call `useActiveRide()`)
- `apps/driver/src/features/offers/use-offer-alerts.ts` (best-effort `expo-haptics`)
- `apps/driver/src/components/Banner.tsx:42-51`

Dispatch: `apps/dispatch/src/features/phone-orders/use-booking-form.ts:313-314`.

Docs: `.claude/references/realtime-events.md`, `docs/ux-metrics-ledger.md:16`, `docs/runbooks/rider-a11y-walkthrough.md`, `docs/runbooks/driver-device-day.md:24,463-500,577-580`, `.claude/references/ui-decisions.md`, `.claude/reports/pickup-pin-report.md:104-124`.

### New Files to Create

- `packages/shared/src/i18n/lv-rider.ts`
- `packages/shared/src/schemas/announce-push.ts`
- `services/api/src/features/rides/lifecycle/arrival-announce.policy.ts`
- `services/api/src/features/rides/lifecycle/arrival-announce.service.ts` and `.spec.ts`
- `services/api/src/features/rides/lifecycle/arrival-announce.integration.spec.ts`
- `apps/rider/src/features/booking/boolean-preference.ts`
- `apps/rider/src/features/booking/announce-arrival-preference.test.tsx`
- `apps/rider/src/features/booking/preference-switch.tsx`
- `apps/rider/src/features/ride-status/use-announce-request.ts` and `.test.tsx`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- `docs/research/rider-ux-evidence.md` §1.2–1.3 (`:18-30`), row 7 (`:134`)
- [Ceļu satiksmes noteikumi](https://likumi.lv/ta/id/274865-celu-satiksmes-noteikumi), p. 170 (light signals), p. 172 (horn). This is why the copy never says «pasignalizējiet».
- [React Native accessibility](https://reactnative.dev/docs/accessibility), [expo-haptics](https://docs.expo.dev/versions/latest/sdk/haptics/), [expo-notifications handler](https://docs.expo.dev/versions/latest/sdk/notifications/#handling-incoming-notifications-when-the-app-is-in-foreground)
- [Socket.IO rooms](https://socket.io/docs/v4/rooms/): an emit to an empty room is a silent no-op
- [GDPR Art. 9](https://gdpr-info.eu/art-9-gdpr/)

### Patterns to Follow

- **Error codes**: the message is the snake_case code. New: `announce_not_requested` (409). Reused: `ride_not_arrived` (409), `too_many_requests` (429 + `retryAfterSeconds`), `ride_not_found` (404).
- **Owner without an existence oracle**: `ride-lifecycle.service.ts:338-340`.
- **Rate limit**: INCR-then-check (`rides.service.ts:406-409`). The window is fixed, not sliding.
- **Emit then push**: `dispatch-notifier.ts:53-54` then `:72-99`. The emit goes in try/catch. The push is `void …catch(() => undefined)`, because `sendPush` logs every outcome itself.
- **Push envelope**: built through the shared schema type, so a rename fails typecheck on both sides (`offer-push.ts:5-13`).
- **Logging**:
  - `ride.arrival_announce.requested` `{ rideId, orderId, riderId, driverId, at }`
  - `ride.arrival_announce.rejected` `{ rideId, riderId, cause, at }`
  - the push event name `ride.arrival_announce.push`, so `sendPush` logs `…push_sent|_skipped|_failed`
  - never a phone, a name, or the word blind
- **Reducers**: pure `decide`. No `setState` in effects (`react-hooks/set-state-in-effect`).

---

## UX (breadboards, states, friction audit)

**Rider — opt in and book**

```
/book ── [Šoferis pieteiksies balsī  (switch row; hint «Ieradies šoferis izkāps un skaļi pateiks „Sakta”.»)] ──► /book (persisted)
      ── [Pasūtīt] ──► /book/status
```

**Rider — at the kerb**

```
/book/status {status: arrived, announceArrival}
   └─ Banner «Auto ir klāt» (unchanged; the one status announcement)
   └─ [Palūgt šoferi pieteikties]  (hint «Šoferis skaļi sauks „Sakta”.»)
          ──► 201 → Banner info «Pieprasījums nosūtīts šoferim.»
          ──► 429 → Banner danger «Pārāk daudz mēģinājumu — pagaidiet brīdi» (existing)
          ──► 409 ride_not_arrived → Banner danger «Brauciens vairs negaida iekāpšanu.»
   status → in_progress: button and result gone
```

**Driver — a flagged ride**

```
/active-ride {accepted|arriving, announceArrival}
   └─ line «Pasažieris lūdz: ierodoties izkāpiet un piesakieties balsī.»
[Esmu klāt] ──► /active-ride {arrived}
   └─ (spoken once, unchanged) «Esat klāt»
   └─ prompt block «Izkāpiet un skaļi sakiet: „Sakta, {name}!”»  |  «… „Sakta, uz {destination}!”»
   ◄── socket ride:announce_requested | push tap/receipt | re-read with a newer announceRequestedAt
         └─ haptic + Banner «Pasažieris jūs meklē: izkāpiet un skaļi sauciet „Sakta”.» [Gatavs]
backgrounded app ◄── push «Pasažieris jūs meklē» / «Izkāpiet un skaļi sauciet „Sakta”.» ──tap──► /active-ride (notice shown)
```

**States**

| Surface | Loading | Empty | Error | Offline |
|---|---|---|---|---|
| Booking switch | Switch and Book disabled until both stored values are read | n/a (off) | A read that throws → off, loaded, visibly off | Unaffected |
| Rider request button | `loading` in flight; a second press is ignored | Not flagged, or ≠ `arrived` → no button | danger Banner `rider.error.<code>` | `rider.error.offline` |
| Driver prompt | Ride spinner | Not flagged → nothing | n/a (derived) | Last loaded ride |
| Driver notice | n/a | No request → nothing | Bad payload → `console.warn`, dropped | Replayed on the next foreground or reconnect read, if within 600 s |

**Touch targets & focus**:
- `PreferenceSwitch` keeps #258's 44 px row, one screen-reader stop (role `switch`, label, hint, `checked`), and the native `Switch` and hint hidden.
- The rider button and «Gatavs» are `Button` (≥ 44 px).
- The prompt is plain `Text` in a bordered `View`, **not** a `Banner`, because Banner announces at mount (on both platforms after T0) and would speak over «Esat klāt».

**Friction audit** (`derived` from the breadboards)
- Rider not opted in: 0 extra taps.
- Rider opting in the first time: +1 tap. Later bookings: 0.
- Rider at the kerb: 0 taps if the first announcement is heard. +1 per re-request.
- Driver on a flagged ride: 0 extra taps (getting out is the protocol). +1 optional to dismiss.
- Driver on an un-flagged ride: unchanged.

---

## IMPLEMENTATION PLAN

- **Phase 0, Banner speaks on Android** (T0). Both apps. **Independent of** everything else, and first, because T11 and T13 rely on it.
- **Phase A, Shared** (T1–T4). T1 first. Rebuild shared after every shared edit: `pnpm --filter @taxi/shared build`, because the apps read `dist`.
- **Phase B, API** (T5–T8). **Depends on:** A.
- **Phase C, Rider** (T9–T11). **Depends on:** A · **Independent of:** B, D.
- **Phase D, Driver** (T12–T15). **Depends on:** A · **Independent of:** B, C.
- **Phase E, Docs, issues, gate, device** (T16–T24). **Depends on:** A–D.

---

## STEP-BY-STEP TASKS

### T0 FIX `Banner` speaks on Android, both apps (run in planning: R11)

- **IMPLEMENT**:
  - In `apps/rider/src/components/Banner.tsx:52-56` and `apps/driver/src/components/Banner.tsx:43-47`, drop the `Platform.OS === 'ios'` guard so `AccessibilityInfo.announceForAccessibility(text)` runs on both platforms.
  - Remove `accessibilityLiveRegion="polite"` from the `View`. It never reaches the platform node (R11, `nodeLiveRegion=0`), and if a future RN made it work, Android would speak every banner twice.
  - Add `announce?: boolean` (default `true`) to `BannerProps` in both apps, and skip the effect when it is `false`. This is for a caller whose event already has a mount-independent announcer (P1–P4, and T12's notice), and for one whose text changes on a timer (P6).
  - Rewrite both docblocks. Replace the `expected, NOT observed` paragraph with the R11 evidence (variants, `TYPE_ANNOUNCEMENT`, API 36), and keep the "ONLY ANNOUNCER" rule. Drop the now-unused `Platform` import if nothing else uses it.
- **GOTCHA**:
  - `announceForAccessibility` is deprecated on API 36, but it spoke there (`observed`). Say so in the docblock, so a later deprecation clean-up does not silently remove the only Android announcer.
  - **Focused-node double read** (`expected`, not yet run): when TalkBack's focus is on the banner's own text node, TalkBack also speaks that node's content change. That was seen once in a discarded stale-bundle run (the `v3b` log), where the change was spoken as `TYPE_WINDOW_CONTENT_CHANGED`. T23/T24 check whether the new code then speaks twice.
  - **Caller audit** (PR #282 review H1/H2, re-derived at `d6deaa6`). After T0 every `Banner` speaks on Android. So every place that speaks the same event a second way, or re-renders a Banner's `text` on a timer, speaks twice or repeatedly on TalkBack too. Several already do so on iOS: the one-announcer rule does **not** already hold there. Sources: `grep -rn "<Banner" apps/rider/src apps/driver/src` and `grep -rn "announceForAccessibility" apps/rider/src apps/driver/src`, both excluding tests.
  - **Which of the two speakers stays.** Keep the one that speaks regardless of which screen is mounted. The driver's reducers run in app-wide providers. The Banners render only on their own screen, and that screen can be unmounted while the state is live:
    - The driver app's root is a plain `Stack` (`apps/driver/src/app/_layout.tsx:28`), with no `BackHandler` or `usePreventRemove` anywhere in `apps/driver/src`, and `ActiveRideProvider` wraps it (`:25-31`). For a ride entered through an offer (`/home` → `/offer`, replaced by `/active-ride`), hardware back from `/active-ride` pops to `/home` while `state.rideId` is still set (`derived` from the code, not run). After a cold start the gate's `<Redirect>` replaces `/`, so back leaves the app instead (round 2 L3). Either way the screen unmounts while the provider lives on, which is what the rule rests on.
    - `marked_offline` can land while `/active-ride` is up, where the home Banner is not mounted.

    Dropping the reducer effect would therefore silence a release or cancel that arrives while the driver is on `/home`. Today that is spoken.
  - Fix each **pair** as listed:

    | # | Where | Second speaker | Fix in T0 |
    |---|---|---|---|
    | P1 | driver `payment-changed` Banner (`active-ride-screen.tsx:166-172`), text with `{ method }` | reducer `announce` `driver.ride.payment_changed` (`active-ride-state.ts:244`), bare key | the Banner gets `announce={false}`. The effect carries the method so it speaks the Banner's text: `{ type: 'announce', key, method: ride.paymentMethod }`. The runner (`use-active-ride.tsx:160-161`) resolves it with `paymentMethodLabel(method, t)` from `./receipt`, as the screen does |
    | P2 | driver `ended-banner` for released (`active-ride-screen.tsx:103-113`) | reducer `announce` `driver.ride.released` at `active-ride-state.ts:224`, `:260`, `:319`, `:369` | `announce={false}` on the `ended-banner`. The effects stay as they are |
    | P3 | driver `ended-banner` for cancelled | reducer `announce` `driver.ride.cancelled` at `:230`, `:379`, bare key | the same `announce={false}`. The effect carries `reason: e.reason` at `:379` and `null` at `:230`, and the runner speaks `t('driver.ride.cancelled', { reason: reason ?? '' }).trim()`, the Banner's own expression |
    | P4 | driver completed-without-split Banner (`active-ride-screen.tsx:95-99`) | reducer `announce` `driver.ride.completed_title` at `:216`, `:350` | `announce={false}` on that Banner. The effects stay: they already speak its exact text, and they also cover the Receipt path, which has no Banner |
    | P6 | rider error Banner in `search-sheet.tsx:281-285`, text `${t(error)} ${t('rider.book.retry_in', { seconds: cooldown })}` | itself: `cooldown` ticks every 1 s (`:103`), and Banner's effect is keyed on `[text]` | keep the visible ticking text. **One flag**, `rateLimited` (PR #282 review round 2 M1): set it only in the `retryAfterSeconds` branch (`:182`, `:231`), next to `setCooldown`, and announce there once with the seconds from the response: `` `${t(key)} ${t('rider.book.retry_in', { seconds: err.retryAfterSeconds })}` ``. Clear it at every `setError` (`:171`, `:181`, `:212`, `:230`, `:249`, `:257`); at `:181` and `:230` the clear comes before the branch that sets it. The Banner gets `announce={!rateLimited}` and carries the countdown suffix only while `rateLimited && coolingDown`. So a later error inside the cooldown (the location failure at `:257`, reachable because «Use current location» is disabled only on `busy`, `:290-296`) speaks once with no ticking suffix, and a 429 with no `retryAfterSeconds` (code `'generic'` when the body fails `apiErrorBodySchema`, `auth/api-client.ts:119-127`) leaves the flag unset and its Banner speaks. Do not key the flag on `err.status`. The comment at `:98-99` promises the rider is told how long, and a Banner reduced to `t(error)` would drop that |
    | P7 | rider quote-failed Banner (`booking-screen.tsx:212-219`, the api's own cause) | `use-quote.ts:56` announces «Cenu neizdevās aprēķināt» | drop the hook's failure announce. Both render only on `/book`, so the more specific Banner stays. Keep the success announce at `:45`, which has no Banner |

    Callers checked and **kept** (one speaker, or two distinct messages in sequence):
    - driver `flipOffline` (`presence-state.ts:135`), which says «Bezsaistē», and the home `marked_offline` Banner, which says «Serveris jūs atzīmēja kā bezsaistē {time}». These are two different texts. On `/active-ride` the announce is the only speaker, because the home Banner is not mounted. Keep both.
    - rider `status-line` (`status-screen.tsx:138`): the one status announcer, by design.
    - rider `search-status` (`search-sheet.tsx:304`): speaks the result count. That is intended, and `:130-140` already blanks it while the error Banner speaks.
    - rider `ride_requested` (`use-book-ride.ts:66`, «Brauciens pieteikts»), then the `/book/status` status line on mount («Meklējam auto…»). Distinct messages in sequence, which iOS already speaks. T24 (b) records the utterances.
    - rider `reconnecting`, and the error Banners on booking, status, gate, login and verify.
    - driver home permission/`driver_on_ride` Banners; `offer-banner` (the offer reducer announces only `driver.offer.title`, for a new card, `offer-state.ts:211`); `ride-error`; `gate-screen`; `profile-screen`; `vehicle-screen`.
    - `presence-state.ts:303`: it carries the existing banner and never sets a new one, so its Banner's `[text]` effect does not re-fire.
  - **Retire the live-region reasoning in shipped comments**, not only in `Banner.tsx`. Hits for `live region` at `d6deaa6`:
    - `rider/…/status-screen.tsx:67-78` ("Banner is kept over the effect because it also carries the Android live region")
    - `rider/…/search-sheet.tsx:126-128` and `:299`
    - `rider/…/auth/gate-screen.tsx:35`
    - both `Banner.test.tsx` titles (`:6`, `:19`)

    Rewrite each to the T0 mechanism.
- **VALIDATE**:
  - `pnpm --filter @taxi/rider test -- Banner` and `pnpm --filter @taxi/driver test -- Banner`. In both `Banner.test.tsx` files:
    - The test at `:6` pins that iOS **does** announce. Keep it.
    - The test at `:19` (asserting at `:30`) pins that Android does **not**. It must go red first. Flip it to assert exactly one call with the text on `android`.
    - Add: `announce={false}` makes no call on either platform, and the `View` has no `accessibilityLiveRegion` prop.
  - Pair tests. Each fails on the unfixed code first:
    - P1–P4: a screen test per Banner (`payment-changed`, `ended-banner` released and cancelled, completed-without-split) renders it and expects **no** `announceForAccessibility` call. A reducer test expects the `payment_changed` effect to carry `method` and the `status`-cancelled effect to carry `reason`. A `use-active-ride.test.tsx` case expects the runner to speak the Banner's exact text for both.
    - P6, in `search-sheet.test.tsx`:
      - a 429 with `retryAfterSeconds: 5`, then fake timers advanced 3 s. Expect `announceForAccessibility` called **exactly once**, with text containing `5`, and the on-screen countdown to read `2`. Advance past the countdown and expect still one call.
      - the fix's own failure mode (round 2 M1, hole 1): a 429 with `retryAfterSeconds: 5`, +1 s, then «Use current location» with the position mocked to `null`. Expect **two calls in total**: the 429's direct announce, then `rider.book.location_unavailable`'s text with no countdown suffix. Advance 3 s more: no further calls. Red under round 1's rule, where the location Banner inherits the ticking suffix and re-speaks each second. The earlier "offline after a 429" case could not reach this window, because the field does not search while cooling down (`:111`).
      - hole 2: a 429 whose body fails `apiErrorBodySchema` (no `retryAfterSeconds`, code `'generic'`). Expect exactly one call, the `generic` text. Red if the flag is keyed on `err.status`.
    - P7: `use-quote.test.tsx`: a failed quote makes no `rider.a11y.quote_failed` announce.
  - Then run each app's full suite. Every other changed assertion is explained in the report.
- **SATISFIES**: AC9, AC14, AC15

### T1 REFACTOR split `rider.*` out of `lv.ts` (run in planning: R5)

- **IMPLEMENT**: run this from `packages/shared/src/i18n`. It is the exact script that produced R5's result.

  ```python
  src=open('lv.ts').read().split('\n')
  start=next(i for i,l in enumerate(src) if l.startswith("  'rider."))
  while src[start-1].strip().startswith('//'): start-=1
  end=max(i for i,l in enumerate(src) if l.startswith("  'rider.") or (l.startswith("    '") and i>start))
  while not src[end].rstrip().endswith(','): end+=1
  close=next(i for i in range(end+1,len(src)) if src[i].startswith('} as const'))
  block=src[start:end+1]
  open('lv-rider.ts','w').write('\n'.join(["/**"," * The rider app's Latvian keys, split out of `lv.ts` when #259 pushed it past"," * the 500-line cap. Spread into `lv` last, so `MessageKey` is unchanged."," */","export const lvRider = {"]+block+["} as const;",""]))
  open('lv.ts','w').write('\n'.join(["import { lvRider } from './lv-rider';",""]+src[:start]+src[end+1:close]+["  ...lvRider,"]+src[close:]))
  ```

- **GOTCHA**:
  - Re-run the R3 check first: `gh pr list --state open`. Then run, for each remote branch, `git diff --name-only origin/main...<branch> | grep i18n/lv.ts`.
  - Prove the move with the same hash, run before and after: `npx tsx -e "import {lv} from './src/i18n/lv'; import {createHash} from 'crypto'; console.log(Object.keys(lv).length, createHash('sha256').update(JSON.stringify(Object.entries(lv).sort())).digest('hex').slice(0,16))"` from `packages/shared`. It must print `344 2a276af52559cb83` at `d6deaa6`'s catalog.
- **VALIDATE**: the hash matches, then `pnpm --filter @taxi/shared typecheck lint test`. Green with no test edits (R5: 29 files, 276 tests).
- **SATISFIES**: AC10

### T2 UPDATE `packages/shared/src/schemas/ride.ts`

- **IMPLEMENT**:
  - `rideOptionsSchema`: add `announceArrival: z.boolean().default(false)`, with a docblock: "A request for the arrival procedure, not a statement about the rider (D1). Revealed to the driver only through `driverRideSchema`, after accept (D2)."
  - Default literal `:88-92`: add `announceArrival: false`.
  - `driverRideSchema`: extend with `announceRequestedAt: z.string().datetime().nullable().default(null)`. Docblock: "When the rider last asked the driver to call out (#259), from KV (600 s TTL). The replay leg: the app re-reads on every foreground and reconnect (`active-ride-state.ts:414-422`), so a request missed while backgrounded shows on return. `.default(null)`: a new app reading an api from before this change still parses."
- **GOTCHA**: find every literal that breaks with `grep -rn "pickupPin: false" --exclude-dir=node_modules --exclude-dir=dist .`. It includes at least `use-booking-form.ts:314`, `bookings.service.spec.ts:26` and `candidate-filter.spec.ts:80,104`. Add the key beside each, never through a spread.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test`. Then `pnpm turbo run typecheck --force`: every consumer compiles, and the api fails where `toDriverRide` output lacks the key. T6 fixes that. Record the failing file list.
- **SATISFIES**: AC1, AC5

### T3 UPDATE `realtime-events.ts`, CREATE `schemas/announce-push.ts`, UPDATE the doc and tests

- **IMPLEMENT**:
  - `RT.rideAnnounceRequested: 'ride:announce_requested'`. Correct the stale docblock at `realtime-events.ts:29-31`: it says a doc-sync check slices the catalog from `RT`, and no such check exists (GOTCHA below). Replace it with "`.claude/references/realtime-events.md` is kept in step by hand; T3 of #259 found no check that reads it."
  - `rideAnnounceRequestedEventSchema = z.object({ rideId: z.string().uuid(), at: z.string().datetime() })`, plus the `ServerToClientEvents` and `RT_EVENT_SCHEMAS` entries. Docblock: "api → `driver:<id>` only. The rider's side is REST (`POST /rides/:rideId/announce-request`). Never the ride room: the rider is in it, and a reconnected driver socket is in no ride room until its next read."
  - `announce-push.ts`: `announcePushDataSchema = z.object({ kind: z.literal('announce_requested'), rideId: z.string().uuid(), at: z.string().datetime() })` and its type, with a docblock that points at `offer-push.ts`'s reasons (strings only; one schema for both sides). Export it from `src/index.ts` beside `offer-push`.
  - `.claude/references/realtime-events.md`: `:3` "all 9 events" → 10, and add a row: "`ride:announce_requested` | api → driver app | `RideAnnounceRequestedEvent` | the rider's `POST /rides/:rideId/announce-request` (REST: auth, rate limit), emitted to `driver:<id>`; also pushed (`announcePushDataSchema`) and replayed via `announceRequestedAt` on the driver read; all three share `at`, which the app dedupes on". In the "Accept/decline are not socket events" paragraph, add the rider request.
  - Tests:
    - `realtime-events.test.ts:529-547`: 10, the new name in `wired`, and the title.
    - New cases: a valid event, a `Date` `at` rejected, a bad uuid rejected, and an envelope round-trip through `announcePushDataSchema`.
- **GOTCHA**: no test reads the doc. `realtime-events.test.ts:532` names it in a comment only, and no script under `.github`, `.claude/hooks` or `scripts` checks it (`observed` by grep). This task is what keeps them in step.
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test`, then `grep -n "all 10 events" .claude/references/realtime-events.md`.
- **SATISFIES**: AC4, AC5

### T4 ADD catalog keys

- **IMPLEMENT**: exact copy follows. Where each key goes:
  - Driver and push keys go in `lv.ts`, after `driver.ride.call_rider_hint` and after `push.rider_arrived_body`.
  - Rider keys go in `lv-rider.ts`, beside their `rider.book.pickup_pin*`, `rider.status.pin` and `rider.error.*` siblings.
  - Mirror each key's position in `en.ts` and `ru.ts`.

| Key | LV | EN | RU |
|---|---|---|---|
| `rider.book.announce_arrival` | Šoferis pieteiksies balsī | Driver announces arrival | Водитель объявит о прибытии |
| `rider.book.announce_arrival_hint` | Ieradies šoferis izkāps un skaļi pateiks „Sakta”. | On arrival the driver gets out and says "Sakta" aloud. | Приехав, водитель выйдет и громко скажет «Sakta». |
| `rider.status.request_announce` | Palūgt šoferi pieteikties | Ask the driver to call out | Попросить водителя отозваться |
| `rider.status.request_announce_hint` | Šoferis skaļi sauks „Sakta”. | The driver calls "Sakta" aloud. | Водитель громко позовёт «Sakta». |
| `rider.status.announce_sent` | Pieprasījums nosūtīts šoferim. | Request sent to the driver. | Запрос отправлен водителю. |
| `rider.error.ride_not_arrived` | Brauciens vairs negaida iekāpšanu. | The car is no longer waiting for pickup. | Машина больше не ждёт посадки. |
| `rider.error.announce_not_requested` | Šim braucienam pieteikšanās nav pasūtīta. | Arrival announcement was not requested for this ride. | Для этой поездки объявление о прибытии не заказано. |
| `driver.ride.announce_note` | Pasažieris lūdz: ierodoties izkāpiet un piesakieties balsī. | Rider asks: on arrival, get out and announce yourself. | Пассажир просит: по прибытии выйдите и назовитесь вслух. |
| `driver.ride.announce_prompt_name` | Izkāpiet un skaļi sakiet: „Sakta, {name}!” | Get out and say aloud: "Sakta, {name}!" | Выйдите и скажите вслух: «Sakta, {name}!» |
| `driver.ride.announce_prompt_destination` | Izkāpiet un skaļi sakiet: „Sakta, uz {address}!” | Get out and say aloud: "Sakta, to {address}!" | Выйдите и скажите вслух: «Sakta, до {address}!» |
| `driver.ride.announce_requested` | Pasažieris jūs meklē: izkāpiet un skaļi sauciet „Sakta”. | The rider is looking for you: get out and call "Sakta" aloud. | Пассажир ищет вас: выйдите и громко позовите «Sakta». |
| `push.announce_requested_title` | Pasažieris jūs meklē | The rider is looking for you | Пассажир ищет вас |
| `push.announce_requested_body` | Izkāpiet un skaļi sauciet „Sakta”. | Get out and call "Sakta" aloud. | Выйдите и громко позовите «Sakta». |

- **GOTCHA**:
  - «Sakta» is never translated.
  - No string asks for the horn (R4).
  - RU `{address}` after «до» is not declined; it is a geocoder proper noun, like `{zone}`.
  - Hints stay one short sentence (`rider-ux-evidence.md:21`: listening at up to 3× speed).
- **VALIDATE**: `pnpm --filter @taxi/shared build && pnpm --filter @taxi/shared test` (parity), then `wc -l packages/shared/src/i18n/*.ts`. Each file < 500 (`derived`, assuming Prettier's default `printWidth` 80, since `.prettierrc` sets none, and one `  'key': 'value',` line per entry before wrapping):
  - lv: the 4 `driver.ride.*` entries measure 93, 83, 96 and 95 columns and wrap to 2 lines each; the 2 `push.*` entries measure 58 and 71 and stay on 1. So 4×2 + 2×1 = 10, and 394 + 10 = **404**.
  - lv-rider: 2 of the 7 entries wrap (`announce_arrival_hint` 90, `announce_not_requested` 84) and 5 stay on 1 (61–71). So 2×2 + 5×1 = 9, and 109 + 9 = **118**.
  - en/ru: ≈ 381/388 + 13 to 26 (one or two lines per key; not measured).
- **SATISFIES**: AC2, AC6, AC10

### T5 CREATE the policy and the service; ADD the repository read, route and provider

- **IMPLEMENT**:
  - `arrival-announce.policy.ts`:
    - `ARRIVAL_ANNOUNCE_WINDOW_SECONDS = 20`
    - `ARRIVAL_ANNOUNCE_REPLAY_SECONDS = 600`
    - `arrivalAnnounceRateKey = (rideId) => \`rides:announce:rate:${rideId}\``
    - `arrivalAnnounceLastKey = (rideId) => \`rides:announce:last:${rideId}\``

    Docblock figures:
    - **Window** (`derived`): one request per fixed window. `incrWithTtl` sets the TTL only on the first INCR, so the next accepted request is ≥ 20 s after the last. Worst case, 3 interruptions a minute per ride (60 ÷ 20). The condition is `redis-kv.store.ts:63-77`'s TTL semantics. The 20 s itself is `expected`: a guess at the time needed to get out of the car and walk round it.
    - **Replay** (`expected`): 600 s bounds how stale a replayed request can be. A kerbside search longer than 10 min is a dispatcher problem, not a notice. The replay is shown only at `arrived` anyway.
  - `RideLifecycleRepository.findAnnounceTarget(rideId)` returns `{ id, orderId, status, riderId, driverId, announceArrival }`. It selects `rides.request` and reads `rideRequestSchema.parse(row.request).options.announceArrival` (the `rides.repository.ts:51-58` pattern; a legacy row parses to `false`).
  - `ArrivalAnnounceService` injects `RideLifecycleRepository`, `@Inject(KV_STORE) kv`, `RealtimeService` and `DriversService`, and has a `Logger`.
    - `request(riderId, rideId)`:
      1. Missing or not the caller's → log rejected `ride_not_found`, `NotFoundException`.
      2. `!announceArrival` → log, `ConflictException('announce_not_requested')`.
      3. `status !== 'arrived' || driverId === null` → log, `ConflictException('ride_not_arrived')`. `driverId` is narrowed to `string` from here.
      4. `incrWithTtl(rateKey, WINDOW)`. If the count is > 1 → `retryAfterSeconds = Math.max(1, await kv.ttl(rateKey))`, log, and throw 429 `{ message: 'too_many_requests', retryAfterSeconds } satisfies ApiErrorBody`.
      5. `at = new Date().toISOString()`, then `await kv.setWithTtl(lastKey, at, REPLAY)`.
      6. `try { realtime.emitToDriver(driverId, RT.rideAnnounceRequested, { rideId, at }) } catch (error) { logger.warn({ event: 'ride.arrival_announce.emit_failed', rideId, reason: …, at }) }`.
      7. `void drivers.sendPush(driverId, (language) => ({ title: formatMessage(language, 'push.announce_requested_title'), body: formatMessage(language, 'push.announce_requested_body'), data: { kind: 'announce_requested', rideId, at } satisfies AnnouncePushData }), 'ride.arrival_announce.push').catch(() => undefined)`.
      8. Log `ride.arrival_announce.requested`, return `{ ok: true }`.

      Checks come before the INCR, so only accepted requests spend the window.
    - `lastRequestedAt(rideId): Promise<string | null>` → `kv.get(lastKey)`.
  - `RideLifecycleController`: inject `ArrivalAnnounceService`, and add `@Post(':rideId/announce-request') @Roles('rider') requestAnnounce(@CurrentUser() user, @Param('rideId', ParseUUIDPipe) rideId) { return this.announce.request(user.sub, rideId); }`.
  - `rides.module.ts`: `ArrivalAnnounceService` in `providers`.
- **IMPORTS**: `KV_STORE, type KeyValueStore` (`../../../common/kv/kv.store`); `RealtimeService` (`../../realtime`); `DriversService` (`../../drivers`); `RT, rideRequestSchema, formatMessage, type AnnouncePushData, type ApiErrorBody` (`@taxi/shared`). Check each export name, and mirror `dispatch-notifier.ts`'s imports for `formatMessage`.
- **GOTCHA**:
  - Nothing goes into `ride-lifecycle.service.ts` except T6's constructor line.
  - `base.mjs:22` is `recommendedTypeChecked`, which has no `no-non-null-assertion` (`observed`). Step 3 still narrows by check, not by `!`.
  - Nothing in the push data is sensitive: no name, no address.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC3, AC4

### T6 UPDATE the driver read: `announceRequestedAt`

- **IMPLEMENT**:
  - `toDriverRide(ride, identity, announceRequestedAt: string | null = null)` returns `announceRequestedAt: ride.status === 'arrived' ? announceRequestedAt : null`. Gate it on the snapshot's status, as #261 gates the name.
  - Add `announce: ArrivalAnnounceService` to `DriverRideReadDeps`. `readDriverRide` passes `await deps.announce.lastRequestedAt(rideId)`.
  - `RideLifecycleService`: inject `ArrivalAnnounceService`, one constructor line, and pass it in `findForDriver`'s deps (`:387-394`). `complete()` keeps calling `toDriverRide(ride, identity)`, which gives null.
- **GOTCHA**:
  - Check the service stays < 500 lines after the one-line injection and the deps entry (470 + ~3). The `max-lines` lint catches it.
  - No module cycle: both services live in `RidesModule`.
  - Two existing specs break and must be updated in this task:
    - `ride-lifecycle.service.spec.ts:183-190` constructs `RideLifecycleService` with 6 arguments. Add a stub `ArrivalAnnounceService` (`{ lastRequestedAt: async () => null }`) as the 7th.
    - `driver-ride.spec.ts:106-111` expects `rest` `toEqual(base)`. `rest` now gains `announceRequestedAt: null`, so it becomes `toEqual({ ...base, announceRequestedAt: null })`.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck lint`, and `driver-ride.spec.ts` gains cases: `arrived` + value → value; `in_progress` + value → null; no arg → null.
- **SATISFIES**: AC7

### T7 CREATE `arrival-announce.service.spec.ts`

- **IMPLEMENT**: unit tests with a fake repository, `InMemoryKeyValueStore` (`test/harness.ts:50`), a recording `RealtimeService` and a recording `DriversService.sendPush`.
  - Expected: owner, flagged, `arrived` → one emit `(driverId, 'ride:announce_requested', { rideId, at })`; one `sendPush` whose built message `data` equals `{ kind: 'announce_requested', rideId, at }` with the **same `at`**; `lastRequestedAt` returns that `at`; the result is `{ ok: true }`.
  - Edge: a second call inside the window → 429 with `retryAfterSeconds ≥ 1`, and no second emit, push or `last` write. A legacy request without the key → 409 `announce_not_requested`.
  - Failure: another rider → 404. `accepted` → 409 `ride_not_arrived`, with the window unspent (a later valid call succeeds). `emitToDriver` throws → still `{ ok: true }`, and the push is still sent.
- **VALIDATE**: `pnpm --filter @taxi/api test -- arrival-announce.service`. **Mutations**, each run and recorded, then restored:
  - (a) remove the flag check → the legacy/un-flagged case goes red;
  - (b) move the INCR before the status check → the "window unspent" case goes red.
- **SATISFIES**: AC3, AC4

### T8 CREATE `arrival-announce.integration.spec.ts`

- **IMPLEMENT**: copy `ride-pickup-pin.integration.spec.ts`'s setup, teardown and helpers (112-165, 266-285) with a new phone prefix and plate prefix `PA`. The main case follows **the app's order**:
  1. Driver A: `onlineDriver`, then `PUT /drivers/me/push-token` with an `ExponentPushToken[…]` (`push-token.integration.spec.ts:47-56`), then **connects its socket** now. This is `use-presence.tsx`, which creates the socket on going online. The rider signs in and connects its socket.
  2. The rider books with `options.announceArrival: true`. Capture A's `ride:offer` and assert `JSON.stringify(payload)` does not contain `announceArrival` (D2 on the socket leg). Also find A's offer push in `ctx.push.sent` and assert its `data.offer` string does not contain `announceArrival` (D2 on the push leg, which `offer-builder.ts:64`'s `rideOfferSchema.parse` keeps clean). Accept. **Only now** does driver B go online and connect. If B were online at booking, dispatch could offer B and the case would flake.
  3. Driver `GET` → `request.options.announceArrival === true` and `announceRequestedAt === null`. Then `arriving`, then `arrived`.
  4. Rider `POST …/announce-request` → 201. `waitForEvent(A, 'ride:announce_requested', rideId, …)` resolves, and its `at` parses. `waitUntil(() => ctx.push.sent.length > before)` → the push's `token` is A's and its `data` is `{ kind: 'announce_requested', rideId, at }` with the same `at`. B's and the rider's sockets recorded nothing in 500 ms.
  5. Driver `GET` → `announceRequestedAt === at` (the replay leg). An immediate second POST → 429.

  Further cases:
  - another rider → 404
  - a driver token → 403
  - an un-flagged ride at `arrived` → 409 `announce_not_requested`
  - a flagged ride at `arriving` → 409 `ride_not_arrived`
  - after `start`, the driver `GET` → `announceRequestedAt === null`
  - phone path: dispatcher `POST /dispatch/bookings` with the flag → force-assign → the driver `GET` shows it
- **GOTCHA**:
  - `waitUntil` is not in the PIN spec: copy it from `dispatch.integration.spec.ts:981`.
  - State the order in the spec's docblock.
  - Run one gate at a time; global-setup drops the shared test DB.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- arrival-announce.integration`. **Mutation**: `emitToDriver` → `emitToRide`. Record both halves, then restore:
  - `expected` RED: the rider-socket negative. The rider joins the ride room at booking (`rides.service.ts:466`).
  - `expected` GREEN: A's positive. A joins at accept (`dispatch-notifier.ts:119`), so this test alone cannot tell the rooms apart. The negative pins the room.
- **SATISFIES**: AC3, AC4, AC5, AC7, AC8

### T9 REFACTOR the rider preference into `boolean-preference.ts`; ADD `useAnnounceArrivalPreference`

- **IMPLEMENT**:
  - Move the body of `usePickupPinPreference` into `useBooleanPreference(key)`, unchanged.
  - `pickup-pin-preference.ts` keeps `PICKUP_PIN_KEY`, the type alias and `usePickupPinPreference = () => useBooleanPreference(PICKUP_PIN_KEY)`. It adds `ANNOUNCE_ARRIVAL_KEY = 'sakta.rider.announce_arrival'` and `useAnnounceArrivalPreference`.
  - `announce-arrival-preference.test.tsx` mirrors `pickup-pin-preference.test.tsx`.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- preference`. The existing PIN test passes unedited.
- **SATISFIES**: AC6

### T10 UPDATE rider booking: `PreferenceSwitch` + second switch + body (run in planning: R6)

- **IMPLEMENT**:
  - CREATE `preference-switch.tsx` exactly as run in planning. Props are `{ label, hint, value, enabled, onChange, testID }`. The component renders a `Pressable` row with `accessibilityRole="switch"`, `accessibilityLabel={label}`, `accessibilityHint={hint}` and `accessibilityState={{ checked: value, disabled: !enabled }}`. The row contains a label `Text` and a `Switch` hidden from accessibility. Below the row sits a hidden muted hint `Text`. Styles: `row` `minHeight: 44`, `label` `fontSize.md`/`colors.fg`, `hint` `fontSize.sm`/`colors.fgMuted`. It carries the docblock with #258's idempotency-key and M2 comments.
  - In `booking-screen.tsx`, replace `:231-269` with two instances:
    - `<PreferenceSwitch label={t('rider.book.pickup_pin')} hint={t('rider.book.pickup_pin_hint')} value={pin.value} enabled={pin.loaded && !busy} onChange={pin.set} testID="pickup-pin-row" />`
    - the same for announce with `testID="announce-arrival-row"`

    Drop `Pressable`/`Switch` from the imports and the `switchRow`/`switchLabel` styles. Run `npx eslint --fix` on the folder: the import wrap changes (R6).
  - `useBookRide(draft, options: { pickupPin: boolean; announceArrival: boolean })`. Book stays disabled until **both** preferences are `loaded`.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- booking` green (R6: 176/176 with only the extraction). Then **add**:
  - toggling `announce-arrival-row` flips `accessibilityState.checked`, and the POST body carries `options.announceArrival: true`;
  - `use-book-ride.test.tsx`'s body literal gains the key.

  Then `pnpm --filter @taxi/rider lint typecheck`.
- **SATISFIES**: AC6, AC9

### T11 UPDATE rider status: flag, request hook, button

- **IMPLEMENT**:
  - `use-ride-status.tsx`: add `announceArrival: boolean` (initial `false`). Set it from `ride.request.options.announceArrival` in the **same `setState` as `pickupPin`, before the staleness guard** (`:162-171`, same reason: the value never changes).
  - `use-announce-request.ts`: `useAnnounceRequest(rideId)` → `{ send, busy, result: { forStatus: RideStatus | null; value: 'sent' | MessageKey } | null }`.
    - `send(status)` first sets `result` to `null`, then POSTs `/rides/${rideId}/announce-request` and stores `{ forStatus: status, value }` when it settles. An `ApiError` maps through `errorMessageKey`.
    - **Why clear first** (PR #282 review H3): Banner speaks from an effect keyed on `[text]`. A second success stores `'sent'` again, and two 429s in a row store the same key, so the text would not change and nothing would be spoken. For this rider, the spoken confirmation is the only feedback. Clearing unmounts the Banner while the request is in flight, and the settled result mounts a new one, which speaks.
    - A press while `busy` is ignored.
  - `status-screen.tsx`:
    - Derive `shown = r && r.forStatus === status ? r.value : null` in render. No effect, no reset.
    - When `announceArrival && status === 'arrived'`, render `Button` `rider.status.request_announce`, `accessibilityHint` `…_hint`, `testID="request-announce"`, above Cancel.
    - `shown === 'sent'` → `<Banner tone="info" text={t('rider.status.announce_sent')} testID="announce-sent" />`. An error key → a danger Banner.
- **GOTCHA**:
  - `statusKey` and the arrival line are unchanged (`status-screen.tsx:74-78`, the one-announcement rule).
  - The `announce_sent` Banner answers the rider's own tap, so it is not a duplicate.
  - Clearing `result` unmounts the Banner for the request's round trip. If TalkBack focus was on the Banner, it moves (`expected`, not run). Focus is normally on the button just pressed. T24 (c) records where focus lands.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- ride-status` with new cases:
  - (expected) flagged `arrived` → press → POST path correct → `announce-sent`
  - (edge) flagged `arriving` → no button; un-flagged `arrived` → no button; the result hides after `status` → `in_progress`
  - (failure) 429 → the `rider.error.too_many_requests` copy
  - (edge, H3) two successful presses → `announceForAccessibility` called **twice** with «Pieprasījums nosūtīts šoferim.»; two 429s in a row → the error copy announced twice. Run this against a `send` that does not clear first, and watch it fail.
  - (hook) a refetch exposes `announceArrival`
- **SATISFIES**: AC7, AC9

### T12 UPDATE the driver reducer: prompt helper, notice, dedupe, replay, haptic

- **IMPLEMENT** (`active-ride-state.ts`; if it passes ~470 lines, put `announcePrompt` in `announce-prompt.ts`):
  - `announcePrompt(ride)`:
    - `null` unless `ride.request.options.announceArrival`
    - `accepted`/`arriving` → `{ key: 'driver.ride.announce_note', params: {} }`
    - `arrived` → `announce_prompt_name` `{ name }` if `ride.rider.displayName`, else `announce_prompt_destination` `{ address: ride.request.destination.address }`
    - otherwise `null`
  - State: `notice: 'payment_changed' | 'announce_requested' | null` and `lastAnnounceAt: string | null` (initial null). It resets only in `open`'s `opened()` branch (a different ride, `active-ride-state.ts:191-194`). The same-ride re-open at `:184-190` keeps it, so the gate's re-open after a push tap (T14) cannot fire the notice a second time.
  - A helper `isNewer(at, last) = last === null || at > last`. `toISOString()` strings are fixed-width UTC, so string order is time order. It replaces a plain `!==` (PR #282 review L5): a push for an older request that lands after a newer socket event must not fire the notice and haptic again.
  - Event `{ type: 'announce_requested'; rideId: string; at: string }`. It applies only when `state.ride?.id === rideId && state.ride.status === 'arrived' && isNewer(at, state.lastAnnounceAt)`. Then `notice: 'announce_requested'`, `lastAnnounceAt: at`, and effects `[{ type: 'haptic' }, { type: 'announce', key: 'driver.ride.announce_requested' }]`. Otherwise noop.
  - `loaded`: after the existing logic, if the ride is `arrived`, `ride.announceRequestedAt !== null` and `isNewer(ride.announceRequestedAt, state.lastAnnounceAt)` → apply the same notice, `lastAnnounceAt`, haptic and announce. This is the replay leg.
  - Clear the notice whenever the ride leaves `arrived`, **only if** `notice === 'announce_requested'` (a `payment_changed` notice keeps its own lifetime), in **both** places (PR #282 review M2):
    - `step_done` when `to !== 'arrived'`. «Sākt braucienu» moves `ride.status` to `in_progress` itself (`:293-303`), so the `ride:status` that follows finds the state already off `arrived`, and a rule on the socket event alone never fires.
    - a `status` event that leaves `arrived`, for a transition the driver did not make (a release or a cancel by dispatch).
  - Effect `{ type: 'haptic' }`.
- **IMPLEMENT** (`use-active-ride.tsx`):
  - Socket intake adds `onAnnounce` through `RT_EVENT_SCHEMAS[RT.rideAnnounceRequested].safeParse` → `dispatch({ type: 'announce_requested', rideId, at })`. On failure, `console.warn` and drop.
  - Runner: `haptic` → `void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined)`.
  - Context: add `announceRequested(rideId: string, at: string): void`, which dispatches the same event, for the push leg. Make it a stable `useCallback` over `dispatch`. It joins the notification handler effect's deps (`push-registrar.tsx:58`), and an unstable one would reinstall the handler on every render.
- **GOTCHA**:
  - **The reducer effect is the notice's one announcer, and T13's Banner is silent** (`announce={false}`). It follows T0's rule: the Banner renders only on `/active-ride`, and the reducer runs whichever screen is up. Because the effect fires once per newer `at`, a second request while the notice is still up is spoken again. That is PR #282 review H3's driver side, which needs no `key` remount.
  - Reuse the jest mock of `expo-haptics` that `use-offer-alerts` tests already rely on.
  - **The notice slot is shared** (PR #282 review round 2 L2). `announce_requested` overwrites a `payment_changed` notice the driver has not dismissed. That is cosmetic: the payment pill still shows the method (`active-ride-screen.tsx:161-165`), and P1's reducer effect already spoke the change.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- active-ride` with cases:
  - socket event at `arrived` → notice and haptic
  - the same `at` a second time → noop (the dedupe)
  - a newer `at` while the notice is already up → haptic and `announce` again (H3, driver side)
  - an **older** `at` after a newer one → noop (L5; red under `!==`)
  - `loaded` with a newer `announceRequestedAt` → notice; with an equal or older one → noop
  - `open` of the same ride keeps `lastAnnounceAt`; `open` of another ride resets it
  - `arriving` → noop; another `rideId` → noop
  - `step_done` from `arrived` to `in_progress` with the notice up → notice cleared (M2; red under a `status`-only rule)
  - a `status` event leaving `arrived` clears the notice
  - a `payment_changed` notice survives a `status` event leaving `arrived` (the clear is conditional)
  - a bad payload → warn, no dispatch
  - `announcePrompt` as a table over status × flag × name
- **SATISFIES**: AC7, AC8

### T13 UPDATE `active-ride-screen.tsx`

- **IMPLEMENT**:
  - Render `announcePrompt(ride)` in `styles.details` after `rider-name`, as `<View style={styles.prompt} testID="announce-prompt"><Text style={styles.promptText}>…</Text></View>`. Styles use theme tokens only (`colors.accent` border, `spacing.md` padding, `fontSize.lg`).
  - `state.notice === 'announce_requested'` → `<Banner announce={false} tone="warning" text={t('driver.ride.announce_requested')} secondary={{ label: t('driver.action.done'), onPress: dismissNotice }} testID="announce-requested" />`. It is silent because T12's reducer effect speaks the notice (T0's rule).
- **GOTCHA**: the prompt is not a Banner. The client name window (`:147-149`) and `announcePrompt` agree at `arrived`. Assert that in a test rather than re-gating.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- active-ride-screen` with cases:
  - flagged `arrived` + name → «…„Sakta, Anna!”»
  - null name → «…„Sakta, uz <destination>!”»
  - `arriving` → the note
  - un-flagged → nothing
  - the Banner renders, and «Gatavs» dismisses it
  - the Banner renders without calling `announceForAccessibility` (T12's effect is the speaker)

  Then `pnpm --filter @taxi/driver lint`.
- **SATISFIES**: AC7, AC9

### T14 UPDATE driver push: route, foreground rule, handlers

- **IMPLEMENT**:
  - `route-notification.ts`: `NotificationRoute` gains `{ kind: 'announce'; rideId: string; at: string }`. When `data.kind === announcePushDataSchema.shape.kind.value` and `announcePushDataSchema.safeParse(data)` succeeds, return it. When it fails, return `{ kind: 'gate' }`.
  - `register-push-token.ts:91-92`: quiet when `(route.kind === 'offer' || route.kind === 'announce') && AppState.currentState === 'active'`. Extend the docblock: in the foreground, the socket and the reducer notice already did the job.
  - `push-registrar.tsx`: `const { announceRequested, state: rideState } = useActiveRide()`. Keep `rideState` in a ref updated by an effect, the file's `tRef` pattern (`push-registrar.tsx:24-27`), so the handler effect's deps (`:58`) stay stable (PR #282 round 1 L1).
    - `onTap`: `route.kind === 'announce'` → `announceRequested(route.rideId, route.at)`, then route on what the provider holds (PR #282 review round 2 H1):
      - **the provider holds a ride** (`rideStateRef.current.rideId` truthy, the same test as `active-ride-screen.tsx:77`'s `!state.rideId`) → `router.navigate('/active-ride')`. That is safe: `/active-ride` redirects only when `rideId` is falsy. It covers a stale tray entry too: the announce for ride A tapped while the provider holds ride B lands on B, and the reducer ignores A's dispatch (`state.ride?.id !== rideId`).
      - **it holds none** (a cold start) → `router.replace('/')`, the gate. `me` is fresh on a cold start, so the gate opens the ride (`onboarding/gate-screen.tsx:25-27`), and the replay leg delivers the notice at `loaded`.
    - Why not the gate on a warm tap: the gate redirects from the `me` cache (`gate-screen.tsx:46-53`), which `useMe` loads once per sign-in (`onboarding/use-me.tsx:75-91`). Accepting an offer never updates it (`offers/use-offers.tsx:135-137`). So a ride accepted in this session has `me.activeRideId === null`, `nextRoute` returns `/home` (`onboarding-state.ts:18-19`), and `/home` has no way back to `/active-ride`. A driver who cold-started during ride A and then accepted B has `me.activeRideId === A`, and the gate's `open(A)` drops B from the provider (`active-ride-state.ts:191-194`).
    - Why not `/active-ride` on a cold start (round 1 M1): `state.rideId` is null until the gate opens the ride, so `/active-ride` redirects to `/home` and nothing routes back. `push-registrar.tsx:32-44` documents the same trap for offers.
    - `onReceived`: `announce` → `announceRequested(route.rideId, route.at)`. This covers a foreground app whose socket is reconnecting, exactly as the offer comment at `:52-53` argues.
- **GOTCHA**:
  - `announceRequested` dedupes on `at` (T12), so socket plus push plus replay give one notice.
  - Import `useActiveRide` from `@/features/active-ride`, whose barrel already exports it (`index.ts:21`).
  - The `useActiveRide` mock at `push-registrar.test.tsx:44-49` returns `{ open: mockOpen, state: {} }` only. Add `announceRequested: mockAnnounceRequested`, or every registrar test fails on the destructure. Make its `state` a per-test variable with `rideId: null` as the default. Test with truthiness, not `!== null`: the current `state: {}` has `rideId` undefined, which `!== null` would read as a held ride.
  - Add `announceRequested` to the handler effect's deps (`push-registrar.tsx:58`). T12 makes it stable. Do **not** add `rideState`: read it through the ref.
  - **This fix's own failure mode**: a ref that is never updated after the first render keeps `rideId: null`, and every warm tap goes to the gate again. The rerender case below pins it.
  - A warm tap with **no** ride held (the ride already closed) goes to the gate, whose `me` cache may still name an old ride. That is the path every non-offer tap takes today, and the gate's fetch then shows that ride as ended. Accepted, not changed here.
- **VALIDATE**: `pnpm --filter @taxi/driver test -- push` with cases:
  - `routeNotification` for a valid announce envelope, a malformed one (→ gate) and an offer (unchanged)
  - the handler is quiet for `announce` when active and loud when backgrounded
  - the registrar's `onTap` for `announce` always dispatches `announceRequested(rideId, at)`, then:
    - warm: the mock at `push-registrar.test.tsx:44-49` returns `state: { rideId }` equal to the push's → `navigate('/active-ride')`, no `replace`. Red on round 1's `replace('/')`.
    - stale tray entry: `state: { rideId: 'other' }` → `navigate('/active-ride')`
    - cold: `rideId: null` → `replace('/')`, no `navigate`
    - the ref: render with `rideId: null`, rerender with a ride, then fire the tap → `navigate('/active-ride')`. Red if the ref's update effect is missing.
- **SATISFIES**: AC7

### T15 UPDATE `apps/dispatch` literal

- **IMPLEMENT**: `use-booking-form.ts:313-314` → add `announceArrival: false`. The comment becomes "…until Dina's form gets its checkboxes (#275)."
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck`
- **SATISFIES**: AC5

### T16 UPDATE docs

- **IMPLEMENT**:
  - `docs/ux-metrics-ledger.md`: add a row "Arrival-announce requests per flagged ride" with target —, owner #259, and source api logs `ride.arrival_announce.requested` / `rejected` (by `cause`) plus `ride.arrival_announce.push_sent|_skipped`. State that it counts opted-in rides only, and that a high `push_skipped` count on Android is expected until #14.
  - `docs/runbooks/rider-a11y-walkthrough.md`: add steps for the switch and button, using T4's exact strings.
  - `docs/research/rider-ux-evidence.md:134`: append «**Shipped as #259** (2026-09, voice-only: CSN p. 172 bars the horn in built-up areas)».
- **VALIDATE**: `grep -rn "blind" packages/shared/src services/api/src apps/*/src` finds nothing new (D1). `grep -rn "pasignaliz\|honk" packages/shared/src/i18n` finds nothing (R4).
- **SATISFIES**: AC2, AC11

### T17 APPEND `.claude/references/ui-decisions.md`

- **IMPLEMENT**: four dated lines:
  - rider: the switch sits under the PIN switch
  - rider: the request button sits above Cancel, only at `arrived`
  - driver: the prompt is a bordered block, not a Banner (why)
  - driver: the notice is haptic + Banner, with no sound (the offer tone means new work)
- **VALIDATE**: `tail -4 .claude/references/ui-decisions.md`
- **SATISFIES**: AC11

### T18 Gate

- **IMPLEMENT**: `cp ~/Desktop/taxi/.env .` into the worktree. Check that `taxi-redis-1` is Up. Clear `dist` and `apps/dispatch/.next`. Then run `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`.
- **GOTCHA**: an `@taxi/api` integration suite that goes red under the full gate but green alone is the known flake, so re-run once before diagnosing. One gate at a time on this machine.
- **VALIDATE**: 22/22 tasks (R9). Record the jest and vitest totals `observed`, naming the run.
- **SATISFIES**: AC10

### T19–T20 COMMENT on issues

- **IMPLEMENT**: each body goes through `--body-file` from the scratchpad (the PreToolUse hook matches command text).
  - **#275**: widen it to the phone-form options «PIN kods» **and** «Šoferis pieteiksies balsī», plus a board badge on flagged rides (dispatcher-as-Aira, `rider-ux-evidence.md:30`).
  - **#14**: add a comment that #259's `ride.arrival_announce.push` is the third push kind that stays undeliverable on Android until `googleServicesFile` lands.
  - Keep `#N` away from the words close and fix.
- **VALIDATE**: `gh issue view 275 --comments | tail -5`, and the same for 14.
- **SATISFIES**: AC12

### T21–T24 Level 4 on `sakta224` (see VALIDATION Level 4)

- T21 EAS `preview` driver APK. Budget **807 s** (R7's observed build) plus queue time.
- T22 API over curl.
- T23 driver app with TalkBack.
- T24 rider app build and TalkBack. **Depends on** the #276 session's recipe (R2).
- **SATISFIES**: AC13

---

## TESTING STRATEGY

### Unit Tests
- shared: option default, event and push schemas, catalog 10, `driverRideSchema` default, i18n parity.
- api:
  - `arrival-announce.service.spec.ts`: expected, edge and failure cases, plus 2 recorded mutations.
  - `driver-ride.spec.ts` for `announceRequestedAt`.
- rider: preference (T9), booking (T10), status (T11).
- driver: reducer including dedupe and replay, `announcePrompt`, screen, push routing (T12–T14).

### Integration Tests
`arrival-announce.integration.spec.ts` (T8). The socket order is the app's:
- Driver A connects on going online, before the booking, with a push token registered.
- The rider connects before booking.
- Driver B connects only after A has accepted.

It asserts:
- socket delivery to A, and nothing to B or the rider
- the push to A's token with the same `at`
- the replay on A's next `GET`
- the offer payload free of the flag

### Edge Cases

| Edge case | Verified in |
|---|---|
| Legacy ride without the key | T7 (409), T2 default |
| Request off `arrived` | T7, T8 (409) |
| Second request inside 20 s | T7, T8 (429; no second emit, push or `last` write) |
| Another rider's id, or a driver token | T7, T8 (404 / 403) |
| Flag on the offer | T8 (wire) |
| Driver backgrounded at request time | T8 (push sent), T12 (replay on `loaded`), T14 (tap routes), T23 step (d) (replay on device) |
| Socket, push and replay all arrive | T12 (dedupe by `at`) |
| Replay after `start` | T6, T8 (null off `arrived`) |
| Name null → destination | T12 table, T13, T23 |
| Status leaves `arrived` with the notice up, by «Sākt braucienu» or by dispatch | T12 (`step_done` and `status`) |
| An older `at` lands after a newer one | T12 (`isNewer`) |
| The rider presses again, or gets a second 429 | T11 (announced twice) |
| A second request while the driver's notice is up | T12 (a newer `at` → `announce` again) |
| Push tap on a cold-started driver app | T14 (`replace('/')`; replay at `loaded`) |
| Push tap on a warm driver app holding a ride | T14 (`navigate('/active-ride')`; the dispatch shows the notice), T23 (e4) owed by #14 |
| A Banner paired with another announcement, or re-rendered on a timer | T0 (P1–P4, P6, P7) |
| Hardware back to `/home` mid-ride, then a release, cancel or request | T0 rule and T12: the reducer speaks, not the unmounted Banner |
| Phone booking with the flag | T8 |
| Book before both preferences load | T10 |
| Foreground push for an announce | T14 (quiet + `onReceived` dispatch) |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
`pnpm turbo run typecheck lint --force`

### Level 2: Unit Tests
`pnpm --filter @taxi/shared test && pnpm --filter @taxi/rider test && pnpm --filter @taxi/driver test && pnpm --filter @taxi/api test -- arrival-announce.service driver-ride`

### Level 3: Integration Tests
`COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- arrival-announce.integration`, then T18.

### Level 4: Manual Validation (emulator `sakta224`)

**Coordination first.** On 2026-09-24 `sakta224` belonged to `taxi-f0` (#276) until ~18:00 BST. Run `adb devices` and `ps aux | grep -i "[q]emu"`, then ask the owning session with `SendMessage`. Never boot a second emulator, never kill one you did not start, and never change another session's accessibility settings.

The SDK is at `/usr/local/share/android-commandlinetools`. Export `ANDROID_HOME` and `ANDROID_SDK_ROOT`. Run the api on a free port (3001 and 3031 were taken by other sessions on 2026-09-24), and point `eas.json`'s `EXPO_PUBLIC_API_URL` at `http://<LAN-IP>:<port>` for the build only.

Lessons from #258's run on this AVD (`pickup-pin-report.md:118-124`), applied here:
- Force-assign **before** launching the app, or relaunch after it. An already-open app does not open a force-assigned ride.
- Type with per-digit `keyevent`s, not `input text`.
- `uiautomator dump` needs animations off; restore them afterwards.
- Sign in as the dispatcher `+37120000099` if `+37120000001` hits the OTP limit.
- The LV locale needs `adb reboot` after `settings put system system_locales lv-LV`.

1. **T22 — API over curl**, following `pickup-pin.md` Level 4 steps 1–2 (OTP via the stub log, explicit coordinates, uuid `Idempotency-Key`, `POST /dispatch/rides/:id/assign`).
   - (a) Book with `options.announceArrival: true` and force-assign. Driver `GET` → the flag is true and `announceRequestedAt` is null.
   - (b) Rider request at `accepted` → 409 `ride_not_arrived`.
   - (c) `arriving`, `arrived`, then the request → 201. Again at once → 429 with `retryAfterSeconds`.
   - (d) Driver `GET` → `announceRequestedAt` equals the logged `at`.
   - (e) The api log shows one `…requested`, one `…rejected` `cause: too_many_requests`, and `ride.arrival_announce.push_skipped` or `_sent`. The dev push provider is the stub (`driver-device-day.md` §What still cannot be reached). No line carries the rider's phone.
2. **T21/T23 — driver APK with TalkBack.**
   - Build with `eas init --id 976c4e03-9ef1-46aa-b383-bc72138890a4` (**never `--account`**), then `npx eas-cli@latest build -p android --profile preview`. Revert the `eas init` edits, including its appended `android.permissions`, before the build is queued (`pickup-pin-report.md:107`).
   - Enable TalkBack and the verbose utterance log exactly as `driver-device-day.md:463-495` shows.
   - Force-assign a flagged ride, then launch the app, and drive it to `arriving` over curl. Then:
     - (a) DPAD to `announce-prompt`. The utterance is the note text.
     - (b) Tap «Esmu klāt» (activate by `input tap` on its bounds, taken from `uiautomator dump`). Count the utterances whose subtype is `TYPE_ANNOUNCEMENT` in the next 5 s: **exactly one**, «Esat klāt» (AC9 on device). DPAD to the prompt → «Izkāpiet un skaļi sakiet: „Sakta, uz <destination>!”».
     - (c) Rider `curl POST …/announce-request` → the `announce-requested` Banner appears (screenshot). The utterance log shows its text once, with subtype `TYPE_ANNOUNCEMENT` (T0; the live region is gone).
     - (d) **Replay leg**: press HOME (`keyevent KEYCODE_HOME`), wait for the 20 s window to pass, send a second rider request (201), then relaunch the app to the foreground. The Banner appears from the re-read. Screenshot it, and grep the api log for the driver's `GET` after the request.
     - (e) «Gatavs» dismisses it.
     - (e2) **T0 on the driver, and the double-read check**: the step (c) utterance must be `TYPE_ANNOUNCEMENT` (T0 live on the driver). Repeat (c) with TalkBack focus moved onto an existing Banner's text by DPAD, and record whether that text is spoken once or twice.
     - (e3) **T0's pairs on the driver** (P2, P3, AC15). For each trigger below, count the `TYPE_ANNOUNCEMENT` utterances in the 5 s after it: **exactly one**, the Banner's text.
       - release: `POST /dispatch/rides/:id/assign` to another driver;
       - cancel: the dispatcher cancels.

       - release **after `adb shell input keyevent KEYCODE_BACK`** from `/active-ride`: confirm by `uiautomator dump` that `/home` is showing, then release. Expect still exactly one utterance, from the reducer. This runs T0's `derived` claim that back leaves the ride state live. **Enter this ride by accepting an offer** (driver online, rider books, driver accepts), not by force-assign before launch: after a cold start the gate's `<Redirect>` replaces `/`, and back leaves the app instead of reaching `/home` (round 2 L3).

       Use a fresh ride for each. The release and cancel triggers are force-assigned before launch. P1 (`payment_changed`) is not staged on device. It needs the rider to switch method between the offer and the driver's first read, and the method locks at accept. Its evidence is T0's unit test (`derived` from the same Banner mechanism as P2/P3).
     - (e4) **Announce push tap from the shade** (PR #282 review round 2 H1): background the app at `arrived` with the ride entered through an offer, tap the announce notification from the shade, and confirm by `uiautomator dump` that `/active-ride` is showing with the `announce-requested` Banner. **Not performable on `sakta224` until #14**: an Android build has no `googleServicesFile`, so no push reaches the shade. Record it as owed by #14; until then T14's unit cases (warm, stale tray, cold, the ref) are the evidence (`expected` on device).
     - (f) Restore: TalkBack off, log pref removed, animations on, and the driver `offline`. End the ride through the app or cancel it as the dispatcher.
   - The haptic is not observable on the emulator; record it as `expected`, with T12's unit test as the evidence.
3. **T24 — rider app with TalkBack.** Recipe (`observed` 2026-09-24):
   - **Build** (only if `lv.saktacab.rider` is not installed): from `apps/rider`, set `JAVA_HOME=$HOME/.local/share/jdk-17/Contents/Home` (Temurin 17, on `PATH`), `ANDROID_HOME=ANDROID_SDK_ROOT=/usr/local/share/android-commandlinetools`, `EXPO_PUBLIC_API_URL=http://10.0.2.2:<port>` and `CI=1`, then run `npx expo run:android`. Never pass `--device emulator-5554`. It takes ~13 min cold (`taxi-f0`'s run) and writes a gitignored `apps/rider/android/`.
   - **JS only** (debug build already installed): `CI=1 EXPO_PUBLIC_API_URL=… npx expo start --port 8081 --clear` from this worktree, then force-stop and relaunch the app. **Prove the bundle is yours before measuring anything**, with a visible marker or a screenshot of a changed string. The planning run lost two variant runs to a stale bundle without `--clear`. Metro rewrites `apps/rider/tsconfig.json`'s `include`; revert it before committing.
   - Open a ride with `adb shell am start -a android.intent.action.VIEW -p lv.saktacab.rider -d "saktacabrider://book/status?rideId=<id>"`. Address search needs `GOOGLE_MAPS_API_KEY`, so book over curl. The app's signed-in rider on 2026-09-24 was `+37120000003`. A dispatcher signs in by requesting its OTP with `role: "rider"` (roles apply to new accounts only). Dismiss the location-accuracy dialog first.
   - TalkBack speech: `adb logcat -d | grep 'Speaking fragment'`, reading the `subtype`. Do not `logcat -c` between the trigger and the read. `input tap` activates rather than explores.
   Then:
   - (a) On `/book`, DPAD to `announce-arrival-row` → one utterance carrying the label, the state and the hint. `uiautomator` shows one node with `checkable`/`checked`.
   - (b) Book with it on. Drive the ride to `arrived` over curl → DPAD to `request-announce` → the label and hint are spoken.
   - (c) Activate it → the `announce-sent` Banner is spoken once. If the driver emulator app is running, it shows the notice; otherwise the api log shows `…requested`.

   If neither build route loads within **45 min**, record the error verbatim and add the step to #276 by comment. RNTL (T10, T11) is then the evidence.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1**: `rideOptionsSchema.announceArrival` defaults to `false`, and a legacy request parses to `false`.
- [ ] **AC2**: no contract key, log field or string says "blind", and no string asks for the horn (T16 greps).
- [ ] **AC3**: `POST /rides/:rideId/announce-request` returns:
  - 201 for the owner of a flagged ride at `arrived`
  - 404 for someone else's ride
  - 409 `announce_not_requested` for an un-flagged ride
  - 409 `ride_not_arrived` off `arrived`
  - 429 with `retryAfterSeconds` inside 20 s
  - 403 for a driver token
- [ ] **AC4**: an accepted request emits `ride:announce_requested` `{ rideId, at }` to `driver:<assigned>` only, and pushes `{ kind: 'announce_requested', rideId, at }` to that driver's token with the same `at` (T8).
- [ ] **AC5**: the offer wire payload carries no flag. The catalog has 10 events. Dispatch sends `announceArrival: false`.
- [ ] **AC6**: the persisted «Šoferis pieteiksies balsī» switch is one screen-reader stop, and its value reaches `POST /rides`.
- [ ] **AC7**:
  - Rider: the request button shows only for a flagged ride at `arrived`, and success shows «Pieprasījums nosūtīts šoferim.».
  - Driver: the note at `accepted`/`arriving`; the prompt at `arrived` with the name or the destination; a request (socket, push or replay) shows the Banner and a haptic **once** per `at`.
- [ ] **AC8**: the driver app drops a malformed event and ignores one for another ride.
- [ ] **AC9**: no added status announcement. On device, exactly one `TYPE_ANNOUNCEMENT` at `arrived` (T23 b).
- [ ] **AC10**: the gate is 22/22 with `REDIS_TEST_URL` set, and every shipped file is < 500 lines.
- [ ] **AC11**: docs, ledger, walkthrough, evidence row and `ui-decisions.md` are updated.
- [ ] **AC12**: #275 and #14 carry the comments.
- [ ] **AC13**: T22 and T23 are run on `sakta224` with artifacts, including TalkBack utterances. T24 is run, or recorded with its error and added to #276. **Owed elsewhere, and unperformable on this Mac:**
  - **iOS VoiceOver**, for both apps: the Xcode 26.3 ceiling (`observed` 2026-08-25) cannot build SDK 57. Owed by #257 (driver) and #276 (rider).
  - **Android push delivery**: no `googleServicesFile`. Owed by #14, together with T23 (e4), the announce push tap from the shade.

  Property-first check: *does a screen reader reach and speak the new controls, and does a missed request reach the driver?*
  - TalkBack's utterance log answers the first half on Android, and is run here.
  - The replay on device answers the second half for Android, and is run here.
  - The harness push recording answers the push leg's correctness, and is run here.
  - Only the iOS speech leg and FCM delivery are without an oracle here.

- [ ] **AC14**: on Android, a new or changed `Banner` text is spoken, unless the caller passes `announce={false}` (T0), as a `TYPE_ANNOUNCEMENT` in both apps. It was observed for the rider in planning (R11), and T23 (c) and T24 (c) observe it for the driver and the rider on this branch.
- [ ] **AC15**: T0's caller audit leaves no event spoken twice and no Banner re-announced on a timer. P1–P4, P6 and P7 each have a unit test that failed first. On device, T23 (e3) counts one `TYPE_ANNOUNCEMENT` each for a release and a cancel.

---

## COMPLETION CHECKLIST

- [ ] T1–T24 in order (Phases C and D may run in parallel)
- [ ] Mutations in T7 and T8 recorded
- [ ] Gate 22/22, figures `observed` with the run named
- [ ] Level 4 artifacts in the execution report
- [ ] Every AC met, or owed with an issue number

---

## RISK REGISTER (after de-risking)

| # | Residual | Owner / mitigation |
|---|---|---|
| R1′ | An Android driver who never reopens the app after a request is not alerted: no FCM. | #14. Replay on return and the push on iOS cover every other case. At `arrived` the driver has just used the app. |
| R12 | Focused-node double read after T0: when TalkBack's focus is on the banner's own text, it may speak both the content change and the announcement | `expected`. Measured in T23 (e2); if it is doubled, the fix is to skip the announce when `AccessibilityInfo`'s focused element is the banner, and that is a follow-up. Never double on unfocused text (R11's valid V3 run: 1 utterance) |
| R10 | A new integration spec can meet the full-gate cross-spec flake. | A known pattern (memory: gate hangs on a red api suite). Re-run once, and run the spec alone first. |

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (D5).** Voice-only is forced by CSN p. 172, not assumed. If Linards wants a second kind anyway (for example a hazard-light flash for a sighted companion), the reversal cost is under D5.
- **Q2 (D6).** The request is legal only at `arrived`. Worst case: a press racing a `start` gets «Brauciens vairs negaida iekāpšanu.», which is accurate. The button never renders before `arrived`, so no "not yet" case is reachable.
- **Q3.** The rider's button visibility rides the existing `ride:status` → `arrived` path that #135 pinned.
- **Q4.** The issue asks for ear-checks carried, not deferred. After de-risking, every Android leg is carried and run (T23, T24). Only iOS VoiceOver is deferred, and this Mac cannot build it.

## NOTES (open canvas)

- **REST in, socket plus push out, replay on read.** The rider's request needs auth, a rate limit and a status code the rider can hear, which is why every other rider/driver action is REST. The three outbound legs cover three driver states: live, backgrounded and reconnecting. They share one idempotence key (`at`), so they cannot add up to more than one notice.
- **Why the driver room.** Rooms have no per-role emit. `emitToRide` would reach the rider, and a reconnected driver socket is in no ride room until its read.
- **Destination fallback (D4)** says a street name aloud at the kerb. The rider chose it by opting in, and #269 removes it for any rider who sets a name.

## CONFIDENCE

**9/10** that execution succeeds in one pass (`expected`). Since the first de-risking pass, R2 is retired and R11, a real defect that would have left the feature silent for blind Android riders, was found and fixed by T0. The plan's structural risks were each retired by an observed run: the split (R5), the extraction (R6), the build (R7), speech reachability (R8), the law (R4), conflicts (R3) and the gate count (R9). What keeps it from 10:
- The new code in T5–T8 and T11–T14 has not been run. It mirrors shipped patterns line for line, but it is still unrun code.

A 10 would need the new code written and run, which is implementation, not planning.

## AMENDMENTS

- 2026-09-24: planning-time de-risking. Horn removed (CSN p. 172). Push and replay legs added (R1). The split and extraction were proven and reverted (R5, R6). The EAS build and TalkBack were found performable (R7, R8). Confidence went from 7 to 9.
- 2026-09-24 (later): R2 retired with `taxi-f0`'s observed rider build recipe (T24). R11 found and measured on `sakta224`: the Banner live region is dead on Android, and `announceForAccessibility` speaks there. Added T0 (both apps), AC14, R12 and the double-read check T23 (e2). Rider test rides: 8 completed and 4 cancelled on the dev DB, none left open.
- 2026-09-24 (PR #282 review, round 1): every finding was re-checked against `d6deaa6` before editing, and all 12 reproduce.
  - T0 gains a named caller audit (P1–P4, P6, P7) and a rule for which speaker stays: the one that speaks whichever screen is mounted. The driver has no back guard, so its screen Banners go silent (`Banner announce={false}`) and the app-wide reducer effects stay, now carrying the Banner's `method`/`reason`. The review's fix went the other way: it dropped the reducer effects. That would have silenced a release heard on `/home`.
  - H2 (P6) keeps the countdown visible and announces the wait once, from the 429. The review's fix would have dropped the seconds.
  - P7, the rider's quote failure, was found while re-deriving H1. The review's presence pair is kept, because on `/active-ride` its announce is the only speaker. AC15 and T23 (e3) are added.
  - H3: T11 clears `result` before each send. On the driver side, T12's reducer effect speaks every newer `at`, so no `key` remount is needed.
  - M1: T14's announce tap goes through the gate. (Superseded by round 2 H1: only a cold-start tap does.)
  - M2: T12 clears the notice in `step_done` too.
  - L1–L7: spec breakages listed (T6, T14); live-region text retired; `Banner.test` citations corrected; the lv figure is 404, not 402; the dedupe is `isNewer`, not `!==`; T3 corrects the stale doc-sync comment rather than keeping its rule; D2 cites the push leg and T8 asserts it.
  - The `payment_changed` "Not fixing" bullet is gone, because T0 P1 fixes it. The `ui-decisions.md` reference now says T17 instead of T19.
- 2026-09-26 (PR #282 review, round 2): both findings re-checked against `d6deaa6` before editing, and both reproduce.
  - H1: round 1's M1 fix (announce tap → the gate) strands a warm driver on `/home`, because the gate redirects from a `me` cache that an offer accept never updates. T14 now navigates to `/active-ride` when the provider holds a ride and goes to the gate only when it holds none (a cold start). The provider state is read through a ref. T23 (e4) adds the shade-tap step, owed by #14 on Android.
  - M1: T0 P6's silence rule is one `rateLimited` flag, set with the cooldown and cleared at every `setError`. It covers a later error inside the cooldown and a 429 with no seconds.
  - L1–L6: AC14 names `announce={false}`; T12's notice clear is conditional and the shared slot is stated; T0's back claim is scoped to offer-entered rides and T23 (e3) enters its back ride through an offer; the `_layout.tsx` path and driver `Banner.tsx:43-47` are corrected; the round-1 report's sweep row is corrected.
