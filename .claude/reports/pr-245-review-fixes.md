# PR #245 — review round 1 fixes

**Branch** `feature/short-tracking-links-sms-136` · **Review head** `b430dca` · **Code head after fixes**
`5e515a1` · **Applied** 2026-09-21 · worktree `~/taxi-worktrees/wt-136`

Review: https://github.com/linardsb/taxi/pull/245#issuecomment-5761315339

PR was OPEN (draft) at the start and at the end; `mergeStateStatus` was BLOCKED on `codeql`, which is the
one finding that had to close on CI rather than locally.

## Triage

No scope steer came with the invocation, so this was stated and proceeded on rather than asked.

| | Severity | Call | Where it went |
|---|---|---|---|
| F1 | High | **Fixed** | `a376d66` |
| F2 | Medium | **Fixed** | `5e515a1` |
| F3 | Medium | **Fixed** | `a376d66` |
| F4 | Medium | **Fixed** | `a376d66` |
| F5 | Medium | **Fixed** | `5e515a1` |
| F6 | Low | **Fixed** | `a376d66` |
| F7 | Low | **Fixed** | `5e515a1` |
| F8 | Low | **Deferred** | issue #246 |
| F9 | Low | **Fixed** | `5e515a1` |
| F10 | Low | **Fixed** | `5e515a1` |
| minor — duplicate one-char-path assertion | — | **Fixed** | `5e515a1` |
| minor — GSM-7 ESC-split not documented | — | **Fixed** | `5e515a1` |
| minor — `robots: { index: false }` | — | **Deferred** | issue #247 |
| AC #0 / D1 | — | **Human decides** | below |

## What was fixed, and the command that closes each

Every command below was run **against the fixed tree**, at the head named, before this line was written.

### F1 — High · `codeql` red, merge blocked · `packages/shared/src/tracking-link.ts`

`.replace(/\/+$/, '')` backtracks quadratically. Replaced with a `charCodeAt` loop.

**The fix had to be output-identical** — the production boot gate measures with this exact function and
the host term feeds the 70-character derivation. `observed`: 200,028 inputs (28 hand-picked plus a fuzz
over `h t p s : / a . # ? @`), **zero mismatches**.

**The regression test was watched failing against the unfixed body, and getting there took two attempts.**
The first fixture was `'https://a' + '/'.repeat(100_000)` and it **passed on the old code in 8 ms**. A
slash run that reaches the END of the string matches on the regex engine's first attempt; the quadratic
blow-up needs a NON-slash after the run, so every start position consumes it and then fails at `$`. With
the trailing `x` the old body takes **8892.7 ms** against the test's 250 ms bound. That correction is why
the fixture's trailing `x` carries a comment saying it is load-bearing.

`observed`, node 20, old body vs new, `'https://a' + '/'.repeat(n) + 'x'`:

| n | old | loop |
|---|---|---|
| 10,000 | 86.9 ms | 0.104 ms |
| 40,000 | 1.39 s | 0.010 ms |
| 80,000 | 5.60 s | 0.008 ms |
| 100,000 | **8.75 s** | 0.012 ms |

**The fix's own new failure mode** (the step this skill requires for a High): a hand-written index loop has
two failure modes a declarative regex does not — index underflow / non-termination if the `end > 0` guard
is ever dropped, and silent divergence from the regex semantics on a future edit. Both ship with tests
beside the ReDoS one: `empties out rather than under-trimming an all-slash tail` pins `'///'`, `''` and
`'https://'` all to `''`, and `strips the scheme and every trailing slash` pins that a configured path
prefix still SURVIVES (the property `new URL().host` would break).

Honest limit recorded in the docblock: the loop is **linear, not uniformly faster**. On 100k genuine
trailing slashes the regex matches in 0.121 ms and the loop walks them in 2.23 ms (`observed`).

**Closes on CI, not locally.** `gh pr checks 245` at `a376d66`, 2026-09-21 14:40 —
`codeql pass 1m30s`, `CodeQL pass`. One push-and-rescan cycle of the three the skill budgets.

```
$ npx vitest run --root packages/shared tests/tracking-link.test.ts     # at 5e515a1
  Tests  9 passed (9)          (was 6)
```

### F2 — Medium · the budget proof's fourth bound was a literal · `packages/shared/tests/sms-budget.test.ts`

