# Code Review — PR #34

**`feat(api): SMS-OTP auth with JWT role guards and a JWT-gated Socket.IO gateway`**
Branch `feature/api-auth-realtime-gateway` → `main` · 63 files · +5657 / −36 · Closes #7 · Epic #1

Two independent passes: the `code-reviewer` agent over every changed file, plus a fresh-context review
with live validation and two runtime probes. Rubric = `CLAUDE.md`, `services/api/CLAUDE.md`,
`packages/shared/CLAUDE.md`, `.claude/references/{realtime-events,logging-standard}.md`. The **13
documented deviations** in `.claude/reports/api-auth-realtime-gateway-report.md` are intentional
decisions and are **not** counted as issues below.

## Summary

Security-literate work, and the hard parts are right: hashed-at-rest codes, `crypto.randomInt`,
`timingSafeEqual` with its length precondition explicitly guarded, a race-safe `findOrCreate` upsert,
one indistinguishable rejection for wrong-vs-expired, and a privilege-escalation defence that is a
deliberate *omission* (`role` absent from the conflict `SET`) with a comment telling the next person not
to undo it. The realtime slice's "no client-initiated join API exists at all" is the right shape —
structural, not merely refused.

One thing blocks merge. **The OTP attempt counter is a non-atomic read-modify-write, and under
concurrency the 5-guess cap becomes a no-op** — reproduced below. It is the only brute-force defence on
the verify endpoint.

**Worth stating up front, because it changes who owns the fix:** findings 1, 2 and 3 were all
*prescribed by the plan* — `.claude/plans/api-auth-realtime-gateway.md:687` (increment before the
cooldown check), `:699` (the read-modify-write on `attempts`), `:578` (`INCR` then `EXPIRE`). The
implementation followed the plan faithfully; the plan was wrong about Redis atomicity in three places.
That is a plan correction, not a rework, and a signal for `system-evolution-review`.

## Issues

### Critical

**1 · The 5-attempt burn cap does not survive concurrency — parallel brute force is unbounded within a code's 5-minute life**
`services/api/src/features/auth/auth.service.ts:145-180`

`verifyOtp` reads the record, compares, then writes back `attempts + 1` across three `await` boundaries:

```ts
const raw = await this.kv.get(codeKey(phone));       // :145
const record = JSON.parse(raw) as OtpRecord;         // :155  attempts: 0
…
const attempts = record.attempts + 1;                // :166
const remaining = await this.kv.ttl(codeKey(phone)); // :172
await this.kv.setWithTtl(codeKey(phone), JSON.stringify({ ...record, attempts }), remaining); // :174
```

The store underneath is plain `GET`/`SET` (`common/kv/redis-kv.store.ts:13-23`) — no `WATCH`/`MULTI`,
no Lua. N concurrent verifies all read `attempts: 0` and all write `attempts: 1`, so the counter tracks
*waves*, not guesses. And it is the **only** throttle on this endpoint: `auth.controller.ts:29-36` has
no rate-limit decorator and `app.module.ts:14-20` registers no `ThrottlerGuard`
(`grep -rn Throttler services/api/src` → nothing).

**Reproduced**, not inferred — the real `AuthService` against a real `RedisKeyValueStore`
(`redis://localhost:6381`), stub repo/SMS, the same 50 wrong guesses fired both ways:

```
SEQUENTIAL : code survived 4 wrong guesses before it was burned      ← cap works
CONCURRENT : 50 wrong guesses fired in parallel
             record after = {"hash":"a9d0…caa","role":"rider","attempts":1}
             correct code still accepted afterwards? YES — cap defeated
```

Fifty guesses register as **one** attempt, the code stays live, and the correct code still yields a
session.

**Failure scenario.** Attacker requests one code for a victim's phone (one SMS, plausibly ignored), then
fires concurrent `POST /auth/otp/verify` guesses for the remaining ~300 s against a `10^6` space
(`otp.policy.ts:5`). At ~100 concurrent guesses/s that is ~30 000 guesses ≈ **3 % per code**, repeatable
with each of the 5 codes/hour, and it scales linearly with concurrency. The intended bound is 5. Since
the OTP *is* the credential, this is account takeover of any account whose phone number is known.

*Severity note:* graded Critical rather than High because the probe shows the cap is not merely weakened
under sustained load — it collapses completely in a single burst, with no other throttle behind it.

