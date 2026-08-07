# Implementation Report — Spike #4 close-out (GPS field-test analysis tooling + verdict)

**Plan**: `.claude/plans/spike-gps-field-test-close-out.md`   **Branch**: `spike/gps-field-close-out`   **Status**: PARTIAL — paused at the Phase 2 human gate (field drive, Linards)

## Summary

Phase 1 is done: `spikes/gps-harness/analyze.mjs` turns the harness's exported `fixes.jsonl` into the exact metrics the protocol's PASS/FAIL table gates on, and `docs/spikes/04-gps-field-test.md` now carries an "Analyzing a run" how-to plus an empty "Field results" scaffold. Phases 2–3 (field drive → verdict → GitHub closeout) are blocked on real drive data landing in `spikes/gps-harness/data/`.

## Tasks completed

- Task 1: analysis script → `spikes/gps-harness/analyze.mjs` (CREATE) — zero-dependency (node:fs/path only), session-splitting at >10 min `ts` jumps, moving/stationary gap classification (haversine ≥15 m or speed ≥1.5 m/s), gated + unfiltered gap distributions (median/p95/p99/max, nearest-rank), >15 s gap listing with tags, batch stats by shared `recvTs`, delivery delay, battery %/hr (charging/unavailable → reported, not gated), PASS/FAIL/INCONCLUSIVE verdict with reasons.
- Task 2: `--selftest` → same file — 3 embedded scenarios, nonzero exit on mismatch.
- Task 3: doc scaffold → `docs/spikes/04-gps-field-test.md` (UPDATE) — "### Analyzing a run" subsection + "## Field results" with one placeholder per protocol run. Existing sections untouched.
- Task 4: committed on `spike/gps-field-close-out`, branched from fresh `origin/main` (f6874ac), not from the checked-out `feature/api-ride-lifecycle`.
- Task 5 (human gate): STOPPED — `spikes/gps-harness/data/` created, no `.jsonl` present.

Tasks 6–9 (fill results, Verdict line, close #4 + comment #14, PR) await the drive data.

## Tests added

Selftest embedded in `analyze.mjs` (no framework — throwaway register): (a) expected: clean 4 s moving cadence → PASS; (b) edge: 45 s gap bounded by stationary fixes excluded from the gated distribution (moving max stays 4 s, unfiltered max shows 45 s) → PASS; (c) failure: 130 s moving gap + one-`recvTs` multi-minute Doze batch + 1 malformed line → FAIL with the gap as a reason, malformed counted. All pass.

## Validation results

- `node --check analyze.mjs` — pass
- no-args prints usage (contains "Usage"), exits 1 without crashing — pass
- `node analyze.mjs --selftest` — pass (3/3 scenarios)
- Manual: synthetic JSONL through the file path — renderer, STATIONARY tagging, `null` speed, malformed-line warning, empty-file → exit 1 all verified; battery gate fired correctly on a high-drain fixture
- `pnpm check` — green (41 suites / 299 tests; full turbo cache hit — spikes/ + docs/ changes invalidate nothing, confirming the harness stays outside the gate)
- `cd spikes/gps-harness && npx tsc --noEmit` — clean (harness untouched)

## Deviations from the plan

- "Sustained multi-minute batches (Doze)" (protocol FAIL row) made arithmetic as **delivery-delay p95 > 120 s** — the protocol doesn't quantify "sustained"; p95 captures "most fixes minutes late" rather than one outlier. Batch-size p95 > 3 without that lands in INCONCLUSIVE, per the deliberate-gap rule.
- Two defensive verdict guards not in the plan: a session with <2 fixes and a session with zero *moving* gaps both emit INCONCLUSIVE instead of crashing/passing vacuously.
- This report is committed with Phase 1 (PARTIAL) so the shared repo carries no dangling untracked state at the gate; it gets finalized in Phase 3.

## Issues encountered

None. Origin/main had moved (19da1a3 → f6874ac) since the plan was written; branching from the fresh fetch absorbed it.

## Next

1. **Linards drives** (see gate checklist in the session output / plan Task 5).
2. Exports land as `spikes/gps-harness/data/{android-default,android-unrestricted,ios}.jsonl`.
3. Resume the plan at Task 6: analyzer → Field results → Verdict line → close #4, comment #14 → final commit + PR.
