# Feature: Driver app — auth + onboarding shell, online toggle, durable background location streaming, server dark-detection + push nudge (#14)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Atis's surface exists and streams. A driver signs in by SMS OTP (against #7), completes a thin onboarding shell (profile + vehicle against #8; document upload is a stub — approval is #20's), flips an online toggle, and the phone streams GPS fixes to the API while backgrounded with the screen locked. Every fix is written to a local SQLite queue **before** it is sent and deleted **only on server ack**, so a tunnel, an LTE gap, or a process kill loses no track data. Server-side, a driver whose stream goes silent while online is auto-marked offline (dispatch never assigns to a ghost) and receives a push nudge ("you've gone offline — reopen the app"); the nudge is also the recovery path after a force-quit or reboot, because `expo-location` cannot self-restart. LV/RU/EN from day one; nothing user-facing hardcoded; theme values only from `@taxi/shared`.

This ticket touches **three packages**, not one: `apps/driver` (the app, from a bare scaffold), `services/api` (ack on the ping, presence sweeper, push seam, one earnings read), `packages/shared` (ack schema, push seam, push-token schema, earnings schema, catalog keys), plus one `db` migration. The issue's "~1000–1500 lines in `apps/driver`" estimate covers the app only; expect ~2500–3500 across the four.

## User Story

As a **licensed Rīga taxi driver** (Atis, pilot user)
I want to **sign in with my phone number, register my car once, and go online with one tap so the platform sees where I am — even through tunnels, dead zones and a phone reboot**
So that **dispatch can offer me rides the whole shift and never thinks I'm there when I'm not**.

## Problem Statement

`apps/driver` is a bare Expo scaffold (`App.tsx` + `app.json`, no `src/`). The API already has everything the app needs to talk to (`observed`: `POST /auth/otp/*`, `GET/PATCH /drivers/me`, `PUT /drivers/me/status`, `/drivers/me/vehicles`, the authenticated Socket.IO server, Redis presence + GEO), but three server pieces the issue mandates do not exist:

1. **No ack on `driver:location`** — `ClientToServerEmitEvents[RT.driverLocation]` is `(payload) => void` (`packages/shared/src/realtime-events.ts:306-308`) and `handleLocation` returns `Promise<void>` (`services/api/src/features/drivers/location/driver-location.gateway.ts:93-97`). A durable queue has nothing to dequeue on, and a ping refused as `not_online` (`driver-location.service.ts:51-58`) is invisible to the phone.
2. **No dark detection.** Disconnect cleanup exists (#38: `clearPresenceOnDisconnect`, `drivers.service.ts:141-160`) and covers the closed-socket case. The open-socket-silent-GPS case is a named, unclosed gap: PR-review finding L7 in `.claude/reports/dispatch-override-phone-orders-zones-phase-c-report.md:319` — "an app that stopped pinging while still marked online is unreachable outright". `findNearest` drops them after 60 s (`driver-location.policy.ts:15`), but `drivers.status` stays `online` and Dina's board renders a ghost.
3. **No push.** Zero hits for `push_token`, `expo-notifications`, or a `PushProvider` seam anywhere (`observed`, repo-wide grep). #15 states the push plumbing is #14's ("shared with #14's 'you've gone offline' recovery nudge, not offer-specific").

And one product gap: the re-slice puts a **today's-earnings card** on the online screen, but "NO PER-ACCOUNT STATEMENT READ" (`services/api/src/features/ledger/index.ts:25-26`) — the only readable number is lifetime `balanceCents`.

## Solution Statement

**App** (`apps/driver`, expo-router, VSA `src/features/{auth,onboarding,availability,location,push,i18n}`): SecureStore-persisted session; OTP screens; three onboarding steps (profile → vehicle → documents stub) routed by "has a vehicle"; a home screen with the toggle, the earnings card, a diagnostics line and a recovery banner. The location slice is the spike harness's `startLocationUpdatesAsync` options **plus** `expo-keep-awake` while online, an Android battery-optimisation prompt, and one deliberate deviation — `distanceInterval: 0` — so a parked driver keeps producing fixes (the fix stream **is** the heartbeat; see D7). Fixes go: task → throttle (≥4 s apart) → SQLite → uploader → `socket.timeout(5000).emit(RT.driverLocation, ping, ack)` → delete on `accepted: true`. `not_online` acks and reconnects re-assert the driver's stored intent (`PUT /drivers/me/status online`), which is what makes a tunnel self-heal without a tap.

**API**: `driver:location` gains an ack (`DriverLocationAck`), no new event. A `DriverPresenceSweeper` (drivers slice, 15 s cadence, mirrors `DispatchSweeper`) marks online drivers with no fix for 60 s offline — Redis first, then Postgres — and, 30 s later, sends the nudge if they are still offline; the same nudge scheduling hangs off the existing disconnect-cleanup path, so a force-quit and a dead GPS both end in one push. The nudge is debounced through a `drivers.offline_nudge_due_at` column (state is a row, never a timer — restart-safe, and a 5-second reconnect cancels it). Push goes through a new `PushProvider` seam in `@taxi/shared`, implemented by a `features/push` slice (`StubPushProvider` in dev/test; `ExpoPushProvider` = one `fetch` to `https://exp.host/--/api/v2/push/send`; production refuses the stub like `SMS_PROVIDER` does). Tokens land in `drivers.push_token` via `PUT/DELETE /drivers/me/push-token`. `GET /drivers/me/earnings/today` (ledger slice) sums the driver account's `ride_fare + commission` entries since Rīga midnight.

## Out of Scope / Non-Goals

- Not included: offers (`ride:offer`), active-ride flow, per-ride receipts, the earnings **screen** — #15. Only the one-number today card is here.
- Not included: `driver:queue` emission / a queue-position view (`dispatch/index.ts:20-21` says "#14/#19"; neither issue body claims it) — defer to #15 with the offer card, where the position is first useful. Recorded in NOTES.
- Not included: document upload, driver approval, "approval gates going online" — #20. The documents step is a stub screen with copy, no upload, no schema, no table.
- Not included: the pre-shift car photo (`apps/driver/CLAUDE.md:8` "Phase 1+", `docs/skeleton-proposal.md:58`) — defer to #20 alongside approval (Q4).
- Not included: refresh tokens / re-auth without OTP. One 30-day access token (#7 decision); expiry = back to the OTP screen. The "expired-token re-auth" failure AC is satisfied by that path.
- Not included: motion-based GPS throttling (issue comment 2026-08-04: "Skipped deliberately"). Time throttling only.
- Not included: iOS push (needs the paid Apple programme — declined until the app exists, memory 2026-08-26), a store listing, EAS Update.
- Not included: server-side track persistence (`ride_tracks`) — #8 deferred it to #11 and #11 did not add it. "Server-side track" in the AC is verified through the API's per-ping debug log (Q2).
- Not changing: `DRIVER_LOCATION_TTL_SECONDS` (60 s), the Lua presence gate, the "server stamps `at`" rule, the no-client-join rule, `driverLocationPingSchema`'s fields (no accuracy/speed/battery on the wire).
- Not changing: the rider app.

## Feature Metadata

**Feature Type**: New Capability (app) + Enhancement (api, shared)
**Estimated Complexity**: High
**Primary Systems Affected**: `apps/driver` (new), `services/api/src/features/{drivers,push,ledger}`, `packages/shared/src/{realtime-events,schemas/driver,seams,i18n}`, `db/src/schema/drivers.ts` + migration `0010`
**Dependencies**: Expo SDK 57 packages (`expo-router`, `expo-location`, `expo-task-manager`, `expo-sqlite`, `expo-secure-store`, `expo-keep-awake`, `expo-notifications`, `expo-localization`, `expo-intent-launcher`, `expo-dev-client`, `expo-linking`, `expo-constants`, `react-native-safe-area-context`, `react-native-screens`), `socket.io-client ^4.8.3` (already in the workspace via dispatch/api), `jest-expo` + `@testing-library/react-native`, `eslint-config-expo`. Server: none new (Expo push is plain HTTPS; Node 20 `fetch`).

## Related Work

**Implements**: [#14](https://github.com/linardsb/taxi/issues/14) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) → `docs/epics/sakta-cab.architecture.md` (silent on app tooling, push and the batch contract — `:32` "auth posture, i18n/a11y policy … all decided in the skeleton"; the ticket-level calls below are therefore this plan's, not overrides)

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/api-auth-realtime-gateway.md` (#7) — Why: OTP endpoints, one 30-day token, no refresh (`:49`), phone normalisation is the client's job (`:51`), handshake `auth.token`.
- `.claude/plans/api-drivers-slice.md` (#8) — Why: the REST surface, Redis presence keys, the 60 s freshness window (`:1387`), "no client-side ping throttling … #14's job" (`:105`), the rejected reaper (`:1422-1428`) — the sweeper here is the reaper that plan declined, now mandated by the issue and bounded by the same freshness window.
- `.claude/plans/spike-gps-field-test-close-out.md` (#4) — Why: the options to port, the mounted-phone fallback, the owed field drives.
- `.claude/plans/dispatch-test-runner-vitest-rtl.md` (#88) — Why: how a workspace app got a test runner; its react 19.2.3 pin and "always through turbo" lessons carry over. Its runner (vitest + jsdom) does **not** — see D4.
- `.claude/plans/dispatch-console-live-board.md` (#18) — Why: `use-board.ts` is the reconnect precedent (built-in backoff + jitter, re-snapshot on every `connect`).
- `.claude/plans/deploy-hetzner-environment.md` (#13) — Why: the deployed API for device testing; the runbook's env table gains two rows here.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- #15 (offers, active ride, earnings screen) — reuses the socket, session, push token and `PushProvider` from this plan.
- #20 (approval) — adds the `approved` gate to `setPresence`; the toggle here already renders a 409 with an unknown reason generically.
- #4 field drives — Android via the live APK kit, iOS on the first TestFlight build (both owed, both still blocked on hardware/accounts; Level 4 §D).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Contracts (`packages/shared`)**

- `packages/shared/src/realtime-events.ts` (lines 28-58, 273-308, 331-341) — Why: `RT`, the two `driver:location` schemas, `ClientToServerEvents` (server, `unknown`) vs `ClientToServerEmitEvents` (app, typed), `RT_EVENT_SCHEMAS`. The ack lands next to these. The header comment (`:24-26`) says `RT` must stay the first `as const` block — do not move it.
- `packages/shared/tests/realtime-events.test.ts` (lines 477-510) — Why: the hand-listed 9-event catalog test. **Do not add an event**; the ack is a schema + callback parameter, so this test stays as is.
- `packages/shared/src/schemas/driver.ts` (all 58 lines) — Why: `driverMeSchema`, `driverStatusUpdateSchema`, the allowlist `driverProfileUpdateSchema`. New schemas go here.
- `packages/shared/src/schemas/auth.ts` (all) — Why: `otpRequestSchema`, `otpVerifySchema`, `authSessionSchema` (wire shape, ISO `createdAt`), `jwtClaimsSchema` (no phone — the app cannot read the phone from the token; keep it in the session).
- `packages/shared/src/schemas/vehicle.ts` (all) — Why: `vehicleCreateSchema` = the vehicle form's exact fields and bounds.
- `packages/shared/src/schemas/user.ts:5-7` — Why: `phoneSchema` E.164 regex — the login field must normalise `2xxxxxxx` → `+3712xxxxxxx` before calling it.
- `packages/shared/src/enums.ts` (lines 1-5, 44-55) — Why: `LANGUAGES`, `DRIVER_STATUSES`, `DRIVER_PRESENCE_STATUSES` (the toggle may only send `online`/`offline`).
- `packages/shared/src/seams/sms-provider.ts` (all 10 lines) — Why: the seam shape to mirror for `PushProvider`.
- `packages/shared/src/i18n.ts`, `packages/shared/src/format-message.ts`, `packages/shared/src/i18n/lv.ts` (lines 1-30) — Why: `lv` is the reference dictionary; `MessageKey` derives from it; `satisfies` forces ru/en parity; `formatMessage(lang, key, params)`. `packages/shared/tests/i18n.test.ts` pins placeholder parity across languages.
- `packages/shared/src/theme.ts` (all) — Why: `colors`/`spacing`/`radius`/`fontSize` — the only source of visual values in the app.
- `packages/shared/src/money.ts:12-14` — Why: `centsSchema`, `nonNegativeCentsSchema`. There is **no EUR formatter in shared** — the app adds one small `formatEur(cents)` in `features/availability/format-eur.ts` (`€84.20`, integer arithmetic, no floats).
- `packages/shared/src/index.ts` — Why: barrel; new seam + schemas are exported here.
- `packages/shared/eslint.config.mjs` — Why: shared is imported by React Native — **no Node globals in `src`** (`process`, `Buffer`). The push seam is types only; fine.

**API — drivers slice**

- `services/api/src/features/drivers/location/driver-location.gateway.ts` (all 140 lines) — Why: `handleLocation` (never throws; returns void today — it will return the ack), `handleDisconnect` (last-socket check, `clearPresenceOnDisconnect`), and the options-less `@WebSocketGateway()` rule (`:15-31`): no `afterInit`, no `handleConnection`, no options.
- `services/api/src/features/drivers/location/driver-location.service.ts` (all) — Why: `ingest` (server clock, `record` returns false → `ping_ignored`), the "no Drizzle on the ping path" invariant (`:16-23`, proven by `driver-location.service.spec.ts` booting with a throwing `DRIZZLE`). The sweeper is **not** on this path and may read Postgres — same footing as `handleDisconnect` (`services/api/CLAUDE.md` "the rule is about the ping, not the class").
- `services/api/src/features/drivers/location/driver-location.store.ts` (all) — Why: the port. `markOnline` gains `atMs`; `OnlineDriver.lastSeenMs` semantics change (D8).
- `services/api/src/features/drivers/location/redis-driver-location.store.ts` (lines 10-15, 66-81, 90-95, 215-266) — Why: keys, `markOnline`/`markOffline`, the Lua gate, `listOnline`.
- `services/api/src/features/drivers/location/driver-location.policy.ts` (all 21 lines) — Why: `DRIVER_LOCATION_TTL_SECONDS = 60`; the presence constants go here.
- `services/api/test/driver-location-store.contract.ts` + `driver-location.store.spec.ts` + `redis-driver-location.store.spec.ts` — Why: the contract suite both stores must pass; `markOnline`'s new parameter and the seeded `seen` score get a case here.
- `services/api/test/harness.ts` (lines 141-235 `InMemoryDriverLocationStore`; 399-470 `TestApp`/`createTestApp`; 515-570 `phoneFor`/`insertUser`/`connectClient`/`closeClients`) — Why: the fake to update, and the integration-test toolkit.
- `services/api/src/features/drivers/drivers.service.ts` (all 218 lines) — Why: `setPresence` (Postgres-then-Redis online, Redis-then-Postgres offline — keep the order and the docblock), `clearPresenceOnDisconnect` (`:141-160`, becomes `markOfflineByServer(userId, reason)`), the `on_ride` guard.
- `services/api/src/features/drivers/drivers.repository.ts` (lines 99-135 `findOrCreate`/`find`; 164-243 `setOnlineIfEligible`/`hasActiveRide`/`setOfflineIfOnline`; 282-292 `setStatus`) — Why: the conditional-UPDATE idiom (L8) every new write here must follow; `toProfile`/`requireRow` helpers; `setOnlineIfEligible` must also null `offline_nudge_due_at`.
- `services/api/src/features/drivers/drivers.controller.ts` (all 52 lines) — Why: the `me`-only routing rule (no `:id`), `@Roles('driver')` class-level, `ZodValidationPipe`. Push-token routes go here.
- `services/api/src/features/drivers/drivers.module.ts` — Why: provider list + `DRIVER_LOCATION_STORE` factory; add `PushModule` import and the sweeper.
- `services/api/src/features/drivers/index.ts` — Why: KNOWN GAPS block to update (dark detection closes L7).
- `services/api/src/features/drivers/location/driver-location.gateway.spec.ts` (lines 1-120) — Why: socket integration test pattern (`createTestApp`, `app.listen(0)`, `tokenFor`, `onlineDriver`, `connectClient`, `afterEach(closeClients)` before `app.close()`).
- `services/api/src/features/drivers/drivers.integration.spec.ts` (lines 1-60) — Why: `signIn` through the stub SMS (`ctx.sms.lastCodeFor(phone)`), `phoneFor('+371220', n)` — pick an unused prefix for new spec files (grep `phoneFor('` first).
- `services/api/src/features/dispatch/dispatch.sweeper.ts` (all 168 lines) — Why: THE sweeper pattern — `onModuleInit` skips under `NODE_ENV=test`, `unref()`, `running` guard, `runPass` per phase, public awaitable `tick()`.
- `services/api/src/features/dispatch/board/board.service.ts:184-206` — Why: the board reads `lastSeenMs`; after D8 a never-pinged driver has a non-null `lastSeenAt` (their online time) — the board keeps working, but its spec's "online-but-never-pinged" fixture (`board.service.spec.ts`) must be re-read.

**API — auth, realtime, config, notifications, ledger**

- `services/api/src/features/auth/auth.controller.ts`, `auth.service.ts` (lines 125-210 `requestOtp` — 429 `resend_too_soon` with `retryAfterSeconds`, 429 `too_many_requests`, 502 `sms_delivery_failed`; 212-317 `verifyOtp` — 401 `invalid_or_expired_code` for every failure), `otp.policy.ts` — Why: every error the login screens must render.
- `services/api/src/features/auth/auth.module.ts:23-41` `smsProviderFactory` + `auth.module.spec.ts` — Why: the factory + production-refusal pattern to mirror for `PUSH_PROVIDER`.
- `services/api/src/features/auth/sms/stub-sms.provider.ts` — Why: the stub pattern (logs the payload in full, masks the phone).
- `services/api/src/features/realtime/realtime.gateway.ts` (lines 35-38, 45-49, 84-100, 107-138) — Why: handshake reads `socket.handshake.auth.token`; the 60 s expiry sweep disconnects an expired token's socket — the app must treat a `disconnect` + failed reconnect (`connect_error: unauthorized`) as "token dead → OTP screen".
- `services/api/src/features/realtime/realtime.service.ts` — Why: `emitToDispatch` parses through `RT_EVENT_SCHEMAS`.
- `services/api/src/common/config/env.schema.ts` (lines 22-45, 232-278 the `.optional().transform()` idiom, 295-365 `superRefine`) — Why: where `PUSH_PROVIDER` and `EXPO_PUSH_ACCESS_TOKEN` go; production rules.
- `services/api/src/features/notifications/notifications.module.ts` — Why: how a second module binds a provider token with an exported factory (comment on why not importing AuthModule) — the same reasoning is why push gets its **own** slice rather than living in notifications (notifications imports `DriversModule`; the sweeper in drivers needs push → a `notifications` home would be a cycle).
- `services/api/src/features/telephony/` (all 4 files) — Why: the smallest provider-only slice in the tree; `features/push/` mirrors its shape.
- `services/api/src/features/ledger/ledger.repository.ts` (lines 8-30 row types; 43-75 `accountFor`) and `ledger.service.ts`, `settlement-entries.ts:39-70` — Why: entry signs on the driver account: `ride_fare` = `+totalCents`, `commission` = `-commissionCents`; earned today = Σ(ride_fare + commission) — never touch `cash_settlement`/`card_settlement`.
- `db/src/schema/ledger.ts` — Why: `ledger_accounts (owner_type, owner_id)`, `ledger_entries (account_id, ride_id, entry_type, amount_cents, created_at)` + `ledger_entries_account_idx` — the today query is one indexed range scan.
- `services/api/src/features/payments/payments.integration.spec.ts` — Why: how a settled ride with real ledger entries is produced end-to-end (for the earnings spec, or seed entries directly — Task 24 chooses direct inserts).
- `services/api/src/features/dispatch/dispatch.policy.ts` — Why: naming style for policy constants.
- `services/api/scripts/mint-tracked-ride.ts` (lines 320-330 socket, 560-575 status, 720-830 OTP + vehicle) and `provision-dispatcher.ts` — Why: a working scripted OTP → vehicle → online → socket flow; **the** reference for Level 4 §C.2 and for anyone who wants a dispatcher on the board during manual checks.
- `services/api/CLAUDE.md` — Why: slice rules; "a dev-only seam stub must THROW at boot under production"; provider SDKs only inside the implementing slice; logging taxonomy.

**DB**

- `db/src/schema/drivers.ts` (all 30 lines), `db/src/schema/users.ts` (`language`, `displayName`) — Why: the two new columns; the nudge reads `users.language`.
- `db/migrations/0009_glossy_fantastic_four.sql` + `db/migrations/meta/_journal.json` — Why: `drizzle-kit generate` output shape; the next tag is `0010_*`.
- `db/tests/schema-constraints.test.ts` — Why: pattern if a constraint test is wanted (none needed for two nullable columns).

**App tooling precedents**

- `apps/driver/app.json`, `App.tsx`, `index.ts`, `tsconfig.json`, `package.json`, `.gitignore`, `AGENTS.md` (read the v57 docs first), `CLAUDE.md` — Why: what exists (nothing) and the rules.
- `spikes/gps-harness/App.tsx` (lines 20-91) and `app.json` (all) — Why: the location task, the permission order, the exact options, the Android permission list incl. `RECEIVE_BOOT_COMPLETED` (memory: expo-location's per-fix job needs it or the first fix crashes), the plugin config. Port; do not import (outside the workspace).
- `apps/dispatch/package.json`, `eslint.config.mjs` (max-lines restated because it does not consume the base), `vitest.config.ts`, `vitest.setup.ts`, `tsconfig.json` — Why: the only workspace-app tooling precedent. Driver uses jest-expo, not vitest (D4), but copies the `max-lines` block verbatim and the "tests colocated under `src/features/**`" layout.
- `apps/dispatch/src/features/board/use-board.ts` (lines 60-150) and `board-state.ts` — Why: socket lifecycle precedent: `io(url, { auth: { token }, reconnectionDelay: 500, reconnectionDelayMax: 30_000, randomizationFactor: 0.5 })`, re-snapshot on every `connect`, pill states `live | reconnecting | offline` derived from receipt, not flags.
- `apps/dispatch/src/features/auth/api-url.ts`, `session.ts`, `use-session.ts`, `login-form.tsx` — Why: the web session/login shape to mirror (SecureStore instead of localStorage; same `AuthSession` parse on read).
- `packages/config/eslint/base.mjs` — Why: the `max-lines` rule text and the test-file exemption list to restate.
- `turbo.json` — Why: `test`/`lint`/`typecheck` all `dependsOn: ["^build"]`; **no edit needed** (the #88 lesson) unless a new env var must reach a task — `EXPO_PUBLIC_API_URL` is read at bundle time by Metro, not by any turbo task, so it stays out of `globalEnv`.
- `.npmrc` (`node-linker=hoisted`) and root `package.json` `pnpm.overrides` (`react: 19.2.3` — Expo pins react exactly; add deps with `npx expo install`, verify with `npx expo install --check`).
- `.github/workflows/ci.yml` — Why: CI runs `pnpm turbo run typecheck lint test build` on Node 20 with no Android SDK — the app's `test` must be pure JS (jest-expo), never `expo run:*`.

**Docs to update in this ticket**

- `.claude/references/realtime-events.md:7` (the `driver:location` row — add the ack) and `:17` ("Accept/decline are not socket events" paragraph — add "the ack on `driver:location` is the one acknowledgement in the catalog").
- `apps/driver/CLAUDE.md` — replace "throttle by movement" with the time-throttle + heartbeat rule; document the slices.
- `docs/epics/mvp-traceability.md:39` — "open (field drive scheduled)" → "built (this PR); field drives owed (#4 open)".
- `docs/runbooks/hetzner-deploy.md` §3 env table — two rows (`PUSH_PROVIDER`, `EXPO_PUSH_ACCESS_TOKEN`). **This file is uncommitted #13 work on `feature/deploy-hetzner-environment` at the time of planning** (`observed`, `git status`) — see Q6.
- `.env.example` — same two vars + `EXPO_PUBLIC_API_URL`.
- `.claude/references/ui-decisions.md` — three cosmetic entries (Task 40).

### New Files to Create

**`packages/shared`**
- `src/seams/push-provider.ts` — `PushProvider`, `PushMessage`, `PushDeliveryResult`.
- `tests/push-provider.test.ts` — the seam's result-shape contract (mirror `payments-provider.test.ts`).

**`db`**
- `migrations/0010_<drizzle-name>.sql` — generated: `drivers.push_token text`, `drivers.offline_nudge_due_at timestamptz`.

**`services/api`**
- `src/features/push/push.tokens.ts` — `PUSH_PROVIDER`.
- `src/features/push/stub-push.provider.ts` — logs `{ event: 'driver.push.stub_sent', token: masked, title, body }`.
- `src/features/push/expo-push.provider.ts` — one `fetch` POST; maps tickets → `PushDeliveryResult`.
- `src/features/push/expo-push.provider.spec.ts` — ok / `DeviceNotRegistered` / 5xx / network error.
- `src/features/push/push.module.ts` + `push.module.spec.ts` — `pushProviderFactory(env)`; production refuses the stub.
- `src/features/push/index.ts` — `PushModule`, `PUSH_PROVIDER`, `pushProviderFactory`.
- `src/features/drivers/presence/driver-presence.repository.ts` — the offline/nudge/push-token writes and the due-nudge read (kept out of the 396-line `drivers.repository.ts`).
- `src/features/drivers/presence/driver-presence.sweeper.ts` — `DriverPresenceSweeper` (dark pass + nudge pass).
- `src/features/drivers/presence/driver-presence.sweeper.spec.ts` — unit, with `InMemoryDriverLocationStore` + a recording push provider.
- `src/features/drivers/presence/driver-presence.integration.spec.ts` — the whole chain over the real module graph (socket disconnect → offline → due → nudge; silent socket → dark → nudge; reconnect cancels the nudge).
- `src/features/drivers/push-token.integration.spec.ts` — `PUT`/`DELETE /drivers/me/push-token`.
- `src/features/ledger/earnings.controller.ts` — `GET /drivers/me/earnings/today`.
- `src/features/ledger/earnings.integration.spec.ts`.
- `src/features/ledger/ledger.policy.ts` — `LEDGER_DAY_TIMEZONE = 'Europe/Riga'` (single-city pilot; `citySchema.timezone` default).

**`apps/driver`** (all under `apps/driver/`; `src/app/*` are thin route files that re-export feature screens, like `apps/dispatch/src/app/**/page.tsx`)
- `eslint.config.mjs`, `babel.config.js` (if `expo customize` emits one; SDK 57 does not require it), `jest.config.js` (or the `jest` key in `package.json`), `jest.setup.ts`, `metro.config.js` **only if needed** (SDK 52+ auto-configures monorepos — do not add one unless `expo start` fails to resolve `@taxi/shared`).
- `locales/lv.json`, `locales/ru.json`, `locales/en.json` — iOS `InfoPlist` permission strings (`expo.locales`), so the OS permission dialogs are not English-only.
- `src/config.ts` — `apiUrl()` from `process.env.EXPO_PUBLIC_API_URL`, default `http://localhost:3001`.
- `src/app/_layout.tsx` — imports `@/features/location/location-task` (side effect: `defineTask` at module scope), `SessionProvider`, `PresenceProvider`, `<Stack>`.
- `src/app/index.tsx` — the router gate (session → me → `/login` | `/onboarding/profile` | `/home`).
- `src/app/login.tsx`, `src/app/verify.tsx`, `src/app/onboarding/profile.tsx`, `src/app/onboarding/vehicle.tsx`, `src/app/onboarding/documents.tsx`, `src/app/home.tsx`.
- `src/features/i18n/{use-t.ts,device-language.ts,index.ts}` + `device-language.test.ts`.
- `src/features/auth/{api-client.ts,session-store.ts,use-session.tsx,phone-normalise.ts,login-screen.tsx,verify-screen.tsx,index.ts}` + tests `api-client.test.ts`, `session-store.test.ts`, `phone-normalise.test.ts`, `login-screen.test.tsx`, `verify-screen.test.tsx`.
- `src/features/onboarding/{use-me.ts,onboarding-state.ts,profile-screen.tsx,vehicle-screen.tsx,documents-screen.tsx,index.ts}` + `onboarding-state.test.ts`, `vehicle-screen.test.tsx`.
- `src/features/availability/{presence-state.ts,intent-store.ts,use-presence.tsx,home-screen.tsx,earnings-card.tsx,use-earnings.ts,format-eur.ts,index.ts}` + `presence-state.test.ts`, `format-eur.test.ts`, `home-screen.test.tsx`.
- `src/features/location/{location-task.ts,location-options.ts,permissions.ts,fix-queue.ts,sqlite-fix-queue.ts,in-memory-fix-queue.ts,fix-throttle.ts,uploader.ts,backoff.ts,socket.ts,index.ts}` + `fix-throttle.test.ts`, `uploader.test.ts`, `backoff.test.ts`, `in-memory-fix-queue.test.ts`.
- `src/features/push/{register-push-token.ts,index.ts}` + `register-push-token.test.ts`.
- `src/components/{Screen.tsx,Button.tsx,TextField.tsx,Banner.tsx,index.ts}` — theme-only primitives; every interactive element ≥44 px, `accessibilityRole`/`Label`/`State`.
- `assets/notification-icon.png` (96×96 white-on-transparent; Android foreground-service + notification icon).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

Fetched 2026-08-31 against the v57 docs; re-read the pages, the app's `AGENTS.md` insists.

- [expo-location v57](https://docs.expo.dev/versions/v57.0.0/sdk/location/) — `startLocationUpdatesAsync` options (`timeInterval` is **Android-only**; `distanceInterval` all platforms; `deferredUpdates*`; `pausesUpdatesAutomatically` iOS; `foregroundService.{notificationTitle,notificationBody,notificationColor,killServiceOnDestroy}`), `hasStartedLocationUpdatesAsync`, `stopLocationUpdatesAsync`, `requestBackgroundPermissionsAsync` ("On Android 11 or higher: this method will open the system settings page"; foreground must be granted first). Config plugin: `isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`, `isAndroidForegroundServiceEnabled`, `androidForegroundServiceIcon`. **"A terminated app will not automatically restart when a location … event occurs"** (Android) — the nudge is the restart.
- [expo-task-manager v57](https://docs.expo.dev/versions/v57.0.0/sdk/task-manager/) — `defineTask` "must be called in the global scope of your JavaScript bundle"; registered tasks persist across sessions; `isTaskRegisteredAsync`.
- [expo-sqlite v57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/) — `openDatabaseAsync`, `runAsync`, `getAllAsync`, `execAsync`, `withExclusiveTransactionAsync`; usable without React (headless task).
- [expo-secure-store v57](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/) — `get/set/deleteItemAsync`; keys `[A-Za-z0-9._-]`; values historically capped ~2048 bytes on iOS — store the session as one JSON (token + expiresAt + user ≈ 600 bytes; `derived`: a JWT with two claims is ~170 chars).
- [expo-keep-awake v57](https://docs.expo.dev/versions/v57.0.0/sdk/keep-awake/) — `activateKeepAwakeAsync(tag)` / `deactivateKeepAwake(tag)`.
- [expo-notifications v57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) — `setNotificationChannelAsync` **before** `getExpoPushTokenAsync` on Android 13+; `getExpoPushTokenAsync({ projectId })`; remote push needs a dev build (not Expo Go).
- [Expo push HTTP API](https://docs.expo.dev/push-notifications/sending-notifications/) — `POST https://exp.host/--/api/v2/push/send`, body `{ to, title, body, data?, priority?, channelId? }`, tickets `{ status: 'ok' | 'error', details?: { error: 'DeviceNotRegistered' } }`, access token optional (`Authorization: Bearer`), 600/s/project.
- [FCM V1 credentials](https://docs.expo.dev/push-notifications/fcm-credentials/) — Firebase project (free) → `google-services.json` (committable) at `android.googleServicesFile` → service-account JSON uploaded via `eas credentials` (gitignored). **Human prerequisite A1**; without it the app still runs, `getExpoPushTokenAsync` throws and is caught.
- [expo-localization v57](https://docs.expo.dev/versions/v57.0.0/sdk/localization/) — `getLocales()[0].languageCode`; re-read on foreground (Android changes without restart).
- [expo-intent-launcher v57](https://docs.expo.dev/versions/v57.0.0/sdk/intent-launcher/) — `ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS` (the settings list, no special permission) — used for the Android exemption prompt. Not `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` (needs a manifest permission Play rejects; irrelevant for a sideloaded APK but pointless).
- [expo-router install](https://docs.expo.dev/router/installation/) — `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar`; `"main": "expo-router/entry"`; `scheme` in `app.json`; `app/_layout.tsx` + `app/index.tsx` (or `src/app/`).
- [Unit testing with jest-expo](https://docs.expo.dev/develop/unit-testing/) — `npx expo install jest-expo jest @types/jest --dev`, `"jest": { "preset": "jest-expo" }`, `transformIgnorePatterns` (use the npm/yarn pattern — `.npmrc` hoists, so there is no `node_modules/.pnpm`; fall back to the pnpm pattern only if a transform error names `.pnpm`), `@testing-library/react-native` (not `react-test-renderer`, which does not support React 19).
- [ESLint for Expo](https://docs.expo.dev/guides/using-eslint/) — `eslint-config-expo/flat` + `eslint-plugin-prettier/recommended` in `eslint.config.js`.
- [Monorepos](https://docs.expo.dev/guides/monorepos/) — SDK 52+ configures Metro for workspaces automatically; delete any hand-rolled `watchFolders`.
- [Socket.IO client acks](https://socket.io/docs/v4/emitting-events/#with-timeout) — `socket.timeout(ms).emit(event, payload, (err, response) => …)`; NestJS calls the ack with the handler's return value when non-nil (`observed`: `node_modules/@nestjs/platform-socket.io/adapters/io-adapter.js:41-51`).
- `docs/spikes/04-gps-field-test.md` — the field protocol + pass table (Level 4 §D).
- Memory `taxi-gps-spike-kit` — the two APK startup crashes (SDK-version mix; `RECEIVE_BOOT_COMPLETED`) and `npx expo install --check` as the tripwire; the headless-emulator recipe (`adb emu geo fix`, `pm grant`).
- Memory `taxi-mac-xcode-ceiling-expo-ios` — SDK 57 does not build for iOS on this Mac; Android emulator is the only local device path.

### Patterns to Follow

**Naming:** kebab-case files, `<thing>.<kind>.ts` in the api (`driver-presence.sweeper.ts`), plain kebab in apps (`fix-queue.ts`); tests colocated `*.spec.ts` (api, jest) / `*.test.ts(x)` (app, jest-expo — the app follows the workspace's `.test` convention like dispatch/shared, not the api's `.spec`). Policy constants `SCREAMING_SNAKE` in a `*.policy.ts`. Log events `domain.component.action_state`.

**Error handling (api):** domain errors as `ConflictException('snake_reason')` / `UnauthorizedException('snake_reason')`; never a raw driver error; provider free text never reaches a log (`geo.maps.route_failed` precedent) — the Expo push provider logs a closed-enum `reason`.

**Error handling (app):** every API call returns a discriminated result or throws an `ApiError { status, code }`; screens render the `code` through the catalog (`driver.error.<code>`), falling back to `driver.error.generic`. A 401 anywhere calls `signOut()` — the "expired-token re-auth" path.

**Logging (api, `services/api/src/features/drivers/drivers.service.ts:120-126`):**
```ts
this.logger.log({
  event: 'driver.presence.status_changed',
  driverId: userId,
  from: profile.status,
  to: updated.status,
  at: new Date().toISOString(),
});
```
New events: `driver.presence.status_changed` with `reason: 'dark'` (reuse, add the reason), `driver.presence.dark_sweep_failed`, `driver.push.nudge_sent`, `driver.push.nudge_skipped` (`reason: 'no_token' | 'back_online'`), `driver.push.nudge_failed` (`reason: PushDeliveryFailure`), `driver.push.token_registered`, `driver.push.token_cleared`, `driver.location.ping_accepted` (**debug** level: `{ driverId, clientAt, at, lagMs }`).

**Sweeper (mirror `dispatch.sweeper.ts:56-102` exactly):** `onModuleInit` returns early under `NODE_ENV === 'test'`; `setInterval(...).unref()`; `running` guard; each pass wrapped in `runPass(name, fn)`.

**Conditional UPDATE, never read-then-write (`drivers.repository.ts:164-243`):** `markOfflineByServer` is `UPDATE drivers SET status='offline', offline_nudge_due_at=$due WHERE user_id=$id AND status='online' RETURNING`; `claimNudge` is `UPDATE … SET offline_nudge_due_at = NULL WHERE user_id=$id AND offline_nudge_due_at IS NOT NULL RETURNING user_id` — the RETURNING row is the claim.

**Seam factory (`auth.module.ts:23-41`):**
```ts
export function pushProviderFactory(env: Env): PushProvider {
  if (env.PUSH_PROVIDER === 'expo') return new ExpoPushProvider({ accessToken: env.EXPO_PUSH_ACCESS_TOKEN });
  if (env.NODE_ENV === 'production') throw new Error('No production PushProvider is bound: StubPushProvider delivers nothing. Set PUSH_PROVIDER=expo (#14) before running with NODE_ENV=production.');
  return new StubPushProvider();
}
```

**Socket client (`use-board.ts:128-145`):** `io(apiUrl(), { auth: { token }, transports: ['websocket'], reconnectionDelay: 500, reconnectionDelayMax: 30_000, randomizationFactor: 0.5, autoConnect: false })`; on every `connect` re-assert state (there: re-fetch the snapshot; here: re-assert presence intent + kick the uploader).

**Typed client emit (`realtime-events.ts:300-308`):** `Socket<ServerToClientEvents, ClientToServerEmitEvents>` — the app never retypes an event.

**i18n in a screen:** `const t = useT(); <Text>{t('driver.home.go_online')}</Text>`; `useT` returns `(key: MessageKey, params?) => formatMessage(lang, key, params)`.

**Theme in a style:** `StyleSheet.create({ button: { minHeight: 44, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accent } })` — never a literal colour/size. Any cosmetic question → `.claude/references/ui-decisions.md`, not a debate.

---

## DECISIONS (ticket-level; the epic is silent on all of these)

- **D1 Navigation = expo-router.** Expo's default; #15 needs a stack (offer modal over home) and push-tap deep links; file routes are thin re-exports of feature screens, the same shape as dispatch's `app/**/page.tsx` → `features/*`.
- **D2 State/data = React context + hooks + `fetch`.** No query library, no state library. Three contexts (`Session`, `Presence`, `Me`) is the whole app state for 3.1 + 3.2.
- **D3 Storage:** session JSON in `expo-secure-store` (key `sakta.driver.session`); presence intent + "battery prompt shown" in SecureStore too (tiny strings; one module, no AsyncStorage dependency); the fix queue in `expo-sqlite` (`sakta-driver.db`, table `fixes`).
- **D4 Test runner = jest-expo + @testing-library/react-native.** Not vitest: `react-native` ships Flow-typed, untranspiled sources that Metro/babel-preset-expo transform and Vite does not; #88's own scope line excluded the Expo apps for this reason ("different runner story"). jest already runs in the workspace (`services/api`, jest 30). Pure logic (throttle, queue, uploader, reducers) is the bulk of the tests and runs under jest-expo without native mocks; screens render with RNTL and `jest.mock`ed hooks.
- **D5 Lint = `eslint-config-expo/flat` + prettier + the `max-lines` block restated** (copy `apps/dispatch/eslint.config.mjs:19-38` verbatim — the app does not consume `@taxi/config/eslint/base.mjs`, so the gate would otherwise miss it). Scripts `lint: "eslint ."`, `test: "jest"`, `typecheck` unchanged. Turbo picks both up with no config change.
- **D6 Ack on the existing `driver:location`, no new event.** `driverLocationAckSchema = { accepted: boolean, reason?: 'not_online' | 'malformed' | 'store_unavailable' }`; the ack is a callback parameter on both event maps. Keeps the 9-event catalog and its test intact; one wire change, one doc row. Per-fix emits (oldest first, sequential, awaiting each ack) instead of a batch payload: at 1 fix/4 s a 5-minute dead zone is 75 emits of ~120 bytes on one connection (`derived`), and the server's per-fix fan-out to the dispatch board replays the track in order — which is the "server-side track" the AC asks to see.
- **D7 Location options = the harness's, with `distanceInterval: 0`.** The harness used `distanceInterval: 10`; a parked driver then produces **no** fixes, which dark-detection would read as death. With `0`, iOS delivers continuous ~1 Hz updates under `BestForNavigation` and Android honours `timeInterval: 4000` regardless of movement, so the fix stream doubles as the heartbeat and no separate timer (which iOS would not run in the background anyway) is needed. The client throttles to ≥4 s spacing before enqueueing, so the wire cadence is the same as the harness's moving cadence. Strictly a superset of both the PASS design and the mounted-phone fallback. Battery: the GPS chip is already on continuously under `BestForNavigation`; the phone is on a charger (spike doc `:11`). **Flagged as Q1** because the 2026-08-26 comment says "the harness's exact options".
- **D8 Dark detection = a `DriverPresenceSweeper` in the drivers slice**, 15 s cadence, threshold `PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS` (60): the moment dispatch stops seeing a driver is the moment the durable record says offline — one number, no window where the board says online while dispatch excludes. `markOnline(cityId, driverId, atMs)` now also seeds the `seen` score, so "online for 60 s with no fix at all" is dark too and the sweeper needs no state of its own. Marked within 60 + 15 = **75 s** of the last accepted fix, worst case (`derived`).
- **D9 Nudge debounce = `drivers.offline_nudge_due_at`.** Both server-initiated offline paths (disconnect cleanup, dark) stamp `now + OFFLINE_NUDGE_DELAY_SECONDS (30)`; `setOnlineIfEligible` nulls it; the sweeper's second pass sends due nudges and nulls the column as the claim. A phone that reconnects inside 30 s never gets a push. State is a row, never a timer (the dispatch-sweeper rule). Voluntary offline (`PUT status offline`) stamps nothing.
- **D10 Push seam** `PushProvider.send(token, message): Promise<PushDeliveryResult>` in shared; `features/push/` slice in the api (own slice, not `notifications` — cycle otherwise); `ExpoPushProvider` is one `fetch`, no `expo-server-sdk` (one message per nudge; the SDK's chunking/receipts buy nothing at pilot scale); `PUSH_PROVIDER=stub|expo` (default `stub`, production refuses `stub`), `EXPO_PUSH_ACCESS_TOKEN` optional.
- **D11 Push token** on `drivers.push_token` (one phone per driver at pilot scale; a `device_tokens` table is #15's problem if a second device ever matters), `PUT /drivers/me/push-token { token }` on every app start and `DELETE` on sign-out (so a phone handed to another driver does not carry the old driver's nudges). `DeviceNotRegistered` nulls the column.
- **D12 Earnings today** = `GET /drivers/me/earnings/today` in the **ledger** slice (it owns the entries; #15's per-ride list lands beside it), `{ day: 'YYYY-MM-DD', timezone, earnedCents, rideCount }` = Σ(`ride_fare` + `commission`) and `count(distinct ride_id)` on the driver's account since `date_trunc('day', now() AT TIME ZONE 'Europe/Riga')`. Postgres does the timezone arithmetic; the API never computes a midnight. Resolves the #14/#15 collision: the **card** is #14, the ≤5 s **metric** stays #15's (it needs #15's completion flow to exist).
- **D13 Onboarding routing** = `vehicles.length === 0 → onboarding, else home` (the only server-enforced prerequisite is `vehicle_required`). Profile step first (languages prefilled from the device language, "I am a female driver" switch), vehicle second, documents stub third. From home, one link reopens the vehicle screen in edit mode.
- **D14 Recovery after the nudge:** on cold launch with intent `online`: if `hasStartedLocationUpdatesAsync` is true (Android kept the service alive) → re-assert automatically; if false (process was killed) → show the banner "Jūs tikāt atzīmēts kā bezsaistē HH:MM" with one **[Iet tiešsaistē]** tap. On a warm reconnect (socket `connect` with intent `online`) → re-assert automatically, no tap. A `not_online` ack → re-assert once; a 409 on the re-assert → flip the UI offline with the reason.
- **D15 `driver:queue`** stays unemitted — deferred to #15 (recorded in NOTES and in `dispatch/index.ts`'s gap comment, "#14/#19" → "#15/#19").
- **D16 Device language** via `expo-localization` → `LANGUAGES` member or `lv`; re-read on `AppState` active.
- **D17 Android battery-optimisation prompt** = a one-time explainer + `IntentLauncher.startActivityAsync(ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)` in the go-online flow, remembered in SecureStore; skippable.
- **D18 API origin** = `EXPO_PUBLIC_API_URL` (inlined by Metro), default `http://localhost:3001`; the Android emulator reaches the host at `http://10.0.2.2:3001`.

---

## UX (breadboards · states · friction audit)

**Auth**
`Login` → [phone field, LV keyboard, prefilled `+371`] → [Sūtīt kodu] → `Verify` → [6-digit field, auto-submits on the 6th digit] · [Sūtīt vēlreiz (60 s)] → `index` gate → `Onboarding/profile` | `Home`.
States: loading (button spinner, field disabled); error 429 `resend_too_soon` (button shows the countdown from `retryAfterSeconds`); 429 `too_many_requests` (inline: "pārāk daudz mēģinājumu — mēģiniet pēc stundas"); 502 `sms_delivery_failed`; 401 `invalid_or_expired_code` (field cleared, focus returned); offline (banner + retry). Empty: n/a.

**Onboarding**
`Profile` → [language chips, device language preselected] · [female-driver switch] → [Turpināt] → `Vehicle` → [plate · make · model · year · seats · child-seat switch] → [Saglabāt] → `Documents` → copy only ("dokumentus pārbaudīsim klātienē pirms pirmās maiņas") → [Gatavs] → `Home`.
States: loading (skeleton while `GET /drivers/me`); error 409 `plate_taken` on the plate field; 400 field errors mapped by zod path; offline banner. Empty: the vehicle form itself.

**Home**
`Home` → [Toggle: "Iet tiešsaistē" / "Iet bezsaistē", 56 px] · earnings card ("Šodien: €84.20 · Braucieni: 7") · status line (Tiešsaistē · pēdējā pozīcija pirms 3 s · rindā: 0) · connection pill (live / reconnecting / offline, derived from ack receipt like the board's) · [Auto: AB-1234 →] · [Iziet].
Banners: permission denied (fg / bg — with [Atvērt iestatījumus]); battery-optimisation explainer (Android, once); "atzīmēts kā bezsaistē HH:MM" + [Iet tiešsaistē]; 409 `vehicle_required` → [Pievienot auto]; 409 `driver_on_ride` (copy only).
States: loading (earnings skeleton); empty earnings (€0.00 · 0); error (earnings card shows "—", toggle unaffected); offline (pill offline, queue count rising, toggle still works locally and re-asserts on reconnect).

**Friction audit (intent = "be online and streaming")**
Returning driver: open app → 1 tap (toggle). New driver, first ever: phone (type + 1 tap) → code (type, 0 taps) → profile (1 tap) → vehicle (5 fields + 1 tap) → documents (1 tap) → toggle (1 tap) → Android permission dialogs (2 system taps: foreground, then "Allow all the time" in settings) → battery prompt (1 tap or skip). **6 app taps + 2 system dialogs**, once. Each step justified: phone/code are the auth; profile carries the two rider-filter attributes dispatch reads; vehicle is server-required (`vehicle_required`); documents is one screen so the driver learns approval is coming (#20) rather than being surprised; the permissions are OS-imposed. Rejected: a combined profile+vehicle screen (one long form on a phone is worse than two short ones), and skipping the documents stub (the issue names it).

Every interactive element: `minHeight: 44` (the toggle 56), `accessibilityRole`, `accessibilityLabel`, `accessibilityState`, visible focus (border colour `colors.accent` on focus for `TextInput`; `Pressable` `focusable` with a 2 px `colors.accent` outline in `focused` state). Status changes announced with `AccessibilityInfo.announceForAccessibility`. The driver app is not the screen-reader launch differentiator (that rule is scoped to rider screens), but the 44 px + focus rule is every plan's.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts + DB (shared, db)

Ack schema, push seam, push-token + earnings schemas, catalog keys, the two columns + migration.

### Phase 2: API — ack, presence sweeper, push slice, push-token routes, earnings read

**Depends on:** Phase 1.

### Phase 3: App tooling (expo-router, jest-expo, eslint, app.json, deps)

**Independent of:** Phase 2 — can run in a parallel worktree while Phase 2 lands. **Depends on:** Phase 1 only for typecheck (the app imports the new schemas).

### Phase 4: App — i18n, auth, onboarding

**Depends on:** Phase 3.

### Phase 5: App — availability + location (queue, uploader, task, presence) + push registration

**Depends on:** Phase 2 (the ack, the push-token route) and Phase 4.

### Phase 6: Docs, traceability, validation

**Depends on:** everything.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable. Run every `VALIDATE` through turbo (`pnpm turbo run <task> --filter <pkg>`) — a direct `pnpm --filter` run fails on a cold `@taxi/shared` dist (#88 lesson).

### Phase 1 — contracts + db

### UPDATE `packages/shared/src/realtime-events.ts`

- **IMPLEMENT**: after `driverLocationEventSchema` (`:58`), add:
  ```ts
  /**
   * The server's answer to one `driver:location` ping (#14). The driver app
   * keeps every fix in a local queue and deletes it ONLY on `accepted: true`,
   * so a fix the server never acknowledged is retried, never lost.
   * `not_online` means the server no longer holds this driver in the online
   * set — the app re-asserts its intent or flips its toggle; it must not keep
   * retrying that fix. `malformed` is dropped client-side (a retry cannot fix
   * it). `store_unavailable` is kept and retried.
   */
  export const driverLocationAckSchema = z.object({
    accepted: z.boolean(),
    reason: z.enum(['not_online', 'malformed', 'store_unavailable']).optional(),
  });
  export type DriverLocationAck = z.infer<typeof driverLocationAckSchema>;
  ```
  Change the two maps: `ClientToServerEvents[RT.driverLocation]: (payload: unknown, ack?: (response: DriverLocationAck) => void) => void;` and `ClientToServerEmitEvents[RT.driverLocation]: (payload: DriverLocationPing, ack: (response: DriverLocationAck) => void) => void;`. Update the header comment's "all 9 events" sentence to note the one ack.
- **PATTERN**: the ping/event pair comment `:40-58`.
- **GOTCHA**: do **not** add to `RT` or `RT_EVENT_SCHEMAS` — an ack is not an event; the catalog test (`tests/realtime-events.test.ts:477-510`) must stay untouched and green.
- **VALIDATE**: `pnpm turbo run typecheck test --filter @taxi/shared` — green; the catalog test still counts 9.
- **SATISFIES**: AC "fixes queue locally and drain on reconnect" (the ack is what "drain" is defined against).

### UPDATE `packages/shared/tests/realtime-events.test.ts`

- **IMPLEMENT**: three cases for `driverLocationAckSchema`: accepts `{ accepted: true }` (expected); accepts `{ accepted: false, reason: 'not_online' }` (edge); rejects `{ accepted: false, reason: 'because' }` and `{}` (failure). Plus a type-level test that `ClientToServerEmitEvents[typeof RT.driverLocation]` takes an ack (mirror `:466-475`).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/shared`.
- **SATISFIES**: AC "1+1+1 per feature".

### CREATE `packages/shared/src/seams/push-provider.ts`

- **IMPLEMENT**:
  ```ts
  /** Seam over Expo's push service (#14). ... swap for FCM/APNs direct post-pilot without touching the drivers slice. */
  export interface PushMessage { title: string; body: string; data?: Record<string, string>; }
  export type PushDeliveryFailure = 'device_not_registered' | 'provider_error';
  export type PushDeliveryResult = { ok: true } | { ok: false; reason: PushDeliveryFailure };
  export interface PushProvider {
    /** Never throws — a nudge is best-effort; the caller reads `reason`. `device_not_registered` = forget the token. */
    send(token: string, message: PushMessage): Promise<PushDeliveryResult>;
  }
  ```
  Export from `src/index.ts` after `seams/telephony-provider`.
- **PATTERN**: `seams/sms-provider.ts`; result-union shape from `seams/payments-provider.ts`.
- **VALIDATE**: `pnpm turbo run typecheck build --filter @taxi/shared`.
- **SATISFIES**: root rule "provider calls go through seam interfaces".

### CREATE `packages/shared/tests/push-provider.test.ts`

- **IMPLEMENT**: a compile-and-run contract: a fake provider returning each variant; `PushDeliveryFailure` is exactly the two values (a `satisfies` tuple check like `payments-provider.test.ts`).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/shared`.

### UPDATE `packages/shared/src/schemas/driver.ts`

- **IMPLEMENT**: append
  ```ts
  /** `ExponentPushToken[...]` (classic) or `ExpoPushToken[...]` — both are minted by `getExpoPushTokenAsync`. */
  export const expoPushTokenSchema = z.string().regex(/^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,64}\]$/);
  export const pushTokenUpdateSchema = z.object({ token: expoPushTokenSchema });
  export type PushTokenUpdate = z.infer<typeof pushTokenUpdateSchema>;

  /** GET /drivers/me/earnings/today — the home card. `day` is in the city's timezone (Europe/Riga for the pilot). */
  export const driverEarningsTodaySchema = z.object({
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    timezone: z.string().min(1),
    earnedCents: nonNegativeCentsSchema,
    rideCount: z.number().int().nonnegative(),
  });
  export type DriverEarningsToday = z.infer<typeof driverEarningsTodaySchema>;
  ```
  (`nonNegativeCentsSchema` from `../money`.) The push token is deliberately **not** on `driverProfileSchema` — a provider handle on the wire profile is how it ends up in a log (`db/src/schema/users.ts:18-22` precedent).
- **VALIDATE**: `pnpm turbo run typecheck test --filter @taxi/shared`; add 1+1+1 to `tests/driver.test.ts` (valid token; `ExpoPushToken[...]` variant; `fcm:abc` rejected).
- **SATISFIES**: AC nudge; AC earnings card.

### UPDATE `packages/shared/src/i18n/lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: add a `// Driver app (#14)` region with these keys (LV reference; RU/EN with identical placeholders — `tests/i18n.test.ts` enforces parity):
  `push.offline_nudge_title` ("Sakta Cab"), `push.offline_nudge_body` ("Jūs esat bezsaistē. Atveriet lietotni, lai atkal saņemtu braucienus."),
  `driver.login.title`, `driver.login.phone_label`, `driver.login.send_code`, `driver.verify.title`, `driver.verify.hint` ("Kods nosūtīts uz {phone}"), `driver.verify.code_label`, `driver.verify.resend`, `driver.verify.resend_in` ("Sūtīt vēlreiz pēc {seconds} s"),
  `driver.error.invalid_or_expired_code`, `driver.error.resend_too_soon`, `driver.error.too_many_requests`, `driver.error.sms_delivery_failed`, `driver.error.session_expired`, `driver.error.vehicle_required`, `driver.error.driver_on_ride`, `driver.error.plate_taken`, `driver.error.offline`, `driver.error.generic`, `driver.action.retry`, `driver.action.continue`, `driver.action.save`, `driver.action.done`, `driver.action.open_settings`, `driver.action.skip`, `driver.action.sign_out`, `driver.action.add_vehicle`,
  `driver.profile.title`, `driver.profile.languages`, `driver.profile.female_driver`, `driver.vehicle.title`, `driver.vehicle.plate`, `driver.vehicle.make`, `driver.vehicle.model`, `driver.vehicle.year`, `driver.vehicle.seats`, `driver.vehicle.child_seat`, `driver.documents.title`, `driver.documents.body`,
  `driver.home.go_online`, `driver.home.go_offline`, `driver.home.status_online`, `driver.home.status_offline`, `driver.home.today` ("Šodien: {amount} · Braucieni: {rides}"), `driver.home.last_fix` ("Pēdējā pozīcija pirms {seconds} s"), `driver.home.queued` ("Rindā: {count}"), `driver.home.pill_live`, `driver.home.pill_reconnecting`, `driver.home.pill_offline`, `driver.home.marked_offline` ("Serveris jūs atzīmēja kā bezsaistē {time}"), `driver.home.vehicle` ("Auto: {plate}"),
  `driver.permission.foreground_denied`, `driver.permission.background_title`, `driver.permission.background_body` ("Iestatījumos izvēlieties «Atļaut vienmēr», lai pozīcija tiktu sūtīta arī ar bloķētu ekrānu."), `driver.permission.battery_title`, `driver.permission.battery_body`,
  `driver.foreground_service.title` ("Sakta Cab — tiešsaistē"), `driver.foreground_service.body` ("Pozīcija tiek sūtīta dispečeram.").
  Language names for the chips come from `driver.lang.lv/ru/en` (each language's own name in that language: "Latviešu", "Русский", "English" — same in all three catalogs).
- **GOTCHA**: `lv.ts` is 218 lines against the 500 cap; ~70 keys ≈ 75 lines — fits. RU/EN at 178/176. Keep the SMS keys untouched. `Braucieni: {rides}` (label form) avoids LV plural forms — logged as a cosmetic in Task 40.
- **VALIDATE**: `pnpm turbo run test lint --filter @taxi/shared` (parity + placeholder tests).
- **SATISFIES**: AC "i18n complete".

### UPDATE `db/src/schema/drivers.ts`

- **IMPLEMENT**: two nullable columns with docblocks:
  ```ts
  /** Expo push token of the driver's current phone (#14). Null = no push; a `DeviceNotRegistered` ticket nulls it. Provider-opaque; never on the wire profile. */
  pushToken: text('push_token'),
  /**
   * When to send the "you've gone offline" nudge. Stamped ONLY by the two
   * server-initiated offline paths (disconnect cleanup, dark sweep), cleared
   * by going online and by the send itself. A row, not a timer: restart-safe,
   * and a phone that reconnects inside the delay is never nudged (#14).
   */
  offlineNudgeDueAt: timestamp('offline_nudge_due_at', { withTimezone: true }),
  ```
  Then `pnpm --filter @taxi/db generate` → `migrations/0010_*.sql` (two `ALTER TABLE "drivers" ADD COLUMN` statements). No index: the sweeper's read is over ≤100 driver rows every 15 s (`expected`: pilot ≤10 drivers) — a seq scan; revisit with a partial index `WHERE offline_nudge_due_at IS NOT NULL` if the drivers table ever passes ~10k rows.
- **DB checklist**: no unique index; `drivers` has no `updated_at` (unchanged); constraint tests: none (nullable columns).
- **VALIDATE**: `pnpm --filter @taxi/db generate` then `COMPOSE_PROJECT_NAME=taxi pnpm turbo run test --filter @taxi/db` (migrates the test DB); `git diff --stat db/migrations` shows exactly one new SQL + journal + snapshot.
- **SATISFIES**: AC nudge.

### Phase 2 — API

### UPDATE `services/api/src/features/drivers/location/driver-location.store.ts`

- **IMPLEMENT**: `markOnline(cityId: string, driverId: string, atMs: number): Promise<void>` — docblock: "Makes the driver eligible … and records `atMs` as their last proof of life, so a driver who goes online and never pings still has a `seen` score for the dark sweep (#14)." Update `OnlineDriver.lastSeenMs` doc: "null only for a member that predates #14's seeding (a Redis set that survived a deploy) — treat as unknown, which the dark sweep reads as dark."
- **PATTERN**: the port's "holds no clock — every caller supplies the time" rule (`:31-34`).
- **VALIDATE**: `pnpm turbo run typecheck --filter @taxi/api` — fails at every caller (next three tasks fix them).

### UPDATE `services/api/src/features/drivers/location/redis-driver-location.store.ts`

- **IMPLEMENT**: `markOnline` → `await this.redis.multi().sadd(onlineKey(cityId), driverId).zadd(seenKey(cityId), String(atMs), driverId).exec();`. `markOffline` unchanged (already ZREMs `seen`).
- **GOTCHA**: `zadd(key, score, member)` — score before member in ioredis.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm turbo run test --filter @taxi/api -- redis-driver-location` (the Redis-gated contract suite).

### UPDATE `services/api/test/harness.ts` + `services/api/test/driver-location-store.contract.ts`

- **IMPLEMENT**: `InMemoryDriverLocationStore.markOnline(cityId, driverId, atMs)` sets `positions`' seen time without a location — split the map value into `{ location: LatLng | null; atMs: number }`; `record` overwrites both; `positionOf` returns null when `location` is null; `findNearby` skips null locations; `listOnline` returns `{ location, lastSeenMs: atMs }`. Contract case (both stores): "`listOnline` right after `markOnline(…, T)` yields `{ location: null, lastSeenMs: T }` (edge)"; "`record` then `listOnline` yields the recorded `atMs` (expected)"; "`markOffline` clears the seeded score too (failure: nothing left behind)".
- **GOTCHA**: `board.service.spec.ts:84` and `driver-location.gateway.spec.ts:69` call `markOnline` with two args — add `Date.now()`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- driver-location.store` and `-- board.service`.

### UPDATE `services/api/src/features/drivers/location/driver-location.policy.ts`

- **IMPLEMENT**: append
  ```ts
  /** No accepted fix for this long while online → offline + nudge (#14). Equal to the dispatch freshness window ON PURPOSE: … one number, no split-brain window. */
  export const PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS;
  /** Sweep cadence. Worst-case mark latency = PRESENCE_DARK_AFTER_SECONDS + this = 75 s. */
  export const PRESENCE_SWEEP_INTERVAL_MS = 15_000;
  /** Nudge delay after a server-initiated offline. A reconnect inside it cancels the push — a tunnel is not a reason to buzz a phone. */
  export const OFFLINE_NUDGE_DELAY_SECONDS = 30;
  export const NUDGE_BATCH_LIMIT = 50;
  ```
- **VALIDATE**: typecheck.

### UPDATE `services/api/src/features/drivers/location/driver-location.service.ts`

- **IMPLEMENT**: `ingest(driverId, ping): Promise<DriverLocationAck>`. `record` false → log `ping_ignored` (as now) and `return { accepted: false, reason: 'not_online' }`. Success → `this.logger.debug({ event: 'driver.location.ping_accepted', driverId, clientAt: ping.at, at, lagMs: atMs - Date.parse(ping.at) })` then emit (as now) and `return { accepted: true }`. Do not catch store errors here — the gateway does, and maps them to `store_unavailable`.
- **GOTCHA**: still no Drizzle here; `driver-location.service.spec.ts` boots with a throwing `DRIZZLE`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- driver-location.service` (update the existing cases to assert the returned ack; add: "returns `not_online` for a driver not in the set (edge)").
- **SATISFIES**: Q2's log-based "server-side track" verification.

### UPDATE `services/api/src/features/drivers/location/driver-location.gateway.ts`

- **IMPLEMENT**: `handleLocation` returns `Promise<DriverLocationAck>`: non-driver → log (as now) → `return { accepted: false, reason: 'malformed' }` (a rider emitting here is a malformed client, not a presence fact; do not leak `not_online`); zod fail → `malformed`; `ingest` throws → log `ingest_failed` → `store_unavailable`; else the service's ack. Update the docblock: "Returns the ack Nest hands to the client's callback (`io-adapter.js`: a non-nil return + a client-supplied ack function). Still never throws." Rename `clearPresenceOnDisconnect` call → `markOfflineByServer(user.sub, 'socket_disconnected')`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- driver-location.gateway`. Add: "acks `{accepted:true}` to an online driver's ping (expected)"; "acks `not_online` after the driver went offline, and records nothing (edge)"; "acks `store_unavailable` and no `exception` frame when the store throws (failure)" — extend the existing store-failure case with `driver.timeout(1000).emitWithAck(...)`.
- **SATISFIES**: AC durable queue.

### UPDATE `services/api/src/features/drivers/drivers.repository.ts`; CREATE `services/api/src/features/drivers/presence/driver-presence.repository.ts`

- **IMPLEMENT**: `drivers.repository.ts` is **396 lines** (`observed`) — the new reads do not fit under the cap, so they get their own file from the start. In `drivers.repository.ts` change only `setOnlineIfEligible`: `.set({ status: 'online', offlineNudgeDueAt: null })`. `toProfile` (`:82-96`) is an explicit column list, so the two new columns never reach `DriverProfile` — leave it. New `DriverPresenceRepository` (`@Injectable`, `@Inject(DRIZZLE)`), ~120 lines:
  - `markOfflineByServer(userId, nudgeDueAt: Date): Promise<boolean>` — `UPDATE drivers SET status='offline', offline_nudge_due_at=$1 WHERE user_id=$2 AND status='online' RETURNING user_id` (replaces the `find` + unconditional `setStatus` pair in `clearPresenceOnDisconnect`; `false` = was not online, nothing happened).
  - `findDueNudges(now: Date, limit: number): Promise<{ userId; pushToken: string | null; language: Language }[]>` — join `users` for `language`; `WHERE drivers.status='offline' AND offline_nudge_due_at <= now` — pass `now` as a bound parameter (test-clock-free, like the sweeper's `tick(nowMs)`).
  - `claimNudge(userId): Promise<boolean>` — `UPDATE … SET offline_nudge_due_at = NULL WHERE user_id=$1 AND offline_nudge_due_at IS NOT NULL RETURNING user_id`.
  - `setPushToken(userId, token: string | null): Promise<void>` — the caller (`DriversService`) runs `drivers.findOrCreate` first (a driver's first call may be this one — the `updateProfile` precedent).
  - Register it in `drivers.module.ts` providers; inject into `DriversService`.
- **PATTERN**: `drivers.repository.ts:164-243` conditional UPDATEs; `requireRow`/`DRIZZLE` injection at `:99-101`.
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/api`; cases land in the integration specs below.

### UPDATE `services/api/src/features/drivers/drivers.service.ts`

- **IMPLEMENT**:
  - Replace `clearPresenceOnDisconnect` with `markOfflineByServer(userId, reason: 'socket_disconnected' | 'dark'): Promise<boolean>`: read status (`find`); if not `online` return false (the `on_ride` rule stays — a crashed app mid-ride must not lose its position: `positionOf` feeds the tracking page); `locations.markOffline` (Redis first); `repo.markOfflineByServer(userId, new Date(Date.now() + OFFLINE_NUDGE_DELAY_SECONDS * 1000))`; if the UPDATE returned undefined, log `driver.presence.status_changed` skipped (a race moved them to `on_ride`; Redis presence was dropped — the same race the old code had, now logged) and return false; log `status_changed { from:'online', to:'offline', reason }`; return true.
  - `markDarkDrivers(nowMs: number): Promise<number>` — `listOnline(cityId)`; for each with `lastSeenMs === null || nowMs - lastSeenMs > PRESENCE_DARK_AFTER_SECONDS * 1000` → `markOfflineByServer(id, 'dark')`; returns the count.
  - `sendDueNudges(now: Date): Promise<void>` — `findDueNudges(now, NUDGE_BATCH_LIMIT)`; per row: `claimNudge` (false → skip, another node sent it); no token → log `nudge_skipped reason:'no_token'`; else `push.send(token, { title: formatMessage(lang, 'push.offline_nudge_title'), body: formatMessage(lang, 'push.offline_nudge_body'), data: { kind: 'offline_nudge' } })`; `ok` → `nudge_sent`; `device_not_registered` → `setPushToken(id, null)` + `nudge_failed`; `provider_error` → `nudge_failed` (no retry — best effort; the driver is offline and Dina's board shows it).
  - `setPushToken(userId, token)` / `clearPushToken(userId)` with `token_registered` / `token_cleared` logs (never log the token).
  - Inject `@Inject(PUSH_PROVIDER) private readonly push: PushProvider`.
- **GOTCHA**: `drivers.service.ts` is 218 lines; this adds ~110 → ~330, under the cap. If it crosses 450, move the nudge pair into `presence/driver-nudge.service.ts`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- drivers.service` (unit, if a spec exists — there is none today; the integration suites carry it) + typecheck.
- **SATISFIES**: AC "process kill/reboot → server marks offline within the threshold and sends the nudge".

### CREATE `services/api/src/features/drivers/presence/driver-presence.sweeper.ts`

- **IMPLEMENT**: `DriverPresenceSweeper implements OnModuleInit, OnModuleDestroy` — constructor `(drivers: DriversService, @Inject(APP_ENV) env)`; `onModuleInit` returns under `test`, else `setInterval(() => void this.tick(), PRESENCE_SWEEP_INTERVAL_MS).unref()`; `tick(nowMs = Date.now())`: `running` guard; `runPass('mark_dark', () => drivers.markDarkDrivers(nowMs))`; `runPass('send_nudges', () => drivers.sendDueNudges(new Date(nowMs)))`; `runPass` logs `driver.presence.sweep_pass_failed { pass, reason }`. ~90 lines.
- **PATTERN**: `dispatch.sweeper.ts:31-102` line for line.
- **VALIDATE**: typecheck; spec next.

### CREATE `services/api/src/features/drivers/presence/driver-presence.sweeper.spec.ts`

- **IMPLEMENT**: unit with a hand-built `DriversService` fake (`markDarkDrivers`/`sendDueNudges` spies): "runs both passes once per tick (expected)"; "a throwing mark pass still runs the nudge pass and logs `sweep_pass_failed` (failure)"; "an in-flight tick skips the overlapping one (edge)"; "does not start the interval under NODE_ENV=test (edge)".
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- driver-presence.sweeper`.

### CREATE `services/api/src/features/push/` slice (5 files + 2 specs)

- **IMPLEMENT**:
  - `push.tokens.ts`: `export const PUSH_PROVIDER = 'PUSH_PROVIDER';`
  - `stub-push.provider.ts`: `send` logs `{ event: 'driver.push.stub_sent', token: maskToken(token), title, body, at }` and resolves `{ ok: true }`. `maskToken` = last 4 chars (the token is a device handle; the stub logs enough to correlate, like `maskPhone`).
  - `expo-push.provider.ts`: `constructor({ accessToken?: string, fetchImpl = fetch, endpoint = 'https://exp.host/--/api/v2/push/send' })`; `send` POSTs `[{ to: token, title, body, data, priority: 'high', channelId: 'presence', sound: 'default' }]` with `Accept`/`Content-Type: application/json` (+ `Authorization: Bearer` when set); parses `{ data: [{ status, details?: { error? } }] }` with a local zod schema (never cast); `status:'ok'` → ok; `details.error === 'DeviceNotRegistered'` → `device_not_registered`; anything else (non-2xx, parse failure, thrown fetch) → `provider_error`, logging `driver.push.request_failed { reason: 'http_<status>' | 'unreadable_response' | 'network', at }` — no free text from Expo in the log.
  - `push.module.ts`: `pushProviderFactory(env)` (as in Patterns) + `@Module({ providers: [{ provide: PUSH_PROVIDER, inject: [APP_ENV], useFactory: pushProviderFactory }], exports: [PUSH_PROVIDER] })`.
  - `index.ts`: `PushModule`, `PUSH_PROVIDER`, `pushProviderFactory`.
  - `expo-push.provider.spec.ts`: fake `fetchImpl`: ok ticket (expected); `DeviceNotRegistered` (edge); 500 / thrown / garbage JSON → `provider_error` and never throws (failure); sends the bearer header only when configured.
  - `push.module.spec.ts`: mirror `auth.module.spec.ts:18-50` — stub outside production; expo when `PUSH_PROVIDER=expo` in every env; production + stub throws `/No production PushProvider is bound/`; the module binds the factory.
- **PATTERN**: `features/telephony/` layout; `stub-sms.provider.ts`; `google-places.provider.ts` for closed-enum failure logging.
- **VALIDATE**: `pnpm turbo run test lint --filter @taxi/api -- push`.
- **SATISFIES**: AC nudge; services/api CLAUDE.md "stub must throw in production".

### UPDATE `services/api/src/common/config/env.schema.ts` + `.env.example`

- **IMPLEMENT**: `PUSH_PROVIDER: z.enum(['stub', 'expo']).default('stub')` with a docblock (why not credential-driven like Twilio: Expo's push API needs no secret — the switch is the intent); `EXPO_PUSH_ACCESS_TOKEN` with the `.optional().transform(empty→undefined)` idiom. No `superRefine` clause — the factory carries the production refusal (the SMS precedent). `.env.example`: both vars under a `# --- Expo push (driver nudge, #14) ---` block, plus `EXPO_PUBLIC_API_URL=http://localhost:3001` under `# --- driver app ---` with the `10.0.2.2` emulator note.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api -- env.schema` (add: default is `stub`; `expo` parses; empty access token → undefined).
- **GOTCHA**: memory `taxi-pretooluse-hook-blocks-dotenv-strings` — a commit message that mentions the example env file by name is blocked by the hook; describe it as "the env template".

### UPDATE `services/api/src/features/drivers/drivers.module.ts` + `index.ts`

- **IMPLEMENT**: `imports: [RealtimeModule, PushModule]`; add `DriverPresenceSweeper` to providers. Update the module docblock (the sweeper's Postgres reads are off the ping path). `index.ts` KNOWN GAPS: add "Dark detection (#14) closes review finding L7 — a driver whose socket stays up but whose GPS goes silent is offline within 75 s; the residual ghost is a driver `online` in a Redis set that survived a deploy with no `seen` score, which the sweep also marks dark." Change "#14/#19" on the queue-view line in `dispatch/index.ts:21` to "#15/#19".
- **VALIDATE**: `pnpm turbo run typecheck --filter @taxi/api`; `app.module`/`drivers.module` compile; `createTestApp()` boots (any integration spec).

### UPDATE `services/api/src/features/drivers/drivers.controller.ts`

- **IMPLEMENT**: `@Put('me/push-token') @HttpCode(204) setPushToken(@CurrentUser() user, @Body(new ZodValidationPipe(pushTokenUpdateSchema)) body)` → `drivers.setPushToken(user.sub, body.token)`; `@Delete('me/push-token') @HttpCode(204) clearPushToken(...)`. Both `Promise<void>`.
- **GOTCHA**: still no `:id` route in this controller.
- **VALIDATE**: `pnpm turbo run typecheck --filter @taxi/api`.

### CREATE `services/api/src/features/drivers/push-token.integration.spec.ts`

- **IMPLEMENT**: `createTestApp`; sign in a driver (copy `signIn` from `drivers.integration.spec.ts`, new `phoneFor` prefix — grep for a free `+3712xx`); PUT a valid token → 204 and `drivers.push_token` holds it (expected); PUT `ExpoPushToken[...]` variant → 204 (edge); PUT `fcm:xyz` → 400; DELETE → 204 and null; a rider's token → 403 (failure). Assert `push_token` never appears in `GET /drivers/me`'s body.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run test --filter @taxi/api -- push-token`.

### CREATE `services/api/src/features/drivers/presence/driver-presence.integration.spec.ts`

- **IMPLEMENT**: boot with `createTestApp()`; override `PUSH_PROVIDER` with a `RecordingPushProvider` (add it to `harness.ts` next to `RecordingSmsProvider`, with `sent: { token, message }[]` and a settable `nextResult`; and add `push` to `TestApp` + the `overrideProvider(PUSH_PROVIDER)` line in `createTestApp` — the seventh swapped provider; update the docblock's count). Get `DriverPresenceSweeper` from the app and drive `tick(nowMs)` by hand. Cases:
  1. **Dark (expected)**: driver online via `PUT /drivers/me/status` (needs a vehicle — reuse the driver-spec fixture), socket connected, one ping acked; `tick(T + 61 s)` → `drivers.status = 'offline'`, `ctx.locations.isOnline(...) === false`, log reason `dark`, `offline_nudge_due_at ≈ T+61+30`; `tick(T + 61 s + 31 s)` → `ctx.push.sent` has one message with the LV body and the driver's token; column null; the socket is **still connected** (dark does not disconnect).
  2. **Disconnect → nudge (edge)**: online, connected, then `client.close()`; wait for `handleDisconnect` (poll `drivers.status` becomes `offline`, ≤2 s); `tick(now + 31 s)` → one nudge.
  3. **Reconnect cancels (edge)**: same as 2, but `PUT /drivers/me/status online` again before the tick → no nudge, column null.
  4. **No token (failure)**: driver never registered a token → `nudge_skipped`, nothing sent.
  5. **DeviceNotRegistered (failure)**: `ctx.push.nextResult = { ok:false, reason:'device_not_registered' }` → column `push_token` nulled after the tick.
  6. **Never pinged (edge)**: online, no ping, `tick(T + 61 s)` → dark (the seeded `seen` score).
  7. **on_ride is untouched (edge)**: set `drivers.status='on_ride'` directly; no ping for 61 s → still `on_ride`, still in the Redis set.
- **GOTCHA**: `afterEach(closeClients)` before `app.close()`; retire rides if any are created; the ping's server `at` is `Date.now()` — pass `nowMs` to `tick` relative to a `Date.now()` captured right after the ping.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run test --filter @taxi/api -- driver-presence`.
- **SATISFIES**: AC dark/nudge (both branches).

### CREATE `services/api/src/features/ledger/ledger.policy.ts`, `earnings.controller.ts`; UPDATE `ledger.repository.ts`, `ledger.service.ts`, `ledger.module.ts`, `index.ts`

- **IMPLEMENT**:
  - `ledger.policy.ts`: `export const LEDGER_DAY_TIMEZONE = 'Europe/Riga';` with the single-city note and a pointer to `citySchema.timezone`.
  - `LedgerRepository.driverEarningsToday(driverId, timezone): Promise<{ day: string; earnedCents: number; rideCount: number }>` — one query:
    ```sql
    SELECT to_char(now() AT TIME ZONE $tz, 'YYYY-MM-DD') AS day,
           coalesce(sum(e.amount_cents), 0)::int AS earned_cents,
           count(distinct e.ride_id)::int AS ride_count
    FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id
    WHERE a.owner_type = 'driver' AND a.owner_id = $driverId
      AND e.entry_type IN ('ride_fare','commission')
      AND e.created_at >= (date_trunc('day', now() AT TIME ZONE $tz) AT TIME ZONE $tz)
    ```
    via Drizzle `sql` fragments (never string-interpolate `$tz`). A driver with no account → the LEFT-less join yields the zero row from `coalesce`; verify with the no-account case.
  - `LedgerService.todayForDriver(driverId): Promise<DriverEarningsToday>` → `driverEarningsTodaySchema.parse({ ...row, timezone: LEDGER_DAY_TIMEZONE })`.
  - `earnings.controller.ts`: `@Controller('drivers/me/earnings') @Roles('driver')` `@Get('today')` → `ledger.todayForDriver(user.sub)`.
  - `ledger.module.ts`: `controllers: [EarningsController]`. `index.ts`: replace the "NO PER-ACCOUNT STATEMENT READ" gap line with "One aggregate read (#14): today's net for the home card. The per-ride statement is #15's."
- **GOTCHA**: `earned` counts settlement entries only — a completed-but-unsettled ride is not "earned" yet; that is #15/#12 semantics, state it in the docblock.
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/api`.
- **SATISFIES**: the today card.

### CREATE `services/api/src/features/ledger/earnings.integration.spec.ts`

- **IMPLEMENT**: sign a driver in; insert `ledger_accounts` (driver) + entries directly via `ctx.db`: today `ride_fare +1240`, `commission −186` (ride A), `ride_fare +800`, `commission −120` (ride B), and a `cash_settlement −1240` (must be ignored), plus yesterday's pair with `created_at = now() - interval '1 day'` (must be ignored) → `{ earnedCents: 1734, rideCount: 2 }` (expected; `derived`: 1240−186+800−120). No account → `{ 0, 0 }` (edge). Rider token → 403 (failure). Parse the body with `driverEarningsTodaySchema`.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run test --filter @taxi/api -- earnings`.

### VERIFY `services/api/scripts/mint-tracked-ride.ts` (no edit expected)

- **IMPLEMENT**: nothing — the script goes online through `PUT /drivers/me/status` and emits `driver:location` fire-and-forget (`:322`, `:564`); it never calls the store directly (`observed`: no `markOnline` in the file). It keeps working because the server ignores a missing ack callback. Typecheck/lint cover it.
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/api`.

### Phase 3 — app tooling

### UPDATE `apps/driver/package.json`, `app.json`, `tsconfig.json`; DELETE `App.tsx`, `index.ts`; CREATE `eslint.config.mjs`, `jest.setup.ts`, `locales/*.json`

- **IMPLEMENT**:
  - From `apps/driver`: `npx expo install expo-router react-native-safe-area-context react-native-screens expo-linking expo-constants expo-location expo-task-manager expo-sqlite expo-secure-store expo-keep-awake expo-notifications expo-localization expo-intent-launcher expo-dev-client` then `npx expo install jest-expo jest @types/jest @testing-library/react-native eslint eslint-config-expo eslint-plugin-prettier eslint-config-prettier prettier --dev`; `pnpm add socket.io-client@^4.8.3` (match dispatch/api). Then **`npx expo install --check`** must report nothing (memory: the SDK-mix crash).
  - `package.json`: `"main": "expo-router/entry"`; scripts `lint: "eslint ."`, `test: "jest"`; `"jest": { "preset": "jest-expo", "setupFilesAfterEach"→ use `setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"]`, "testMatch": ["<rootDir>/src/**/*.test.{ts,tsx}"], "transformIgnorePatterns": [<the npm/yarn pattern from the docs>] }`.
  - `tsconfig.json`: keep `extends: "expo/tsconfig.base"`, add `"compilerOptions": { "strict": true, "types": ["jest"], "paths": { "@/*": ["./src/*"] } }`, `"include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]`.
  - `app.json` → `expo`: `name: "Sakta Cab Driver"`, `slug: "sakta-cab-driver"`, `scheme: "saktacabdriver"`, `ios.bundleIdentifier: "lv.saktacab.driver"`, `ios.infoPlist.UIBackgroundModes: ["location"]`, `ios.infoPlist.NSLocationWhenInUseUsageDescription` / `NSLocationAlwaysAndWhenInUseUsageDescription` (EN defaults; LV/RU via `"locales": { "lv": "./locales/lv.json", "ru": "./locales/ru.json", "en": "./locales/en.json" }`), `android.package: "lv.saktacab.driver"`, `android.permissions: ["ACCESS_COARSE_LOCATION","ACCESS_FINE_LOCATION","ACCESS_BACKGROUND_LOCATION","FOREGROUND_SERVICE","FOREGROUND_SERVICE_LOCATION","RECEIVE_BOOT_COMPLETED","POST_NOTIFICATIONS","WAKE_LOCK"]` (WAKE_LOCK for keep-awake; the harness omitted it because it had no keep-awake), `android.googleServicesFile: "./google-services.json"` **only once A1 lands** (a missing file fails prebuild), `plugins: ["expo-router", ["expo-location", { isIosBackgroundLocationEnabled: true, isAndroidBackgroundLocationEnabled: true, isAndroidForegroundServiceEnabled: true, androidForegroundServiceIcon: "./assets/notification-icon.png" }], ["expo-notifications", { icon: "./assets/notification-icon.png" }], "expo-secure-store"]`, `experiments.typedRoutes: true`. `extra.eas.projectId` — **A2** (`eas init`), leave absent until then; the push registration handles its absence.
  - `eslint.config.mjs`: `defineConfig([expoConfig, eslintPluginPrettierRecommended, { ignores: ['dist/*', '.expo/*', 'android/*', 'ios/*'] }, <max-lines block + test-file override copied from apps/dispatch/eslint.config.mjs:19-38>])`. `.prettierrc`: `{ "singleQuote": true }` (the api's style; shared/db differ — pick the api's, the closer neighbour).
  - `jest.setup.ts`: `jest.mock` for `expo-secure-store` (in-memory map), `expo-sqlite` (throwing stub — nothing should touch it in unit tests; the queue tests use the in-memory port), `expo-location`, `expo-task-manager` (`defineTask` records the executor so a test can invoke it), `expo-keep-awake`, `expo-notifications`, `expo-localization` (`getLocales: () => [{ languageCode: 'lv' }]`), `expo-intent-launcher`. Colocated tests override per case.
  - `.gitignore`: add `google-services.json`? **No** — the docs say it may be committed (public identifiers); gitignore the **service-account** JSON pattern `*-firebase-adminsdk-*.json` instead.
- **PATTERN**: `apps/dispatch/eslint.config.mjs`; `apps/dispatch/vitest.setup.ts` for the "why cleanup is load-bearing" note (RNTL auto-cleans under jest — no manual `afterEach(cleanup)` needed; say so in the setup file).
- **GOTCHA**: root `pnpm.overrides` pins react `19.2.3` — do not touch it; `expo install --check` is the judge. Do not add `metro.config.js` unless `expo start` cannot resolve `@taxi/shared`. `expo-router` needs `expo-linking`/`expo-constants` even if unused directly.
- **VALIDATE**: `pnpm install` (lockfile updates only for this package); `pnpm turbo run typecheck lint test --filter @taxi/driver` with one placeholder test (`src/features/i18n/device-language.test.ts` from Task 27 is the first real one; until then a trivial `expect(1).toBe(1)` so the runner is proven under turbo — **read the output for a `@taxi/driver:test` line**, not just the exit code (#88 lesson)). `npx expo-doctor` clean.
- **SATISFIES**: "`pnpm check` green" with the app actually in the gate.

### CREATE `apps/driver/src/components/{Screen,Button,TextField,Banner}.tsx` + `index.ts`

- **IMPLEMENT**: `Screen` (SafeAreaView + `colors.bg` + `spacing.md` padding); `Button` (`Pressable`, `minHeight: 44`, `accessibilityRole="button"`, `accessibilityState={{ disabled, busy }}`, `variant: 'primary' | 'secondary' | 'danger'` → `colors.accent/bgSurface/danger`, focus ring via `({ focused }) => …` style; `loading` renders `ActivityIndicator` and disables); `TextField` (label + `TextInput`, `accessibilityLabel`, error text in `colors.danger`, focus border `colors.accent`, `minHeight: 44`); `Banner` (`tone: 'info' | 'warning' | 'danger'`, optional action Button, `accessibilityLiveRegion="polite"`).
- **GOTCHA**: theme values only; no hex, no px literals beyond `1`/`2` for borders (log even those? — no: border widths are not in the theme; log it, Task 40).
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/driver`.

### Phase 4 — app: i18n, auth, onboarding

### CREATE `apps/driver/src/features/i18n/{device-language.ts,use-t.ts,index.ts}` + `device-language.test.ts`

- **IMPLEMENT**: `deviceLanguage(locales = getLocales()): Language` — first `languageCode` that is a `LANGUAGES` member, else `'lv'`; `useT()` — `useState(deviceLanguage())`, re-read on `AppState` `active`; returns `t(key, params)` bound to `formatMessage`. Tests: `ru-RU` → ru (expected); `['de-DE','en-GB']` → en (edge: second locale wins); `[]`/`[{languageCode: null}]` → lv (failure).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- device-language`.
- **SATISFIES**: AC i18n.

### CREATE `apps/driver/src/features/auth/{phone-normalise.ts,api-client.ts,session-store.ts,use-session.tsx,index.ts}` + tests

- **IMPLEMENT**:
  - `normalisePhone(input)`: strip spaces/dashes; `2xxxxxxx` (8 digits starting 2) → `+371…`; `371…` → `+371…`; leading `+` kept; then `phoneSchema.safeParse` → `string | undefined`. Tests: `"2 612 3456"` → `+37126123456` (expected); `"+37126123456"` unchanged (edge); `"12"` → undefined (failure).
  - `session-store.ts`: `readSession(): Promise<AuthSession | null>` — `SecureStore.getItemAsync('sakta.driver.session')` → `authSessionSchema.safeParse(JSON.parse)`; unparseable or `expiresAt <= now` → delete + null; `writeSession`, `clearSession`. Tests with the mocked SecureStore: roundtrip (expected); expired → null and cleared (edge); corrupt JSON → null, no throw (failure).
  - `api-client.ts`: `createApiClient({ baseUrl, getToken, onUnauthorized })` → `request<T>(method, path, { body?, schema? })`: JSON, `Authorization: Bearer`, 8 s `AbortController` timeout; non-2xx → `throw new ApiError(status, code)` where `code` = `body.message` if string (Nest's `HttpException('snake')` shape) or `body.message?.message`/`'generic'`; 401 → `onUnauthorized()` then throw; `schema?.parse(json)` on success (204 → undefined). Tests: bearer header + parsed body (expected); 409 → `ApiError{409,'vehicle_required'}` (edge); 401 calls `onUnauthorized` (failure); network error → `ApiError{0,'offline'}`.
  - `use-session.tsx`: `SessionProvider` — state `{ status: 'loading' | 'signedOut' | 'signedIn', session? }`; `useEffect` reads the store once; `signIn(session)` writes + sets; `signOut()` clears + sets (and, via a registered hook, lets availability/push run their teardown first — expose `onBeforeSignOut(fn)`); `useSession()`. `api` instance built here with `onUnauthorized = signOut`.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- auth`.
- **SATISFIES**: AC "auth survives app restart (expected)"; "expired-token re-auth (failure)".

### CREATE `apps/driver/src/features/auth/{login-screen.tsx,verify-screen.tsx}` + tests; CREATE `src/app/login.tsx`, `src/app/verify.tsx`

- **IMPLEMENT**: `LoginScreen`: phone `TextField` (`keyboardType="phone-pad"`, `textContentType="telephoneNumber"`, default `+371`), Button disabled until `normalisePhone` succeeds; submit → `POST /auth/otp/request { phone, role: 'driver' }` → `router.push({ pathname: '/verify', params: { phone, resendAfterSeconds } })`; errors → inline via `t('driver.error.<code>')`; 429 `resend_too_soon` carries `retryAfterSeconds` in the body — show the countdown. `VerifyScreen`: 6-digit `TextField` (`keyboardType="number-pad"`, `textContentType="oneTimeCode"`, `autoComplete="sms-otp"`), auto-submit at 6 digits → `POST /auth/otp/verify` → `authSessionSchema` → `signIn(session)` → `router.replace('/')`; resend button with a countdown from `resendAfterSeconds` (60), calling request again; 401 → clear field, show error, refocus. Route files: `export { LoginScreen as default } from '@/features/auth';`.
- Tests (RNTL, mocked `api`): login submits a normalised phone and navigates (expected); verify auto-submits at 6 digits (expected); resend disabled for 60 s then enabled (edge, fake timers); 401 clears the field and shows `invalid_or_expired_code` copy (failure).
- **GOTCHA**: never render the OTP code anywhere; never log the phone unmasked (the app logs nothing user-identifying — `console.*` is lint-banned in `src/features/**` via `no-console` except `warn`/`error`).
- **VALIDATE**: `pnpm turbo run test lint --filter @taxi/driver -- auth`.

### CREATE `apps/driver/src/features/onboarding/{use-me.ts,onboarding-state.ts,profile-screen.tsx,vehicle-screen.tsx,documents-screen.tsx,index.ts}` + tests; CREATE `src/app/onboarding/{profile,vehicle,documents}.tsx`, `src/app/index.tsx`

- **IMPLEMENT**:
  - `use-me.ts`: `MeProvider` / `useMe()` — `GET /drivers/me` (`driverMeSchema`), `refetch()`, `patchProfile(DriverProfileUpdate)`, `createVehicle(VehicleCreate)`, `updateVehicle(id, VehicleUpdate)`; optimistic none — refetch after writes.
  - `onboarding-state.ts`: `nextRoute(me: DriverMe | null, session): '/login' | '/onboarding/profile' | '/home'` — pure; `vehicles.length === 0 → profile`. Tests: no vehicle → onboarding (expected); one vehicle → home (edge); signed out → login (failure).
  - `src/app/index.tsx`: reads session + me; renders a spinner while loading; `<Redirect href={nextRoute(...)} />`.
  - `ProfileScreen`: language chips (`Pressable`, `accessibilityRole="checkbox"`, ≥1 required — the schema's `.min(1)`), device language preselected, female-driver `Switch` with a label; Continue → `PATCH /drivers/me` **only if changed** (an empty patch is a 400 by the schema's refine) → `/onboarding/vehicle`.
  - `VehicleScreen`: fields per `vehicleCreateSchema` (plate uppercase-forced, year numeric 1990–2100, seats 1–8, child-seat switch; `category` fixed `standard` for the pilot — no picker, log Task 40); Save → `POST` (create) or `PATCH` (edit mode via `?vehicleId=`) → 409 `plate_taken` on the plate field; then `/onboarding/documents` (create) or back (edit).
  - `DocumentsScreen`: title + body copy + Done → `router.replace('/home')`.
- Tests: `vehicle-screen.test.tsx` — submits the parsed body (expected); `plate_taken` shows on the field (edge); zod-invalid year blocks submit (failure).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- onboarding`.
- **SATISFIES**: issue scope "onboarding shell (profile/vehicle against #8; document upload stub)".

### Phase 5 — app: location + availability + push

### CREATE `apps/driver/src/features/location/{fix-queue.ts,in-memory-fix-queue.ts,sqlite-fix-queue.ts}` + `in-memory-fix-queue.test.ts`

- **IMPLEMENT**:
  - `fix-queue.ts`: `export interface QueuedFix { id: number; at: string; lat: number; lng: number; heading: number | null }` and the port `FixQueue { enqueue(fixes: NewFix[]): Promise<void>; peek(limit): Promise<QueuedFix[]>; remove(ids: number[]): Promise<void>; count(): Promise<number>; clear(): Promise<void>; prune(keepNewest: number): Promise<void> }`. `MAX_QUEUED_FIXES = 20_000` (`derived`: 1 fix/4 s × 12 h = 10 800; ×~60 B ≈ 650 KB; 20 000 is a ~22 h ceiling).
  - `in-memory-fix-queue.ts`: array-backed, monotonic ids — the test double and nothing else.
  - `sqlite-fix-queue.ts`: `openDatabaseAsync('sakta-driver.db')` lazily (module-level promise, shared by the headless task and the UI); `CREATE TABLE IF NOT EXISTS fixes (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, heading REAL)`; `enqueue` inside `withExclusiveTransactionAsync`, then `prune` when `count() > MAX_QUEUED_FIXES` (delete oldest beyond the cap); `peek` = `ORDER BY id LIMIT ?`; `remove` = `DELETE WHERE id IN (...)` (chunk by 100). ≤80 lines; exercised by Level 4, not unit tests (jest-expo has no sqlite).
- Tests (in-memory): FIFO order (expected); `remove` of a subset leaves the rest (edge); `prune` keeps the newest N (failure: old ones gone, count exact).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- fix-queue`.

### CREATE `apps/driver/src/features/location/{fix-throttle.ts,backoff.ts}` + tests

- **IMPLEMENT**: `MIN_FIX_INTERVAL_MS = 4_000` — `selectFixes(incoming: LocationObject[], lastEnqueuedTs: number | null): { fixes: NewFix[]; lastTs: number }` — sort by `timestamp`, keep a fix when `timestamp - lastTs >= MIN_FIX_INTERVAL_MS`, drop non-finite coords, map `heading` (`-1`/null → null; else `((h % 360) + 360) % 360`), `at = new Date(timestamp).toISOString()`. `nextBackoffMs(attempt)` = `min(1000 × 2^attempt, 30_000)` with ±20 % jitter from an injected `random()`; `attempt` resets on success.
- Tests: throttle — 1 Hz burst of 10 → 3 kept at 0/4/8 s (expected); a batch older than `lastTs` yields nothing (edge: OS replayed old fixes); NaN lat dropped (failure). Backoff — 1, 2, 4 … capped 30 s (expected); jitter bounds (edge); attempt 20 still 30 s (failure: no overflow).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- fix-throttle backoff`.
- **SATISFIES**: `apps/driver/CLAUDE.md` battery discipline (time-throttle); D7's heartbeat arithmetic.

### CREATE `apps/driver/src/features/location/{socket.ts,uploader.ts}` + `uploader.test.ts`

- **IMPLEMENT**:
  - `socket.ts`: `createDriverSocket(token): DriverSocket` = `io(apiUrl(), { auth: { token }, transports: ['websocket'], autoConnect: false, reconnectionDelay: 500, reconnectionDelayMax: 30_000, randomizationFactor: 0.5 })` typed `Socket<ServerToClientEvents, ClientToServerEmitEvents>`; `emitFixWithAck(socket, ping, timeoutMs): Promise<DriverLocationAck | 'timeout' | 'disconnected'>` — `socket.timeout(timeoutMs).emit(RT.driverLocation, ping, (err, res) => …)`, parse `res` with `driverLocationAckSchema.safeParse` (unparseable → treat as `timeout`, i.e. retry). `connect_error` with message `unauthorized` → `onUnauthorized()` (token dead → sign-out path).
  - `uploader.ts`: `class FixUploader { constructor(queue: FixQueue, socket: () => DriverSocket | null, hooks: { onServerOffline(): void; onProgress(stats): void; now(): number; sleep(ms) }) ; kick(): void; stop(): void }` — `kick` starts `drain()` if not running: loop `peek(50)` → for each fix in id order → `emitFixWithAck(…, 5_000)`; `accepted` → `remove([id])`, attempt = 0, `onProgress({ lastAckAt })`; `not_online` → `onServerOffline()`, stop the loop (the presence layer re-asserts and re-kicks); `malformed` → `remove([id])` (retrying cannot help), continue; `store_unavailable`/`timeout`/`disconnected` → `sleep(nextBackoffMs(attempt++))`, then loop (if the socket is disconnected, stop and rely on the `connect` handler re-kicking). Empty queue → exit.
- Tests (fake socket with a scripted ack sequence; in-memory queue; injected clock/sleep): sends oldest first and removes each on `accepted` (expected); a `timeout` keeps the row, backs off, and resumes — order preserved (edge); `not_online` stops the loop and fires `onServerOffline` with the row still queued (failure); `malformed` drops exactly that row; a second `kick` during a drain is a no-op (edge).
- **GOTCHA**: sequential awaits on purpose — parallel emits reorder the track and make the "no gap" log unreadable.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- uploader`.
- **SATISFIES**: AC "fixes queue locally and drain on reconnect".

### CREATE `apps/driver/src/features/location/{location-options.ts,location-task.ts,permissions.ts,index.ts}`

- **IMPLEMENT**:
  - `location-options.ts`: `LOCATION_TASK = 'sakta-driver-location'`; `locationTaskOptions(t): LocationTaskOptions` = `{ accuracy: BestForNavigation, timeInterval: 4000, distanceInterval: 0, deferredUpdatesInterval: 0, deferredUpdatesDistance: 0, activityType: AutomotiveNavigation, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, foregroundService: { notificationTitle: t('driver.foreground_service.title'), notificationBody: t('driver.foreground_service.body'), notificationColor: colors.accent, killServiceOnDestroy: false } }` — docblock quoting D7 and the harness lines it deviates from.
  - `location-task.ts`: module scope `TaskManager.defineTask<{ locations: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => { if (error || !data?.locations?.length) return; const { fixes, lastTs } = selectFixes(data.locations, lastEnqueuedTs); lastEnqueuedTs = lastTs; if (fixes.length) { await queue.enqueue(fixes); uploader.kick(); } })` — `queue`/`uploader`/`lastEnqueuedTs` are module singletons exported for the presence hook (`getLocationRuntime()`); the file is imported for its side effect by `src/app/_layout.tsx` (first import in the file) — **that is what satisfies "global scope"**.
  - `permissions.ts`: `ensureLocationPermissions(): Promise<'granted' | 'foreground_denied' | 'background_denied'>` — foreground then background, in that order (Android 11+ opens Settings for the second; re-check with `getBackgroundPermissionsAsync` on return); `startStreaming(t)` = `startLocationUpdatesAsync(LOCATION_TASK, locationTaskOptions(t))` guarded by `hasStartedLocationUpdatesAsync`; `stopStreaming()`; `isStreaming()`. Android only: `maybePromptBatteryOptimisation(): Promise<'shown' | 'skipped'>` — reads/writes the SecureStore flag; the screen shows the explainer and calls `IntentLauncher.startActivityAsync(ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS)`.
- **GOTCHA**: start streaming **while foregrounded** (Android 12+ FGS rule) — the toggle is on screen, so it is; never start it from a background handler. The `defineTask` file must not import React components (it runs headless).
- **VALIDATE**: `pnpm turbo run typecheck lint --filter @taxi/driver`; behaviour is Level 4.

### CREATE `apps/driver/src/features/availability/{intent-store.ts,presence-state.ts,use-presence.tsx,format-eur.ts,use-earnings.ts,earnings-card.tsx,home-screen.tsx,index.ts}` + tests; CREATE `src/app/home.tsx`

- **IMPLEMENT**:
  - `intent-store.ts`: SecureStore `sakta.driver.intent` = `'online' | 'offline'`, and `sakta.driver.marked_offline_at` (ISO, set when the app learns the server flipped it).
  - `presence-state.ts`: a pure reducer over `{ intent, server: DriverStatus | null, streaming: boolean, connection: 'live' | 'reconnecting' | 'offline', queued: number, lastFixAt: number | null, lastAckAt: number | null, banner: null | { kind: 'marked_offline' | 'foreground_denied' | 'background_denied' | 'vehicle_required' | 'driver_on_ride' | 'battery', at?: string } }` and events (`toggle_pressed`, `server_online`, `server_offline{at}`, `ack_not_online`, `socket_connect`, `socket_disconnect`, `permission{result}`, `cold_launch{streaming}`, `fix{at}`, `ack{at}`, `error{code}`). `decide(state, event) → { state, effects: Effect[] }` where effects are `put_status(online|offline)`, `start_stream`, `stop_stream`, `connect_socket`, `disconnect_socket`, `keep_awake(on|off)`, `kick_uploader`, `show_battery_prompt`, `drain_then_clear`. This is where D14 lives and is tested.
  - `use-presence.tsx`: `PresenceProvider` runs the reducer and executes effects against the runtime (`getLocationRuntime()`, the socket, `api`, keep-awake); wires `socket.on('connect'|'disconnect')`, `uploader.onServerOffline → ack_not_online`, `AppState` active → `refetch me` → `server_online|server_offline`; cold launch: `intent === 'online'` → `cold_launch({ streaming: await isStreaming() })`. Registers `onBeforeSignOut` → `toggle to offline` + `DELETE /drivers/me/push-token`.
  - `format-eur.ts`: `formatEur(cents)` → `"€84.20"` / `"-€1.86"` — integer maths (`Math.trunc(abs/100)`, `abs % 100` zero-padded). Tests: 8420 → `€84.20`; 0 → `€0.00`; −186 → `-€1.86`.
  - `use-earnings.ts` + `earnings-card.tsx`: `GET /drivers/me/earnings/today` on mount, on `AppState` active, and every 60 s while online; card text `t('driver.home.today', { amount: formatEur(earnedCents), rides: rideCount })`; skeleton / `—` on error.
  - `home-screen.tsx`: per the UX section; toggle = `Button` 56 px, `accessibilityRole="switch"`, `accessibilityState={{ checked: online, busy }}`; pill derived from `lastAckAt` age (live ≤10 s, reconnecting ≤60 s, else offline) — receipt, not socket flags (the board's rule); diagnostics line; vehicle link → `/onboarding/vehicle?vehicleId=…`; sign-out.
- Tests: `presence-state.test.ts` — toggle from offline emits `put_status(online)`, `start_stream`, `connect_socket`, `keep_awake(on)` in that order (expected); `ack_not_online` with intent online → one `put_status(online)` and a `re_asserted` flag so a second `ack_not_online` flips to offline with the `marked_offline` banner instead of looping (edge); `error{vehicle_required}` → intent offline, banner, `stop_stream` (failure); `cold_launch{streaming:true}` → re-assert; `cold_launch{streaming:false}` → banner only (edge); `socket_connect` with intent online → `put_status(online)` + `kick_uploader`. `home-screen.test.tsx` — renders the LV copy from the catalog, the toggle dispatches `toggle_pressed` (expected), the marked-offline banner's button dispatches too (edge), earnings error renders `—` (failure).
- **GOTCHA**: `PUT /drivers/me/status online` while already online is legal and idempotent server-side (`setOnlineIfEligible` is unconditional on the current status) — re-asserting is safe. Going offline: `drain_then_clear` (≤5 s best-effort drain) **before** `put_status(offline)`, or every queued fix comes back `not_online`.
- **VALIDATE**: `pnpm turbo run test lint --filter @taxi/driver -- availability`.
- **SATISFIES**: AC "going offline stops pings (edge)"; D14.

### CREATE `apps/driver/src/features/push/{register-push-token.ts,index.ts}` + test

- **IMPLEMENT**: `registerPushToken(api)`: Android → `setNotificationChannelAsync('presence', { name: t('driver.foreground_service.title'), importance: MAX })`; `requestPermissionsAsync()`; `projectId = Constants.expoConfig?.extra?.eas?.projectId` — absent → return `'no_project'` (no throw, one `console.warn`); `getExpoPushTokenAsync({ projectId })` in `try` → `PUT /drivers/me/push-token { token }` → `'registered'`; any throw → `'unavailable'`. Called once per signed-in app start from `SessionProvider` (after `signedIn`). `setNotificationHandler({ shouldShowAlert: true, shouldPlaySound: true })` so a nudge arriving while the app is foregrounded still shows. `addNotificationResponseReceivedListener` → `router.replace('/')` (home decides the banner).
- Tests: registers and PUTs (expected); no projectId → `no_project`, no PUT (edge); `getExpoPushTokenAsync` throws → `unavailable`, no PUT (failure).
- **VALIDATE**: `pnpm turbo run test --filter @taxi/driver -- push`.
- **SATISFIES**: the nudge's delivery leg.

### CREATE `apps/driver/src/app/_layout.tsx`; UPDATE `apps/driver/CLAUDE.md`

- **IMPLEMENT**: `_layout.tsx`: `import '@/features/location/location-task';` first; `<SessionProvider><MeProvider><PresenceProvider><Stack screenOptions={{ headerShown: false }} /></PresenceProvider></MeProvider></SessionProvider>`; `<StatusBar style="dark" />`. `CLAUDE.md`: replace the "throttle by movement" bullet with the time-throttle/heartbeat rule (D7), add the slice list, the "defineTask must stay a top-level import in `_layout.tsx`" rule, the SecureStore keys, and "add deps with `npx expo install`; `npx expo install --check` before any build".
- **VALIDATE**: `pnpm turbo run typecheck lint test --filter @taxi/driver`; `npx expo export --platform android` (bundles without a device — proves Metro resolves `@taxi/shared` and expo-router routes).

### Phase 6 — docs, traceability, validation

### UPDATE `.claude/references/realtime-events.md`, `docs/epics/mvp-traceability.md:39`, `docs/runbooks/hetzner-deploy.md` §3, `.claude/references/ui-decisions.md`

- **IMPLEMENT**: realtime row for `driver:location`: "+ the api acks each ping with `DriverLocationAck` (`accepted`, `reason`) — the driver app deletes a queued fix only on `accepted: true` (#14). The one acknowledgement in the catalog; not an event." Traceability: "built (PR #<n>, 2026-…); Android/iOS field drives owed (#4 open)". Runbook env table: `PUSH_PROVIDER=expo`, `EXPO_PUSH_ACCESS_TOKEN` (optional). `ui-decisions.md` three lines dated 2026-08-31 · driver: (1) "Braucieni: 7" label form vs "7 braucieni" (LV plural forms) — revisit with the brand copy pass; (2) the vehicle `category` picker (pilot = `standard` only, hidden); (3) border widths 1/2 px are not theme tokens — add `borderWidth` to the theme or accept.
- **GOTCHA**: Q6 — the runbook edit collides with #13's open branch; if #13 is still unmerged when this lands, put the two rows in the PR body as a follow-up for #13's author (same person) instead of editing the file.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/shared` (the realtime-events doc-sync test reads the table).

### VALIDATE — the whole gate

- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:<REDIS_PORT> pnpm turbo run typecheck lint test build --force` from a cleared dist — read the output for `@taxi/driver:lint`, `@taxi/driver:test`, `@taxi/api:test` lines. Then Level 4 below.

---

## TESTING STRATEGY

### Unit Tests

- **shared** (vitest): ack schema, push-token schema, earnings schema, push seam contract, catalog parity (existing test covers the new keys automatically).
- **api** (jest): `expo-push.provider`, `push.module` factory, `driver-presence.sweeper` (fake service), `driver-location.service` (ack return, no Drizzle), plus the existing store contract with the seeded `seen` score.
- **app** (jest-expo): the pure core — throttle, backoff, in-memory queue, uploader, presence reducer, onboarding routing, phone normalisation, session store, api client, device language, `formatEur`, push registration — and RNTL screen tests for login/verify/vehicle/home with mocked hooks. No test touches sqlite, the real socket, or `expo-location`.

### Integration Tests (api, real module graph, Postgres, in-memory Redis ports)

- `driver-location.gateway.spec.ts` — acks over a real socket.
- `driver-presence.integration.spec.ts` — the seven cases above.
- `push-token.integration.spec.ts`, `earnings.integration.spec.ts`.

### Edge Cases

| Edge case | Verified in |
|---|---|
| Parked driver (no movement) keeps producing fixes → not dark | D7 by construction; Level 4 §C.4 (emulator: fixed position for 90 s, driver stays online) |
| Fix stream replayed after a dead zone arrives oldest-first, contiguous `clientAt` | `uploader.test.ts` (order); Level 4 §C.5 (log) |
| Ack timeout keeps the fix; backoff caps at 30 s | `uploader.test.ts`, `backoff.test.ts` |
| Server says `not_online` while intent is online → exactly one re-assert, then offline + banner | `presence-state.test.ts` |
| Reconnect inside 30 s → no nudge | `driver-presence.integration.spec.ts` case 3 |
| Driver `on_ride` never dark-marked | case 7 |
| Online but never pinged → dark at 60 s | case 6; store contract (seeded `seen`) |
| `DeviceNotRegistered` forgets the token | case 5 |
| No EAS projectId / no FCM → app runs, no token, no crash | `register-push-token.test.ts`; Level 4 §C.1 (before A1) |
| Token expiry → socket dropped by the sweep → `connect_error: unauthorized` → OTP screen | `api-client.test.ts` (401 path); Level 4 §C.8 (`JWT_EXPIRES_IN=2m`) |
| Session JSON corrupt / expired on disk → signed out, no crash | `session-store.test.ts` |
| Last vehicle deleted server-side (`forced_offline`) → next `AppState` active refetch flips the UI | `presence-state.test.ts` (`server_offline` while streaming, task alive → re-assert → 409 `vehicle_required` → banner) |
| Yesterday's ledger entries and `cash_settlement` excluded from today | `earnings.integration.spec.ts` |
| OTP 429 `resend_too_soon` shows the countdown | `login-screen.test.tsx` |
| Going offline drains first so no fix is refused as `not_online` | `presence-state.test.ts` effect order; Level 4 §C.6 |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
```bash
pnpm turbo run typecheck lint --filter @taxi/shared --filter @taxi/db --filter @taxi/api --filter @taxi/driver
```

### Level 2: Unit Tests
```bash
pnpm turbo run test --filter @taxi/shared --filter @taxi/driver
pnpm turbo run test --filter @taxi/api -- push driver-presence.sweeper driver-location.service
```

### Level 3: Integration Tests
```bash
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:${REDIS_PORT:-6379} \
  pnpm turbo run typecheck lint test build --force
```
Expected: green; the api's total grows by ~25 (`derived`: 7 presence + 5 push-token + 3 earnings + ~4 gateway/service ack + ~6 push unit); `Tests: N skipped` unchanged when `REDIS_TEST_URL` is set. One gate at a time (shared test DB).

### Level 4: Manual Validation

**A. Prerequisites (human, once)**
- A1 — Firebase project (free) → `google-services.json` into `apps/driver/`, service-account JSON → `eas credentials` (Android › FCM V1). Needed for §C.7's *delivery* only; everything else runs on the stub.
- A2 — `cd apps/driver && npx eas init` under the `linards` account → `extra.eas.projectId` in `app.json`. Needed for a push token at all.
- A3 — Android SDK + emulator present (memory `taxi-gps-spike-kit`: `openjdk@21`, commandlinetools, `system-images;android-35;google_apis;x86_64`, an AVD). `google_apis` images carry Play services, so FCM works after A1.

**B. Boot**
1. `docker compose up -d --wait`; `.env` has `PUSH_PROVIDER=stub` (default). `pnpm --filter @taxi/api dev`. Optional: `pnpm --filter @taxi/api provision:dispatcher +371XXXXXXXX Dina` and open `apps/dispatch` to watch the board.
2. `cd apps/driver && EXPO_PUBLIC_API_URL=http://10.0.2.2:3001 npx expo run:android` (dev build on the emulator; first build ~10 min `expected`). Grant nothing yet.

**C. Steps (each names the signal it reads)**
1. **Sign in**: phone `+37120000001`, role driver → API log `auth.otp.stub_sent … code=NNNNNN` → enter it → onboarding profile → vehicle (plate `TEST001`) → documents → home. Signal: `GET /drivers/me` in the API access log; home shows `Auto: TEST001`. `register-push-token` logs `no_project` until A2.
2. **Go online**: tap the toggle → foreground dialog → background ("Allow all the time" in Settings; or `adb shell pm grant lv.saktacab.driver android.permission.ACCESS_BACKGROUND_LOCATION`) → battery explainer (skip) → status `Tiešsaistē`, foreground-service notification visible, screen stays on. Signal: API `driver.presence.status_changed from=offline to=online`; `docker compose exec redis redis-cli SISMEMBER drivers:online:<DEFAULT_CITY_ID> <driverId>` → 1 and `ZSCORE drivers:seen:… <driverId>` ≈ now.
3. **Stream**: `adb emu geo fix 24.1136 56.9512`, then a loop stepping lng by 0.0002 every 4 s for 60 s (`for i in $(seq 1 15); do adb emu geo fix 24.$((1136+i*2)) 56.9512; sleep 4; done`). Signal: API debug `driver.location.ping_accepted` every ~4 s with `lagMs < 2000`; the home diagnostics line updates; `GEOPOS drivers:geo:… <driverId>` moves. **Auth survives restart (expected)**: `adb shell am force-stop lv.saktacab.driver`, relaunch → home without login.
4. **Parked** (D7): stop sending fixes for 90 s with the emulator's location fixed (the emulator keeps re-delivering the last fix on `timeInterval`). Signal: `ping_accepted` continues at ~4 s; the driver stays online. If it does **not** continue on the emulator (the emulator's provider can go quiet), send the same fix every 4 s — the test is that a repeated identical position is accepted and keeps the driver alive.
5. **Dead zone → no gap (expected)**: `adb shell cmd connectivity airplane-mode enable`; keep stepping fixes for 2 minutes → the home `Rindā:` count climbs to ~30 (`derived`: 120 s / 4 s), pill goes `offline`; `airplane-mode disable` → within ~30 s (socket backoff cap) the pill returns, `Rindā:` drains to 0. Signal: the API log shows a burst of `ping_accepted` whose `clientAt` values are ~4 s apart and span the outage with no hole > 8 s, then steady state. Note: the socket dropped during the outage → `status_changed reason=socket_disconnected` fired (expected ≤45 s in, `derived` from Socket.IO's 25 s ping interval + 20 s timeout) and the reconnect's `PUT status online` re-asserted **before** the drain — assert the order in the log: `status_changed to=online` precedes the first replayed `ping_accepted`. No nudge: the reconnect landed inside 30 s of the offline stamp? — not necessarily (the outage was 2 min) → **a nudge IS expected here** (`driver.push.stub_sent`) about 30–45 s after the disconnect, and the app, already back online, shows nothing. Acceptable and documented (NOTES: the debounce protects blips, not tunnels).
6. **Go offline (edge)**: tap the toggle → `Rindā:` drains (≤5 s) → API `status_changed to=offline` with no reason → `SISMEMBER` → 0; `hasStartedLocationUpdatesAsync` false (the foreground-service notification disappears); no `ping_accepted` afterwards even if `geo fix` continues.
7. **Process kill → nudge (edge)**: go online, stream, then `adb shell am force-stop lv.saktacab.driver`. Signal: within ≤45 s `status_changed reason=socket_disconnected`; 30–45 s later `driver.push.stub_sent` (or, after A1/A2 with `PUSH_PROVIDER=expo`, a real notification on the emulator). Reopen the app → banner "atzīmēts kā bezsaistē HH:MM" → tap → online again. **Reboot**: `adb reboot`, same signals; on relaunch the banner path (the task is dead after a reboot — Android does not restart it).
8. **Dark with the socket alive (edge)**: online, streaming; revoke location: `adb shell pm revoke lv.saktacab.driver android.permission.ACCESS_FINE_LOCATION` (the socket stays up). Signal: ≤75 s later `status_changed reason=dark`; `SISMEMBER` → 0; the app's next `AppState` active refetch shows the banner; re-grant and tap to recover.
9. **Expired token (failure)**: API `.env` `JWT_EXPIRES_IN=2m`, restart the API, sign in fresh, go online, wait 3 min. Signal: `realtime.gateway.token_expired`, the app's socket `connect_error: unauthorized` → OTP screen with `session_expired` copy; the local queue is CLEARED by the sign-out (review F5: it carries no owner, so a phone handed to another driver must not replay this driver's track under the next token) — `Rindā:` after re-login is 0, and fixes queued before the expiry are lost by design.
10. **Earnings card**: with no settled rides the card reads `Šodien: €0.00 · Braucieni: 0`. To see a number: `pnpm --filter @taxi/api mint:ride` against this driver and settle it through `POST /rides/:id/settle` as the script's flow allows (cash), or insert two ledger entries directly — the integration spec is the primary evidence; this step confirms formatting.
11. **i18n**: emulator locale → Russian (`adb shell settings put system system_locales ru-RU` or Settings) → every screen in RU; unknown locale (`de-DE`) → LV.
12. **TalkBack banner (owed to review F28)**: enable TalkBack, force a banner (deny foreground location, tap the toggle) → the text is spoken ONCE — the Android live region; the explicit announce is iOS-only. A double read is the F28 regression.

**D. Owed field drives (not performable now — recorded, not claimed)**
- Android on a pilot phone via the APK kit: needs a phone (memory `taxi-gps-spike-deferred`). Build: `eas build -p android --profile preview` from the workspace (EAS supports monorepos; the "copy outside the repo" recipe was for the harness), upload to R2 as the kit does. Protocol: `docs/spikes/04-gps-field-test.md` §Field protocol; pass table there. Until it runs, #4 stays open and the fix-gap metric row in `docs/ux-metrics-ledger.md:29` stays "—".
- iOS on the first TestFlight build: needs the paid Apple programme; this Mac cannot build SDK 57 for iOS (memory). Not this ticket's to unblock.

### Level 5: Additional Validation (Optional)
- `npx expo-doctor` in `apps/driver`; `npx expo install --check` — both clean before any build.
- Dispatch board (`apps/dispatch` with a provisioned dispatcher): the driver appears on go-online, moves during §C.3, drops to `offline` status on §C.7/§C.8 within the stated windows.

---

## ACCEPTANCE CRITERIA

- [ ] Field check: pings observed server-side with the app backgrounded + screen locked — **emulator** (§C.3 with `adb shell input keyevent KEYCODE_POWER` to lock; `ping_accepted` continues); real-phone legs recorded as owed (§D).
- [ ] Auth survives app restart (expected) — §C.3; `session-store.test.ts`.
- [ ] Going offline stops pings (edge) — §C.6; `presence-state.test.ts`.
- [ ] Expired-token re-auth (failure) — §C.9; `api-client.test.ts`.
- [ ] Network killed mid-drive → fixes queue locally and drain on reconnect with no gap in the server-side track (expected) — §C.5 (log contiguity), `uploader.test.ts`, `driver-location.gateway.spec.ts` acks.
- [ ] Process kill / reboot → server marks the driver offline within the threshold and sends the nudge (edge) — §C.7; `driver-presence.integration.spec.ts` cases 1–3. Thresholds stated: offline ≤45 s (disconnect path, `derived` from Socket.IO defaults) or ≤75 s (dark path, `derived` 60 + 15); nudge +30–45 s after that.
- [ ] Dispatch excludes a dark driver — `findNearby`'s freshness filter (existing, 60 s) plus the Redis set removal (case 1 asserts `isOnline === false`).
- [ ] Today's-earnings card on the online screen, integer cents, catalog copy — `earnings.integration.spec.ts`, `format-eur.test.ts`, §C.10.
- [ ] i18n complete (LV/RU/EN, parity test green; iOS permission strings localised; no hardcoded user-facing string in `apps/driver/src` — `grep -rn "'[A-ZĀČĒĢĪĶĻŅŠŪŽ][a-zāčēģīķļņšūž ]\{3,\}'" apps/driver/src --include=*.tsx | grep -v test` returns nothing).
- [ ] Every interactive element ≥44 px with a visible focus state; every control labelled for TalkBack.
- [ ] `pnpm turbo run typecheck lint test build --force` green with `@taxi/driver` in the `lint`/`test` output; `npx expo install --check` clean; `npx expo export --platform android` succeeds in CI-equivalent conditions.
- [ ] No file of shipped source > 500 lines; no direct SDK import outside `features/push` (api) — `grep -rn "exp.host" services/api/src | grep -v features/push` empty.
- [ ] Docs updated (realtime-events row, traceability row, app CLAUDE.md, env template; runbook rows or the Q6 handoff).

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works (Level 4 §C 1–11 on the emulator; §D recorded as owed)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] Every figure in the report and PR body carries `observed`/`derived`/`expected` and its arithmetic (root CLAUDE.md rule) — the 45 s / 75 s / 30 s windows above are `derived`; §C.5's "no hole > 8 s" is the one `observed` figure the report must actually observe.

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (decide before Phase 5, default = yes)** — `distanceInterval: 0` instead of the harness's `10` (D7). The 2026-08-26 comment says "the harness's exact options"; the reason to deviate is that dark detection cannot tell a parked driver from a dead app when a stationary phone emits nothing. The alternative — a client heartbeat timer — does not run in the iOS background. If Linards wants the literal harness options, dark detection must exempt stationary drivers, which it cannot detect. Continuing with `0`.
- **Q2 (assumption)** — "no gap in the server-side track" is verified against the API's `driver.location.ping_accepted` debug log (`clientAt` contiguity) and the ordered dispatch-room fan-out; there is no persisted track (deferred from #8 → #11 → never landed). If a persisted track is wanted for the pilot, it is a `ride_tracks`-style ticket, not this one.
- **Q3 (assumption, D14)** — after a process kill the driver taps once to go back online (banner), rather than the app silently re-onlining on every cold launch (a driver who force-quit to go home would otherwise wake up online). Warm reconnects and an Android-kept service re-assert without a tap.
- **Q4 (scope)** — the pre-shift car photo (`apps/driver/CLAUDE.md:8`, skeleton `:58`) is deferred to #20 with approval; the toggle already renders any future 409 reason generically. Say if it must be a #14 stub screen.
- **Q5 (scope)** — the today card is here; the "≤5 s after completion" metric stays #15's (needs #15's completion flow). Confirmed by the ledger's row assignment (`docs/ux-metrics-ledger.md:27`).
- **Q6 (process)** — `docs/runbooks/hetzner-deploy.md`, `.env.example`, `env.schema.ts` and `services/api/CLAUDE.md` are **uncommitted #13 work in the shared checkout right now** (`observed`, `git status` 2026-08-31). Cut `feature/driver-app-auth-online-location` from `main` **after #13 merges**, or work in a worktree and rebase; the two runbook rows and the env-schema edits will conflict otherwise. `COMPOSE_PROJECT_NAME=taxi` for any DB-touching command in a worktree (memory).
- **Q7 (human prerequisites)** — A1 (Firebase/FCM), A2 (`eas init`), A3 (emulator) are Linards's; the code path is complete without them (stub push, no-project registration).
- **Q8 (verified)** — Socket.IO server `pingInterval`/`pingTimeout` are at their 25 s/20 s defaults (`observed` 2026-08-31: `grep -rn "pingTimeout\|pingInterval" services/api/src` is empty). The 45 s disconnect-detection figure is `derived` from those defaults; it changes if #15 tunes them.
- **Q9 (assumption)** — one Expo push token per driver on `drivers` (D11). A second device per driver is #15's concern if it ever arises.
- **Q10 (assumption)** — jest-expo runs under the hoisted pnpm layout with the npm `transformIgnorePatterns`. If a transform error names `.pnpm`, switch to the documented pnpm pattern; if RN's Flow sources still fail, the escape hatch is `moduleNameMapper` for `react-native` → `react-native/index.js` — settle it in Task 26 before writing tests, not after.

## NOTES (open canvas)

**Why not a batch event.** A `driver:location_batch` with an ack response would need an `RT` entry, an `RT_EVENT_SCHEMAS` entry (the runtime test requires every `RT` value to have one, and the `satisfies Record<keyof ServerToClientEvents>` would force it into the server→client map for an inbound-only event), a second inbound handler, a server-side "latest wins" fold, and a doc row. The per-fix ack is one schema, one callback parameter, and the server's existing per-fix fan-out becomes the replayed track for free. The cost — N emits instead of one — is ~120 B × N on an open WebSocket at pilot scale.

**Why the sweeper lives in `drivers`, not `dispatch` or `notifications`.** Presence is the drivers slice's fact (`markOnline`/`markOffline`, `status_changed`); dispatch consumes it; notifications imports drivers (for `positionOf`) so a nudge there would be a module cycle. `features/push` is a provider-only slice precisely so both drivers (nudge) and, later, dispatch/#15 (offers) can import it without cycles — the telephony slice's shape.

**Why Postgres for the nudge debounce.** The alternatives were a Redis ZSET in the location store (port growth + contract test) or an in-memory map in the sweeper (dies with the process, violates the "state is a row" rule the dispatch sweeper established). A nullable timestamp on the row the offline transition already writes is one column, one conditional UPDATE, restart-safe, and readable by #20's admin later ("last nudged").

**Two offline paths, one nudge.** Disconnect cleanup (#38) will fire first in most real failures (kill, reboot, long tunnel): the socket dies within ~45 s. The dark sweep catches the residual: socket alive, GPS dead (permission revoked, location services off, task crashed, Doze batching fixes into minutes while the socket's pings still flow). Both stamp `offline_nudge_due_at`; the sweeper sends once. The 30 s debounce protects blips (a bridge, a Wi-Fi handover), not a two-minute tunnel — a driver coming out of a long tunnel may get one push after the app has already re-onlined; the copy is harmless and the board was correct throughout.

**Re-assert semantics.** The app owns intent; the server owns fact. Every time fact and intent disagree in the "server says offline, app wants online, app is alive and streaming" direction, the app re-asserts once (`PUT status online`). The server's own gate (`setOnlineIfEligible`: has a vehicle, no live ride; #20 adds approval) decides; a 409 wins and the app flips. This is why a dark-marked driver whose app is actually alive (Doze batching) recovers without a tap the moment a fix lands.

**Rejected: `expo-server-sdk`.** Chunking, receipts, and gzip matter at hundreds of messages; the nudge is one message per driver per outage. A `fetch` with a parsed ticket keeps the slice dependency-free and the failure enum closed.

**Rejected: vitest for the app.** See D4. Revisit only if jest-expo fights the monorepo (Q10).

**Rejected: `react-native-mmkv`** for the session/intent — a native dependency for three small strings SecureStore already holds encrypted.

**`driver:queue`** — typed, never emitted, "#14/#19" in two comments. The queue position is only meaningful next to an offer card; #15 owns it. The `dispatch/index.ts` comment is updated to say so.

**Field drives.** The location slice ships the superset design; the pass table in the spike doc remains the yardstick. The owed legs are blocked on a phone and an Apple account, not on code. When one runs, `docs/spikes/04-gps-field-test.md` gets its results and #4 closes — outside this PR.

**Line budget check** (`observed` baselines, `expected` deltas): `drivers.service.ts` 218 → ~330; `drivers.repository.ts` 396 → ~398 (one `.set` change; the new reads live in `presence/driver-presence.repository.ts`, ~120); `lv.ts` 218 → ~295; `realtime-events.ts` 341 → ~360; nothing else near the cap. App files are all new and small by construction (largest: `use-presence.tsx` ~200, `home-screen.tsx` ~180).

**Confidence: 7/10** for one-pass success. The api and shared work is well-precedented (9/10 alone). The app is greenfield tooling — expo-router + jest-expo + eslint-config-expo under a hoisted pnpm workspace has no in-repo precedent (Q10), and the emulator-only Level 4 has never exercised background location on this machine beyond the harness (memory says it did work headless). Budget a half-day for Phase 3 before any feature code.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->