`const PLATE_MAX_CHARS = 10` became `boundOf(vehicleSchema.shape.plate, 'vehicleSchema.plate')`.
`.maxLength` is `number | null` in zod 3.25.76, so `boundOf` throws when `.max()` is absent rather than
letting `'A'.repeat(null)` render NaN characters of plate.

**Both unbinding paths were watched failing**, where the review observed all 251 shared tests green before:

```
$ sed -i 's/.min(2).max(10)/.min(2).max(12)/' packages/shared/src/schemas/vehicle.ts
$ npx vitest run --root packages/shared tests/sms-budget.test.ts
  Tests  5 failed | 3 passed (8)     ← was 251 passed, 0 failed before the fix
  AssertionError: expected 'Водитель AAAAAAAAAA, AAAAAAAAAAAA, ~9…' to have a length of 71 but got 73

$ sed -i 's/.min(2).max(12)/.min(2)/' packages/shared/src/schemas/vehicle.ts
$ npx vitest run --root packages/shared tests/sms-budget.test.ts
  Error: vehicleSchema.plate has no .max(): the #136 SMS budget just lost its plate bound, …
  Tests  no tests               ← dies at module load, whole file red
```

Schema restored; `git status --porcelain` showed only the intended test file after.

### F9 — Low · the budget proof had no shipped negative · same file

Added the RU row one character over the ceiling. `observed` by running, not copied from the review:
**71 characters, 2 segments**. `renderAtBounds` takes an optional host to express it.

```
$ npx vitest run --root packages/shared tests/sms-budget.test.ts        # at 5e515a1
  Tests  8 passed (8)          (was 7)
```

### F3 — Medium · the contract seam credited a control the same diff contradicts

Both docblocks (`packages/shared/src/schemas/tracking.ts`, `…/tracking/tracking.service.ts`) now say the
96 bits are the whole defence against guessing, and that `TRACKING_VIEW_MAX_PER_WINDOW` is keyed per token
so it bounds polling of a KNOWN one — citing `notifications.policy.ts`, which already said so.

**The sweep found a copy the review did not flag**: the plan's own `schemas/tracking.ts` task carried the
same "rate-limited by `TRACKING_VIEW_MAX_PER_WINDOW`" instruction that produced the docblock. Corrected
there too, and marked so the wording is not restored. The research doc's wording ("rate-limiting
**views**") is accurate and was left alone — re-read at `docs/research/hosting-sms-cost-research.md:294`
rather than taken from the review.

### F4 — Medium · "128 random bits" survived the change to 96

`services/api/src/features/notifications/tracking/tracking.controller.ts:9` → `96 random bits (#136 cut it
from 128 for the SMS budget)`. The noun was swept tree-wide, not just this file — see the sweep below.

### F6 — Low · the hard cut-over breaks reads of pre-existing rows

`schemas/tracking.ts`'s cut-over comment now names the read path (`rideSchema` → `rides.repository.ts`
parses EVERY row) and the remedy (`UPDATE rides SET tracking_token = NULL`, or re-seed), including that
`scripts/mint-tracked-ride.ts` creates exactly such rows.

### F5 — Medium · an unconditional guarantee, tested at a sample

Two halves, both applied.

**The prose.** `ride-notifications.service.ts`'s docblock now states the guarantee is production-only and
why: three of the four bounds hold everywhere, the host gate does not. `observed` through the built `dist`
at the 14-character dev default with every other term at its bound — **LV 73 / 2 seg, RU 74 / 2, EN 72 /
1** (GSM-7 has 160 septets). The review's tipping-point example also reproduced: *Aleksandrs* (10) with
plate `LV-12345` (8) at a 5-minute ETA renders RU at **71 / 2**.

**The test.** The case named for the bound was testing nine characters inside it; renamed to *"a normal
body…"* with a comment saying it is a sample. New case overrides the host to the enforced ceiling and maxes
name, plate and ETA — 70 characters, no warn. `build()` gained a `baseUrl` option for that one case; the
file's default stays the dev origin `env.schema.spec.ts:106` documents on purpose, exactly as the review
asked.

**Falsified by removing the override** — the thing that proves it is not a duplicate of the case beside it:

```
  ● holds at the ENFORCED host ceiling with every term maxed (edge)
    Expected length: 70
    Received length: 74
```

```
$ pnpm --filter @taxi/api test -- ride-notifications.service.spec     # at 5e515a1
  Tests:       18 passed, 18 total      (was 17)
```

One correction made mid-fix: the first draft of this docblock attributed the 73/74 figures to "a
10-character name and an 8-character plate". That is the *tipping point* example, not the every-term-at-bound
one. Re-derived and split into two sentences.

