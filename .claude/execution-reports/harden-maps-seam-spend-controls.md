# Execution Report — harden the maps seam with spend controls and a counter (#94)

Covers the whole slice: the implementation (`836ddf1`), the PR #99 review round (`1ce2548`), and the
stale-figure sweep that round required (`822bdcb`). **Merged to `main` 2026-08-11 18:04 UTC** as
`5b3911e`.

## Meta

- **Plan**: `.claude/plans/harden-maps-seam-spend-controls.md` (724 lines, authored by `piv-plan-implementation`)
- **Issue**: #94 · **PR**: #99 (MERGED) · **Branch**: `feature/harden-maps-seam-spend-controls`
- **Range**: `3752d2a..822bdcb` — 20 files, **+2387 / −88**

**Files created (3)**
- `.claude/plans/harden-maps-seam-spend-controls.md`
- `.claude/reports/harden-maps-seam-spend-controls-report.md`
- `.claude/code-reviews/pr-99-review.md`
- `services/api/src/features/notifications/tracking/tracking.service.spec.ts`

**Files modified (16)** — `services/api/src/features/geo/` (`caching-maps.provider.ts` +325,
`caching-maps.provider.spec.ts` +466, `geo.module.ts`, `geo.module.spec.ts`, `index.ts`,
`maps.tokens.ts`); `services/api/src/features/notifications/` (`notifications.policy.ts`,
`notifications.module.ts`, `tracking/tracking.service.ts`, `tracking/tracking.integration.spec.ts`);
`services/api/src/common/config/env.schema.ts`; `services/api/src/features/rides/rides.policy.ts`;
`packages/shared/src/seams/maps-provider.ts` (docblock only, **no type change**); `.env.example`;
`services/api/CLAUDE.md`; `.claude/plans/tracking-eta-maps-quantized-cache.md`.

## Validation Results

| Check | Result |
|---|---|
| Syntax & Linting | ✓ 0 errors, 7 warnings (all pre-existing `no-unsafe-argument` in integration specs, none in changed code) |
| Type Checking | ✓ |
| Unit + Integration Tests | ✓ `@taxi/api` **54 suites / 458 tests**, 0 skipped (`REDIS_TEST_URL` set) |
| Full CI-parity gate | ✓ **21/21 tasks**, 0 cached, ~53 s |

Gate command: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

Test count moved 455 → 458 in the review round (two cases for M1's best-effort cache writes, one
key-set case for `geo.maps.route_failed`).

**Level 4 manual: step 3 is still open and did not ship verified.** Observing a *single*
`geo.maps.route_fetched` per cell crossing on a live polled ride is this ticket's own success
condition — and the check #87 could not perform at all, because the counter did not exist. It needs a
tracking token the dev seed does not mint (tokens come from the booking flow). Steps 5 and 4 *were*
performed live; 2, 6 and 7 are covered by automated cases mapped one-to-one in the implementation report.

## What Went Well

- **`caller` as a constructor argument rather than a fourth `route()` parameter.** It bought the log
  field, the cache namespaces and the per-caller negative cache at once, with **zero `packages/shared`
  churn** — the seam type never changed. The review singled this out.
- **The negative-cache asymmetry is enforced, not documented.** `geo.module.spec.ts` builds the
  assertion through the module's *own* `useFactory`, so a swapped positional argument in a
  six-argument constructor fails there. That was the stated mitigation for not using an options
  object, and it holds.
- **Deviation #3 was load-bearing and the review confirmed it independently.** Inserting a *blocked*
  call between the failure and `advance()` means the test fails if serving a cached failure ever
  re-writes the fail key. Without that step the sequence passes with the "transient blip becomes
  permanent outage" bug present.
- **Write-path rounding caught a real contract mismatch.** Google documents `duration` as
  `"1187.400s"`; against `.int()` it would have thrown on every call, been swallowed by `roadEta`'s
  catch, and pinned every ETA on the platform to haversine while the page kept answering 200.
- **The review round's fixes were proven, not asserted.** Both M1 cases were run against the pre-fix
  provider and failed (3 failed / 14 passed); L3's new assertion was run without its `advance(61)` and
  failed 7-vs-8 route calls — the exact trap it removes. That is evidence, not self-agreement.

## Challenges Encountered

- **Level 4 could not be completed by an agent, and that was the right call.** Producing a tracking
  token means the full OTP → book → dispatch → accept → GPS-ping chain against a running server. The
  implementation session declined to fake it and said so; the review agreed. The cost is that the
  ticket's headline claim shipped test-verified but not field-verified.
- **Worktree/environment friction, three separate times**: a worktree-scoped compose project collided
  on 5432 with the shared `taxi-db-1` (fixed with `COMPOSE_PROJECT_NAME=taxi`); the worktree `.env`
  pointed Redis at the auth-required local instance (the known 6379 shadowing, needs 6381); and colima
  died mid-session during the final gate, producing a red `@taxi/db#test` that looked like a code
  failure and was not.
