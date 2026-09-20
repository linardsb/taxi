# PR #226 review — round 1

**Head** `6ccab9e` · **Base** `main` @ `1c87592` · **Reviewed** 2026-09-18 · **Round** 1 (no prior report)

`docs: emulator route for #141's device day — Gate 1 passes (#224)` — 4 files, +1692 −8, no shipped source.

## Verdict: request changes

**Revised after a parallel `code-reviewer` agent pass returned seven findings I missed — all
re-derived by me before entry; see the ADDENDUM at the end of this file, which carries the operative
verdict.** Round-1 totals including the addendum: **2 High, 6 Medium, 6 Low**.

The original round-1 body follows unchanged. Its findings all stand; none was retracted.

### Original round-1 verdict: approve, with comments

No Critical, no High. **Two Medium, three Low**, all in documentation accuracy — the class this repo's
`CLAUDE.md` treats as the reviewer's own job, since typecheck/lint/test cannot read prose. Nothing here
is a correctness or safety problem, and each Medium is a single-clause edit that can land before or
after merge.

The evidence discipline in this PR is the strongest I have reviewed in this repo. I re-derived **20** of
its figures and claims independently, one by one, and **every one held** — including the whole build-blocker
dependency chain, which is the part a reviewer would normally have to take on trust.

The deep pass was run directly rather than delegated: every finding below was re-derived against the
artifact that produced it, not against another document.

## Validation

No third local gate was run, deliberately. Two independent greens already exist at exactly this head,
and 16 `claude` processes share this checkout while `global-setup` drops the shared test DB — a third
run would re-derive a twice-established fact at the cost of possibly killing a live session's suite.

| Check | Where | Result |
|---|---|---|
| CI `check` | run `35316763338`, job `105509999158`, anchored to `6ccab9e` (`gh api …/commits/6ccab9e/check-runs`) | ✅ success, 2 m 43 s |
| CI `audit-diff` · `codeql` · `CodeQL` · `ready` | same run, same sha | ✅ all success |
| Local gate | `.claude/last-gate.json` — `head: 6ccab9eb…`, `dirty: false`, `exit_code: 0`, 22/22, `1m42.539s` | ✅ |
| `mergeStateStatus` | `gh pr view` | `CLEAN` — base has not moved (`origin/main` = `1c87592` = `baseRefOid`) |
| `@taxi/driver src/build-config.test.ts` | re-run by me, `observed` this review | ✅ **11 passed / 11** — matches the report's figure |

## The numbers pass — what I re-derived

Every figure below I checked against the thing that produced it, not against another document.

