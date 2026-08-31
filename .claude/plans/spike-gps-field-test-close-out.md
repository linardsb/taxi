# Feature: Spike #4 close-out — GPS field-test analysis tooling + verdict

The following plan should be complete, but validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils, types and models. Import from the right files etc.

## Feature Description

Issue #4 (background-GPS spike gating driver-app ticket #14) is **half done**: the throwaway Expo harness (`spikes/gps-harness/`) and the field protocol (`docs/spikes/04-gps-field-test.md`) are on main; the field drive is pending (Linards, human step). What remains is everything that turns raw drive data into the gating decision:

1. An **analysis script** that ingests the harness's exported `fixes.jsonl` and computes the exact metrics the protocol's PASS/FAIL table gates on — so the verdict is arithmetic, not eyeballing.
2. The **human field drive** (blocking gate — the agent prepares, pauses, resumes when data lands).
3. The **verdict write-up** in the spike doc + GitHub closeout (close #4, link the call on #14).

This is a spike: docs + throwaway tooling, **zero production code**.

## User Story

As the solo builder (Linards)
I want the field-drive data reduced to a mechanical PASS/FAIL verdict and recorded where the sibling spikes record theirs
So that #14 (driver app) is designed on measured ground — background streaming as designed, or the free mounted-phone pattern.

## Problem Statement

The drive will produce 2–4 JSONL files of ~600 fixes each. The PASS/FAIL table gates on derived statistics (gap percentiles *while moving*, batch sizes, battery %/hr) that are error-prone to compute by hand — and a wrong verdict here means building the driver app on sand or paying an unnecessary UX tax. There is currently no analysis tooling and no results section in the spike doc.

## Solution Statement

A single **zero-dependency Node script** (`spikes/gps-harness/analyze.mjs`) with an embedded `--selftest`, run once per exported file; its markdown output is pasted into a new "Field results" section of `docs/spikes/04-gps-field-test.md`, whose status line then flips to the sibling-spike **Verdict** format. GitHub closeout via `gh`. The plan has an explicit human gate between tooling and verdict.

## Out of Scope / Non-Goals

- **Not building any of #14** (fix queue, dark-detection, socket streaming) — this ticket only decides #14's shape.
- **Not touching the harness app** (`App.tsx` etc.) — it's done, ratified in issue comments, installs and typechecks clean.
- **Not reopening decided questions**: Transistorsoft/paid libraries **rejected** (Linards, 2026-08-04 — free options only); client-side JSONL logging **replaces** the ticket's original "server echo sink" idea (already built and ratified); fallback is the mounted-phone/keep-awake pattern.
- **Not creating `docs/decisions/`** — the ticket's original deliverable path is superseded by repo convention (see Open Questions #1).
- **Not adding the harness to the pnpm workspace** — it stays outside; `pnpm check`/turbo must never see it.

## Feature Metadata

**Feature Type**: Spike close-out (docs + throwaway tooling)
**Estimated Complexity**: Low (agent work ~200 lines of script + doc edits; the calendar risk is the human drive)
**Primary Systems Affected**: `spikes/gps-harness/` (additive), `docs/spikes/04-gps-field-test.md`, GitHub issues #4/#14
**Dependencies**: Node ≥18 (already required by the repo). No new packages.

## Related Work

**Implements**: [#4 — Spike: Expo background GPS field test](https://github.com/linardsb/taxi/issues/4) · **Epic**: #1, architecture doc `docs/epics/sakta-cab.architecture.md` § "Spikes & experiments" item 2

**Back-references**:

- Issue #4's three comments — the authoritative state: harness+protocol done, Transistorsoft rejected 2026-08-04, spike branch merged to main.
- `docs/spikes/03-arrivals-data.md`, `docs/spikes/05-payout-rails.md` — the verdict-format convention this close-out must match.

**Forward-references**:

- The future #14 plan (driver app) consumes this verdict — its location slice is designed per the call made here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `docs/spikes/04-gps-field-test.md` (all 49 lines) — Why: the protocol, the exact PASS/FAIL thresholds (lines 40–46), the harness description. **This file is also the deliverable target.**
- `spikes/gps-harness/App.tsx` (lines 23–31) — Why: the `Fix` JSONL schema the analyzer parses: `{ts, recvTs, lat, lng, acc, speed, battery}`; `ts` = GPS fix ms-epoch, `recvTs` = JS task receive time (batching delay = `recvTs - ts`), `battery` 0..1 or `-1`, `speed` m/s or `null`.
- `spikes/gps-harness/App.tsx` (lines 75–89) — Why: the exact `startLocationUpdatesAsync` options; **`distanceInterval: 10` means a stationary phone legitimately produces no fixes** — the central analytical gotcha (see Patterns).
- `docs/spikes/03-arrivals-data.md` (lines 1–4) — Why: the sibling verdict format to mirror: `**Verdict: <call> → <consequence>.** ... Issue [#N](...), gates #M.`
- `docs/epics/sakta-cab.architecture.md` (§ "Spikes & experiments", item 2) — Why: the inherited decision rule this ticket executes.

### New Files to Create

- `spikes/gps-harness/analyze.mjs` — zero-dependency analysis script with embedded selftest
- `spikes/gps-harness/data/` — drop-zone for exported run files (created by the human gate; convention: `android-default.jsonl`, `android-unrestricted.jsonl`, `ios.jsonl`)

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- Issue #4 comments (`gh issue view 4 --repo linardsb/taxi --comments`) — Why: the decision history; comment 2 is the free-only ruling; comment 3 confirms everything lives on main.
- Issue #14 (`gh issue view 14 --repo linardsb/taxi`) — Why: the consumer of the verdict; the closeout comment lands there.
- No external library docs needed — the analyzer is plain Node (`fs`, `path` only).

### Patterns to Follow

**Sibling spike verdict line** (mirror exactly, `docs/spikes/03-arrivals-data.md:3`):

```markdown
**Verdict: <one-line call> → #14 <consequence>.** <one-sentence nuance>. Issue [#4](https://github.com/linardsb/taxi/issues/4), gates #14.
```

**Moving vs stationary gap classification** (the one piece of real logic): the harness uses `distanceInterval: 10`, so no fixes arrive while stopped at a light — those gaps are legitimate and must NOT count against the "gap while moving" thresholds. Rule: a gap between fixes A→B is **MOVING** if haversine(A, B) ≥ 15 m **or** max(A.speed ?? 0, B.speed ?? 0) ≥ 1.5 m/s; else STATIONARY. Report both the moving-only distribution (the gated one) and the unfiltered distribution (honesty check).

**Verdict zones**: the protocol table has deliberate gaps — max gap in (60 s, 120 s], or battery in (8, 12] %/hr, is neither PASS nor FAIL. The script must emit **INCONCLUSIVE** with the offending metric; the human makes that call. Do not silently round into PASS.

**Throwaway-code register** (`App.tsx:1–2`): plain, hardcoded, no i18n/theme — the monorepo hard rules (shared contracts, i18n, VSA) do not apply inside `spikes/`. Keep the analyzer in that register: one file, no config, no abstractions.

**Commit style** (recent history): `docs(spikes): ...` / scoped conventional commits; branch from **fresh `origin/main`** — the currently checked-out `feature/api-ride-lifecycle` belongs to another loop (concurrent sessions share this repo; check `git reflog -8` first).

---

## IMPLEMENTATION PLAN

### Phase 1: Analysis tooling + doc scaffold (agent, now)

**Independent of:** the field drive — the drive uses the harness already on main; Phase 1 and the drive can happen in parallel.

**Tasks:** build `analyze.mjs` with selftest; scaffold the "Field results" section; commit on a fresh branch.

### Phase 2: Field drive (HUMAN GATE — Linards)

**Independent of:** Phase 1 (see above). Blocks Phase 3.

The protocol is already written (`04-gps-field-test.md` § "Field protocol"). Agent's job: after Phase 1 validation, **STOP and report** — print the drive checklist, the build command (`cd spikes/gps-harness && pnpm install --ignore-workspace && npx expo run:android`), and where to drop exports (`spikes/gps-harness/data/`). Android on **Atis's actual phone** is the decisive run.

### Phase 3: Verdict + closeout (agent, after data lands)

**Depends on:** Phase 1 (script) + Phase 2 (data files exist).

**Tasks:** run the analyzer per file; fill "Field results"; flip the status line to a Verdict; comment + close #4; comment on #14; final commit + PR.

---

## STEP-BY-STEP TASKS

### 1. CREATE `spikes/gps-harness/analyze.mjs`

- **IMPLEMENT**: `node analyze.mjs <run.jsonl> [more.jsonl...]` and `node analyze.mjs --selftest`. Zero dependencies (`node:fs`, `node:path` only), Node ≥18. Per file:
  - Parse JSONL; skip malformed lines with a warning count; empty/unreadable file → clear error, exit 1.
  - Sort fixes by `ts`. **Split into sessions** where a consecutive-`ts` delta exceeds 10 min (handles a forgotten "Clear" between runs); report each session separately.
  - Per session: duration, fix count; consecutive-`ts` gap distribution — median/p95/p99/max — **twice**: moving-only (gated) and unfiltered; list every gap >15 s with local time, MOVING/STATIONARY tag, bounding speeds and haversine distance; batch stats grouped by shared `recvTs` (size p95, delivery delay `recvTs−ts` median/p95/max); battery %/hr from first/last `battery ≥ 0` (negative drain → report "charging", don't gate).
  - Emit a ready-to-paste **markdown block** per session: metrics table + verdict line `PASS` / `FAIL` / `INCONCLUSIVE (<metric>)` evaluated against the thresholds hardcoded from `04-gps-field-test.md:40–46` (PASS: moving-gap median ≤5 s, p95 ≤15 s, p99 ≤30 s, max ≤60 s, batch p95 ≤3, battery ≤8 %/hr · FAIL: any moving gap >120 s, sustained multi-minute batching, battery >12 %/hr · else INCONCLUSIVE).
- **PATTERN**: throwaway register per `App.tsx:1–2`; one file, no config.
- **GOTCHA**: gap metrics from `ts` (GPS time), batching from `recvTs` — never mix them. `ts` can be a float. `speed` can be `null`.
- **VALIDATE**: `node spikes/gps-harness/analyze.mjs 2>&1 | grep -qi usage` (no-args prints usage, doesn't crash)
- **SATISFIES**: ticket deliverable "measured gap distribution"

### 2. ADD `--selftest` to `analyze.mjs`

- **IMPLEMENT**: three embedded synthetic fixture arrays run through the same pipeline, asserting the verdicts: (a) clean 4 s cadence, moving → `PASS` (expected); (b) 45 s gap with both bounding fixes stationary (speed 0, <15 m apart) correctly excluded from the moving distribution → still `PASS` (edge); (c) Doze-batched stream — a 130 s moving gap + deliveries sharing one `recvTs` with multi-minute delay → `FAIL`, plus one malformed line skipped with a warning (failure). Any assertion mismatch → nonzero exit.
- **PATTERN**: repo test philosophy (≥1 expected + 1 edge + 1 failure) applied inside the one file — no test framework in a throwaway.
- **VALIDATE**: `node spikes/gps-harness/analyze.mjs --selftest && echo SELFTEST-OK`
- **SATISFIES**: verdict trustworthiness (the numbers gate a build decision)

### 3. UPDATE `docs/spikes/04-gps-field-test.md`

- **IMPLEMENT**: (a) under "### Build & run", add a short "### Analyzing a run" subsection: the `node analyze.mjs data/<run>.jsonl` command and the `data/` naming convention (`android-default` / `android-unrestricted` / `ios`); (b) append an empty `## Field results` section with one placeholder subsection per protocol run, to be filled in Task 6.
- **PATTERN**: keep the doc's existing voice; surgical additions only — do not rewrite existing sections.
- **VALIDATE**: `grep -q "## Field results" docs/spikes/04-gps-field-test.md`
- **SATISFIES**: deliverable scaffold

### 4. Commit Phase 1 on a fresh branch

- **IMPLEMENT**: `git fetch origin && git switch -c spike/gps-field-close-out origin/main`, commit `spikes/gps-harness/analyze.mjs` + doc edit (`feat(spikes): analysis script + results scaffold for GPS field test (#4)`), via the piv-commit skill.
- **GOTCHA**: do NOT branch from `feature/api-ride-lifecycle` (another loop's branch, currently checked out). Verify `git status` clean first; concurrent sessions share this repo.
- **VALIDATE**: `git log --oneline -1` shows the commit; `git diff origin/main --stat` touches only `spikes/gps-harness/` + `docs/spikes/04-gps-field-test.md`
- **SATISFIES**: drive and tooling can now proceed in parallel

### 5. ⛔ HUMAN GATE — field drive (Linards)

- **IMPLEMENT** (agent): STOP after Task 4 validation if `spikes/gps-harness/data/*.jsonl` doesn't exist. Report: protocol summary (30–45 min central-Rīga drive per platform, screen locked; Android ×2 — default + battery-exemption; iOS force-quit test), build command, export destination `spikes/gps-harness/data/`. Android on Atis's phone is the decisive run.
- **VALIDATE**: `ls spikes/gps-harness/data/*.jsonl` — Phase 3 starts only when this is non-empty.

### 6. UPDATE `docs/spikes/04-gps-field-test.md` — fill Field results

- **IMPLEMENT**: run `node analyze.mjs` on each file in `data/`; paste each markdown block into its placeholder subsection, noting phone model + OEM + Android/iOS version per run (OEM battery policy is the known risk). Commit the raw `data/*.jsonl` files alongside (small, ~100 KB/run — they're the evidence).
- **GOTCHA**: if a run is INCONCLUSIVE, present the numbers to Linards and ask for the call — do not decide unilaterally.
- **VALIDATE**: `node spikes/gps-harness/analyze.mjs spikes/gps-harness/data/*.jsonl` exits 0 and its verdict lines match what the doc says
- **SATISFIES**: ticket deliverable "measured gap distribution and the call"

### 7. UPDATE the doc's status line → Verdict

- **IMPLEMENT**: replace line 3's "Status: … field drive pending" with the sibling format, e.g. PASS: `**Verdict: background streaming holds on the pilot phones → #14 proceeds as designed with the harness's exact startLocationUpdatesAsync options.** Issue [#4](…), gates #14.` — or FAIL: `**Verdict: background streaming is lossy → #14 is designed around the free mounted-phone pattern (expo-keep-awake, best-effort background, server-side gap tolerance).** …`
- **PATTERN**: `docs/spikes/03-arrivals-data.md:3`
- **VALIDATE**: `head -3 docs/spikes/04-gps-field-test.md | grep -q "^\*\*Verdict:"`
- **SATISFIES**: decision rule executed

### 8. GitHub closeout

- **IMPLEMENT**: `gh issue comment 4 --repo linardsb/taxi --body "<verdict summary + doc link>"` then `gh issue close 4 --repo linardsb/taxi`; `gh issue comment 14 --repo linardsb/taxi --body "Spike #4 verdict: <call> — <doc link>. Location slice proceeds as <designed | mounted-phone pattern>."`
- **GOTCHA**: the ticket says "Link it on #14" — that comment is part of done, not optional.
- **VALIDATE**: `gh issue view 4 --repo linardsb/taxi --json state -q .state` → `CLOSED`
- **SATISFIES**: ticket close-out

### 9. Final commit + PR

- **IMPLEMENT**: commit Phase 3 (`docs(spikes): record GPS field-test verdict, close #4`), then piv-create-pr against `main` with `Closes #4` in the body.
- **VALIDATE**: PR URL returned; CI green.

---

## TESTING STRATEGY

### Unit Tests

The selftest (Task 2) is the whole unit story — three scenarios (clean PASS / stationary-gap edge / Doze FAIL + malformed line) embedded in the script, no framework. Deliberate: this is throwaway spike tooling outside the workspace; a vitest setup would be overengineering.

### Integration Tests

The real integration test is Task 6: the script consuming actual field JSONL from two platforms. Session-splitting and `null` speeds get exercised by real data.

### Edge Cases

- Stationary gaps (traffic lights) excluded from the gated distribution — the false-FAIL trap.
- `battery: -1` (unavailable) and charging (rising battery) — report, don't gate.
- Forgotten "Clear" between runs → session split at >10 min ts-delta.
- Malformed JSONL lines → skip + warn, never crash.
- Float `ts`, `null` speed (iOS).

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
node --check spikes/gps-harness/analyze.mjs
```

### Level 2: Unit Tests

```bash
node spikes/gps-harness/analyze.mjs --selftest
```

### Level 3: Integration Tests

```bash
# repo gate must stay green and must NOT pick up spikes/ (outside workspace):
pnpm check
cd spikes/gps-harness && npx tsc --noEmit   # harness untouched, still clean
# Phase 3 only:
node spikes/gps-harness/analyze.mjs spikes/gps-harness/data/*.jsonl
```

### Level 4: Manual Validation

Phase 3: eyeball one >15 s gap the script reports against the raw JSONL lines around it (sanity-check the arithmetic once by hand before trusting the verdict).

---

## ACCEPTANCE CRITERIA

- [ ] `analyze.mjs` computes gap distribution (moving + unfiltered), batch stats, battery %/hr, and emits PASS/FAIL/INCONCLUSIVE per the protocol table
- [ ] Selftest (expected + edge + failure) passes; script is zero-dependency; harness stays outside the pnpm workspace
- [ ] Agent pauses at the human gate with a clear drive checklist
- [ ] After data: `docs/spikes/04-gps-field-test.md` carries measured results + a sibling-format Verdict line
- [ ] #4 closed with a verdict comment; #14 carries the link + consequence
- [ ] `pnpm check` green; `git diff` touches only `spikes/gps-harness/**`, `docs/spikes/04-gps-field-test.md`, and this plan

## COMPLETION CHECKLIST

- [ ] Tasks 1–4 done, each VALIDATE passed immediately
- [ ] Human gate honored (no fabricated results — Phase 3 only runs on real exports)
- [ ] Tasks 6–9 done after data landed
- [ ] Full validation levels 1–4 executed
- [ ] PR merged or handed off for review

---

## OPEN QUESTIONS / ASSUMPTIONS

1. **Deliverable path** — ticket says `docs/decisions/spike-background-gps.md`; repo reality: both completed sibling spikes (#3, #5) record their verdict inline in `docs/spikes/NN-*.md`, `docs/decisions/` was never created, and Linards's own issue comments link `docs/spikes/04-gps-field-test.md` as "the write-up". **Assumption: follow repo convention, don't create `docs/decisions/`.** Flag in the PR body; a 5-minute move if Linards wants the ticket-literal path.
2. **Device availability** — decisive run is Android on **Atis's phone**; if only Linards's phone is available for the drive, the verdict still stands for the pilot *if* the OEM is comparably aggressive (note model/OEM in results). A too-clean phone (e.g. Pixel) weakens a PASS — say so in the write-up.
3. **Partial protocol** — if only the default-settings Android run happens: a clean PASS decides; a borderline result requires the battery-exemption comparison run before calling it.
4. **INCONCLUSIVE zone** — max gap in (60, 120] s or battery in (8, 12] %/hr is deliberately neither PASS nor FAIL; the human calls it (Task 6 GOTCHA).

## NOTES (open canvas)

- **Why zero-dep `.mjs` and not TS**: the harness folder's `node_modules` is Expo-sized but the analyzer shouldn't depend on it being installed — verdict computation must run anywhere with bare Node (Linards may analyze on a machine that never built the harness). `npx tsx` would add a network-fetch step for zero gain on ~200 lines.
- **Why commit the raw JSONL**: the verdict gates an architecture decision; the evidence should be reproducible (`analyze.mjs data/x.jsonl` re-derives the doc's numbers forever). ~100 KB/run is nothing.
- **Why session-splitting instead of a protocol "tap Clear" step**: humans forget; robustness in the tool beats an instruction in a doc.
- **Rejected: building the ticket's original "server echo/log sink"** — the harness's client-side JSONL already ships and was ratified in issue comments; a server sink would measure network delivery, which is #14's durable-queue concern, not this spike's GPS-continuity question.
- **Rejected: putting analyze into the pnpm workspace or wiring it into `pnpm check`** — spikes are throwaway by charter; workspace inclusion would drag Expo deps into the gate.
- The moving/stationary rule (15 m / 1.5 m/s) is a heuristic; the unfiltered distribution is always printed next to it so a suspicious filter is visible in the write-up.

## AMENDMENTS

<!-- append-only after first approval; newest at the bottom -->
- 2026-08-26 — Phases 2–3 not executed as planned: the iOS path (`.claude/plans/spike-gps-field-test-ios-run.md`) reached a working SDK 55 simulator build, then Linards deferred the field test rather than buy the Apple Developer Program before the app exists. #4 stays open; #14 proceeds on the Q1 mounted-phone default for both platforms.
- 2026-08-31 (PR #138 review, F16) — The 2026-08-26 line gives one reason; there were two: no Apple Developer Program purchase before the app exists (so no link install), and the cable install from the Mac — the iOS plan's free Personal Team path — declined. Both are recorded under "iOS" in the spike doc's Field results and in the iOS run report.
