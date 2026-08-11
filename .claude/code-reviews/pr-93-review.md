# PR #93 Review — road ETA for the tracking page via a quantized origin (#87)

**Reviewed at**: `c621ad2` · **Base**: `main` · 9 files, +812/−10
**Verdict**: 🔄 **Request changes** — narrowly. The code is correct and the architecture is right;
what needs fixing is that **two comments and the plan assert quantitative guarantees the code does
not provide**. Minimum to merge is a comment/plan correction, not a code change.

Reviewed twice independently — a fresh-context pass plus the `code-reviewer` agent. Where they
converged is flagged, because independent agreement is the useful signal here.

> **Note on review state**: this is posted as a comment, not a formal GitHub review. GitHub blocks
> any review state — `--approve` *and* `--request-changes` — on your own PR, and this is a solo repo
> where Linards authors everything. The verdict above is the real one; the missing review state on
> the PR is a GitHub constraint, not an oversight.

---

## Summary

The mechanism is sound and was verified rather than taken on trust. `quantizeForEtaCache` snaps to
3 decimals; `routeCacheKey` renders at `toFixed(4)`; the round-trip is exact with ~10 orders of
magnitude of headroom, so every raw fix inside a cell really does produce identical key text.
Quantizing at the call site instead of inside `CachingMapsProvider` is the correct architectural
call — and the hardest one in the ticket — with the reasoning written down.

What both passes landed on is that the *documentation* of this change overstates what it buys. The
budget claim is off by ~2×, and the "hostile poller adds none at all" guarantee is false by two
independent mechanisms. That matters more than usual here because the plan **de-scoped a security
control on the strength of that guarantee**.

---

## Issues

### High

**H1 — The "a hostile poller adds none at all" guarantee is false, by two independent mechanisms.**
`services/api/src/features/notifications/tracking/tracking.service.ts:153-154` ·
`services/api/src/features/geo/caching-maps.provider.ts:82-105`

*Both review passes found this independently.*