| Claim | Source | Re-derived |
|---|---|---|
| `1206 + 259 + 210 + 17 = 1692`, 8 removed | PR body | ✅ `git diff --numstat origin/main..HEAD` |
| Runbook `322 → 524`; `210 − 8 = 202`; `322 + 202 = 524` | PR body | ✅ `wc -l` both revisions |
| `grep -c Expect` = **2** on both revisions | PR body, AC6 | ✅ |
| Exactly one `## Emulator route` | PR body, AC6 | ✅ |
| Lines 1–322 byte-identical except `:18`, `:20`, `:21`, `:23`, `:25-28` | PR body | ✅ full `diff` of the first 322 lines — **exactly** that set, nothing else |
| Gate 1 stream: `+1m12s716ms` → `+1m27s295ms` = 14.6 s | report `:68` | ✅ `87.295 − 72.716 = 14.579` |
| SDK **5.9 GiB** | runbook `:373`, report `:46` | ✅ `du -sh /usr/local/share/android-commandlinetools` → `5.9G`, re-measured by me now |
| Gate task count **22**, and the 6 not in the graph | PR body | ✅ `turbo --dry=json` → 22 real, 6 `<NONEXISTENT>`, **the same six names** |
| `expo-modules-core@57.0.14` peer `^0.7.4 \|\| ^0.8.0 \|\| ^0.9.0 \|\| ^0.10.0` | report D7.3 | ✅ read from `node_modules` |
| `react-native-reanimated@4.6.0` peer `react-native-worklets: 0.12.x`; tree carries `0.12.1` | report D7.2 | ✅ |
| `expo-router` declares reanimated an **optional** peer at `"*"` | report D7.1 | ✅ `peerDependenciesMeta.optional: true` |
| `bundledNativeModules` pins `4.5.1` / `0.10.1` | report D7.4 | ✅ |
| Bumping `expo` does not help — `expo-modules-core@57.0.18` same range | report D7.5 | ✅ `npm view expo@57.0.23 dependencies.expo-modules-core` → `~57.0.18`; its peer range is byte-identical |
| `--check` is blind to this pair — neither is a declared `apps/driver` dep | runbook `:505`, report `:177` | ✅ both ABSENT from `apps/driver/package.json` |
| `LocationTaskConsumer.kt:48` calls `getFusedLocationProviderClient`; `build.gradle:19` declares `play-services-location:21.0.1` | P1, runbook `:365-366` | ✅ both lines exact |
| `location-options.ts:19` `timeInterval: 4000`; `:21-22` both deferral knobs `0` | runbook `:409`, `:448` | ✅ |
| `MIN_FIX_INTERVAL_MS = 4_000` at `fix-throttle.ts:9` | runbook `:412` | ✅ |
| `56.9496,24.1052` inside «Rīgas centrs» `riga.ts:36-43` | P4, runbook `:403` | ✅ ring is 56.936–56.966 / 24.075–24.135 |
| Nothing in shipped driver source reads the `mock` flag | runbook `:414-416` | ✅ no non-test hit in `apps/driver/src` — **and** `driver-location.service.ts:50-90` has no fix-validation guard either, so the conclusion holds past the api boundary too |
| `targetSdkVersion` defaults to 36 | runbook `:368` | ✅ `ExpoModulesCorePlugin.gradle:69` |

Two claims I could not re-derive and am not disputing: the EAS build's `errorCode` / `buildDuration`
(labelled `observed` with a build id a human can open), and the Gate 1 `dumpsys` capture itself.

### The constraint pass

`grep -in "do not modify|do not edit|read-only|no changes to|frozen|must not"` over the plan returned 8
hits. The binding ones:

- plan `:687` — *"do not edit `eas.json`'s `distribution` or `app.json`'s cleartext entry"*. ✅ `git diff origin/main..HEAD -- apps/driver/eas.json apps/driver/app.json` is empty.
- plan `:815` / `:827` — T11's append-only and `Expect`-count constraints. ✅ both hold, with the in-place licence T11 itself grants.
- plan `:141` — `usesCleartextTraffic` "Read; do not edit." ✅ untouched.

I also checked the thing that constraint exists to protect: the section tells the operator to build
`preview` with **plain HTTP** at `10.0.2.2:3001`. `app.json:73` sets `usesCleartextTraffic: true` and
`eas.json`'s only profile is `preview`/`distribution: internal`, so the instruction works and does not
collide with PR #222's binding. **No finding** — recording it because a Gate 2 blocked by cleartext
would look exactly like a #141 failure.

Same check on Gate 2's pass condition: `driver.location.ping_accepted` exists at
`services/api/src/features/drivers/location/driver-location.service.ts:77`. Gate 2 is runnable as
written.

### The guarantees pass — not triggered

`origin/main`'s live tip is `1c87592`, identical to the PR's `baseRefOid`, and there is no prior
`pr-226-review*.md`. First round, base has not moved. Skipped per the skill.

---

## Findings

### M1 — the new section restates §Verdict's step set, which the same file forbids

`docs/runbooks/driver-device-day.md:462`

> §Verdict applies unchanged: 4, 5, 7 and 8 are load-bearing and binary, 6 corroborates, 1–3 are setup.

`:296-299`, three sections above, says:

> That set is re-derived per step from what each one tests, in `.claude/plans/driver-device-day-prep.md`
> § *The step-set re-derivation* — which also reconciles the three earlier, mutually inconsistent
> statements of it. **Cite that section rather than restating the list anywhere new.**

The plan's own T11 PATTERN (`:806`) repeats it: *"cite, do not restate."* The restatement is **accurate
today** — I checked it against `:292-294` and it matches. That is exactly the condition under which the
three earlier copies were also accurate, and PR #218 exists because they then diverged into three
different owed-step sets. This PR has now created a fourth statement of that set, inside the very file
whose rule against it is 164 lines up.

