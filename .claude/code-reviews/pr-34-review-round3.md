# Code Review — PR #34, round 3 (independent adversarial pass)

**`feat(api): SMS-OTP auth with JWT role guards and a JWT-gated Socket.IO gateway`**
Branch `feature/api-auth-realtime-gateway` → `main` · head `5b0ab8b` · Closes #7 · Epic #1

Brief: challenge the two prior rounds rather than confirm them, treat `.claude/reports/pr-34-review-fixes.md`
as unverified, and answer six specific questions about the OTP concurrency logic. Every claim below was
executed, not reasoned — probes were run against **real Redis (`:6381`) through the real Nest app**, then
deleted. Mutations were applied to `auth.service.ts`, measured, and reverted (`git checkout`); the tree is clean.

## Summary

**One finding, and it is the same attack round 2 measured.** `5b0ab8b` closed the *sequential* path — burning
a code no longer buys a free resend. It did not make the cooldown atomic, so the identical outcome is still
reachable **concurrently**: five simultaneous `POST /auth/otp/request` deliver **five SMS** and consume the
whole hourly budget in one round trip, after which the victim cannot sign in for the rest of the hour.

Measured through the production wiring (real `AppModule`, real controller, real guards, real Redis):

```
[PROBE H] statuses=[200,200,200,200,200]  REAL-SMS-delivered=5  otp:rate=5
[PROBE F] …61s later: victim's own request → "too_many_requests"   (recovers only when the hour rolls)
```

That is `5 SMS + 60 min lockout, in ~1 s` — verbatim the impact round 2 reported and `5b0ab8b` was written
to remove. Three artifacts currently assert otherwise (H1 below).

Everything else I was asked to break held up. The guess cap is sound, `burn()`'s reasoning is correct, the
cooldown genuinely cannot be cleared without the code, the Lua script is correct for both callers, and the
tests are real — `PausableKv` is a legitimate construction and the two headline regression tests both go red
under the mutations their reports claim.

## Issues

### High

**H1 · The resend cooldown is read-then-written, so a concurrent burst spends the entire hourly SMS budget at once**
`services/api/src/features/auth/auth.service.ts:97-103` (the check) · `:153-157` (the write)

`requestOtp` reads the cooldown and then performs four `await`s — the rate `INCR`, the code `SET`, the SMS
send — before it writes the cooldown. Every request in a concurrent burst therefore observes `cooldown === 0`
and passes. The atomic hourly counter behind it caps the burst at 5, but 5 *is* the whole budget, so the cap
becomes the attacker's payload rather than the defence.

**Failure scenario.** An attacker who knows a phone number opens 5 parallel `POST /auth/otp/request` for it:

| | | |
|---|---|---|
| Attacker cost | 5 unauthenticated HTTP requests, ~1 s | no account, no SMS of their own |
| Operator cost | 5 real SMS per number per hour | ×N enumerated numbers, against the <€100/mo guardrail |
| Victim cost | **cannot obtain a new code** until the 3600 s window rolls | repeatable every hour, indefinitely |

Stating the victim's position precisely, because the obvious objection is "didn't they just receive five
working codes?" They did — the burst goes to their real phone, and the last code written to `otp:code:` is
live for 300 s, with exactly 5 guesses to identify which of the 5 SMS it was. So the burst is not an instant
lockout. It bites in the two cases that matter: the attacker fires it while the victim is not signing in (the
normal case — the 300 s window lapses unused and no sixth code can be had for the hour), or the attacker
closes the window immediately with 5 wrong verify guesses, which burns the code at **zero SMS cost** and needs
no knowledge of it (PROBE D, measured). Either way the hour of denial is real; it just starts 5 minutes in
rather than instantly.

Verified at three layers. Service + `InMemoryKeyValueStore`: 5 accepted, 5 SMS. Service + **real Redis**:
5 accepted, 5 SMS, `otp:rate=5`. Full app over HTTP + **real Redis**: `[200,200,200,200,200]`, 5 SMS,
`otp:rate=5`. (Over HTTP with the in-memory double it does *not* reproduce — every double method resolves as
a microtask, so a handler runs to completion within one tick and never interleaves. Worth knowing: it means
the existing harness cannot see this class of bug at the HTTP layer at all.)

**The mechanism is pre-existing, not a regression.** Before `5b0ab8b` the cooldown was derived from
`ttl(codeKey)` — the same read-then-act shape — so the concurrent burst was always reachable and `5b0ab8b`
neither introduced nor widened it. Round 2 held itself to exactly this standard for M2 and it applies here
too. The blocking argument does not rest on this being new; it rests on three artifacts asserting a property
the code does not have.

**Why this is High and not a nitpick.** The comment at `:42-48` states the exact reasoning that makes it a
bug — read-modify-write plus a concurrent burst is why attempts had to be `INCR`-based. That reasoning was
applied to `otp:attempts:` and not to `otp:cooldown:`, which has the same shape. Three places assert the
property the code does not have:

