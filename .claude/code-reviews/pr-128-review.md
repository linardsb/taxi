# Code Review — PR #128 · docs: close the outer loop on #19 Phase C, land the stack's PIV artifacts

**Branch**: `docs/close-19-phase-c-loop` → `main` · head `96f56f0` · 12 files, +1519 −0
**Reviewed at**: `origin/main` = `30a0662` · worktree `/Users/Berzins/Desktop/taxi-loop`
**Recommendation**: **request changes** — 2 High, 3 Medium, 6 Low. No Critical.

No shipped source in this diff, and no hard-rule surface is touched (money, `assertTransition()`,
`isPaymentMethodLocked()`, the seams, `shared`'s one-way imports). So the review bar is the one root
`CLAUDE.md` sets for prose: every number and every guarantee is a claim carrying provenance, re-derived rather
than inherited. Every figure below was re-checked against git and `gh`; what held is tabulated at the end.

---

## High

### H1 · The retired diagnosis lands on five fresh surfaces, in four files, in the commit that refutes it

| File | Line |
|---|---|
| `.claude/execution-reports/dispatch-override-phone-orders-zones.md` | `:93` |
| `.claude/system-reviews/dispatch-override-phone-orders-zones-review.md` | `:86` |
| `.claude/reports/land-19-stack-and-close-phase-a-report.md` | `:24`, `:47`, `:54` |

All five state the retired Redis diagnosis as fact. The two table rows are the sharpest, because they sit
inside the *claims-inheritance table* that catalogues false claims — restating this one as true while
cataloguing it:

> `CLAUDE.md:43`'s "a green gate can be N tests short" (the gate is now **red** without `REDIS_TEST_URL` —
> Phase B shipped ungated Redis-dependent specs, filed as #127)   — exec report `:93`

> …and it framed `CLAUDE.md:43` as a digit conflict (28 vs 33) when the surrounding sentence had itself
> stopped being true.   — land-19 `:54`

> Phase B's `bookings`/`customers` integration specs need Redis and are not gated, so without
> `REDIS_TEST_URL` the api suite is red rather than short.   — land-19 `:47`

That claim was retired in `794d602`. Verified on today's `main`: `services/api/test/harness.ts:454` overrides
`KV_STORE` with `InMemoryKeyValueStore`, and `services/api/src/features/rides/rides.service.ts:120` reaches
`setIfAbsent` only through that token — the mechanism cannot fire, exactly as D5 says. `gh issue view 127`
shows the issue re-scoped to *"find what actually made 8 integration tests fail — Redis is ruled out,
diagnosis was wrong"*, so land-19 `:24`'s label "**#127** (ungated Redis specs)" is stale too.

The same commit's `…-phase-c.md:86-91` calls this "a false claim … Reverted in `794d602`". One commit, the
refutation and five unretracted copies of what it refutes. Root `CLAUDE.md` names the failure mode exactly:
*"Retiring a bad claim means retiring its **subject**, not its digits — grep the noun."* The noun here is
`green gate` / `ungated` / `needs Redis`, and it was not grepped.

**Fix**: annotate in place, don't rewrite — these are historical records. One suffix per site:
`superseded — falsified in #121 round 3 (F1), reverted in 794d602; see CLAUDE.md:43-45 and …-phase-c.md D5`.
Keep the retargeting half of instances 5 (`deleteBranchOnMerge: false`), which is independently true.

### H2 · The remedy edits the copy of the skill that does not fire

`.claude/skills/piv-review-pr/SKILL.md` (the 26 added lines) + the PR body's efficacy argument

The PR's central argument is that this remedy takes skill-edit form *because* skill edits fire and prose does
not (#87). The form is right. The destination is not.

`observed`, this invocation: `/piv-review-pr` loaded **`/Users/Berzins/.claude/skills/piv-review-pr/SKILL.md`**
— the base directory is stated in the injected prompt — and that file is **93 lines, mtime 18 Jul**. It
contains neither the guarantees pass this PR adds nor **#107's numbers pass**.

```
wc -l  ~/.claude/skills/piv-review-pr/SKILL.md            →  93   (18 Jul)
wc -l  taxi/.claude/skills/piv-review-pr/SKILL.md         → 117   (13 Aug, has the numbers pass)
wc -l  taxi-loop/.claude/skills/piv-review-pr/SKILL.md    → 143   (this PR)
comm -12 <(ls ~/.claude/skills) <(ls taxi/.claude/skills) →  20 names in both trees
```

Both trees are registered — repo-only skills like `prime-app` and `vertical-slice-audit` resolve fine — but on
a name collision the user-level copy won here. The consequence is not hypothetical: **the numbers pass added
on 13 Aug has been inert ever since**, and the review you are reading did not receive it.

The PR ships its own corroboration. `land-19…:26` records the *previous* loop's remedy landing in
`~/.claude/skills/piv-create-pr/` — and there it fires:

```
grep -c record-gate.sh  ~/.claude/skills/piv-create-pr/SKILL.md      → 4   (mtime 18 Aug 11:55)
grep -c record-gate.sh  taxi/.claude/skills/piv-create-pr/SKILL.md   → 0   (mtime  4 Aug)
```

Same AI layer, same day, two remedies, two destinations — one live, one shadowed.

**Fix, in the branch**: the PR body's efficacy argument needs to name the *destination*, not just the form —
"a skill edit fires" is only true of the copy that loads, and this one does not. **Outside the branch** (the
PR cannot edit `~/.claude/`): apply the same 26 lines there, as land-19 did for `piv-create-pr`, or remove the
user-level copy so the repo one resolves — and #107's numbers pass needs the same treatment.

---

## Medium

### M1 · The system review's headline contradicts its own YAML

`…-phase-c-review.md:12` — *"Every one of the five divergences is justified and documented"*.

Its own divergence block says otherwise at `:65-66` (`classification: bad ❌`, `justified: no` for D5), as does
its two-point deduction at `:15`, as does the PR body ("Four of the five … The fifth is not"). The score
arithmetic (1 + 2 = 3 off → 7/10) is correct and *depends* on D5 not being justified, so the headline is the
outlier. **Fix**: "Four of the five divergences are justified and documented".

### M2 · "predicted … months before it fired" — the comment is one day older than the event

`…-phase-c-review.md:135` — *"D2 was predicted in a code comment **months** before it fired"*.

`observed` — `git log --diff-filter=A --date=short -- services/api/src/features/dispatch/board/cascade.ts`:
the file was **created 2026-08-17** by `67e5697`, Phase C's own commit. The review's YAML `:32` says the guard
"entered in review round 1 as the H2 fix", and the comment cites #120's H3 — a finding from #120's review. A
comment in a file created the day before, added no earlier than round 1, cannot predate its invalidation by
months. **Fix**: "in the review round before it fired", or give the dates.

### M3 · "rounds 1 and 2 could not have" — round 1 named the coupling

`…-phase-c.md:47` — *"Review round 3 caught two Highs that rounds 1 and 2 could not have."*

`pr-121-review.md:155`, landed by this same PR, says:

> Two of #120's findings do change code this PR reads: fixing H3 redefines `countAttempts`, the same row set
> `cascade.ts` projects as `attempts` … **After the #120 rebase this needs `cascade.spec.ts` and
> `board.service.spec.ts` re-run, not a fresh review.**

Round 1 named the exact coupling. What failed is that the note was discharged in its weaker form — re-run the
specs, which passed, because the divergence is untestable — rather than by re-deriving the relationship. That
is a *sharper* finding than the one the report gives itself, and it strengthens ACTION 1: the tripwire had
already been written **and** nominally acted on. **Fix**: correct the sentence, and add to the guarantees
pass "close a previous round's rebase note by re-derivation, not by a green run."

---

## Low

### L1 · "80 lines of new strings landed in three dictionaries" — 59 did

`…-phase-c.md:46`. `observed` — `git diff --numstat d444c72 59b3feb -- packages/shared/src/i18n/ packages/shared/src/i18n.ts`:

```
21  0  packages/shared/src/i18n.ts
17  1  packages/shared/src/i18n/en.ts
25  1  packages/shared/src/i18n/lv.ts
17  1  packages/shared/src/i18n/ru.ts
```

The three dictionaries take **59**; the other 21 are assembly and type lines in `i18n.ts`, which are not
strings. 80 is the four-file total, and it appears unlabelled on four surfaces (`…-phase-c-report.md:38`,
`land-19…:18`, here, and `pr-121-review-round3.md:125`, where the claims audit passed it with a ✓ and no
arithmetic). The "byte-identical key sets" half **holds** — 151 keys in each of `lv`/`ru`/`en`, identical
names under `diff` (`observed`).

### L2 · "`i18n.ts` dropped 454 → 47" — no provenance, and it straddles the rebase

Same sentence. Both ends are real — 454 at `d67c82a` (the **pre-rebase** Phase C tip), 47 at `59b3feb` — but
the drop is #122's split, not Phase C's work: `0e2d0d7` took the file 498 → 26, and over this report's own
stated diff base (`d444c72..59b3feb`) Phase C **grew** it 26 → 47. The report's other figures (`:10`, `:11`,
`:30`, `:37`, `:39`) carry `observed` and name their command; this one carries neither, in the "What went
well" section. D3 credits #122 correctly, so the information is recoverable from the whole document — which
is why this is Low.

### L3 · `cascade.ts:180-181` is right, but only against a revision the report never names

`…-phase-c.md:70`. The conditional comment *is* at exactly `:180-181` at `feed712` (`observed`) — the
citation is sound for the pre-fix revision the claim is about. But `794d602` rewrote that docblock, so a
reader checking `main` lands on `:179-181` of the replacement text and concludes the citation is wrong.
**Fix**: `cascade.ts:180-181 at feed712 (pre-fix)`, or cite by content.

### L4 · A landed review's "what's good" bullet recommends what `main` now forbids

`pr-121-review.md:137` — *"**`attempts` is consistent with the engine** … The board's count and the engine's
give-up threshold are the same number, which is the right choice…"*. False at head: `cascade.ts:170-188` now
says the opposite and closes with *"Do not reinstate the guard without a release-scoped count in the frame."*
The review is head-scoped (`:3`), which is why this is Low — but it lands beside three other reviews.
**Fix**: one line — `superseded by round 3 F2/F3; see cascade.ts:170-188`.

### L5 · The Phase A artifacts describe #121 as open

`…-phone-orders-zones.md:3` ("C (#121, open at `feed712`)") and `land-19…:61` ("**#121 is not merged.**").
#121 merged as `30a0662` — this PR's own base, which the Phase C artifacts state correctly. Neither Phase A
file carries an as-of date. **Fix**: an `**As of**: 2026-08-18` header line on each.

### L6 · The guarantees pass's own trigger is not observable from what the skill collects

`.claude/skills/piv-review-pr/SKILL.md` — the new pass fires "for every PR whose base changed since the last
review round", but Phase 1's fetch (`:22`) asks for `baseRefName` and no base SHA, and nothing in the skill
records the previous round's base. **Fix**: add `baseRefOid` to the `--json` list and compare it against the
`**Base** … @ <sha>` header the skill's own reports already carry (`pr-121-review.md:3`).

---

## What I re-derived and found true

| Claim | Verified |
|---|---|
| 46 files, +3130 −275 (`d444c72..59b3feb`) | ✅ `git diff --shortstat` — and it reconciles: round 3's `+3116/−275` at `feed712` + the stated `+41 −27` = 3130, deletions unchanged |
| Round-3 fixes: 4 files, +41 −27 (`feed712..59b3feb`) | ✅ `git diff --shortstat` |
| CI runs 32128678759 @ `feed712`, 32134374058 @ `794d602`, both `pull_request`, both success | ✅ `gh run view` on both |
| Merged `30a0662` (PR #121) on 2026-08-18 | ✅ `git log -1 --format=%ci` |
| `harness.ts:454` overrides `KV_STORE`; `rides.service.ts:120` reaches `setIfAbsent` | ✅ on `origin/main` |
| Task C4's IMPLEMENT line still names `countAttempts` on `main` | ✅ plan `:818` |
| Four stale `VALIDATE` lines `cd` to the retired worktree | ✅ plan `:352, 489, 730, 845` (the other two hits are an IMPLEMENT line and a code block) |
| `rides.repository.ts` 464 lines, `board-ride.ts` 57, `i18n.ts` 47 | ✅ on `origin/main` |
| D4's 504 → 464 extraction | ✅ `git show --numstat 0a7c519` — `board-ride.ts` +57, `rides.repository.ts` +1 −41 → 504 − 40 = 464 |
| No `eslint-disable` anywhere in the phase's diff | ✅ 0 hits over `d444c72..59b3feb` |
| Alignment arithmetic: 1 + 2 = 3 off → 7/10; Phase A lost 2 | ✅ Phase A review `:8` is 8/10, same deduction |
| 582 + 33 = 615; mutation rows 611+4, 194+1, 219+3 | ✅ internally consistent, and consistent with the 0-skipped gate row |
| PR body: #127 open and re-scoped to finding the real cause | ✅ `gh issue view 127` — title and body both re-scoped |

## Validation

| Gate | Result |
|---|---|
| CI at PR head `96f56f0` | ✅ run **32137013943**, job `check`, **success**, 3m48s (`observed` — `gh pr checks 128`) |
| Local `pnpm turbo run typecheck lint test build --force` | **not run** — this branch changes no compiled source. The PR body says so and I agree with the call; a fresh worktree install would reproduce `main`'s result by construction, and nine worktrees share this checkout. |
| `18/18 tasks, 0 cached, exit 0, 1m2.128s` @ `59b3feb` | **inherited** — quoted from the Phase C artifacts, not re-derived here. Flagged because that is the discipline the repo asks for, not because I doubt it; CI green at both round-3 heads is independent corroboration. |

## What's good

- **The causal finding is the right one, and it is supported rather than asserted.** "The project's figure
  discipline is mature, and its *causal* discipline is not" names a genuinely new class of defect — correct
  digits inside a false sentence — and the harness override backing it is cited with a file and a line that
  both check out.
- **D2's write-up is the best thing here.** A guarantee invalidated by a sibling merge, in a file whose own
  comment predicted the invalidation, undetectable by any test because `buildCascades` is pure over inputs
  that cannot distinguish the case — and the review says *seam problem, not fixture problem, so no test can
  catch it*, rather than filing a fake test-coverage action.
- **The discriminating fixture was rewritten as the assertion of the new rule** (`cascade.spec.ts:253-273`),
  not deleted, with a comment explaining why. That is the strongest single piece of evidence in the PR.
- **Both new artifacts open with an independence caveat** naming the self-report problem, and the exec report
  separates `observed` runs from the judgement about what they mean.
- **Scope discipline.** Task C4's staleness is diagnosed, deliberately not fixed, and the reason is sound:
  rewriting the plan the report reports on would make the report unverifiable against what a reader sees.
- **Round 3's "Inherited, not this PR's" list is still accurate today**, so landing it is useful rather than
  archival.
- **Landing the six review reports now is the right call**, and the reason for the earlier delay is stated
  rather than assumed.

## Recommendation

**Request changes.** Both Highs go to the PR's own subject and both are text-only: H1 stops this PR
committing five fresh copies of the claim it was written to retire — the defect wholly inside the diff — and
H2 keeps the body from claiming an efficacy the loaded copy of the skill does not have. M1–M3 and L1–L6 are
one-line edits. Nothing here questions the loop's conclusions, and both recommended remedies are the right
ones; M3 asks that ACTION 1 gain a clause, not be replaced.

*(Posted as a comment rather than `--request-changes`: solo repo, the author is the only reviewer.)*
