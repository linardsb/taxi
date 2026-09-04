@AGENTS.md

# driver — app-specific rules

The driver app (Expo SDK 57 / React Native, expo-router). Read the root `CLAUDE.md` first; contracts come from `@taxi/shared`.

## Slices (`src/features/<name>/`, VSA; `index.ts` is the slice's public API)

| Slice | Owns |
|---|---|
| `auth` | SecureStore session (`sakta.driver.session`), the one `ApiClient` (bearer, 8 s timeout, 401 → `signOut`), OTP screens |
| `onboarding` | `GET /drivers/me` as context (`MeProvider`), the gate's `nextRoute`, profile / vehicle / documents-stub screens |
| `location` | the durable fix queue (sqlite `sakta-driver.db`, table `fixes`; in-memory twin for tests), the 4 s throttle, the uploader, the typed socket, the background task, permissions |
| `availability` | the presence reducer (`presence-state.ts` — every online/offline rule lives there), its effect runner (`use-presence.tsx`), the home screen, the today card |
| `offers` | the offer card (#15): `offer-state.ts` (one card at a time, server-relative countdown, no accept after zero, REST answer beats a racing revoke), `use-offers.tsx` (socket `ride:offer` / `ride:offer_revoked` / `driver:queue`, accept/decline over REST, tone + haptics), the whole-card-target view, `QueuePosition` |
| `active-ride` | the ride from acceptance to the receipt (#15): `active-ride-state.ts` (the four `DRIVER_STEPS`, `ride:status` reconciliation incl. the dispatcher release, force-assign, the one-time payment-changed notice), `use-active-ride.tsx` (`GET /rides/:rideId` on every socket connect = the ride-room re-join), the screen, `Receipt`, nav deep links |
| `earnings` | today's total (`useEarnings`) plus the receipt of the ride just completed; no per-ride history (Q1 = B) |
| `push` | Expo push token registration, notification routing (`route-notification.ts`: an offer push → the card, hydrated from `data.offer` when the api fitted it in; anything else → the gate), foreground offer suppression |
| `i18n` | `useT()` over the shared catalog, the device language, `errorMessageKey` |

Provider nesting in `src/app/_layout.tsx`: `Session → Me → Presence → ActiveRide → Offers → (PushRegistrar + Stack)`. Import direction between the new slices, kept by hand (no `import/no-cycle`): `availability → offers → active-ride`, `push → offers`, `earnings → active-ride + availability`, `onboarding(gate) → active-ride`; `active-ride` imports none of them. The shared effect loop lives in `src/lib/run-effects.ts`.

Route files under `src/app/**` are thin `export { X as default }` re-exports of feature screens.

## Rules

- **Background location is the core capability.** `expo-location` + `expo-task-manager`; the task is registered at MODULE SCOPE in `features/location/location-task.ts`, and `src/app/_layout.tsx` imports that file FIRST — keep it the first import. Nothing in that file may import a React component (it runs headless).
- **Every fix is written to the queue BEFORE it is sent and deleted ONLY on the server's `accepted: true`** (`DriverLocationAck`). `not_online` re-asserts presence once; `malformed` drops the fix; everything else backs off and retries in order. One fix in flight at a time — never parallel emits.
- **Throttle by TIME, not movement** (≥ `MIN_FIX_INTERVAL_MS` = 4 s apart), with `distanceInterval: 0` — a parked driver keeps producing fixes, and that steady stream is the heartbeat the api's dark detection reads (D7). Do not "optimise" a stationary phone into silence.
- Status must mirror `DriverStatus` from `@taxi/shared`. The app owns INTENT (SecureStore `sakta.driver.intent`); the server owns FACT. On every reconnect and cold launch with intent `online` the app re-asserts `PUT /drivers/me/status online`; a 409 (`vehicle_required`) wins and flips the toggle with the reason — except a `driver_on_ride` 409 on the OFFLINE put while the app is streaming, which does not flip: intent goes back to online and the stream stays up (#141). A mid-ride re-assert is not a 409: the api acks it with the `on_ride` profile (only `offline` 409s while held), which the app reads as the server holding us — the stream stays up.
- Going offline DRAINS the queue first (≤ 5 s), then tells the server — or every queued fix comes back `not_online`.
- Ride offers arrive as `ride:offer` events with an expiry (#15) AND as a push carrying the same wire offer; the reducer dedupes by id, counts down `expiresAt − sentAt` anchored at local receipt (server-relative), never posts an accept after zero, and never declines on local expiry — the api's sweeper owns that. The REST answer is authoritative: a 409 `offer_not_pending` is the «taken» banner, a revoke racing an in-flight accept is ignored. The card's payment method is a wire-only snapshot (`rideOfferEventSchema.paymentMethod`); the ride's operative `ride.paymentMethod` is compared once on the first load after acceptance and a change is announced (`driver.ride.payment_changed`).
- A ride's status is never assumed: each step is one REST call whose answer advances the screen; `ride:status` reconciles everything else, backward edges included; every socket `connect` and every foreground re-reads `GET /rides/:rideId`, which is also what puts a reconnected socket back in the ride room server-side (#16's C1, the driver's turn).
- Earnings display from integer cents (`formatEur`, now in `@taxi/shared` so the api's push body formats the same string; `availability/format-eur.ts` re-exports it); the home card is `GET /drivers/me/earnings/today` (NET of commission), the receipt renders `ride.split` from `complete()`'s answer or a `GET /rides/:rideId` re-read — total → commission (pct) → net, never recomputed; the balance is `balanceCents` on the profile (cash-ride commission nets against card earnings; negative blocks new rides).
- Nothing user-facing is hardcoded: copy through `useT()` (keys `driver.*`), visual values from the `@taxi/shared` theme. Every interactive element ≥ 44 px, labelled, with a visible focus state (`components/`).
- SecureStore keys in use: `sakta.driver.session`, `sakta.driver.intent`, `sakta.driver.marked_offline_at`, `sakta.driver.battery_prompt_shown`.
- Add dependencies with `npx expo install <pkg>`; run `npx expo install --check` before any build — an SDK-version mix is the #4 kit's startup crash. `typescript` is excluded from that check (`expo.install.exclude` in `package.json`) so the pin below survives it — never `--fix` the pin away.
- **Keep `typescript` and `eslint` on the workspace's lines (`~5.9`, `^9`), whatever the Expo template ships.** `eslint-config-expo` peers typescript-eslint against THIS package's TypeScript; on TS 6 pnpm hoists a second `@typescript-eslint/type-utils`/`parser`/`ts-api-utils` instance with a nested TS 6 while `typescript-estree` builds the program on the root TS 5.9 — two TypeScripts, one checker — and `packages/shared`'s type-aware lint goes red in files nobody touched (`no-unsafe-unary-minus` on a literal). ESLint 10 breaks the hoisted `eslint-plugin-react` the same way.
- Tests: jest-expo + `@testing-library/react-native`, colocated `*.test.ts(x)`; `jest.setup.ts` fakes every native module. No test touches sqlite, the real socket or `expo-location` — the pure core (reducer, throttle, queue, uploader) is where the behaviour is proven; device behaviour is Level 4 in the #14 plan.
