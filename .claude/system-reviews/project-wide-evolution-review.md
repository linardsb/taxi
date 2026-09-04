# System Evolution Review — project-wide (all issues landed/closed to date)

## Meta Information

- **Scope**: not one plan/report pair — a synthesis of every closed loop so far, on the user's instruction
  ("the whole project issues landed/closed so far. how we can fix those?"). The skill's positional-args
  guard fired correctly (free text word-split into the plan/report slots); treated as a deliberate scope
  override and logged as ledger item L12.
- **Inputs**: all 10 per-loop reviews in `.claude/system-reviews/` (#6, #86, #18, #19-A, #19-C, #63, #87,
  #94, #94/mint, #16) · `gh issue list` (67 issues: 44 closed, 23 open) · `gh pr list --state merged`
  (through #153) · every claim about a control's existence re-verified by grep against the skills tree,
  `settings.json`, `CLAUDE.md` and `.claude/references/` at HEAD `602d5fb` — not inherited from the
  reviews' own "acted on" checkboxes (`observed`, 2026-09-04).
- **Companion artifact**: `.claude/system-reviews/REMEDY-LEDGER.md` (created by this review) — the
  consolidated unacted-remedy list with per-item status. The fix plan lives there; this report is the
  evidence.
- **Date**: 2026-09-04

## Overall system health: 7/10 (`derived` — reasoning below, not an average)

Per-loop alignment scores ran 7–9.5 and are flat, but the mint review proved the instrument is blind to
plan-inherited defects: both defects that ever reached `main` (#87's false docblock claims, #107's
"Observed" counterfactual) shipped inside loops scoring 9/10, because faithful execution of a wrong plan
scores as adherence. So the trajectory has to be read from the defect classes, not the scores. Read that
way: four classes are closed by remedies that verifiably exist at HEAD, one is held by instructions after
its mechanised form was destroyed, and two are open — the fix-pass class (the current defect frontier)
and the meta-class (the loop audits code and numbers, but never audits its own remedies). Nothing worse
than a prose claim has ever reached `main` in ten loops; both that did were caught by the next layer and
retired. The deduction is almost entirely for the meta-class, because it is what keeps re-opening the
others.

## The map — seven defect classes across ten loops

**C1 · Claim/number inheritance across surfaces** — plan → implementation → report → PR body → handoff,
re-derived at none. Occurrences: #87, #107, #117, #120's fix pass, #121 (D5 + handoff), #94 (R4, 2-commit
sweep), #150 fix pass (R4/R5/R11). Seven loops. Controls at HEAD: CLAUDE.md provenance clause,
`piv-create-pr:43` figures-by-command-run-NOW, `piv-review-pr` numbers pass + subject-grep + mechanism
check (all `observed` today). The two *mechanised* controls — `record-gate.sh`, `inherited-figures.sh` —
were destroyed in the #129 skill-tree cleanup (ledger L2). **Status: held by instruction.** Evidence it
currently holds: #150 was the first PR where every body figure reproduced in both review rounds (that
review, `observed` there).

**C2 · Plan-level wrong answers executed faithfully** — the alignment-blind class. Occurrences: #87
(claims born in the plan), #107 (counterfactual born at plan:447), #150 C1 (ordering question answered
with the typical case; the screen never updated), #121 D2 (guarantee invalidated by a sibling merge), plus
the fact-stated-without-reading-the-source lineage (#63 registry comment, #86 @HttpCode, #150 dev-2/3).
Controls at HEAD: worst-case rule for ordering/timing questions (`piv-plan-implementation:450`),
in-app-connection-order delivery test (:357), guarantees pass with `baseRefOid` trigger (`piv-review-pr`).
All landed 2026-08-18–09-04, none yet exercised by a following loop — **#17 is the test.** The
fact-verify-by-reading rule was queued in #86's review as "first candidate for the next slot" and never
landed across seven loops (ledger L1 — top of the next slot).

**C3 · Fix-pass regressions and false closure** — the current frontier. Occurrences: #150 R1/R2 (both
round-2 Highs were round-1 fixes; the "watch it fail" rule structurally cannot see them), #150 L5
("every one is fixed" written before the closing command ran), #150 R4/R5/R11 (claim inheritance inside
the fix pass with the rule present in two files), #94 R4, #107's incomplete first retirement, #121 D5
(false diagnosis written onto four surfaces during a rebase). Four loops. Controls at HEAD before today:
value-grep copies-chase (unverifiable output), nothing else. **Status: OPEN → acted on (A1).**

