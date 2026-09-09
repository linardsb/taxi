# Remedy Ledger — unacted system-review remedies, with status

Every `system-evolution-review` reads this FIRST and updates it on output. One row per remedy that a
review recommended but did not apply. A row leaves the table only when the remedy verifiably exists at
HEAD (name the grep) or is marked **accepted risk** with a reason. Rationale: logged-but-unacted items
decay into recurrences (#87's Level-4 item fired again in #94 at higher cost; the fact-verify line below
sat queued for seven loops while its class recurred twice), and remedies with no repo reference can be
destroyed silently (the two gate scripts, see L2).

Status verified: 2026-09-09 on `docs/remedy-ledger-apply` (`observed`). **3 open, 15 closed this loop.**
IDs are stable and never renumbered.

> **Every locator below was re-run at this head, and the check that says so names its own scope.**
> `observed`, 2026-09-09: **22 checks in three groups** — the Closed table's 15 rows (**18 checks: 17
> greps and one `ls`**), plus L4 in *Closed earlier* (1), plus the 3 rows in *Open*. **20 reproduce; two
> did not**, one in each of two different groups, which is why the two figures do not sum against 18:
> 17 of the Closed table's 18 hold, and 2 of *Open*'s 3. Both failures are corrected in place — L11's
> `grep -rn "gh pr review" .claude/skills/` claimed 1 hit and returns **2** (`07aeb1a`'s own fix added
> the front-matter description in the same commit that published the count), and L17's `pnpm check`
> locator listed 2 of **3** hits. All **17 line-number** locators reproduce: no position moved.
>
> **The scope sentence matters as much as the digits.** `07aeb1a` reported this same sweep as
> "7 full-path greps, 0 mismatches" — true of the 7 rows whose verify cell spells out a
> `.claude/skills/…/SKILL.md` path (L1 L9 L6 L10 L3 L12 L2), because the checking regex matched only
> those and silently skipped the 8 abbreviated `…` rows (L13 L7 L14 L8 L5 **L11** L16 L15). Both misses
> above sit in the skipped half. A completeness claim that quietly checked 7 of 15 rows is the C1 shape
> even when its answer holds — so state the set, not just the count.

> **Greps that verify a remedy's absence run with `-i`, and a row claiming absence names the pattern it
> ran.** The first version of this table carried an L4 row ("Level-4 manual steps must be performable")
> claiming absence on a **case-sensitive** grep against a heading written in caps. The rule was present
> all along, at `piv-plan-implementation:395`. That is the C1 class — a claim whose evidence did not check
> what the claim asserted — committed inside the ledger built to stop it.
>
> Two more traps found while re-running all 15 on 2026-09-04, both of which produced a false absence
> before they were caught: **`grep -E "--wait"` returns nothing** because the pattern is eaten as an
> option (use `grep -e`), and **a truncated grep preview hides the clause you are looking for** —
> `cut -c1-190` nearly lost L3's "if it recurs a third time", which sits past column 190. Read the whole
> line, not the preview.

## Open

