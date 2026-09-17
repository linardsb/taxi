# PR #218 review — round 2

**PR**: [#218](https://github.com/linardsb/taxi/pull/218) · feat(driver): build route and corrected run sheet for #141's device day
**Head** `bd5193a` · **Base** `main` @ `b690e91` · base live tip `b690e91` — **unmoved**, so the
guarantees pass does not apply
**Round**: 2 — round 1 at `.claude/code-reviews/pr-218-review.md` (PR #219, still open), fixes report
at `.claude/reports/pr-218-review-fixes.md`. **The fix-mechanism pass is this round's centre.**
**State**: OPEN, ready for review, `mergeStateStatus: CLEAN`, `MERGEABLE` · all five checks pass
**Verdict**: **Approve** — three Mediums, six Lows. No Critical, no High, no hard-rule violation.
Every round-1 finding is closed, and two of them are closed better than prescribed. One Medium (M3)
is filed as [#220](https://github.com/linardsb/taxi/issues/220) rather than fixed here: its root
remedy contradicts this PR's own acceptance criterion, and nothing in the current tree can trigger
it.

## Summary

Round 1's nine findings are all genuinely fixed, and the fixes report's own evidence survives
re-running: its 30-assertion citation verifier is **30 PASS, exit 0** at this head (`observed`), and
its counter-check holds — the two retired-claim assertions return **1 hit each** against
`a71a6b1`'s runbook and **0 each** against this one. That is the shape this repo keeps asking for
and rarely gets: a script that fails on the unfixed tree.

Both departures from round 1's prescriptions are **correct, and F2's is better than what I asked
for**. `nudge_*` over `reason: 'no_token'` is a superset of the nudge path's four outputs — I
confirmed all four exist verbatim (`drivers.service.ts:346`, `:355`, `:369`, `:380`) — so the
absence stays live whether or not a push token ever exists. That robustness is what makes **M1**
below a Medium rather than a High: F1's fix changes what the phone does at step 1, and F2's fix
absorbs the consequence without the sheet having to know about it.

**M1** and **M2** are the same failure mode, one layer out from the one this ticket exists to retire.
**M1**: F1's fix (`eas-cli init` in §2) makes a *notification permission prompt* appear on the phone
that could not appear before, and neither step 1 nor the `:46` row that F1 rewrote says so. **M2**:
two claims in the implementation report were correct when written and are stale at head, because the
F1–F9 edits moved what they describe — the same defect `b2421ad` exists to fix, one file short.

**M3** is not about the fixes at all and would have been findable in round 1: `usesCleartextTraffic`
lives in `app.json`, which is profile-independent, while the argument for it is explicitly scoped to
an internal-distribution APK. It is filed as #220 rather than fixed, because the only real remedy
contradicts the plan's *"cleartext, **required**, not conditional"* (`:607`) and nothing in the tree
can trigger the risk today.

## Findings

### M1 — Medium · `docs/runbooks/driver-device-day.md:192` (step 1) + `:46`

**F1's fix makes a notification permission prompt appear at step 1, and the sheet does not say so —
while the row F1 rewrote still cites the code path that same fix disables.**

Round 1's F1 asked for `eas-cli init` in §2. It landed at `:108`, and it writes
`extra.eas.projectId`. That key is the guard at the top of `registerPushToken`:

```ts
// apps/driver/src/features/push/register-push-token.ts:26-32
const projectId = (Constants.expoConfig?.extra as …)?.eas?.projectId;
if (!projectId) {
  console.warn('push: no EAS projectId in app.json (A2) — no push token');
  return 'no_project';
}
```

Before the fix that return fired and the function stopped. After it, execution continues to `:41`:

```ts
const permission = await Notifications.requestPermissionsAsync();   // :41 — prompts
if (permission.status !== 'granted') return 'unavailable';          // :42
```

`POST_NOTIFICATIONS` is declared (`apps/driver/app.json:40`), so on Android 13+ that is a real
runtime dialog. `push-registrar.tsx:61-64` fires `registerPushToken` on
`state.status === 'signedIn'` — i.e. the moment step 1's sign-in completes, alongside the
background-location prompt the step *does* name. Step 1's Expect cell says only *"Grant background
location when asked"*.

The same fix left the `:46` row describing the pre-`init` world:

> `register-push-token.ts:26-31` warns and no-ops without `extra.eas.projectId`, which is fine here
> … **The cloud build links a project regardless** — `eas-cli init` is in §2.

Those two sentences are different worlds. The cited mechanism (`:26-31`) is the branch §2's own
command removes; on the prescribed path the live return is `:43-53`. The note at `:229-231` states
both paths correctly — the row does not, and the row is what a reader consults when deciding what
to set up before the day.

**Why Medium, not High.** The conclusion survives on both paths: no FCM credentials → no token
either way → `nudge_skipped/no_token`, which `nudge_*` covers. **No ❌ on 4, 5, 7 or 8 can be
produced by this**, and steps 1–3 are setup under the verdict rule at `:260-261`. What it costs is
an unexplained modal in the middle of the one step where the operator is already being asked to
grant something, in a sheet whose stated method is that every step names the signal it reads.

**Fix**: one clause in step 1's Expect cell — *"a notification-permission prompt appears too (§2's
`init` supplies the projectId, so `registerPushToken` now reaches `requestPermissionsAsync`); grant
or deny, no token is minted without FCM either way"* — and add `:43-53` beside `:26-31` in the `:46`
row so the row states the path §2 actually takes.

**Constraint pass**: clean. `grep -in "do not modify|do not edit|read-only|no changes to|frozen"`
over `.claude/plans/driver-device-day-prep.md` returns nothing that freezes step 1, the `:46` row or
the runbook's wording. The nearest hits are about the *retired* sheet (`:20`) and about the driver
suite's test count (`:857`, `:970`), which this fix does not touch. No acceptance criterion moves;
the fix is prose in a file the plan asks to be corrected.

### M2 — Medium · `.claude/reports/driver-device-day-prep-report.md:22`, `:162`, `:185-187`

**Three claims in the implementation report describe the tree as it was before `abe30bd`, in the one
PR whose thesis is retiring exactly that.** `b2421ad` swept this class through the *plan*; the
implementation report was not swept.

#### Site 1 and 2 — `231 lines` (`:22`, `:162`)

Both sites say the runbook is 231 lines. `observed` at this head:

```
git show bd5193a:docs/runbooks/driver-device-day.md | wc -l   →  289
git show a71a6b1:docs/runbooks/driver-device-day.md | wc -l   →  231
```

231 was right when the report was written. `abe30bd`'s F1–F9 edits took it to 289, and the PR body's
size table carries **289** — correctly re-derived — while the report was not. The asymmetry is the
tell: `bd5193a` is literally titled *"re-anchor the fixes report gate figures at `b2421ad`"*, so the
author re-anchored one report's figures and not the other's.

**The subject is stale, not only the digit**, which is the part `CLAUDE.md` asks for and the part a
digit-fix would miss. D8 reads:

> the runbook is 231 lines against the plan's "aim for a similar size" to `rider-a11y-walkthrough.md`'s
> 168. The excess is the four Setup subsections the plan itself mandates … plus D5's correction.

At 231 the excess being justified was 63 lines. At 289 it is 121, and the enumerated causes do not
include the 58 lines F1–F9 added. The justification is now short of its own subject by roughly the
amount the fixes contributed. `168` is correct (`wc -l docs/runbooks/rider-a11y-walkthrough.md` →
168, `observed`).

Nothing de-scopes work on this figure, which is what keeps it off High. It is still a wrong
`observed`-shaped number shipping to `main` inside the one PR whose thesis is retiring stale claims,
and it is exactly the inheritance path `CLAUDE.md` names: plan → implementation → report → PR body,
audited only at the last hop.

#### Site 3 — the pointer paragraph is not where the report says it is (`:185-187`)

This one is the sharper half, because it was written **by the sweep that was retiring stale
pointers**:

> `pr-142-review-round2.md:302` cites `driver-toggle-off-mid-ride-held.md:737-746` for the run
> sheet. **That line range is now the pointer paragraph.** Left as-is — it is a dated review, and
> the pointer it lands on leads to the runbook.

It is not. `observed` at head — the pointer paragraph (*"**The run sheet has moved to
`docs/runbooks/driver-device-day.md`**…"*) is at **`:731-736`**. `:737-746` is one line past its end
and reads:

```
(blank)
Still blocked on hardware, not on this ticket: no Android phone, no paid Apple account…
(blank)
**Step 2 — the api half still refuses (runnable now).** Automated, no device:
(blank)
```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- drivers.integration
```

The arithmetic is visible in the diff: `git diff --unified=0` shows one hunk `@@ -731,20 +731,9 @@`
— the twenty-line run-sheet block became a nine-line pointer — so the range that held the sheet now
holds the pointer *plus eleven lines of whatever followed*. A reader chasing that citation gets the
api integration command, not a signpost to the runbook.

And the decision rests on the wrong fact: *"the pointer it lands on leads to the runbook"* is the
stated reason for leaving it, and the range does not land on the pointer.

**A weaker fourth site, flagged but not counted**: `.claude/plans/driver-device-day-prep.md:245`
re-derives the owed-step table *"from the run sheet's own eight rows
(`driver-toggle-off-mid-ride-held.md:713-760`)"*. That range no longer contains eight rows — this PR
removed them. The plan is describing a past act against a then-current file and its AMENDMENTS
records the retirement, so the sentence is defensible as history; a reader following the pointer
still finds nothing.

**Fix**: `231` → `289` at `:22` and `:162`, with one clause in D8 naming the F1–F9 additions as part
of the excess; at `:185-187`, `:737-746` → `:731-736` with the sentence restated as *"that range is
now one line past the pointer paragraph"* — or drop the locator and say the citation is stale, which
is what it is. Re-derive after the commit that carries the edit, not before —
`taxi-report-restating-pr-body-figures` is the same trap, and the fixes report's own §Validation
already explains why it declines to restate a size figure at all.

### M3 — Medium · `apps/driver/app.json:69-76` — filed as [#220](https://github.com/linardsb/taxi/issues/220)

**Cleartext is enabled for every Android build this config produces; the argument for it is scoped
to one.**

The plugin entry is right and its necessity is measured in both directions — `expo prebuild`
generates no `release/AndroidManifest.xml`, so a `preview` APK inherits `main/`, where the attribute
is absent (`.claude/plans/driver-device-day-prep.md:618-626`, `observed`). That is not what this
disputes.

`app.json` is a single static config with no per-profile mechanism, so the flag applies to every
Android build it ever produces. The justification is narrower than the mechanism:

- `driver-device-day-prep.md:1019` — *"One cleartext setting on an **internal-distribution** APK is
  a smaller price than a rebuild per session."*
- `apps/driver/eas.json:7` does carry `"distribution": "internal"` — on the **profile**, which is
  not where the flag lives.

Nothing fires when that stops being true. JSON takes no comment, and the only validation `eas.json`
gets is `node -e "JSON.parse(…)"` (`:604`), which cannot see a semantic mismatch. The repo's own
standard is the anchor for why it matters later: `docs/epics/sakta-cab.architecture.md:90` records
that plain HTTP to the origin was rejected for #13 *because OTP codes and JWTs would cross in the
clear*, and the driver app sends both — though that decision is about the Cloudflare → Hetzner hop,
so it is a parallel and not the same case.

**Why Medium here and why it is filed rather than fixed.** `eas.json` defines only `preview`, and
the plan says at `:581` not to invent a `production` or `development` profile — so no non-internal
build path exists and today's blast radius is exactly the LAN-only APK #141 needs. The root remedy
(scoping the flag) needs a dynamic `app.config.ts`, which contradicts this PR's own task heading —
*"UPDATE `apps/driver/app.json` — cleartext, **required, not conditional**"* (`:607`) — and per the
constraint pass a fix that breaks the PR's acceptance criterion gets an issue, not an inline
recommendation. The cheap half is in #220: one `nchk` line binding `eas.json` to `app.json`, which
passes today and fails the day a second profile appears. It is `expected`, not run — the harness
lives in a report rather than anywhere that executes, which is part of what #220 asks for.

The `code-reviewer` agent independently reached this and rated it **Major**, on the reading that it
becomes Critical the moment a second profile exists. I agree with the trajectory and not the present
severity: the trigger is absent from the tree, and #220 is what carries it forward.

### L1 — Low · `docs/runbooks/driver-device-day.md:196` vs `:223-224`

**Step 5's Expect cell and its note give two different pass conditions, under a rule that makes the
step binary.**

The cell: *"with no `clientAt` gap > 12 s"*. The note: *"treat one gap just over 12 s as a re-read;
the ❌ is a stream that goes quiet and stays quiet."* The verdict rule at `:259`: *"Any ❌ on 4, 5, 7
or 8 means the fix did not land."*

Round 1's F6 offered the threshold **or** the restatement; the fix took both, and the two do not
describe the same condition. The cell does say *"see the two notes below"*, and the note is
unambiguous about which wins — that is why this is Low and not Medium. But the ✅/❌ column is filled
in from the cell.

Worth stating plainly, since it is the fix-mechanism question for F6: **what 12 s newly permits is a
degraded-but-running stream that 8 s would have flagged** — and that is correct, because #141's claim
is that the task *still emits*, which a 10 s cadence proves as well as a 4 s one. The widening does
not weaken the claim under test.

**Fix**: put the operative condition in the cell — *"the stream does not stop: pings still arriving
at t+90 s, no sustained `clientAt` silence (one gap just over 12 s is a re-read, not a ❌)"* — and let
the note keep the arithmetic.

### L2 — Low · `docs/runbooks/driver-device-day.md:117-118`

**`git checkout apps/driver/app.json` has no stated ordering, and one reading undoes F1's fix.**

> Afterwards either commit those two keys or `git checkout apps/driver/app.json`; do not leave them
> dirty in a checkout several sessions share.

"Afterwards" follows a sentence about `init`, inside a section whose code block runs `init` then
`build` on consecutive lines. Read as *after `init`*, the projectId is discarded and `build` stops on
the interactive create-or-link prompt — the exact failure F1 was raised to remove. §0's counterpart
is explicit and does not have this problem (`:74`: *"once the build is queued"*).

Second, and smaller: `git checkout <file>` discards **any** uncommitted change to that file,
including a concurrent session's — in a checkout `CLAUDE.md:47` says several sessions share. Stated
with its real probability rather than as a scare: `git log --all --since="30 days ago"` over both
files returns **three** commits, all feature work (`a71a6b1`, `602d5fb`, `3d2e874`), so a collision
is unlikely. The ordering ambiguity is the part worth fixing.

**Fix**: mirror §0's wording — *"once the build is queued"* — and add *"check `git diff` first; this
discards anything else uncommitted in that file."*

### L3 — Low · `docs/runbooks/driver-device-day.md:236-237`

**The nudge-family note enumerates three of the four `nudge_*` outputs.**

> The nudge family is what a broken app actually prints: the `no_token` skip in that guard today,
> and `nudge_sent`/`nudge_failed` if the push prerequisites are ever met.

`sendDueNudges` prints a **fourth**: `driver.push.nudge_skipped` with `reason: 'back_online'` at
`drivers.service.ts:343-351`, when `claimNudge` loses the race because the driver came back online.
It sits *before* the `no_token` guard the note describes.

Harmless for the check as written — `nudge_*` covers it, and step 7 reads the absence of the whole
family — which is why this is Low. It matters only if a future reader treats the enumeration as the
family's definition.

**Fix**: name it, or drop the enumeration and say *"any `driver.push.nudge_*` line"*, which step 7's
own cell already does.

### L4 — Low · `docs/runbooks/driver-device-day.md:207-214`

**Reading `clientAt` cannot distinguish a live stream from a replayed backlog, and the note is the
place that would say so.**

F3's fix is right and I would prescribe it again: `clientAt` survives a queue replay, `at` does not,
and #14's sheet names the same field for the same reason. The property that makes it right also
means a burst of *old* fixes, 4 s apart in `clientAt`, satisfies the gap check while proving nothing
about the last 90 seconds.

Mostly unreachable on this sheet's sequence, stated honestly rather than as a predicted failure:
step 2's hard gate proves the socket is up and the queue drained before step 3, so in the broken app
nothing is queued to replay. It needs a socket drop *between* steps 2 and 4 plus the task stopping at
4 — and even then a 90 s watch would see the burst end and the silence begin, so the gap check
catches it on the tail.

**Fix**, one clause, which closes it outright: *"and the newest `clientAt` should track the wall
clock — a burst of old ones 4 s apart is a backlog draining, not a live stream."*

### L5 — Low · `apps/driver/eas.json:8`

**`"pnpm": "10.33.2"` restates `package.json:4`'s `"packageManager": "pnpm@10.33.2"`, and the plan's
own invariant says not to.**

`driver-device-day-prep.md:560`: *"Pin it to **whatever `packageManager` says**, not to this digit."*
Nothing enforces it — the two agree today, and a root bump desyncs them silently. The pin's only
purpose is a builder that disables pnpm's version self-management (`:558-560`), which is precisely
the case where the stale digit would be load-bearing.

**Fix**: one line in the same `chk` harness, binding the files rather than restating the digit:

```bash
chk 'pnpm pin matches packageManager' apps/driver/eas.json 8,8 \
  "\"pnpm\": \"$(node -p "require('./package.json').packageManager.split('@')[1]")\""
```

### L6 — Low · `apps/driver/eas.json` (whole file) · `docs/runbooks/driver-device-day.md:103-110`

**Nothing in the repo can reject a bad `eas.json` key.**

The file's only validation is `node -e "JSON.parse(…)"` (`driver-device-day-prep.md:604`), which
proves it is JSON. `eas-cli` is not a repo dependency, so neither the gate nor the tree can check the
profile shape, and a rejected key surfaces on the device day at the `eas build` line — after the
travel, the phone and the stack are already set up.

The shape is plausible: the `cli` block, `distribution` and `android.buildType` are identical to
`spikes/gps-harness/eas.json`, the one config that produced a working APK; this file adds only `pnpm`
and `env`. Round 1 already recorded `pnpm` as the key it could not verify.

**Fix**: a credit-free resolving step in §2 between `init` and `build`, which surfaces both a
rejected key and a missing `extra.eas.projectId` in one call. The `code-reviewer` agent proposes
`npx eas-cli@latest config --platform android --profile preview` and says itself that the exact
command should be checked against the installed `eas-cli` first — **treat it as `expected`; I could
not run it either**, for the same reason the cloud build is unrunnable here. Verify the subcommand
name before it goes in the runbook.

## Validation

Run at head `bd5193a`, in the main checkout, `taxi-redis-1` and `taxi-db-1` confirmed Up first.

| What | Command | Result |
|---|---|---|
| Full gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | ✅ **exit 0** — `Tasks: 22 successful, 22 total`, `Cached: 0 cached, 22 total`, `Time: 1m30.405s` |
| The fixes report's citation verifier | the appendix script, extracted verbatim and run | ✅ **30 PASS, exit 0** |
| That verifier is not decoration | its two retired-claim assertions against `git show a71a6b1:docs/runbooks/driver-device-day.md` | ✅ **1 hit each on the unfixed tree, 0 each on this one** |
| CI | `gh pr checks 218` | ✅ 5/5 — `CodeQL`, `audit-diff`, `check`, `codeql`, `ready` |

Per-package counts, all from that one run and **all identical to the PR body's**, which is the right
result for a diff that touches no test and no compiled source:

| Package | Tests | Suites / files |
|---|---|---|
| `@taxi/api` | 733 passed | 77 passed |
| `@taxi/driver` | 218 passed | 41 passed |
| `@taxi/rider` | 140 passed | 29 passed |
| `@taxi/shared` | 231 passed | 24 passed |
| `@taxi/dispatch` | 224 passed | 27 passed |
| `@taxi/db` | 17 passed | 3 passed |

This run is at `bd5193a`, the true head — the PR body's figures are `observed` at `b2421ad` with the
gate-neutrality of `bd5193a` argued rather than re-run. **That argument checks out**: `bd5193a`
touches only `.claude/reports/pr-218-review-fixes.md` (`git show --stat`), and `turbo.json` declares
no `inputs` or `globalDependencies` reaching `.claude/**`, which sits outside every package
directory. The re-run makes the point moot anyway.

Noise worth naming so the next reviewer does not chase it: the `@taxi/api` log carries repeated
`[ioredis] Unhandled error event: ReplyError: NOAUTH Authentication required`. That is not this PR.
`taxi-redis-1` answers `PONG` unauthenticated on 6381; the NOAUTH comes from whatever holds
`localhost:6379` on this machine (memory `taxi-local-port-conflicts`). The gate is green through it.

## Round 1's findings — closed, and how each fix was probed

| # | Sev | Closed? | What I checked beyond the repro |
|---|---|---|---|
| F1 | High | ✅ | §2 runs `init` and states the tracked-file mutation. **What it newly permits → M1** (a notification prompt at step 1) and **L2** (the `git checkout` ordering). The `:46` row half is incomplete → M1. |
| F2 | Medium | ✅ **better than prescribed** | All four `nudge_*` strings exist verbatim (`:346`, `:355`, `:369`, `:380`). The superset holds if a token ever exists, which `reason: 'no_token'` would not — and it is what absorbs M1. Enumeration is one short → **L3**. |
| F3 | Medium | ✅ | `clientAt`/`at` both present at `driver-location.service.ts:76-82`, `at` from the server clock at `:54`. What the field newly permits → **L4**. |
| F4 | Medium | ✅ | PR body now prints the env prefix, and I reproduced all six packages' counts at head under it. |
| F5 | Medium | ✅ **departure argued and correct** | The `eas env:create` alternative is the one the plan weighed and rejected at `:566-577` (verified, and the range is the corrected one). Dropping the `env` block before the EAS-side variable exists does yield a dead APK — `apiUrl()` throws at `config.ts:16-18`. The missing instruction was the gap, and it landed at `:73-84`. |
| F6 | Medium | ✅ | 12 s is labelled `derived` with the arithmetic and the condition. Cell/note mismatch → **L1**. |
| F7 | Low | ✅ | `fix-throttle.ts:9` and `location-options.ts:20` now cited separately; both resolve. |
| F8 | Low | ✅ | `:28-37` with `body` at `:35`; both resolve. |
| F9 | Low | ✅ | EN renderings added, and the mechanism the fix newly cites is real: `apps/driver/src/features/i18n/use-t.ts:14` calls `deviceLanguage()`, which reads `getLocales()` from `expo-localization` (`device-language.ts:2`), falling back to `lv`. |

`b2421ad`'s three plan-ref corrections all resolve (`:566-577` DECIDED bullet, `:327-333` C2 box,
`:290-294` C1 box — read, not just verifier-asserted). The mirror sweep round 2 owns —
refs *into* the runbook by line number, whose line count moved +58 in the same commit — is clean:
`grep -rn "driver-device-day\.md:[0-9]" --include='*.md' .` returns **zero hits**. Nothing cites it
by line.

The **sibling** files are where that sweep pays: `grep -rn
"driver-toggle-off-mid-ride-held\(-report\)\?\.md:[0-9]"` returns nine hits, and the sibling plan is
`+23 −20` across two hunks. Seven resolve or sit in dated review artifacts the implementation report
already judged individually (`:120-132`, and D3's reasoning in the report is right). The two that do
not are M2's site 3 and its weaker fourth — both in files this PR ships.

The deep pass on the non-prose diff went to the **`code-reviewer` agent**, scoped to
`apps/driver/{app.json,eas.json,package.json}`, the binary and the lockfile, since 2218 of 2299 added
lines are exempt PIV prose. **Every one of its findings was re-run here before entering this report**
(memory `taxi-review-payoffs-are-claims`): its cleartext finding became M3 at my severity rather than
its Major, its `pnpm`-pin and validation-gap findings became L5 and L6 verbatim after checking
`:560` and `:604`, and its `eas-build-post-install` and lockfile conclusions were re-derived
independently — the lockfile one by a key-set diff, because the raw `+49 −11` contradicts it on
sight. Its proposed `eas-cli config` command is carried as `expected` and flagged, not adopted.

## Claims re-derived, not inherited

- **Size table.** `git diff --numstat origin/main..HEAD` sums to 2299 over 13 files, matching
  `--shortstat` (`13 files changed, 2299 insertions(+), 34 deletions(-)`), and every bucket in the
  PR body reconciles: plan 1401, runbook 289, implementation report 198, fixes report 302, siblings
  30 (= 1 + 23 + 6), `apps/driver` config 29 (= 9 + 17 + 3), lock 49, `CLAUDE.md` 1.
- **The icon is 700 → 691.** `git cat-file -s` on both blobs, `observed`.
- **`npx eas` really is the wrong package.** `npm view eas version` → `0.1.0`; `npm view eas-cli
  version` → `24.7.0`. Both figures in the runbook are exact, `observed` today.
- **The build figures trace to runs.** `entry-*.hbc (3.4MB)` and `PREBUILD_EXIT=0` are rows 6 and the
  L4.8 line of the implementation report's reproduction tables, not free-floating. The EAS cloud
  build is labelled `expected`, never `observed`, at every site I found it.
- **D5's honesty holds.** `expo install --check` is stated as not clean with the comparison method
  named (all 14 pinned identically on `main`, `expo-build-properties` absent from the list).
- **`nudge_*` is genuinely the superset.** `grep -rhon "driver\.push\.[a-z_]*"` over `services/api/src`
  returns exactly `nudge_failed`, `nudge_sent`, `nudge_skipped`, `request_failed`, `stub_sent`,
  `token_cleared`, `token_registered`. The three the sheet names are the nudge path's; `stub_sent` is
  reachable only through `push.send`.
- **All four re-runnable rows of the retired-claim sweep reproduce exactly** — the row the fixes
  report says was wrong in its first draft. `observed` at this head: `stub_sent` **12** (runbook 5 +
  plan 7, the other four files 0); the 8 s threshold **runbook 0, plan 2**; `eas init` **runbook 0,
  plan 5, report 1**; `192.168` **runbook 1, plan 6, `CLAUDE.md` 0**. Every number in that table is
  the number the command returns.
- **"Exactly one package added, 0 removed" survives, and the raw diff makes it look otherwise.**
  `.claude/reports/driver-device-day-prep-report.md:190` claims it; `git diff -- pnpm-lock.yaml` is
  `+49 −11` and visibly re-keys `eslint-import-resolver-typescript`, `eslint-plugin-import` and
  `eslint-module-utils` peer chains, which reads as several packages moving. It is not: diffing the
  distinct `name@version` key sets between the two blobs gives **added `expo-build-properties@57.0.20`,
  removed nothing, 1087 → 1088** (`observed`). The rest is pnpm rewriting peer-dependency keys on the
  same install. The claim is exact at the level it is made.
- **Round 1's one self-declared unverified item can be retired without `eas-cli`.** It flagged that
  whether `pnpm` is a real `eas.json` profile key *"was not verified"*. It does not matter which way
  it goes: `package.json:4` declares `"packageManager": "pnpm@10.33.2"`, which is what actually fixed
  the version in the plan's own reproduction (`npx --yes pnpm@12 install --frozen-lockfile` →
  `Done in 16.8s using pnpm v10.33.2`, `:1143`, `:1207`). The key is redundant whether EAS honours it
  or ignores it, and the plan says as much at `:558-560`. What remains is L5's binding problem, not a
  correctness one.
- **The `eas-build-post-install` hook is sufficient, which is not self-evident.** Three ways it could
  have been incomplete, none of which apply: `@taxi/shared`'s only workspace dependency is
  `@taxi/config`, whose `package.json` has **no `scripts` block at all** and which ships committed
  `tsconfig/*.json` + `eslint/*.mjs`; `packages/shared/src` holds no non-TS asset `tsc` would fail to
  emit; and `apps/driver` depends on no other workspace package. One
  `pnpm --filter @taxi/shared build` covers the path, and `dist/` is the only gitignored artifact in
  it. (Confirmed independently by the `code-reviewer` agent and re-checked here.)

## What is good

- **The verifier is the best artifact in this PR.** Thirty assertions, inline so the next reviewer
  re-runs it without a one-off script entering the tree, and — the part that matters — it **fails on
  the unfixed tree**. Almost every "I checked the citations" claim in this repo's history is a
  feeling; this one is a command.
- **F2's departure is a genuine improvement on my prescription**, and the report argues it rather
  than asserting it. `reason: 'no_token'` would have gone stale the moment F1's own fix plus FCM
  credentials produced a token — and F1's fix is in the same commit.
- **F5's departure points at the decision instead of silently contradicting it.** A plan bullet that
  weighed and rejected an alternative is a constraint; the fix treated it as one, completed the
  missing day-0 instruction, and said which half changed.
- **The fixes report anticipated the mechanism question on F1** — it names its own new failure mode
  (a dirty tracked file), covers the `no_project`/`unavailable` second-order path, and closes it in
  the same paragraph. It missed the permission prompt (M1), but it was looking.
- **The retired-claim sweep counts are stated as re-observed after the last edit**, with the
  admission that the first draft quoted pre-edit numbers and was wrong in four of five rows. That
  admission is worth more than the table.
- **`b2421ad` exists at all.** Catching that the F1–F9 edits shifted the plan line numbers the same
  commit then cited — the inherited-figure defect committed by the commit retiring it — and fixing it
  in a separate, named commit is the behaviour #87 and #107 cost the project. M2 is the one instance
  of that sweep stopping one file short.

## Recommendation

**Approve.** No Critical, no High, no hard-rule violation: no money, no ride-status write, no
contract duplication, no seam bypass, `packages/shared` untouched, and no `.ts`/`.tsx` under `src/`
in the whole diff — verified against the numstat, so the PR's own non-goal holds.

None of the three Mediums gates the merge. **M1** cannot produce a false verdict on steps 4/5/7/8,
because F2's own fix absorbs it. **M2** is three stale locators in a PIV artifact; nothing de-scopes
work on any of them, though the `:185-187` one leaves a citation pointing at the wrong block. **M3**
has no trigger in the tree and is tracked at
[#220](https://github.com/linardsb/taxi/issues/220) — merging this PR does not make it worse, and
adding a second EAS build profile is what would.

M1, M2 and the six Lows are each a line or a clause. Fix them in one pass if you are touching the
branch anyway; land it as-is if you are not, and fold M2 into whatever next moves the runbook's line
count.

One thing is still owed to a human and no agent can supply it, unchanged from the PR's own note:
whether to run `eas-cli init` and commit `extra.eas.projectId` + `owner` before the day, or leave it
to the day. The runbook works either way, and M1's fix is the same clause under both.

**#141 correctly stays open.** The device run is still owed, the Result table ships `not yet run` /
`BLOCKED`, and nothing here claims otherwise.