- **A one-token grep is not a sweep.** The first pass for the false 429 claim keyed on `"429"` and the
  exact phrase, which found 2 of 5 sites. The stale values were a *viewer count* and a *test total* —
  neither contains the string "429". Three more sites surfaced only on a second sweep keyed on the
  numbers themselves, one of them the **PR body**, which is what the next reviewer re-runs the gate
  against.

## Divergences — the review round

The implementation's eight divergences are already recorded in
`.claude/reports/harden-maps-seam-spend-controls-report.md`. These are new to the review round.

**R1 — L1 escalated from a test to a code change**
- Planned (by the review): add one key-set case for `geo.maps.route_failed`.
- Actual: added the case **and** introduced `safeErrorName` in `caching-maps.provider.ts`.
- Reason: `errorName: error.name` was logged raw while the docblock beside it claimed it "cannot
  contain a coordinate". `name` is a writable own property, so it could. Writing the test as specified
  — with a benign `Error` — would have passed while the hole was open: a passing test of a false
  claim, which is the exact failure mode the repo's claims rule exists to stop. The test now uses a
  hostile `err.name = 'route 56.9,24.1 failed'`.
- Type: **Plan assumption wrong** (the review under-scoped its own finding).

**R2 — M2 was split rather than fixed or deferred whole**
- Planned (by the review): "a `res.status === 429` branch in both files … either that, or soften the
  docblock".
- Actual: took the *second* option now and filed the first as #100.
- Reason: the docblock claim is inside this PR and false today, so it is this PR's debt. The client
  work is `apps/dispatch` — a surface this PR never touched — and needs i18n strings in three
  catalogs plus RTL tests. A clean PR beats a sprawling one, and nothing is reachable today anyway:
  `mapsProviderSourceFactory` refuses to boot under `NODE_ENV=production`.
- Type: **Better approach found**.

**R3 — L4 declined despite being one word**
- Reason: the scenario it serves ("if the negative cache misbehaves against a real provider") is
  unreachable while no real provider is bound; done properly it is `.nonnegative()` **plus** a
  docblock **plus** an `env.schema.spec.ts` case, on a PR already at +1890. Recorded with that
  reasoning in #100 rather than dropped.
- Type: **Other** (scope discipline).

**R4 — a second, unplanned commit was needed for stale figures**
- Actual: `822bdcb` corrected the plan's task spec (line 282), the implementation report's gate
  figures, and the **PR body**.
- Reason: see "a one-token grep is not a sweep" above. The first fix commit corrected the docblock and
  one plan line and stopped there.
- Type: **Other** (incomplete first pass — the most instructive divergence in this slice).

## Skipped Items

- **M2's client work** (`apps/dispatch` SSR 429 branch + poll backoff honoring `retryAfterSeconds`) →
  **#100**. The proxy at `t/[token]/data/route.ts` already forwards 429 verbatim, so no change is
  needed there.
- **L4** (`MAPS_ETA_FAILURE_TTL_SECONDS` `.positive()` → `.nonnegative()`) → **#100**.
- **Level 4 step 3** → open for a human. Unchanged by the review round.

## Recommendations

> **Nothing here is applied. These are proposals for you to accept or reject** — no rules file was
> edited by the review round, and none will be without your say-so.

**No CLAUDE.md addition is proposed, and that is a deliberate finding.** The rule that would have
prevented this slice's worst moment already exists, verbatim and in bold: *"A number or a guarantee in
a comment, plan or PR body is a claim, not decoration."* It did not fail for being unwritten — it
failed for being applied to one file and not the other four. Adding a rule here would grow the file
without changing the outcome, which the repo's own anti-bloat stance warns against.

What is missing is a **check**, not a rule:

1. **`piv-fix-review-findings` should sweep by value, not by keyword.** When a fix changes a number
   that appears anywhere else, grep for *the number* (`455`, `10 concurrent`) across the plan, the
   implementation report, the PR body and the docblocks — not for the topic word. This slice found 2
   of 5 sites on the first pass. Cheapest possible fix, highest value of anything here.
2. **The PR body belongs in that sweep explicitly.** It is the one artifact that lives outside the
   repo, so no grep over the working tree can reach it, and it is the first thing the next reviewer
   reads. It went stale twice in this slice.
3. **`piv-validate` could name the environment failure modes.** Three of this slice's stalls were
   environment, not code — the compose project name, the Redis port, and a dead colima daemon. A red
   `@taxi/db#test` whose message is "Cannot connect to the Docker daemon" should be reported as an
   environment fault, not a test failure.

### One thing needing your decision

`836ddf1` — the implementation commit, from an earlier session — **amended
`services/api/CLAUDE.md`**: it rewrote the maps bullet to describe the two facades and added one new
bullet on sanitized failure logging and the eta-on/quote-off negative-cache asymmetry. The plan
sanctioned "at most one" addition and the implementation report records it as deviation #5. It is now
merged to `main`. Flagging it because you asked: if you did not want that, it is `git revert`-able in
isolation, and the review round's `safeErrorName` change is what finally made its "structural" claim
true rather than aspirational.
