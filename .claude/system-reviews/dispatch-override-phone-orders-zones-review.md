# System Review — #19 Phase A (dispatch force-assign / reassign / cancel)

- **Plan reviewed**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks A1–A13)
- **Execution report**: `.claude/execution-reports/dispatch-override-phone-orders-zones.md`
- **Date**: 2026-08-18
- **Merged as**: `369b953` (PR #120)

## Overall alignment score: 8/10

Every divergence in the execution report is justified and documented, and two of them (`unassignDriver`, pulling four integration tests forward) show the implementer reasoning about the *codebase* rather than obeying the plan — which is what a good divergence looks like. Two points off, both for the same thing: **the plan was never updated to match, and a documented divergence silently became a lie about future work.**

## Divergence analysis

```yaml
divergence: four integration tests written in Phase A
planned: Phase D Task D1 owned all integration coverage
actual: reassign end-to-end, `arrived` refusal, roster-lists-offline, roster-dispatcher-only
reason: unit specs assert transaction ORDER against a fake db; they cannot prove the real
        conditional UPDATEs interlock across two commits
classification: good ✅
justified: yes
root_cause: plan assumption wrong — it treated integration coverage as a closure activity
            rather than as the only evidence for the riskiest mechanism in the phase
```

```yaml
divergence: unassignDriver() added to RidesRepository
planned: not in the task list
actual: added, guarded on the outgoing driver id in the WHERE clause
reason: assignDriver guards on isNull(driverId), so the old driver must be cleared first
classification: good ✅
justified: yes
root_cause: missing context — the plan did not trace the existing assign guard
```

```yaml
divergence: dialog-shell.tsx and row-actions.tsx created
planned: neither named
actual: both extracted
reason: shared focus-trap/Escape handling; slice ownership of row actions
classification: good ✅
justified: yes
root_cause: plan wrote components, not the file-length and slice-ownership consequences
```

```yaml
divergence: failed-submit reset derived rather than an effect
planned: useEffect(() => setPicked(null), [errorKey])
actual: showPicker = picked === null || errorKey !== null, plus onClearError
reason: the repo's eslint config rejects setState-in-effect
classification: good ✅
justified: yes
root_cause: plan proposed a pattern the repo's own lint rules forbid — the plan skill
            researched the codebase but not its lint config
```

```yaml
divergence: rideId prop dropped; AuditEntry gained payload; RosterService takes the
            store directly; dispatch-page.test.tsx mocks next/navigation
planned: four small shapes that did not survive contact with lint, the audit trail, or
         the app-router runtime
actual: corrected in place
classification: good ✅ (all four)
justified: yes
root_cause: ordinary plan-detail drift, correctly handled and documented
```

**No bad divergences.** Nothing ignored a stated constraint, invented parallel architecture, or took a shortcut.

## Pattern compliance

- [x] **Followed codebase architecture** — VSA held; `row-actions.tsx` deliberately lives in the override slice rather than the board slice.
- [x] **Used documented patterns** — money in integer cents, status writes via the transition service, no emit inside a transaction, contracts promoted to `@taxi/shared`.
- [x] **Applied testing patterns** — ≥1 expected + 1 edge + 1 failure per module, and integration coverage pulled forward where unit specs could not carry the claim.
- [x] **Met validation requirements** — full gate green, CI green at the merged head, largest shipped file 221 lines against the 500 cap.
- [ ] **Kept its own claims true** — this is the failure, and it is the whole subject of the next section.

## The finding: five recurrences, one mechanism

| # | Instance | What was wrong |
|---|---|---|
| 1 | #87 | A best-case interval shipped under a worst-case label. The number was **right**. |
| 2 | #107 | `30 = 6 cells × 5 polls` printed under **Observed** — correctly derived, produced by no run, and crediting a mechanism that was an identity function on that data. |
| 3 | #122 review round 1 | Three figures that did not reconcile with each other. |
| 4 | The fix pass for (3) | A `+5` delta pasted beside a 24-file absolute from a different run. |
| 5 | 2026-08-18 (this session) | The handoff prompt carried `54.3 s` where the PR body said `55.15 s`. Separately two claims were false *in kind*: "GitHub retargets this to `main` automatically" (this repo has `deleteBranchOnMerge: false`; both stacked PRs had to be retargeted by hand), and `CLAUDE.md:43`'s "a green gate can be N tests short" — the gate is now **red** without `REDIS_TEST_URL`, because Phase B shipped ungated Redis-dependent specs (filed as #127). **Superseded** — the *replacement* was itself false, which makes this the sharper instance: `CLAUDE.md:43`'s original sentence holds and was restored in `794d602`, because `test/harness.ts` overrides `KV_STORE` with `InMemoryKeyValueStore` and the mechanism cannot fire. What made 8 integration tests fail is still unknown; #127 is re-scoped to finding it. The retargeting half stands. See `…-phase-c.md` D5. |

**The mechanism is inheritance, not mislabelling.** In all five a figure or claim moved from one surface to the next — plan → implementation → report → PR body → handoff prompt — and was re-derived at none of them. Labels were usually present; they named a run that was no longer current.

**Instances 1 and 5 defeat a numeral-provenance linter outright.** #87's number was correct and its label was the defect. Today's retargeting claim contains no numeral at all. A check that demands every digit carry `observed`/`derived`/`expected` would have passed 1, 2 and 5's prose — three of five. That ruled out the obvious remedy.

**And prose remedies do not fire.** Root `CLAUDE.md` already carries two paragraphs about exactly this defect. Instance 5 occurred *inside the file those paragraphs live in*. Per `taxi-piv-remedies-need-an-executable-step`: #87 shipped both a skill edit and a CLAUDE.md addition, and only the skill edit changed later behaviour.

## System improvement actions

Two acted on, out of a longer list. Both are executable; neither is prose.

### ✅ Acted on — 1. The validation block is generated, not typed

**New**: `~/.claude/skills/piv-create-pr/scripts/record-gate.sh`

Runs the gate, stamps the result with the commit it describes, writes `.claude/last-gate.json`, prints a paste-ready Validation block, and exits with the gate's own code so a red gate cannot produce a green-looking record. `piv-create-pr` Phase 2.5 now **blocks** when the record is missing, when `.head` ≠ current `HEAD`, or when the gate was red.

This removes the opportunity rather than auditing the output. It would have caught instances 3, 4 and 5's gate-line drift outright, and it makes the post-rebase case — where every count moves at once — structurally impossible to get wrong.

`observed` — run against this session's real gate at `feed712`: exit 0, `18 successful, 18 total`, `1m0.577s`, and per-package lines captured verbatim (api 615/66 suites, shared 195/21, dispatch 222/27, db 17/3).

### ✅ Acted on — 2. Inheritance detection for every other figure

**New**: `~/.claude/skills/piv-create-pr/scripts/inherited-figures.sh`

Prints every measurement present in both the new surface and a prior one (the implementation report always; the PR's previous body when updating). Each is *unaudited*, not necessarily wrong: re-derive at this head, or state why it is head-independent.

Scope was deliberately narrowed after testing. A first draft matched every 2+ digit number and produced **29 hits** on this session's real PR body — mostly issue references, dates and session ids. A check that noisy gets switched off. Binding numbers to measurement words (`passed`/`failed`/`suites`/`files`/`lines`/`queries`/`rows`/durations) cut it to **13 hits, all genuine** (`observed`, same two files).

**Both scripts' limits are written into the skill rather than left implied**: neither catches a right number under a wrong label (#87), nor a claim with no numeral (#5's retargeting sentence). Phase 2.5 names both explicitly as by-eye checks, with the "retire the subject, grep the noun" rule attached.

### Not acted on (deliberately — the loop says 1–2, not all)

- **A plan is a surface too, and nobody updates it.** Phase A's divergence was recorded in the report and the plan's *changelog*, but Phase D's task list still read as untouched work four days later. A check could fail when a report documents a divergence from a plan task the plan's task list does not reflect. **Fixed by hand this session** (Task D1b added, D1's three scenarios annotated with where each went), but not automated.
- **`CLAUDE.md` is not a remedy surface.** Two of its paragraphs are about this defect and one of them *was* the defect. Worth acting on by moving enforcement out of it — but that is a bigger change than this loop should make.
- **Update the plan skill's codebase research to include lint config.** The `useEffect` divergence came from the plan proposing a pattern the repo's eslint rules forbid. One instance, not yet a pattern.
- **`.claude/last-gate.json` is not yet in the repo's `.gitignore`.** `record-gate.sh` writes it at the repo root, so it will show up as untracked noise on the next run in any worktree. The skill instructs adding the ignore rule; the rule itself was **not** added, because the only branch in hand (#121) is green, pushed and awaiting review, and reopening it for a one-line ignore is worse than leaving the note. Land it with the next branch that touches the repo root.

## Verification of the remedies

Both scripts were exercised against this session's real artifacts, not synthetic ones:

- `record-gate.sh` ran the actual gate at `feed712`: exit 0, `18 successful, 18 total`, `1m0.577s`, per-package lines captured verbatim. Its counts are byte-identical to the independent `0a7c519` run (api 615/66, shared 195/21, dispatch 222/27, db 17/3), which is what licenses the PR body's "identical counts" claim.
- `inherited-figures.sh` was run against the PR body **as actually published** (`gh pr view 121 --json body`), not against the draft: 13 flagged measurements, each answered in the body's delta table or by a re-observed constant. Running the remedy on the very PR that introduced it is the only evidence that matters for a check of this kind.

## Key learnings

**What worked well**

- The implementer diverged from the plan *toward* better evidence twice (integration tests forward, `unassignDriver` guard in the WHERE), and documented both. C1 — a money bug with no failing test and no user-visible symptom — was catchable because of the first.
- Making `countAttempts`'s `since` required rather than optional. An optional parameter defaulting to old behaviour is a regression waiting for its next caller.
- Flagging non-reproducing failures rather than dismissing them, in both Phase A and Phase C. The shared-Postgres noise shape is now well enough characterised to recognise on sight.

**What needs improvement**

- Numbers are inherited across four surfaces and audited at none. Now partly mechanised.
- Divergences are recorded where the divergence happened, never where the *consequence* lands. Phase D read as untouched work for four days.
- Environment failures cost more than the code does. Colima wedged twice in two sessions with the same misleading symptom (`Running` while the socket is dead; today `limactl list` showed no instance at all), and both times the gate hung with turbo buffering the output so it read as a slow test.

**For next implementation**

- Run `record-gate.sh` instead of the bare gate. The body renders its output; nobody retypes a count.
- When updating an existing PR after a rebase, pull the previous body down first and diff the figures — that is the case with the worst track record.
- When a claim turns out to be wrong, retire its **subject**: grep the noun (`quantiz`, `grid`, `retarget`, `green gate`), not the sentence, and check the PR body, which is the only surface not in the working tree.
