# Handover — apply all open remedy-ledger items

Written 2026-09-04 by the session that produced `project-wide-evolution-review.md` and `REMEDY-LEDGER.md`.
Purpose: let a fresh session apply all 15 open items without re-deriving where each edit goes. Everything
below the "Insertion points" heading is `observed` — read out of the target files in this session at
HEAD `602d5fb`. Line numbers are from that HEAD; they move as you edit, so match on the quoted text,
not the number.

## State you are inheriting

- **Branch**: `feature/driver-offers-active-ride` (its own work, #15, is committed at `602d5fb`).
- **Uncommitted, from the review session** — 3 modified + 2 new:
  - `M .claude/skills/piv-fix-review-findings/SKILL.md` (remedy A1: fix-mechanism question in §2,
    subject-grep + checkable grep list, closing-command-before-closing-sentence in §4)
  - `M .claude/skills/piv-review-pr/SKILL.md` (remedy A1: round-≥2 fix-mechanism pass in Phase 4)
  - `M .claude/skills/system-evolution-review/SKILL.md` (remedy A2: read/update the ledger, adherence-score
    blindness note, Key-Learnings action-item rule)
  - `?? .claude/system-reviews/project-wide-evolution-review.md`
  - `?? .claude/system-reviews/REMEDY-LEDGER.md`
- **These must not land on the #15 PR.** Memory `taxi-pr-review-report-location`: docs written into a
  branch get swept into that branch's PR, then belong to no branch and orphan (five did — #138–#142,
  rescued by #143). Land them on a `docs/` branch cut from `origin/main`, per that memory's 2026-09-03
  note (review detached, then branch off origin/main in the same worktree, PR both at once).
- No other session is live: `git reflog -8` shows only this branch's own two commits (`observed`).

## Ground rules that bit this project (read before editing)

1. **A remedy that edits a skill fires later; one that adds prose to CLAUDE.md does not.** Memory
   `taxi-piv-remedies-need-an-executable-step`, and #87 ran both on one day as a near-controlled
   experiment. Do not solve any of these items by adding a CLAUDE.md paragraph. Three of the ten reviews
   explicitly rejected that route.
2. **Verify absence with `grep -i`.** This handover's own ledger shipped a false row (L4) built on a
   case-sensitive grep against a capitalised heading. Re-run each item's grep with `-i` before writing
   its edit; if the rule is already there, retire the row instead of duplicating the text.
3. **The PreToolUse hook matches command *text*, not intent** (memory
   `taxi-pretooluse-hook-blocks-dotenv-strings`). It blocks a Bash command containing dotenv-ish strings
   or `this`/`process` env member access, and it kills every edit batched in that command. So: write the
   two L2 shell scripts with the **Write tool**, never a heredoc; pass commit bodies with
   `-F`/`--body-file` from the scratchpad; the hook also blocks every form of `rm -r`.
4. **Don't bloat.** Six of the fifteen items land in `piv-plan-implementation/SKILL.md`, which is already
   526 lines. Group them (see below) rather than scattering six paragraphs; the file is read in full by
   every planning session, and length is a real cost.
5. `.claude/last-gate.json` (written by the L2 script) needs a `.gitignore` line — the Phase A review
   left this loose end deliberately and it is still open. `.gitignore` currently has a `# claude` section
   holding only `.claude/settings.local.json`; add it there.

## Insertion points, per item (`observed` at 602d5fb)

### `piv-plan-implementation/SKILL.md` — six items, land as one group

| Item | What | Where |
|---|---|---|
| L1 | A stated fact about existing code is verified by **reading the source** — decorators included — never from a comment, a sibling plan, or memory. Instances: #63 E.164 registry comment, #86 `@HttpCode(204)`, #150 dev-2 (Places token) and dev-3 (breadboard promised data the contract lacks). **Oldest item — queued since #86, class recurred twice.** | Phase 2, as a 6th numbered item after **5. Integration Points** (whose last bullet is the task-runner env passlist, line 98) |
| L13 | Check proposed patterns against the repo's **eslint config** — a plan proposed `setState`-in-effect, which the config forbids; also `expect.any()` inside an object literal (trips `no-unsafe-assignment`) | Phase 2, **2. Pattern Recognition**, the "Identify coding conventions" bullet list (lines 68–73) |
| L7 | A plan's quantitative claims carry **provenance at authoring time** (`observed`/`derived`/`expected`). `30` entered at plan:447, was inherited twice, audited only at review | Phase 4 **Deep Strategic Thinking**, as a short block beside the DB schema checklist (line 157); mirror one checkbox into **Quality Criteria → Information Density** (line 500) |
| L8 | When a task's **GOTCHA forbids the shape its IMPLEMENT line sketches, the GOTCHA is binding** and IMPLEMENT is a sketch — say so in the divergence log rather than splitting the difference (#121 D1 resolved right only because the implementer noticed) | Task Format block, immediately under `- **GOTCHA**: {…}` (line 335) |
| L14 | When a plan enumerates a set that must stay 1:1 with an enum, specify the **compile-pinned `Record<Enum, X>` form**, not a prose list — the pin caught 4 missing keys in #63; the prose list missed `page.retry` | Phase 4 Design Decisions (line 150) or beside L7's block — one sentence |
| L5 | An AC whose verification this machine **cannot perform** (hardware/credentials confirmed absent at planning time) is not this ticket's AC: `gh issue create` now, put the number in the AC, mark it "owed by #N". #16 knew on 2026-09-02 and still carries three owed ACs | **ACCEPTANCE CRITERIA** template section (line 417), as a comment line under the heading |

Already present, do **not** re-add: Level-4 performable rule (395–409, this is retired L4), worst-case
ordering rule (450–453), in-app-connection-order delivery test (357–362), edge-case-names-its-verifier
(366–369), task-runner env passlist (98), DB schema checklist (157–162).

### `piv-review-pr/SKILL.md` — two items

| Item | What | Where |
|---|---|---|
| L9 | Before recommending a fix, check it against the plan's **ACCEPTANCE CRITERIA and CONTEXT REFERENCES** for a "do NOT modify" constraint — #87's M2 prescribed editing a file the plan's AC #5 froze; only triage caught it. A fix that breaks the PR's own AC is filed as a follow-up, not recommended inline | Phase 4, after the severity table / before **The numbers pass** (line ~92) |
| L11 | `gh pr review --approve` **always fails on this repo** (solo, Linards authors every PR — memory `taxi-pr-self-approval`). Phase 6 still prints it first | Phase 6 code block (lines 145–152) — make `gh pr comment` the approve path and say why |

### `piv-validate/SKILL.md` — two items

| Item | What | Where |
|---|---|---|
| L6 | **Distinguish environment failure from test failure.** A dead docker daemon makes `@taxi/db#test` red with `Cannot connect to the Docker daemon`; turbo then kills every sibling task and it reads as a broad code failure. Also: a red `@taxi/api` jest run never exits, so the gate looks hung rather than red — healthy is 60–90 s, past ~3 min read the buffered log (memory `taxi-gate-hangs-on-red-api-suite`); a worktree with no `.env` makes a `REDIS_TEST_URL` gate hang silently (`taxi-worktree-env-redis-hang`); a stale `apps/dispatch/.next` reddens dispatch typecheck in ~25 s (`taxi-gate-stale-next-race`) | New step between **2. Narrow a failure** (line 30) and **3. Optional smoke test** (line 40): read `Failed: <task>`, classify env-vs-code, name the fix |
| L16 | CI healthcheck parity: compose healthchecks and CI service-container healthchecks differ (socket vs TCP readiness on cold volumes) — one occurrence, from #6 | One line in **Notes** (line 64) |

### `piv-implement/SKILL.md` — two items

| Item | What | Where |
|---|---|---|
| L10 | End the run with a **`wip:` commit** on the feature branch so the working tree is never the only copy of a day's implementation — #16's implementation lived uncommitted for a day and was committed cold by another session. `piv-commit` amends it | **### Ready for the next step** (line 133) |
| L15 | While several sessions share one dev DB, prefer **additive/nullable migrations** and note any skew in the report (#86 migrated to 0008 while siblings carried 0007) | The concurrent-session bullet in **Before you start** (lines 24–28) |

### `piv-commit/SKILL.md` or `piv-create-pr/SKILL.md` — one item

| Item | What | Where |
|---|---|---|
| L3 | **Plan-staleness check**: a divergence documented in the report must update the plan's task list or mark it superseded. #120 lost 2 points for this, #121 lost 1 ("a process defect, not an oversight") — Task C4 still named the retired coupling on `main` days later. Phase C's own rule says codify at the third occurrence; you are applying it at two on the user's instruction | `piv-commit` **Process** step 2–3 (lines 15–18) is the cheapest hook — it already reads `git status`; or `piv-create-pr` Phase 2 beside the report read (line 50) |

### `system-evolution-review/SKILL.md` — one item

| Item | What | Where |
|---|---|---|
| L12 | The **arg template word-splits** free-form input: `arguments: [plan, report]` gave `$plan`="the", `$report`="whole" when this session was invoked with a sentence. The guard text (line 31) correctly caught it, but the template still splits | Front matter `argument-hint`/`arguments` (lines 4–5) + the guard paragraph — accept a single free-form scope argument, or state that a non-path first arg means project-wide scope |

### New files — one item

| Item | What | Where |
|---|---|---|
| L2 | Rebuild the two destroyed gate scripts **in-repo** so deletion is visible: `record-gate.sh` (run the gate, stamp the result with the commit it describes, write `.claude/last-gate.json`, print a paste-ready Validation block, **exit with the gate's own code** so a red gate cannot produce a green-looking record) and `inherited-figures.sh` (print every measurement present in both the new surface and a prior one — the implementation report always, the PR's previous body when updating). Bind numbers to measurement words (`passed`/`failed`/`suites`/`files`/`lines`/`queries`/`rows`/durations): a first draft matching every 2+ digit number produced 29 hits, mostly issue refs and dates; the bound version produced 13, all genuine | `.claude/skills/piv-create-pr/scripts/`, **referenced from `piv-create-pr/SKILL.md`** (a blocking Phase 2.5) so a future cleanup cannot delete them silently — that is exactly how they died (memory `taxi-pr-figures-gate-scripts`, gone with the `~/.claude/skills` archive in #129). Write both scripts' **limits into the skill**: neither catches a right number under a wrong label (#87), nor a claim with no numeral (#121's retargeting sentence) — those stay by-eye checks |

## Verification owed at the end

- Per item: the `grep -in` that shows its text at HEAD. Put the list in the commit body or a short report;
  the ledger's closed rows each need one.
- `record-gate.sh` must be **run for real** (`observed`), not just written — the last version's evidence
  was a real gate run at `feed712` (exit 0, `18 successful, 18 total`, `1m0.577s`). Needs
  `docker compose up -d --wait` first, and `COMPOSE_PROJECT_NAME=taxi` if you are in a worktree. Expect
  60–90 s; the task count is now higher than 18 (#150 added `@taxi/rider` lint+test, taking #16's run to
  22 — re-derive it, do not copy either figure).
- `inherited-figures.sh` must be run against a real artifact pair, and its hit count reported with the
  pattern that produced it.
- Update `REMEDY-LEDGER.md`: move every applied item to the closed section with its grep. The skill now
  requires this (remedy A2), so the next review will check it.
