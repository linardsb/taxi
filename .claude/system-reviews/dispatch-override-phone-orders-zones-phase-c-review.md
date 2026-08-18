# System Review — #19 Phase C (zone/queue grid, cascade visibility, explainability)

- **Plan reviewed**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks C1–C7)
- **Execution report**: `.claude/execution-reports/dispatch-override-phone-orders-zones-phase-c.md`
- **Date**: 2026-08-18
- **Merged as**: `30a0662` (PR #121), final head `59b3feb`

> Same independence caveat as the execution report: written by the session that made the round-3 fixes. The classifications below are judgements about that session's own work.

## Overall alignment score: 7/10

Four of the five divergences are justified and documented — D5 is not — and three of them (D1, D2, D4) show the implementer reasoning about the *codebase* over the plan text, the good shape. Three points off, and unlike Phase A they are not all the same point:

- **One point** for the recurrence of Phase A's exact deduction: the plan was never updated to match. Task C4's IMPLEMENT line still names `countAttempts` on `main` today — the very coupling D2 removed — and four VALIDATE lines still `cd` to a retired worktree. Phase A lost two points for this; losing one again makes it a **process defect, not an oversight**.
- **Two points** for D5, which is a different failure from anything Phase A had: a real observation was given an inferred cause, and the inference was written into root `CLAUDE.md`, the report, the PR body **and a new GitHub issue** before anyone checked it against the code. Four surfaces, one unchecked inference, in the file every session loads.

What keeps this at 7 rather than lower: D5 was caught before merge by the project's own review loop, and the fix was a revert to a *sourced* figure rather than a fresh guess. The loop worked; it just worked late.

## Divergence analysis

```yaml
- divergence: cascade.ts reads one batched query, not the three the plan named
  planned: "cascade.ts joins findPendingForRide / countAttempts / findTriedDriverIds" (Task C4)
  actual: one batched findOffersForRides(rideIds); pending, tried set and count derived in JS
  reason: C4's own GOTCHA forbids a per-ride fan-out on a surface rebuilding every 2 s
  classification: good ✅
  justified: yes
  root_cause: unclear plan — the task's IMPLEMENT line and its GOTCHA contradict each other, and the
              plan does not say which is binding

- divergence: the board's MAX_OFFER_ATTEMPTS cap guard was removed (round-3 F2/F3)
  planned: not planned; the guard entered in review round 1 as the H2 fix
  actual: removed in 794d602; the docblock states the board/engine divergence instead
  reason: #120's H3 made the engine's budget release-scoped while the board's count stayed
          cumulative-since-booking; after a dispatcher release the strip reported a live cascade as spent
  classification: good ✅
  justified: yes
  root_cause: missing validation — a sibling PR merged mid-flight and changed the meaning of a function
              this phase reads. Nothing in the loop re-derives stated guarantees after a rebase, and the
              divergence is structurally untestable here (buildCascades is pure; released and un-released
              rides are identical in its inputs)

- divergence: Phase C's strings landed in per-language i18n files, not i18n.ts
  planned: "ADD the LV strings for Phase C to packages/shared/src/i18n.ts" (Task C7)
  actual: into #122's i18n/{lv,ru,en}.ts; i18n.ts reduced to assembly + isMessageKey
  reason: #122 split the catalog while Phase C was in flight
  classification: good ✅
  justified: yes
  root_cause: missing context — the plan was written before the sibling phase's split existed

- divergence: board-ride.ts extracted from rides.repository.ts (unplanned)
  planned: nothing; the repository was expected to absorb a 12-line geozoneId projection
  actual: rides.repository.ts hit 504 lines (max-lines error); the pure projection moved to a sibling
  reason: two branches each added to one file, each individually under the cap
  classification: good ✅
  justified: yes
  root_cause: missing validation — no step checks whether concurrent branches are converging on one
              file's line budget. Resolved the right way (extract, not raise the cap or disable the rule)

- divergence: a false diagnosis was written into CLAUDE.md during the rebase (round-3 F1)
  planned: M5 recorded a figure correction only — the gated-skip count 24 -> 33
  actual: the corrected digit was kept and the sentence around it rewritten to assert the api suite is
          RED without REDIS_TEST_URL, on a mechanism the test harness excludes
  reason: 8 integration tests genuinely failed twice; the cause was inferred, not checked
  classification: bad ❌
  justified: no
  root_cause: missing validation — the loop re-derives figures but has no step that asks
              "does the code permit the cause I just named?". The digit surviving re-observation was
              taken as licence to rewrite the sentence around it
```

## Pattern compliance

- [x] **Followed codebase architecture** — VSA respected; `board/` slice owns its projections; `packages/shared` still imports nothing from the workspace.
- [x] **Used documented patterns** — money untouched, ride state machine untouched, `isPaymentMethodLocked()` untouched, seam boundaries intact. Every shipped file under 500 lines, no `eslint-disable` anywhere in the diff.
- [x] **Applied testing patterns correctly** — each new slice ships expected + edge + failure cases; the one test whose fixture existed to discriminate the removed guard was **rewritten as the assertion of the new rule** rather than deleted.
- [x] **Met validation requirements** — full gate green at the final head, CI green on GitHub's runner at both round-3 heads, mutation evidence re-derived (and the api row corrected 5 → 4 rather than inherited).
- [ ] **Kept the plan true to what shipped** — failed, and failed the same way Phase A did.

## System improvement actions

Per `CLAUDE.md`, act on **1–2**. Per this AI layer's own history (#87), a remedy that edits a **skill** fires later; one that adds prose to `CLAUDE.md` does not. Both actions below are skill edits for that reason.

**Form is necessary and not sufficient — the remedy must land on the copy that loads.** `observed`, 2026-08-18: 20 skill names exist in **both** `~/.claude/skills/` and this repo's `.claude/skills/`, and on a collision the user-level copy wins (this session's `/piv-fix-review-findings` resolved to `~/.claude/skills/piv-fix-review-findings` while the repo copy exists). The consequence is not hypothetical: `~/.claude/skills/piv-review-pr/SKILL.md` was **93 lines, mtime 18 Jul**, and #107's numbers pass — added to the repo copy on 13 Aug — never fired once. The previous loop's remedy landed in `~/.claude/skills/piv-create-pr/` and *does* fire (`grep -c record-gate.sh`: 4 there, 0 in the repo copy). Same AI layer, two remedies, two destinations, one live and one shadowed. ACTION 1 below is therefore written to the repo copy **and** synced to `~/.claude/skills/piv-review-pr/SKILL.md` — the sync is what makes it fire, and nothing in CI gates that file. That sync is a point fix for one skill; **#129** carries the open question of which tree is authoritative for the other 19.