**Fix.** Move `attempts` out of the JSON blob into its own key and count it with the atomic primitive
the port already exposes — `incrWithTtl` (Redis `INCR`, `kv.store.ts:14`); no new port method needed.
Two lifecycle requirements come with it: delete `otp:attempts:<phone>` alongside the code key on success
(`:194`) *and* on burn (`:168`), or a reissued code inherits stale attempts; and give it the code's
**remaining** TTL, not a fresh 300 s. A `ThrottlerGuard` on both auth routes is worth adding regardless,
but that is defence in depth, not the fix.

**Test note.** `auth.service.spec.ts:151-165` — *"burns the code after the attempt cap"* — walks a serial
`for` loop with `await` on every iteration, and `InMemoryKeyValueStore` (`test/harness.ts:15-73`) is
driven serially, so the spec cannot express this race by construction. The test is correct about what it
asserts; it just can't reach the path that breaks. A regression test wants `Promise.all` over N guesses
and an assertion that at most `OTP_MAX_VERIFY_ATTEMPTS` were counted.

### High

**2 · The hourly cap counts requests, not SMS — five taps lock a phone out for an hour, and anyone can do it to any number**
`services/api/src/features/auth/auth.service.ts:69-98`

`incrWithTtl` runs *before* the cooldown check, so a request rejected with `resend_too_soon` — which
sends no SMS — still consumes an hourly slot:

```ts
const count = await this.kv.incrWithTtl(rateKey(phone), OTP_RATE_WINDOW_SECONDS); // :69
if (count > OTP_MAX_REQUESTS_PER_HOUR) …                                          // :73
const remaining = await this.kv.ttl(codeKey(phone));                              // :88 — cooldown
```

Both `:191-193` and `otp.policy.ts:9` describe this key as the SMS-spend cap. The code caps requests.
The `sms.sendOtp` failure path (`:116-126`) has the same shape: a provider outage returns 502 having
already spent a slot *and* written the code key with a full 300 s TTL.

- A user who taps "resend" four times in the first minute is locked out of sign-in for the rest of the
  hour after exactly **one** SMS was delivered — on the one screen that can't afford a bad first run.
- Anyone who knows a Latvian mobile number denies that number OTP login for an hour with 5 requests in
  ~1 second. With the cooldown checked first, the same attack needs 60 s between requests (5 minutes
  minimum) and costs 5 real SMS.

**Fix.** Evaluate the cooldown before incrementing, or increment only on the path where `sms.sendOtp`
actually resolves.

### Medium

**3 · `INCR` then `EXPIRE` is not atomic — a crash between them locks a phone out permanently**
`services/api/src/common/kv/redis-kv.store.ts:33-37`

```ts
const n = await this.redis.incr(key);
if (n === 1) await this.redis.expire(key, ttlSeconds);
```

Because `EXPIRE` is guarded by `n === 1`, a key that survives without an expiry never gets one:
every later `INCR` returns ≥ 2, the counter climbs past `OTP_MAX_REQUESTS_PER_HOUR` forever, and that
phone can never request another code. `ttl()` maps Redis's `-1` (no expiry) to `0` via `Math.max`, so
nothing detects it. There is no in-code recovery — it needs a manual `redis-cli DEL`.

**Fix.** One atomic operation: a small Lua script, or `SET key 0 EX <ttl> NX` then `INCR` in a `MULTI`.

**4 · `StubSmsProvider` is wired unconditionally, with no production guardrail**
`services/api/src/features/auth/auth.module.ts:31` · `sms/stub-sms.provider.ts:14-25`

The stub-until-#13 scope is fine and documented, and logging the code in full is a deliberate, commented
dev choice. The gap is that `useClass: StubSmsProvider` has no `NODE_ENV` condition. Any deployment that
reaches an internet-facing environment before #13 — a staging box, an early Railway deploy — delivers no
SMS at all and hands full sign-in to anyone with log read access.

**Fix.** Make the registration a `useFactory` that throws at boot when `env.NODE_ENV === 'production'`
and no real provider is bound. Cheap, and it makes "the stub is dev-only" structural rather than
conventional.

**5 · The committed example secret satisfies the only validation the schema applies**
`.env.example:13` · `services/api/src/common/config/env.schema.ts:10`

`JWT_SECRET=dev-only-change-me` is 18 characters, so `z.string().min(16)` accepts it. A
`cp .env.example .env` that reaches a real environment leaves the signing key published in the
repository. The stakes are higher than impersonation: `jwt-auth.guard.ts:45` and `roles.guard.ts:27`
take `role` entirely from the token with no database re-check, so anyone holding the secret mints an
`admin` token directly — role escalation, not just account takeover. (The 30-day expiry with no
revocation, already flagged as Open Question 4 in the report, means there is no way to cut it short.)

