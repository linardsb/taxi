# Code Review — PR #107

`feat(api): mint:ride — count paid route calls on a live ride (#94)`
Head `13cf8b0` · base `main` · 6 files, +1692/−6 · reviewed read-only from the existing worktree at `taxi-tracking-eta`.

## Summary

A well-built instrument with one wrong number on its front page.

The three files that can affect shipped behaviour — `package.json`, `tsconfig.build.json`, and the spec — are
correct and minimal. The script's mechanism holds up under checking: the log capture, the cache-clear targeting,
the positive control, and the named failure diagnoses all do what the report says they do.

But the headline result does not measure what the PR body, the report, and the plan say it measures. **Every walk
position is already on the 3-decimal grid, and the position does not change between the five polls of a cell — so
`quantizeForEtaCache` is the identity function for this entire run.** Delete #87's grid and this walk still costs
6 paid calls, not 30. The "30 → 6, 5×" figure is an assumption about GPS jitter printed in a column headed
**Observed**.

That is the rule CLAUDE.md names, and the script's own comment at `mint-tracked-ride.ts:761` cites the precedent:
*"#87 shipped a best-case interval labelled worst-case; every number here says which case it describes."* This
number does not.

## Validation

| Check | Result |
|---|---|
| CI `check` workflow (the parity gate) | **PASS** — 3m23s, run [31542207270](https://github.com/linardsb/taxi/actions/runs/31542207270) |
| `@taxi/api` typecheck coverage of `scripts/` | **Confirmed** — `typecheck` is `tsc --noEmit` against `tsconfig.json`, which has no `exclude`; only `tsconfig.build.json` excludes `scripts` |
| `@taxi/api` lint coverage of `scripts/` | **Confirmed** — glob widened to `{src,test,scripts}/**/*.ts` |
| Mergeable | Yes, `MERGEABLE` |

**The local gate was deliberately not re-run.** CI ran the exact parity command on this head and passed. CLAUDE.md
states integration runs are mutually destructive across sessions (global-setup drops the shared test DB), and six
`claude` processes are live on this machine. Re-running locally risked destroying another session's run and
returning a false red. The PR's own gate evidence (21/21 tasks, 461 tests) is therefore taken as CI-corroborated,
not independently reproduced.

## Issues

### High — 1

**H1. The "unquantized counterfactual = 30" is not observed, and is wrong for this walk**
`services/api/scripts/mint-tracked-ride.ts:752-757` · `.claude/reports/mint-tracked-ride-dev-script-report.md:98,100` · `.claude/plans/mint-tracked-ride-dev-script.md:447,449`

The chain, each link checked in the source:

1. `mint-tracked-ride.ts:119-121` — `cellLocation(i)` returns a latitude already rounded with
   `.toFixed(TRACKING_ETA_GRID_DECIMALS)` (3 dp), and a longitude of `24.085` (3 dp).
2. `quantizeForEtaCache` (`notifications.policy.ts:175`) is `toFixed(3)` — so it is a **no-op** on every position
   this run generates.
3. The location is emitted **once per cell** (`:653`), then polled 5×. Each poll reads back the same stored
   member, so the position is identical across all five.
4. The cache key renders at `COORD_PRECISION = 4` (`caching-maps.provider.ts:18,67`). Identical position →
   byte-identical key on all five polls, **with or without** quantization.

So the true unquantized counterfactual for this experiment is **6**, and the reduction attributable to #87's grid
here is **1×**. What the run actually demonstrates is `CachingMapsProvider`'s 4-decimal corridor cache — which
predates #87.

The report's own Level 5 artifact is the tell: `report.md:117` prints
`maps:route:v1:eta:56.9610,24.0850|…` — that `56.9610` is simultaneously the 4-dp rendering of the quantized
*and* of the raw position. And `notifications.policy.ts:44-51` says it outright: the grid's win is GPS jitter.
This walk has none.

*Failure scenario:* a future ticket reads "30 → 6, 5×" as measured evidence for the ETA grid, de-scopes or
retunes something on the strength of it, and is working from a number no run produced. This is the exact
sequence CLAUDE.md records for #87.

*Affected rows:* `report.md:98` puts `30` under **Observed** when nothing observed it. `report.md:96`
("eta calls on views 2–5 of any cell = 0") is *true* but does not evidence #87 — an unchanged position returns 0
from any coordinate-keyed memo.

*What this does not invalidate:* `assertInvariants` (`:774-815`) never asserts 30-vs-6. Every assertion the
script **makes** is a true statement about the system. This is a reporting defect, not a broken control.

*Two legitimate fixes — this is a judgement call, not a mechanical edit:*

- **(a) Withdraw the claim.** Drop the `unquantized counterfactual` and `reduction at this dwell` lines from
  `report()` (`:752-757`), and the two table rows. State what the run does establish: one paid call per new
  corridor, zero for repeated polls at an unchanged position, against real Redis.
- **(b) Make it measurable.** Add sub-cell jitter between the polls of a cell — the plan already sanctions the
  magnitude at `plan.md:297` (±0.0002° ≈ 22 m, inside the ±0.0004° half-cell). Quantized → still one corridor per
  cell, so every existing assertion and expected count survives; unquantized → five distinct 4-dp keys per cell,
  and 30 becomes real.
  **Trap if you take (b):** the landed check at `:668-671` uses a `5e-5` tolerance, *smaller* than the jitter —
  every cell would throw "the page never showed the driver at …". Compare
  `quantizeForEtaCache(page.position).lat === location.lat`, or widen past the jitter.

### Medium — 1

**M1. Teardown's last two calls are unguarded — a failing run can lose its own diagnosis and hang**
`services/api/scripts/mint-tracked-ride.ts:847-868`

The cancel above them is `.catch`-wrapped (`:842`); `GET /drivers/me` (`:847`) and `PUT /drivers/me/status`
(`:863`) are not.

*Failure scenario:* Redis dies mid-walk. Control enters the `finally`. `fetch` rejects. The throw from the
`finally` **replaces the original error**, so `main().catch` at `:877` prints the teardown failure instead of the
real diagnosis — and `app.close()` at `:873` never runs, so the process hangs rather than exiting 1. The
instrument loses exactly the naming discipline the rest of the file is built around.

*Fix:* the same `.catch((err: unknown) => ({ status: 0, body: String(err) }))` shape on both, or move
`app.close()` into a nested `finally`.

### Low — 2

**L1. Floating `void api(…decline)` can kill the run with an opaque unhandled rejection**
`services/api/scripts/mint-tracked-ride.ts:477-479`

A rejected `fetch` (connection reset while the offer cascade is in flight) is an unhandled rejection — fatal in
Node ≥ 15. The process dies with `ERR_UNHANDLED_REJECTION`, teardown never runs, and the driver is left `on_ride`
— the state `:819-823` identifies as breaking the next run. `void` satisfies `no-floating-promises`; it does not
attach a handler. *Fix:* `.catch(() => {})`.

**L2. Two ioredis clients leak if `connectToRedis` throws between creation and assignment** — noted, no change
required. `redis-io.adapter.ts:36-43` assigns `pubClient`/`subClient` only after both ping, and `close()` quits
only what was assigned, so a throw inside leaves two clients retrying forever and `process.exitCode = 1` never
lands. The `kv.ttl` probe at `:321` closes the realistic case (wrong URL / NOAUTH), and the script documents this
at `:317-319`. Residual is narrow.

## What's good

- **The log-capture mechanism is sound, and the subtle parts are the load-bearing ones.** `CapturingLogger extends
  ConsoleLogger` (`:141`) is what lets `Logger.overrideLogger` accept it and what makes every `new Logger(ctx)` —
  including `CachingMapsProvider`'s, constructed *after* the override — delegate to it. Pushing to `events` before
  `super.log` makes capture independent of log levels. No double-count path exists.
- **The pre-flight clear targets the right keys, and the idempotence framing is honest.** `roadEta`
  (`tracking.service.ts:192`) passes `quantizeForEtaCache(from)` + the raw pickup; the script clears exactly that
  pair (`:379-381`). `report.md:109-112` uses the identical counts to prove *the clear works* — not to claim the
  keys survived their TTL. Catching the 24 h quote corridor (deviation 1) is a real defect the plan missed.
- **A silent zero-call run cannot read as a pass.** Positive control before any zero is trusted (`:510-516`),
  distinctness assertion separating "6 calls" from "one corridor routed 6×" (`:787-792`), a `caller:'quote'` ≥ 1
  check proving the filter discriminates rather than matching nothing (`:806-810`), and a poll-budget guard that
  refuses to start a run the #100 throttle would turn into meaningless zeros (`:358-364`).
- **Hard rules are clean.** No money in the script. The only status change is `POST /rides/:rideId/cancel` over
  the wire (`:839`) — through `assertTransition`, deliberately, with deviation 4 explaining why rather than the
  direct `rides.status` write the tracking spec's `afterEach` uses. Contracts imported from `@taxi/shared`, not
  redeclared. No provider SDK import. Phones masked in every printed line.
- **The spec change is comment-only and collision-free.** The `+6/−4` is a docblock reflow;
  `phoneFor('+371260', n)` is unchanged, so the spec asserts exactly what it did. No `+371290*` claimant exists
  elsewhere in the repo.
- **The build config is right for the right reason.** `scripts` excluded from `tsconfig.build.json` only —
  verified against the actual `rootDir`-inference symptom (`dist/src` absent, not merely `dist/main.js` present),
  which is the check most people skip. jest untouched. The rot-protection claim holds.
- **Reviewer notes 2–7 are honest self-disclosure**, including #7's explicit "implemented but never exercised"
  and #5's departure from AC #9. That is the standard the repo asks for, applied without being asked.

## Acknowledged, not issues

- **880 lines vs ~500.** The rule sits inside CLAUDE.md's VSA bullet and governs slice source; this is neither a
  slice nor shipped code, and note 6 shows the arithmetic against sibling non-slice files rather than asserting
  the exemption.
- **Deep imports past the geo/dispatch barrels** (`:65-76`) — documented in place, and `routeCacheKey` is exported
  precisely so an outside caller can address the same corridors.
- **The two environment findings** (root `.env` pointing `REDIS_URL` at the password-protected 6379 tunnel instead
  of compose's 6381; the 5-runs/hour OTP cap) are real and worth fixing, but they are not this diff. Relayed, not
  filed.

## Recommendation

**Request changes** — on H1 only. The code is merge-ready; the claim is not, and under this repo's own rules a
number nothing observed is the defect, not a rounding of one.

H1 is Linards' call between withdrawing the claim and making it measurable — both are legitimate, and (b) is the
more valuable run if the ETA grid is going to be tuned against a real Google bill later. M1 and L1 are one line
each and can ride along.

---

🤖 Posted by `piv-review-pr`. A human reviews the code and this review, then merges.
