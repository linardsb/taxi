# PR #265 review — round 1

**PR**: [#265](https://github.com/linardsb/taxi/pull/265) — *docs: run #15's offers / active-ride device pass on the emulator, and file what it found*
**Head** `6eec024` · **Base** `main` @ `d6207be`
**Diff**: 3 files, +1,441 / −1 · documentation only, no shipped source
**Reviewed**: 2026-09-22, fresh context, detached worktree at the PR head; `code-reviewer` agent dispatched against the code every citation describes
**Verdict**: **request changes** — 2 High, 4 Medium, 4 Low. **No finding threatens a conclusion.** The device pass is real, its evidence discipline is above this repo's average, and §T11's decision to leave #15 open is right.

---

## Summary

This is an evidence PR. It ships no code, so its deliverable **is** its figures and its
navigation — which is where every defect sits.

The pass itself holds up under checking. The `code-reviewer` agent opened **every** `file:line`
this PR cites against the code it describes: some forty behavioural claims came back
**ACCURATE**, including all the load-bearing ones — `forCity()` really is an uncached
`select().limit(1)`, `DRIVER_LOCATION_TTL_SECONDS` really is 60 and really is what `findNearby`
filters on, `ledger_entries` really is written only by settlement, the driver app really has no
settle call, and the offer card's a11y label really does put payment before the accept prompt.
The receipt arithmetic reconciles to the cent in integer cents. All eight cited issues
(#257–#264) exist, are OPEN, and their titles match the claims.

What is wrong is bookkeeping, in five shapes:

1. **F1 (High)** — this PR inserts 164 lines into `docs/runbooks/driver-device-day.md` and
   **breaks 13+ of its own citations into that same file**.
2. **F3** — a cited runbook section (`§D3`) **does not exist**, and the baseline it supposedly
   holds is 14, not 9 — which turns a `+1` deviation into a reported `+6`.
3. **F4, F5, F6** — the AC table, the Status header and two supporting sentences are **stale
   relative to the report's own step table**, all in the same direction: they describe the state
   after pass 1, before the #15 APK landed.
4. **F7** — one figure was true when written and moved by two of this PR's own later commits.
5. The rest are off-by-N citations that change nothing.

**F1, F4, F5 and F7 share one cause, and the fix pass should treat them as one job.** The second
pass (`b73732b`, `75da7be`) updated the step table, the runbook grid and the PR body; it did not
revisit the AC table, the Tasks-completed list, the `:188` absolute or the AC8 tally. In parallel,
the 164-line insertion moved line numbers under citations written before it. Fixing these one at a
time is how the fifth gets missed — sweep for *"what did the second pass not touch"* rather than
per-finding.

---

## Routing

**AGENT FIXES** — mechanical, no judgment needed:

- **F1** `.claude/plans/driver-15-offers-device-pass.md:45,50,145,161,197,207,337,357,394,401,404,429,678` + `.claude/reports/driver-15-offers-device-pass-report.md:106,195` — re-derive each by grepping the quoted phrase at head.
- **F3** `.claude/plans/…-device-pass.md:345-346` + `.claude/reports/…-report.md:318` — `§D3` → `:178-182`, `9` → `14`.
- **F4** `.claude/reports/…-report.md:5,386` — restate the Status header and AC1 from the step table.
- **F6** `.claude/reports/…-report.md:239-241` — add `push.*` / `rider.*` to the enumerated key set.
- **F7** `.claude/reports/…-report.md:393` — `24` → `25`, with a provenance word, **edited last**.
- **F8** `.claude/plans/…-device-pass.md:374` — `auth.sms.stub_sent` → `auth.otp.stub_sent`.
- **F9** `.claude/reports/…-report.md:431` — note that `.claude/last-gate.json` is gitignored.
- **F10** the off-by-N table — optional, conclusions unaffected.

**HUMAN DECIDES** — outside the working tree, or a wording call:

1. **F5's PR-body half** — PR #265 body, §"Device pass" table row 1. The body is the only surface
   not in the diff; `steps 1, 2, 3a, 3b, 5, 6, 8, 11` → `3b, 5, 6, 8, 11` is a `gh pr edit` the
   author must make deliberately. **F3 is also repeated in the body** (*"the runbook recorded 9"*).
2. **F5's report half** — `.claude/reports/…-report.md:20,188` — how to narrow *"No #15 step
   result is taken from this APK"*, and whether `16:23:16` is UTC.
3. **F2** — `docs/runbooks/driver-device-day.md:361,362` — whether the §"Also on this day" rows
   are marked done in place or moved out. Row 1 is still #14's and must stay.

**HUMAN READS** — ride-state- and money-adjacent; no code changed, but a precedent is set here:

1. **I2's deliberate `assertTransition()` bypass** — `.claude/reports/…-report.md:325`. Five
   2026-08 rides retired to `cancelled_by_system` by direct `UPDATE` on the dev DB, because they
   predate #136's 16-char tracking token and the read that would load them throws. The agent
   confirmed the justification independently: `schemas/tracking.ts:30-34` says the parse throws
   on read, and `dispatchAwaitingRides → offerNext → findWithQuote → toRide` has no per-ride
   catch, so one bad row starves the whole batch. No shipped code changed. But
   no-direct-status-writes is a hard rule and this is the first recorded exception — worth
   agreeing to the precedent in writing.
2. **AC7's money reconciliation** — `.claude/reports/…-report.md:392`. `901 | 15 | 135 | 766`;
   `135 + 766 = 901`; 15% of 901 = 135.15 → 135. Integer cents throughout. Re-derived, holds.

**HUMAN TESTS** — named by the pass itself, not review findings:

1. Step 13's one-time payment-change banner · step 9's glance mode via `geo fix` velocity ·
   step 12's queue line on the second AVD (`sakta141`) — §T11's own list.
2. **#263's *starvation* half on a real device** — the issue says it scales with speech rate and
   is not established off the emulator. The re-read half stands regardless.

**FYI** — checked, nothing to do:

- The PR body's `18 tasks / two apps` parenthetical is **true** (`5df2c72`, 2026-08-18: gate graph
  = 18, driver and rider each `typecheck` only). Re-derived because it is exactly the shape of
  inherited claim that ships unaudited.
- The PR body's gate block reconciles **field-for-field** with `last-gate.json` at the PR head.

---

## Issues by severity

### F1 — High · the PR breaks 13+ of its own citations into the file it edits

`.claude/plans/driver-15-offers-device-pass.md` (11 lines) · `.claude/reports/driver-15-offers-device-pass-report.md:106,195`

The runbook hunk is `@@ -359,11 +359,175 @@` — **+164 net lines** inserted at ~370. Every
citation to `docs/runbooks/driver-device-day.md:NNN` with `NNN >= 370` was recorded against the
pre-insertion file and now points **into the section this same commit added**. The plan, the
report and the insertion ship together, so these are broken at head, not historical drift.

CLAUDE.md's on-demand table calls this runbook *the only copy of the run sheet*. A next session
following `:545` for *"an `adb` tap cannot win the offer countdown"* lands on `expo-location`
prose instead.

`observed` — resolved on both sides (`git show origin/main:…` vs the PR head):

| Cited | In | Should point at | Now resolves to | Correct at head |
|---|---|---|---|---|
| `:368` | plan:161, :197 | *"not a second run sheet"* rule | blank | **`:534`** |
| `:390` | plan:197, :357 | `### Setup, once` | ⚠️ step 7 prose | **`:554`** |
| `:434` | plan:394, :678, report:106 | `### Injecting a position` | §Presence prose | **`:598`** |
| `:519` | plan:197, :404 | `### Running the steps on an emulator` | *"20 knots clears the threshold 3.7-fold"* | **`:683`** |
| `:527` | plan:207, :337 | the `10.0.2.2` NAT-alias rule | blank | **`:692-693`** |
| `:531` | plan:401 | the 44 px touch-target divergence | `API_PORT` / DHCP prose | **`:700-701`** |
| `:535` | plan:429 | dump → `bounds` → `input tap` | blank | **`:698-699`** |
| `:541` | plan:50 | *"`uiautomator dump` fails … running countdown"* | blank | **`:705`** |
| `:545` | plan:45 | *"An `adb` tap cannot win the offer countdown."* | `expo-location` consumer prose | **`:709`** |
| `:548` | plan:357, report:195 | the `system_locales lv-LV` line | mid-paragraph, wrong finding | **`:717-720`** |
| `:558` | plan:145 | `### Gates 2 and 3, as run` | *"JDK 17 from the Adoptium tarball"* | **`:722`** |

**Do not fix by adding 164.** Four of these (`:368`, `:527`, `:531`, `:548`) were **already**
2–7 lines low against `origin/main`, so the offset is a sanity check, not a formula — re-derive
each by grepping its quoted phrase at head.

Unaffected and correct, for contrast: `:19` §Result, `:78` §Setup, `:111` §1, `:128` §2, `:233`
§Steps, `:245` (the `Idempotency-Key`-must-be-uuid finding, verbatim), `:352-364`, `:360`, `:362`
(the one line this PR deliberately changed, now correctly naming **#15**), `:363`.

---

### F3 — High · a cited runbook section does not exist, and its baseline inflates a deviation 6x

`.claude/plans/driver-15-offers-device-pass.md:345-346` · `.claude/reports/…-report.md:318` (D4) · **and the PR body**

The plan:

> run `npx expo install --check` before the build. `driver-device-day.md` **§D3** records **9**
> packages of pre-existing drift; decide and record, do not silently bump.

The report's deviation D4, and the PR body's §"Notes for the reviewer", both inherit it:

> `expo install --check` reports **15** outdated packages, not the runbook **§D3's 9**.

Two things are wrong. `observed`:

- **There is no `§D3`.** `grep -nE '^#+ *(D[0-9]|§D)'` over the runbook returns **nothing**, in
  both revisions. No section in the file is labelled `D1`, `D2` or `D3`.
- **The runbook's figure is 14, not 9.** `driver-device-day.md:178-182` (§2, *"Build and install
  the APK"*, above the hunk and so unmoved):

  > **`expo install --check` is NOT clean today, and that predates this runbook.** `observed`
  > 2026-09-17: **14 packages** sit one or two patch versions below what SDK 57 expects

So D4 reports a **+6** divergence that is really **+1** (15 vs 14) — barely a deviation row at
all. The `9` appears nowhere in the repo I can find; it entered at the plan and was carried
forward through the report into the PR body without re-derivation, which is the inherited-figure
path CLAUDE.md names by number.

**High, and it is the only finding here with no true ancestor.** F7's `24` was `observed` and
correct when it was written; every other figure in this PR reconciles. The `9` was never true
anywhere in the repo — `grep` finds it in no other file — and it now sits in **three surfaces**
(plan, report, PR body) citing a section that does not exist. A later session acting on it either
chases six phantom packages or dismisses the whole drift row; both are worse than the truth,
which is that one package has drifted since 2026-09-17.

**The decision this PR made is unaffected**: not bumping was right either way, and D4's reasoning
(#225/#232 each proved a dep change needs its own build) stands on its own.

**Fix**: `§D3` → `:178-182`; `9` → `14`; and soften D4 to what it is — one package of new drift
since 2026-09-17.

---

### F2 — Medium · the runbook now lists finished work as owed

`docs/runbooks/driver-device-day.md:361`, `:362` (§"Also on this day")

Row 2 (*"Three ear-checks: #161's two earnings-label states, F4's offer-card label, and N3…"*)
and row 3 (*"The offers / active-ride device pass"*) are both still worded as **owed**. Row 3 got
its `#16` → `#15` correction and nothing else.

174 lines below, the new §"The offers / active-ride pass (#15)" says the ear-checks are
*"**closed for TalkBack**"* and the pass is run. A table of owed work that lists done work is the
defect its next reader pays for, and this file is the only copy of the sheet. The PR is otherwise
careful about exactly this row — it fixed `#16` → `#15` on the way past — so the omission reads
as a miss.

**Fix**: one clause each. Row 3 → *"…device pass | #15 — **run 2026-09-22, see §The offers /
active-ride pass (#15)**"*. Row 2 → *"…**TalkBack legs closed 2026-09-22 (#262, #263); VoiceOver
owed (#257)**"*.

---

### F4 — Medium · the Status header and AC1 are stale against the report's own step table

`.claude/reports/driver-15-offers-device-pass-report.md:5`, `:386`, `:63`

Three surfaces contradict the step table 380 lines below them. All three describe the state after
**pass 1** — before the #15 APK landed.

| Where | Says | Step table `:27-40` says |
|---|---|---|
| `:5` Status | *"COMPLETE for … steps 1–3, **5, 6, 7, 8, 11**; **PARTIAL for 4, 9, 10, 12, 13**"* | 7 is **⚠️ partial**; 4, 9, 12 are **unrun**, not partial |
| `:386` AC1 | *"**4 of 13** steps carry an artifact; the other **9** … unrun"* | **8** rows ✅ with an artifact, **3** more partial with artifacts, **3** unrun |
| `:63` T5 | *"steps 1, 2, 3a ✅; **3b server-only**; the rest blocked by I5"* | 3b is **✅ on the #15 APK**, with two screenshots |

The Status header also breaks the rule the report sets in its own opening blockquote: *"A row that
was never reached still reads **unrun** at the end — that is the honest default, not an omission."*

`:386`'s *"4 … the other 9"* is exactly the pass-1 tally (1, 2, 3a green + 3b server-only). The
second pass updated the step table, the runbook grid and the PR body; the AC table and the
Tasks-completed list were left behind.

**Why only Medium**: §T11 names the four unrun legs correctly, so the operative decision — *#15
stays open* — is right regardless. The cost is a later session reading AC1 and re-running nine
steps, eight of which are done.

**Fix**: `:5` → *"COMPLETE for the a11y half and steps 1–3, 5, 6, 8, 11; PARTIAL for 7, 10, 13;
UNRUN for 4, 9, 12"*. `:386` → *"11 of 14 rows carry an artifact; 3 (steps 4, 9, 12) are recorded
unrun with a named cause"*. `:63` → split by pass.

---

### F5 — Medium · which APK ran which step, and one absolute its own table contradicts

`.claude/reports/…-report.md:20`, `:188`, step table `:27-40` · **and the PR body's device table**

The Run environment promises:

> **Two passes.** … **Every row below says which**

`observed`: **13 of the 14 step rows name no APK.** Only 3b does. That matters more here than it
normally would, because I5 is the whole reason APK identity is load-bearing — an old bundle
rejects every ride payload and shows only a generic error.

Downstream, the **PR body** states:

> `§Level 4 steps 1, 2, 3a, 3b, 5, 6, 8, 11` | ✅ on the #15 build `e1afc69a…`

Steps **1, 2 and 3a** do not belong in that row, on the report's own evidence:

- T3 (`:61`): the build was *"submitted 14:14:57Z, **still `in queue` ~50 min later**"* → not
  installable before ~15:05Z. Step 3a's artifact is `dispatch.offer.expired` **at 14:50:42Z**.
- Step 2's `s1d.png` reads «Atlikušas **6 s**» — the seeded 20 s window. Step 3b's `n2-card.png`
  reads «Atlikušas **162 s**» — T1's 180 s raise. Different sessions.
- T5 (`:63`) says it outright: *"steps 1, 2, 3a ✅; 3b server-only; the rest blocked by I5"*.

Which makes the absolute at `:188` false against the same document:

> **No #15 step result is taken from this APK.**

Steps 1, 2 and 3a are exactly that. The §"T6 and T7's home legs ran on #224's APK" argument
**does** cover the offer card's composition (see F6), so AC5's reliance on `s1d.png` is
defensible — it is the blanket sentence that is not.

**Not High**: 3b, 5, 6, 8 and 11 are the load-bearing set, 3b names the #15 APK explicitly, and
I5's failure mode is ride payloads, which steps 1, 2 and 3a never touch. *"The functional core is
green on the #15 build"* survives intact.

One thing blocks settling it from the document alone: *"installed **16:23:16**"* (`:20`) is **the
only timestamp in the report without a timezone**, while every other carries `Z`. Read as UTC it
is 2 h 08 m after submission, which does not sit with *"queued 53 min"* on the same line; read as
local it precedes the *"still in queue"* observation.

**Fix**: name the APK per row (or split the table by pass); narrow `:188` to *"No step requiring a
ride payload is taken from this APK"*; add `Z` to `16:23:16`; and correct the PR body's row to
`3b, 5, 6, 8, 11`. **The PR body is the surface not in the working tree** — the one most likely
to be missed.

---

### F6 — Medium · the byte-identity argument enumerates the wrong key set

`.claude/reports/…-report.md:236-241`

This is the argument that licenses running the a11y legs on #224's APK, and the report stakes its
credibility on it being checkable:

> `git diff --stat 4e6ffb68 HEAD` over every file that composes these names … reports **no
> change**. The only moved file in the set is `packages/shared/src/i18n/lv.ts` (+46/−7), and
> **every changed key in it is `sms.*` or `console.*`**: not one `driver.*` key differs.

So I ran it. Three parts of four hold.

| Claim | `observed` `4e6ffb68` → `6eec024` | |
|---|---|---|
| the five name-composing files unchanged | `git diff --stat` over `offer-card-props.ts`, `offer-card.tsx`, `home-screen.tsx`, `earnings-body.ts`, `earnings-card.tsx` → **empty** | ✅ |
| `lv.ts` is `+46/−7` | 46 insertions, 7 deletions | ✅ exact |
| every changed key is `sms.*` or `console.*` | prefixes are `sms.` ×2, `console.` ×6, **`push.` ×2**, **`rider.` ×2** | ❌ |
| not one `driver.*` key differs | no changed line defines a key with the `driver.` prefix | ✅ |

The four unenumerated keys are `push.rider_arrived_title`, `push.rider_arrived_body`,
`rider.status.arrived` and `rider.push.channel_name` — #17's and #135's recent work. None is in
the driver app, so **the conclusion is sound**: the driver app's accessible names *are*
byte-identical across the two build commits, and the a11y legs on #224's APK stand.

Medium rather than Low because the report invites the check by name (*"checkable, not asserted"*),
and a reader who runs it finds a false sentence guarding a true conclusion — the fastest way to
lose an argument's value.

**Fix**: *"…every changed key is `sms.*`, `console.*`, `push.*` or `rider.*` — **not one
`driver.*` key differs**, which is the half that matters here."*

---

### F7 — Low · `Tick count 17 → 24` was true when written and moved twice afterwards

`.claude/reports/…-report.md:393` (AC8 basis)

The unit is defined — the plan's own VALIDATE at `:549` is
`grep -c '✅\|❌' docs/runbooks/driver-device-day.md` — and the **start figure is correct**.
`observed`, running that command at every commit on this branch that touches the runbook:

| Commit | | Count |
|---|---|---|
| `d6207be` | `origin/main` | **17** ✅ matches |
| `86b6871` | *the #15 offers pass result and its setup deltas* | **24** ← the figure was true here |
| `316d1a5` | *home is undumpable while online too* | 24 |
| `b73732b` | *second-pass result, the settle/earnings rule* | 26 |
| `75da7be` | *step 7 is partial, not green* | **25** ← head |

So `24` is not invented — it is **stale by two of this PR's own later commits**. Which is
precisely the failure the plan warns about three lines above the command, at `:547-548`:

> figures in the report are **not** inherited from this plan. Re-derive anything you copy. **A
> report that quotes a PR body's size table is stale by construction.**

And it is the same self-referential shape the author *did* guard against elsewhere: commit
`6eec024` is literally *"stop quoting gate wall-clock — the report is in its own diff"*. The
guard was applied to the gate figure and not to this one, though both live in the same PR as the
thing they count.

It also carries **no provenance word**, which breaks AC10's own ✅ on the line above
(*"no figure in it lacks `observed` / `derived` / `expected`"*).

Low because nothing depends on a tick tally, and the AC8 **verdict** is unaffected: `:362` does
name #15, and the runbook does carry the §Result table and the setup deltas.

**Fix**: `observed: 17 → 25` — and make it the **last** edit, since any further commit to the
runbook moves it again.

---

### F8 — Low · the plan sends the next runner to the wrong log event for the OTP code

`.claude/plans/driver-15-offers-device-pass.md:374`

> read the code from the api console — **`auth.sms.stub_sent`** logs the SMS **body in full**,
> deliberately (`stub-sms.provider.ts:28-37`)

`observed` in `stub-sms.provider.ts`: two methods, two events.

- `sendOtp()` logs `event: 'auth.otp.stub_sent'` with **`code`** — the OTP path.
- `send()` logs `event: 'auth.sms.stub_sent'` with **`body`** — the tracking-link path.

The plan cites the second to read the first. The cited range `:28-37` straddles both. The runbook
gets it right at `:243` (*"read the code from `auth.otp.stub_sent`"*), and step 13 is one of the
steps still owed, so the next runner will follow this line.

**Fix**: `auth.sms.stub_sent` → `auth.otp.stub_sent`, range → `sendOtp()`.

---

### F9 — Low · the report's named check is gitignored

`.claude/reports/…-report.md:431` · `.gitignore:25`

> **The PR body carries the run taken at the branch head**, recorded by `record-gate.sh` into
> `.claude/last-gate.json`, whose `head` field is the check that it matches

`.claude/last-gate.json` is gitignored (`.gitignore:25`), so it is in neither the diff nor the
repo. A GitHub reviewer cannot run the check the report names.

I ran it out of band from the author's worktree and **it passes** — see §What's good. The sentence
just needs to say the artifact is local-only.

**Fix**: *"…(local-only, gitignored; re-derive with `record-gate.sh`)"*.

---

### F10 — Low · off-by-N citations and three wording nits · conclusions unaffected

Found by the `code-reviewer` agent opening each at head. Listed for completeness; none changes a
claim.

| Cited | Reality |
|---|---|
| `offer-card.tsx:113` (plan:54, :803) "the countdown `Text`" | `<Text>` opens at **111**; `:113` is `testID`; content at **115**. Cited twice |
| `push.module.ts:16-27` (report:146) | factory is **16–26**; 27 blank. Behaviour claim exact |
| `location-task.ts:43-52` (report:118) | expression runs **43–53**. Behaviour claim exact |
| `home-screen.tsx:96-110` (plan:204) | `Pressable` is **101–111**; 96–100 is its comment |
| `stub-sms.provider.ts:28-37` (plan:374) | `send()` is **30–41** — see F8 |
| `gate-screen.tsx` under `features/auth/` (plan:438-444) | path is `features/**onboarding**/`. Behaviour claim exact |
| *"`auth.schemas` docblock"* (report:328, I4) | no such file — it is `packages/shared/src/schemas/auth.ts:15` |
| plan:158 §"Accept timer 20–30 s" | heading is `### 5.1 Accept timer: longer is safer…`; "20–30s" is in its body at `:106` |
| plan:195 runbook *"660+ lines"* | 667 at `d6207be`, **831** at head — the PR's own edit makes it misleading |
| report:327 (I5) *"a **transitive** import"* | `schemas/ride.ts:20` imports `trackingTokenSchema` **directly**. What is transitive is the **change**, not the import — and the runbook's own phrasing at `:437-443` states the mechanism correctly. I5's substance is right; the word is not |
| report:51 (T7.2) predicate for the derived 8 | the count is right and honestly labelled *"never counted at the seeded 20 s"*. But the quoted rule `s <= 5 \|\| s % 5 === 0` **also admits `s = 0`** and would give 9; `offer-card.tsx:60` excludes it with a separate guard (`s <= 0`) the report does not quote. The agent confirmed the countdown does start at exactly 20 (`offer-builder.ts:61` → `offer-state.ts:204`), so quoting the guard makes the derivation stand on its own |
| report:295 «(85%)» | rendered from `commissionPct` (100 − 15), not from `766/901`. The second arithmetic is a consistency check, not the derivation — worth one word so a later reader does not take it as the source |

---

## Validation

| Check | Result |
|---|---|
| CI `check` @ `6eec024` | ✅ pass, 3m19s — run [35749931398](https://github.com/linardsb/taxi/actions/runs/35749931398), `head_sha` = `6eec024` (`observed` via `gh api`) |
| CI `audit-diff` · `codeql` · `CodeQL` · `ready` | ✅ ✅ ✅ ✅ |
| `mergeStateStatus` | `CLEAN`; recorded base `d6207be` == live `origin/main` tip — **base has not moved**; no prior review round, so the guarantees pass does not apply |
| Local full gate | **not re-run**, deliberately — see below |
| `.claude/last-gate.json` `head` | `6eec024` == PR head, `exit_code` 0, `elapsed` `1m47.391s` (`observed`, author's worktree) |

**Why the local gate was not re-run.** The diff is three Markdown files and no source; CI ran
`typecheck lint test build` on the exact head sha and it is green; and CLAUDE.md §"Concurrent
Claude sessions" makes integration runs mutually destructive across sessions — `ps` shows **19**
`claude` processes on this checkout. Re-running would have risked another session's gate to
re-derive a result CI already holds at the same sha. Recorded as a deviation, not skipped
silently.

**The PR body's gate figures reconcile field-for-field** against `last-gate.json` at the same
head: `22 successful, 22 total` · `0 cached, 22 total` · `1m47.391s` · the six-entry
`tasks_not_in_graph` list · and all twelve per-package counts (api 812/83, shared 255/28,
dispatch 272/30, driver 250/44, rider 162/31, db 17/3).

---

## The numbers pass

| Figure | Provenance | Verdict |
|---|---|---|
| `842 + 434 + 165 = 1,441` added, 1 deleted, 3 files | `observed` | ✅ matches `git diff --numstat` |
| 16 commits | `observed` | ✅ `git rev-list --count` = 16 |
| Gate: 22 tasks, 0 cached, 1m47.391s, 12 per-package counts | `observed` @ `6eec024` | ✅ all match `last-gate.json` at that head |
| `135 + 766 = 901`; `split` row `901 \| 15 \| 135 \| 766` | `observed` + `derived` | ✅ holds; 15% of 901 = 135.15 → 135 |
| `GLANCE_SPEED_MPS = 10/3.6`; `10/1.852 = 5.40 kn`; `20 kn = 10.29 m/s`; "clears it by 3.7x" | `derived`, condition stated | ✅ 10.29 / 2.778 = 3.70 |
| 8 announcements at 20 s | `derived`, labelled | ✅ count right, predicate quoted incompletely — **F10** |
| #263: 5 re-reads vs 1 focus read; "six timestamped reads" | `observed` | ✅ internally consistent |
| #262: 0 utterances, `nodeLiveRegion=0` on 14 events | `observed` | ✅ consistent across body, report and issue |
| 20 `SpeechControllerImpl` lines after four focus swipes | `observed` | ✅ labelled, mechanism named |
| `lv.ts` `+46/−7` | `observed` | ✅ exact |
| PR body: *"18 tasks … two apps went unchecked"* | historical, unlabelled | ✅ **re-derived true** — see below |
| **`Tick count 17 → 24`** | **none** | ⚠️ **F7** — true at `86b6871`, 25 at head |
| **`4 of 13 steps … the other 9`** | none | ❌ **F4** |
| **steps 1, 2, 3a ✅ "on the #15 build"** | mis-attributed | ❌ **F5** |
| **`expo install --check`: 15 vs "§D3's 9"** | inherited, wrong baseline | ❌ **F3** — the runbook says 14, and there is no §D3 |
| **"every changed key is `sms.*` or `console.*`"** | `observed`, wrong set | ❌ **F6** — conclusion survives |
| Runbook *"660+ lines"* | stale | ⚠️ **F10** |

**On the 18-task parenthetical.** Exactly the shape of inherited claim CLAUDE.md warns ships
unaudited, so I re-derived it. `observed` at `5df2c72` (2026-08-18): the gate graph held **18**
tasks — api 4, db 4, dispatch 4, shared 4, config 0, and `apps/driver` + `apps/rider` **1 each,
`typecheck` only, with neither `lint` nor `test`**. 18 + 4 = 22, today's count. Two apps, both
genuinely unchecked, exactly as written. Its only defect is carrying no provenance label.

**On the figures that credit a mechanism.** The `geo fix` velocity figure states its condition
outright (*"`geo fix` is only delivered once something is requesting location"*) and labels the
whole thing **`expected`, not observed**. #263 separates `TYPE_ANNOUNCEMENT` from
`TYPE_WINDOW_CONTENT_CHANGED` precisely so a throttled announcement cannot be conflated with a
re-announcement, and says so. Both are the template the repo wants.

---

## Constraint pass

`grep -in "do not modify|do not edit|read-only|no changes to|frozen|not included"` over the plan:
Non-Goals freezes **any code change to the offer / active-ride / earnings slices** unless a step
fails, in which case *"a failure files an issue with the reproduction and is fixed in its own
loop"*.

Every fix recommended above is a documentation edit. #262 and #263 correctly stayed **issues**
rather than inline fixes — the plan's rule followed, not a gap.

---

## What's good

- **The gate figure is handled the way this repo has been trying to get right for four tickets.**
  `6eec024`'s message is *"stop quoting gate wall-clock — the report is in its own diff"*, and the
  report says why in full: a run it named would be superseded by the commit that named it. The
  number moved to the PR body, the run was taken at the branch head, and `last-gate.json`'s `head`
  field proves it. That is the report-restating-PR-body-figures trap sidestepped **on purpose**,
  with the artifact to show it. F7 is the same trap, one figure over — which is the most useful
  thing in this review: the guard works, it just was not applied twice.
- **The behavioural claims survive checking at a rate I did not expect.** The `code-reviewer` agent
  opened every cited symbol: `forCity()` really is an uncached `select().limit(1)`;
  `DRIVER_LOCATION_TTL_SECONDS = 60` really is what `findNearby` filters on; `ledger_entries` is
  written only by `settlement.service.ts:115`; `apps/driver` really has no settle call;
  `offer-card-props.ts:98-106` really does put payment before the accept prompt, matching the
  quoted utterance segment for segment, queue line correctly absent. The **inference** built on
  `rides.repository.ts:205` also confirmed: `dispatch.service.ts:136-154` commits the `offered`
  transition and `insertOffer` in one transaction, so `alertUnclaimed` cannot see a ride with a
  live offer — the runbook's claim that raising the window does not manufacture a false unclaimed
  alert is sound.
- **`tasks_not_in_graph` is disclosed in the PR body**, with the distinction that matters. A green
  22/22 that volunteers what it did *not* check is rare.
- **I5 corrects the author's own prior reasoning in writing** — *"a file can be unchanged and still
  import a contract that moved"* — and promotes the correction into the runbook as a reusable
  warning. Modulo the "transitive" wording (F10), the single most valuable paragraph in the PR.
- **Step 7 refuses the convenient explanation.** The dropped-socket story fits the symptom and the
  report rejects it, because step 8's reassignment crossed the same socket in real time minutes
  later. Marked ⚠️, cause left open. Most reports ship the guess.
- **Both filed defects carry a comment stating where the run established less than the issue
  claims** — #262 had no positive live-region control; #263's *starvation* half scales with speech
  rate and is not established off the emulator.
- **§T11 argues against closing the ticket the PR exists to close**, and names five specific gaps
  to do it. All eight cited issues are OPEN with matching titles, and Non-Goals plus
  Forward-references cite all four orphans — AC11 holds as written.
- **The TalkBack `adb` recipe is a real capability gain**: `pref_log_level` sourced from the APK's
  own string table, the `swipe`-vs-`tap`-vs-`DPAD` distinction, and the subtype rule. It removes
  the last attended step from the a11y half, and it is correctly placed in the runbook rather than
  the report.
- **The collapse question is settled by the right instrument.** The dump shows two nodes; the focus
  walk shows four stops for four `content-desc` nodes; the report says the dump alone cannot settle
  it and names which instrument can. The plan's oracle table paying off.

---

## Recommendation

**Request changes.** No finding threatens a conclusion — the pass stands, the two defects are real
and well filed, and #15 should stay open exactly as §T11 argues.

But a docs-only evidence PR's figures and navigation **are** its deliverable, and six figures plus
thirteen citations are off. F1 is mechanical. F3 is the only one with no true ancestor. F4–F6 are
corrections in place. F2 is two clauses.

**F3 and F5 must also land in the PR body**, the most-read surface and the only one not in the
working tree.

Suggested order: **F3** (three surfaces, wrong baseline) → **F1** (largest) → **F4** + **F5**
(same root cause; report *and* PR body) → **F6** → **F2** → **F8**, **F9**, **F10** → **F7 last**,
because any further runbook commit moves it again.

---

*Reviewed with `piv-review-pr`. Fresh context, detached worktree at `6eec024`; the `code-reviewer`
agent verified every cited `file:line` against the code it describes, and each of its findings was
re-run here before entering this report.*