**C4 · Validation that cannot run** — Level-4 steps whose preconditions don't exist; hardware-owed ACs
with no owner. Occurrences: #87 (a log line the code never emits), #94 (4/7 steps unperformable,
including the ticket's own success condition — the recurrence after #87 logged it), #16 (3 ACs
hardware-owed, no follow-up issue), #4 (field test deferred). Controls: `mint:ride`
(`services/api/scripts/mint-tracked-ride.ts`, `observed`) removes the api-side precondition problem — the
"build the unblocker at the third occurrence" rule fired as designed — **and the performable-step rule is
present** at `piv-plan-implementation:395–409` (`observed`, `grep -in performable`; the first draft of this
review claimed it absent on a case-sensitive grep, see the ledger's correction note). What remains open is
L5: an AC whose verification needs hardware confirmed absent still gets no follow-up issue at planning
time, which is why #16 carries three owed ACs and stays open. **Status: mostly closed, one gap.**

**C5 · Plan text stale after divergence** — divergence recorded in the report, plan task list left
asserting untouched work. Occurrences: #120 (−2 points), #121 (−1, "process defect, not oversight").
Control: none; Phase C's own threshold says codify at the third occurrence (ledger L3). **Status: watch.**

**C6 · Environment / multi-session** — branch collisions, compose project-name fights, Redis hangs,
colima, dead `CLAUDE_PROJECT_DIR`. Occurrences: #86 (4 incidents), #87 (2), #94 (3 stalls), #150 (hook
spawn brick). Controls: CLAUDE.md concurrent-sessions paragraph, worktree-from-start in `piv-implement`,
`COMPOSE_PROJECT_NAME` baked into settings env, hook-path fallback (`settings.json:27,38`, `observed`),
12 memory files. **Status: effectively closed** — no branch collision recorded since codification
(2026-08-11); new sub-classes get codified same-day. The residue: several controls live only in memory,
the weakest shape (ledger L6).

**C7 · The meta-class: remedies decay** — the reason this review exists. Five mechanisms, all observed:
(a) prose remedies don't fire — #87 shipped a CLAUDE.md paragraph and a skill edit the same day, and only
the skill edit changed later behaviour (a near-controlled experiment); #121's D5 happened *inside* the
file carrying two paragraphs against it. (b) Remedies landed on the shadowed user-level skill copy were
inert — #107's numbers pass never fired until the copy question was resolved (#129). (c) The only two
mechanised gates were destroyed by that very cleanup, and no review noticed — only a memory file records
it. (d) Logged-not-acted items recur at higher cost — #87's Level-4 item → #94; #86's fact-verify line →
#150. (e) This skill's own two logged self-fixes (mint review: recurring-mechanism learnings need action
items; the score is adherence-blind) never landed (`observed`: no such text in the skill before today).
**Status: OPEN → acted on (A2).**

**Closed and worth naming: omission under-reporting.** #63 (positionOf flip undocumented) and #18 (a
declared UX state silently never built) → `piv-implement`'s re-read scope was widened twice → #150
shipped 21 divergences with *zero* undocumented ones and the reviewer crediting the list. Ten changes
reported / one drop missed in #18; fourteen documented / none missed in #150. The class is closed by an
executable step.

## What ten loops prove about remedy shapes

Remedy lifetime tracks how executable and how repo-tracked it is:

1. **Script in the repo** — strongest while it exists, but invisible when deleted if nothing references
   it (L2 died silently).
