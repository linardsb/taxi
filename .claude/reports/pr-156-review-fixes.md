# PR #156 — round-1 review fixes

**Review:** [comment 5598463985](https://github.com/linardsb/taxi/pull/156#issuecomment-5598463985) ·
**Fixes commit:** `6be079b` · **Base of the round:** `07aeb1a` · 2026-09-09

**All 3 highs, all 6 mediums and the script lows are fixed.** One conventions low is deferred with a
reason. Nothing was dropped silently.

The review's recommendation was *request changes*, and its framing was right: every high was the same
defect — a published claim that does not reproduce at HEAD — which is the exact class this PR exists to
remove. Three of them were minutes of work.

## Ground check

| Check | Result |
|---|---|
| PR state | **OPEN** (`gh pr view 156 --json state` → `OPEN`, base `main`, `MERGEABLE`) |
| Worktree | clean at start; `ls "$(git rev-parse --git-dir)"/{MERGE,REBASE,CHERRY_PICK}_HEAD` → none |
| Other sessions | `git reflog -8` shows only this branch's three commits since `c70572b` |

## One correction to the review

**H3's locator is half wrong, and this matters for where the fix goes.** The review says *"The ledger and
commit `07aeb1a`'s message both say"* the "7 full-path greps, 0 mismatches" sentence. **The ledger does
not contain it.** `observed` at `07aeb1a`:

```
grep -rn "re-run and compared\|has since been re-run\|Every published grep\|full-path\|0 mismatches" .claude/
  → no hits in the working tree
git log -1 07aeb1a --format=%B | grep -n "full-path"     → 51: "against what it claims: 7 full-path greps, ..."
gh pr view 156 --json body -q .body | grep -n "full-path" → 178: "... 7 full-path greps, 0"
```

So the claim lives on **two** surfaces, not three: the **PR body** (fixable, and fixed) and **`07aeb1a`'s
commit message** (pushed history, not fixable without a force-push). H3's *substance* is untouched by
this — the claim was real and wrong — but a reviewer told to check the ledger for it would find nothing
and conclude the fix was skipped. Recorded here so round 2 does not re-raise it.

## Highs

### H1 — 4 of the 8 locators in the PR body's table were stale · FIXED

The table was written at `b053c10`; `07aeb1a` shifted lines and only the ledger's copies were re-derived.

`observed` at `6be079b` — every row re-run, not only the four the review named:

| Row | Body said | Actual | Fix |
|---|---|---|---|
| L11 `refuses BOTH verbs` | 156 | **157** | line corrected |
| L3 `Plan-staleness check` | 16 | **19** | line corrected |
| L12 `word-split sentence, not a plan path` | 41 | **no match** | **pattern** corrected to `…not a plan` — a fix wrapped the phrase across a line break, so the line was right and the grep was not |
| L2 `record-gate.sh` | 63, 67 | **64, 68** | lines corrected |

**Fix mechanism, and its new failure mode.** The mechanism is "re-derive at the final tree" — which fails
if the re-derivation runs *before* the last edit, exactly the way `07aeb1a` failed. So the sweep was run
**after** every content edit in this round, as one script over both surfaces, and its raw output is
below. The L12 row is the case that proves a line-number check is not enough: its line never moved.

### H2 — the ledger published a grep result its own commit falsified · FIXED

L11's row claimed `grep -rn "gh pr review" .claude/skills/` → *1 hit, inside the explanatory comment*.
It returns **2**: `07aeb1a`'s own fix added the phrase to the front-matter description at
`piv-review-pr/SKILL.md:3`, in the same commit that published the count.

**Closing command, run at `6be079b`:**

```
$ grep -rn "gh pr review" .claude/skills/
.claude/skills/piv-review-pr/SKILL.md:3:description: … (`gh pr review` is refused on this solo repo) …
.claude/skills/piv-review-pr/SKILL.md:156:# `gh pr review` is unusable here: solo repo, gh is authenticated …
```

The ledger row and the PR body's "L11 is wider than its row said" section both now say 2 hits and why
each is deliberate.

### H3 — a completeness claim made with a narrower method than it implies · FIXED

The mechanism is confirmed, not just the count. The checking regex matched only rows whose verify cell
spells out a `.claude/skills/…/SKILL.md` path:

```
$ awk '/^## Closed this loop/,/^### Also closed/' .claude/system-reviews/REMEDY-LEDGER.md | grep '^| L' \
    | awk -F'|' '$4 ~ /\.claude\/skills\/[a-z-]*\/SKILL\.md/ {print $2}'
  L1 L9 L6 L10 L3 L12 L2          → 7 rows matched
  L13 L7 L14 L8 L5 L11 L16 L15    → 8 abbreviated "…" rows skipped
```

**Both of this round's ledger mismatches sit in the skipped half** — L11 (H2) and L17 (M6). That is the
mechanism, not a coincidence.

**I did not adopt the review's "16".** It showed no working. My own machine count of the Closed-this-loop
table is **15 rows / 18 checks — 17 greps and one `ls`**; adding L4 in *Closed earlier* (1) and the 3
*Open* rows makes **22 checks in three groups**.

Re-run at `6be079b`: **20 of 22 reproduce; 2 published results did not.** The two failures sit in
*different groups* — L11 is one of the Closed table's 18, L17 is one of *Open*'s 3 — so "17 of 18" would
be the wrong frame for both: it reads as if both failures were inside the 18, and 17 + 2 does not sum
against 18. Stated per group: **17 of the Closed table's 18 hold, 1 of 1 in *Closed earlier*, 2 of
*Open*'s 3.** Separately, all **17 line-number** locators reproduce — no position moved; both
corrections are to published *results*.

The ledger header now names the set, the grouping and the date instead of a bare count, so the next added
row cannot silently fall outside it.

## Mediums

| ID | Fix | Closing command, run at `6be079b` |
|---|---|---|
| **M1** | "Nine lines across five" → **Ten** (`piv-create-pr/SKILL.md:59` and the PR body) | `git grep -n record-gate c70572b \| wc -l` → **10**, across `cut -d: -f2 \| sort -u \| wc -l` → **5** files |
| **M2** | the dirty-tree caveat printed **inside** the pasted block, not only on stderr | probe below |
| **M3** | a readable prior holding no measurement no longer prints `PASS` | probe below |
| **M4** | "every measurement" → "every measurement it can bind to a unit word or a duration", in the skill **and** the script header | `grep -n "every measurement" .claude/skills/piv-create-pr/SKILL.md` → 75, bounded |
| **M5** | `[ -f ]` at **both** guards, not just `$new` | probe below |
| **M6** | L17's locator lists 3 hits | `grep -n "pnpm check" .claude/skills/piv-validate/SKILL.md` → **10, 25, 86** |

**M5 was wider than the review said.** The review named `inherited-figures.sh:53` (`$new`). Line 83
guards each *prior* with the same `-r`, so a directory prior counted as readable, extracted nothing, and
landed on M3's path — where M3's new message would have reported "a surface with no measurements" for
what is a bad-path bug. Both guards are fixed, which is why the M5b probe below exists.

## Lows — all fixed

`record-gate.sh`: `--help` sized itself instead of a fixed `2,45p` range (it had already gone stale once
and the header grew past it again) · `tr -d ' '` mangled a fully-cached `Time: 47ms >>> FULL TURBO` into
`47ms>>>FULLTURBO` and pasted it verbatim · JSON strings escaped `"` but not `\` · a fully-cached gate
exits 0, matches the expected count, and re-ran nothing — now says so.

`inherited-figures.sh`: `mktemp -d` unguarded · tab-separated figures formed distinct keys from
space-separated ones · flagged figures printed with no `file:line` when the source spacing was irregular.

## Probes — each fix run against the **pre-fix** copy first

Pre-fix copies taken with `git show HEAD:<path>` at `07aeb1a`. `observed`, 2026-09-09.

### M2 — dirty-tree caveat (`record-gate.sh -- true`, dirty tree)

```
BEFORE   **GATE SHORT** — exit 0, but no of ? tasks ran at `07aeb1a`.
         A gate that runs nothing exits 0 … This record is NOT a pass.
         ```                                    ← no dirty marker anywhere in the block

AFTER    **GATE SHORT** — exit 0, but no of ? tasks ran at `07aeb1a`.
         A gate that runs nothing exits 0 … This record is NOT a pass.
         (dirty tree — this run covers uncommitted changes `07aeb1a` does not contain.)
```

### M5 — a directory as `<new-surface>`, and as a **prior** surface

```
BEFORE  ./inherited-figures.sh <dir>  <prose.md>  → PASS — no measurement in adir also appears …   exit 0
AFTER   ./inherited-figures.sh <dir>  <prose.md>  → cannot read file …/adir                        exit 2

BEFORE  ./inherited-figures.sh <new.md> <dir>     → PASS — no measurement in new.md also appears …  exit 0
AFTER   ./inherited-figures.sh <new.md> <dir>     → note: skipping unreadable prior surface …/adir
                                                    NOTE — no readable prior surface … It is NOT a pass  exit 0
```

### M3 — a readable prior containing no measurement

```
BEFORE  PASS — no measurement in new.md also appears in the prior surface(s).            exit 0
AFTER   NOTE — 1 prior surface(s) read, but none contains a figure this check can
        bind to a unit word or a duration, so there was nothing to compare against.
        It is NOT a pass: every figure in new.md is still unaudited …                    exit 0
```

### Lows — `file:line` under irregular spacing, and tab keys

Fixture: `new2.md` holds `22  passed` (two spaces) and `\t22\tpassed` (tabs); prior holds `22 passed`.

```
BEFORE    "22 passed"
          (nothing — neither source line was located)
AFTER     "22 passed"
              1:Body says 22  passed (two spaces).
              2:And a tab form:	22	passed here.
```

### Lows — `--help`, the cached elapsed line, JSON escaping

```
--help    BEFORE last line: "…turbo kills its siblings, and the resulting"     ← mid-sentence
          AFTER  last line: "…ELIFECYCLE noise reads as a broad code failure when one package is red."
          AFTER  prints 45 lines; the header is 45 comment lines (self-sizing, cannot go stale again)

elapsed   input "   Time:    47ms >>> FULL TURBO"
          BEFORE  47ms>>>FULLTURBO          AFTER  47ms
          input "   Time:    1m13.444s"     AFTER  1m13.444s   (unchanged, as intended)

JSON      input  pnpm turbo run a\b "quoted"
          BEFORE JSON.parse → pnpm turbo run a "quoted"   ← \b silently eaten as a backspace
          AFTER  JSON.parse → pnpm turbo run a\b "quoted" ← exact round-trip
```

### Fully-cached detection

```
"22 cached, 22 total" → CACHE HIT note printed
"0 cached, 22 total"  → no note        "7 cached, 22 total" → no note        "" → no note
```

## The value sweep — grep-list, not a sentence

Each retired value grepped across the working tree **and** the published PR body (`gh pr view 156 --json
body`), because no working-tree grep reaches the body. `observed` at `6be079b`.

| Retired value / noun | `grep -rn … .claude/` (tree) | `grep -n …` (PR body) |
|---|---|---|
| `Nine lines` | 0 hits | was `:170` → **fixed** |
| `Ten lines` | `piv-create-pr/SKILL.md:59` ✅ | present ✅ |
| `one hit` (the `gh pr review` count) | 0 hits in the ledger | was `:42` → **fixed** |
| `2 hits` | `REMEDY-LEDGER.md:62` ✅ | present ✅ |
| `full-path` / `0 mismatches` | `REMEDY-LEDGER.md:21` — now the *corrected* framing ✅ | was `:178` → **fixed** |
| `10, 25` (L17 locator) | `REMEDY-LEDGER.md:43` → now `10, 25, 86` ✅ | 0 hits |
| `every measurement` | `SKILL.md:75`, `inherited-figures.sh:34` → both bounded ✅ | 0 hits |
| `two .claude/system-reviews. docs` | 0 hits | was `:11` → **fixed** to three |

**Two hits deliberately not edited**, so the sweep is not silently incomplete:
`HANDOVER-remedy-apply.md:101` and `dispatch-override-phone-orders-zones-review.md:112` both say the
script should "print every measurement". Both are **dated records of what was specified**, not live
claims about what the script does. Editing them would rewrite the record of what was asked for, which is
the opposite of the ledger's purpose. The live surfaces — the skill and the script header — are bounded.

## The locator re-derivation — run once, after every content edit

`observed` at `6be079b`. Every locator in the ledger's three tables and in the PR body's table:

```
id     hits       claimed
L1     102        102        L9     60         60         L3     19         19
L13    105        105        L11    157        157        L12    41         41
L7a    176        176        L6     42         42         L2     64,68      64,68
L7b    529        529        L16    88         88         L4     415        415
L14    179        179        L10    138        138
L8     354        354        L15    29         29
L5     442        442

L2  ls            → inherited-figures.sh, record-gate.sh
L11 grep -rn      → 2 hits at :3 and :156          (was published as 1 — H2)
L17 pnpm check    → 10, 25, 86                     (was published as 10, 25 — M6)
L18 ^arguments:   → piv-fix-review-findings, system-evolution-review, system-execution-report
L19 33 skipped    → CLAUDE.md:43                   (still stale by design — L19 is an OPEN row)
```

**All 17 line-number locators reproduce; no position moved under this round's edits.** The two
corrections are to published *results* (H2, M6), not to positions. Group totals: Closed table 17/18,
*Closed earlier* 1/1, *Open* 2/3 — **20 of 22**.

## Validation

Both figures below are `observed`, and each says what it licenses.

**1. The gate is unaffected by this branch, by construction.** Stronger than a re-run, and worth stating
because the reviewer observed this gate flaking on two different tasks (`@taxi/dispatch#test` focus, and
an `@taxi/api` transport-level `Parse Error`), neither attributable here:

```
$ git diff --stat 07aeb1a..af0cfe4 -- . ':(exclude).claude' ':(exclude).gitignore'
(empty — 0 files)
$ git diff --stat origin/main...af0cfe4 -- . ':(exclude).claude' ':(exclude).gitignore'
(empty — 0 files)
$ git diff --name-only 07aeb1a..af0cfe4          # the same range with NO excludes
.claude/reports/pr-156-review-fixes.md
.claude/skills/piv-create-pr/SKILL.md
.claude/skills/piv-create-pr/scripts/inherited-figures.sh
.claude/skills/piv-create-pr/scripts/record-gate.sh
.claude/system-reviews/REMEDY-LEDGER.md
```

Every file this branch touches is under `.claude/` plus two `.gitignore` lines. No package compiles,
lints or tests any of it.

**The third command is not decoration — it is what stops the first two being an identity function.**
An earlier draft of this section printed the same two commands written `07aeb1a..HEAD`, and they were
run while `HEAD` *was* `07aeb1a`: `A..B` with `A == B` is empty by construction, proves nothing, and
would not have shown the then-uncommitted changes in any case, since `..` compares commits and not the
working tree. That is #107's shape exactly — a correctly-derived counterfactual printed as **Observed**
where the mechanism was an identity function — reproduced inside the report written to catch it. The
endpoints above are distinct commits, and the unexcluded run shows five files really do differ across
that range, so the empty result is a genuine comparison rather than a tautology.

**2. The gate was re-run anyway, at `6be079b`, by the edited `record-gate.sh`** — which makes it two
things at once: the gate record, and the evidence that this round's script edits did not break the
script. `observed`, `--clean`, exit 0, `short_gate: false`, `dirty: false`:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     2m8.252s
```

```
@taxi/api       Test Suites: 2 skipped, 71 passed, 71 of 73 total · Tests: 35 skipped, 660 passed, 695 total
@taxi/rider     Test Suites: 30 passed, 30 total · Tests: 143 passed, 143 total
@taxi/driver    Test Suites: 27 passed, 27 total · Tests: 109 passed, 109 total
@taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
@taxi/shared    Test Files 23 passed (23) · Tests 217 passed (217)
@taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
```

Every per-package count is byte-identical to the `07aeb1a` run, which is what the empty source diff
predicts. **The one figure that moved is the duration: `1m13.444s` → `2m8.252s`** — a cold cache after
`--clean` under concurrent local load, not a code change, and it is `derived` from nothing: it is simply
this run's own wall clock. Neither gate flake the review recorded reproduced here.

`REDIS_TEST_URL` was unset, so the Redis-backed suites are `describe.skip` — that is the 35 skipped.

## Re-verified against the **published** body, after publishing

The sweep table above was written before `gh pr edit` ran, so its "fixed" column was a prediction. Re-run
against the **live** body (`gh pr view 156 --json body`) after the final publish:

```
→ 156                             → 0 hits   OK      Nine lines                        → 0 hits   OK
→ 16 |                            → 0 hits   OK      returns one hit                   → 0 hits   OK
63, 67                            → 0 hits   OK      the two `.claude/system-reviews/` → 0 hits   OK
## Summary / ## What changed / ## Validation  → 1 each          footer → present
```

**Four patterns still match, and all four are deliberate quotations of the retired claim** — checked in
context rather than counted:

| Pattern | Line | Why it is correct |
|---|---|---|
| `not a plan path` | 266 | the round-1 section, naming the pattern that broke: "the fix for L12 was the *pattern*, not the line (a wrap broke `…not a plan path`)" |
| `0 mismatches` | 203 | the H3 correction, quoting `07aeb1a`'s wrong claim before refuting it |
| `17 of 18` | 212 | the H3 correction, quoting *this round's own* first wrong framing before refuting it |
| `1m13.444s` | 149 | the drift paragraph, listing all four runs and saying only the last describes the shipped commit |

This is the distinction the "retire the subject, not the digits" rule needs in both directions: a retired
value quoted *as retired* is not a stale claim, and a grep count alone cannot tell the two apart.

## Two defects found in this fix round itself, before it shipped

Recorded because both are the class this PR exists to remove, and both were caught after the first push.

- **The Validation diff was an identity function.** Detailed under Validation above: `07aeb1a..HEAD` run
  while `HEAD` *was* `07aeb1a`. Fixed by re-running with distinct endpoints and printing the unexcluded
  range alongside, so the empty result is visibly a comparison and not a tautology.
- **"17 of 18 reproduce; two did not" does not sum.** The two failures sit in different groups — L11
  inside the Closed table's 18, L17 inside *Open*'s 3 — so the sentence read as if both were inside the
  18, and 17 + 2 ≠ 18. Corrected to 22 checks in three groups, 20 reproduce, with the per-group split
  spelled out, on all three surfaces (ledger header, PR body, this report).

Both were arithmetic-and-scope defects in prose that no typecheck, lint or test can read — the same
reason CLAUDE.md puts the burden on the author.

## Deferred — with reasons, not silence

| Item | Why not now |
|---|---|
| `07aeb1a`'s subject is **76 chars** (conventions.md caps at 72) and is a noun phrase, not imperative | Pushed history. Fixing it means a force-push on a PR under active review — more disruption than the defect. This round's subject is **67 chars** and imperative. |
| Branch is `docs/remedy-ledger-apply`; conventions.md `## pr` mechanically requires `feature/<kebab-slug>` | Not raised by the review. Renaming the head of an open PR mid-review is disruptive; `docs/` is the established prefix for this repo's docs PRs (#143, #148). Flagged for the conventions file rather than the branch. |
| The review itself is not in the repo | By its own instruction it belongs on a `docs/pr-156-review` branch cut from `origin/main`. Landing it here would sweep the review into the PR it reviews — the #138–#142 failure. **Owed as a separate PR.** |

## Needs a human look

- **L19 stays open and stale by design.** CLAUDE.md:43 still reads `33 skipped, 582 passed, 615 total`
  against this branch's observed `35 / 660 / 695`. CLAUDE.md's own note on that line says to re-observe
  the *whole claim* rather than patch the digit — which is precisely what a docs PR editing it in passing
  would do. It wants its own loop, not a drive-by.
- **The two gate flakes the review recorded** are `main`'s, not this branch's, and neither matches the
  "passes alone" flake CLAUDE.md documents: the api one also failed under `pnpm --filter @taxi/api test`
  in isolation. Worth a ticket against `main`.
