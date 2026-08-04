# Code Review — PR #34, round 2 (the fix pass)

**`feat(api): SMS-OTP auth with JWT role guards and a JWT-gated Socket.IO gateway`**
Branch `feature/api-auth-realtime-gateway` → `main` · head `6e91b7c` · Closes #7 · Epic #1

Round 1 is `.claude/code-reviews/pr-34-review.md` (kept intact — `96f067f` and issue #35 both cite it).
This round reviews only what changed since: `96f067f`, `a3dbdc4`, `2a8a79c`, `cbc9f61`, `6e91b7c`.
The deep pass was run by the `code-reviewer` agent in a clean context; every load-bearing claim below
was then re-checked against a live API on real Postgres + Redis, and two of them came back different
from the agent's framing — noted inline.

## Summary

Round 1's Critical is **genuinely closed**. A 50-guess burst no longer registers as one attempt, and
the increment sits *before* the compare — which is the decision that makes the cap bound guesses
rather than waves, and which round 1's own remediation text did not specify.

What's left is one finding that matters: **the resend cooldown is bypassable by burning the code, so
finding 2's abuse half was never actually closed** — and the round-1 review, the fix, and the fix
report all say otherwise. Measured, not reasoned: **5 SMS delivered and a known number locked out of
sign-in for the hour, in under one second.**

## Issues

### High

**M2 · Burning the code clears the cooldown, so a known number is still lockable in ~1 second**
`services/api/src/features/auth/auth.service.ts:86-96` · `:193`

The cooldown is derived from `ttl(codeKey)` rather than its own key, and the attempt cap deletes that
key. So five wrong guesses erase the cooldown and the next request is free:

```
request                  → SMS, otp:rate = 1
verify ×5 (wrong)        → attempts 5 → burn → code key deleted
request                  → remaining = 0 → no cooldown → SMS, otp:rate = 2
… ×3 more …              → otp:rate = 5
request                  → 429 for the rest of the hour
```

**Measured against the live service**, not inferred — five rounds, then the lockout:

```
round 1..5 request → {"expiresInSeconds":300,"resendAfterSeconds":60}   ← cooldown never fires
6th request        → {"statusCode":429,"message":"too_many_requests"}
elapsed: 0s   SMS sent: 5   otp:rate = 6
```

**The mechanism is pre-existing** — `git show 5d91698:…/auth.service.ts:88` derives the cooldown the
same way and `:194` deletes the same key — so this is not a regression introduced by the fix pass.
But it is squarely inside finding 2, which was graded **High** and reported as fixed.

What the fix pass *did* buy is real and worth keeping: the attack went from 5 requests costing **1**
SMS to ~30 requests costing **5** SMS, because cooldown rejections no longer consume a slot. What it
did not buy is the delay. Round 1 claimed the reordering would force "60 s between requests (5
minutes minimum)"; that is false, and `.claude/reports/pr-34-review-fixes.md:52-54` inherited the
error in its past tense.

**Fix.** Give the cooldown its own key — `otp:cooldown:<phone>`, 60 s TTL, set when `sms.sendOtp`
resolves, and deliberately *not* deleted by the burn. The cooldown then survives a burn, which is the
property finding 2 was buying. Note this is a real lifecycle change: a user who verifies successfully
would also stay in cooldown, so the success path should clear it explicitly if that is not wanted.

### Medium

**M1 · The ≤5 bound holds by scheduling, not by construction — the burn deletes the counter that is the bound**
`services/api/src/features/auth/auth.service.ts:66-69`

`burn()` deletes `otp:attempts:<phone>` alongside the code key. The attempts key *is* the cap, so a
request already in flight can have its `incrWithTtl` land on a freshly-deleted key, come back as
`attempts: 1`, and reach `timingSafeEqual` against the record it is still holding in memory. If such
a re-armed guess were correct, `burn()` on the success path is a no-op and a session is minted from a
code Redis has already deleted.

**Reproduction attempt — negative, and that matters for the severity.** 200 guesses in 8 staggered
waves of 25 produced **exactly 5** comparisons; the earlier 50-guess simultaneous burst also produced
exactly 5. The window is narrower than it first appears: a request must clear **both** `get` (`:161`)
and the `remaining <= 0` gate (`:176-177`) *before* the burn's `DEL` on the code key, and then issue
its `INCR` *after* the burn's `DEL` on the attempts key — roughly one round trip on a FIFO connection
— and once the code key is gone no new request can enter that window at all.

So: a real weakening of the invariant, not a reproducible exploit. It stays Medium because **the fix
is strictly less code than the bug**: delete line `:68`. The counter then outlives the burn on its own
TTL, late arrivals get `attempts > OTP_MAX_VERIFY_ATTEMPTS` and are refused before the compare, and
nothing goes stale because `requestOtp:125` already clears the counter whenever a new code is issued.
Both existing specs pass unchanged. Deleting the bound was never necessary.

**M3 · The burst assertion passes at zero, so a crash regression would read as green**
`services/api/src/features/auth/auth.service.spec.ts:212` · `:58-69`

`expect(compared).toBeLessThanOrEqual(OTP_MAX_VERIFY_ATTEMPTS)` is satisfied by `compared === 0`, and
the `rejection()` helper casts whatever was thrown to `UnauthorizedException` without checking it. If
every request started throwing a `TypeError` — finding 10's deferred `JSON.parse` path is exactly
that shape — no `wrong_code` warning would be logged, `compared` would be 0, and the test would pass
while the endpoint was broken.

**Fix.** `expect(compared).toBe(OTP_MAX_VERIFY_ATTEMPTS)` — verified stable across repeated runs, the
in-memory store's ordering makes it deterministic — and have `rejection()` fail on an unexpected error
type instead of casting.