**Fix.** A `superRefine` on `JWT_SECRET` rejecting the known dev value — and ideally anything under
~32 chars — when `NODE_ENV === 'production'`.

**6 · The Socket.IO server has no CORS configuration; `app.enableCors()` does not reach it**
`services/api/src/features/realtime/realtime.gateway.ts:45` · `redis-io.adapter.ts:26-30` · `main.ts:10`

`@WebSocketGateway()` is declared with no options, and `RedisIoAdapter.createIOServer` forwards
`super.createIOServer(port, options)` untouched (it only attaches the Redis adapter), so no `cors` value
ever reaches the Socket.IO server — and Socket.IO v4 ships CORS **disabled** by default.
`app.enableCors({ origin: env.CORS_ORIGINS })` configures Nest's Express adapter, but engine.io
registers its own `request` listener on the same `http.Server` and intercepts `/socket.io/*` before
Express middleware runs.

Nothing is broken today — this PR ships no web client. But `socket.io-client`'s default transport list
starts with polling, so the first browser surface to connect (#8's dispatch console on `:3000`, which is
exactly what `dispatchRoom` exists for) will fail its handshake, and it will look like an auth failure
rather than a CORS one. `test/harness.ts:161` pins `transports: ['websocket']`, which is exempt from
CORS — so the gateway specs are blind to this by construction and won't catch it later either.

**Fix.** Pass `cors: { origin: env.CORS_ORIGINS }` through `createIOServer` in `RedisIoAdapter` (the one
place with env access at server-construction time). `CORS_ORIGINS` is already parsed into an array by
`env.schema.ts:15-23`.

**7 · `language: row.language as Language` is a cast over an unvalidated column**
`services/api/src/features/auth/auth.repository.ts:14`

`db/src/schema/users.ts:10` declares `language` as plain `text` with a `'lv'` default — no pg enum, no
`CHECK` — so nothing at the database level restricts it to `LANGUAGES`. The cast asserts a union the row
cannot guarantee. Concrete failure: an off-enum value makes `authSessionSchema.parse`
(`auth.service.ts:207`) throw a `ZodError` that surfaces as a **500 on sign-in**, not a handled error.
Not reachable today (nothing writes the column yet), which is why it's Medium and not High — but the
project rule is that types derive from schemas, and this is the one place a hand-written cast stands in
for one.

**Fix.** Parse it — `z.enum(LANGUAGES).catch('lv').parse(row.language)` — or migrate the column to a pg
enum so the cast becomes true.

**8 · The realtime slice reaches around the auth slice's public API**
`services/api/src/features/realtime/realtime.gateway.ts:15` · `realtime.module.ts:2`

```ts
import { AuthTokenService } from '../auth/auth-token.service';   // gateway:15
import { AuthModule } from '../auth/auth.module';                // module:2
```

Both symbols are exported from `features/auth/index.ts:2-3`, which the root `CLAUDE.md` designates as
the slice's public API ("`index.ts` is the slice's public API"). No import cycle forces the deep path —
`auth/index.ts` pulls in nothing from `realtime`. The slice's own `index.ts` file even opens with
*"nothing outside imports past this file."*

**Fix.** Import both from `'../auth'`. (The spec files' deep imports are fine and should stay — a test
importing the internals under test is defensible, and `auth.integration.spec.ts:16` is inside its own
slice.)

**9 · `JWT_SECRET` doubles as the OTP hash pepper — which makes rotating it a silent outage**
`services/api/src/features/auth/auth.service.ts:59-63`

```ts
createHash('sha256').update(`${code}${this.env.JWT_SECRET}`).digest('hex')
```

One secret serving two cryptographic purposes, via plain concatenation rather than an HMAC. Not
presently exploitable — the digest never leaves the server, so length-extension has no path — but it
couples two rotation lifecycles, and **that is the part that bites finding 5**: the remediation there is
"replace the dev `JWT_SECRET`," and doing so invalidates every OTP in flight. Every user mid-login gets
`invalid_or_expired_code`, which by design (correctly) tells them nothing, so the failure is
indistinguishable from a wrong code and there is no signal pointing at the rotation. Same hazard on any
future rotation after a suspected leak — exactly when you least want an unexplained sign-in outage.

**Fix.** A separate `OTP_PEPPER` in `env.schema.ts`, or `createHmac('sha256', pepper).update(code)`.
Then rotating the JWT key touches tokens only.

### Low

