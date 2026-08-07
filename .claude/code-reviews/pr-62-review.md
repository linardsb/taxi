# PR #62 review — GPS field-test analyzer + remote-drive kit (#4)

**Recommendation: Request changes** — 0 Critical · 1 High · 3 Medium · 1 Low. The verdict arithmetic is a faithful transcription of the protocol table (every boundary direction checked), validation is fully green, and the human gate was honored for real. The blocking concern is not the math — it's one verdict-masking gap plus two instruction-sheet holes that risk wasting the remote field runs. All are cheap fixes, and the two field-facing ones are worth landing **before the APK + instructions go to Atis**: a botched remote run costs a coordination cycle with a volunteer.

## Issues

### High

**H1 — Session split can mask the protocol's "task dies until relaunch" FAIL** · `spikes/gps-harness/analyze.mjs:87-95` (split) / `docs/spikes/04-gps-field-test.md:52` (FAIL row)
A task that dies mid-drive and resumes >10 min later becomes two sessions, each individually PASS — the catastrophic outage never enters any gated distribution, and nothing computes or flags the inter-session gap. Outages of 2–10 min are caught by the >120 s FAIL; only the worst ones vanish. The sole tell is eyeballing session durations against drive length, which defeats the PR's own thesis ("the verdict is arithmetic, not eyeballing"). Not among the report's documented deviations.
*Fix:* when a file yields >1 session, print the gap to the previous session in each subsequent session header (e.g. `starts 14.2 min after previous session — separate run (forgotten Clear) or dead task? Dead task = FAIL per protocol`) plus a file-level warning next to the session count.

### Medium

**M1 — Instruction sheet never says "Go offline" after drive 1** · `spikes/gps-harness/ATIS-INSTRUKCIJA.md:21-27`
Section 3 ends at Export → Clear, so tracking keeps running overnight. Section 4 then says "Go online" — but the toggle will read **"Go offline"** (red) at that point (`App.tsx:155`); the likely tap turns tracking *off* and run 2 (the comparison run) records nothing. Secondary: interim fixes contaminate run 2's file (extra sessions, compounding H1) and the notification/battery drain runs all night.
*Fix:* add "Nospied **Go offline**" as the last step of section 3, and repeat the section-2 verification ("pārbaudi, ka rindiņas tek") in section 4.

**M2 — Nothing tells Atis to drive with the phone off the charger** · `spikes/gps-harness/ATIS-INSTRUKCIJA.md:3` (interacts with `analyze.mjs:106-116`)
Phone-on-charger is default driver behavior. A fully-charging run degrades visibly (`charging (not gated)`), but a *partial* mid-drive charge is worse: first/last-only %/hr stays positive and reports a deceptively low `gated` number with no indication — one of the three gate rows silently degrades on the decisive run. (First/last-only is the planned approach; the blind spot + missing instruction are not.)
*Fix:* one line in the sheet: drive with the phone **off the charger**. Optionally have the analyzer report `mixed` instead of `gated` when battery rises anywhere mid-session.

**M3 — No selftest scenario for the INCONCLUSIVE band** · `spikes/gps-harness/analyze.mjs:213-283`
The plan's own emphasized design element ("Do not silently round into PASS") has zero automated coverage — a boundary slip (`>=` vs `>`, threshold typo) between PASS and INCONCLUSIVE would pass all three current scenarios, and that failure mode is precisely a 61 s gap silently promoted to PASS. The three planned scenarios are faithfully implemented; the fourth outcome class just isn't covered (battery gate verified only manually per the report).
*Fix:* add a fourth fixture — e.g. a 90 s moving gap or ~10 %/hr battery — asserting `INCONCLUSIVE` with the expected reason substring.

### Low

**L1 — UTC date next to local times under a "local" label** · `spikes/gps-harness/analyze.mjs:173`
`toISOString().slice(0, 10)` is UTC; the times beside it are local. A run near Rīga midnight (UTC+2/+3) prints the previous day's date.
*Fix:* derive the date from local date components (or label it UTC).

## Validation

| Check | Result |
|---|---|
| `node --check analyze.mjs` | pass |
| No-args prints usage, no crash | pass |
| `node analyze.mjs --selftest` | pass (3/3 scenarios) |
| `pnpm check` | green — 17/17 tasks (first run had 1 unrelated `@taxi/api` test flake; passed on two re-runs; this PR invalidates no package inputs) |
| `cd spikes/gps-harness && npx tsc --noEmit` | clean (harness untouched) |
| Redis-gated suites | 20 tests skipped (expected without `REDIS_TEST_URL` locally; CI sets it) |

## Verified — no issue

- **Every verdict boundary** in `verdictOf` checked against the protocol table: strict-greater against inclusive PASS bounds throughout; exactly-60/120/3/8/12 all land in the correct zone.
- **Percentile edge cases**: nearest-rank plus the `<2 fixes` / `!moving.n` guards is sound; every `null` is guarded before comparison.
- **Negative delivery delays** (clock skew): only lower delay p95, conservative direction; no action warranted.
- **Documented deviations** (delay-p95 as the Doze proxy, defensive INCONCLUSIVEs, inline verdict location, `spike/*` branch) all verified accurate against the code — intentional per the implementation report, not flagged.

## Done well

- The verdict logic is a faithful transcription of the spec — including refusing to gate `charging`/`n/a` battery and never mixing `ts`-based gap metrics with `recvTs`-based batching.
- Honest instrumentation: the unfiltered distribution printed beside the gated one, plus per-gap listings with bounding speeds and haversine distance, makes the one real heuristic (moving/stationary) auditable by hand.
- The selftest is genuinely well-built for a throwaway: fixed epoch, fixture geometry that actually produces the claimed classifications (verified by hand: 2e-4° ≈ 22 m moving, 3e-5° ≈ 3 m stationary, 180–216 s batch delays land p95 over the FAIL line), malformed-line handling asserted in the same pass.
- The human gate was honored for real — empty results scaffold, no fabricated numbers, and the report's deviation list matches the code exactly.

## Recommendation

**Request changes.** Fix H1 + M1 + M2 before sending the kit to Atis (all three are small); M3/L1 can ride along or land later. Re-request review after — the math itself is merge-ready.

---
*Agentic review (piv-review-pr, fresh context + code-reviewer agent). A human makes the final call.*
