# PR #265 review fixes — round 3

**Review**: [round 3](https://github.com/linardsb/taxi/pull/265#issuecomment-5783576021), head `1161bfd`
**Findings**: F14 (High), F15, F16, F17 (Low). **All four fixed; nothing deferred.**
**HUMAN DECIDES #2** (where step 7's open question lives): taken as the review's prescribed option,
an item in §T11's follow-up run. No issue filed. Linards can still move it to an issue.
**HUMAN DECIDES #1** (I2's `assertTransition()` bypass): untouched, still Linards's call.

Every closing command below was run against the fixed working tree on 2026-09-22, before this
file was written. The file list for the `grep` sweeps is the plan, the report, the runbook and the
round-1 fixes report; round-2's fixes report and the review files quote retired values by design.

| # | Sev | What was wrong | Fix | Closing command → output |
|---|---|---|---|---|
| F14 | High | Runbook Outcome said force-assign passes and "five steps stay owed"; report §T11 said "Four things" over a five-item list and left step 7 out of the list and the follow-up run; PR body said "the five gaps" | Runbook `:382` → *"… reassignment and cold-start-mid-ride all pass, and so does force-assign's no-card half. Six steps are not green (4, 7, 9, 10, 12, 13)"*. §T11 → *"Six things are unrun or open"*, new item 5 (step 7's «opens» half, S2, force-assign defect not excluded), recommendation adds step 7's «opens» half and names **#262 and #263**. PR body line 10 → see §PR body | `grep -n -F 'force-assign, reassignment' docs/runbooks/driver-device-day.md` → **0**. `grep -n 'step 7\|Step 7'` on the report → hits at **:423** (T11 item 5) and **:429** (recommendation). `Five steps stay owed`, `five gaps`, `decision on #263.` → **0 each**. `Four things` → 1, runbook `:703` (agent-run prerequisites, unrelated) |
| F15 | Low | Round-1 fixes `:25` said the Run environment row assigns every step but 10 to a pass; 4, 9, 12 are in no pass | → *"assigns every step that ran to a pass, except 10"*; round-2 `:123`'s quote of it updated to match | `every step but 10` → **0** |
| F16 | Low | Round-2 fixes `:26`/`:79` said runbook `:384` lists 4, 9, 12; it did not | Runbook `:384` gains *"; 4, 9, 12 unrun"* (no glyph), so the fixes report's sentence is now true as written | `sed -n 384p docs/runbooks/driver-device-day.md` → ends *"10 not assigned to a pass; 4, 9, 12 unrun:"* |
| F17 | Low | "queued 53 min" had no source | Sourced from the EAS GraphQL API (`builds.byId`, 2026-09-22): `createdAt` 14:14:57.231Z, `enqueuedAt` 14:15:00.283Z, `workerStartedAt` 15:07:29.726Z, `completedAt` 15:22:03.251Z. Queue = 15:07:29.726 − 14:15:00.283 = **52 min 29 s**; build = 15:22:03.251 − 15:07:29.726 = **14 min 34 s** The timestamps are `observed`; both durations are `derived` and are labelled so at report `:20` and runbook `:380`, each with its subtraction. The queue is measured from `enqueuedAt`; from `createdAt` it is 52 min 32 s. PR body `:124` — see §PR body | `53 min` → **0**; `grep -rn workerStartedAt .claude docs` → report `:20`, runbook `:380` |

## The subject chase (F17)

The figure was wrong in its split, so the sentences that relied on "queued" were checked too.
`workerStartedAt` is 15:07:29.726Z; nothing in the PR timestamps pass 1's end, so a sentence
saying the build was **queued** throughout pass 1 is unsourced.

| Where | Was | Now |
|---|---|---|
| report `:234` | *"sat in the EAS queue for the whole of pass 1"* | *"was not installed until 15:23:16Z, after pass 1"*. Phrased against the install, not `completedAt`: the PR establishes that pass 1 ended by the install, not by 15:22:03Z |
| report `:174` | *"while the #15 build was still queued"* | *"before the #15 build had finished"* |
| report `:177` heading | *"… while the build queued"* | *"… before the #15 build finished"*; the section carries no timestamp, and `grep -rn -F 'harness was validated' .claude docs` finds no citation of the heading |
| PR body `:124` | *"sat in the EAS queue 53 minutes"* | see §PR body |

`grep -n -F` for `sat in the EAS queue`, `still queued`, `while the build queued` over the four files → **0 each**.

## Count-word sweep (F14)

F14's copies were phrases around a count, so the sweep is by value, not phrase:
`grep -n -i -E '\bfive\b|\bfour\b|\bsix\b|\bowed\b'` over the plan, the report and the runbook
→ 46 hits, each read. Two count T11's gaps or the non-green steps: report `:411` (*"Six things are
unrun or open"*) and runbook `:382` (*"Six steps are not green"*), both fixed here. The rest count
something else: T10's four filed issues (report `:68`, `:321`, `:401`; plan `:154-155`), focus
swipes and stops (report `:89`, `:276-278`; plan `:124`, `:495`), #141's four binary steps
(runbook `:27`, `:263`, `:341`), I2's five 2026-08 rides (report `:330`), and "owed" for VoiceOver
(#257), the push halves (#14) and the ear-checks.

## PR body

Edited **after** the push, because its size table and CI line name the head this commit creates.
Retired values checked there by `gh pr view 265 --json body` + `grep`: `five gaps`, `53`,
`1,830`, `Five files`, `22 commits`, `six commits since`, and `1161bfd` as the head. The body
carries the new head's figures and CI run; this file does not, since it cannot name its own head.

## Invariants held

- `grep -c '✅\|❌' docs/runbooks/driver-device-day.md` → **25**, as AC8 states (`observed`, after the last runbook edit).
- `wc -l`: runbook **831**, unchanged, so the 29 citations into it cannot move. Re-ran the
  two-form grep over the plan and the report → **29 hits**, same count as round 3's resolver.
- The report grows **439 → 441** (T11's new item). Nothing cites report lines `:410–439`
  (the only lines that moved) outside the review files (`grep -rnoE 'report(\.md)?\`?:(4[1-3][0-9])' .claude docs` → 0 outside them).

## Validation

Documentation-only delta, five Markdown files (four edited, this one new), no source. The local gate was **not run**:
nothing it checks reads these files, and integration runs collide across the sessions sharing
this machine. CI's `check` on the pushed head is the gate for this commit.