| ID | Remedy | Origin | Class | Recurrences since logged | Status at HEAD |
|----|--------|--------|-------|--------------------------|----------------|
| L17 | `piv-validate:10` calls `pnpm check` **the gate**, but CLAUDE.md's gate and `.github/workflows/ci.yml` both run `typecheck lint test build`. `pnpm check` omits `build`, so the skill's own step 1 is not CI parity — and the TS6053 stale-`.next` row added under L6 cannot fire under the command step 1 names | this loop, 2026-09-04 (raised while applying L6; deliberately not folded into it — it changes what the skill *runs*, not how it triages) | C7 | — | present and wrong: `grep -n "pnpm check" .claude/skills/piv-validate/SKILL.md` → 10, 25, 86 |
| L18 | The word-split argument hazard L12 fixed is not unique to one skill: `piv-fix-review-findings:5` declares `arguments: [review, scope]` and `system-execution-report:5` declares `[plan]`, both of which split a free-form sentence the same way. The fix pattern already exists in-repo — `opportunity-scan:27`, "Read `$ARGUMENTS` as **prose**, not as positional slots" | this loop, 2026-09-04 (found while verifying L12's coupling) | C7 | — | absent — `grep -n "^arguments:" .claude/skills/*/SKILL.md` → 3 files, only `system-evolution-review` now guarded |
| L19 | CLAUDE.md's Redis-skip figure has drifted again. It states `33 skipped, 582 passed, 615 total` / `2 skipped, 64 passed, 64 of 66 total` at `feed712`. `observed` at `c70572b` (this loop's full parity run): `@taxi/api  Tests: 35 skipped, 660 passed, 695 total` / `Test Suites: 2 skipped, 71 passed, 71 of 73 total`. The digit is the fourth version of this line; CLAUDE.md's own note says to re-observe the whole claim rather than patch the digit, so this is logged rather than edited in passing | this loop, 2026-09-04 | C1 | 4th occurrence of this specific line drifting | stale — `grep -n "33 skipped" CLAUDE.md` |

## Closed this loop (2026-09-04, `docs/remedy-ledger-apply`)

All 15 open rows applied in one pass on Linards's instruction, overriding CLAUDE.md's "act on 1–2 of its
suggestions". Every remedy is a skill edit or a script; **none is a CLAUDE.md paragraph** — prose remedies
demonstrably do not fire here (see Accepted risks). Each row's grep was run at the working tree.

| ID | Landed in | Verify at HEAD |
|----|-----------|----------------|
| L1 | `piv-plan-implementation` Phase 2, new **6. Fact Verification** | `grep -in "read out of the source, decorators included" .claude/skills/piv-plan-implementation/SKILL.md` → 102 |
| L13 | same block (L1 and L13 are one motion: verify a plan claim against a real repo artifact) | `grep -in "checked the same way against the config that lints it" …` → 105 |
| L7 | `piv-plan-implementation` Phase 4 **Figures and enum-shaped sets**, mirrored as a Quality Criteria checkbox | `grep -in "Every figure this plan states carries its provenance" …` → 176; `grep -in "Every figure carries its provenance" …` → 529 |
| L14 | same Phase 4 block | `grep -in "compile-pinned .Record<Enum, X>." …` → 179 |
| L8 | `piv-plan-implementation` Task Format, under the `GOTCHA` field | `grep -in "the GOTCHA is binding and IMPLEMENT is a sketch" …` → 354 |
| L5 | `piv-plan-implementation` ACCEPTANCE CRITERIA template | `grep -in "owed by #N" …` → 442 |
| L9 | `piv-review-pr` Phase 4, new **### The constraint pass** | `grep -in "The constraint pass" .claude/skills/piv-review-pr/SKILL.md` → 60 |
| L11 | `piv-review-pr` Phase 6 — `gh pr comment` is now the only post path | `grep -in "refuses BOTH verbs" …` → 157; and `grep -rn "gh pr review" .claude/skills/` → **2 hits, both deliberate**: the explanatory comment at `:156` and the front-matter description at `:3`, which names the refusal so the skill index carries it |
| L6 | `piv-validate` new **## 3. Environment or code?**, four signatures with their clearing commands | `grep -in "Environment or code" .claude/skills/piv-validate/SKILL.md` → 42 |
| L16 | `piv-validate` Notes | `grep -in "A green gate is not a green CI" …` → 88 |
| L10 | `piv-implement` **Ready for the next step** | `grep -in "Commit before you stop" .claude/skills/piv-implement/SKILL.md` → 138 |
| L15 | `piv-implement` concurrent-session bullet | `grep -in "keep new migrations additive" …` → 29 |
| L3 | `piv-commit` Process step 2 | `grep -in "Plan-staleness check" .claude/skills/piv-commit/SKILL.md` → 19 |
| L12 | `system-evolution-review` front matter + a shape-testing guard (pattern shortened: the fix for an empty first argument wrapped the original phrase across a line break, and a single-line grep stopped matching a rule that is still there) | `grep -in "word-split sentence, not a plan" .claude/skills/system-evolution-review/SKILL.md` → 41 |
| L2 | **`.claude/skills/piv-create-pr/scripts/{record-gate.sh,inherited-figures.sh}`**, referenced from a blocking **Phase 2.5** | `grep -in "record-gate.sh" .claude/skills/piv-create-pr/SKILL.md` → 64, 68; `ls .claude/skills/piv-create-pr/scripts/` → both files |

