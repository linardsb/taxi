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
| `push` | Expo push token registration and the notification tap → gate |
| `i18n` | `useT()` over the shared catalog, the device language, `errorMessageKey` |

Route files under `src/app/**` are thin `export { X as default }` re-exports of feature screens.

## Rules

- **Background location is the core capability.** `expo-location` + `expo-task-manager`; the task is registered at MODULE SCOPE in `features/location/location-task.ts`, and `src/app/_layout.tsx` imports that file FIRST — keep it the first import. Nothing in that file may import a React component (it runs headless).
- **Every fix is written to the queue BEFORE it is sent and deleted ONLY on the server's `accepted: true`** (`DriverLocationAck`). `not_online` re-asserts presence once; `malformed` drops the fix; everything else backs off and retries in order. One fix in flight at a time — never parallel emits.
- **Throttle by TIME, not movement** (≥ `MIN_FIX_INTERVAL_MS` = 4 s apart), with `distanceInterval: 0` — a parked driver keeps producing fixes, and that steady stream is the heartbeat the api's dark detection reads (D7). Do not "optimise" a stationary phone into silence.
- Status must mirror `DriverStatus` from `@taxi/shared`. The app owns INTENT (SecureStore `sakta.driver.intent`); the server owns FACT. On every reconnect and cold launch with intent `online` the app re-asserts `PUT /drivers/me/status online`; a 409 wins and flips the toggle with the reason.
- Going offline DRAINS the queue first (≤ 5 s), then tells the server — or every queued fix comes back `not_online`.
- Ride offers arrive as `ride:offer` events with an expiry (#15); declining/timeout re-offers elsewhere — never assume an offer is still valid.
- Earnings display from integer cents (`formatEur`); the home card is `GET /drivers/me/earnings/today`, the balance is `balanceCents` on the profile (cash-ride commission nets against card earnings; negative blocks new rides).
- Nothing user-facing is hardcoded: copy through `useT()` (keys `driver.*`), visual values from the `@taxi/shared` theme. Every interactive element ≥ 44 px, labelled, with a visible focus state (`components/`).
- SecureStore keys in use: `sakta.driver.session`, `sakta.driver.intent`, `sakta.driver.marked_offline_at`, `sakta.driver.battery_prompt_shown`.
- Add dependencies with `npx expo install <pkg>`; run `npx expo install --check` before any build — an SDK-version mix is the #4 kit's startup crash.
- Tests: jest-expo + `@testing-library/react-native`, colocated `*.test.ts(x)`; `jest.setup.ts` fakes every native module. No test touches sqlite, the real socket or `expo-location` — the pure core (reducer, throttle, queue, uploader) is where the behaviour is proven; device behaviour is Level 4 in the #14 plan.
