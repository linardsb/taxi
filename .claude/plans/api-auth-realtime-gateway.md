# Feature: API auth (SMS OTP → JWT → role guards) + Socket.IO realtime gateway

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

Two vertical slices in `services/api`, delivered in one PIV loop because the second one's handshake depends on the first one's token verification:

1. **`auth`** — phone-first identity. `POST /auth/otp/request` generates a 6-digit code, stores it (hashed, TTL) in Redis and delivers it through the `SmsProvider` seam from `@taxi/shared` (stub implementation only — no Twilio spend). `POST /auth/otp/verify` checks the code, finds-or-creates the `users` row, and returns a signed JWT plus the user. Four roles (`rider`/`driver`/`dispatcher`/`admin`) with a fail-closed global `JwtAuthGuard` and a `@Roles()`-driven `RolesGuard`.
2. **`realtime`** — the Socket.IO backbone. A gateway with the Redis adapter, JWT verification at the **handshake** (rejected connections never reach a handler), server-decided room membership by role, and typed emit helpers built on `RT` + the payload schemas from `@taxi/shared`. Nothing emits real events yet; later slices (#8–#11, #15, #17, #18) call these helpers.

This is the first `services/api` ticket that touches Postgres, Redis, env config and tests-against-a-real-database, so it also lays the api's cross-cutting plumbing (`src/common/`) and its integration-test harness — deliberately, because #8–#12 all inherit it.

## User Story

As a **driver or rider on a Latvian phone number**
I want to **sign in with a code sent by SMS and stay connected to a live channel**
So that **I can be identified by the platform without a password and receive ride offers and status updates the moment they happen**

And, as the **platform**:

As **the dispatch backbone**
I want **every socket to prove who it is at handshake time and be placed only in the rooms its role allows**
So that **a driver can never watch Dina's dispatch board and no unauthenticated client can read ride traffic**

## Problem Statement

`services/api` is still the NestJS scaffold: one `AppController`, no config, no database wiring, no identity, no realtime. Nothing downstream can be built — #8 (drivers) needs `req.user`, #9 (rides) needs a rider identity, #10 (dispatch) needs to emit to rooms, #15/#17/#18 need a socket to listen on. Every later ticket in the epic's execution order is blocked on this one.

Two specific risks make it worth doing carefully rather than quickly:

- **Auth is the security boundary.** `driver:location` deliberately carries no `driverId` because "the server takes the driver identity from the JWT" (`.claude/references/realtime-events.md`, rule 3). That guarantee is only as good as the token verification written here.
- **SMS costs real money** against a <€100/mo guardrail. Unthrottled OTP requests are an unbounded spend channel, so rate limiting is part of the slice, not a follow-up.

## Solution Statement

- **OTP state lives in Redis, not Postgres** — codes are ephemeral with a natural TTL, and Redis is already required for the socket adapter. Access is through a narrow `KeyValueStore` port (4 methods) so tests run without a Redis server (see Open Questions — Redis cannot bind :6379 on this machine).
- **Users are created at verify, never at request** — an unverified phone number can't create rows, and the request endpoint's response is identical for known and unknown numbers (no enumeration oracle).
- **The signup role travels inside the OTP record**, not the verify body, and **an existing user's stored role always wins**. A rider cannot mint an admin token by passing `role: "admin"`.
- **The realtime gateway has no client-initiated join API at all.** Rooms are decided server-side from the JWT claims by a `canJoin(user, room)` policy the gateway iterates at connect time. Ride rooms are joined server-side by later slices through `RealtimeService.joinRideRoom()`. A driver cannot join the dispatch board because there is no mechanism by which any client can ask to join anything.
- **Emit helpers parse before they emit.** `RT_EVENT_SCHEMAS` maps each event to its zod schema and the single private `emit()` runs `.parse()` on the payload. That turns `realtime-events.ts`'s big documented invariant (wire timestamps are ISO strings, never `Date`) from a comment into an enforced one.

## Out of Scope / Non-Goals

- **Not included: the Twilio `SmsProvider` implementation.** The ticket says stub-only, no Twilio spend. Ship `StubSmsProvider` (logs the code); the Twilio implementation lands with the deploy ticket (#13) when a real number exists.
- **Not included: Google Sign-In.** The ticket defers it explicitly ("skeleton outline … not MVP-gating").
- **Not included: refresh tokens, token revocation, logout, or a session table.** One long-lived access token (`JWT_EXPIRES_IN`, default `30d`). A stolen token is valid until expiry — accepted for the pilot, logged in Open Questions.
- **Not included: a `users` CRUD slice.** `auth` owns a private `findOrCreateUser` repository function against the existing `users` table. Profile endpoints belong to #8/#20.
- **Not included: phone-number normalization.** The API accepts E.164 only (`phoneSchema`); turning `26123456` into `+37126123456` is the client's job.
- **Not included: any `@SubscribeMessage` handler.** `driver:location` ingestion is #8 (playbook slice 2.3). The gateway has zero inbound message handlers in this ticket.
- **Not included: dispatcher/admin account provisioning.** #20 owns it. Tests insert those rows directly.
- **Not changing:** `packages/shared`'s existing 8-event catalog (only additive: `userRoom`, `RT_EVENT_SCHEMAS`, `schemas/auth.ts`), `db/`'s existing schema or migrations (only additive: a `migrateDb()` helper), and `db/tests/global-setup.ts` (leave #6's proven setup alone — two migrate call sites is fine).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (two slices + the api's first cross-cutting plumbing + its first DB-backed test harness)
**Primary Systems Affected**: `services/api` (new), `packages/shared` (additive), `db` (one additive helper), `turbo.json`, `docker-compose.yml`, `.env.example`
**Dependencies**: `@nestjs/config`, `@nestjs/jwt`, `@nestjs/websockets`, `@nestjs/platform-socket.io`, `socket.io`, `@socket.io/redis-adapter`, `ioredis`, `zod`, `drizzle-orm` (all new to the api)

## Related Work

**Implements**: GitHub issue **#7** — "API: auth — SMS OTP via seam, JWT sessions, roles/guards + Socket.IO realtime gateway" (`Closes #7`) · **Epic**: [#1](https://github.com/linardsb/taxi/issues/1) — `docs/epics/sakta-cab.architecture.md`

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/shared-contracts-ride-loop.md` (#2) — Why: owns `RT`, the 8 payload schemas, room helpers, `userSchema`/`phoneSchema`, `USER_ROLES`, and the `SmsProvider` seam this slice implements. Every contract addition here follows its conventions.
- `.claude/plans/db-foundation-drizzle-postgis.md` (#6) — Why: owns the `users` table, `createDb()`, the migrations folder, and the vitest global-setup pattern the api's jest harness mirrors.
- `.claude/system-reviews/db-foundation-drizzle-postgis-review.md` — Why: its closing section is addressed to this ticket. Two lessons applied: **check turbo's env passlist** for every env var new code reads (Task 3), and **pre-write deterministic fallbacks + exact expected output** for the risky library interactions (Tasks 12, 16).

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — expected consumers: #8 (`@SubscribeMessage(RT.driverLocation)` + `req.user`), #9 (rider identity), #10/#11 (`RealtimeService.emitToRide` / `joinRideRoom`), #13 (Twilio provider + `migrateDb()` at deploy), #18 (`emitToDispatch`), #20 (dispatcher/admin provisioning).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Contracts (`packages/shared`) — the seam you extend:**

- `packages/shared/src/realtime-events.ts` (whole file, 202 lines) — Why: `RT`, the 8 payload schemas, `rideRoom`/`driverRoom`/`dispatchRoom`, and `ClientToServerEvents`/`ServerToClientEvents`. Read the header comment (lines 7–21) before touching it: **`RT` must stay the first `as const` block in the file**, and every wire timestamp is an ISO string.
- `packages/shared/src/schemas/user.ts` (all 16 lines) — Why: `phoneSchema` (E.164 regex) and `userSchema` are the exact building blocks for `schemas/auth.ts`. Note `createdAt: z.coerce.date()` — that's the DOMAIN shape; the wire shape must override it (same trap `rideOfferEventSchema` documents at lines 75–88 of `realtime-events.ts`).
- `packages/shared/src/enums.ts` (lines 1–5) — Why: `USER_ROLES` / `UserRole`. Never retype the role list.
- `packages/shared/src/seams/sms-provider.ts` (all 8 lines) — Why: the exact interface `StubSmsProvider` implements — `sendOtp(phoneE164: string, code: string): Promise<void>`.
- `packages/shared/src/index.ts` — Why: the barrel; every new file needs a line here.
- `packages/shared/tests/realtime-events.test.ts` (lines 1–60) — Why: the test style to mirror — 1 expected + 1 edge + 1 failure per `describe`, with the case type named in the test title.
- `packages/shared/CLAUDE.md` — Why: "imports nothing from the workspace", "types derive from zod via `z.infer`, never a hand-written twin".

**Persistence (`db`):**

- `db/src/schema/users.ts` (all 13 lines) — Why: the table `findOrCreateUser` writes. `phone` is `.notNull().unique()`, `role` is `.notNull()` with no default (so the signup role is mandatory at insert), `language` defaults `'lv'`.
- `db/src/client.ts` (all 12 lines) — Why: `createDb(connectionString) => { db, pool }`. Its comment names this ticket: "The api's DrizzleModule (#7) wraps this".
- `db/src/index.ts` (all 4 lines) — Why: the barrel you add `migrateDb` to.
- `db/tests/global-setup.ts` + `db/tests/helpers.ts` — Why: **the pattern the api's jest harness mirrors** — drop/create a dedicated test database, migrate, seed, and derive the test URL from `DATABASE_URL` with `.replace(/\/[^/]*$/, '/<name>')`. Do not modify these files.
- `db/src/seed/riga.ts` (lines 1–17) — Why: `RIGA_CITY_ID` is the documented default for `DEFAULT_CITY_ID`.

**The service (`services/api`) — currently a bare scaffold:**

- `services/api/src/app.module.ts`, `src/main.ts`, `src/app.controller.ts` (all tiny) — Why: exactly what you are extending. `app.controller.ts:13-16` already has the `/health` endpoint AC #3 needs — it only has to survive the new global guard (mark it `@Public()`).
- `services/api/package.json` (lines 58–74) — Why: the **jest config lives inside package.json** (`rootDir: "src"`, `testRegex: ".*\\.spec\\.ts$"`, ts-jest). Colocated `*.spec.ts` under `src/` are what `pnpm check` runs; `test/app.e2e-spec.ts` is **not** run by the gate.
- `services/api/tsconfig.json` — Why: `nodenext` module resolution, decorators on, and **missing `strict`** (Task 0 fixes that — verified free, see NOTES).
- `services/api/eslint.config.mjs` (lines 27–34) — Why: `prettier/prettier` is an **error**, and the api's `.prettierrc` is `singleQuote: true` while `shared`/`db` use double quotes. You will write both dialects in one session.
- `services/api/CLAUDE.md` (all 11 lines) — Why: the slice rules for this service. It says slices live under `src/features/<name>/`; this ticket adds `src/common/` for cross-cutting plumbing, so the file gains one line (Task 24).
- `services/api/src/db-schema.spec.ts` — Why: the existing `@taxi/db` import smoke test. Its comment says NestJS wiring "arrives in #7" — that's this ticket.

**Config & infra:**

- `turbo.json` — Why: `globalEnv: ["DATABASE_URL"]`, and `test` has `dependsOn: ["^build"]`. Both matter (see GOTCHAs).
- `docker-compose.yml` (lines 22–30) — Why: the redis service whose port binding must become overridable.
- `.env.example` — Why: the documented env surface; every new var goes here.
- `.github/workflows/ci.yml` — Why: CI runs `pnpm turbo run typecheck lint test build` with **no service containers** — Postgres comes from each package's `pretest` docker-compose hook.

**Standards:**

- `.claude/references/realtime-events.md` (all 25 lines) — Why: the room rules and the "add an event = shared FIRST, then this table" rule. **Task 10 updates it.**
- `.claude/references/logging-standard.md` (all 14 lines) — Why: `domain.component.action_state`, and **"never log full phone numbers (mask to last 3 digits)"** — the auth slice is the first code this binds.
- `.claude/references/conventions.md` — Why: commit/PR/review conventions for the ship step.
- `CLAUDE.md` (root) — Why: VSA, `index.ts` as slice public API, ≤500 lines/file, tests mirror slices, 1 expected + 1 edge + 1 failure per feature.

### New Files to Create

**`packages/shared`:**

- `packages/shared/src/schemas/auth.ts` — OTP request/verify, session response, JWT claims, the signup-role subset.
- `packages/shared/tests/auth.test.ts` — 1+1+1 for the auth contracts.

**`db`:**

- `db/src/migrate.ts` — `MIGRATIONS_DIR` + `migrateDb(db)`, package-relative so any consumer can migrate.

**`services/api/src/common/` (cross-cutting plumbing, not a feature slice):**

- `services/api/src/common/config/env.schema.ts` — zod env schema + `Env` type + `loadEnv()`.
- `services/api/src/common/config/app-config.module.ts` — `@Global`, wraps `ConfigModule.forRoot` and provides `APP_ENV`.
- `services/api/src/common/db/db.module.ts` — `@Global`, provides the `DRIZZLE` token from `createDb()`, closes the pool on shutdown.
- `services/api/src/common/kv/kv.store.ts` — the `KeyValueStore` port + `KV_STORE` token.
- `services/api/src/common/kv/redis-kv.store.ts` — the ioredis implementation.
- `services/api/src/common/kv/kv.module.ts` — `@Global`, provides `KV_STORE`.
- `services/api/src/common/zod-validation.pipe.ts` — `ZodValidationPipe`.

**`services/api/src/features/auth/`:**

- `auth.module.ts`, `auth.controller.ts`, `auth.service.ts`, `auth-token.service.ts`, `auth.repository.ts`, `otp.policy.ts`, `phone-mask.ts`
- `guards/jwt-auth.guard.ts`, `guards/roles.guard.ts`
- `decorators/public.decorator.ts`, `decorators/roles.decorator.ts`, `decorators/current-user.decorator.ts`
- `sms/stub-sms.provider.ts`, `sms/sms.tokens.ts`
- `index.ts`
- `auth.service.spec.ts`, `auth.integration.spec.ts`

**`services/api/src/features/realtime/`:**

- `realtime.module.ts`, `realtime.gateway.ts`, `realtime.service.ts`, `room-policy.ts`, `redis-io.adapter.ts`, `index.ts`
- `room-policy.spec.ts`, `realtime.gateway.spec.ts`, `redis-io.adapter.spec.ts` (opt-in, skipped unless `REDIS_TEST_URL` is set)

**`services/api/test/` (harness, excluded from `nest build`):**

- `services/api/test/global-setup.ts` — drop/create/migrate/seed `taxi_api_test`.
- `services/api/test/setup-env.ts` — per-worker env defaults.
- `services/api/test/harness.ts` — `createTestApp()`, the in-memory `KeyValueStore`, the recording `SmsProvider`, phone helpers.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [NestJS — WebSockets adapters (Redis)](https://docs.nestjs.com/websockets/adapter#extend-socketio)
  - Specific section: "Extend socket.io" — the `RedisIoAdapter extends IoAdapter` + `createIOServer` override pattern.
  - Why: exactly the class Task 16 writes. The docs example uses `redis` (node-redis); this plan uses `ioredis` (`new Redis(url)` / `.duplicate()`), which `@socket.io/redis-adapter` supports identically.
- [Socket.IO — Redis adapter](https://socket.io/docs/v4/redis-adapter/)
  - Specific section: "Usage with ioredis".
  - Why: confirms `createAdapter(pubClient, subClient)` with ioredis clients and that both clients must be separate connections (a subscribed client can't issue other commands).
- [Socket.IO — Server API: `socketsJoin`](https://socket.io/docs/v4/server-api/#serversocketsjoinrooms)
  - Why: `server.in(room).socketsJoin(otherRoom)` is **cluster-wide** with the Redis adapter and returns `void` (not a Promise) — the mechanism behind `joinRideRoom()`.
- [Socket.IO — Middlewares](https://socket.io/docs/v4/middlewares/#sending-credentials)
  - Specific section: "Sending credentials" + "Handling middleware error".
  - Why: `io.use((socket, next) => …)` with `next(new Error('unauthorized'))` surfaces on the client as `connect_error` — the exact assertion for AC #2.
- [NestJS — Configuration: custom validate function](https://docs.nestjs.com/techniques/configuration#custom-validate-function)
  - Why: `ConfigModule.forRoot({ validate })` fails fast at bootstrap on a bad env.
- [NestJS — Guards: setting roles per handler / global guards](https://docs.nestjs.com/guards#putting-it-all-together)
  - Why: `APP_GUARD` registration order and the `Reflector.getAllAndOverride` metadata pattern for `@Public()`/`@Roles()`.
- [Drizzle — `onConflictDoUpdate`](https://orm.drizzle.team/docs/insert#on-conflict-do-update)
  - Why: the race-safe find-or-create in Task 12. `onConflictDoNothing().returning()` returns `[]` on conflict — the documented reason this plan uses `DO UPDATE`.
- [`@nestjs/jwt`](https://docs.nestjs.com/security/authentication#jwt-token) — `JwtService.signAsync` / `verifyAsync`, and `JwtModule.registerAsync`.

### Patterns to Follow

**Naming conventions** — from `packages/shared` and `db`:

- Schemas end in `Schema`, types are `z.infer` of them, const arrays are `SCREAMING_SNAKE` with a `(typeof X)[number]` type alias.
- Nest files are `<thing>.<kind>.ts` (`auth.service.ts`, `jwt-auth.guard.ts`, `zod-validation.pipe.ts`).
- Tests are named with the case type: `it("… (expected)")`, `it("… (edge)")`, `it("… (failure)")` — see `packages/shared/tests/realtime-events.test.ts:29-57`.

**The wire-vs-domain rule** — the single most repeated pattern in this codebase. From `packages/shared/src/realtime-events.ts:75-88`:

```ts
// DOMAIN schema uses z.coerce.date(); the WIRE projection overrides it, because
// JSON carries ISO strings and z.infer would otherwise promise a Date that
// never arrives.
export const rideOfferEventSchema = rideOfferSchema.extend({
  sentAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
```

`authSessionSchema.user` must do exactly this with `userSchema.createdAt` (Task 1).

**Enums single-sourced** — from `db/src/schema/enums.ts:12-14`:

```ts
import { USER_ROLES } from "@taxi/shared";
export const userRoleEnum = pgEnum("user_role", USER_ROLES);
// "Every value list below comes FROM @taxi/shared — never retyped here"
```

**Deriving a test database URL** — from `db/tests/helpers.ts:6-11`:

```ts
export const ADMIN_URL = process.env.DATABASE_URL ?? "postgres://taxi:taxi@localhost:5432/taxi";
export const TEST_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);
```

**Structured logging** — `.claude/references/logging-standard.md`. This slice's event names:
`auth.otp.requested` · `auth.otp.send_failed` · `auth.otp.verified` · `auth.otp.verify_rejected` · `auth.otp.throttled` · `auth.session.issued` · `realtime.gateway.connection_rejected` · `realtime.gateway.connected` · `realtime.gateway.rooms_joined`.
Every one includes `at` (ISO) and, where known, `userId`. Phones are **always** masked to the last 3 digits.

**Anti-patterns to avoid** (all present in the codebase's comments as warnings):

- Hand-building room name strings — use `rideRoom()`/`driverRoom()`/`dispatchRoom()`/`userRoom()`.
- String literals for socket event names — use `RT.*`.
- Reading a field off an inbound socket payload without `.parse()` — the listen map types payloads as `unknown` on purpose.
- Retyping a value list that exists in `@taxi/shared`.

---

## IMPLEMENTATION PLAN

### Phase 1: Contracts & environment (foundation)

Everything downstream imports these. Nothing here touches NestJS.

**Tasks:** api tsconfig strictness · `schemas/auth.ts` + `userRoom` + `RT_EVENT_SCHEMAS` in `@taxi/shared` · `migrateDb()` in `@taxi/db` · the compose/`.env.example`/`turbo.json` env surface · dependency install.

### Phase 2: api cross-cutting plumbing (`src/common/`)

**Depends on:** Phase 1 (env schema needs `RIGA_CITY_ID`; the KV port is consumed by auth).

Config, Drizzle, KV, and the zod pipe — four small `@Global` modules plus one pipe. No feature logic.

### Phase 3: `auth` slice

**Depends on:** Phase 2.

Token service → repository → OTP service → controller → guards/decorators → stub SMS → module → `index.ts`.

### Phase 4: `realtime` slice

**Depends on:** Phase 3 (the handshake middleware calls `AuthTokenService.verify`) and Phase 1 (`userRoom`, `RT_EVENT_SCHEMAS`).
**Independent of:** the auth *tests* — Phase 4 code can be written before Phase 5's auth specs run.

Room policy → gateway → service (typed emit + room orchestration) → Redis IoAdapter → module → `index.ts`.

### Phase 5: Test harness & tests

**Depends on:** Phases 1–4.

jest global-setup + env setup + harness, then the four spec files. Written last because `createTestApp()` must know the real module graph, but each preceding task still carries its own compile-level VALIDATE.

### Phase 6: Wiring, docs, validation

`app.module.ts`, `main.ts`, `services/api/CLAUDE.md`, `.claude/references/realtime-events.md`, full gate + manual smoke test.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

> **Read this before Task 0 — three GOTCHAs that apply to every task below:**
>
> 1. **Turbo's `test` task has `dependsOn: ["^build"]`, and api tests import `@taxi/shared`/`@taxi/db` from `dist/`, not `src/`.** A bare `pnpm --filter @taxi/api test` runs against **stale dist** and will silently ignore everything you add to shared/db. Always validate api tests with `pnpm turbo run test --filter @taxi/api` (turbo rebuilds the deps first). Same for typecheck.
> 2. **Two prettier dialects in one session.** `services/api/.prettierrc` is `{"singleQuote": true, "trailingComma": "all"}` and `prettier/prettier` is an eslint **error** there. `packages/shared` and `db` have no prettier config and no lint script — match their existing double-quoted style by hand. Do not "fix" quotes across the boundary.
> 3. **Pin the versions in Task 5 exactly as written.** `zod@^3.24.0` (npm latest is 4.x — a v4 install breaks type identity with `@taxi/shared`'s zod 3 and produces baffling "two different Zod" errors) and `ioredis@^5.11.1` (v6.0.0 was published 2026-07-31, four days before this plan — not yet proven with `@socket.io/redis-adapter`).

### UPDATE `services/api/tsconfig.json` — Task 0

- **IMPLEMENT**: Add `"strict": true` and `"noUncheckedIndexedAccess": true` to `compilerOptions`. Leave `module`/`moduleResolution` as `nodenext` and keep the decorator flags — do **not** switch to `@taxi/config/tsconfig/base.json` (it is `commonjs`/`node` with no decorator support). You may drop the now-redundant `strictNullChecks`/`noImplicitAny`/`strictBindCallApply` lines, or leave them; both are correct.
- **PATTERN**: `packages/config/tsconfig/base.json` — the strictness level `shared` and `db` already run at.
- **GOTCHA**: Verified at plan time — the existing api scaffold compiles with **zero errors** under both flags, so this is free. Do it first so 800–1200 lines of auth code are written under strict rules rather than retrofitted.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #7 (pattern compliance) — prerequisite for every later task.

### CREATE `packages/shared/src/schemas/auth.ts` — Task 1

- **IMPLEMENT**:

  ```ts
  import { z } from "zod";
  import { USER_ROLES } from "../enums";
  import { phoneSchema, userSchema } from "./user";

  /**
   * The roles a phone number may claim for itself. `dispatcher` and `admin`
   * accounts are provisioned (#20) — they still sign in by OTP, but only
   * because their user row already exists.
   */
  export const SIGNUP_ROLES = ["rider", "driver"] as const;
  export type SignupRole = (typeof SIGNUP_ROLES)[number];

  export const otpRequestSchema = z.object({
    phone: phoneSchema,
    /** Used ONLY when the phone has no user yet; an existing user's stored role wins. */
    role: z.enum(SIGNUP_ROLES),
  });
  export type OtpRequest = z.infer<typeof otpRequestSchema>;

  /** Identical for known and unknown numbers — no enumeration oracle. */
  export const otpRequestResponseSchema = z.object({
    expiresInSeconds: z.number().int().positive(),
    resendAfterSeconds: z.number().int().nonnegative(),
  });
  export type OtpRequestResponse = z.infer<typeof otpRequestResponseSchema>;

  export const otpCodeSchema = z.string().regex(/^\d{6}$/, "expected a 6-digit code");

  export const otpVerifySchema = z.object({ phone: phoneSchema, code: otpCodeSchema });
  export type OtpVerify = z.infer<typeof otpVerifySchema>;

  /**
   * WIRE shape. `userSchema.createdAt` is `z.coerce.date()` (the DOMAIN shape);
   * JSON carries an ISO string, so it is overridden here for the same reason
   * `rideOfferEventSchema` overrides its two timestamps — see realtime-events.ts.
   */
  export const authSessionSchema = z.object({
    accessToken: z.string().min(1),
    expiresAt: z.string().datetime(),
    user: userSchema.extend({ createdAt: z.string().datetime() }),
  });
  export type AuthSession = z.infer<typeof authSessionSchema>;

  /** What the api signs and what every guard/handshake parses back out. */
  export const jwtClaimsSchema = z.object({
    sub: z.string().uuid(),
    role: z.enum(USER_ROLES),
    iat: z.number().int(),
    exp: z.number().int(),
  });
  export type JwtClaims = z.infer<typeof jwtClaimsSchema>;
  ```

- **PATTERN**: `packages/shared/src/schemas/user.ts` (structure) · `realtime-events.ts:75-88` (the wire-override rationale, quoted above).
- **IMPORTS**: relative (`../enums`, `./user`) — this package imports nothing from the workspace.
- **GOTCHA**: `jwtClaimsSchema` must **not** carry `phone` — a JWT is base64, not encryption, and the logging standard forbids unmasked phone numbers in artifacts. Use double quotes (no prettier here, but match the neighbours).
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #1, AC #6.

### UPDATE `packages/shared/src/realtime-events.ts` — Task 2

- **IMPLEMENT**: two additive changes, both **at the bottom of the file**.
  1. Next to the existing room helpers (after `dispatchRoom`), add:
     ```ts
     /**
      * A user's private room — every authenticated socket joins its own on
      * connect. This is how the server addresses one person's sockets across
      * the cluster (`server.in(userRoom(id)).socketsJoin(rideRoom(rideId))`),
      * which is what makes ride rooms server-orchestrated instead of
      * client-requested. Clients never ask to join anything.
      */
     export const userRoom = (userId: string) => `user:${userId}` as const;
     ```
  2. At the very end of the file:
     ```ts
     /**
      * Event → payload schema, so the api's emit helpers can `.parse()` before
      * they send. This makes the ISO-string rule at the top of this file an
      * enforced invariant instead of a documented one.
      */
     export const RT_EVENT_SCHEMAS = {
       [RT.driverLocation]: driverLocationEventSchema,
       [RT.driverQueue]: driverQueueEventSchema,
       [RT.rideStatus]: rideStatusEventSchema,
       [RT.rideOffer]: rideOfferEventSchema,
       [RT.rideOfferRevoked]: rideOfferRevokedEventSchema,
       [RT.rideAssigned]: rideAssignedEventSchema,
       [RT.dispatchBoard]: dispatchBoardEventSchema,
       [RT.dispatchUnclaimed]: dispatchUnclaimedEventSchema,
     } satisfies Record<keyof ServerToClientEvents, z.ZodType>;
     ```
- **PATTERN**: the file's own header comment.
- **GOTCHA**: The header says **"`RT` must stay the first `as const` block in this file"** (a doc-sync convention slices the catalog from there). `RT_EVENT_SCHEMAS` uses `satisfies`, not `as const`, and goes last — do not reorder anything. Use `satisfies Record<…, z.ZodType>` rather than annotating the type, or `rideAssignedEventSchema` (a `ZodEffects` from `.refine()`) will widen every entry and destroy per-key inference.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck && pnpm --filter @taxi/shared test`
- **SATISFIES**: AC #2, AC #4.

### UPDATE `packages/shared/src/index.ts` + CREATE `packages/shared/tests/auth.test.ts` — Task 3

- **IMPLEMENT**: add `export * from "./schemas/auth";` to the barrel (keep the existing grouping — put it after `./schemas/user`). Then write `tests/auth.test.ts` with, at minimum:
  - *expected*: `otpRequestSchema.parse({ phone: "+37126123456", role: "driver" })` round-trips.
  - *edge*: `authSessionSchema` accepts an ISO-string `createdAt` and **rejects** a `Date` — the wire/domain rule, asserted both ways.
  - *edge*: `RT_EVENT_SCHEMAS` covers the catalog. **The real check is the compile-time `satisfies Record<keyof ServerToClientEvents, z.ZodType>` in Task 2** — a missing event is a type error, not a test failure. Add only a cheap runtime smoke test that each value actually parses something (`expect(RT_EVENT_SCHEMAS[RT.rideStatus].safeParse({}).success).toBe(false)`); do **not** write `expect(Object.keys(RT_EVENT_SCHEMAS)).toEqual(Object.values(RT))` — the literal is built from `RT.*` computed keys, so that assertion compares the object to itself and can never fail.
  - *edge*: `userRoom("…")` returns `user:…` (extend the existing room-helper test in `realtime-events.test.ts` instead of duplicating it).
  - *failure*: `otpRequestSchema.safeParse({ phone: "26123456", role: "rider" }).success === false` (not E.164) and `{ phone: valid, role: "admin" }.success === false` (privilege escalation blocked at the contract).
  - *failure*: `otpVerifySchema.safeParse({ phone: valid, code: "12345" }).success === false`.
- **PATTERN**: `packages/shared/tests/realtime-events.test.ts` — `describe` per schema, case type in the title.
- **VALIDATE**: `pnpm --filter @taxi/shared test` — expect the new file's cases green and the pre-existing suites unchanged.
- **SATISFIES**: AC #1, AC #4, AC #6.

### CREATE `db/src/migrate.ts` + UPDATE `db/src/index.ts` — Task 4

- **IMPLEMENT**:

  ```ts
  import path from "node:path";
  import { migrate } from "drizzle-orm/node-postgres/migrator";
  import type { Db } from "./client";

  /**
   * Package-relative, so any consumer can migrate without knowing where `db/`
   * sits. Built output is `db/dist/migrate.js`, so `../migrations` resolves to
   * `db/migrations` — the same folder drizzle-kit writes to.
   */
  export const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

  export async function migrateDb(db: Db): Promise<void> {
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  }
  ```
  Then add `export { migrateDb, MIGRATIONS_DIR } from "./migrate";` to `db/src/index.ts`.

- **GOTCHA**: `__dirname` is correct here **because the package builds to CJS** (`@taxi/config/tsconfig/base.json` sets `"module": "commonjs"`). Do **not** rewrite it as `import.meta.url`. Leave `db/tests/global-setup.ts` untouched — it already migrates with a cwd-relative path and works; rewiring #6's proven setup is out of scope.
- **VALIDATE**: `pnpm --filter @taxi/db build && node -e "const {MIGRATIONS_DIR}=require('./db/dist/index.js'); const fs=require('fs'); if(!fs.existsSync(require('path').join(MIGRATIONS_DIR,'0000_enable_postgis.sql'))) throw new Error('MIGRATIONS_DIR wrong: '+MIGRATIONS_DIR); console.log('OK', MIGRATIONS_DIR)"` — **expected output: `OK /Users/…/taxi/db/migrations`**.
- **SATISFIES**: AC #1 (the integration harness needs it), AC #3.

### UPDATE `services/api/package.json` — Task 5 (dependency install)

- **IMPLEMENT**: from the repo root, run exactly:

  ```bash
  pnpm --filter @taxi/api add @nestjs/config@^4.0.4 @nestjs/jwt@^11.0.2 @nestjs/websockets@^11.1.28 @nestjs/platform-socket.io@^11.1.28 socket.io@^4.8.3 @socket.io/redis-adapter@^8.3.0 ioredis@^5.11.1 drizzle-orm@^0.44.0 zod@^3.24.0
  pnpm --filter @taxi/api add -D socket.io-client@^4.8.3
  ```

- **GOTCHA**:
  - `drizzle-orm` is a **direct** dep even though `@taxi/db` has it: pnpm's strict `node_modules` means `import { eq } from 'drizzle-orm'` in api code will not resolve transitively. Version must match `db`'s `^0.44.0` so there is one drizzle instance.
  - `zod@^3.24.0`, **not** `zod@latest` (4.x) — see the header GOTCHA #3.
  - `ioredis@^5.11.1`, **not** 6.x — see the header GOTCHA #3.
  - `socket.io` is a direct dep because the code imports its `Server`/`Socket` types, even though `@nestjs/platform-socket.io` bundles it.
  - Do **not** add `pg`/`@types/pg`. Type the pool as `ReturnType<typeof createDb>["pool"]` instead.
- **VALIDATE**: two commands, both must pass.
  ```bash
  pnpm --filter @taxi/api exec node -e "require('ioredis');require('socket.io');require('@socket.io/redis-adapter');require('drizzle-orm');console.log('api zod', require('zod/package.json').version)"
  # expected: `api zod 3.x.y`, no MODULE_NOT_FOUND

  node -e "const a=require.resolve('zod/package.json',{paths:['services/api']}),b=require.resolve('zod/package.json',{paths:['packages/shared']});const va=require(a).version,vb=require(b).version;console.log(va,vb);if(va.split('.')[0]!==vb.split('.')[0])throw new Error('zod major mismatch between api and shared')"
  # expected: two 3.x versions printed, no throw
  ```
  The second command is the one that matters: a `zod@4` in the api against `zod@3` in `@taxi/shared` produces `ZodType` types that look compatible and then fail with unreadable variance errors inside `ZodValidationPipe`. Catch it here, not in Task 11.
- **SATISFIES**: AC #3.

### UPDATE `docker-compose.yml`, `.env.example`, `turbo.json` — Task 6

- **IMPLEMENT**:
  1. `docker-compose.yml` — make the redis host port overridable (this is a **hard prerequisite**, not a nicety — see Open Questions):
     ```yaml
       redis:
         image: redis:7-alpine
         ports:
           # Host port is overridable: some dev machines already have something
           # on 6379 (an SSH tunnel here), and the container refuses to start
           # when the bind fails. Compose reads REDIS_PORT from the root .env.
           - "${REDIS_PORT:-6379}:6379"
     ```
     Leave the `db` service and both healthchecks exactly as they are.
  2. `.env.example` — replace the redis line and extend the api block:
     ```
     REDIS_URL=redis://localhost:6379
     # If 6379 is already taken on your machine, set both (compose reads REDIS_PORT here):
     #   REDIS_PORT=6381
     #   REDIS_URL=redis://localhost:6381
     REDIS_PORT=6379

     # --- api ---
     API_PORT=3001
     JWT_SECRET=dev-only-change-me
     JWT_EXPIRES_IN=30d
     # The pilot city (db seed: RIGA_CITY_ID). Dispatchers are placed in dispatch:<this>.
     DEFAULT_CITY_ID=00000000-0000-4000-8000-000000000001
     CORS_ORIGINS=http://localhost:3000,http://localhost:3002
     ```
  3. `turbo.json` — `"globalEnv": ["DATABASE_URL", "REDIS_URL", "JWT_SECRET", "API_PORT"]`.
- **GOTCHA**: The #6 system review's first lesson — turbo 2.x strict env mode **silently** strips undeclared vars, and the failure mode is tests passing against the wrong target. Declaring them costs a cache bust and nothing else. `DEFAULT_CITY_ID`/`CORS_ORIGINS`/`JWT_EXPIRES_IN` stay out of `globalEnv` on purpose: they have schema defaults and are never set in CI.
- **VALIDATE**: `docker compose config --quiet && echo COMPOSE_OK` and `REDIS_PORT=6381 docker compose config | grep -A2 "redis" | grep 6381` — **expected: `COMPOSE_OK` and a line showing `published: "6381"`**.
- **SATISFIES**: AC #3, AC #5.

### CREATE `services/api/src/common/config/env.schema.ts` — Task 7

- **IMPLEMENT**:

  ```ts
  import { RIGA_CITY_ID } from '@taxi/db';
  import { z } from 'zod';

  export const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
    JWT_EXPIRES_IN: z.string().default('30d'),
    API_PORT: z.coerce.number().int().positive().default(3001),
    /** Single-city pilot; dispatchers join dispatch:<DEFAULT_CITY_ID>. */
    DEFAULT_CITY_ID: z.string().uuid().default(RIGA_CITY_ID),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000,http://localhost:3002')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  });

  export type Env = z.infer<typeof envSchema>;
  export const APP_ENV = 'APP_ENV';

  let cached: Env | undefined;
  /** Parsed once per process; throws at bootstrap on a bad environment. */
  export function loadEnv(): Env {
    return (cached ??= envSchema.parse(process.env));
  }
  ```

- **GOTCHA**: `z.string().url()` accepts `redis://…` (zod 3 delegates to `new URL()`). OTP policy numbers are **not** env vars — they live as constants in `otp.policy.ts` (Task 13); do not add knobs nobody asked for.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3, AC #5.

### CREATE `services/api/src/common/config/app-config.module.ts` — Task 8

- **IMPLEMENT**: a `@Global() @Module` that imports `ConfigModule.forRoot({ isGlobal: true, cache: true, envFilePath: ['../../.env', '.env'], validate: (raw) => envSchema.parse(raw) })` and provides `{ provide: APP_ENV, useFactory: loadEnv }`, exporting `APP_ENV`.
- **PATTERN**: NestJS "custom validate function" docs.
- **GOTCHA**: `envFilePath` is resolved relative to **`process.cwd()`**, which is `services/api` for both `pnpm --filter @taxi/api dev` and jest — hence `'../../.env'` (the repo root) first, local `.env` second. `@nestjs/config` does **not** overwrite variables already present in `process.env`, so a real environment (CI, Railway) always wins over the file. `validate` runs against the merged env and throws a zod error at bootstrap; `loadEnv()` then parses `process.env` once more — the same object, cached, and the only place downstream code reads config from.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3.

### CREATE `services/api/src/common/db/db.module.ts` — Task 9

- **IMPLEMENT**: `@Global() @Module` providing

  ```ts
  export const DRIZZLE = 'DRIZZLE';
  // useFactory: (env: Env) => createDb(env.DATABASE_URL).db          -> DRIZZLE
  // a second provider holds the pool so onModuleDestroy can end it
  ```
  Implement `OnModuleDestroy` on a small `DbConnection` provider class that owns `{ db, pool }` from `createDb()`, provides `DRIZZLE` via `useFactory: (c: DbConnection) => c.db`, and calls `await this.pool.end()` in `onModuleDestroy`. Export `DRIZZLE`.
- **PATTERN**: `db/src/client.ts:7` — "The api's DrizzleModule (#7) wraps this".
- **GOTCHA**: Without `pool.end()`, jest hangs after the suite with open handles. Type the pool as `ReturnType<typeof createDb>['pool']` so the api needs no `pg` dependency.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #3.

### CREATE `services/api/src/common/kv/{kv.store.ts,redis-kv.store.ts,kv.module.ts}` — Task 10

- **IMPLEMENT**:

  ```ts
  // kv.store.ts
  export const KV_STORE = 'KV_STORE';

  /**
   * The narrow slice of Redis this service actually uses. A port, not an
   * abstraction layer: it exists so tests run without a Redis server (see the
   * plan's Open Questions — :6379 is unavailable on the dev machine) and so the
   * OTP store's contract is four methods instead of all of ioredis.
   */
  export interface KeyValueStore {
    get(key: string): Promise<string | null>;
    setWithTtl(key: string, value: string, ttlSeconds: number): Promise<void>;
    del(key: string): Promise<void>;
    /** INCR then EXPIRE only on first write; returns the new counter value. */
    incrWithTtl(key: string, ttlSeconds: number): Promise<number>;
    /** Remaining TTL in whole seconds, or 0 when the key is gone. */
    ttl(key: string): Promise<number>;
  }
  ```
  `redis-kv.store.ts`: `RedisKeyValueStore implements KeyValueStore, OnModuleDestroy`, wrapping one `new Redis(url)`; `setWithTtl` → `set(key, value, 'EX', ttl)`; `incrWithTtl` → `const n = await redis.incr(key); if (n === 1) await redis.expire(key, ttl); return n;`; `ttl` → `Math.max(0, await redis.ttl(key))`. `onModuleDestroy` → `await this.redis.quit()`.
  `kv.module.ts`: `@Global()`, provides `KV_STORE` via `useFactory: (env: Env) => new RedisKeyValueStore(env.REDIS_URL)`, exports `KV_STORE`.
- **GOTCHA**: `ioredis`'s `ttl` returns `-2` (no key) / `-1` (no expiry) — clamp with `Math.max(0, …)`. Only the **first** `incr` sets the expiry, otherwise a burst of requests keeps resetting the window and the rate limit never closes.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #5.

### CREATE `services/api/src/common/zod-validation.pipe.ts` — Task 11

- **IMPLEMENT**:

  ```ts
  @Injectable()
  export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
    constructor(private readonly schema: ZodType<T>) {}
    transform(value: unknown): T {
      const result = this.schema.safeParse(value);
      if (!result.success) {
        throw new BadRequestException({
          message: 'validation_failed',
          issues: result.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      return result.data;
    }
  }
  ```
- **GOTCHA**: Used per-parameter (`@Body(new ZodValidationPipe(otpRequestSchema))`), **not** as a global pipe — a global zod pipe has no schema to apply. Map the issues rather than passing `error.issues` through, so no zod internals leak into the HTTP response.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #6.

### CREATE `services/api/src/features/auth/auth.repository.ts` — Task 12

- **IMPLEMENT**: an `@Injectable() AuthRepository` injecting `DRIZZLE`, with:

  ```ts
  async findByPhone(phone: string): Promise<User | undefined>

  /**
   * Race-safe find-or-create. `role` applies ONLY to a brand-new row: the
   * conflict branch touches `phone` and nothing else, so an existing user's
   * stored role always wins over whatever the OTP request claimed.
   *
   * `onConflictDoNothing().returning()` returns [] on conflict, which is why
   * this is DO UPDATE with a no-op SET — it is the only form that always
   * returns the row.
   */
  async findOrCreate(input: { phone: string; role: SignupRole }): Promise<User>
  ```
  Implementation: `db.insert(users).values({ phone: input.phone, role: input.role }).onConflictDoUpdate({ target: users.phone, set: { phone: input.phone } }).returning()`, then map the row to the shared `User` shape.
- **PATTERN**: `db/src/schema/users.ts` for the columns; `drizzle-orm`'s `eq` for `findByPhone`.
- **GOTCHA**: `role` is `.notNull()` with **no default** — an insert without it fails. Do **not** include `role` in the conflict `set`: that line is the whole privilege-escalation defence and Task 20 tests it. `language` is left to the column default (`'lv'`).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck` (behavioural coverage arrives in Task 20).
- **SATISFIES**: AC #1, AC #5.

### CREATE `services/api/src/features/auth/{otp.policy.ts,phone-mask.ts,auth-token.service.ts}` — Task 13

- **IMPLEMENT**:
  - `otp.policy.ts` — the SMS-spend guardrail, as named constants with the reason in a comment:
    ```ts
    /** OTP policy. Constants, not env vars — these are security limits, and the
     *  <€100/mo budget guardrail makes unbounded SMS a real cost channel. */
    export const OTP_CODE_LENGTH = 6;
    export const OTP_TTL_SECONDS = 300;            // 5 min
    export const OTP_RESEND_COOLDOWN_SECONDS = 60;
    export const OTP_MAX_VERIFY_ATTEMPTS = 5;      // then the code is burned
    export const OTP_MAX_REQUESTS_PER_HOUR = 5;    // per phone
    ```
  - `phone-mask.ts` — `maskPhone(phone: string): string` → `"+371*****456"` style, keeping only the last 3 digits. Required by `.claude/references/logging-standard.md`.
  - `auth-token.service.ts` — `@Injectable() AuthTokenService` wrapping `JwtService`:
    ```ts
    async issue(user: { id: string; role: UserRole }): Promise<{ accessToken: string; expiresAt: string }>
    /** Throws UnauthorizedException on any bad/expired/malformed token. */
    async verify(token: string): Promise<JwtClaims>
    ```
    `issue` signs `{ sub: user.id, role: user.role }` and derives `expiresAt` from the decoded `exp` (`new Date(exp * 1000).toISOString()`). `verify` calls `jwtService.verifyAsync` then `jwtClaimsSchema.parse(...)` and converts **any** throw into `UnauthorizedException`.
- **GOTCHA**: Parse the decoded payload with `jwtClaimsSchema` — `verifyAsync` returns `any`, and a token signed by an earlier build could carry a role that no longer exists. Derive `expiresAt` from the token's own `exp`, never by re-computing from `JWT_EXPIRES_IN` (a string like `'30d'` you would have to parse yourself).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #2, AC #5.

### CREATE `services/api/src/features/auth/sms/{sms.tokens.ts,stub-sms.provider.ts}` — Task 14

- **IMPLEMENT**: `export const SMS_PROVIDER = 'SMS_PROVIDER';` and

  ```ts
  /**
   * Dev/pilot implementation of the SmsProvider seam (@taxi/shared). Logs the
   * code instead of spending money at Twilio (#7 scope: "stub implementation in
   * dev — no Twilio spend"). The real Twilio implementation lands with #13.
   */
  @Injectable()
  export class StubSmsProvider implements SmsProvider {
    private readonly logger = new Logger(StubSmsProvider.name);
    async sendOtp(phoneE164: string, code: string): Promise<void> { … }
  }
  ```
  It logs `{ event: 'auth.otp.stub_sent', phone: maskPhone(phoneE164), code, at }`.
- **GOTCHA**: The code **is** logged in full — that is the point of the stub and the only way manual validation reads it. The phone is still masked. Add a one-line comment saying so, so a reviewer doesn't read it as a leak. `implements SmsProvider` must be the interface imported from `@taxi/shared` — do not restate it.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #1, AC #5.

### CREATE `services/api/src/features/auth/auth.service.ts` — Task 15

- **IMPLEMENT**: `@Injectable() AuthService` injecting `KV_STORE`, `SMS_PROVIDER`, `AuthRepository`, `AuthTokenService`.

  Keys: `otp:code:<phone>` (the record), `otp:rate:<phone>` (hourly counter).

  ```ts
  async requestOtp(input: OtpRequest): Promise<OtpRequestResponse>
  ```
  1. `const count = await kv.incrWithTtl('otp:rate:' + phone, 3600)`; if `count > OTP_MAX_REQUESTS_PER_HOUR` → log `auth.otp.throttled`, throw `HttpException(…, 429)`.
  2. If a record exists and its age is under `OTP_RESEND_COOLDOWN_SECONDS` (derive from `ttl` vs `OTP_TTL_SECONDS`) → throw 429 with the remaining seconds.
  3. Generate the code with `randomInt(0, 1_000_000)` from `node:crypto`, zero-padded to `OTP_CODE_LENGTH`.
  4. Store `JSON.stringify({ hash, role, attempts: 0 })` under `otp:code:<phone>` with `OTP_TTL_SECONDS`, where `hash = sha256(code + JWT_SECRET)` hex.
  5. `await sms.sendOtp(phone, code)`; on throw, log `auth.otp.send_failed` and rethrow as a 502.
  6. Return `{ expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS }`.

  ```ts
  async verifyOtp(input: OtpVerify): Promise<AuthSession>
  ```
  1. Read the record; missing/expired → log `auth.otp.verify_rejected` (`reason: 'expired'`), throw `UnauthorizedException('invalid_or_expired_code')`.
  2. Compare `sha256(input.code + secret)` against the stored hash with `crypto.timingSafeEqual`.
  3. On mismatch: `attempts + 1`; at `OTP_MAX_VERIFY_ATTEMPTS` → `kv.del` the record (burn it). Rewrite the record with the **remaining** TTL, never a fresh one. Throw the **same** `UnauthorizedException('invalid_or_expired_code')` as step 1 — one message for both, so nothing distinguishes "wrong code" from "no code".
  4. On match: `kv.del` both keys, `repo.findOrCreate({ phone, role: record.role })`, `tokens.issue(user)`, log `auth.session.issued` with `userId` and masked phone, return `authSessionSchema.parse({ accessToken, expiresAt, user: { …user, createdAt: user.createdAt.toISOString() } })`.
- **GOTCHA**:
  - **Use `crypto.randomInt`, never `Math.random()`** — a predictable OTP is a full auth bypass.
  - `timingSafeEqual` **throws** when the two buffers differ in length; both are 32-byte sha256 digests here, so they never do — but only if you hash before comparing. Never compare the raw code strings with `===`.
  - Rewriting the attempts counter must preserve the remaining TTL (`kv.ttl` first, then `setWithTtl(remaining)`), or five wrong guesses would extend the code's life indefinitely.
  - **Burning a code (or verifying successfully) clears the resend cooldown but NOT the hourly counter — that is deliberate.** The two keys have different jobs: `otp:code:<phone>` is the live code and its cooldown; `otp:rate:<phone>` is the SMS-spend cap and must survive the code's deletion, or five wrong guesses would reset the budget guardrail. Do not add a redundant cooldown guard on the rate key.
  - The stored `role` (from the request) is only a *hint* — `findOrCreate` ignores it for existing users. Don't "fix" that.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck` (behaviour in Task 19).
- **SATISFIES**: AC #1, AC #5.

### CREATE `services/api/src/features/auth/{decorators,guards}` + `auth.controller.ts` + `auth.module.ts` + `index.ts` — Task 16

- **IMPLEMENT**:
  - `decorators/public.decorator.ts` — `export const IS_PUBLIC = 'auth:isPublic'; export const Public = () => SetMetadata(IS_PUBLIC, true);`
  - `decorators/roles.decorator.ts` — `export const ROLES_KEY = 'auth:roles'; export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);`
  - `decorators/current-user.decorator.ts` — `createParamDecorator` returning `request.user as JwtClaims`.
  - `guards/jwt-auth.guard.ts`:
    ```ts
    async canActivate(ctx: ExecutionContext): Promise<boolean> {
      if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
      // WS/RPC contexts have no HTTP request: switchToHttp().getRequest() would
      // return undefined and this guard would wave the call through. Sockets are
      // authenticated at the handshake (features/realtime) — anything else is
      // refused outright rather than silently allowed. #8 adds the first
      // @SubscribeMessage handler; it must authorize from socket.data.user.
      if (ctx.getType() !== 'http') throw new UnauthorizedException('unsupported_context');
      …extract Bearer, tokens.verify, assign request.user, return true
    }
    ```
  - `guards/roles.guard.ts` — reads `ROLES_KEY`; **no metadata → return true** (authentication was already enforced); otherwise `roles.includes(request.user.role)` or `ForbiddenException`.
  - `auth.controller.ts` — `@Controller('auth')`, both routes `@Public()`:
    - `@Post('otp/request') @HttpCode(200)` → `@Body(new ZodValidationPipe(otpRequestSchema))`
    - `@Post('otp/verify') @HttpCode(200)` → `@Body(new ZodValidationPipe(otpVerifySchema))`
  - `auth.module.ts` — imports `JwtModule.registerAsync({ inject: [APP_ENV], useFactory: (env: Env) => ({ secret: env.JWT_SECRET, signOptions: { expiresIn: env.JWT_EXPIRES_IN } }) })`; providers `AuthService`, `AuthRepository`, `AuthTokenService`, `{ provide: SMS_PROVIDER, useClass: StubSmsProvider }`; **exports `AuthTokenService`** (the realtime gateway's only dependency on this slice).
  - `index.ts` — the slice's public API: `AuthModule`, `AuthTokenService`, `JwtAuthGuard`, `RolesGuard`, `Public`, `Roles`, `CurrentUser`, `IS_PUBLIC`, `ROLES_KEY`.
- **PATTERN**: NestJS guards docs (`getAllAndOverride` + `APP_GUARD`).
- **GOTCHA**: `@Post` defaults to **201**; these are not creations — `@HttpCode(200)` on both, and the tests assert 200. Also add `@Public()` to **both** handlers in `app.controller.ts` (`/` and `/health`) in Task 22, or AC #3 fails the moment the global guard is registered.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #1, AC #2, AC #3, AC #6.

### CREATE `services/api/src/features/realtime/room-policy.ts` — Task 17

- **IMPLEMENT**:

  ```ts
  /**
   * May a socket belonging to `user` be placed in `room` by a client-driven
   * path? The gateway consults this before every auto-join. There is no
   * client-initiated join API at all (see index.ts), so this is the complete
   * answer to "which rooms can this role reach".
   */
  export function canJoin(user: JwtClaims, room: string, ctx: { cityId: string }): boolean {
    if (room === userRoom(user.sub)) return true;
    if (room === driverRoom(user.sub)) return user.role === 'driver';
    if (room === dispatchRoom(ctx.cityId)) return user.role === 'dispatcher' || user.role === 'admin';
    // Ride rooms are server-orchestrated only (RealtimeService.joinRideRoom).
    // #11 tightens this into a real ride-membership check when rides exist.
    return false;
  }

  /** The rooms the gateway joins on connect — every candidate, filtered. */
  export function roomsOnConnect(user: JwtClaims, ctx: { cityId: string }): string[] {
    return [userRoom(user.sub), driverRoom(user.sub), dispatchRoom(ctx.cityId)].filter((r) =>
      canJoin(user, r, ctx),
    );
  }
  ```
- **GOTCHA**: `canJoin` is stated in the **inverse** of the acceptance criterion on purpose: `canJoin(driverClaims, dispatchRoom(cityId), ctx) === false` is a direct one-line test of "a driver cannot join the dispatch board". Build every room name through the `@taxi/shared` helpers — never a template literal.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #2.

### CREATE `services/api/src/features/realtime/{realtime.gateway.ts,realtime.service.ts,redis-io.adapter.ts,realtime.module.ts,index.ts}` — Task 18

- **IMPLEMENT**:
  - `realtime.gateway.ts`:
    ```ts
    @WebSocketGateway({ cors: { origin: … from APP_ENV.CORS_ORIGINS } })
    export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
      @WebSocketServer() server!: Server<ClientToServerEvents, ServerToClientEvents>;

      afterInit(server: Server): void {
        server.use((socket, next) => {
          const token = socket.handshake.auth?.token ?? bearerFrom(socket.handshake.headers.authorization);
          void this.tokens.verify(token ?? '')
            .then((claims) => { socket.data.user = claims; next(); })
            .catch(() => { …log realtime.gateway.connection_rejected…; next(new Error('unauthorized')); });
        });
      }

      handleConnection(client: Socket): void {
        const user = client.data.user;                 // set by the middleware
        if (!user) { client.disconnect(true); return; } // belt and braces
        const rooms = roomsOnConnect(user, { cityId: this.env.DEFAULT_CITY_ID });
        client.join(rooms);
        …log realtime.gateway.rooms_joined { userId: user.sub, rooms }…
      }
    }
    ```
    **No `@SubscribeMessage` handlers** — #8 adds the first one.
  - `realtime.service.ts` — the slice's public API:
    ```ts
    type ServerEvent = keyof ServerToClientEvents;
    type EventPayload<E extends ServerEvent> = Parameters<ServerToClientEvents[E]>[0];

    @Injectable()
    export class RealtimeService {
      constructor(private readonly gateway: RealtimeGateway) {}

      emitToRide<E extends ServerEvent>(rideId: string, event: E, payload: EventPayload<E>): void { this.emit(rideRoom(rideId), event, payload); }
      emitToDriver<E extends ServerEvent>(driverId: string, event: E, payload: EventPayload<E>): void { this.emit(driverRoom(driverId), event, payload); }
      emitToDispatch<E extends ServerEvent>(cityId: string, event: E, payload: EventPayload<E>): void { this.emit(dispatchRoom(cityId), event, payload); }

      /** Server-orchestrated: puts every socket of `userId` into the ride room,
       *  cluster-wide via the Redis adapter. Clients never request joins. */
      joinRideRoom(userId: string, rideId: string): void { this.gateway.server.in(userRoom(userId)).socketsJoin(rideRoom(rideId)); }
      leaveRideRoom(userId: string, rideId: string): void { this.gateway.server.in(userRoom(userId)).socketsLeave(rideRoom(rideId)); }

      private emit<E extends ServerEvent>(room: string, event: E, payload: EventPayload<E>): void {
        const parsed = RT_EVENT_SCHEMAS[event].parse(payload) as EventPayload<E>;
        // Socket.IO's typed emit cannot narrow a generic E; the cast is confined
        // to this one line and the payload has just been schema-validated.
        (this.gateway.server.to(room).emit as (e: string, p: unknown) => boolean)(event, parsed);
      }
    }
    ```
  - `redis-io.adapter.ts` — `RedisIoAdapter extends IoAdapter` with `connectToRedis(url)` creating `new Redis(url)` + `.duplicate()`, storing `createAdapter(pub, sub)`, a `createIOServer` override that calls `super.createIOServer(port, options)` then `server.adapter(this.adapterConstructor)`, and a `close()` override that `await`s `super.close(server)` then `pub.quit()`/`sub.quit()`.
  - `realtime.module.ts` — imports `AuthModule` (for `AuthTokenService`), providers `RealtimeGateway`, `RealtimeService`; **exports `RealtimeService`**.
  - `index.ts` — exports `RealtimeModule`, `RealtimeService`, `RedisIoAdapter`, `canJoin`, `roomsOnConnect`, plus a header comment stating the no-client-join design so the next agent doesn't "add the missing join handler".
- **GOTCHA**:
  - `socketsJoin`/`socketsLeave` return **`void`**, not a Promise — do not `await` them or mark the methods `async`.
  - `client.data.user` needs the socket's data type widened: declare the gateway's `Socket` as `Socket<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, { user?: JwtClaims }>` (or a local `type AuthedSocket = …`) so `socket.data.user` typechecks under `strict`.
  - `server.use()` middleware is synchronous — `verify` is async, so resolve the promise inside and call `next` in both branches. `@typescript-eslint/no-floating-promises` is a **warn** here; still use `void promise.then().catch()` to keep the log clean (see commit `8469db5`, which fixed exactly this warning in `main.ts`).
  - The two ioredis clients must be **separate connections** — a subscribed client cannot issue other commands. `.duplicate()` is the supported way.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint`
- **SATISFIES**: AC #2, AC #4.

### CREATE `services/api/test/{setup-env.ts,global-setup.ts,harness.ts}` + UPDATE the jest config — Task 19

- **IMPLEMENT**:
  - `test/setup-env.ts` (runs **per worker**, before the framework):
    ```ts
    const ADMIN_URL = process.env.DATABASE_URL ?? 'postgres://taxi:taxi@localhost:5432/taxi';
    export const TEST_DB_NAME = 'taxi_api_test';
    process.env.DATABASE_URL = ADMIN_URL.replace(/\/[^/]*$/, `/${TEST_DB_NAME}`);
    process.env.JWT_SECRET ??= 'test-secret-at-least-16-chars';
    process.env.REDIS_URL ??= 'redis://localhost:6379'; // never dialled: KV_STORE is overridden
    process.env.NODE_ENV = 'test';
    ```
  - `test/global-setup.ts` (runs **once**): mirror `db/tests/global-setup.ts` — connect to the admin URL, `DROP DATABASE IF EXISTS taxi_api_test WITH (FORCE)`, `CREATE DATABASE taxi_api_test`, then `createDb(testUrl)` → `migrateDb(db)` → `seedRiga(db)` → `pool.end()`. Keep the `ECONNREFUSED` → "Postgres is not up — run: docker compose up -d" guard.

    **Open with the stale-dist guard** — this is the structural closure of Risk 1 (see the Risk Register), and it must be the first thing the file does. Use **static imports**, not `require()`:
    ```ts
    import { RT_EVENT_SCHEMAS, otpRequestSchema, userRoom } from '@taxi/shared';
    import { migrateDb, seedRiga, createDb } from '@taxi/db';

    // Jest resolves @taxi/shared and @taxi/db to their BUILT dist, so a stale
    // build runs the suite against yesterday's contracts. Turbo's `test` task
    // depends on `^build`, but a direct `pnpm --filter @taxi/api test` skips
    // it. Fail with the fix rather than mysteriously.
    //
    // If this FILE failed to import at all ("has no exported member …"), that
    // is the same stale-dist problem with a less friendly message — the fix is
    // identical.
    const STALE_DIST_FIX =
      'Stale workspace build. Run: pnpm turbo run test --filter @taxi/api   (rebuilds deps first)';

    const missing = Object.entries({
      'shared.userRoom': typeof userRoom === 'function',
      'shared.RT_EVENT_SCHEMAS': typeof RT_EVENT_SCHEMAS === 'object',
      'shared.otpRequestSchema': typeof otpRequestSchema === 'object',
      'db.migrateDb': typeof migrateDb === 'function',
    })
      .filter(([, present]) => !present)
      .map(([name]) => name);

    if (missing.length) throw new Error(`${missing.join(', ')} missing from dist. ${STALE_DIST_FIX}`);
    ```
  - `test/harness.ts`:
    - `class InMemoryKeyValueStore implements KeyValueStore` — a `Map<string, { value: string; expiresAt: number }>` with lazy expiry, plus a test-only `advance(seconds)` to expire a code without sleeping.
    - `class RecordingSmsProvider implements SmsProvider` — stores `{ phone, code }` per call and exposes `lastCodeFor(phone)`.
    - `createTestApp()` → `Test.createTestingModule({ imports: [AppModule] }).overrideProvider(KV_STORE).useValue(kv).overrideProvider(SMS_PROVIDER).useValue(sms).compile()`, returning `{ app, kv, sms, db }`.
    - `phoneFor(prefix: string, n: number)` → a distinct E.164 per spec file (auth uses `+371210`, realtime `+371220`) so parallel jest workers never collide on the unique `phone` column.
    - `insertUser(db, { phone, role })` for the dispatcher/admin fixtures nothing seeds yet.
    - **The socket client tracker** — the deterministic closure of Risk 4 (teardown ordering). Write it once here so no spec file has to get it right by hand:
      ```ts
      const openClients: Socket[] = [];

      /** Connects and resolves only once the server has run handleConnection,
       *  so room assertions immediately after are never racy. Rejects on
       *  connect_error so a failed handshake is an explicit test outcome. */
      export function connectClient(port: number, token?: string): Promise<Socket> {
        const client = io(`http://localhost:${port}`, {
          auth: token ? { token } : {},
          transports: ['websocket'],   // skip the polling upgrade — faster, fewer handles
          reconnection: false,         // a rejected handshake must not retry forever
        });
        openClients.push(client);
        return new Promise((resolve, reject) => {
          client.once('connect', () => resolve(client));
          client.once('connect_error', (err) => reject(err));
        });
      }

      /** afterEach(closeClients); afterAll(() => app.close()) — in that order. */
      export function closeClients(): void {
        for (const c of openClients.splice(0)) c.close();
      }
      ```
  - `services/api/package.json` jest block: add
    ```json
    "setupFiles": ["<rootDir>/../test/setup-env.ts"],
    "globalSetup": "<rootDir>/../test/global-setup.ts",
    "testTimeout": 20000
    ```
    and add a `"pretest": "docker compose -f ../../docker-compose.yml up -d --wait db"` script. **The path is two levels up** — `db/package.json` uses `-f ../docker-compose.yml` because `db/` sits at the repo root, but `services/api/` is one level deeper. Verified at plan time: `docker compose -f ../../docker-compose.yml config --quiet` succeeds from `services/api`.
- **GOTCHA**:
  - **`taxi_api_test`, not `taxi_test`.** Turbo runs `@taxi/db:test` and `@taxi/api:test` **in parallel**, and both global-setups drop their database — sharing a name is a guaranteed intermittent failure.
  - `rootDir` is `src`, so `<rootDir>/../test/...` is `services/api/test/...`. `globalSetup` may live outside `roots` (which only governs test discovery); ts-jest's `transform` still applies because it matches by path pattern.
  - `pretest` starts **only `db`**. Redis is deliberately not required by the suite — see Open Questions.
  - Overriding `KV_STORE` by token replaces the whole `useFactory`, so **no ioredis client is ever constructed** during tests. That is what keeps the suite Redis-free.
  - **The stale-dist guard must use static imports.** The api is `module: nodenext` and (after Task 0) `strict`; a bare dynamic `require('@taxi/shared')` does not typecheck there. A guard that does not compile is worse than no guard — it fails this task's VALIDATE and sends the implementer debugging the plan instead of the feature. Hence the explicit typecheck below, run **before** the suite.
- **VALIDATE**: in this order.
  ```bash
  pnpm --filter @taxi/api typecheck   # the harness files compile — run this FIRST
  pnpm turbo run test --filter @taxi/api                 # the two existing specs still pass
  docker compose exec -T db psql -U taxi -d taxi -c "\l" | grep taxi_api_test
  ```
  **Expected: no type errors, both pre-existing specs green, and a `taxi_api_test` row in the database list.**
- **SATISFIES**: AC #1, AC #3, AC #4.

### CREATE `services/api/src/features/auth/{auth.service.spec.ts,auth.integration.spec.ts}` — Task 20

- **IMPLEMENT**:

  `auth.service.spec.ts` — unit, with `InMemoryKeyValueStore` + `RecordingSmsProvider` + a stubbed repository:
  - *expected*: `requestOtp` sends exactly one SMS and stores a record; `verifyOtp` with the recorded code returns a session whose `accessToken` verifies to `{ sub, role }`.
  - *edge*: a second `requestOtp` inside the cooldown throws 429 and sends **no** second SMS.
  - *edge*: `OTP_MAX_VERIFY_ATTEMPTS` wrong guesses burn the code — the 6th attempt with the **correct** code still fails.
  - *failure*: a wrong code and an expired code (`kv.advance(OTP_TTL_SECONDS + 1)`) produce the **same** message and status, asserted by comparing the two errors.

  `auth.integration.spec.ts` — full Nest app + real Postgres via `createTestApp()`, supertest:
  - *expected*: `POST /auth/otp/request` → 200 `{ expiresInSeconds, resendAfterSeconds }`; read the code from `sms.lastCodeFor(phone)`; `POST /auth/otp/verify` → 200; assert `authSessionSchema.parse(res.body)` succeeds, a `users` row now exists with the requested role, and `GET /health` is still 200 without a token.
  - *edge*: a **second** request/verify cycle for the same phone returns the same `user.id` (find-or-create is idempotent).
  - *edge* (**the privilege-escalation case**): insert a `dispatcher` user, then run request+verify with `role: 'rider'` — the session's `user.role` and the JWT's `role` claim must both still be `dispatcher`.
  - *failure*: verify with a wrong code → 401; `POST /auth/otp/request` with `{ phone: '26123456' }` → 400 `validation_failed`; a guarded probe route (or any non-`@Public()` route) without a token → 401.
- **GOTCHA**: Use `phoneFor('+371210', n)` — a distinct number per test — because `users.phone` is unique and the database is not reset between tests within a run. Close the app in `afterAll` (`await app.close()`), or the Drizzle pool keeps jest alive.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api` — **expected: all auth cases green**.
- **SATISFIES**: AC #1, AC #4, AC #5, AC #6.

### CREATE `services/api/src/features/realtime/{room-policy.spec.ts,realtime.gateway.spec.ts,redis-io.adapter.spec.ts}` — Task 21

- **IMPLEMENT**:

  `room-policy.spec.ts` — pure unit, no app:
  - *expected*: `roomsOnConnect(driverClaims, ctx)` === `[userRoom(id), driverRoom(id)]`.
  - *edge*: dispatcher and admin both get `[userRoom(id), dispatchRoom(cityId)]`; a rider gets `[userRoom(id)]` only.
  - *failure* (**the acceptance criterion, stated literally**): `canJoin(driverClaims, dispatchRoom(cityId), ctx) === false`; also `canJoin(riderClaims, driverRoom(otherId), ctx) === false` and `canJoin(anyClaims, rideRoom(someRideId), ctx) === false`.

  `realtime.gateway.spec.ts` — real app over a real socket, using `connectClient`/`closeClients` from `test/harness.ts`:
  - Boot with `createTestApp()`, then `await app.listen(0)` and read the port from `app.getHttpServer().address()`. Do **not** install `RedisIoAdapter` here — the default in-memory adapter is correct for a single-process test; the adapter gets its own opt-in spec below.
  - *failure*: connecting with **no** token, and with a garbage token, both emit `connect_error` with message `unauthorized` and never `connect`.
  - *expected*: a driver's token connects, and `await gateway.server.in(driverRoom(driverId)).fetchSockets()` has length 1.
  - *edge* (**the AC over the wire**): with that same driver socket connected, `await gateway.server.in(dispatchRoom(cityId)).fetchSockets()` has length **0**; connect a dispatcher (row inserted by `insertUser`) and it becomes 1.
  - *expected*: `service.joinRideRoom(riderId, rideId)` then `service.emitToRide(rideId, RT.rideStatus, {…})` is received by the rider's client with the payload's `at` still an **ISO string**.
  - *failure*: emitting a `ride:status` payload whose `at` is a `Date` rather than an ISO string **throws** — proof that `RT_EVENT_SCHEMAS.parse` enforces the wire rule at runtime, not just at compile time. Write it as:
    ```ts
    expect(() =>
      // @ts-expect-error — the type system already forbids a Date here; this
      // asserts the runtime backstop fires too.
      service.emitToRide(rideId, RT.rideStatus, { ...validStatusPayload, at: new Date() }),
    ).toThrow();
    ```
    **Do not write `as never`** — under `strict`, casting an object literal to `never` is itself a compile error (`Conversion of type '{...}' to type 'never' may be a mistake`).
  `redis-io.adapter.spec.ts` — **opt-in**, the closure of Risk 3 (the adapter is otherwise the only uncovered code in this ticket):
  ```ts
  // Skipped unless a Redis is reachable, because :6379 and :6380 are occupied
  // on the primary dev machine. Run it deliberately:
  //   REDIS_PORT=6381 docker compose up -d --wait redis
  //   REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
  const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
  const describeWithRedis = REDIS_TEST_URL ? describe : describe.skip;

  describeWithRedis('RedisIoAdapter', () => { … });
  ```
  Two apps, both on ephemeral ports, both with `RedisIoAdapter` connected to `REDIS_TEST_URL`:
  - *expected*: a client connected to **app A** receives a `ride:status` emitted by **app B**'s `RealtimeService` — the cross-node fan-out that is the adapter's entire reason to exist.
  - *edge*: `joinRideRoom` issued on app B places app A's socket in the ride room (`socketsJoin` is cluster-wide, not local) — the property #11 will depend on.
  - Close both apps in `afterAll`; `RedisIoAdapter.close()` must `quit()` both ioredis clients or the suite hangs.
- **GOTCHA**:
  - **Teardown order is `closeClients()` → `await app.close()`**, as `afterEach` then `afterAll`. Reversed, jest reports open handles and the run hangs past the suite. Use the `connectClient`/`closeClients` helpers from `test/harness.ts` rather than hand-rolling `io()` per test — `connectClient` resolves on `connect`, i.e. after the server's `handleConnection` has run, which is what makes the `fetchSockets()` assertions deterministic instead of racy.
  - A **rejected** handshake makes `connectClient` reject — assert with `await expect(connectClient(port)).rejects.toThrow('unauthorized')`. The client is still tracked, so `closeClients()` reaps it.
  - `reconnection: false` in the helper matters: a rejected socket.io client retries by default and keeps the event loop alive long after the test passes.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/api` — **expected: all realtime cases green, the Redis suite reported as skipped, no open-handle warning**. Then, once, with Redis up: `REDIS_PORT=6381 docker compose up -d --wait redis && REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api` — **expected: the same run with the Redis suite green instead of skipped**.
- **SATISFIES**: AC #2, AC #4.

### UPDATE `services/api/src/app.module.ts`, `src/main.ts`, `src/app.controller.ts` — Task 22

- **IMPLEMENT**:
  - `app.module.ts` — imports `[AppConfigModule, DbModule, KvModule, AuthModule, RealtimeModule]`; providers add
    ```ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },   // registered first: authenticate
    { provide: APP_GUARD, useClass: RolesGuard },     // then authorize
    ```
  - `app.controller.ts` — `@Public()` on **both** `getHello` and `getHealth`.
  - `main.ts`:
    ```ts
    const app = await NestFactory.create(AppModule);
    const env = app.get<Env>(APP_ENV);
    app.enableCors({ origin: env.CORS_ORIGINS });
    const adapter = new RedisIoAdapter(app);
    await adapter.connectToRedis(env.REDIS_URL);
    app.useWebSocketAdapter(adapter);
    app.enableShutdownHooks();
    await app.listen(env.API_PORT);
    ```
- **GOTCHA**: Global guards run in **registration order** — `JwtAuthGuard` must come before `RolesGuard`, or `RolesGuard` reads an undefined `request.user`. `enableShutdownHooks()` is what makes the `onModuleDestroy` hooks in `DbModule`/`KvModule` actually fire on SIGINT. Keep `void bootstrap();` as-is (commit `8469db5` fixed that lint warning deliberately).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck && pnpm --filter @taxi/api lint && pnpm turbo run test --filter @taxi/api`
- **SATISFIES**: AC #2, AC #3, AC #5.

### UPDATE `.claude/references/realtime-events.md` — Task 23

- **IMPLEMENT**: amend the Rules block only (do not touch the 8-row event table):
  - Rooms line → `ride:<id>` (rider+driver+dispatch), `dispatch:<cityId>` (board), `driver:<id>` (offers), **`user:<userId>` (every authenticated socket's private room — how the server addresses one person's sockets cluster-wide)**.
  - Add the helper name `userRoom()` to the "never hand-build the strings" rule.
  - Replace "Auth on connect via JWT; a socket only joins rooms its role allows" with the sharper statement of what was built: *"JWT is verified in a Socket.IO handshake middleware — an unauthenticated connection is refused before any handler runs. There is **no client-initiated join API**: the gateway places each socket in the rooms `canJoin()` allows for its role, and ride rooms are joined server-side via `RealtimeService.joinRideRoom()`."*
  - Add: *"`RT_EVENT_SCHEMAS` (shared) maps every event to its payload schema; the api's emit helpers `.parse()` before sending, so the ISO-string rule is enforced, not just documented."*
- **GOTCHA**: The doc's own last rule is "Add an event = add it to `RT` + payload schema in shared FIRST, then this table." No events were added — only a room and a schema map — so the table stays as-is.
- **VALIDATE**: `grep -c "userRoom" .claude/references/realtime-events.md` — **expected: ≥1**; and `grep -c "^| \`" .claude/references/realtime-events.md` still shows **8** event rows.
- **SATISFIES**: AC #8.

### UPDATE `services/api/CLAUDE.md` — Task 24

- **IMPLEMENT**: add two lines to the existing bullet list (keep it terse — this file is 11 lines and should stay small):
  - `- Cross-cutting Nest plumbing (env config, Drizzle, Redis KV, the zod pipe) lives in `src/common/`; `src/features/` stays feature-vertical.`
  - `- Auth is fail-closed: `JwtAuthGuard` + `RolesGuard` are global (`APP_GUARD`); a route is only reachable unauthenticated with `@Public()`. Sockets authenticate in the handshake, and clients never request room joins.`
- **GOTCHA**: Do not restate what root `CLAUDE.md` already says. This file is read on every api session — every added line costs context forever.
- **VALIDATE**: `wc -l services/api/CLAUDE.md` — **expected: ≤15**.
- **SATISFIES**: AC #8.

### RUN the full gate — Task 25

- **IMPLEMENT**: nothing new. Run every validation level below, in order, and fix whatever is red.
- **VALIDATE**: `pnpm check`
- **SATISFIES**: AC #3, AC #4, AC #7.

---

## TESTING STRATEGY

The gate is `pnpm check` → `turbo run typecheck lint test`. For `@taxi/api` that is **jest with `rootDir: src`**, so every test that must run in the gate is a colocated `*.spec.ts` under `src/`. `services/api/test/` holds only harness code (and the pre-existing, ungated `app.e2e-spec.ts`, which this ticket leaves alone apart from keeping `/` public).

### Unit Tests

- `packages/shared/tests/auth.test.ts` — schema round-trips, the wire/domain override, the signup-role restriction (vitest).
- `services/api/src/features/auth/auth.service.spec.ts` — OTP lifecycle against fakes: throttle, cooldown, attempt burn, indistinguishable failures.
- `services/api/src/features/realtime/room-policy.spec.ts` — `canJoin`/`roomsOnConnect` across all four roles. Pure functions, no Nest.

### Integration Tests

- `auth.integration.spec.ts` — the real module graph, real Postgres (`taxi_api_test`), supertest over HTTP. `KV_STORE` and `SMS_PROVIDER` are the only two providers overridden — everything else (guards, pipes, JWT, Drizzle) is the production wiring.
- `realtime.gateway.spec.ts` — a real HTTP server on an ephemeral port with real `socket.io-client` connections. Redis adapter deliberately not installed (single process); everything else is production wiring.
- `redis-io.adapter.spec.ts` — **opt-in** (`describe.skip` unless `REDIS_TEST_URL` is set). Two Nest apps on separate ports sharing one Redis, proving cross-node emit and cluster-wide `socketsJoin`. Skipped by default so the gate never depends on a Redis this machine cannot bind; run deliberately before opening the PR (Level 5).

### Edge Cases

- Resend inside the 60 s cooldown → 429, no second SMS (the budget guardrail).
- 5 wrong guesses burn the code; the 6th attempt with the *correct* code still fails.
- Expired code and wrong code are **indistinguishable** from outside (same status, same message body).
- A pre-existing `dispatcher` signing in with `role: 'rider'` keeps `dispatcher` in both the row and the JWT claim.
- Repeat sign-in returns the same `user.id`.
- `admin` gets the dispatch room; `driver` does not; `rider` gets only its own user room.
- Socket with no token, and with a malformed token, both fail at the handshake.
- Emitting a payload with a `Date` where the wire schema demands an ISO string **throws** at the emit helper.

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. **Baseline for this ticket: `pnpm check` was green (FULL TURBO) at plan time on commit `4df9b5e`** — any red is yours.

### Level 0: Prerequisites (once, before Task 19)

```bash
docker compose up -d --wait db          # must report healthy
pnpm --filter @taxi/db migrate          # only if the dev DB is behind
```

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/api lint
pnpm --filter @taxi/api typecheck
pnpm --filter @taxi/shared typecheck
pnpm --filter @taxi/db typecheck
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm turbo run test --filter @taxi/api      # NOT `pnpm --filter @taxi/api test` — see header GOTCHA #1
```

### Level 3: Full Gate

```bash
pnpm check
```

### Level 4: Manual Validation (live server)

Requires a reachable Redis. On this machine `:6379` and `:6380` are taken by an SSH tunnel, so use `6381`:

```bash
# .env (root) — add or adjust:
#   REDIS_PORT=6381
#   REDIS_URL=redis://localhost:6381
docker compose up -d --wait db redis
pnpm --filter @taxi/db migrate && pnpm --filter @taxi/db seed
pnpm --filter @taxi/api dev            # leave running in another shell

curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3001/health
# expected: 200

curl -s -X POST http://localhost:3001/auth/otp/request \
  -H 'content-type: application/json' \
  -d '{"phone":"+37126000001","role":"driver"}'
# expected: {"expiresInSeconds":300,"resendAfterSeconds":60}
# then read the code from the api log line: auth.otp.stub_sent

curl -s -X POST http://localhost:3001/auth/otp/verify \
  -H 'content-type: application/json' \
  -d '{"phone":"+37126000001","code":"<the code>"}'
# expected: {"accessToken":"eyJ…","expiresAt":"…Z","user":{…,"role":"driver"}}

curl -s -X POST http://localhost:3001/auth/otp/request \
  -H 'content-type: application/json' -d '{"phone":"+37126000001","role":"driver"}' -i | head -1
# expected: HTTP/1.1 429  (resend cooldown)
```

Socket smoke test (`node scratch/socket-check.mjs`, delete afterwards — do not commit):

```js
import { io } from 'socket.io-client';
io('http://localhost:3001').on('connect_error', (e) => console.log('no-token ->', e.message)); // expected: unauthorized
const ok = io('http://localhost:3001', { auth: { token: process.env.TOKEN } });
ok.on('connect', () => console.log('authed ->', ok.id));   // expected: a socket id
```

Confirm the api log shows `realtime.gateway.rooms_joined` with `["user:<id>","driver:<id>"]` and **no** `dispatch:` room.

### Level 5: Additional Validation (optional)

```bash
# The Redis-adapter suite (skipped by default — Risk 3). Run it once before the PR:
REDIS_PORT=6381 docker compose up -d --wait redis
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run test --filter @taxi/api
# expected: `RedisIoAdapter` reported green rather than skipped

docker compose exec -T redis redis-cli KEYS 'otp:*'   # a live code record after a request, gone after verify
gh pr checks                                          # CI parity once the PR is open
```

---

## ACCEPTANCE CRITERIA

Derived from issue #7; every task above names the criteria it advances.

- [ ] **AC #1 — OTP e2e**: request → verify → JWT passes end-to-end against the stub provider, with a real database and the production module graph.
- [ ] **AC #2 — auth failure & role gating**: wrong code, expired code, exhausted attempts, malformed phone, and missing token are all covered; an unauthenticated socket is rejected at the handshake; `canJoin(driver, dispatchRoom) === false` is asserted both as a unit test and over a live socket.
- [ ] **AC #3 — the service runs**: `pnpm --filter @taxi/api dev` boots with Redis reachable, `GET /health` returns 200 under the global guard, `pnpm check` is green.
- [ ] **AC #4 — 1+1+1 per slice**: `auth` and `realtime` each ship at least one expected, one edge and one failure case, named as such in the test titles.
- [ ] **AC #5 — the security properties hold**: OTP codes come from `crypto.randomInt` and are stored hashed; comparison is constant-time; user rows are created only at verify; an existing user's stored role always wins; SMS is rate-limited per phone; phones are masked in every log line.
- [ ] **AC #6 — contracts live in `@taxi/shared`**: every cross-surface auth type is a zod schema in `packages/shared`, wire timestamps are ISO strings, and no type is duplicated in the api.
- [ ] **AC #7 — conventions**: vertical slices with `index.ts` as the public API, no file over ~500 lines, no hand-built room strings, no string-literal event names, api compiles under `strict`.
- [ ] **AC #8 — docs current**: `.claude/references/realtime-events.md` and `services/api/CLAUDE.md` describe what was actually built.
- [ ] **AC #9 — no regressions**: the pre-existing `app.controller.spec.ts` and `db-schema.spec.ts` still pass; `packages/shared` and `db` suites unchanged.

---

## COMPLETION CHECKLIST

- [ ] All 26 tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual Level 4 walkthrough confirms the live OTP flow and both socket cases
- [ ] Level 5 run with `REDIS_TEST_URL` set — the `RedisIoAdapter` suite green, not skipped
- [ ] Every Risk Register row still closed where it says it is (or the row updated to say otherwise)
- [ ] Acceptance criteria all met
- [ ] Divergences from this plan documented in `.claude/reports/api-auth-realtime-gateway-report.md`
- [ ] Branch `feature/api-auth-realtime-gateway`, PR body carries `Closes #7`

---

## RISK REGISTER

Every risk identified while planning, with the mitigation that closes it and **where** it is closed. A risk with no location is not mitigated — it is just noted, and this table has none of those.

| # | Risk | Failure mode if unmitigated | Mitigation | Closed in | Residual |
|---|---|---|---|---|---|
| 1 | **Stale workspace `dist`** — turbo's `test` depends on `^build`, but a direct `pnpm --filter @taxi/api test` skips it, so jest runs against yesterday's `@taxi/shared`/`@taxi/db`. | Silent. New schemas appear "missing", tests fail for reasons that have nothing to do with the code, and the implementer debugs the wrong file for an hour. | (a) Every VALIDATE line uses `pnpm turbo run test --filter @taxi/api`; (b) **the jest global-setup asserts the four new symbols exist in the built packages and throws with the exact fix command**. | header GOTCHA #1 · Task 19 | None. The guard makes the failure self-diagnosing. |
| 2 | **Two `taxi_test` databases** — turbo runs `@taxi/db:test` and `@taxi/api:test` in parallel and both global-setups `DROP DATABASE`. | Intermittent, unreproducible failures in whichever suite loses the race. | The api uses a **separate database name**, `taxi_api_test`. Costs one string. | Task 19 | None — different names cannot race. Within the api suite, parallel workers share one DB, which `phoneFor()` handles by giving each spec file its own E.164 range. |
| 3 | **`RedisIoAdapter` untestable locally** — `:6379` and `:6380` are occupied on the dev machine, so a Redis-dependent suite would be red every day. | The one piece of infrastructure that makes multi-node dispatch work ships with zero coverage; the first bug surfaces in production. | (a) The default suite never dials Redis (`KV_STORE` overridden, in-memory socket adapter) so the gate stays green; (b) **an opt-in `redis-io.adapter.spec.ts`, skipped unless `REDIS_TEST_URL` is set, proves cross-node fan-out and cluster-wide `socketsJoin`**; (c) Level 4 exercises the real boot path by hand. | Tasks 19, 21 · Level 4/5 | The opt-in suite does not run in CI. Enabling it there (a redis service + `REDIS_TEST_URL`) is a one-step follow-up, deliberately not folded into this ticket's blast radius. |
| 4 | **Socket test teardown ordering** — jest + live sockets + room-membership timing is the plan's most likely second attempt. | Suite hangs past completion, open-handle warnings, flaky `fetchSockets()` assertions that pass locally and fail in CI. | A pre-written `connectClient`/`closeClients` pair in the harness: resolves on `connect` (after the server's `handleConnection`), `reconnection: false`, tracked clients, documented `afterEach` → `afterAll` order. No spec file reinvents it. | Task 19 (helpers) · Task 21 (GOTCHAs) | Low. This is the residual half-point in the confidence score. |
| 5 | **`zod@4` in the api against `zod@3` in shared** — npm's `latest` is 4.x. | `ZodType` types look compatible, then fail with unreadable variance errors inside `ZodValidationPipe`; the cause is three files away from the symptom. | Exact pin `zod@^3.24.0` with the reason in the task, plus a **VALIDATE that resolves zod from both packages and throws on a major mismatch**. | header GOTCHA #3 · Task 5 | None. |
| 6 | **`ioredis@6.0.0` published four days before this plan** — unproven with `@socket.io/redis-adapter`. | Adapter fails at boot or subtly under load; the debugging surface is a brand-new major. | Pin `^5.11.1` (mature, the version the adapter's docs target), with the publish date written into the task so it isn't "helpfully" upgraded. | header GOTCHA #3 · Task 5 | Revisit when ioredis 6 has a few months of adapter usage behind it. |
| 7 | **Redis cannot bind `:6379`** — reproduced at plan time: `Bind for 0.0.0.0:6379 failed: port is already allocated`. | AC #3 (`pnpm --filter @taxi/api dev` boots) is unachievable on the primary dev machine, and the ticket cannot be manually validated at all. | `${REDIS_PORT:-6379}` in compose + `.env.example` documenting `6381` (**verified free**, along with the fact that the same SSH tunnel also holds 5432/5433/5434/6380/3200/8000/8123). | Task 6 · Level 4 | None locally. CI is unaffected (no tunnel). |
| 8 | **Global guard locks out `/health`** — AC #3 requires a 200. | The gate's own smoke test 401s the moment `APP_GUARD` is registered. | `@Public()` on **both** `app.controller.ts` handlers, called out in the task that registers the guard, and asserted in the auth integration spec. | Tasks 16, 20, 22 | None. |
| 9 | **`JwtAuthGuard` silently passes WS contexts** — `switchToHttp().getRequest()` returns `undefined` outside HTTP. | Moot today (no `@SubscribeMessage` handlers), a **silent auth hole** the moment #8 adds one. | The guard branches on `ctx.getType()` and **throws** on anything non-HTTP, with a comment naming #8 and pointing at `socket.data.user`. | Task 16 · NOTES forward-dependencies | None. Fails closed by construction. |
| 10 | **Timing/enumeration leaks in the OTP flow** — distinguishable errors, predictable codes, `===` comparison. | An attacker learns which numbers are registered, or predicts codes outright. Full auth bypass. | `crypto.randomInt`, sha256-at-rest, `timingSafeEqual`, one identical `UnauthorizedException` for wrong-vs-expired, no user row created at request time — each asserted by a named test. | Tasks 15, 20 | Accepted: no token revocation (Open Question 4). |
| 11 | **Unbounded SMS spend** against the <€100/mo guardrail. | An open endpoint that costs money per call, at pilot launch. | Per-phone hourly cap + resend cooldown in Redis, with the explicit rule that **burning a code clears the cooldown but not the hourly counter**. | Tasks 13, 15, 20 | Numbers are engineering judgement, not evidence — but they are constants in one file. |
| 12 | **Plan-time infrastructure claims that were never checked** — the #6 review's headline lesson. | The plan asserts something about turbo/tsconfig/ports that is false, and the implementer discovers it mid-task. | Four claims verified empirically before writing: baseline `pnpm check` green on `4df9b5e`; api compiles clean under `strict` + `noUncheckedIndexedAccess`; the redis bind failure reproduced with its exact error string; `docker compose -f ../../docker-compose.yml` resolves from `services/api`. | Tasks 0, 6, 19 · Assumptions | None known. Everything else infrastructure-shaped in this plan carries its own VALIDATE. |

---

## OPEN QUESTIONS / ASSUMPTIONS

**Flagged for the user — none blocking, but say so now if you disagree:**

1. **No client-initiated room joins (the AC's literal wording).** The criterion says "role-gated room joins tested (a driver cannot join the dispatch board)". This plan makes that structurally impossible rather than merely refused: the gateway has no join API, and `canJoin()` is the policy the server consults before every auto-join. The AC is tested as `canJoin(driverClaims, dispatchRoom(cityId)) === false` plus a live assertion that a connected driver's socket is absent from the dispatch room. The alternative — a `room:join` client event with a rejection path — would need a 9th entry in the `RT` catalog and gives an attacker a surface that buys nothing, since no consumer (#15, #17, #18) needs client-driven joins. **If you'd rather have the explicit join-and-reject event, say so before implementation.**
2. **`userRoom()` widens the documented room set from three to four.** It is the only cluster-safe way for the server to address one person's sockets, and it is what makes the ticket's "per-ride room" capability actually reachable (`joinRideRoom`). It is additive to `@taxi/shared` and to `.claude/references/realtime-events.md` (Task 23), and adds no socket event. Per the PIV rule about not silently diverging from epic-level decisions, it is called out here rather than buried.
3. **Redis cannot bind `:6379` on this machine** — verified at plan time: an SSH tunnel holds `*:6379` **and** `*:6380` (and 5432/5433/5434/3200/8000/8123); `docker compose up -d redis` fails with `Bind for 0.0.0.0:6379 failed: port is already allocated`. Hence three decisions: the `${REDIS_PORT:-6379}` compose override (Task 6, a hard prerequisite for AC #3's manual validation — use `6381`, verified free); a **default** test suite that never dials Redis (`KV_STORE` overridden; the socket tests use the in-memory adapter), so the gate is green on your machine every day; and an **opt-in** `redis-io.adapter.spec.ts` that covers the adapter's real job — cross-node fan-out and cluster-wide `socketsJoin` — whenever `REDIS_TEST_URL` is set (Task 21, Risk 3). **The remaining gap is CI**: that suite is skipped there too, because enabling it means adding a redis service container to `ci.yml`, which is outside this ticket. Say the word if you'd rather I fold that into the plan.
4. **JWT: one long-lived access token, no refresh, no revocation.** `JWT_EXPIRES_IN=30d` matches a driver who stays signed in for a season. A stolen or leaked token is valid until expiry and cannot be revoked. That is an accepted pilot-scale risk; a token version column or a Redis denylist is the natural follow-up ticket if you want revocation before launch.
5. **Only `rider` and `driver` can self-sign-up.** Dispatcher and admin rows must pre-exist (#20 owns provisioning) — they sign in by the same OTP flow, but the role comes from the row. Until #20 ships there is no way to create Dina's account except a manual insert; the tests do exactly that. Flag if you want a seed-time dispatcher instead.

**Assumptions this plan makes** (each would change the plan if wrong):

- The epic's architecture doc explicitly lists auth posture as **"skipped — decided in the skeleton and unchanged"**, and `docs/skeleton-proposal.md:72` says "SMS OTP + Google Sign-In (per outline), JWT sessions; SMS provider behind a seam". This plan implements exactly that minus Google Sign-In (deferred by the ticket itself). No epic-level decision is being reopened.
- `services/api` compiles clean under `strict` + `noUncheckedIndexedAccess` — **verified at plan time**, zero errors, so Task 0 is free.
- `pnpm check` was green at plan time on `4df9b5e` — **verified**.
- Rate-limit numbers (5/hour, 60 s cooldown, 5 attempts, 5 min TTL) are engineering judgement, not evidence from the anketa. They are constants in one file and trivially retuned.
- CORS defaults (`:3000`, `:3002`) are guesses at where `apps/dispatch` and `apps/admin` will run; the value is env-driven, so a wrong guess costs one line in `.env`.

---

## NOTES (open canvas)

### Why OTP state goes in Redis, not Postgres

| | Redis (chosen) | Postgres table |
|---|---|---|
| TTL | native, free | a `expires_at` column + a sweeper |
| Migration cost | none | a migration in a ticket that otherwise adds none |
| Rate limiting | `INCR`+`EXPIRE` | a second table or a window query per request |
| Test story | needs a port (solved by the `KeyValueStore` port) | reuses the existing PG harness |
| Durability on restart | codes lost — user re-requests | survives |

Losing in-flight codes on a Redis restart is a non-event (the user taps resend). The migration and sweeper costs are not. Redis was already mandatory for the socket adapter, so this adds no new infrastructure.

### Why the `KeyValueStore` port is not overengineering

Under normal circumstances, injecting `Redis` directly and overriding it in tests would be simpler. It isn't available here: the dev machine cannot run Redis on any conventional port, and structurally satisfying ioredis's overloaded method signatures with a hand-written fake is a fight (`set` alone has ~10 overloads). A five-method interface with one 20-line production implementation and one 25-line test implementation is less code than the workaround it replaces, and it keeps the OTP store's contract legible. It is a port, not a layer: nothing is pluggable, nothing is configurable, and there is exactly one production implementation.

### Alternatives weighed and rejected

- **Passport + `passport-jwt`.** Two extra dependencies and a strategy class to express "verify a Bearer token and put the claims on the request", which `@nestjs/jwt` plus a 25-line guard already does. Rejected on KISS.
- **`nestjs-pino` for structured logging.** The logging standard wants JSON with a `domain.component.action_state` event name; Nest's built-in `Logger` with a serialized object satisfies it at zero dependency cost. Revisit when #13 needs log shipping — that is the ticket where a log transport earns its keep.
- **`ioredis-mock` instead of the KV port.** A test-only dependency that has to track ioredis's API forever, to avoid writing 25 lines.
- **Storing OTP codes in plaintext in Redis.** Defensible (5-minute TTL, no cross-service reuse) but a sha256 is four lines and turns a Redis dump into a non-incident.
- **Running the api's integration tests against a faked repository instead of Postgres.** Would keep the suite hermetic, but `findOrCreate`'s conflict semantics — the exact place the privilege-escalation defence lives — only exist in the database. A fake would test the fake.
- **Reusing `taxi_test` for the api suite.** Turbo runs package `test` tasks in parallel and both global-setups drop their database. `taxi_api_test` costs one string and removes an entire class of intermittent failure.

### Sequencing / parallelism

Phases 1→6 are strictly sequential *as written*, but Phase 1 (contracts, in `packages/shared` + `db`) is genuinely independent of Phases 2–4 (all in `services/api`). If this is ever split across worktrees, that is the seam — though the epic's hygiene rule ("never two execute sessions in the same package") makes a single session the right call for a ticket this interconnected.

### Forward-dependencies this ticket creates (write these into the follow-up plans)

- **#8** adds the first `@SubscribeMessage(RT.driverLocation)` handler. It must authorize from `socket.data.user`, **not** from the global `JwtAuthGuard` — which now explicitly refuses non-HTTP contexts (Task 16) precisely so this cannot become a silent hole. It must also `driverLocationPingSchema.parse()` the payload; the listen map types it `unknown` for that reason.
- **#11** must call `RealtimeService.joinRideRoom(riderId, rideId)` when a ride is created, **and** provide a rejoin path for a client that reconnects mid-ride (the natural shape is a connection hook on the gateway that asks the rides slice for the user's active rides). #7 deliberately does not build the hook — there are no rides to ask about yet.
- **#11** also owns tightening `canJoin`'s `ride:*` branch into a real membership check if client-visible ride-room semantics ever change.
- **#13** replaces `StubSmsProvider` with a Twilio implementation behind the same token, and runs `migrateDb()` at deploy time.
- The #6 review's deferred finding (unindexed `ledger_entries.ride_id` / `dispatch_audit_log.driver_id` FKs) belongs to **#10/#12**, not here — noted so it isn't lost.

### Confidence

**9.5/10** for one-pass success. The environment facts that usually cause spirals were verified at plan time rather than assumed: baseline gate green, strict-mode cost measured at zero, the Redis port conflict reproduced with its exact failure message, free ports identified, the compose path checked from `services/api`, and turbo's `^build` dependency called out as the top footgun.

The twelve risks in the register are each closed at a named task rather than merely noted, and the three that could otherwise have produced a silent wrong answer are closed **structurally** rather than by documentation: the stale-`dist` guard throws with its own remediation command, the api's test database has a different name so it cannot race, and the zod-major check fails at install time instead of inside a type error three files away.

The residual half-point stays on the socket integration test — jest plus live sockets plus room-membership timing. The `connectClient`/`closeClients` helpers (Task 19) are the pre-written answer, which is the same "deterministic fallback in the plan" pattern that turned #6's two riskiest interactions into non-events, but this one is genuinely new ground in this repo rather than a copy of a proven setup.

## AMENDMENTS

<!-- newest at the bottom; leave empty until this plan has been executed -->