**10 · Two robustness gaps** *(grouped — neither is reachable today)*
- `auth.service.ts:155` — `JSON.parse(raw) as OtpRecord` is an unchecked cast. A truncated or foreign
  value makes `record.hash` `undefined` and `Buffer.from(undefined, 'hex')` at `:161` throw a
  `TypeError` → 500 on verify instead of the intended 401. A four-line zod schema for `OtpRecord`,
  treating a parse failure as the same `REJECTED` path as a missing key, closes it.
- `roles.guard.ts:26` — `ctx.switchToHttp().getRequest()` with no context-type check. Safe today only
  because `JwtAuthGuard` refuses non-HTTP contexts first (`jwt-auth.guard.ts:31`) — but that guard's
  `@Public()` early return at `:24` precedes the context check, so a future `@Public()` + `@Roles()`
  non-HTTP handler would reach `RolesGuard` and crash on `undefined.user`. A contradictory combination,
  hence Low; a `ctx.getType() !== 'http'` guard is one line of insurance.

**11 · Logging taxonomy drift**
`auth.service.ts:75,129` · `realtime.gateway.ts:74,97`

Against `.claude/references/logging-standard.md:5-7`:
- `auth.otp.throttled` and `auth.otp.requested` are bare participles; `action_state` is verb + state
  (`request_throttled`, `request_completed`) — which `send_failed` and `verify_rejected` get right in the
  same file.
- `realtime` is used as a domain but is not in the enumerated set (`ride | dispatch | payment | auth |
  driver | geo | support`).

**Fix.** Rename the two events, and either add `realtime` to the standard's domain list or emit under
`driver`/`dispatch`. Consistency rather than correctness — but the taxonomy is only worth having if it
holds from the first slice.

## Validation

Run at true CI parity — `pnpm turbo run typecheck lint test build --force` from a **cleared `dist`**
(`packages/shared`, `db`, `services/api`), with `REDIS_TEST_URL` set so the opt-in Redis suite actually
runs rather than skipping.