### F7 — Low · the `lv` rewrite assertion was self-referential

`join(__dirname, '[token]', 'page.tsx')` → `join(__dirname, '..', TRACKING_PATH_BY_LANGUAGE.lv, …)`.

**Falsified with the review's own mutation** (`lv: 't'` → `'q'`, rebuild shared), which left this file
green before:

```
  × serves the lv link from the real route, with no rewrite (expected)
    → /…/apps/dispatch/src/app/q/[token]/page.tsx: expected false to be true
```

The review's **refutation is preserved** and not re-raised: this never left `lv` unguarded, because
`packages/shared/tests/tracking-link.test.ts` reddens on that mutation. The fix is legibility.

### F10 — Low · a bill figure with no provenance

`.claude/reports/short-tracking-links-sms-136-report.md` now shows 2 templates × 1 segment × 129 phone
rides = 258 as shipped, 129 with the scheme restored, names 129 as **worst case** (EN `driver_assigned`
renders 74 with the scheme and stays 1 segment, `observed`, so the ceiling is 258), and states that the
129 rides/mo inherits research §4.3's 30% phone-booked share **which §4.3 itself labels evidence-free**.
Also notes the figure equals the ride count by construction, not by transcription.

The same claim's copy in the plan was found by the sweep and corrected the same way — and that copy had a
second defect the review did not see: it named only LV and RU, writing "both ≤ 70" where the report names
all three languages.

### The two batched minor items

- `apps/dispatch/src/app/t/tracking-rewrites.test.ts` — dropped the trailing `TRACKING_PATH_BY_LANGUAGE`
  one-character assertion; `packages/shared/tests/tracking-link.test.ts` owns it. The rewrite-source
  assertion at the same case stays, with a comment saying why the split is where it is.
- `packages/shared/src/sms-segments.ts` — documents the GSM-7 mirror of the unmodelled UCS-2 boundary
  (TS 23.038 §6.2.1.1 forbids splitting ESC+char, so a concatenated segment holds 152 septets not 153).
  `observed` rather than asserted: `~` **is** in all three `driver_assigned` templates, and EN renders 69
  septets at the enforced host / 73 at the dev default, against a 160-septet single-segment limit — so
  neither boundary is reachable, because nothing here reaches a concatenated GSM-7 body at all.

## Deferred

**F8 → issue #246 — `PUBLIC_TRACKING_BASE_URL` is validated by length, not shape.** Reproduced first:
`https://sakta.lv#f` strips to `sakta.lv#f`, exactly 10 characters, **boots**, and then texts riders
`sakta.lv#f/r/<token>` where the fragment swallows the path. The other four malformed forms are refused,
but by length rather than validation.

Deferred deliberately, not by omission, for two reasons that are decisions rather than typing:

1. **Where the rejection belongs.** Putting it in `trackingLinkHost` makes a pure string function throw
   **on the rider SMS send path** — a new failure mode worse than the bug. Its home is a `.refine()` in
   `env.schema.ts`, which already owns the boot gate.
2. **The `i` flag is not output-preserving.** It flips `HTTPS://SAKTA.LV` from refused (16 characters) to
   accepted (8), changing the boot gate's verdict on an existing input. Needs its own test and its own call.

**Minor → issue #247 — no `robots: { index: false }` on the public tracking page.** Pre-existing; the
review said its own ticket. Confirmed rather than assumed: `grep -rn "robots" apps/dispatch/src
apps/dispatch/next.config.ts apps/dispatch/public` returns **no hits**. #136 is what makes it worth raising
— it took the public URL surface from one shape to three.

## Human decides

**AC #0 / D1 — the handset spike did not run.** Not a defect and not fixable here: does a bare
`sakta.lv/r/…` linkify in a real SMS client? It needs a verified handset and a person looking at it. The
plan's AMENDMENTS carries the `curl` pair; the revert is one line. F10's work above now states what it
costs if it goes the other way, with the arithmetic. **Linards owns this before merge.**

## The retired-value sweep

Run at `5e515a1` with path-only exclusions — piping through `grep -v node_modules` eats CONTENT lines that
merely mention it. Script kept at `scratchpad/sweep.sh`. Each row is the literal searched, not the topic
word.

