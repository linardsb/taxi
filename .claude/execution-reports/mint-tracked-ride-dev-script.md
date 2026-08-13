# Execution Report — `mint:ride`, the live tracked-ride paid-call instrument

**Issue**: #94 (Level 4 step 3) · **PR**: [#107](https://github.com/linardsb/taxi/pull/107), merged `8f83b4a` on 2026-08-13
**Plan**: `.claude/plans/mint-tracked-ride-dev-script.md`
**Implementation report**: `.claude/reports/mint-tracked-ride-dev-script-report.md`
**Review**: `.claude/code-reviews/pr-107-review.md`

## Provenance of this report — read first

This report covers **two phases run by two different sessions**, and they are not equally well evidenced:

| Phase | Commit | Session | This report's basis |
|---|---|---|---|
| Implementation | `13cf8b0` | **not this one** | Second-hand: the plan, the implementation report's 10 documented deviations, and the review. The *what* is verifiable from the diff; the *why* is quoted from the implementing session's own report, not reconstructed by me. |
| Review fixes | `00e5699`, `5ce3724` | **this one** | First-hand. |

`system-execution-report` warns that a cold session "can see what changed but not why." That guard applies
to the implementation half. It is largely mitigated — the implementing session left an unusually complete
report — but where this document explains an implementation decision, it is **relaying**, not recalling.
Nothing in the Divergences section below is my inference; each is quoted or paraphrased from that report.

## Meta

**Files added**
- `services/api/scripts/mint-tracked-ride.ts` (+898 final)
- `.claude/plans/mint-tracked-ride-dev-script.md` (+565)
- `.claude/reports/mint-tracked-ride-dev-script-report.md` (+252)

**Files modified**
- `services/api/package.json` — `mint:ride` entry, lint glob widened to `{src,test,scripts}/**/*.ts`
- `services/api/tsconfig.build.json` — `scripts` added to `exclude`
- `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts` — `+371290` claimed in the E.164 registry (docblock reflow only)

**Lines changed**: +1791 / −17 across the branch (implementation `+1692/−6`; review fixes `+48/−16`)

## Validation Results