**Failure it causes**: the next edit to §Verdict silently desynchronises `:462`, and an operator reading
the emulator section alone scores the day against a stale set.

**Fix**: truncate to the citation. Delete everything after "§Verdict applies unchanged." — the sentence
is complete and correct without the list.

---

### M2 — the section prescribes steps **2–8**; the PR body and AC6 both say **3–8**

`docs/runbooks/driver-device-day.md:460` · PR body · report `:230`, `:232`

The shipped section says:

> Past Gate 3, run §Steps rows **2 through 8** exactly as written above — including step 3's "open
> `t/<token>` before the watch starts", and **step 2's board-visibility half, which a ping-only gate
> does not cover**.

The PR body says the opposite: *"It **cites §Steps 3–8 by number** and restates none of them."*

**The runbook is right and the widening is a genuine improvement.** Gate 2 asks only
`driver.location.ping_accepted` at ~4 s; §Steps row 2 is a **HARD GATE** whose second half is "the
driver visible on the board". Nothing in Gates 1–3 covers the board. Including row 2 closes a real hole.

What is wrong is that nothing records the widening as a divergence, and four surfaces now disagree:

| Surface | Says |
|---|---|
| `driver-device-day.md:460` (shipped) | **2–8**, with the reason |
| Plan AC4 `:966`, AC6 `:971`, T10 title `:765`, T11 PATTERN `:806` | 3–8 |
| Report AC6 row `:232` — ticked **✅** | against a criterion worded "cites steps 3–8" |
| Report AC4 row `:230` | 3–8 — while D9 `:192` and *What #141 needs now* `:258` both say **2–8** |