The docblock claims: *"a paid call happens when the driver crosses a cell, never per poll — and a
hostile poller adds none at all, because both ends of the key are server-side."* The plan then
de-scopes rate limiting **on the strength of that claim** (plan:30 — *"Not adding rate limiting to
`GET /track/:token` — quantization already bounds paid spend structurally"*).

**(a) No in-flight coalescing.** `route()` is `get` → miss → `inner.route()` → `setWithTtl`. Every
request arriving for a key *before* the first one's `setWithTtl` lands also misses and also reaches
the source. Because the key turns over ~7×/min while the driver moves (M1 below), there is a
continuously refreshed un-warmed key for the entire ride. A caller holding a valid token can fire an
arbitrarily wide concurrent burst into each of those windows — **concurrency, not cell crossings,
then sets the paid-call count.**

**(b) Errors are never cached.** Line 99 writes nothing when `inner.route()` rejects. During a
provider outage *every* 5 s poll (`POLL_MS = 5_000`, `apps/dispatch/src/features/tracking/tracking-map.tsx:15`)
from *every* viewer of *every* active ride reaches the source, and `roadEta`'s catch emits one
`logger.warn` per poll per viewer. The degraded path has no back-pressure at all — and the graceful
fallback is what *hides* it: the page answers 200 with a haversine ETA, so the client never learns
anything is wrong and never backs off.

**Standard it diverges from** — `services/api/CLAUDE.md`: *"Paid-call spend is bounded from both
ends: the cache covers ordinary traffic, and a per-rider cap … covers the hostile case."* This is a
new paid-call path with only the cache side. There is no global throttler (confirmed: the only rate
limit in the service is the per-rider ride-creation cap at `rides.service.ts:290`), and the Next
proxy at `apps/dispatch/src/app/t/[token]/data/route.ts:30` forwards with `cache: 'no-store'` and no
dedup, so it bounds nothing — and an attacker can bypass it and hit `/track/:token` directly.

**This is not relitigating a documented decision.** Skipping rate limiting is documented; its stated
rationale is factually wrong, so the decision rests on incorrect information.

**Not Critical because**: the path needs a valid 128-bit token (`mintTrackingToken`,
`tracking.service.ts:41-43`), so it isn't reachable by an anonymous scanner, and no real provider is
bound (`geo.module.ts:17-24` throws under `NODE_ENV=production`). No money is at risk today. It goes
live the moment #13/#16 binds Google.

**Fix — (a) and (b) need different controls; neither closes the other:**

- **(a) → a token-scoped throttle** on `GET /track/:token`, reusing the existing `incrWithTtl`
  pattern at `rides.service.ts:290-311` (N requests per token per window → 429). Lives inside this
  slice, touches no shared code.
- **(b) → a short negative cache** (cache the failure under its own key for ~30–60 s), or a circuit
  breaker on the seam. A throttle does **not** bound (b): during an outage the calls come from
  *legitimate* viewers each polling within their own limit, so any sane per-token threshold still
  permits 12 polls/min/viewer and N viewers still produce N×12 upstream calls.

Correct the two comments now; if the controls are deferred, file both as **blockers on #13/#16**.

### Medium

**M1 — The cited cell-crossing interval is the best case, presented as the worst case.**
`services/api/src/features/notifications/notifications.policy.ts:37-38` · plan:336

The comment says a paid call costs *"~15 s at the speed above"*; the plan says *"worst-case ~1 paid
call per 15 s … vs 1 per 5 s without quantization."* Both divide only by the **111 m latitude** axis
and ignore the **61 m longitude** axis that the same docblock states two lines earlier
(`notifications.policy.ts:31-32`).

Using only constants already in the repo — `TRACKING_ETA_GRID_DECIMALS = 3`,
`TRACKING_ETA_SPEED_METERS_PER_MINUTE = 417`, `POLL_MS = 5_000` (12 polls/min):

| Heading | Crossings/min | One per |
|---|---|---|
| Due N/S | 417/111 = 3.8 | ~16 s ← the documents' "~15 s" |
| Due E/W | 417/61 = 6.8 | ~8.8 s |
| 45° | 2.7 + 4.8 = 7.5 | ~8.0 s |
| **Worst (≈61° from N)** | √(3.8² + 6.8²) = 7.8 | **~7.7 s** |
| **Mean over uniform heading** | (2/π)(3.8 + 6.8) = **6.8** | ~8.9 s |

The true worst case is ~7.7 s — roughly **half** what both documents call the worst case. Distinct
cells sampled by 12 polls/min is ~5.5–6.8, against 12/min unquantized: a **~2× reduction, not the
~3× implied**.

**The arithmetic also misses something in the design's favour.** For a *stationary or slow* driver —
waiting at the kerb, in `arrived`, in traffic — quantization is worth far more than 2×: raw GPS
jitter of ±10–20 m produces a fresh 4-decimal key on nearly every poll indefinitely, and the
3-decimal grid collapses that to the 1–4 cells the jitter spans, all cached after first visit. That
is the case this design genuinely rescues, and it is a stronger argument than the one the plan makes.

This is a comment/plan accuracy problem, not a design problem — but the number is load-bearing: it
justifies the whole ticket, and the plan used it to reject a per-ride ETA memo as unnecessary
double-caching (plan:340). That rejection deserves a second look against ~6.8 calls/min/ride rather
than ~4.

**Fix**: state the anisotropy explicitly (~16 s N/S, ~8 s E/W, ~9 s mean at 417 m/min) and amend the
plan's spend note. No code change required.

---

**M2 — The slice ships no way to observe paid-call volume, so the `<€100/mo` guardrail it invokes is unmeasurable in production.**
`services/api/src/features/geo/caching-maps.provider.ts:99`

`grep` over `services/api/src/features/geo/` returns no `Logger`, no counter, no metric — the cache
miss path is entirely silent. The only counter that exists is `CountingMapsProvider`, which lives in
`test/harness.ts` and never runs in production. Every docblock in this slice cites the `<€100/mo`
guardrail as its justification (`notifications.policy.ts:36-40`, `geo.module.ts`,
`caching-maps.provider.ts:70-73`), but nothing in the running system can say whether it is being met
until the first Google bill arrives.

Two concrete consequences:

1. The plan's **Level 4 manual validation cannot be performed as written** — *"poll twice within 5 s
   — server logs must show no second route call (cache hit)"*. Nothing logs, so there is no such line
   to look at. The PR body honestly reports this step as not run; this is why it couldn't be.
2. It is what makes H1 and M1 invisible in production rather than merely wrong on paper.

**The sharpest case, and the reason H1/M1/M2 are really one problem**: the new `try/catch` in
`roadEta` swallows *contract* failures as readily as network ones. `RouteResult.durationSeconds` is a
plain `number` in `packages/shared/src/seams/maps-provider.ts:12`, but `routeResultSchema` at
`caching-maps.provider.ts:47` requires `.int()`. A real Routes adapter returning a fractional
duration would type-check, throw at the cache's write-path `parse()` on **every** call, be caught by
`roadEta`, and degrade **every ETA on the platform to haversine permanently** — while the page kept
answering 200 and looking healthy. The only signal would be the `track_eta_fallback` warn, which
nothing counts and nothing alerts on.

**Fix**: one structured log on the miss, e.g. `geo.maps.route_fetched` with the caller and a cell id
(no coordinates — `logging-standard.md`). Cheap, closes the observability gap, makes Level 4 real,
and lets the €/month figure be derived from actual volume before #13/#16 goes live.

### Low

**L1 — Logging taxonomy.** `tracking.service.ts:172` — `event: 'ride.notifications.track_eta_fallback'`.
`.claude/references/logging-standard.md:8` defines `action_state` as **verb + state**
(`offer_sent`, `match_failed`, `transition_rejected`). "fallback" is a noun describing the *handling*,
not a state of the action. The sibling `track_view_denied` (line 188) is correct — "denied" is a
state. Suggest `ride.notifications.track_eta_failed`: the route call is what failed; falling back is
the response. The string is pinned at `tracking.integration.spec.ts:561`, so a rename touches both.

**L2 — The 24 h TTL now governs a duration, and "inherited from pricing" is weaker than the plan implies.**
`MAPS_ROUTE_CACHE_TTL_SECONDS=86400`. Pricing consumes `distanceMeters`, which is near time-invariant;
this page consumes `durationSeconds` specifically (`notifications.policy.ts:112`) — exactly the field
traffic moves. So an 08:30 rush-hour page can be served from an 02:00 off-peak route on the same key.
The plan logs TTL staleness as an accepted open question, so this is a decision, not a defect — but
the PR *changes what the TTL means*, making this newly acquired rather than inherited. The fix is a
shorter, duration-specific TTL when the real provider lands, not a change to this PR.

**L3 — Acknowledged follow-ups: confirmed real, no action needed here.** Both are already in the PR
body and the triage is right. (i) The seam has no timeout — `roadEta`'s catch covers a *rejected*
promise only, so a hung Routes call hangs a request on a public page; note this compounds H1, since a
hang yields no fallback *and* no rate limit. (ii) `tracking.service.ts:175` logs `error.message`
verbatim, which a real provider could use to echo origin coordinates into a line
`logging-standard.md:14` forbids — and the spec's key-set assertion **cannot** catch that, because the
coordinate would be *inside* `message`. Group both with H1 on the #13/#16 seam ticket.

**L4 — Cross-test cache coupling in the integration spec** (`tracking.integration.spec.ts:462-465`).
One `InMemoryKeyValueStore` serves the whole file, so every case needing a miss must park the driver
in a cell no earlier case routed. Verified the three new cases use non-colliding cells (57.010 /
57.020+57.021 / 57.030, all at lng 24.086), the constraint is written where a future author will hit
it, and the failure case self-guards with `expect(ctx.maps.routeCalls).toBe(calls + 1)` at line 540 —
which turns a leaked armed failure into a failure in the test that caused it. Mitigated well; noted
only because a future test inserted earlier in the file will need a fresh cell.

### Checked and found to be non-issues

- **Float stability.** `Number(x.toFixed(3))` → `toFixed(4)` is exact. `toFixed(3)` yields an exact
  3-decimal string; `Number()` carries ~1e-14 error at magnitude 57; the 4-decimal tie boundary sits
  5e-5 away — ~10 orders of magnitude of headroom. Cell boundaries resolve deterministically per
  spec, and **determinism is the only property the cache needs**, not any particular direction.
  Negative longitudes are equally deterministic and don't arise at ~24°E.
- **Cache poisoning across consumers.** Quantization happens *above* the cache, so entries stay
  truthful — the key describes exactly the coordinates handed to the source. Pricing can never read a
  degraded entry.
- **Delta-only call counting is sound.** Production calls `maps.route` in exactly two places
  (`pricing.service.ts:42`, `tracking.service.ts:166`), so each booking's quote genuinely does share
  the counter, as the spec's comment claims.
- **File length.** `tracking.integration.spec.ts` (574) and `harness.ts` (509) exceed the ~500
  guideline, but `ride-lifecycle.integration.spec.ts` is 675 — long integration specs are the
  established norm, not a PR-introduced divergence.
- **Branch history.** The PR body flags that #86 briefly landed here and was moved off.
  `git log main..HEAD` is one commit and contains no vehicle-stamp work. The repair is clean.
- **AC #5 scope.** `git diff main..HEAD --name-only` touches neither `packages/shared`,
  `caching-maps.provider.ts`, nor `ride-notifications.service.ts`. Holds.
- **Type safety and hard rules.** No `any`, no `as` casts, no `@ts-ignore` in new code; helpers typed
  off `@taxi/shared`'s `LatLng`/`RouteResult`; nothing added to or duplicated from `packages/shared`;
  no money, no status writes, no payment-method surface touched.

---

## Validation

Run from the worktree with `COMPOSE_PROJECT_NAME=taxi` (reuses the healthy `taxi-db-1`),
`DATABASE_URL` on the LAN IP, and `REDIS_TEST_URL=redis://localhost:6381`.

| Command | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | ✅ **20/20 tasks**, exit 0, 49.1 s |
| `@taxi/api` tests | ✅ 418/418, 51/51 suites |
| `@taxi/shared` tests | ✅ 145/145, 18/18 files |
| `@taxi/db` tests | ✅ 17/17, 3/3 files |
| lint | ✅ 0 errors, 7 warnings (all pre-existing `getHttpServer()`) |

**580 tests, nothing skipped** — with `REDIS_TEST_URL` set, both Redis-backed suites report `PASS`
rather than `describe.skip`, so this is genuine CI parity and not five tests short. Every number in
the PR body reproduces exactly.

---

## What's good

- **Seam discipline is exactly right.** `MAPS_PROVIDER` injected from the geo barrel
  (`tracking.service.ts:20`) — not a deep path, not the source token, no SDK import. Both sides of the
  new dependency were documented rather than left implicit: the module docblock explains the import
  (`notifications.module.ts:24`) and the geo barrel's injector inventory now names this consumer
  (`geo/index.ts:6-8`), honouring that file's own "a lie about ownership" rule.
- **Quantizing at the call site rather than inside `CachingMapsProvider`**, with the reasoning
  written down (plan NOTES:334): the cache is shared with pricing, where `COORD_PRECISION = 4`
  explicitly prices precision in cents of fare accuracy. Blast radius held to one consumer.
- **The tests are load-bearing, verified mechanically rather than trusted.** `:485` asserts the seam
  received the *quantized* origin and the *untouched* pickup, so a no-op quantize fails. `:515`
  `toBeCloseTo(nudged.lat, 4)` (tolerance 5e-5) fails if the *displayed* position were ever quantized
  (error 3e-4) — the "map shows the real car" property pinned numerically. `:488-493` asserts the
  routed value **and** `not.toBe` the fallback, with ~5.6 km geometry chosen so the two formulas
  disagree, so it cannot pass for the wrong reason. The mutation check in the report is real.
- **`:564-570` pins the whole key set of the warn payload** with a sorted `Object.keys()` equality
  rather than `objectContaining` — the only assertion shape that can prove no coordinate reached a
  log line, and the documented reason for deviating from the plan's `expect.any()` version is
  correctly reasoned.
- **`moveDriver()` (`:231-239`) asserts `record()` returned `true`.** The in-memory store silently
  keeps the old position for a driver it believes offline; without this the failure would surface
  three assertions later as an unexplainable ETA. Not in the plan — good instinct.
- **`CountingMapsProvider.failNext()`** (`harness.ts:264-277`) mirrors the established
  `RecordingPaymentsProvider` pattern and its docblock states the non-obvious hazard: the cache sits
  *above* the fake, so an armed failure fires only on a miss.
- **The `TRACKING_ETA_SPEED_METERS_PER_MINUTE` docblock rewrite.** The constant changed meaning
  (upgrade-path placeholder → the fallback) and the comment was updated to match instead of left to
  rot. Rare, and worth naming.
- **Failure mode is the right one:** an outage degrades the ETA, not the page. Pre-existing
  200/410/404 semantics untouched.

---

## Recommendation

**Request changes — narrow, and cheap to clear.**

Minimum to merge (documentation only, no code change):

1. Correct the false *"a hostile poller adds none at all"* guarantee — `tracking.service.ts:153-154`.
2. Correct the best-case-labelled-worst-case arithmetic — `notifications.policy.ts:37-38` and plan:336.

Then merge. The implementation itself is correct, the architecture is right, the gate is green at
real CI parity, and the change is strictly better than the straight-line ETA it replaces.

File as **blockers on #13/#16**, before a real provider is bound: the token-scoped throttle (H1), the
miss-path instrumentation (M2), the seam timeout and `error.message` handling (L3), and a
duration-specific TTL (L2). They are one coherent piece of work on the same seam.

Optional now, cheap: the `track_eta_failed` rename (L1).

_Reviewed by `piv-review-pr` — a fresh-context pass plus the `code-reviewer` agent. A human makes the
final call._