| Check | Result |
|---|---|
| Syntax & Linting | ✓ 0 errors (7 pre-existing `no-unsafe-argument` warnings in spec files, none in `scripts/`) |
| Type Checking | ✓ `tsc --noEmit` against `tsconfig.json`, which has no `exclude` — so `scripts/` is genuinely covered |
| Unit + Integration Tests | ✓ 461 passed / 0 failed, 54 suites (`@taxi/api`), 21/21 turbo tasks |
| Build | ✓ `dist/main.js` present, `dist/scripts` **and** `dist/src` absent — both `rootDir`-inference symptoms checked, not just the obvious one |
| CI parity gate | ✓ run [31570530203](https://github.com/linardsb/taxi/actions/runs/31570530203), 3m32s, on final head `5ce3724` |

**Tests added: none, deliberately** — per the plan's Non-Goals. The script is an instrument, not a test:
it never runs under jest and asserts nothing in CI. Its correctness rests on four self-checks that run
inside every invocation (positive control, filter control, distinctness, parameter guard), all of which
fired during validation.

**The local integration gate was not re-run during the review-fix phase.** 31 `claude`-matching processes
were live and global-setup drops the shared test DB; re-running would have destroyed another session's run
for no information, since the fixes touch nothing under `src/` or `test/`. Typecheck, lint and build were
run locally; CI ran the full parity gate. This follows the precedent the reviewer set for the same reason.

**Not proven by a run:** the rewritten `report()` output and the two teardown guards were never executed
live — a run is blocked by the environment defect below. Covered by typecheck, lint and inspection only.

## What Went Well

- **The instrument found a real environment defect on its first startup.** AC #2's diagnostic printing is
  what discovered that this checkout's config points `REDIS_URL` at the password-protected 6379 tunnel
  instead of compose's 6381. A diagnostic that pays for itself before the measurement even begins is the
  best possible argument for building it.
- **Zero could not read as success.** The single largest design risk — a silently broken log capture
  printing "0 calls across 30 polls" as a triumphant pass — was closed by a positive control that runs
  *before* any zero is trusted, and it was genuinely exercised (interception disabled → exit 1, not a
  quiet pass). The distinctness assertion (`distinct(cell) === CELLS`) separately rules out "one corridor
  routed 6×" masquerading as "6 corridors routed once."
- **Deviation reporting was exemplary, and the reviewer credited it.** All 10 divergences were documented
  with reasons; the review explicitly called out notes 2–7 as "honest self-disclosure," including
  "implemented but never exercised" for two AC branches and a stated departure from AC #9.
- **Triage-before-fixing worked again.** The review offered two fixes for H1 and named it a judgement call.
  Neither was taken as written — a third path (relabel, following the file's own `NAME THE HEADING`
  precedent at `:760-771`) was better than both, and (b) turned out to be actively wrong here: it rewrites
  the measuring instrument to fix a label, unverifiably, when the review itself called this "a reporting
  defect, not a broken control."
- **The build config was verified against the right symptom.** `dist/src` absent, not merely `dist/main.js`
  present — a stale build would satisfy the naive check. The review singled this out as "the check most
  people skip."

## Challenges Encountered

*(1–5 relayed from the implementation report; 6–7 first-hand.)*

1. **The environment defect masked itself as a code failure.** `RedisIoAdapter.connectToRedis` assigns its
   two ioredis clients only after both ping, so a failure there leaks two clients retrying forever and
   buries the real error under a scroll of `NOAUTH`. Restructuring diagnostics to probe through the app's
   own `KeyValueStore` *before* the socket adapter connects is what turned an undiagnosable hang into one
   named line.
2. **`pnpm --filter` buffers a child script's stdout when piped**, making the first run look like a silent
   three-minute hang. No code change; worth knowing before diagnosing a "hang."
3. **The OTP throttle produced a bare `429` that read like a script bug.** `OTP_MAX_REQUESTS_PER_HOUR` = 5
   runs/hour/phone with a 60 s cooldown, and the fixture phones are fixed. Now named explicitly, importing
   the constants rather than retyping the numbers.
4. **`GET /drivers/me` returns `{ profile, vehicles }`**, so the first teardown printed
   `driver status after cancel → undefined`.
5. **A 24 h quote-corridor TTL would have broken idempotence.** The plan cleared only the two `eta` keys;
   any second run inside 24 h would hit the quote cache, emit no `caller:'quote'` event, and fail the
   plan's own filter-discrimination assertion. Caught during implementation, not by the plan.
6. **The headline number was wrong, and every routine check passed anyway.** See below — this is the
   finding that matters.
7. **My own first fix was half a fix.** I corrected the figure on all four surfaces, grepped `30 → 6` to
   confirm, and reported four surfaces consistent. The same claim was still alive in four lines of *prose
   attribution* ("the quantized cache **this script measures**", "the cache, the counter and **the grid**
   are what is under observation"), including one in the PR body. A verification that targets the figure
   does not catch the claim. Fixed in `5ce3724`, after a second look.

## Divergences from Plan

The implementation report documents 10, all classified there as intentional. Summarised; the full text
with reasoning is in that report.

| # | Planned | Actual | Type |
|---|---|---|---|
| 1 | Clear the two `eta` keys | Also clear the **quote** corridor (86 400 s TTL would break idempotence) | Plan assumption wrong |
| 2 | Ping near the walk start | Ping at **cell 0 exactly** — any other start is a 7th uncleared corridor | Better approach found |
| 3 | Diagnostics after boot | Diagnostics + Redis probe **before** the socket adapter connects | Better approach found |
| 4 | (spec's `afterEach` writes `rides.status`) | Cancel **over the wire** through `assertTransition` | CLAUDE.md hard rule |
| 5 | AC #9 says leave driver `online` | Left **`offline`** — an `online` driver with no process is ghost presence | Better approach found |
| 6 | "view 1 costs 1" | "exactly one paid view **in this cell**" — a confirmation read may legitimately cost 0 | Plan assumption wrong |
| 7 | — | `MOVE_CONFIRM` capped at `POLLS_PER_CELL` so the budget guard's arithmetic is a true worst case | Better approach found |
| 8 | (open question 3) | `MINT_CELLS` / `MINT_POLLS_PER_CELL` overrides | Resolved open question |
| 9 | — | OTP-throttle diagnosis + stated run ceiling | Better approach found |
| 10 | "≲400, under the ~500 cap" | **880 lines**, with the arithmetic against sibling non-slice files shown | Justified overrun |

**Divergence 11 — added at review, not by the implementer:**

- **Planned**: report the unquantized counterfactual as **30**, a 5× reduction attributable to #87's ETA grid.
- **Actual**: relabelled as arithmetic-under-an-absent-condition; the true unquantized cost of this walk is **6**.
- **Reason**: `cellLocation` already rounds to `TRACKING_ETA_GRID_DECIMALS` (3 dp) and the walk emits one
  position per cell before polling it unchanged, so `quantizeForEtaCache` (`toFixed(3)`) is an **identity
  function** for the entire run. The zeros the script observes come from `CachingMapsProvider`'s 4-dp
  corridor cache, which predates #87.
- **Type**: **Plan assumption wrong — inherited unaudited into the implementation.**

## Skipped Items

- **Level 4 step 6** (dispatch-page cross-check) — optional in the plan, not run.
- **AC #2's missing-geozone branch** and **AC #11's role-mismatch branch** — implemented, never exercised;
  the seed is present and both fixture phones hold the right roles. The implementation report states this
  explicitly rather than implying green.
- **H1 option (b)**, making the counterfactual genuinely measurable — deferred to **#108** with the loop
  restructure and the `5e-5` tolerance trap written up.
- **The two environment findings** (Redis URL, OTP cap) — relayed, not filed. They block a live re-run,
  and therefore block #108.

## Recommendations

### The finding: #87's remedy did not match #87's diagnosis, and #107 is the receipt

This is the second consecutive occurrence of one failure mode, and the loop already ran on the first one.
`.claude/system-reviews/tracking-eta-maps-quantized-cache-review.md` diagnosed #87 precisely:

> `root_cause: MISSING VALIDATION — no gate anywhere in the loop checks a prose claim against the code it describes. typecheck/lint/test cannot see a comment.`

The action taken was:

> `[x] Add a hard rule that a quantitative claim in a comment, plan, or PR body is a checkable assertion — show the derivation, and name which case a figure describes.`

**The diagnosis was "no gate exists." The remedy was a prose rule** — which is not a gate, and is the same
class of artifact that failed. #107 then shipped a number labelled **Observed** that nothing observed,
while the script quoted that very rule four lines below the offending figure.

Worse, #87's review **predicted the exact recurrence mechanism** and filed it as an observation with no
corresponding action item:

> *"A plan's numbers are inherited, not audited. The implementer copied `~15 s` from the plan; the reviewer re-derived it and found it wrong. Nothing between those two points would have."*

#107 reproduced this verbatim. The `30` originated at `plan.md:447`, was inherited into both the script and
the report unaudited, and only the reviewer re-derived it. One ticket later, the prediction came true
because it was logged as a learning rather than turned into a step.

### Why the rule didn't catch it — a real gap, not just non-compliance

AC #7 reads *"Every number in the report is either an imported policy constant or shown with its
arithmetic, and the summary names the heading it describes"* — and was marked **MET**. That marking was
defensible: `30 = 6 cells × 5 polls` **is** true arithmetic, and the heading case **was** named.

The rule asks for *arithmetic* and *which case*. It does not ask **provenance** — did a run produce this
figure, or did I compute it? — or **attribution** — which mechanism is being credited? Both false parts of
H1 sit in exactly that hole. The rule was satisfied in form while the claim was false.

That is a rule defect, and it explains why a demonstrably careful session (10 documented deviations, honest
"not exercised" disclosures, constants imported rather than retyped) shipped it anyway.

**Suggested CLAUDE.md amendment** — add the missing clause rather than restating the rule:

> Every figure in a report or PR body carries its **provenance**: `observed` (name the run), `derived`
> (show the arithmetic *and* the condition it assumes), or `expected` (not yet run). A number under an
> **Observed** heading that no run produced is the defect. When a figure credits a mechanism, say what was
> held constant to isolate it — if nothing was, it is not evidence for that mechanism.

### Where the gate actually belongs

The rule needs a forcing function, and there are two cheap ones:

1. **`piv-review-pr`** — add a numbers pass: enumerate every figure in the report/PR body and ask of each,
   *which run produced this?* This review caught H1 by doing it ad hoc; making it a step makes it repeatable.
   This is the highest-value single change, because the reviewer is the only actor who currently re-derives.
2. **`piv-plan-implementation`** — a plan's quantitative claims must carry provenance at authoring time.
   `30` entered at the plan stage and was never audited again. Fixing it at the review stage catches it;
   fixing it at the plan stage prevents it.

### For `piv-fix-review-findings` (first-hand, this session)

- **Verify the claim, not the figure.** I grepped `30 → 6`, found nothing, and declared four surfaces
  consistent — while four lines of prose still asserted the script *measures* the quantized cache. The skill
  should say: after fixing a claim, grep for the **subject** (`quantiz`, `grid`, `#87`) and re-read each hit,
  not just the number's sentence form.
- **Enumerate the claim's surfaces before fixing.** The review cited three locations; there were four. The
  PR body is the most-read surface and the easiest to forget because it is not in the working tree.
- The PR-state guard added after #87 **worked** — it confirmed #107 was still `OPEN` before any edits.

### Housekeeping

- `.claude/code-reviews/pr-107-review.md` is still untracked on `main` — the same leftover-artifact pattern
  that `docs/session-artifacts-88` existed to clean up.
- The Redis URL and OTP-cap environment defects block a live re-run of `mint:ride`, and therefore block
  #108. Worth fixing before the next person tries to use the instrument this ticket built.