Plan AMENDMENTS A1 `:1202` half-caught it ("T10's Result-table fill and **its row-2 board half** are
still entirely owed") without reconciling AC4/AC6 or T10's title.

**Failure it causes**: AC6 is ticked ✅ against text the section deliberately exceeds, so the tick
certifies nothing; and the PR body — the most-read surface, and the only one not in the working tree —
describes a section that is not the one that shipped.

**Fix**: three edits. (1) PR body: `3–8` → `2–8`, and say why row 2 is included. (2) Report: add a D-entry
for the widening, and change AC6's row from a bare ✅ to "✅, widened to 2–8 — see D<n>". (3) Plan: AC4,
AC6, T10's title and T11's PATTERN take `2–8`, so a resuming pass does not re-narrow it.

---

### L1 — "D1–D12" on two surfaces while the report carries D13

PR body ("Documented deviations, in full in … (D1–D12)") and plan `:1205` ("deviations D1–D12") both
name a range that excludes D13 — which exists at report `:199`, and which the **PR body itself then
discusses as one of its own bullets** one paragraph later. Inherited without re-derivation, which is the
pattern `CLAUDE.md` names.

The report's deviation block also runs out of order: D1–D9, D11, **D13**, D12, D10.

**Fix**: `D1–D13` on both surfaces; reorder the report's block, or renumber so the sequence is monotonic.

---

### L2 — `ProviderRequest[OFF]` appears in the failure signature *and* in the PASS evidence

`docs/runbooks/driver-device-day.md:387-390` vs `:428-436`

The section explains that `adb emu geo fix` fails **because** "the emulator's GPS HAL sits at
`ProviderRequest[OFF]`, `mStarted=false`". D5's cold-boot false negative is also recorded as
"`last location=null` / `ProviderRequest[OFF]`". Then Gate 1's **PASS** block quotes:

```
fused provider:
  service: ProviderRequest[OFF]
```

Three roles for one string, and the text never says the `[OFF]` in the pass block is expected. The two
are different providers — the failure is about `gps`, the pass is about `fused` — but nothing on the
page draws that distinction.

The correct discriminator **is** stated ("A `diff` of two captures ≥10 s apart that reports no change is
Gate 1's ❌"), so the rule is right; the risk is a reader who scores the pass block as a failure.

**Fix**: one clause in the Gate 1 block — "`ProviderRequest[OFF]` is expected here: a test provider
writes last-known regardless of who is requesting. The pass criterion is the advancing `et=`."

---

### L3 — the prep plan's retired claim still stands in place, unlike the runbook's

`.claude/plans/driver-device-day-prep.md:70-74`

Still asserts, with no in-place marker:

> Both substitute paths are **closed** … Android emulator — **no SDK on this machine** (`observed`
> above); … a multi-GB detour with an uncertain end

D13 retires it by appending to `## AMENDMENTS` at `:1463` — **1389 lines below**. Meanwhile the runbook's
word-for-word equivalent (`:23`, `:25-28`) was rewritten **in place at a constant line count**. Two
treatments of the same retired subject inside one PR.

I confirmed the append is pure, so `:558-560` has not moved, and that no other file asserts the retired
version — `emulator-oracle-141.md:31-32` quotes it as the premise under test, which is correct. So the
claim is retired *somewhere*, and D13 is explicit about how.

**Not prescribing a fix.** The runbook's in-place treatment is licensed by T11, which is scoped to
`driver-device-day.md` and grants nothing over this file; I have not established what this plan's
AMENDMENTS convention permits. Raising it as the inconsistency it is: a reader who reaches `:72-74` by
citation — as issue #224 does — gets the falsified version with no marker, 1389 lines from its
retirement. Worth a decision, not necessarily an edit.

---

## What is good

- **Gate 1's limit is stated three times, in three artifacts, in the author's own words** — "`dumpsys`
  reporting a fused last-location is not evidence that `requestLocationUpdates` delivers to a registered
  consumer … Gate 1 must never be quoted as 'delivery works'." That is the attribution discipline
  `CLAUDE.md` asks for, applied pre-emptively to the author's own strongest result. I went looking for a
  sentence anywhere that overstates Gate 1 and did not find one.
- **"NOT RUN" is held apart from "❌" everywhere it appears** (D8), including the gate table, the Result
  row, the PR title and both issue comments. The PR could have claimed a verdict it did not reach.
- **The build blocker is diagnosed to the exact peer-range conflict**, with the counterfactual closed
  ("bumping `expo` does not help"). Five steps, each independently verifiable — I verified all five. It
  is correctly attributed to `main` rather than to the branch, and correctly filed as #225 rather than
  fixed inside a documentation spike.
- **D5 is a plan defect found by executing the plan**, and it is recorded in the plan itself so the
  next pass cannot repeat it. The single-shot read would have returned ❌ for a working emulator and
  killed the route on a false negative.
- **T11's line-shift constraint was honoured to the byte** — the first 322 lines differ in exactly the
  five licensed places and nowhere else, so every `driver-device-day.md:<line>` citation anywhere in the
  repo still resolves. The same ticket needed commit `b2421ad` ("correct three plan line refs the F1–F9
  edits shifted") one round earlier; this pass needed none.
- **`eas init`'s undeclared `RECORD_AUDIO` expansion was surfaced and given an owner** rather than
  filed as a third issue or dropped. It was found incidentally and had every excuse to go unrecorded.
- The whole PR is **honest about being partial**, in the title, the Result row, the AC table and the
  body. AC4 is marked ❌ unmet rather than reinterpreted.

## Recommendation

**Approve.** Every figure in this PR holds under independent re-derivation, the validation is green on
the exact head from two independent runs, and the partial status is reported honestly everywhere it
appears.

M1 and M2 are both real and both worth fixing — M1 because the duplication it creates is the exact
class PR #218 closed, M2 because the PR body describes a section that is not the one that shipped. But
neither is a live defect: I checked M1's restatement and it currently matches §Verdict, and M2's
divergence is documented *in the shipped artifact itself*, with its reason, and is an improvement on
the plan it diverges from. They are one clause each, and land as well after merge as before.

Next: `piv-fix-review-findings` on this report — M1 and M2 first, L1–L3 at Linards' discretion.

**Superseded — see the ADDENDUM below.**


---

# ADDENDUM — round 1, after the agent pass

**Head** `6ccab9e` · **Base** `main` @ `1c87592` · supersedes the verdict in my previous comment

A `code-reviewer` agent pass I had dispatched in parallel returned after I posted. It found seven
things I missed. **I re-derived every one of them against the artifact before writing this** — none
is repeated on the agent's say-so, and I downgraded one of its Highs and dropped one of its Mediums
where my own check did not support it.

**Revised verdict: request changes.** Two High. My previous comment's "approve, with comments" was
under-called — it rested on a claim sweep that used three exact phrases where `CLAUDE.md:64` asks for
the **noun**, and H1 below is exactly what that rule exists to catch.

Everything in the previous comment stands: all 20 re-derived figures still hold, the validation table
is unchanged, and the strengths are unchanged. This adds findings, it does not retract any.

---

## H1 — a shipped runbook still records BLOCKED on the premise this PR falsified

`docs/runbooks/rider-a11y-walkthrough.md:30-32` (not in this diff)

> - **TalkBack (Android): no emulator available.** `~/Library/Android/sdk/emulator` does not exist and
>   Android Studio is not installed — `observed` 2026-09-02, during this ticket. `adb` is present but
>   has nothing to talk to.

**The trap is that both literal facts are still true.** `~/Library/Android/sdk/emulator` really does
not exist — the SDK went to `/usr/local/share/android-commandlinetools` — and Android Studio really is
not installed. What is retired is the **conclusion**, "no emulator available", and the `Outcome |
**BLOCKED**` at `:21` and the AC #6 verdict at `:23-25` that rest on it. A booting API 36 `google_apis`
AVD (`sakta141`) now exists on this machine, and this PR's own evidence
(`.claude/reports/emulator-oracle-141-report.md:85-88`) shows `uiautomator dump`, `input tap` and
`screencap` all working on it — most of what a TalkBack walkthrough needs.

This is `CLAUDE.md:64` verbatim: *"Retiring a bad claim means retiring its **subject**, not its digits
— grep the noun."* D13 quotes that rule and applies it to two files. `grep -rn emulator` finds the
third in one pass. **My own sweep missed it** because I grepped the three exact phrases
(`no SDK on this machine`, `Both substitute paths are closed`, `multi-GB detour`) rather than the noun
— the same failure mode, one level up.

**Failure it causes**: the rider a11y pass stays recorded as hardware-blocked on a falsified premise,
in the one file whoever picks that work up will read.

**Fix**: a dated line under `:30-32` — the SDK is not where this file looked, an AVD now exists
(`driver-device-day.md` §Emulator route), and TalkBack on it is untested rather than unavailable.
Supersede the `observed` 2026-09-02 reading; do not delete it.

---

## H2 — the Gate 1 ❌ rule omits its precondition, and Gate 1's ❌ kills the route

`docs/runbooks/driver-device-day.md:428`, `:436-438`

The runbook says "**After** the repeating injection, `adb shell dumpsys location` reported …" and then:

> A `diff` of two captures ≥10 s apart that reports no change is Gate 1's ❌ even when the first read
> passed.

The plan's T6 VALIDATE (`.claude/plans/emulator-oracle-141.md:619`) carries the precondition the
runbook drops:

> `# 6b, `**`with the loop running`**` — capture twice, ≥10 s apart, and compare the et= field:`

"After the repeating injection" reads naturally as *once the injection has been done*. With the loop
stopped, the fused provider's `last location` freezes, `et=` stops advancing, the `diff` is empty — and
the runbook's stated rule marks ❌.

**Why High**: Gate 1's ❌ is defined as route-killing — plan `:625`, *"no synthetic fix can reach the
fused provider on this emulator. **The route is dead.** Stop."* A false ❌ here retires the emulator
route permanently, on the cheapest gate, before any build is spent. This PR **already documents this
exact failure class** in D5 and R26 (a single-shot read returning ❌ for a working emulator);
reproducing it in the operative instruction is the defect.

**Fix**: `:436` → "with the injection loop **still running**, capture twice ≥10 s apart". Add that a
stopped loop is an invalid reading, not a ❌.

---

## M3 — the injection block leaves the AVD permanently mock-capable, with no teardown

`docs/runbooks/driver-device-day.md:391-396`

The block grants `com.android.shell` the `mock_location` appop and registers an enabled test provider.
`grep` over the whole section (`:326-524`) finds **no** `remove-test-provider`, no `appops … default`,
no teardown of any kind. The appop grant persists in the AVD's `appops.xml` across reboots. The report
`:250-252` records that the implementer did clean up — the runbook never tells the next operator to.

**Failure it causes**: a later run reads a stale or silently-mocked `gps`, which has the same signature
as an injection failure.

**Fix**: append to the block —
```bash
adb shell cmd location providers remove-test-provider gps
adb shell appops set com.android.shell android:mock_location default
```

---

## M4 — "Two setup differences, and only two" is false, and the setup is not runnable from this file

`docs/runbooks/driver-device-day.md:465`, `:349-380`, `:458-484`

`:465` states an absolute — *"Two setup differences, and only two"*. There are at least four, and the
commands that close them live only in the plan:

| Gap | Where the runbook stops | Where the command actually is |
|---|---|---|
| No `export` block | `:357` "`JAVA_HOME` must be exported explicitly in every shell" — never says to what; `:372` names `ANDROID_HOME`/`ANDROID_SDK_ROOT` and assigns neither, while `sdkmanager` at `:361` is not on `PATH` | plan T2 `:392-394` |
| No boot command | `:378` "Boot it, then poll `sys.boot_completed`" — neither the `emulator -avd` line nor the poll loop | plan T4 `:510-513` |
| No `adb install` | §2 `:177` says "Install the APK from the EAS build page **on the phone**" — not performable on an emulator | plan T7 |
| Step 1 unassigned | `:459` says run rows "**2 through 8**"; row 1 is sign-in, toggle ON and the background-location grant. Gate 2's row `:425` does not mention sign-in either | plan T8 |

`grep` over `:326-524` confirms: no `adb install`, no `JAVA_HOME=`, no `ANDROID_HOME=`, no
`emulator -avd`.

**Fix**: cite rather than restate, which is this file's own house rule at `:88` ("Use #14's recipe …
Do not restate it") — "Setup, once: `.claude/plans/emulator-oracle-141.md` T2–T4 for the exact
commands." Drop "and only two" from `:465`, and say where step 1 and the APK install happen.

---

## M5 — the AVD create command is not re-runnable, and the remedy it offers hits the same wall

`docs/runbooks/driver-device-day.md:375`, `:483`

`echo no | avdmanager create avd -n sakta141 -k …` is prescribed with no `--force` and no preceding
delete, while `:252` of the report records the AVD **persisting** at `~/.android/avd/sakta141.avd`
(confirmed — it is there now). `avdmanager create` has no idempotent mode; an existing name errors.

`:483`'s screen-size remedy (`avdmanager create avd -d <id>` with a larger profile) hits the identical
wall, and is the *more* likely one to be reached, since it is the prescribed response to the 320 × 640
caveat the section itself raises.

**Fix**: state that re-entry needs `avdmanager delete avd -n sakta141` first, or `--force`; give the
larger-profile remedy a distinct AVD name.

---

## M6 — `:47` still tells the reader no Android SDK is needed

`docs/runbooks/driver-device-day.md:47`, under **What this day does NOT need**

> | An Android SDK (#14's A3) | The APK is built in EAS Build's cloud. Nothing is compiled on this machine. |

True of the phone route, false of the emulator route 306 lines below, which requires a 5.9 GiB SDK.
A reader preparing the day reads this row first.

**Downgraded from the agent's High.** It also flagged `:306-307` ("Close #141 when steps 5–8 have been
run on a phone") against `:347` ("whether it closes #141 is Linards' call") as a contradiction. On my
read they are scoped differently — `:306` states a sufficient condition for the phone route, `:347`
deliberately hands the emulator question to Linards as Q1 — so that half is a scoping ambiguity, not a
contradiction. `:47` is the concrete defect.

**Fix**: scope `:47`'s row to the phone route, one clause, line-count-neutral.

---

## L3 (revised, upgraded to Medium) — the prep plan has an in-place-marker convention this PR did not follow

`.claude/plans/driver-device-day-prep.md:70-74`

My previous comment raised this as a Low and **declined to prescribe a fix**, on the grounds that I had
not established what this plan's AMENDMENTS convention permits. That is now settled, and the hedge was
wrong: the convention is an in-place strike plus "see AMENDMENTS", line-count-neutral, at six sites —
`:149`, `:293`, `:337`, `:678`, `:927`, `:983`, all from PR #218's review round. `:293` is the pattern:

> `> ~~no gap > 8 s~~ — **corrected 2026-09-17 (PR #218 review F3/F6, see AMENDMENTS)**: …`

So the file already does what the runbook did, and this PR held the runbook to the stricter standard
while leaving the prep plan's bullet unmarked 1389 lines from its retirement. Report D13's heading —
*"the prep plan's rejection retired **at its own source**"* — overstates the append; D12's own wording
shows the report knows the distinction (*"`Res2` was retired **at its own bullet** rather than only in
A1"*).

**Fix**: a line-count-neutral marker at `:70-71` and `:72-74`, matching `:293`. Nothing moves, so the
`:72-74` and `:558-560` refs D13 protects stay intact.

---

## L4 — `:1478`'s "iOS Simulator half of `:72-74`" points at the Android bullet

`.claude/plans/driver-device-day-prep.md:1478` (added by this diff)

> **The iOS Simulator half of `:72-74` is unchanged and still closed.**

`:72-74` is the Android emulator bullet in full. The iOS Simulator bullet is `:75-77`. There is no iOS
content at `:72-74`.

**Fix**: `:75-77`.

---

## L5 — two Gate 1 captures, same date, incompatible, neither attributed

`.claude/plans/emulator-oracle-141.md:580-584` vs `docs/runbooks/driver-device-day.md:428-434`

| Source | Reading |
|---|---|
| plan `:580-584`, "THE RESULT, `observed` 2026-09-18" | `et=+1m51s290ms`, `enabled=true`, **no** `service:` line |
| runbook `:428-434` / report `:60-66`, `observed` 2026-09-18 | `et=+1m12s716ms`, `service: ProviderRequest[OFF]`, **no** `enabled=` |

Both are genuine — one is the planning run, one the implement pass — but nothing says so, and a reader
comparing them sees two incompatible dumps of the same gate on the same day.

**Fix**: one clause each: "(planning run)" / "(implement pass)".

---

## L6 — the report performs a subtraction its own two figures forbid

`.claude/reports/emulator-oracle-141-report.md:68-70`

> Two captures **14 s apart**: `et=+1m12s716ms` → `et=+1m27s295ms`. The elapsed-time field advanced by
> **14.6 s** across a **14 s** wall gap.

`et` is the fix's own elapsed-realtime-since-boot. An advance of 14.579 s requires a wall gap of at
least 14.579 s, so "14.6 s across a 14 s gap" is self-excluding. The wall gap was not measured — the
plan's recipe uses `sleep 12` plus command round-trips. The runbook's looser "a second capture 14 s
later" is fine; it is the report's explicit subtraction that breaks.

**Fix**: "two captures ≥14.6 s apart (`sleep 12` plus round-trips; the wall gap was not timed)".

---

## One of the agent's findings I am not carrying

It raised the `:373-374` free-space floor (`5.9 GiB + 172 MB` vs a stated `≥6 GiB`) and proposed
`≥8 GiB`. The boundary problem is real — the floor sits below the sum of the two figures in its own
sentence — but every replacement figure I could offer, and the one it offered, is invented rather than
measured, which is the defect class this review exists to catch. If it is fixed, fix it by stating the
measured post-install total, not by picking a larger round number.

---

## Revised recommendation

**Request changes.** H2 first — it can permanently retire the emulator route on a false ❌ at the
cheapest gate, and the PR documents that exact failure class elsewhere. Then H1, which leaves a second
shipped runbook recording BLOCKED on a premise this ticket falsified.

The work this PR documents is still sound and every one of its technical figures still holds under
independent re-derivation. What these findings have in common is the boundary between *what was
learned* and *what was written down for the next operator*: the learning is accurate, the run sheet is
not yet executable from itself, and the sweep stopped one file short.

Next: `piv-fix-review-findings` on `.claude/code-reviews/pr-226-review.md` — H2, H1, then M3–M6.
