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
no longer spends a slot. Five taps of "resend" used to lock a phone out of sign-in for an hour, and
anyone who knew a number could do it in about a second.

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

## Validation

`pnpm turbo run typecheck lint test build --force` from a cleared `dist`, with
`REDIS_TEST_URL=redis://localhost:6381`:

| Gate | Result |
|---|---|
| typecheck · lint · test · build | **18/18 turbo tasks, 0 cached** |
| lint | 0 errors, 1 warning — the pre-existing `no-unsafe-argument` on supertest |
| api tests | **39 passed, 8 suites** (was 34 / 7) |
| GitHub Actions on `96f067f` | **pass** — run [30946043123](https://github.com/linardsb/taxi/actions/runs/30946043123) |

**A coverage gap worth knowing:** `.github/workflows/ci.yml` provides no Redis and sets no
`REDIS_TEST_URL`, so both Redis suites — the adapter's two tests and the three new KV ones — skip
there. CI runs 34 api tests, not 39, and **finding 3's fix has no CI coverage at all.** Findings 1
and 2's tests use the in-memory store and do run in CI. Not introduced by this pass, but the new spec
inherits it; worth a `services:` block on the CI job.

## Needs a human look

- **Finding 11's taxonomy decision** (deferred to #35) is the one item that is not a mechanical fix:
  either `realtime` joins the domain list in `.claude/references/logging-standard.md`, or the gateway
  emits under `driver`/`dispatch`. The first edits a rules file, so it wants `rules-check-drift`
  rather than a quiet patch.
- **Finding 2's residue**, logged as a comment on #35: an SMS provider outage still spends a slot and
  writes the code key with a full TTL. A sustained outage burns all five hourly slots in ~4 minutes
  with nothing delivered. Bounded and self-clearing; best revisited with #13, where a real provider
  gives an error specific enough to distinguish "never sent" from "maybe delivered".
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