**Three rows were applied against their own origin's trigger, disclosed rather than hidden.** L3's origin
(Phase C review, `:135`) says "if it recurs a third time" and it has two occurrences. L15 and L16 both
carry origins that say log-only-until-it-recurs, and the ledger's own recurrence column reads "none" for
both. All three were applied because Linards asked for all 15 in one pass; that is the reason, not a
claim that their thresholds were met.

**L2, in more detail, because it is the row that failed twice.** Both scripts existed before, at
`~/.claude/skills/piv-create-pr/scripts/`, and `git log --all b053c10~1 -- '.claude/skills/piv-create-pr/scripts/'`
was empty before this PR — they had **never been in-repo**, which is why the #129 cleanup destroyed them
with no review noticing. (Present tense would now be false: this PR is what put them under version control.) The restored copies are the archived originals (`~/.claude/_skills-archive-2026-08-28/`) plus
fixes for what they missed:

- `record-gate.sh` now derives the **expected task count at this head** from `turbo … --dry=json` and
  asserts the run matched it, and separately **prints every task in the graph whose package defines no
  such script**. The second half is the one that matters: a derived count alone would *not* have caught
  `@taxi/rider` and `@taxi/driver` running with no lint and no test, because the dry run drops the same
  absent tasks the real run does and the two agree at 18. Naming them is what makes the hole visible.
- It distinguishes **short** (exit 0, but the gate did not check the graph) from **red** (a task failed),
  and treats three separate zero-exit cases as short: fewer tasks than the graph, no summary printed at
  all, and **zero tasks run**. Both refinements came from running the thing rather than reasoning about
  it. The first draft conflated short with red and labelled a genuinely red run "GATE SHORT", which is
  false about a run that failed. The second draft fixed that and thereby made the guard **unreachable in
  the case it exists for**: `pnpm turbo run build --filter @taxi/config` prints `Tasks: 0 successful,
  0 total` and exits 0, and `0 == 0` made the equality test agree that all was well — `observed`, the
  script printed a green ``observed — … exit 0`` block for a gate that checked nothing. Now exit 3.
- `inherited-figures.sh` gains `--pr <N>` (the published body is the surface no working-tree grep reaches)
  and degrades to a printed note + exit 0 when there is no prior surface, which is the ordinary case for a
  docs-only PR. A check that errors on the ordinary case gets removed from the skill that calls it.

`observed`, this session, all three script paths exercised rather than only the happy one:

- Green: full parity gate at `c70572b`, `--clean`, exit 0 — `Tasks: 22 successful, 22 total`,
  `Cached: 0 cached, 22 total`, `Time: 1m22.325s`. 22 is corroborated twice over: `--dry=json` minus
  `<NONEXISTENT>` = 22, and the run's own summary = 22.
- Red: a deliberate type error in `packages/shared` — `**GATE RED** (exit 2)`, `Failed: @taxi/shared#typecheck`,
  script exit 2, `short_gate: false`. The temporary file was removed; `git status` clean of it.