- `auth.service.ts:49-54` — the cooldown key exists to stop "5 SMS and an hour-long sign-in lockout of any known number, in about a second." It does not stop it.
- `.claude/reports/pr-34-review-fixes.md:100` — "**1 SMS and 1 hourly slot**, down from 5 and 5. The lockout now genuinely costs 5 minutes." True of the burn-then-resend path that was re-run; the concurrent variant was never tried.
- **PR body** — "SMS spend is capped per phone (5/hour + 60s cooldown) … three separate Redis keys, each atomic." There are four keys now, and the cooldown one is the one that isn't atomic.

**Fix (verified).** Claim the cooldown slot with the same primitive the attempts counter uses, and release it
if the send fails — which preserves the deliberate decision at `:152-153` that a provider outage must not also
block the retry:

```ts
const claimed = await this.kv.incrWithTtl(cooldownKey(phone), OTP_RESEND_COOLDOWN_SECONDS);
if (claimed > 1) {
  // Math.max(1, …): the key can expire between the INCR and this read, and a
  // retryAfterSeconds of 0 would read as "retry now" on a rejection.
  const retryAfterSeconds = Math.max(1, await this.kv.ttl(cooldownKey(phone)));
  throw new HttpException(
    { message: 'resend_too_soon', retryAfterSeconds },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
// …and in the sms.sendOtp catch block, before the throw:
await this.kv.del(cooldownKey(phone));
```

Then delete the `setWithTtl(cooldownKey, …)` at `:153-157` — the slot is already claimed. Measured under this
patch: **`[200,429,429,429,429]`, 1 SMS, `otp:rate=1`** at the HTTP + real-Redis layer, and **all 43 api tests
still pass**, including every cooldown-lifecycle assertion round 2 added. Note the claim must stay *before*
the rate `INCR`, or a rejected resend starts spending hourly slots again (round-1 finding 2).

### Medium

**M1 · Nothing tests the concurrent request path, which is why H1 shipped**
`services/api/src/features/auth/auth.service.spec.ts:128-198`

Every `requestOtp` spec is sequential. `keeps the cooldown after the code is burned` (`:155-171`) is the
regression test for round 2's M2, and it exercises only burn-then-resend. Applying the H1 fix changes no test
outcome — 43/43 before and after — which is the tell: the property is unasserted in both directions. The
verify path got a 50-wide `Promise.all` burst test precisely because concurrency was the known hazard there;
the request path never got the same treatment.

**Fix.** Mirror the verify-side burst: `Promise.all` of 5 `requestOtp`, assert `sms.sent` is 1. It fails
pre-fix (5) and passes post-fix (1) — confirmed both ways.

**M2 · The burst test counts log lines, not comparisons, so part of the regression it pins stays green**
`services/api/src/features/auth/auth.service.spec.ts:268-283`