**Update `piv-review-pr` — ACTION 1, implement now:**

- [x] Add a **guarantees pass** beside the existing numbers pass in Phase 4, scoped to PRs whose base moved. Landed in the repo copy *and* synced to `~/.claude/skills/piv-review-pr/SKILL.md`, per the destination note above; the repo copy alone would have been inert. Suggested text:

  > ### The guarantees pass — when the base moved under this PR
  >
  > A rebase onto a merged base sweeps *figures* well, because figures look like figures. It does not sweep
  > **guarantees**, and a guarantee invalidated by a sibling merge fails silently — the suite stays green
  > because both sides were re-run, and only the *relationship* between them broke. #121 shipped one to
  > review in a file whose own comment named the exact condition that would invalidate it.
  >
  > For every PR whose base changed since the last review round:
  >
  > - Grep the diff for **conditional comments** — "if X changes, this needs re-deriving", "as long as",
  >   "assuming", "the same row set". Each one is a tripwire someone set deliberately. Check whether the
  >   condition fired; if it did, the comment is now a warning about something that has already happened.
  > - Grep for **absolute claims** in docblocks, the report and the PR body — "returns null when", "always",
  >   "never", "the same as", "cannot". Re-derive each against the merged base, not against the pre-rebase
  >   tree they were written on.
  > - Where two surfaces count or compare the same thing, name the case where they **stop** agreeing. A pure
  >   function whose inputs cannot distinguish that case is a seam problem, not a fixture problem — say so,
  >   because no test can be added to catch it.

  **What actually landed is broader than this sketch**, in two ways found during the #128 review round:

  - **The trigger is now observable.** "For every PR whose base changed" was not answerable from what the skill
    collected: Phase 1 fetched `baseRefName`, which a rebase leaves identical, and nothing recorded the previous
    round's base. Phase 1 now fetches `baseRefOid`, and Phase 6 requires the report header to carry it, so round
    N+1 compares two SHAs instead of relying on the reviewer remembering.
  - **A bullet on closing the previous round's rebase notes by re-derivation, not by a green run** — see the
    correction to "rounds 1 and 2 could not have" in the execution report. #121's round 1 *had* named the
    `countAttempts` coupling; the note was discharged by re-running two specs that passed because the divergence
    is structurally untestable. Without this bullet the pass would have been satisfied by exactly what failed.

