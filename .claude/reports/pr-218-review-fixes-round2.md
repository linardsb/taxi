# PR #218 — round 2 review fixes

**Review**: `.claude/code-reviews/pr-218-review-round2.md` (on branch `docs/pr-218-review`, worktree
`~/taxi-worktrees/wt-review218`) · **Verdict there**: Approve — three Mediums, six Lows, no Critical,
no High, no hard-rule violation.
**Branch**: `feature/driver-device-day-prep` · **PR [#218](https://github.com/linardsb/taxi/pull/218)
OPEN, ready for review** (checked before any edit) · **base** `main` @ `b690e91`, unmoved.
**Fix head before this pass**: `bd5193a`.

Eight of nine findings fixed. **M3 was already filed as
[#220](https://github.com/linardsb/taxi/issues/220) by the reviewer** — confirmed OPEN, not
re-litigated here. **L6 turned out to be fixable**: the review carried its prescribed command as
`expected` and asked for the subcommand to be verified first. It was, and the verification
falsified a claim the runbook, the plan and the round-1 fixes report all shared.

## Triage

| # | Sev | Call | Why |
|---|---|---|---|
| M1 | Medium | **Fix now** | Two clauses. F1's fix makes a notification prompt appear at step 1 and the sheet is silent; the `:46` row still cites the branch that fix removes. |
| M2 | Medium | **Fix now** | Three stale sites in the implementation report, in the one PR whose thesis is retiring stale claims. |
| M3 | Medium | **Already deferred — [#220](https://github.com/linardsb/taxi/issues/220)** | The root remedy contradicts this PR's own task heading (`driver-device-day-prep.md:607`, "cleartext, **required, not conditional**") and nothing in the tree can trigger it: `eas.json` defines only `preview`. Filed by the reviewer, verified OPEN here. No edit. |
| L1 | Low | **Fix now** | Step 5's cell and its note gave two different pass conditions under a rule that makes the step binary. |
| L2 | Low | **Fix now** | One reading of the `git checkout` ordering undoes F1's fix. |
| L3 | Low | **Fix now** | The nudge family has four members; the note named three. |
| L4 | Low | **Fix now** | One clause closes the backlog-vs-live-stream hole outright. |
| L5 | Low | **Fix now, with the caveat stated** | The binding assertion lands and fires on a desync — but it lives in a report, which is the same "harness that never executes" defect #220 names. Said so rather than implying otherwise. |
| L6 | Low | **Fix now — the command verified** | `eas config` exists, and both failure shapes are now `observed` rather than the review's `expected`. |

**Not fixed, deliberately**: the review's *"weaker fourth site, flagged but not counted"* —
`.claude/plans/driver-device-day-prep.md:245` re-deriving the owed-step table from
`driver-toggle-off-mid-ride-held.md:713-760`. The reviewer verified it and declined to count it
(the plan describes a past act against a then-current file, and its AMENDMENTS records the
retirement). Re-checked here: `:129` and `:748` are the same shape — CONTEXT and IMPLEMENT entries
describing the task as planned. Widening the diff to rewrite three historical sentences is the
change the surgical-changes rule exists to stop. Recorded, not done.

## What was fixed

Every closing command below was run **against the fixed tree**, after the last edit, at the head this
report ships with. Output is quoted, not summarised.

### M1 — Medium · the permission prompt, and the `:46` row's dead branch

**Wrong**: `init` landing in §2 (round 1's F1) writes `extra.eas.projectId`, which is the guard at
`register-push-token.ts:26-32`. With it present, execution no longer returns `'no_project'` — it
reaches `requestPermissionsAsync` at `:41`, and `POST_NOTIFICATIONS` is declared
(`apps/driver/app.json:40`), so Android 13+ shows a real dialog the moment step 1's sign-in
completes. Step 1's Expect cell named only the background-location prompt. Separately, the `:46`
row F1 rewrote still described the pre-`init` world (`:26-31` warns and no-ops) while §2's own
command removes that branch.

**Fixed**: step 1's Expect cell names the prompt, its cause and its consequence (grant or deny, no
token without FCM either way — `:43-53`). The `:46` row now states **both** branches and which one
this sheet's path takes, and points at step 1 for the prompt.

**The fix's own new failure mode** (the mechanism pass, since the review rates this the round's
centre): naming a *second* prompt at step 1 invites the operator to read the two as interchangeable
and deny both. Background location is load-bearing — denying it kills the stream steps 2, 5 and 7
all read, and the day ends with a false ❌ on the binary steps. The cell keeps them distinct:
"Grant background location when asked" stays imperative; the notification prompt is explicitly
"grant or deny". Asserted: `chk 'M1 step 1 names the prompt'` requires the permissive wording to sit
in the same cell as the imperative one.

**Closing command** (run 2026-09-17, after the last edit):

```
$ sed -n '41p' apps/driver/src/features/push/register-push-token.ts
    const permission = await Notifications.requestPermissionsAsync();
$ sed -n '40p' apps/driver/app.json
        "POST_NOTIFICATIONS",
```

Both anchors carried by the verifier's four `M1 …` assertions (Appendix), all PASS.

### M2 — Medium · three stale sites in the implementation report

**Sites 1 and 2 — the line count.** `231` was right when written and is not now. `observed`, after
this pass's runbook edits:

```
$ wc -l docs/runbooks/driver-device-day.md
     322 docs/runbooks/driver-device-day.md
$ wc -l docs/runbooks/rider-a11y-walkthrough.md
     168 docs/runbooks/rider-a11y-walkthrough.md
```

**The review prescribed `231` → `289`. Writing `289` would have shipped a number already false** —
this pass's own edits take the sheet to 322. The figure went in with its arithmetic and its
provenance instead: 231 as implemented, **+58** from round 1's F1–F9 (231 → 289), **+33** from round
2's (289 → 322), and D8's justification rewritten so the excess it accounts for is 154 lines rather
than 63. The count now carries the instruction to re-derive it with `wc -l` rather than trust the
digit, because it has moved twice and will move again on the next correction.

**Site 3 — the `pr-142` citation.** The review's fix reads as `:737-746` → `:731-736`, and there is
exactly one occurrence of `:737-746` in that paragraph: **the quotation of what `pr-142-review-round2.md:302`
actually says.** Find-replacing it would have falsified the one true sentence in the bullet. What
was false is the two sentences after it — "that line range is now the pointer paragraph" and the
decision resting on it. Those are corrected; the quoted range is untouched. `observed`:

```
$ grep -n "The run sheet has moved to" .claude/plans/driver-toggle-off-mid-ride-held.md
731:**The run sheet has moved to `docs/runbooks/driver-device-day.md`** and that is now its only copy.
$ sed -n '737,746p' .claude/plans/driver-toggle-off-mid-ride-held.md | grep -c "The run sheet has moved to"
0
$ sed -n '737,746p' .claude/plans/driver-toggle-off-mid-ride-held.md | grep -c "drivers.integration"
1
```

The pointer paragraph runs `:731-736`; `:737-746` starts one line past its end and lands on the
api-half integration command. Both directions are carried by the verifier's five `M2 site 3 …` / `M2 pointer …` / `M2 :737-746 …` assertions.

### L1 — Low · step 5's cell and note disagreed

**Fixed**: the operative condition moved into the cell — the stream must not stop, pings still
arriving at t+90 s, no sustained `clientAt` silence, one gap just over the 12 s threshold is a
re-read and not a ❌. The note keeps the arithmetic behind 12 s.

**The plan had to move with it, and this was nearly missed.** `.claude/plans/driver-device-day-prep.md`'s
C1 signal box specified the pass condition as *"with no `clientAt` gap > 12 s"* — round 1's F3/F6
corrected the **number** (8 s → 12 s) and left the **shape**. Fixing only the runbook would have
shipped the plan and the sheet stating opposite verdicts on a binary step, which is the same
plan→artifact divergence `b2421ad` exists to close. The first check run here grepped the plan for
freeze language and for the AC's tokens; neither asks whether the plan now states a *different
condition*. It does not any more: the box at `:290-301` carries a second dated correction in the
plan's own strikethrough convention, and L4's wall-clock read is folded into it. Recorded as the
third plan-touching item in the round-2 AMENDMENTS entry.

```
$ grep -c 'gap > 8 s' docs/runbooks/driver-device-day.md
0
$ sed -n '290,301p' .claude/plans/driver-device-day-prep.md | grep -c 'the stream does not stop'
1
```

(Round 1's `nchk` for exactly this still PASSes — see Validation.)

### L2 — Low · the `git checkout` ordering

**Fixed**: mirrors §0's wording — **"Once the build is queued"** — and names the failure the other
reading produces ("would discard the projectId and put the `build` line back on the interactive
prompt"). Added the `git diff` check and the fact that `git checkout <file>` discards anything else
uncommitted in it.

### L3 — Low · the fourth `nudge_*`

**Fixed**: `nudge_skipped` / `reason: 'back_online'` named, with its position stated (it sits
*before* the `no_token` guard) and the enumeration explicitly subordinated to the prefix — "read the
family by its prefix, not by this list", which is the failure mode the review was pointing at.

**Anchor corrected against the review.** The review cited the guard as `:343-351`. That range
resolves but is not the guard: `:342` is the `if`, `:351` the `continue`. It went in as `:342-351`,
matching the style of the `no_token` citation beside it (`:353-360`). `observed`:

```
$ sed -n '342p;348p;351p' services/api/src/features/drivers/drivers.service.ts
      if (!(await this.presence.claimNudge(row.userId))) {
          reason: 'back_online',
        continue;
```

### L4 — Low · backlog vs live stream

**Fixed**: one clause on the timestamp note — the newest `clientAt` should track the wall clock, a
burst of old ones 4 s apart is a backlog draining — with the review's own reachability argument
kept (step 2's hard gate makes it near-unreachable, so it is stated as one glance, not a hazard).

### L5 — Low · the `pnpm` pin restates `packageManager`

**Fixed as a binding, not a digit.** The plan's invariant (`:560`) says pin to *whatever
`packageManager` says*; nothing enforced it. The verifier's `L5 pnpm pin matches packageManager` assertion derives the expected
string from `package.json` at run time rather than restating `10.33.2`.

**Run, not shipped unexecuted** — the review's own M3 reasoning applies to an assertion nobody
executes, and the round-1 lesson is that a verifier which cannot fail is decoration. Both directions,
`observed` 2026-09-17:

```
# as-is
PASS  L5 pnpm pin matches packageManager
# with package.json temporarily set to pnpm@10.99.9, then restored
FAIL  L5 pnpm pin matches packageManager  (apps/driver/eas.json:8,8 !~ "pnpm": "10.99.9")
EXIT=1
```

**Caveat stated plainly**: this harness lives in a report, so it runs when a human runs it. That is
the same defect [#220](https://github.com/linardsb/taxi/issues/220) already asks to fix for its own
`nchk`. This adds a second assertion to the pile #220 is about; it does not change where the pile
lives.

### L6 — Low · nothing could reject a bad `eas.json` key

The review proposed `eas-cli config`, said itself it could not run it, and asked for the subcommand
to be verified first. **It was verified, and it works.** `observed` 2026-09-17, `eas-cli@24.7.0`, run
from `apps/driver`:

| Tree | `config -p android -e preview --non-interactive` prints | Exit |
|---|---|---|
| `eas.json` with `build.preview.bogusKeyThatDoesNotExist` added | `eas.json is not valid.` / `- "build.preview.bogusKeyThatDoesNotExist" is not allowed` | 1 |
| The committed `eas.json`, `init` not yet run | `EAS project not configured. This command cannot configure it in non-interactive mode.` … `Accounts you can create projects in: linards` | 1 |

Schema validation runs **before** the project-link check — the invalid-key run never reached the
second error. `eas.json` was restored from a scratchpad copy immediately; `git status --porcelain`
clean afterwards.

**Both runs above used `--platform`/`--profile`; the runbook prescribes the short `-p`/`-e`.** That
gap is exactly the kind an observed table papers over, so the short spelling was run too —
`config -p android -e preview --non-interactive`, same `EAS project not configured` error, same exit
1 (`observed`, same session). The table describes the line the sheet actually tells someone to
paste.

**Fixed**: the `config` line sits in §2's block between `init` and `build`, with both failure shapes
as a table and the reason it must come *after* `init`.

**Two things the verification produced beyond the finding:**

1. **Round 1's one self-declared unverified item is retired.** It flagged that whether `pnpm` is a
   real `eas.json` profile key *"was not verified"*. The committed file clears schema validation and
   stops on the project link, so it is a real key (`observed`, same run). Stated in the runbook.
2. **A claim in three files was false.** `eas-cli` *can* run here: the `config` run reached Expo and
   reported `Accounts you can create projects in: linards`, so a signed-in session exists on this
   machine. Corrected at all three sites this PR ships (see the sweep). The `expected` label on the
   create-or-link prompt survives — its interactive branch is genuinely unexercised, because every
   run here passed `--non-interactive` — but it survives on a different reason than the one given.

## The value sweep (the list, not a feeling)

Per `CLAUDE.md`: grep the **value** and the **subject**, and list the commands so the reviewer diffs
a list. All run 2026-09-17 against the fixed tree.

| Retired value / noun | Command | Hits | Disposition |
|---|---|---|---|
| `231` (runbook line count) | `grep -rn '\b231\b' --include='*.md' docs/ .claude/plans/ .claude/reports/ CLAUDE.md` | 25 | **2 are the runbook's count** (`driver-device-day-prep-report.md:22`, `:162`) — both fixed. The other 23 are `@taxi/shared`'s **test count**, a different subject that happens to share the digit. This is why the value-grep needs a subject check. |
| `289` (round-1 count) | `grep -rn '\b289\b' …` | 7 | 2 are mine, deliberate, as derivation steps inside the corrected D8. The other 5 are `harness.ts:289-311` and an unrelated plan line. |
| `737-746` | `grep -rn '737-746' --include='*.md' docs/ .claude/plans/ .claude/reports/` | 2 | Both in the corrected bullet — one is the preserved quotation of `pr-142:302`, one is the correction. |
| `713-760` (the weak 4th site) | `grep -rn '713-760' …` | 3 | `driver-device-day-prep.md:129`, `:245`, `:748` — all historical, all declined (see Triage). |
| `2299` (PR body total) | `grep -rn '\b2299\b' …` | 0 | Lives only in the PR body. Re-derived there after the push — see Validation. |
| "`eas-cli` cannot run … Expo credentials" | `grep -rn "cannot run here\|without Expo credentials\|Expo credentials" --include='*.md' docs/ .claude/plans/ .claude/reports/ CLAUDE.md` | 6 | **3 stated it as a flat fact and are corrected**: `driver-device-day.md` (§2, rewritten), `driver-device-day-prep.md:1384` (struck through with the correction note, the plan's own convention), `pr-218-review-fixes.md:38` (round 1's justification, corrected in place). **3 left**: `driver-device-day-prep.md:660`, `:836` and `pr-218-review-fixes.md:213` say the *cloud build* needs credentials **and a build credit** — the credit half still blocks it, and those sentences remain true at the level they are made. |
| the runbook cited **by line** anywhere | `grep -rn "driver-device-day\.md:[0-9]" --include='*.md' .` | 0 | Nothing cites it by line, so +33 lines breaks no locator. Same check the reviewer ran at `bd5193a`, re-run after these edits. |

## Validation

Run in the main checkout at the fixed tree, `taxi-redis-1` and `taxi-db-1` confirmed `Up (healthy)`
before starting.

| What | Command | Result |
|---|---|---|
| Full gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | ✅ **exit 0** — `Tasks: 22 successful, 22 total`, `Cached: 0 cached, 22 total`, `Time: 1m19.868s`, at the pushed head `9eb1527`. All six packages re-observed and identical to the PR body's table: api 733/77, driver 218/41, rider 140/29, shared 231/24, dispatch 224/27, db 17/3 — `REDIS_TEST_URL` set, so the 39 gated tests ran (694 + 39 = 733, no `skipped` line) |
| Round 1's citation verifier, re-run | the appendix script of `pr-218-review-fixes.md`, extracted verbatim | ✅ **30 PASS, exit 0** — no round-2 edit unpinned a round-1 citation, including the two `nchk`s whose paragraphs L1 and L3 rewrote |
| Round 2's citation verifier | the Appendix below | ✅ **24 PASS, exit 0** |
| That verifier is not decoration | its six added-content assertions against `git show bd5193a:docs/runbooks/driver-device-day.md`, and its two retired-claim assertions both ways | ✅ **0 hits each on the unfixed tree**; `cannot run here without Expo credentials` **1 → 0**; `CREATE, 231 lines` and `the runbook is 231 lines` **1 → 0** |
| L5's binding fires | `package.json` temporarily desynced to `pnpm@10.99.9` | ✅ **FAIL, exit 1**, restored clean |

**That run predates this report's own commit**, which adds the plan's L1 correction and these lines.
Stated rather than papered over, with the reason it does not matter, **re-derived here rather than
inherited from the review**: `turbo.json` declares no `inputs` and no `globalDependencies` (read at
this head — it has `globalEnv`, `tasks` and nothing else), so every task falls back to turbo's
default inputs, the git-tracked files **inside each package directory**. `.claude/` and `docs/` are
at the repo root, outside all of them. No turbo task can read either.

**No source changed.** The diff is prose plus one runbook command line; no `.ts`/`.tsx`, no schema,
no migration — so the per-package test counts are unchanged by construction. `pr-218-review-fixes.md`'s own §Validation declines to restate a size figure for the same
reason, and `taxi-report-restating-pr-body-figures` is the memory behind it.

**The PR body's size table is re-derived after the push, not from this report.** Three of its
figures move: the runbook's insertion count (it is a CREATE, so 231 → 322), the implementation
report's bucket, and the total; plus a new bucket for this file. A figure copied into here would be
stale the moment the commit lands.

## Owed to a human — unchanged

Whether to run `eas-cli init` and commit `extra.eas.projectId` + `owner` **before** the day or leave
it to the day. The runbook works either way and M1's clause is the same under both. One thing is now
known that was not: a signed-in Expo session exists on this machine, so `init` *could* be run here —
which makes this a decision rather than a blocker. It still creates or links a project on Linards's
Expo account, so it is not an agent's call.

**#141 stays open.** The device run is still owed; the Result table still ships `not yet run` /
`BLOCKED`.

## Files changed by these fixes

| File | What |
|---|---|
| `docs/runbooks/driver-device-day.md` | M1 (step 1 cell, `:46` row), L1, L2, L3, L4, L6 (the `config` step + both observed failure shapes), and the corrected `expected` justification |
| `.claude/reports/driver-device-day-prep-report.md` | M2 sites 1, 2, 3 |
| `.claude/plans/driver-device-day-prep.md` | the struck-through "cannot run without Expo credentials" claim |
| `.claude/reports/pr-218-review-fixes.md` | round 1's justification for the same claim |
| `.claude/reports/pr-218-review-fixes-round2.md` | this file |

`apps/driver/eas.json` and `apps/driver/app.json` are **unchanged** — L5 is a binding assertion, not
an edit, and M3 is #220's.

## Appendix — the round-2 citation verifier

Run from anywhere in the checkout. Exit 0 means every `file:line` these fixes point at resolves.
Round 1's verifier is still the one that covers rounds 1's citations; run both.

```bash
#!/bin/bash
# Every file:line citation added or changed by the PR #218 review ROUND 2 fixes.
cd "$(git rev-parse --show-toplevel)" || exit 1
fail=0
chk() { # chk <label> <file> <line-range> <regex>
  local label=$1 file=$2 range=$3 re=$4
  if sed -n "${range}p" "$file" 2>/dev/null | grep -qE "$re"; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s  (%s:%s !~ %s)\n' "$label" "$file" "$range" "$re"; fail=1
  fi
}
nchk() { # nchk <file> <regex-that-must-NOT-match-anywhere> <label>
  if grep -qE "$2" "$1"; then printf 'FAIL  %s  (%s matched %s)\n' "$3" "$1" "$2"; fail=1
  else printf 'PASS  %s\n' "$3"; fi
}
rchk() { # rchk <label> <file> <range> <regex-that-must-NOT-match-IN-range>
  if sed -n "${3}p" "$2" 2>/dev/null | grep -qE "$4"; then
    printf 'FAIL  %s  (%s:%s matched %s)\n' "$1" "$2" "$3" "$4"; fail=1
  else printf 'PASS  %s\n' "$1"; fi
}

# M1 — the permission prompt step 1 now names, and the branch the :46 row now states
chk 'M1 requestPermissionsAsync at :41' apps/driver/src/features/push/register-push-token.ts 41,41 'requestPermissionsAsync'
chk 'M1 POST_NOTIFICATIONS at :40'      apps/driver/app.json 40,40 'POST_NOTIFICATIONS'
chk 'M1 step 1 names the prompt'        docs/runbooks/driver-device-day.md 182,240 'notification-permission prompt appears too'
chk 'M1 :46 row states the :43-53 path' docs/runbooks/driver-device-day.md 44,50 ':43-53'

# L1 — step 5's cell carries the operative condition, not only the threshold,
# and the plan's C1 signal box says the same thing rather than the opposite.
chk 'L1 step 5 cell: stream does not stop' docs/runbooks/driver-device-day.md 182,240 '[Tt]he stream does not stop'
chk 'L1 step 5 cell: re-read not a fail'   docs/runbooks/driver-device-day.md 182,240 're-read, not a'
chk 'L1 plan C1 box agrees with the cell'  .claude/plans/driver-device-day-prep.md 290,301 '[Tt]he stream does not stop'
chk 'L1 plan C1 box strikes the old form'  .claude/plans/driver-device-day-prep.md 290,301 '~~with no .clientAt. gap > 12 s~~'

# L2 — the git checkout is ordered after the build is queued
chk 'L2 ordering is "once the build is queued"' docs/runbooks/driver-device-day.md 128,150 'Once the build is queued'

# L3 — the fourth nudge_* member the note was missing
chk 'L3 back_online guard at :342-351' services/api/src/features/drivers/drivers.service.ts 342,351 "reason: 'back_online'"
chk 'L3 runbook names back_online'     docs/runbooks/driver-device-day.md 250,300 "reason: 'back_online'"

# L4 — the backlog-vs-live clause
chk 'L4 newest clientAt tracks wall clock' docs/runbooks/driver-device-day.md 240,290 'newest .clientAt. should also track the'

# L5 — the eas.json pnpm pin is bound to packageManager, not restated from it.
# Desync package.json and this FAILs; that was verified, then restored.
chk 'L5 pnpm pin matches packageManager' apps/driver/eas.json 8,8 \
  "\"pnpm\": \"$(node -p "require('./package.json').packageManager.split('@')[1]")\""

# L6 — the resolving step, and the now-retired "cannot run" claim
chk 'L6 config step in runbook §2' docs/runbooks/driver-device-day.md 103,130 'eas-cli@latest config -p android -e preview'
nchk docs/runbooks/driver-device-day.md 'cannot run here without Expo credentials' 'L6 runbook no longer says eas-cli cannot run here'
nchk .claude/plans/driver-device-day-prep.md '`eas-cli` cannot run without Expo credentials\.$' 'L6 plan claim struck through, not left bare'

# M2 — the implementation report's three stale sites
nchk .claude/reports/driver-device-day-prep-report.md 'CREATE, 231 lines'        'M2 site 1 no longer says 231'
nchk .claude/reports/driver-device-day-prep-report.md 'the runbook is 231 lines' 'M2 site 2 no longer says 231'
chk 'M2 site 1 carries the re-derivable count' .claude/reports/driver-device-day-prep-report.md 20,26 '322 lines at this'
chk 'M2 site 3 names the real pointer range'   .claude/reports/driver-device-day-prep-report.md 190,215 ':731-736'
chk 'M2 site 3 keeps pr-142 quoted verbatim'   .claude/reports/driver-device-day-prep-report.md 190,215 'cites .driver-toggle-off-mid-ride-held\.md:737-746'
chk 'M2 pointer really is at :731-736'         .claude/plans/driver-toggle-off-mid-ride-held.md 731,736 'The run sheet has moved to'
chk 'M2 :737-746 holds the api half, not it'   .claude/plans/driver-toggle-off-mid-ride-held.md 737,746 'drivers.integration'
rchk 'M2 :737-746 does NOT contain the pointer' .claude/plans/driver-toggle-off-mid-ride-held.md 737,746 'The run sheet has moved to'

echo '---'
if [ $fail -eq 0 ]; then echo 'ALL ROUND-2 CITATIONS RESOLVE'; else echo 'SOME CITATIONS DO NOT RESOLVE'; fi
exit $fail
```