| Gate | Result |
|---|---|
| `typecheck` | **pass** |
| `lint` | **pass** — 0 errors, 1 warning (`no-unsafe-argument` on supertest's `getHttpServer()`, `auth.integration.spec.ts:47`) |
| `test` | **pass** — 34 api (7 suites, incl. both Redis-adapter tests) · 85 shared · 14 db |
| `build` | **pass** |
| **Total (local)** | **18/18 turbo tasks, 0 cached** |
| **GitHub Actions on `5d91698`** | **pass** — run [30941860510](https://github.com/linardsb/taxi/actions/runs/30941860510), 2m02s |

The PR body reports "green, 15/15" — that predates commit `27a4878`, which added `dependsOn: ["^build"]`
to turbo's `lint` task. 18/18 from cold is the stronger number; no discrepancy, just a newer gate. CI's
own history on this branch confirms the fix landed: the run before `27a4878` failed, both runs after it
pass.

Three things verified rather than assumed:
- `test/global-setup.ts:33-36` drops `${TEST_DB_NAME}`, a hardcoded `taxi_api_test` constant
  (`test/test-db.ts:10`) never derived from `DATABASE_URL`. It cannot resolve to the dev database.
- Migration `0003` is complete and live. `grep '\$onUpdate' db/src/schema/` returns nothing, so no table
  is left on the app-clock path; against the migrated database both triggers exist
  (`platform_config_set_updated_at`, `rides_set_updated_at`) and an `UPDATE` that never mentions the
  column still advances it — `19:25:44.867Z` → `19:33:58.586Z`. The database owns the clock, as claimed.
  The snapshot chain links correctly (`0003_snapshot.prevId` = `0002_snapshot.id`), no backfill is
  needed since `defaultNow()` on insert is unchanged, and `DROP TRIGGER IF EXISTS` makes it re-runnable.
- A dedicated vacuity pass over the specs found nothing: every `.rejects` carries a matcher, the throttle
  test's clock math (`auth.service.spec.ts:104-118` — 5 × 301 s stays inside the 3600 s window) actually
  reaches the cap, the TTL test at `:167-180` genuinely bites, and `kv.advance(400)` at
  `auth.integration.spec.ts:113` stays inside the rate window.

## What's good

- **The privilege-escalation defence is in the right layer and asserted both ways.**
  `auth.repository.ts:46-56` blocks it by *not* putting `role` in the conflict `SET`, uses
  `onConflictDoUpdate` with a no-op set precisely because `onConflictDoNothing().returning()` returns
  `[]`, and leaves a comment telling the next person why they must not "fix" it. Race-safe and
  escalation-safe in one statement — and tested at the schema
  (`packages/shared/tests/auth.test.ts:24`) *and* end-to-end against real Postgres
  (`auth.integration.spec.ts:119-139`, which checks the row, the response body **and** the minted claim).
- **`timingSafeEqual` used correctly**, which is rare — both sides hashed first so lengths always match,
  *and* an explicit length guard before the call (`auth.service.ts:160-165`).
- **Wrong-code and no-code are genuinely indistinguishable** — one `REJECTED` constant, and
  `auth.service.spec.ts:182-199` asserts equality of status *and* response body across both paths. Most
  implementations claim this and leak it in the body.
- **Fail-closed guards are correct by construction.** `jwt-auth.guard.ts:20-23` and `roles.guard.ts:20-24`
  both use `getAllAndOverride(key, [getHandler(), getClass()])` — handler-first, absent metadata falsy,
  so the default path is the token check. The ordering claim in `app.module.ts:16-19` is empirically
  pinned by `auth.integration.spec.ts:172-199`, which separates 401 (no/junk/wrong-scheme) from 403
  (valid token, wrong role).
- **`JwtAuthGuard` refuses non-HTTP contexts outright** (`:31-32`) instead of the usual silent
  `switchToHttp()` → `undefined` → wave-through, with a comment naming #8 as the ticket that would
  otherwise have opened the hole.
- **No query-string token fallback in the handshake.** `realtime.gateway.ts:63-65` reads only
  `handshake.auth.token` and the `Authorization` header — tokens stay out of access logs and Referer
  headers, which is the mistake most Socket.IO auth middleware makes.
- **Impersonation via a crafted `sub` is structurally closed.** `room-policy.ts:19-20` derives every room
  from `user.sub` itself, so a socket can only reach rooms named after its own subject; there is no room
  parameter a client can supply. `roomsOnConnect` is `[all candidates].filter(canJoin)` — deny is the
  default, and adding a room can't accidentally widen access.
- **The realtime threat model is written into the types.** `ClientToServerEvents` payloads are `unknown`
  on purpose, with a comment explaining that a typed payload would let a handler read unvalidated client
  JSON while the type system implies it was checked.
- **`RT_EVENT_SCHEMAS` + `RealtimeService.emit`'s `.parse()`** turns the ISO-string wire rule from a
  comment in `realtime-events.md` into something that throws at the emit site — the right place to spend
  a runtime check. The `@ts-expect-error` at `realtime.gateway.spec.ts:125-126` carries its reason, and
  the reason is good: it asserts the runtime backstop fires where the type system already refuses.
- **Contracts stayed where they belong.** `OtpRecord` (internal Redis shape) and
  `SocketData`/`AuthedSocket` (api-local socket.io generics) are correctly *not* in `@taxi/shared`; every
  wire type is `z.infer`'d with no hand-written twins; `shared` still imports nothing from the workspace;
  `.claude/references/realtime-events.md:19-24` was updated in the same change.
- **The report is unusually honest** — Issues 1 and 5 document three wrong diagnoses and a CI gap the
  local gate could not see, with corrected measurements. That is what makes the 13 deviations
  trustworthy.
- Standards compliance is otherwise clean: slices own their routes/service/tests, every file well under
  500 lines, no socket-event string literals, phone masked in every log line, the SMS provider reached
  only through the `SmsProvider` seam with no Twilio SDK anywhere. `assertTransition()` and the
  integer-cents rule have no touchpoint in this diff.

## Recommendation

**Request changes** — for finding **1**.

Finding 1 is a reproducible authentication bypass in the slice whose entire job is authentication, and
the fix is contained: make the attempt counter atomic. Finding 2 is a one-line reorder worth taking in
the same pass since it touches the same method. Findings 3–11 are reasonable follow-ups — 6 should land
before #8 wires up the dispatch console, and 4, 5 and 9 before anything is deployed anywhere public
(take 5 and 9 together: rotating the secret without splitting the pepper first is itself an outage); all
would be fine as their own issues rather than holding this PR.

None of this reflects on the shape of the work, which is good — and 1, 2 and 3 came from the plan, not
from the implementation. It is one missing atomic operation in an otherwise careful slice.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 1 |
| Medium | 7 |
| Low | 2 |

Suggested next step: `piv-fix-review-findings` on this report for 1 + 2, re-run
`pnpm turbo run typecheck lint test build --force`, then push. The plan-defect angle on 1/2/3 belongs in
`system-evolution-review`.

---
*Reviewed by the `code-reviewer` agent plus a fresh-context pass. Validation re-run locally at cold-dist
CI parity; findings 1 and the `0003` trigger confirmed with runtime probes. A human makes the final call.*