- [x] Extend the numbers pass with the **mechanism check** D5 needed. Suggested text, appended to the existing "When a figure credits a mechanism" paragraph:

  > The same applies to a **failure** and its cause. Real red output plus an inferred cause is still an
  > unverified claim: ask what in the code *permits* the cause you named, and read that code. #121 saw 8
  > integration tests fail, named Redis, and wrote it into `CLAUDE.md`, the report, the PR body and a new
  > issue — while the test harness overrides the store in question with an in-memory one. **A digit that
  > survives re-observation is not licence to rewrite the sentence around it.**

**Update `piv-plan-implementation` — ACTION 2, recommended, not implemented this round:**

- [ ] State the precedence between a task's `IMPLEMENT` and its `GOTCHA`. D1 resolved correctly only because the implementer noticed the contradiction. Suggested rule for the task template: *when a task's GOTCHA forbids the shape its IMPLEMENT line sketches, the GOTCHA is binding and the IMPLEMENT line is a sketch — say so in the divergence log rather than splitting the difference.*

**Deliberately not doing:**

- Adding another `CLAUDE.md` paragraph about re-deriving claims. The file already carries three, and D5 happened anyway — in that very file. More prose there is the remedy shape this AI layer has already shown does not fire.
- Filing a plan-freshness check as a new skill. Two occurrences is a pattern worth a skill step, not a skill; the plan-reconciliation step already exists informally (the rebase did it for Phase D) and belongs in `piv-commit`'s or `piv-create-pr`'s checklist if it recurs a third time.

## Key learnings

**What worked well:**

- The review loop caught both Highs before merge, and caught them specifically because the rebase was landed as a **reviewable event** with pre-rebase figures superseded in place rather than overwritten.
- The 500-line cap collision (D4) resolved by extraction with a verbatim-move disclosure, which let review skip re-reading 41 moved lines as new source.
- Mutation evidence was **re-derived after the fix changed it** (5 → 4) instead of being carried forward — the exact discipline #87 and #107 lacked.

**What needs improvement:**

- **A cause inferred from real output is treated as observed.** This is D5 and it is the sharpest finding here: the project's figure discipline is mature, and its *causal* discipline is not. Correct numbers can sit inside a false sentence.
- **Guarantees do not survive a moving base, and nothing checks them.** D2 was predicted in a code comment **one day** before it fired, and the comment was still standing as a warning after the event it warned about. `observed` — the comment entered in `67ffb58` on 2026-08-17 (round 1's labelling commit); the condition fired when #120 merged as `369b953` on 2026-08-18; it was removed in `794d602` the same day (`git log -S "this comparison needs re-deriving" -- services/api/src/features/dispatch/board/cascade.ts`). A day is the *sharper* version of this finding, not a weaker one: the tripwire was written by this same stack, days old, and still nothing read it.
- **Plan text is not updated when implementation diverges** — twice now, and Task C4 is stale on `main` as this is written.

**For next implementation:**

- When a sibling PR merges under an in-flight branch, list what the branch *reads* from the sibling's changed surfaces and re-derive each relationship, not just each number.
- Before writing a diagnosis into `CLAUDE.md`, read the code path that would have to be true for it. `CLAUDE.md` is the highest-blast-radius file in the repo and should carry the highest bar, not the fastest write.
- Phase D should open by reconciling Tasks C4 and C7 with what shipped, since it is the next session to touch this plan.