2. **Skill step in the repo** — demonstrably fires: PR-state guard (#87 → confirmed firing in #107),
   deviations-diff (#63 → zero undocumented in #86 and #150), numbers pass (#107 → figures reproduced
   twice in #150), mid-merge probe, guarantees pass.
3. **CLAUDE.md prose** — changes wording, not behaviour: #94's review observed every docblock saying
   "bounds" not "closes" (the rule was read), while three claims were still false (the rule checked
   nothing).
4. **Memory** — predicts what it cannot prevent: `taxi-concurrent-sessions` described the #87 collision
   class before it happened; it fired anyway.
5. **Key Learnings prose** — a prediction, not a control: "numbers are inherited, not audited" (#87) →
   reproduced verbatim by #107.

The project's own "act on 1–2, not all" rule is right — every acted remedy verifiably landed. What was
missing is the other half: nothing tracked the 16 items the rule deliberately deferred, so the queue
silently became where remedies go to die. That is the single fix with the widest blast radius available
to this review.

## System Improvement Actions

Per the house rule: **two acted on**, the rest ranked in the ledger.

### A1 ✅ ACTED ON — close the fix-pass hole (C3)

Four edits, all drafted (and evidenced) by the #16 review, none previously landed:

- `piv-fix-review-findings` §2: for a Critical/High fix, answer **"what new failure mode does this
  mechanism have?"** and test for it — a repro proves the old failure gone, nothing about the new one
  (#150 R1/R2).
- `piv-fix-review-findings` §2 copies-chase: grep the **subject noun** as well as the value, and **list
  the exact greps + hits in the fix report** so the reviewer diffs a list instead of trusting a sentence
  (#150 R4/R5/R11 — the rule existed in two files and produced no checkable output).
- `piv-fix-review-findings` §4: run every finding's **closing command before writing the closing
  sentence** (#150 L5).
- `piv-review-pr` Phase 4: a **fix-mechanism pass for round ≥ 2** — for each round-1 Critical/High fix,
  ask what its mechanism newly permits, not only whether the original repro passes (round 2 of #150 did
  this by instinct and found both Highs).

### A2 ✅ ACTED ON — give the loop a memory of its own remedies (C7)

- **`REMEDY-LEDGER.md` created**: all 16 open remedies consolidated from the ten reviews, each with
  origin, recurrences since logged, and status verified by grep at HEAD — including the destroyed gate
  scripts (L2) and the seven-loop-old fact-verify line (L1) at the top of the next-slot queue.
- **`system-evolution-review/SKILL.md` edited** (its own two logged self-fixes, plus the #94 learning):
  read the ledger before analysis; on output, update it — every "recommended, not applied" item is
  appended, every recurring-mechanism Key Learning either becomes an action item or is explicitly marked
  **accepted risk**; and the scoring guide now states that plan-inherited defects are scored as plan
  defects, not adherence credit.

### Ranked next (in the ledger, not acted — the slots are spent)

- **L1** fact-verify-by-reading in the plan skill — oldest queued item, class recurred twice since.
- **L2** rebuild `record-gate.sh` + `inherited-figures.sh` in-repo, referenced from the skill so
  deletion is visible. The instruction-form control held in #150, so this is hardening, not a hole.
- **L5** AC-owed-by-#N — land when planning #17 (the same hardware blocker applies).
- **L3** plan-staleness check — fires at the third occurrence per its own rule.
- Full list (15 open) and evidence: `REMEDY-LEDGER.md`.

## Key Learnings

**What worked well across the project:**

- **The layered gate held.** In ten loops, nothing worse than a prose claim reached `main`, and both
  that did were caught and retired by the loop's next layer. First-pass code quality is real: three
  consecutive loops with zero Critical/High code findings at round 1.
- **Deviation discipline is the loop's healthiest organ** — ten loops running, reviewers credit rather
  than flag the lists, and the two widenings of the re-read scope closed the omission class outright.
- **Codification kills environment classes same-day** — every multi-session incident since 2026-08-11
  was a new sub-class, never a repeat of a codified one.
- **The "third occurrence → build the tool" rule works**: `mint:ride` exists because two tickets
  couldn't perform their manual steps; the third built the instrument.

**What needs improvement:**

- **The loop audits code, then numbers, then guarantees — but never its own remedies.** Fixed today
  (A2); the ledger's next-slot queue is now the review's first read.
- **Fix passes are the current defect frontier** — the last loop's only Highs were manufactured by its
  own round-1 fixes. Addressed today (A1); #17's review rounds are the verification.
- **Instruction-form controls are one cleanup away from silent death** — L2 is the standing example;
  rebuilding it in-repo is the top hardening item.

**For the next loops:**

- #17 (live tracking, socket-first) exercises every C2 control landed this fortnight: delivery tests in
  the app's real connection order, worst-case ordering answers, `rides.service.ts` extraction-first
  (481/500). Its planning session should take L1, L4 and L5 as its apply slots.
- The next `system-evolution-review` verifies A1/A2 fired: did the fix report carry the grep list? Did
  the round-2 review run the fix-mechanism pass? Did the review update the ledger?
