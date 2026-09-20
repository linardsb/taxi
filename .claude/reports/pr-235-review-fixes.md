# PR #235 review round 1 — fixes

**Review** `.claude/code-reviews/pr-235-review.md` (posted as PR comments `5748978432` and
`5748981947`, the second correcting H1 bullet 1) · **Reviewed head** `96c51f3` · **Base** `main` @
`414bada` · **Fixed** 2026-09-20

**All nine findings actioned: eight fixed, one informational with no action.** Two additions the
review did not raise, found while fixing — **N1** (a stale anchor of the same class, in the same
GOTCHA) and **N2** (a false claim inside H1's own fix, caught before it shipped).

Both edited files are **line-count neutral** — `docs/runbooks/driver-device-day.md` stays 660 lines
and `.claude/plans/emulator-oracle-141.md` stays 1250, exactly as at `96c51f3`. That is deliberate:
the runbook's own rule (`.claude/plans/emulator-oracle-141.md:821-822`, *"Rewrite such a claim at a
constant line count"*) exists so a fix for stale anchors does not shift the anchors it just fixed.
`git diff --stat` reads **26 insertions, 26 deletions** across three files.

## Verdict

| # | Severity | Call | Status |
|---|---|---|---|
| H1 | High | Fix now — register **retired** (reviewer's option b, confirmed by Linards) | ✅ fixed |
| M1 | Medium | Fix now — PR body, print a command that can fail | ✅ fixed |
| M2 | Medium | Fix now — **in scope, confirmed by Linards** (reviewer offered a follow-up) | ✅ fixed |
| M3 | Medium | Fix now — four values in the plan | ✅ fixed |
| L1 | Low | Fix now | ✅ fixed |
| L2 | Low | Fix now — PR body only; the commit message is not rewritten | ✅ fixed |
| L3 | Low | Fix now — PR body | ✅ fixed |
| L4 | Low | Fix now | ✅ fixed |
| L5 | Low (informational) | No action — recorded so a later round does not inherit it | ✅ n/a |
| N1 | — | Found here, same class as M3 | ✅ fixed |
| N2 | — | Found here, inside H1's own fix | ✅ fixed |

Nothing deferred. No issue filed.

---

## H1 — the anchor register, retired

**What was wrong.** `.claude/plans/emulator-oracle-141.md:825-836` held a pre-#224→today translation
register whose right-hand column was labelled `Today:`. All ten of its values resolved at `414bada`
and **none** at `96c51f3`, because this PR's §Verdict edit moved them — and the register closes with
a tripwire naming this exact pass (*"The next pass that edits §Result re-derives this mapping"*).
Its `:311`→`:331` row inverted the rule it serves: a later pass following it would protect
`:331`–`:344` (actually §Verdict, which the GOTCHA permits editing) and treat `:345`+ as clear,
which is the section the GOTCHA protects.

**The fix.** The register is gone rather than re-derived a third time. `:811-824`'s GOTCHA — a
completed T11 instruction — is now marked **HISTORICAL** against three fixed shas instead of a
mapping that needs upkeep:

- all **14** distinct anchors it names resolve at **`7ec3bd7`**, the 322-line copy `:811` itself
  describes;
- **12 of 14** at `fa6277d` — `:23` and `:25-28` still point at their own passages, whose text #226
  rewrote in place under the falsified-claim licence directly above them, so #226 did *not* purely
  append;
- **2 of 14** at `414bada` and later — `:13` and `:13-22`, because `## Result` never moved.

The GOTCHA's *rules* (append-only, constant line count, rewrite a falsified claim) are untouched and
the marker says so explicitly; only its numbers are retired.

**Why a sha and not a mapping.** A sha cannot go stale. The register went stale twice in three PRs
(#233 M2 produced it; #235 H1 is it failing again) because it is a derived value that must be
re-derived on every runbook edit, and the obligation to do so lived only in prose.

**Closing command** (run 2026-09-20 against the fixed tree, before commit):

```
$ python3 verify-anchors.py                      # section A, script inlined below
   7ec3bd7 (322 lines): 14/14 resolve  — marker claims 14  OK
   fa6277d (529 lines): 12/14 resolve  — marker claims 12  OK
   414bada (646 lines):  2/14 resolve  — marker claims  2  OK
```

**The mechanism's own new failure mode** (the Critical/High rule). Replacing a live mapping with a
prose claim about three shas trades an anchor that rots for **a claim nobody re-runs** — and prose
is exactly what typecheck and lint cannot read. The first draft of the marker proved the point by
being false (see **N2**). The mitigation is that the claim is now *mechanically checkable*: section
A of the script below asserts the three counts and fails if any drifts. A second, subtler mode —
a reader taking "HISTORICAL" as licence to ignore the GOTCHA's rules as well as its numbers — is
closed textually: *"the rules still hold, the numbers do not"*.

## N2 — a false claim inside H1's own fix, caught before it shipped

The first draft of the marker read *"still resolved at `fa6277d` (529 lines), because #226 appended
only"* and *"None resolves at `414bada` or later"*. Section A of the check refuted both on its first
run: `fa6277d` is **12 of 14**, not 14 (#226 rewrote `:23` and `:25-28` in place), and `414bada`
keeps **2**, not 0 (`## Result` never moved). Both corrected before commit; the figures above are
what the file now states.

Recorded because it is the finding the review would otherwise have raised in round 2, and because it
is the argument for writing the check rather than re-reading the prose: the false version read
plausibly and was arrived at by the same manual `sed -n Np` sweep that produced every correct figure
in this report.

## M1 — a check that could not fail, replaced with one that can

**What was wrong.** The PR body's only check covering the PR's entire purpose read *"residual
phone-requirement claims after the edit: one hit, and it is the new sentence saying the phone leg is
not owed"* — a count with no command, under an `observed` heading. Its patterns matched the
**negation**, so by construction they could not detect a surviving positive claim.

**The fix.** The PR body now prints the reviewer's suggested command and its result.

**Closing command** (run 2026-09-20 against the fixed tree):

```
$ grep -icE "only a phone|still owed|does not close #141|is Linards' call" docs/runbooks/driver-device-day.md
0
$ git show 414bada:docs/runbooks/driver-device-day.md | grep -icE "only a phone|still owed|does not close #141|is Linards' call"
6          # 6 lines across the 4 passages the PR reconciles: :4+:8, :34+:36, :326, :367
```

Six lines, four passages — the review's "exactly 4 passages" and this command's 6 are the same
finding counted differently, and the PR body now says which.

## M2 — a "has never run" the #224 run retired

**What was wrong.** `docs/runbooks/driver-device-day.md:194-195` asserted *"The cloud build is
`expected`, not `observed`. It has never run: it needs Linards's Expo credentials and a build
credit."* False at head and contradicted three times in the same file (`:25`, `:473`, `:628-630`)
and by the plan at `:1149-1150`. Pre-existing at `414bada`; fixed here on Linards's call because it
is the same defect class the PR exists to remove, falsified by the same #224 run the PR cites.

**The fix.** Rewritten at a constant seven lines: the build is `observed` (2026-09-18), both builds
ran on the free tier so neither the login nor a purchased credit was ever the constraint, pointing
at §The build blocker — cleared. `:200`'s *"Budget one failed build anyway"* now names `edcc579b`
and so is `observed` rather than precautionary.

**Closing commands** (run 2026-09-20 against the fixed tree):

```
$ grep -c "It has never run" docs/runbooks/driver-device-day.md
0                                                    # 1 at 414bada
$ wc -l docs/runbooks/driver-device-day.md
660                                                  # 660 at 96c51f3 — no anchor below :200 moved
$ grep -n "The build blocker" docs/runbooks/driver-device-day.md
195: … (§The build blocker — cleared).** …
554: … see §The build blocker for why not `f4d37e4`
607:### The build blocker — cleared                   # the section the new text cites exists
```

## M3 — three bare stale runbook citations, and N1

**What was wrong.** `.claude/plans/emulator-oracle-141.md:713`, `:741-742` and `:780` cite the
runbook as bare `` `:NNN` ``, invisible to `grep -rn "driver-device-day.md:"` including the plan's
own VALIDATE sweep at `:841`. They carry pre-#224 values and sit in T8/T9/T10, outside the T11
GOTCHA's disclaimer.

**N1, found here:** `:806` — T11's own PATTERN — carries a fourth, `` `:86-88` ``. It sits directly
above the GOTCHA and was arguably covered by the disclaimer; with the disclaimer retired it is not,
so it is re-pointed with the rest.

| Plan line | Was | Now | Resolves to at head |
|---|---|---|---|
| `:713` | `:233` | `:258` | *"**Which timestamp, and why 12 s.**"* |
| `:741` | `:222` | `:247` | the step 5 row, *"Watch for **90 s**"* |
| `:742` | `:233` | `:258` | *"**Which timestamp, and why 12 s.**"* |
| `:780` | `:35` | `:58-59` | *"Record failures as findings, never as \"mostly worked\""* |
| `:806` (**N1**) | `:86-88` | `:111-113` | `### 1 — Boot the stack` + its recipe line |

`:780` is a **range**, not the single `:58` the review implied: the sentence wraps across `:58-59` at
head, where pre-#224 it fitted on one line. Citing `:58` alone would have reproduced L1's defect.

**Fix to the count.** The PR body's *"seven sites"* was never wrong as a count of the citations that
carry the `driver-device-day.md:` prefix — those are exactly `:174`, `:178`, `:179`, `:186`, `:359`,
`:571`, `:1239`. The body now says *"seven prefixed sites"* and names these four bare ones
separately, so the completeness claim is true as written rather than true only on one reading.

## L1 — off-by-two, shifted rather than re-read

`:174` attributed a two-line blockquote to `` `:111-113` ``. At head that text is at `:113-114`;
`:111` is the `### 1 — Boot the stack` heading and `:112` is blank, so the range started two lines
early and covered only the first of the two quoted lines. Now `:113-114`.

**Note, because the digits collide:** `:111-113` is *correct* for N1's `:806` and *wrong* for L1's
`:174`. They cite different things — `:806` cites the section (heading, blank, first prose line, the
same shape as its pre-#224 `:86-88`); `:174` quotes two prose lines. Both verified by text match,
section B below.

## L2 — a digit on the wrong noun

The PR body's §3 header said *"ten shifted anchors re-pointed"* while its own next sentence said
*"six distinct anchors"* and *"ten line numbers"*. Ten is the count of distinct line *numbers*; the
anchor count is six, across seven prefixed sites. The header and the closing *"All ten `observed`
resolving"* are corrected.

**The commit message `9ab6b2f` is not rewritten.** It repeats the same digit, but amending it means
a force-push over a pushed PR branch; this repo's pattern for a stale claim in a landed commit is a
follow-up correction commit (`b2421ad`, `bd5193a`, `3998e9b` on the sibling branch all do exactly
this). The correction rides in this round's commit message instead.

## L3 — a method that could not observe what it was cited for

The body cited `git cat-file -e origin/main:<path>` *"for each"* of three items, but the first
(`apps/rider`'s `ios` scoping) is not a path and that command cannot observe it. The claim is true;
only the method was weaker than the sentence. The body now cites the check that reaches it.

**Closing command** (run 2026-09-20):

```
$ for f in lv ru en; do git show origin/main:apps/rider/locales/$f.json | python3 -c "import json,sys; print('ios' in json.load(sys.stdin))"; done
True / True / True
$ git cat-file -e origin/main:apps/rider/src/locales-config.test.ts      # present
$ git cat-file -e origin/main:.claude/reports/pr-233-review-fixes.md     # present
```

## L4 — the one landed report with no read date

`.claude/code-reviews/pr-227-review.md:3` was the only one of the four carrying no read date, which
is why its (now false) *"no open issue covers it … the remaining blocker on #141"* reads as a live
claim rather than the snapshot it is. Added `· **Reviewed** 2026-09-18 ·`. One header field, in
place — the report's 363 lines are unaltered, so §4's `480 + 517 + 363 + 433 = 1793` still holds
(`observed`, `wc -l` on all four).

## L5 — informational, no action

The gate figures in the PR body were author-reported and not re-observed by the reviewer. They are
now re-observed — see Validation. No edit was owed.

---

## Retired-value sweep

The rule: grep the **value** and the **subject**, not the sentence, across the plan, the runbook and
the PR body (the PR body is the surface no working-tree grep reaches). Run 2026-09-20 against the
fixed tree, with the PR body fetched to a file via `gh pr view 235 --json body`.

| # | Pattern | Hits | Disposition |
|---|---|---|---|
| 1 | `Today:\|translation layer\|re-derives this mapping\|another +20` | **0 / 0 / 0** | the register's subject, gone from all three |
| 2 | `` `:(53\|57\|106\|242\|253\|266\|302\|310\|331)` `` | **0** | none of the register's retired `Today:` values survives as a live citation |
| 3 | `` `:(35\|222\|233)`\|`:86-88` `` | **4 in the plan, 1 in the runbook** | all four plan hits are inside the T11 GOTCHA (`:814`, `:815`, `:822`, `:826`) — now explicitly marked HISTORICAL, which is the intended disposition. The runbook hit (`:245`) is `` `body` at `:35` `` citing **`stub-sms.provider.ts`**, a different file |
| 4 | `has never run\|cloud build is .expected\|needs Linards.s Expo` | **0 / 0 / 0** | M2's subject retired everywhere |
| 5 | `ten (shifted )?anchors\|all ten\|ten line numbers` | **0 / 0 / 0** after the body edit (3 in the body before it) | L2's digit, gone from the one surface that carried it |

Sweep 3 is the one worth a reviewer's eye: those values are deliberately *kept*, not fixed, and the
marker is what makes keeping them correct.

## Validation

**The CI-parity gate, `observed` 2026-09-20** — run in worktree `wt-141close` with
`COMPOSE_PROJECT_NAME=taxi`, on the fixed tree (the tree this round's commit captures):

```
$ COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
 Tasks:    22 successful, 22 total
Cached:    0 cached, 22 total
  Time:    1m29.73s                exit 0
```

`@taxi/api`: `Test Suites: 2 skipped, 75 passed, 75 of 77 total` · `Tests: 39 skipped, 694 passed,
733 total` — the documented Redis-gated set, matching `CLAUDE.md`'s re-observation at `0cdb59c`
digit for digit. `REDIS_TEST_URL` was not set for this run, so the local green is 39 tests short in
the documented way and not in any new one.

The diff touches three markdown files. No package compiles, lints or tests any of them, so the green
says only that nothing regressed — the whole claim a documentation change can make. This report
itself was written after the run, and is a `.claude/reports/` markdown file, so it cannot change it.

**The anchor check.** Section A asserts H1's marker; section B asserts that every *live* runbook
citation in the plan resolves at the fixed runbook. Run against the **unfixed** plan first, and it
fails on exactly the six this round repairs:

```
$ python3 verify-anchors.py 96c51f3          # the reviewed head
   plan:174   FAIL 111-113    plan:713  FAIL 233      plan:741  FAIL 222
   plan:742   FAIL 233        plan:780  FAIL 35       plan:806  FAIL 86-88
   6 FAILURE(S)                                                    exit 1

$ python3 verify-anchors.py                  # the fixed tree
   A: 14/14 at 7ec3bd7 · 12/14 at fa6277d · 2/14 at 414bada — all as the marker claims
   B: 12/12 citations resolve
   all checks pass                                                 exit 0
```

The script is not committed — it is specific to this plan's anchor set and would rot. It is
reproduced here so the check is re-runnable rather than merely reported:

<details><summary><code>verify-anchors.py</code></summary>

```python
import re, subprocess, sys, pathlib

WT = pathlib.Path("/Users/Berzins/taxi-worktrees/wt-141close")
RUNBOOK = "docs/runbooks/driver-device-day.md"
PLAN = ".claude/plans/emulator-oracle-141.md"


def at(rev, path):
    if rev == "WORKTREE":
        return (WT / path).read_text().split("\n")
    out = subprocess.run(["git", "-C", str(WT), "show", f"{rev}:{path}"],
                         capture_output=True, text=True, check=True)
    return out.stdout.split("\n")


def line(lines, n):
    return lines[n - 1] if 0 < n <= len(lines) else "<out of range>"


def span(lines, spec):
    """Text of a cited range, whitespace-normalised so a phrase that WRAPS
    across two lines still matches — a wrapped phrase is still at that range."""
    a, b = (int(x) for x in spec.split("-")) if "-" in spec else (int(spec),) * 2
    return " ".join(" ".join(line(lines, n) for n in range(a, b + 1)).split())


GOTCHA_ANCHORS = ["13", "13-22", "23", "25-28", "35", "37", "86",
                  "222", "233", "246", "282", "290", "311", "322"]
GOTCHA_EXPECT = {
    "13": "## Result", "13-22": "## Result",
    "23": "Both substitute paths are closed",
    "25-28": "Android emulator: no SDK on this machine",
    "35": 'never as "mostly worked"', "37": "## What this day does NOT need",
    "86": "### 1 — Boot the stack", "222": "| 5 | Watch for **90 s**",
    "233": "Which timestamp, and why 12 s", "246": "The 12 s is `derived`",
    "282": "Why step 7's window is 2 minutes", "290": "## Verdict",
    "311": "## Also on this day", "322": "The GPS field drive",
}

fails = []
print(f"A. T11 GOTCHA anchor set — {len(GOTCHA_ANCHORS)} distinct anchors\n")
for rev, want, why in (("7ec3bd7", 14, "the copy the GOTCHA was written against"),
                       ("fa6277d", 12, ":23/:25-28 rewritten in place by #226"),
                       ("414bada", 2, "only :13/:13-22 — `## Result` never moved")):
    lines = at(rev, RUNBOOK)
    hits = [a for a in GOTCHA_ANCHORS
            if " ".join(GOTCHA_EXPECT[a].split()) in span(lines, a)]
    ok = len(hits) == want
    print(f"   {rev} ({len(lines) - 1} lines): {len(hits)}/{len(GOTCHA_ANCHORS)} resolve"
          f"  — marker claims {want}  {'OK' if ok else 'FAIL'}   ({why})")
    if not ok:
        fails.append(f"A/{rev}: {len(hits)} resolved, marker claims {want}")

PLAN_REV = sys.argv[1] if len(sys.argv) > 1 else "WORKTREE"
LIVE = [(174, "two copies of a procedure is the failure"),
        (178, "The 12 s is `derived`"), (179, "Why step 7's window is 2 minutes"),
        (186, "## Result"), (359, "## What this day does NOT need"),
        (571, "The 12 s is `derived`"), (713, "Which timestamp, and why 12 s"),
        (741, "| 5 | Watch for **90 s**"), (742, "Which timestamp, and why 12 s"),
        (780, 'never as "mostly worked"'), (806, "### 1 — Boot the stack"),
        (1239, "list anywhere new.")]
plan, head_runbook = at(PLAN_REV, PLAN), at("WORKTREE", RUNBOOK)
print(f"\nB. plan's live runbook citations ({PLAN_REV}) vs the fixed runbook\n")
for n, expect in LIVE:
    m = re.findall(r"`:(\d+(?:-\d+)?)`|driver-device-day\.md:(\d+(?:-\d+)?)", line(plan, n))
    specs = [a or b for a, b in m]
    good = [s for s in specs if " ".join(expect.split()) in span(head_runbook, s)]
    print(f"   plan:{n:<5} {'OK  ' if good else 'FAIL'} {'/'.join(specs):<10} -> {expect[:46]}")
    if not good:
        fails.append(f"B/plan:{n}: {specs or 'no anchor'} does not resolve to {expect!r}")

print()
if fails:
    print(f"{len(fails)} FAILURE(S):")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("all checks pass")
```

</details>

**Tripwires, unmoved** (`observed` 2026-09-20, the plan's own VALIDATE at `:839-840`):

```
$ grep -c "Expect" docs/runbooks/driver-device-day.md        # baseline 2
2
$ grep -c '| Expect |' docs/runbooks/driver-device-day.md    # must stay 1
1
```

**Line-count neutrality** (`observed` 2026-09-20) — the check that this fix round did not create the
next round's H1:

```
$ wc -l docs/runbooks/driver-device-day.md .claude/plans/emulator-oracle-141.md
660 · 1250          # identical to 96c51f3
$ git diff --stat
26 insertions(+), 26 deletions(-)
```

Every plan self-citation below the edited span was diffed line-for-line against `96c51f3` (`:55`,
`:63`, `:244`, `:765`, `:767`, `:794`, `:851`, `:946`, `:966`, `:971`, `:998`): **all unchanged**
except `:806`, which changed content by intent (N1) and is still T11's PATTERN line, so `:1246`'s
claim that it resolves still holds.

## Needs a human look

Nothing blocking. Two things for the record:

1. **`.claude/plans/emulator-oracle-141.md:1243-1246`** (AMENDMENT A2's sweep record) carries plan
   self-citations that were *already* stale at `96c51f3` — `:946`, `:966` and `:998` are blank lines
   at head, and `:851` is `### T12`, not the *"§Verdict's load-bearing steps"* phrase it claims.
   Pre-existing, head-anchored historical record, same class as the records this PR deliberately
   leaves alone. Not touched, and this round's neutrality means it is no worse. Worth a decision at
   some point on whether that amendment gets the same HISTORICAL marker the T11 GOTCHA just got.
2. **`.claude/code-reviews/pr-235-review.md` is still orphaned** in the main checkout, which is on
   `feature/driver-device-day-prep`. It reviews this PR, so #148's rule says it must not ride on it.
   It needs its own `docs/` PR off `origin/main` or it dies with the working tree — the exact #143
   failure mode this PR exists to clean up, one round later.