| `grep -rn --exclude-dir={node_modules,dist,.next,.git,.turbo} -- '<value>' .` | Hits | Verdict |
|---|---|---|
| `128 random` | none | ✅ retired |
| `128 bits` | `services/api/src/common/config/env.schema.ts:46` | ✅ **correct, left alone** — that one is `openssl rand -hex 32`, re-read not inherited |
| `rate-limits guessing` | none | ✅ retired |
| `rate-limited by` | `.claude/plans/short-tracking-links-sms-136.md:492` | ✅ that is the correction note itself |
| `cannot fire` | 9 hits, all unrelated historical artifacts | ✅ the live one was the **PR body**, which no working-tree grep reaches — fixed there |
| `1m36` | `.claude/last-gate.json` + 3 unrelated reviews/reports | ✅ see below |
| `b430dca` | `.claude/last-gate.json` only | ✅ see below |
| `251 passed` | report `:71`, `.claude/last-gate.json`, one unrelated report | ❌ **report was stale → fixed** |
| `746 passed` | report `:70`, plan `:943`, `.claude/last-gate.json` | ❌ **both stale → fixed** |
| `785 total` | same three | ❌ **both stale → fixed** |
| `19 passed (19)` | none in tree | ✅ the live one was the **PR body** — fixed there |
| `7 assertions` | report `:83` | ❌ **stale → fixed, now 8** |
| `halves to 129` | plan `:1106` | ❌ **stale → fixed with the arithmetic** |

**`.claude/last-gate.json` is gitignored** — `git ls-files` returns nothing for it. It is a local machine
record of one run at `b430dca`, not a claim this repo makes, so it was left rather than hand-edited.

**Five stale copies the review did not flag** were found this way: the report's shared count, the report's
and the plan's api counts, the report's "7 assertions", and the plan's copy of F10's figure. That is the
CLAUDE.md rule doing its job — the numbers had flowed plan → report → PR body and were being inherited.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck
lint test build --force` in the worktree at **`5e515a1`**, `dist` and `.next` cleared first, **exit 0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m31.041s
```

| Package | This run |
|---|---|
| `@taxi/api` | `Test Suites: 81 passed, 81 total` · `Tests: 786 passed, 786 total` |
| `@taxi/shared` | 27 files, 255 passed |
| `@taxi/dispatch` | 29 files, 268 passed |
| `@taxi/driver` | 44 suites, 250 passed |
| `@taxi/rider` | 30 suites, 145 passed |
| `@taxi/db` | 3 files, 17 passed |

Nothing skipped, because this run sets `REDIS_TEST_URL` as CI does. Reconciles with the pre-fix figures:
746 + 39 gated + 1 new case = **786**; shared 251 + 3 (F1) + 1 (F9) = **255**.

**Per-file, re-run at `5e515a1`** — the PR body's `19 + 4 + 6 = 29` is now `23 + 4 + 6 = 33`:

```
npx vitest run --root packages/shared tests/sms-segments.test.ts tests/tracking-link.test.ts tests/sms-budget.test.ts
  sms-segments 6 · tracking-link 9 · sms-budget 8        → Tests 23 passed (23)
npx vitest run --root apps/dispatch src/app/t/tracking-rewrites.test.ts
  tracking-rewrites 4                                     → Tests  4 passed (4)
pnpm --filter @taxi/api test -- sms-templates.spec
  sms-templates 6                                         → Tests: 6 passed, 6 total
```

**The "proved to bite" pair re-run at `5e515a1`, not carried over:** restoring `Sekojiet līdzi: ` to LV
`driver_assigned` is still exactly **1 failure** (`length of 69 but got 85`); `TRACKING_LINK_HOST_MAX_CHARS`
10 → 11 is now **8** assertion failures, every one on length, up from 7 because F9 added the negative.
Both mutations reverted, `git status --porcelain` clean, suite green after.

**The gate ran at `5e515a1`, which is the final CODE head.** Commits after it are this report and the
review artifact only — no test, lint rule or build step reads either, so the figures above do not go stale
on them. That ordering is deliberate: a report that quotes figures its own commit then moves is stale by
construction.

## What the next round should check

- `codeql` staying green is the acceptance for F1, not the local gate. It was green at `a376d66`; confirm
  at the final head.
- F5's new case asserts a length of 70 at a synthetic ceiling host. If `TRACKING_LINK_HOST_MAX_CHARS` ever
  moves, that number moves with it and the api spec is now a fourth place it lives.
- The two deferrals are #246 and #247, neither blocking.
- AC #0 is still open and is the only item that changes what ships.
