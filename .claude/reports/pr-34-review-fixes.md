# Fix Report — PR #34 review findings

Input: `.claude/code-reviews/pr-34-review.md` (11 findings — 1 Critical, 1 High, 7 Medium, 2 Low).
Branch `feature/api-auth-realtime-gateway`. Commits `96f067f` (fixes) and `a3dbdc4` (one added assertion).

## Triage

| | Findings | Where |
|---|---|---|
| **Fixed now** | 1, 2, 3, 8 | `96f067f`, `a3dbdc4` |
| **Deferred** | 4, 5, 6, 7, 9, 10, 11 | issue [#35](https://github.com/linardsb/taxi/issues/35) |
| **Needs your call** | 11's domain-list decision · finding 2's residue | below |

The review recommended 1 + 2 only. 3 rode along because it is the same primitive the new counter
uses and the fix is six lines; 8 because it is a two-line, zero-risk `CLAUDE.md` rule violation.

## Fixed

### 1 · The 5-attempt cap did not survive concurrency — Critical

`attempts` was a read-modify-write on the JSON record across three `await` boundaries, so a
concurrent burst all read `attempts: 0` and all wrote back `1`. It was the only brute-force defence
on `/auth/otp/verify`.

Attempts moved to their own `otp:attempts:<phone>` key, incremented with the atomic `incrWithTtl` the
port already exposed. The load-bearing decision the review's fix text left open: **the increment
happens before the comparison, not after.** Counting afterwards is equally atomic and produces an
accurate counter, but bounds nothing — every request in a burst reaches `timingSafeEqual` before the
first increment lands, so the cap would limit waves rather than guesses.

Lifecycle: the counter carries the code's *remaining* TTL (never a fresh window), a `burn()` helper
deletes code and counter together on success and on cap, and `requestOtp` clears the counter when it
issues a new code — a new secret gets a fresh guess budget, and a stale counter becomes structurally
impossible rather than merely unlikely. A code that expired between the read and the TTL lookup takes
the same rejection path as a missing one. The over-cap rejection reuses the single `REJECTED`
constant; a distinct status there would have told an attacker their guesses were landing on a live
code, undoing the indistinguishability the review specifically praised.

**Tests.** Two, both in `auth.service.spec.ts`:
- 50 parallel wrong guesses, then the correct code must be rejected — *fails pre-fix* (the correct
  code minted a session, exactly the review's probe).
- of those 50, at most `OTP_MAX_VERIFY_ATTEMPTS` reached the comparison. This is the one that pins
  the design: verified by moving the increment below the compare, where it reports **50** and goes
  red while the burn assertion stays green. Without it a refactor could silently revert the property.

**Probed live**, not just under jest: API booted against real Postgres and real Redis, 50 concurrent
`POST /auth/otp/verify`. Exactly **5** comparisons per phone, `otp:code:` and `otp:attempts:` both
gone, correct code rejected afterwards, only the hourly `otp:rate:` counter surviving as intended.

### 2 · The hourly cap counted requests, not SMS — High

The cooldown is now evaluated before the increment, so a `resend_too_soon` — which sends nothing —
no longer spends a slot. Five taps of "resend" used to lock a phone out of sign-in for an hour.

> **Corrected in round 2.** This section originally also claimed the abuse half was closed — that
> "anyone who knew a number could do it in about a second" was now past tense. It was not: the
> cooldown was derived from the code key's TTL, and the attempt cap deletes that key, so five wrong
> guesses bought a free resend. Measured at 5 SMS and an hour-long lockout in under a second. The
> error came from round 1 (`pr-34-review.md:110-112`) and was inherited here. Closed properly by the
> round-2 pass below, which gives the cooldown its own key.

The increment deliberately stays *before* `sms.sendOtp` rather than moving after it: incrementing
only on success would mean a GET-then-INCR check, and a burst would then all read the same count and
every one of them would send a real SMS. See the residue note below.

**Test.** Request → rejected resend → four more spaced requests must all succeed (5 SMS). Pre-fix the
fourth throws 429.

### 3 · `INCR` then `EXPIRE` is not atomic — Medium

Replaced with one Lua script. It also heals: the guard is `TTL < 0`, which covers both the counter
this call just created and one an earlier crash left without an expiry, so a stuck key recovers on
its next increment instead of needing a manual `redis-cli DEL`. (`SET k 0 EX ttl NX` + `INCR` in a
`MULTI` — the review's suggestion — is atomic but has no such recovery: `NX` skips the `SET` and the
key stays immortal.)

**Tests.** `redis-kv.store.spec.ts`, opt-in behind `REDIS_TEST_URL` like the adapter spec. Being
straight about which prove what: the two contract tests (first increment starts the window; a later
one never extends it) **pass pre-fix** — they document the contract, they don't catch the bug. Only
the third, which hands the store a counter that already lost its expiry, fails pre-fix. The actual
defect — a crash landing between `INCR` and `EXPIRE` — is not reproducible without fault injection,
so no test covers the window itself; the fix closes it by construction.

### 8 · The realtime slice reached around the auth slice's public API — Medium

`realtime.gateway.ts` and `realtime.module.ts` now import from `'../auth'`. Spec files' deep imports
left alone, as the review advised. The live boot confirms the barrel resolves at runtime — Nest is
where circular barrel imports usually surface, and it started clean.

## Round 2 — fixing the fix

`.claude/code-reviews/pr-34-review-round2.md` reviewed this pass and found six items. Five were
fixed; one was logged.

**M2 (High) — the cooldown is its own key now.** `otp:cooldown:<phone>`, 60 s, set only when
`sms.sendOtp` resolves and deliberately *not* deleted by the burn. A successful verify does clear it,
which keeps today's UX and is safe: clearing it takes the correct code, so only the phone's real owner
can — precisely what the burn path cannot do. Setting it after the send also shrinks finding 2's
logged residue, since a provider outage no longer blocks the retry. Re-ran the attack that reproduced
it: **1 SMS and 1 hourly slot**, down from 5 and 5. The lockout now genuinely costs 5 minutes.

**M1 (Medium) — `burn()` no longer deletes the attempt counter.** The counter *is* the cap, so
deleting it with the code let a request already past the TTL gate increment a deleted key, read back
1, and win a fresh budget. One line removed; the counter now expires on its own and `requestOtp`
still clears it on reissue, so nothing goes stale. The bound is structural rather than timing-derived.

**M3, M4, L2 (tests).** The burst assertion is `toBe(5)` rather than `toBeLessThanOrEqual` — it used
to pass at 0, so a regression that crashed all 50 guesses would have read as green — and `rejection()`
now refuses anything that isn't an `UnauthorizedException` instead of casting. The counter's TTL and
its reissue reset are asserted, which is also what makes the previously vacuous TTL spec earn its keep.
The `Logger` spy is restored in a `finally`.

Both new regression tests were verified against a reverted fix: reinstating the counter deletion makes
the straggler test report 6 comparisons instead of 5, and restoring the TTL-derived cooldown makes the
burn test go red. M1's window is one round trip, so the interleaving is constructed with a pausable
KV double rather than raced — 200 staggered live guesses had failed to reproduce it.

**L1 — deferred to #35.** A `ThrottlerGuard` on the auth routes. Named in round 1's finding-1
remediation as worth having regardless, it fell between "fixed" and "deferred" with no record.

## Round 3 — the cooldown was still bypassable, concurrently

`.claude/code-reviews/pr-34-review-round3.md` is an independent adversarial pass over the whole thing. It
found **one** issue, and it is the same attack round 2 measured, reached by a different route.

> **Corrected again.** The round-2 note above claims "**1 SMS and 1 hourly slot**, down from 5 and 5. The
> lockout now genuinely costs 5 minutes." That was measured on the *sequential* burn-then-resend path, which
> is genuinely closed. The **concurrent** path was never tried, and it was still wide open: the new cooldown
> key was read at `:97` and not written until `:153`, four awaits later, so five simultaneous requests all
> read 0, all passed, and all sent. Measured through the production wiring (real `AppModule`, real Redis, 5
> concurrent `POST /auth/otp/request`): `[200,200,200,200,200]`, **5 real SMS, `otp:rate=5`** — verbatim the
> impact the fix was written to remove. Pre-existing, not a regression: the pre-`5b0ab8b` cooldown had the
> same read-then-act shape.

**H1 — the cooldown is CLAIMED with INCR, not read-then-set.** The same primitive, and the same reasoning,
that the guess counter already used; the comment at `:42-48` stated it and it simply had not been applied
here. Three release paths keep the key meaning exactly "an SMS was just delivered": the send failing (which
preserves the deliberate decision that a provider outage must not block the retry), and the hourly cap
rejecting (which sends nothing either). `Math.max(1, ttl)` on the rejection, since the key can expire between
the INCR and the read and a `retryAfterSeconds: 0` reads as "retry now".

Re-measured after the fix, same layer: `[200,429,429,429,429]`, **1 real SMS, `otp:rate=1`**, and the
delivered code still signs in with a 200.

**M1 — the concurrent request path had no test, which is why this survived two rounds.** Every `requestOtp`
spec was sequential, including round 2's own regression test for the burn path. Applying the fix changed no
test outcome — 43/43 before and after — which was the tell. Added: a 5-wide `Promise.allSettled` burst
asserting one fulfilled, one SMS, and `otp:rate = 1`. Plus one for the release path (the send fails → the
next request is not blocked), and a cooldown assertion on the existing hourly-cap spec.

**M2 — the burst test counted log lines, not comparisons.** `compared` was the number of `wrong_code`
warnings, a proxy for "reached `timingSafeEqual`" that only holds while the cap check sits between the
increment and the log. An ordering that compares eagerly and increments straight after lets all 50 guesses
compare while still logging 5 — verified green under exactly that mutant. Both burst specs now count the
comparison itself. `jest.spyOn` cannot attach (the `node:crypto` export is non-configurable), so the module
is wrapped with `jest.mock` and everything but `timingSafeEqual` passes through untouched.

**All five fixes verified by mutation**, each reverted individually against the new specs:

| Mutation | Result |
|---|---|
| cooldown back to read-then-set | burst spec red — `Expected 1, Received 5` |
| compare eagerly, increment after | burst spec red — `Expected 5, Received 50` *(green before M2)* |
| `burn()` deletes the attempts counter | straggler spec red — `Expected 5, Received 6` |
| drop the release on SMS failure | outage spec red |
| drop the release on the hourly cap | hourly-cap spec red |

**L1/L2 — logged on #35, not fixed here.** The `resend_too_soon` rejection precedes the rate increment, so
probing is uncounted and distinguishes "this number requested a code in the last 60 s" — though probing a
*quiet* number sends a real SMS, so it mostly confirms what the probe itself caused. And the verify path
costs 1 KV round trip for a missing code against 3 for a wrong one. Neither is a merge gate; both belong with
the `ThrottlerGuard`. Round 3 confirmed the round-2 verdicts otherwise: the Lua script is correct for both
callers, `burn()`'s reasoning is sound, the cooldown genuinely cannot be cleared without the correct code,
`PausableKv` is a legitimate construction, and the realtime slice's handshake-auth and no-client-joins
invariants both hold.

## Validation

`pnpm turbo run typecheck lint test build --force` from a cleared `dist`, with
`REDIS_TEST_URL=redis://localhost:6381`:

| Gate | Result |
|---|---|
| typecheck · lint · test · build | **18/18 turbo tasks, 0 cached** |
| lint | 0 errors, 1 warning — the pre-existing `no-unsafe-argument` on supertest |
| api tests | **45 passed, 8 suites** (was 43 after round 2; 34 / 7 before any) |
| GitHub Actions on `cbc9f61` | **pass** — run [30946982601](https://github.com/linardsb/taxi/actions/runs/30946982601), 39 tests, 0 skipped |

**A coverage gap, found and closed here.** `.github/workflows/ci.yml` provided no Redis and set no
`REDIS_TEST_URL`, so both Redis suites skipped there — measured on run 30946495121: *2 suites
skipped, 5 tests skipped, 34 passed*. CI was running five fewer tests than the local gate, and
finding 3's fix had no CI coverage at all. Pre-existing, but the new spec inherited it.

`cbc9f61` adds a `redis:7-alpine` service container and the env var (already in turbo's `globalEnv`,
so strict env mode passes it through and it lands in the cache key). Plus a TCP check from the runner
before the gate: the service's own health check runs *inside* the container and would pass through a
wrong host port mapping, and a Redis the suites can't reach is a silent skip rather than a red build.

Confirmed on run [30946982601](https://github.com/linardsb/taxi/actions/runs/30946982601): **8 suites,
39 tests, 0 skipped** — CI now matches the local gate exactly.

## Needs a human look

- **Finding 11's taxonomy decision** (deferred to #35) is the one item that is not a mechanical fix:
  either `realtime` joins the domain list in `.claude/references/logging-standard.md`, or the gateway
  emits under `driver`/`dispatch`. The first edits a rules file, so it wants `rules-check-drift`
  rather than a quiet patch.
- **Finding 2's residue**, logged as a comment on #35: an SMS provider outage still spends a slot and
  writes the code key with a full TTL. A sustained outage burns all five hourly slots with nothing
  delivered — though after round 2 it no longer also blocks the retry, since the cooldown starts only
  on a delivered SMS. Best revisited with #13, where a real provider gives an error specific enough to
  distinguish "never sent" from "maybe delivered".
- **`auth.service.spec.ts` "does not extend the code TTL on a wrong guess" went vacuous.** Nothing
  rewrites the code key on a wrong guess anymore — the invariant is now structural rather than
  asserted. Kept, since it still pins the invariant against a future rewrite, but it no longer
  exercises the path it was written for.

## For `system-evolution-review`

The review's own framing: findings 1, 2 and 3 were all *prescribed by the plan*
(`.claude/plans/api-auth-realtime-gateway.md:687`, `:699`, `:578`). The implementation followed it
faithfully; the plan was wrong about Redis atomicity in three separate places. That is a plan defect,
not an implementation one, and the plan template is where the correction belongs.

Worth adding to that: the plan's error was not "forgot atomicity" but a subtler one the fix had to
resolve independently — even the review's own remediation text ("count it with `incrWithTtl`") does
not say *where* in the flow to increment, and the natural reading produces an atomic counter that
bounds nothing.