**M4 · Every lifecycle claim made for the new key is unasserted**
`services/api/src/features/auth/auth.service.spec.ts`

No spec reads `otp:attempts:` at all. `pr-34-review-fixes.md:31-34` claims the counter carries the
code's remaining TTL, that burn clears both keys, and that `requestOtp` resets it on reissue — the
third is the one whose silent loss would hand a reissued code a used-up budget, and nothing would
catch it. `redis-kv.store.spec.ts` covers the primitive, not the wiring.

**Fix.** Assert `ttl(otp:attempts:…) <= ttl(otp:code:…)` in the existing TTL test — which is also how
that now-vacuous spec (see below) earns its keep — and add one reissue case: request → 3 wrong
guesses → advance past the TTL → request again → five fresh guesses all reach the compare.

### Low

**L1 · The `ThrottlerGuard` fell between "fixed" and "deferred" with no record**
`services/api/src/features/auth/auth.controller.ts:20-36`

Round 1 named it in finding 1's remediation as worth adding regardless. It was not fixed and is not in
issue #35 — `grep -rn Throttler services/api/src` is still empty. It matters more than bookkeeping:
a per-IP cap on the unauthenticated `/auth/otp/*` routes is exactly what would bound M1's residual
window and blunt M2's ~30 calls per second. **Fix.** Add it to #35 explicitly.

**L2 · The `Logger.prototype.warn` spy is not restored if the burst rejects**
`services/api/src/features/auth/auth.service.spec.ts:191-206`

`warn.mockRestore()` is unreachable if `Promise.all` rejects, leaking a global prototype mock into
every later test in the file. **Fix.** `try`/`finally`, or `afterEach(() => jest.restoreAllMocks())`.

## Verdicts on the four findings this pass claimed

| # | Round-1 severity | Verdict |
|---|---|---|
| **1** | Critical | **Resolved** for the reported failure mode. Residual M1: the bound holds by timing, not construction. |
| **2** | High | **Partially resolved.** Legitimate-user half fixed and tested. Abuse half (**M2**) still reachable in ~1 s — and reported as closed. |
| **3** | Medium | **Resolved.** The Lua script is correct Redis; `TTL < 0` is the right guard and heals an orphaned key, which is strictly better than round 1's own `MULTI`/`NX` suggestion. |
| **8** | Medium | **Resolved**, with the right blast radius — production imports moved, spec deep-imports left alone. |

Deferred findings 4, 5, 6, 7, 9, 10, 11: none made worse, none half-changed. The new
`reason: 'attempt_cap'` rides on the already-conformant `auth.otp.verify_rejected`, so finding 11's
taxonomy debt did not grow.

## Validation

`pnpm turbo run typecheck lint test build --force` from a cleared `dist`, `REDIS_TEST_URL` set:

| Gate | Result |
|---|---|
| typecheck · lint · test · build | **18/18 turbo tasks, 0 cached** |
| lint | 0 errors, 1 warning (pre-existing `no-unsafe-argument` on supertest) |
| tests | **39 api** (8 suites) · **85 shared** · **14 db** |
| GitHub Actions on `cbc9f61` | **pass** — run 30946982601, **39 tests, 0 skipped** |

CI now runs what the local gate runs. Before `cbc9f61` it ran 2 suites / 5 tests fewer (measured on
run 30946495121), which meant finding 3's fix had no CI coverage on the commit that introduced it.

## What's good

- **The increment-before-compare decision was found independently.** Round 1 said "count it with
  `incrWithTtl`" and never said where; the natural reading yields an atomic counter that bounds
  nothing. The comments at `auth.service.ts:187-190` and `auth.service.spec.ts:208-211` both explain
  why, and the test was verified to go red (50 comparisons) when the increment moves below the compare.
- **The Lua script's `TTL < 0` guard beats the remediation it was given.** `SET k 0 EX ttl NX` +
  `INCR` in a `MULTI` is atomic but leaves an already-immortal key immortal; this heals it.
- **The fix report is candid where candour costs it** — it names its own two contract tests as passing
  pre-fix, declares a pre-existing spec vacuous, and logs finding 2's SMS-outage residue on #35 rather
  than quietly closing it. That is what makes the rest of it worth reading. Its one real error (the
  M2 past tense) is inherited from round 1, not invented.
- **The CI gap was found by the fix pass, not by the review**, with a specific measurement, and closed
  with a runner-side TCP probe — because the container's own health check would pass through a wrong
  port mapping and put the suites back to skipping silently.

## Recommendation

**Comment, not approve** — and note GitHub will not accept a formal approve/request-changes here
anyway, since the PR author and the reviewing account are the same user. A human makes the call.

The Critical that blocked round 1 is closed. **M2 is the one to decide before merge**: it is
pre-existing rather than a regression, but it is inside a High finding that is currently reported as
fixed, and the fix touches the OTP lifecycle (a new key, plus a decision about whether a successful
verify clears the cooldown). M1, M3, M4 and L2 are cheap and low-risk — M1 in particular is a
four-word deletion that makes the invariant structural.

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 1 |
| Medium | 3 |
| Low | 2 |

Also stale and worth fixing separately: **the PR body**. It still reports "green, 15/15" and "34 api"
tests, and lists "the Redis-adapter suite is not wired into CI" as an open question — `cbc9f61` closed
that.

---
*Round 2 by the `code-reviewer` agent in a clean context, plus live re-verification of M1 and M2
against real Postgres + Redis. M1's severity was lowered after 200 staggered guesses failed to
reproduce it; M2's was raised after it reproduced in under a second. Reviewed by the same session that
wrote the fixes — which is why the deep pass was delegated.*
