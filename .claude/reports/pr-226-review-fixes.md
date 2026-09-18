# PR #226 — review round 1 fixes

**Review** `.claude/code-reviews/pr-226-review.md` / [comment 5726458524](https://github.com/linardsb/taxi/pull/226#issuecomment-5726458524)
· **Reviewed head** `6ccab9e` · **Fixed** 2026-09-18 · **Round** 1

Review verdict was **approve, with comments** — no Critical, no High, two Medium and three Low, all
documentation accuracy. **All five are fixed. Nothing is deferred and nothing is outstanding.**

## Triage

| # | Sev | Call | Why |
|---|---|---|---|
| M1 | Medium | **Fix now** | A fourth statement of §Verdict's step set, inside the file whose rule against restating it is 164 lines up. Accurate today; so were the three PR #218 closed. |
| M2 | Medium | **Fix now**, wider than prescribed | Four surfaces disagreed on the step range. The shipped section is right; the plan, report and PR body are reconciled to it. |
| L1 | Low | **Fix now**, with a corrected range | The review prescribed `D1–D13`; the correct post-fix range is `D1–D14` (see below). |
| L2 | Low | **Fix now** | One clause. |
| L3 | Low | **Fix now** — Linards' call | The reviewer declined to prescribe. Asked; Linards chose the line-count-neutral in-place pointer, matching the treatment the runbook got in this same PR. |

### Two corrections to the review's own prescriptions

Both were re-derived before applying, per the repo rule that a review's prescribed fix is a claim
like its figures.

- **L1's range is `D1–D14`, not `D1–D13`.** The report already carried thirteen deviations
  (`grep -n '^\*\*D[0-9]'` → D1…D13, none missing) at the reviewed head. M2's fix adds one more.
  Applying L1 literally and then M2 would have left both surfaces stale again while this report
  claimed L1 closed — the exact inheritance pattern the review's own L1 is about. M2's report edit
  was made first and L1's range written from the post-edit count.
- **M2 touches eight plan lines, not four.** The review named AC4 `:966`, AC6 `:971`, T10's title
  `:765` and T11's PATTERN `:806`. `grep -n $'3–8'` at the reviewed head returned **eight**: those
  four plus `:55` (the Goal section's instruction to a resuming pass), `:63` (Out of Scope, asserting
  what the shipped section cites — now false), `:244` (T10's task list) and `:946` (the Level-4
  validation list). Leaving four stale copies of the claim being corrected is the #87/#107/#150
  pattern verbatim.

---

## M1 — the emulator section restated §Verdict's step set ✅ fixed

`docs/runbooks/driver-device-day.md:462` (reviewed head) → `:468` (now)

**What was wrong.** The new section closed with *"§Verdict applies unchanged: 4, 5, 7 and 8 are
load-bearing and binary, 6 corroborates, 1–3 are setup."* — a restatement of the set that `:296-299`
of the same file forbids (*"Cite that section rather than restating the list anywhere new"*), and
that T11's PATTERN repeats. The restatement matched §Verdict at the time; so did the three copies
PR #218 exists to close, right up until they diverged.

**Fix.** Truncated to the citation. The sentence is complete and correct as *"§Verdict applies
unchanged."* Nothing else in the section changed, and nothing at or below `:322` was touched — the
tempting adjacent cleanup (§Verdict calls steps 1–3 "setup" while step 2 is a HARD GATE) is
pre-existing, out of scope, and would have falsified the PR's byte-identity invariant.

**Proof.** V5 — `sed -n '323,$p' … | grep 'load-bearing\|corroborat\|are setup'` returns **no hits**
in the appended region (`exit=1`). Run 2026-09-18 against the fixed tree. The same command piped from
`git show 6ccab9e:…` returns two hits — offsets `140:` and `141:` in the region, absolute `:462-463`,
`exit=0` — so the check discriminates rather than passing vacuously.

---

## M2 — the section prescribes steps 2–8; plan, report and PR body said 3–8 ✅ fixed

`docs/runbooks/driver-device-day.md:460` · plan ×8 · report ×2 · PR body

**What was wrong.** The shipped section prescribes §Steps rows **2 through 8**; the plan said 3–8 in
eight places and the PR body claimed *"cites §Steps 3–8 by number"*. The runbook is right: §Steps row
2 is a **HARD GATE** whose second half is "the driver visible on the board", and nothing in Gates 1–3
covers the board — Gate 2 asks only `driver.location.ping_accepted` at ~4 s. So the widening closes a
real hole and the plan is reconciled to the section, not the reverse.

**Where it came from.** T10's IMPLEMENT (`:766`) always said "rows **2 through 8**"; T10's own title
one line above said 3–8. The implementer followed the body. Nothing recorded the divergence, so AC6's
✅ was ticked against a criterion the section deliberately exceeds.

**Fix**, four surfaces:

1. **Plan** — eight one-for-one replacements, all line-count neutral: `:55`, `:63`, `:244`, `:765`
   (T10's title), `:806` (T11's PATTERN), `:946` (Level-4 validation), `:966` (AC4), `:971` (AC6).
2. **Plan `## AMENDMENTS`** — new `A2` recording the widening, its reason, and the eight sites, so a
   resuming pass cannot re-narrow it.
3. **Report** — new `D14` for the widening; AC4's row now reads 2–8; AC6's row is no longer a bare ✅
   but *"✅, **widened to 2–8** — see D14"* with the wording mismatch spelled out.
4. **PR body** — `3–8` → `2–8` with the row-2 reason. Applied after push; see *PR body* below.

**Proof.** V1 — `grep -rn $'3–8'` over the runbook, plan, report and prep plan returns **4 hits, all
historical**: report `:225` and `:244` (D14 and the AC6 row, both describing the widening) and plan
`:1210-1211` (A2, same). No prescriptive `3–8` survives. Run 2026-09-18 against the fixed tree.

---

## L1 — "D1–D12" while the report carried D13, and an out-of-order block ✅ fixed

**What was wrong.** Plan `:1205` and the PR body both named `D1–D12`, excluding D13 — which existed
at report `:199` and which the PR body itself then discussed by number a paragraph later. And the
report's deviation block ran D1–D9, D11, **D13**, D12, D10.

**Fix.** Plan `:1205` → `D1–D14` (the corrected range, per above), with A2 recording that A1's count
was corrected in place and why that is not a rewrite of A1's substance. The report's block is
**reordered**, not renumbered: the PR body cites D2, D4, D5, D8, D10, D12 and D13 by number, and
renumbering would break all seven. Nothing in the tree cites report line numbers, so the reorder
moves no anchor.

**Proof.** V3 — `grep -rn $'D1–D12' --include='*.md' .` returns **one hit**: plan `:1218`, A2's own
sentence recording the correction. V4 — the block reads `D1 D2 D3 D4 D5 D6 D7 D8 D9 D10 D11 D12 D13
D14`, monotonic. All seven PR-body-cited D-numbers still resolve to exactly one heading each
(`grep -c '^\*\*Dn — '` = 1 for each). Run 2026-09-18 against the fixed tree.

---

## L2 — `ProviderRequest[OFF]` in the failure signature and in the PASS evidence ✅ fixed

`docs/runbooks/driver-device-day.md:440-444`

**What was wrong.** The string carries three roles on one page — the `adb emu geo fix` failure cause
(`:388`), D5's cold-boot false negative (`:406`), and Gate 1's **PASS** block (`:432`) — and nothing
said the `[OFF]` in the pass block is expected. The two are different providers (`gps` vs `fused`),
but the page never drew the distinction, so a reader could score the pass as a failure.

**Fix.** One paragraph after the Gate 1 evidence, naming the provider distinction and the
discriminator. It states the mechanism as following from what was observed on this line — the fused
provider carried an advancing `last location=` while `service:` read `[OFF]` — rather than as an
assertion about Android internals this pass did not test. The reviewer's suggested wording ("a test
provider writes last-known regardless of who is requesting") is a general claim about the platform;
the shipped clause scopes it to the observation that supports it.

**Proof.** V-manual — `grep -n 'pass criterion is the advancing'` → `:444`, present. Run 2026-09-18.

---

## L3 — the prep plan's retired claim stood in place, unlike the runbook's ✅ fixed

`.claude/plans/driver-device-day-prep.md:70-74`

**What was wrong.** The bullet still asserted "Android emulator — no SDK on this machine" with no
marker, 1389 lines above its retirement in `## AMENDMENTS` — while the runbook's word-for-word
equivalent was rewritten **in place** in this same PR. A reader arriving by citation (as
`emulator-oracle-141.md:29` and `:1008` both do, and as issue #224 does) got the falsified version
with nothing to signal it.

**The reviewer declined to prescribe**, having not established what this file's AMENDMENTS convention
permits. Put to Linards with the evidence the reviewer lacked — that the file's `## AMENDMENTS`
already carries dated entries and its 2026-09-18 one explicitly retires `:72-74`'s emulator half, so
D13 followed the file's own convention — and **Linards chose the line-count-neutral in-place
pointer**, matching the runbook.

**Fix.** `:70-71` and `:72-74` rewritten in place, 5 lines → 5 lines. The emulator bullet now opens
*"the 'no SDK on this machine' reading is **RETIRED** (2026-09-18, #224); see `## AMENDMENTS`"* and
keeps the clause **"the evidence it would produce is weaker than a device's" verbatim**, because
`emulator-oracle-141.md:1008` quotes it and that half still stands. The parent bullet's "Both
substitute paths are **closed**" is softened to match, since it contradicted the child. A dated
bullet appended to `## AMENDMENTS` records the in-place edit; report D13 is amended, since its "a
**pure** append, so `:72-74` … do not move" is no longer the whole story.

**Proof.** V7 — `git diff -U0` shows exactly two hunks: `@@ -70,5 +70,5 @@` (five lines replaced by
five, net 0) and `@@ -1478,0 +1479,8 @@` (a pure tail append). Lines **75–1478 are byte-identical**
to the reviewed head, so `:558-560`, `:604`, `:613-615`, `:1019`, `:1037-1040` and `:1409` — every
line cited from the committed PR #218/#219/#222 review files — still resolve. Run 2026-09-18.

---

## The number/guarantee sweep

Two values and one subject were retired. Each `grep` below was run against the **fixed tree** on
2026-09-18; the output is what it printed, not a summary of it. The PR body is not reachable by a
working-tree grep and is handled separately under *PR body*.

| Retired | Command | Hits | Verdict |
|---|---|---|---|
| value `3–8` (step range) | `grep -rn $'3–8'` over runbook, plan, report, prep plan | report `:225`, `:244`; plan `:1210`, `:1211` | ✅ all four are D14/A2 **describing** the widening. No prescriptive copy left. |
| value `D1–D12` | `grep -rn $'D1–D12' --include='*.md' .` | plan `:1218` | ✅ the one hit is A2's own record of the correction. |
| subject — the §Verdict step-set restatement | `sed -n '323,$p' runbook \| grep 'load-bearing\|corroborat\|are setup'` | none (exit 1) | ✅ retired as a subject, not just as digits. |
| subject — "pure append" describing the prep plan's retirement | `grep -n 'pure append' report` | none | ✅ D13 amended; the phrase no longer stands. |
| replacement `2–8` present | `grep -rc $'2–8'` | report 7, plan 9, runbook **0** | ✅ expected: the runbook phrases it "rows **2 through 8**", which is the shipped wording the other two were reconciled *to*. |

**Method note.** An earlier verification pass read as "zero hits, clean" when the grep had never run:
a `grep -c` returning `0` exits 1 and broke the `&&` chain it sat in. Same class as
`${PIPESTATUS[0]}` being empty under zsh — assert on the artifact, not on a chain's survival. Every
check above is `;`-separated and prints its own `exit=`.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run
typecheck lint test build --force`, run 2026-09-18 against the fixed tree, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m25.042s
```

`@taxi/api`: **Test Suites 77 passed / 77 total, Tests 733 passed / 733 total** — the full count with
`REDIS_TEST_URL` set, so the 39 Redis-gated tests ran rather than skipping.

No shipped source changed: the diff is four `.md` files plus this report. The gate is unchanged from
the reviewed head's 22/22 in task and test counts, and differs only in wall time, which is a property
of the machine rather than of the tree.

**No regression test is possible or appropriate here.** Every finding is a prose-accuracy defect;
typecheck, lint and test cannot read prose, which is why `CLAUDE.md` makes it the reviewer's job. The
`grep`/`diff` checks above are the substitute, and each was chosen so that it **discriminates** —
V5 returns two hits against the unfixed tree and none against the fixed one.

## Nothing deferred

All five findings are closed in this round. No tracker issue was opened, because none was needed.