- `inherited-figures.sh` against a real artifact pair (`.claude/reports/rider-app-auth-booking-screen-reader-first-report.md`
  vs PR #150's **published** body, 98 lines): **6 inherited measurements**, exit 1 — `0 cached`, `0 skipped`,
  `1 failed`, `223 passed`, `23.6 s`, `27 files`. Pattern that produced it:
  `UNITS='passed|failed|skipped|total|suites?|files?|tests?|cases|lines|queries|rows|frames|successful|cached'`
  plus a bare-duration match. The count is this run's, not the destroyed version's 13 — that figure
  described a different pair and is not inherited here.

### Also closed this loop — the A1/A2 remedies from the project-wide review

- `piv-fix-review-findings`: fix-mechanism question · checkable grep-list output · closing-command-before-closing-sentence
  — applied; verify `grep -n "new failure mode" .claude/skills/piv-fix-review-findings/SKILL.md`.
- `piv-review-pr`: round ≥ 2 fix-mechanism pass — applied; verify `grep -n "fix-mechanism pass" .claude/skills/piv-review-pr/SKILL.md`.
- `system-evolution-review`: read/update this ledger; recurring-mechanism learnings become action items or
  are marked accepted risk; adherence-score blindness noted — applied; verify `grep -n "REMEDY-LEDGER" .claude/skills/system-evolution-review/SKILL.md`.

**Eight corrections were made to those three edits before they landed**, from an audit that read every
hunk against HEAD rather than against the review that proposed them. Two were blocking: the new text told
a reviewer to cross-check "the fix report" without ever binding it to a path (now
`.claude/reports/pr-{N}-review-fixes.md`, and `piv-fix-review-findings`'s Output section says to write it
there); and it closed with "that is how the project's only two mechanised gates died", which is **false at
HEAD** — `.claude/hooks/stop_check.py` runs `pnpm check` and blocks the stop, and `pre_tool_use.py` is
live. That sentence was inherited verbatim from `project-wide-evolution-review.md:88` and never re-checked:
the C1 class again, inside the remedy written to stop it. The rest corrected a misquote ("next loop's
**apply** slot"), a self-contradictory adherence sentence, an embellished interval ("one ticket later" —
a full loop with its own review sits between #87 and #107), and the claim that PR #150's L5 "wrote it
before the closing command ran" when the record says the command ran on pre-fix code.

## Closed earlier — verified still present at HEAD 2026-09-04

PR-state guard + mid-merge probe (`piv-fix-review-findings` §0) · value-sweep + 4-surface list (§2) ·
numbers pass, mechanism check, guarantees pass + `baseRefOid` trigger (`piv-review-pr`) · figures-by-command
rule (`piv-create-pr:43`) · worst-case ordering rule (`piv-plan-implementation`) + in-app-order delivery
test · deviations re-read widened to UX states/ACs (`piv-implement`) · worktree-from-start ·
concurrent-sessions paragraph (CLAUDE.md) · provenance clause (CLAUDE.md) · hooks `$CLAUDE_PROJECT_DIR`
fallback (`settings.json:27,38`) · `completed`-vs-`settled` note (`ride-state-machine.md:19`) · `mint:ride`
(`services/api/scripts/mint-tracked-ride.ts`) · **L4** Level-4 steps performable
(`grep -in performable .claude/skills/piv-plan-implementation/SKILL.md` → 415).

## Accepted risks

- Another CLAUDE.md paragraph on claim inheritance — rejected four times (#18, Phase C, #16, and this
  loop): prose remedies demonstrably do not fire; enforcement lives in skill steps instead.
- Automated PR-body figure recomputation in CI — rejected (#18 review): figures live on GitHub, the check
  would fire after writing; prevention in `piv-create-pr` Phase 2.5 is cheaper and now exists.
- `gh pr review --approve` cannot be tested read-only — settling it first-hand needs a real approve
  attempt on an open PR. Five independent artifacts record the refusal (`pr-79`, `pr-81`, `pr-90`,
  `pr-99:238`, `pr-138:96`) and two more record `--request-changes` failing the same way
  (`pr-139-review-round2.md:150`, `round3.md:159`), which is why L11 removed **both** verbs and not just
  the one the row named.