`compared` is the number of `reason: 'wrong_code'` warnings, used as a proxy for "reached `timingSafeEqual`".
The proxy holds only while the cap check sits between the increment and the log. It is genuinely load-bearing
for the natural regression — moving the increment into the wrong-code branch makes it report **50** (verified,
matching the fix report's claim exactly). But a variant that computes the comparison eagerly and increments
immediately after it —

```ts
const matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
const attempts = await this.kv.incrWithTtl(attemptsKey(phone), remaining);   // now below the compare
if (attempts > OTP_MAX_VERIFY_ATTEMPTS) { await this.burn(phone); throw new UnauthorizedException(REJECTED); }
if (!matches) { … }
```

— lets all 50 guesses reach `timingSafeEqual`, which is the security property broken, while the cap check
still filters the log down to 5. **Measured: 15/15 green.** The invariant is "how many comparisons happened";
the assertion should count those directly (a `jest.spyOn` on the compare, or a counter the service increments
next to it) rather than inferring them from logging that a refactor may reorder.

### Low

**L1 · `resend_too_soon` precedes the rate increment, making "is this number mid-sign-in?" observable**
`services/api/src/features/auth/auth.service.ts:97-103`

The cooldown rejection is returned before any counter moves, so probing is uncounted: **200 probes left
`otp:rate=1` and sent 0 extra SMS** (measured). A number in cooldown answers `429 resend_too_soon` with
`retryAfterSeconds`; a quiet one answers `200`. That distinguishes "this person requested a code in the last
60 s" from "they didn't".

Honest limit on severity: probing a *quiet* number sends a real SMS and spends a slot, so an attacker cannot
poll cheaply until the victim is already in cooldown — the oracle mostly confirms what the attacker's own
probe caused. It is also **not** a contradiction of `packages/shared/src/schemas/auth.ts:20` ("no enumeration
oracle"); that claim is about *user existence* and remains true — rows are created at verify, and both known
and unknown numbers get the identical `200` body. Worth a line in #35, not a merge gate.

**L2 · Verify-path round-trip asymmetry distinguishes "a live code exists" from "none"**
`services/api/src/features/auth/auth.service.ts:176-200`

Instrumented KV op counts per rejection class:

```
no-code    1 op   [get otp:code:…]
wrong      3 ops  [get otp:code:…, ttl otp:code:…, incr otp:attempts:…]
over-cap   1 op   [get otp:code:…]     ← the code was already burned at attempt 5
```

Status (`401`) and body (`invalid_or_expired_code`) are identical across all three — **question 4 passes on
status and body**. The residue is timing: ~2 extra Redis round trips plus two sha256 digests on the wrong-code
path. Sub-millisecond and noisy over a network, and it leaks strictly less than L1. Also note the "over-cap"
class is nearly unreachable in practice: `:230` burns at `attempts >= 5`, so the 6th request takes the
no-code path. Recording it because it was asked about, not because I would act on it.

**L3 · PR body claim the code does not support**
"three separate Redis keys, each atomic" — there are four (`otp:code:`, `otp:rate:`, `otp:attempts:`,
`otp:cooldown:`), and `otp:cooldown:` is the read-then-write in H1. The rest of the PR body's validation
numbers I re-measured and they are accurate (18/18 tasks, 43 api tests, 0 skipped, 1 pre-existing warning) —
round 2's staleness complaint has been addressed.

## The six questions, answered

**1 · Can more than 5 guesses reach `timingSafeEqual`?** No, and the increment-before-compare ordering is
sufficient. `attempts > 5` rejects before the compare, and the counter is `INCR`, so a burst cannot share a
read. The two theoretical re-arm paths are both bounded: `requestOtp:132` clears the counter, but requests are
themselves capped at 5/hour, so the ceiling is ~25 guesses/hour against a 10⁶ space; and an in-flight guess
straddling a reissue gets at most one extra comparison against a code that has already been overwritten.
Measured: 50 concurrent guesses → exactly 5 comparisons.

**2 · Is `burn()` deleting only the code key sound, or does it strand a counter?** Sound, and the reasoning in
the comment at `:71-78` is correct. The counter must outlive the code it bounds, and it cannot go stale
because `requestOtp:132` clears it on every reissue and it carries the code's remaining TTL otherwise. I
verified the claim rather than accepting it: **re-adding `del(attemptsKey(phone))` to `burn()` makes the
straggler test report 6 comparisons instead of 5** — exactly what `pr-34-review-fixes.md:113-116` says it does.

**3 · Can the cooldown be cleared without knowing the code?** No. `kv.del(cooldownKey)` appears once
(`:247`), after `timingSafeEqual` has already passed. The claim holds as written. The weakness is not that the
cooldown can be *cleared* — it is that it can be *bypassed by concurrency* before it is ever set (H1).

**4 · Are wrong / expired / over-cap indistinguishable?** Status and body, yes — all three throw the single
`REJECTED` constant as a `401`, and `auth.service.spec.ts:366-383` asserts it. Timing, no: see L2. The
practically useful oracle is L1 on the *request* route, not this one.

**5 · Is the Lua script correct Redis, and correct for both callers?** Yes to both. After `INCR` the key always
exists, so `TTL` returns `-1` (no expiry) or `≥0`, and `< 0` correctly covers both "just created" and "orphaned
by a crash" — self-healing, and strictly better than the `MULTI`/`SETNX` it replaced. It is safe for the two
very different TTLs because it is *fixed-window by construction*: the TTL is written only when absent, so
`otp:rate:` gets one 3600 s window that a burst cannot extend, and `otp:attempts:` inherits the code's
remaining life on its first guess and then never refreshes — the two keys expire together. `ARGV[1]` is never
0 on either path (`remaining <= 0` is rejected at `:192` before the call). Effect-replication-safe. One
non-defect note: `eval` ships the script body on every call rather than `evalsha`; irrelevant at this volume.

**6 · What can an unauthenticated attacker do with a known number?** Two distinct capabilities:

- **Via `/auth/otp/request`** — 5 SMS and a 60-minute sign-in lockout for ~5 requests and ~1 second (H1).
  Repeatable hourly, forever, and it scales linearly across enumerated numbers, which makes it a budget
  attack as much as a DoS. This is the one to fix.
- **Via `/auth/otp/verify`** — 5 wrong guesses destroy any live code at **zero SMS cost** (measured). Combined
  with L1's oracle, sign-in can be denied indefinitely without ever touching the hourly cap. This one is
  substantially the deferred `ThrottlerGuard`, and it is inherent to any attempt cap; a per-IP throttle is the
  standard mitigation, not a code change here. **Not a merge blocker — but it must land before public exposure.**
- **Brute force** — bounded at ~25 guesses/hour against 10⁶. Not a threat.

## Are the tests real or decorative?

Real, with one instrumentation gap (M2) and one missing dimension (M1). Specifics, since they were asked:

- **`PausableKv` (`:28-46`) is a legitimate construction, not a fiction.** It stalls one caller between the
  TTL gate and its increment. That ordering — "A's `INCR` lands after B's `DEL`" — is exactly what a FIFO
  ioredis connection produces when A issues later; the double changes the *timing*, not the *possibility*.
  Building it deterministically is the right call given round 2 failed to reproduce the window in 200 live
  staggered guesses.
- **Nothing passes vacuously.** Round 2's M3 fix is genuine: `toBe(5)` cannot be satisfied by 0, and
  `rejection()` (`:89-103`) rejects a non-`UnauthorizedException` instead of casting, so a `TypeError`
  regression fails loudly. The spy is restored in a `finally`.
- **Both regression tests go red under the bug they cover** — verified by mutation, not by reading:
  increment-into-the-wrong-branch → `Expected 5, Received 50`; `burn()` deletes the counter → `Expected 5,
  Received 6`. Both claims in the fix report are true.
- **The one that would stay green through its own regression** is M2's variant, plus M1's entire concurrent
  request dimension.
- **The vacuous spec the fix report self-reported** (`does not extend the code TTL on a wrong guess`, `:328`)
  is indeed no longer exercising its original path, but round 2's added `otp:attempts:` TTL assertion at
  `:343` gives it real work. Fairly described in the report.

## Deferred findings — is any of them a merge blocker?

No, and the deferral is well-sequenced. #35 already gates **4, 5, 9 before any public deploy**, which is the
right line: `JWT_SECRET=dev-only-change-me` passing `min(16)` while the guards read `role` straight from the
token is role escalation the moment anything is exposed — but merging to `main` is not exposure. There is one
CI job in `.github/workflows/ci.yml` and it has no deploy step, so nothing ships on merge. **Add the
`ThrottlerGuard` to that same pre-deploy group** rather than treating it as general cleanup; it is what bounds
question 6's second capability. Finding 6 (Socket.IO CORS) before #8 is correct — the harness pins
`transports: ['websocket']`, so the gateway specs are structurally blind to it.

I read the realtime slice independently rather than trusting round 2's silence on it. `services/api/CLAUDE.md`'s
invariant — "Sockets authenticate in the handshake, and clients never request room joins" — holds: the JWT is
verified in `server.use()` before any handler (`realtime.gateway.ts:61-81`), `next(new Error(...))` is called on
both the missing- and invalid-token branches, `handleConnection` re-checks `client.data.user`, and
`room-policy.ts:14-26` is allowlist-shaped with a `return false` default — there is no client-supplied room
name anywhere. No findings. One observation for #11, not a defect: `roomsOnConnect` uses
`env.DEFAULT_CITY_ID`, so a dispatcher joins the default city's room regardless of assignment — fine while
one city exists, and `canJoin` is where the real check belongs when it doesn't.

## Validation

`REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` from a cleared `dist`:

| Gate | Result |
|---|---|
| typecheck · lint · test · build | **18/18 turbo tasks, 0 cached** |
| lint | 0 errors, 1 warning (pre-existing `no-unsafe-argument` on supertest) |
| api tests | **43 passed, 8 suites, 0 skipped** |
| CI workflow | sets `REDIS_TEST_URL` and TCP-probes Redis from the runner — verified in the file, not from the report |

Matches the fix report exactly. (Round 2's "39 api tests" was measured at `cbc9f61`, before the round-2 test
additions — both numbers are right for their commit.)

## Recommendation

**Not yet — fix H1 first.** It is ~8 lines, the patch is verified green against the full suite at the HTTP +
real-Redis layer, and it closes the one attack that three separate artifacts currently describe as closed. The
gap between "what the docs assert" and "what the code does" is the actual risk here: leave it and the next
reader will trust the comment at `:49-54` and build on a guarantee that isn't there.

Order of work: **H1** (with M1's burst test, since the test is what proves the fix), then **M2** while the
context is loaded, then **L1/L3** onto #35 and the PR body. Everything else can merge as-is.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 2 |
| Low | 3 |

Also correct in the artifacts, and worth saying because the brief invited scepticism: round 2's diagnosis of
the burn/cooldown coupling was right, its fix works for the path it targeted, its two mutation claims are
reproducible, and the CI Redis gap it closed is genuinely closed. The prior rounds were not rubber stamps —
they just stopped one interleaving short.

---
*Round 3: independent adversarial pass. Findings H1, M1, M2, L1, L2 established by execution against real
Redis and by mutating the source; probe specs and mutations reverted, tree clean at `5b0ab8b`.*
