# PR #233 review — round 1

**Head** `a25fa49` · **Base** `main` @ `f7446c3` · **Reviewed** 2026-09-20 · **Round** 1 (no prior report)

`spike(driver): Gates 2 and 3 pass — the emulator answers #141's owed claim (#224)` — 6 files,
+557 −73. Shipped source: three 6-line locale JSON files. Everything else is a test and two documents.

## Verdict: request changes

No Critical, no High. **Five Medium, seven Low.** The fix is correct — I re-derived the mechanism from
the installed library source rather than from the docblock, and proved the test red-on-main /
green-on-fix myself.

**M1 is why this is request-changes rather than approve-with-comments.** `apps/rider/locales/*.json`
carries the identical unscoped key, `apps/rider/app.json` declares the identical `expo.locales` map,
and the new guard test is driver-only. So `#232`'s *mechanism* is fixed in one of the two apps that
has it, while the runbook heads the section **"The build blocker — cleared"**. That is a build credit
waiting to be spent.

M2 is the second reason: nine of the ten runbook anchors the tracked plan cites no longer resolve,
and the plan's own VALIDATE prescribes exactly that check.

Both are cheap. Neither argues the approach is wrong.

## The fix — re-derived from source, not from the docblock

`getResolvedLocalesAsync` at `node_modules/@expo/config-plugins/build/utils/locales.js:39-68`:

```js
const { android, ios, ...rest } = { android: {}, ios: {}, ...locale };
// android branch: locales[lang] = { ...rest, ...android }
// ios     branch: locales[lang] = { ...rest, ...otherEntries }   // otherEntries = ios − 'Localizable.strings'
```

Top-level keys are shared; `ios`/`android` sub-objects are platform-exclusive. Keys under `ios` reach
`InfoPlist.strings` and cannot reach `values-b+<lang>/strings.xml`. The docblock's account is exact. ✅

It also builds fresh objects in every branch and **does not mutate its input**, so the Android and iOS
resolutions in cases 2 and 3 cannot contaminate each other — a real hazard the test structure avoids.

`android/Locales.js:66` writes only to `values-b+${lang}/strings.xml` and never to a default
`values/strings.xml`, which is the load-bearing half of the docblock's `ExtraTranslation` explanation. ✅

**Version alignment, which is what the test's value turns on.** `.npmrc` sets `node-linker=hoisted`
("Expo requires hoisted node_modules in pnpm monorepos"), so `apps/driver` and `@expo/prebuild-config`
resolve the *same* copy — both `node_modules/@expo/config-plugins@57.0.9`, `observed` via
`require.resolve` from each. The test exercises the exact code `expo prebuild` runs. ✅

**Bidirectionality, `observed` by me.** I replaced the three locale files with `origin/main`'s, ran the
suite, and restored:

| Locale files | Result |
|---|---|
| this branch | 4 passed / 4 |
| `origin/main`'s | **1 failed**, 3 passed — the failure is `resolves no Android string`, the intended one |

## Validation

| Check | Where | Result |
|---|---|---|
| CI `check` | run `35397560689`, anchored to `a25fa49` via `gh api …/commits/a25fa49/check-runs` | ✅ success, 3 m 32 s |
| CI `audit-diff` · `codeql` · `CodeQL` · `ready` | same run, same sha | ✅ all success |
| `@taxi/driver` typecheck + lint + test | re-run by me, `observed` this review, `--force` | ✅ 4/4 tasks, **44 suites / 249 tests**, 15.256 s |
| `src/locales-config.test.ts` alone | re-run by me | ✅ 4 passed / 4 |
| Gate task count | `turbo --dry=json` | ✅ **22** real, 6 `<NONEXISTENT>` — the body's `22 successful, 22 total` |
| `mergeStateStatus` | `gh pr view` | `CLEAN` |
| Base drift | `git rev-parse origin/main` after `git fetch` → `f7446c3` = recorded `baseRefOid` | ✅ base has not moved; guarantees pass not triggered |
| Closing refs | `closingIssuesReferences` | ✅ exactly **#224** and **#232** — #141, #4 and #14 are linked and do **not** close |

No full local gate. CI ran the whole one at exactly this head with `REDIS_TEST_URL` set (`ci.yml:44`),
so the 39 gated tests ran rather than skipped — which is what the body's `77 of 77 suites` depends on,
and it is sound. 19 `claude` processes share this checkout and `global-setup` drops the shared test DB;
a third integration run would re-derive an established fact at the cost of possibly killing a live
session's suite.

## The numbers pass

Every figure below I checked against the thing that produced it, not against another document.

| Claim | Source | Re-derived |
|---|---|---|
| `git diff f4d37e4..a25fa49 --stat` touches only the runbook and the report | PR body's head-independence argument | ✅ exactly those two paths — the argument is sound, and `f4d37e4` does carry all four gate-readable files |
| Gate task count **22** | PR body | ✅ 22 real / 28 total |
| `@taxi/driver` 44 suites / 249 tests | PR body | ✅ re-run, exact match |
| 39 Redis-gated tests ran, so 77 of 77 suites | PR body | ✅ `ci.yml:44` sets `REDIS_TEST_URL`; totals match `CLAUDE.md`'s own observation (39 + 694 = 733; 2 + 75 = 77) |
| 6 fatal `ExtraTranslation` = 2 keys × 3 locales | PR body, test docblock | ✅ arithmetic, and the key count matches the diff |
| `presence-state.ts:377` is the **only** writer of the banner kind | PR body | ✅ `grep` over non-test driver source returns exactly one `banner: { kind: 'driver_on_ride' }`, at `:377` — the absolute claim holds |
| Guard is `code === 'driver_on_ride' && status === 'offline' && state.streaming` | PR body | ✅ `presence-state.ts:348-350`, exact |
| Effects are `persist_intent online` + `kick_uploader`, no teardown | PR body | ✅ `:380-381`, and no `stop_uploader` in the branch |
| D1 — the api's no-`GOOGLE_MAPS_API_KEY` message, verbatim | runbook step 3 | ✅ `stub-maps.provider.ts:34`, exact |
| D1 — the form reads «Adrešu meklēšana nedarbojas» | runbook step 3 | ✅ `console.address_failed` in the shared LV catalog |
| `Idempotency-Key` must be a uuid, else a bare `Invalid uuid` | runbook step 3 | ✅ `idempotency.ts:21` is `z.string().uuid()` — and that is zod's own message |
| D2 — `complete` is `@Roles('driver')` | runbook step 7 | ✅ `ride-lifecycle.controller.ts:68-69`, exact |
| D3 — `timeOf` formats hour and minute only | runbook step 6 | ✅ `tracking-map.tsx:178-182`, `{ hour: '2-digit', minute: '2-digit' }`; the «position updated» line is `:334-335`, also exact |
| `MIN_FIX_INTERVAL_MS = 4_000` | runbook, report | ✅ `fix-throttle.ts:9` |
| Both deferral knobs zeroed | runbook | ✅ `location-options.ts:21-22`; `timeInterval: 4000` at `:19` |
| `findOrCreate` applies `role` only to a new row | runbook agent-run note | ✅ `auth.repository.ts:47-50` |
| Commission `403 − floor(403 × 0.15) = 343`, `343/403 = 85.1%` → card reads 85% | report `:169-172` | ✅ and it credits `resolveCommissionPct()`, not a literal — the `CLAUDE.md` rule is honoured |
| Gate 2 — 14 pings, gaps 4.2–4.5 s | report `:117-118` → PR body | ✅ 13 listed gaps for 14 pings; Σ = 55.0 s inside a 60 s window |
| Gate 3 — 21 pings, every gap 4.2 s | report `:134-135` → PR body | ✅ `4.2 × 20` for 21 pings; 84 s inside 90 s |
| Step 7 — 31 pings in 130 s | report `:163` → PR body | ✅ `derived` consistency: 30 × 4.2 = 126 s ≤ 130 s |

**What I could not re-derive, and am not disputing.** Each is labelled `observed` with an artifact a
human can open: the EAS durations (1199 s green `bcd04c21…` vs the 1182 s `edcc579b…` — but see L5),
the 110 069 070-byte APK and its four `lib/` ABIs, the `2m3.161s` gate wall time, every raw ping
capture, and the 409 `driver_on_ride` probe on ride `34708cf9`. The **internal arithmetic** of the
ping figures is the only handle anyone has on them, and it holds in every case but one — see L1.

Step 4's ordering claim deserves saying plainly: it is the PR's load-bearing claim, and the one most
PRs would have left resting on a screenshot of a banner. Pinning it on both sides — a direct 409 from
the api, plus a proof that the banner kind is reachable from nothing else — is exactly right, and
every link in that chain re-derived.

## Issues

### M1 — Medium · `apps/rider/locales/{lv,ru,en}.json:2`

**The same defect is live and unfixed in the rider app.** All three rider locale files carry
`NSLocationWhenInUseUsageDescription` at the **top level** — the exact shape this PR fixes — and
`apps/rider/app.json` declares the identical `expo.locales` map pointing at them, `observed`:

```json
{ "NSLocationWhenInUseUsageDescription": "Sakta Cab uses your location to suggest a pickup point." }
```

Per the same `locales.js:39-68` path, a top-level key lands in the Android `localesMap`, so the
rider's first `:app:lintVitalRelease` fails with **3 fatal `ExtraTranslation` errors** (1 key × 3
locales) for exactly the reason the driver's failed with 6.

`apps/rider` has no `eas.json`, so it is not on a build path today — which is what caps this below
High. Three things make it worth fixing here rather than on a build credit:

- The fix is app-scoped and the guard test is driver-only (`apps/driver/src/locales-config.test.ts`),
  so nothing in the repo will catch it. The gate compiles no Android resources; that is the PR's own
  argument.
- `docs/runbooks/driver-device-day.md:593` heads the section **"The build blocker — cleared"**, which
  reads repo-wide, and `#232` is closed by this PR.
- This repo's own record says this class costs a ~20-minute EAS build to find.

iOS behaviour is preserved by the move exactly as it is for the driver: `apps/rider/app.json:13`
declares the matching `NSLocationWhenInUseUsageDescription` in `ios.infoPlist`, so the localized
string is live, not inert.

**The scope is bounded — rider is the only one left.** I enumerated every `app.json` in the tree:
`apps/driver` and `apps/rider` are the only two declaring an `expo.locales` map, and
`spikes/gps-harness/app.json` has none, `observed`. So this is one 3-line fix, not an open-ended sweep.

**Fix.** Wrap the key in `{"ios": {…}}` in all three `apps/rider/locales/*.json`. Then either copy
the guard test into `apps/rider/src/`, or say plainly in the runbook and in `#232`'s closing comment
that the guard covers `apps/driver` only.

Widening this PR to a second app is Linards' call. If the answer is no, the alternative that does not
leave a trap is a follow-up issue referenced from the runbook — not silence.

### M2 — Medium · `.claude/plans/emulator-oracle-141.md` (nine refs) + `docs/runbooks/driver-device-day.md`

**Nine of the ten runbook anchors the plan cites no longer resolve.** The plan is tracked in git and
is what the next #141 pass reads.

The Result table hunk is `@@ -14,25 +14,45 @@` — **+20 lines** — so every anchor below it shifted by
exactly +20, `observed` by matching each anchor's text across `origin/main` and `a25fa49`:

| Plan cites | Is now | Text at the cited line today |
|---|---|---|
| `:13` `## Result` | `:13` ✅ | unchanged — the only survivor |
| `:35` | reflowed into the "When a phone exists" bullet | `that the owed claim now has emulator evidence…` |
| `:37` `## What this day does NOT need` | `:57` | `prove here*, and the run's command-level record is in` |
| `:86` `### 1 — Boot the stack` | `:106` | a sentence about `getifaddr en0` |
| `:222` step 5's row | `:242` | blank line |
| `:233` `**Which timestamp, and why 12 s.**` | `:253` | a sentence about `setLogLevels` |
| `:246` the 12 s derivation | `:266` | blank line |
| `:282` `**Why step 7's window is 2 minutes.**` | `:302` | the word `column` |
| `:290` `## Verdict` | `:310` | a sentence about `driver.push.nudge_*` |
| `:311` `## Also on this day` | `:331` | blank |

The plan names this check in two places and neither was discharged:

- `:819-824` — *"Rewrite such a claim **at a constant line count** — 4 lines stay 4 lines — then
  re-read `:35`, `:37`, `:86`, `:222`, `:233`, `:246`, `:282`, `:290`, `:311` and confirm each still
  resolves to its original text."*
- `:827-828` — T11's VALIDATE: *"`grep -rn "driver-device-day.md:" .claude/ docs/ | wc -l` # then
  spot-check the refs still resolve"*.

This is the same defect class PR #218's review round 1 spent three findings on, and that the plan
wrote the constraint to prevent.

**Two separate things are wrong**, and documenting one would not close the other:

1. **The constant-line-count constraint was exceeded** (+20, not 0) and the deviation is
   **undocumented** — `grep -inE "deviat|constant line count|line count|shifted|anchor"` returns
   nothing in either `.claude/reports/emulator-gates-224-report.md` or the PR body. Under this
   skill's own rule a *documented* deviation is an intentional decision and not an issue; an
   undocumented one is a finding. Exceeding it was arguably right — the Result table genuinely had
   more to say once the run finished — so the fix is a deviation note, not a rewrite.
2. **Nine anchors are stale regardless.** Add +20 to each; `:35` needs re-pointing by text, since
   that sentence moved into a different bullet.

**Fix.** Bump the nine refs (+20, except `:13` and `:35`), and add one deviation line to the report
saying the Result table grew 25 → 45 lines and why. Also update the plan's own in-body citations that
inherit the shift: `:174` (`:86-88` → `:106-108`), `:178` and `:571` (`:246` → `:266`), `:359`
(`:37-52` → `:57-72`). `:186`'s `:13-22` is unaffected.

**Explicitly out of scope, so the next reader does not re-open this.** `pr-218-review.md`,
`pr-218-review-round2.md`, `pr-219-review.md` and `pr-226-review-fixes.md` also carry now-shifted
runbook line numbers (~20 hits). Those are head-anchored records of merged PRs —
`pr-226-review-fixes.md:40` even writes *"(reviewed head) → `:468` (now)"* — and re-anchoring a
historical record just re-stales it on the next edit. Leave them.

### M3 — Medium · `apps/driver/src/locales-config.test.ts:75-88`

**The iOS case does not assert *which* keys survive, and one empty locale is worse than it looks.**

The case is named *"still resolves the same iOS keys for every locale — the scoping kept them"* but
asserts only that the key set is non-empty and identical across the three locales. Rename or typo
both `NSLocation*` keys consistently in all three files and it stays green — while the iOS permission
dialogs lose their localized purpose strings in every locale, and the Android case stays green too,
because the keys are still under `ios`.

The amplifier, `observed` at `node_modules/@expo/config-plugins/build/ios/Locales.js:62`:

```js
if (Object.entries(localizationObj).length === 0) return project;
```

**`return`, not `continue`.** One empty iOS locale stops `InfoPlist.strings` being written for every
locale after it in iteration order — so the blast radius of an unnoticed empty resolution is all
remaining locales, not just its own.

**Fix.** Assert the resolved iOS key set equals the `NSLocation*` keys `app.json` declares in
`expo.ios.infoPlist` (`apps/driver/app.json:16-17` — exactly those two today, so it passes as-is).
That is the real contract: a localized `InfoPlist.strings` key does nothing unless the matching
`Info.plist` key exists, and it pins the `app.json` ↔ `locales/*.json` pair against silent drift. The
cheaper version is a literal `expect(keySets[0]).toEqual([...])`.

### M4 — Medium · `apps/driver/src/locales-config.test.ts:56`, `:95`

**`locales as unknown as Record<string, string>` asserts the values are strings when they are
objects, and suppresses exactly the drift this test exists to catch.**

The cast is also unnecessary. `locales.d.ts:12` declares the parameter as
`ExpoConfigLocales = NonNullable<ExpoConfig['locales']>`, which `@expo/config-types` defines as
`{ [k: string]: string | { [k: string]: any } }` — the inline-object form is first-class and the JSON
module object is structurally assignable without any cast, `observed`.

The cost is real: `as unknown as` suppresses *any* future signature change. If Expo narrows
`ExpoConfigLocales` to paths only, this keeps compiling and the test silently exercises a path the
library no longer supports — the opposite of what a version-drift guard should do. The callee's very
next act is `if (typeof localeJsonPath === 'string')` (`locales.js:77`), taking the other branch.

**Fix.** Drop both casts; if TS objects, `import type { ExpoConfigLocales }` and annotate. Leave
`:46-47`'s `appJson as { expo?: … }` narrowing alone — that matches `build-config.test.ts:121`.

**A related upgrade the docblock has earned.** `:40-42` justifies the inline form by citing an
implementation detail (*"`getLocales` returns a non-string entry as-is"*, whose source comment reads
"In the off chance that someone defined the locales json in the config"). The `.d.ts` makes it a
typed contract, and `@expo/config-types`' own doc comment states *"Platform-specific locale strings
should be nested under `ios` and `android` keys."* The fix is documented public API, not a trick —
worth saying, because it is a stronger footing than the one claimed.

### M5 — Medium · `docs/runbooks/driver-device-day.md:532` + `.claude/plans/emulator-oracle-141.md:827`

**The plan's `Expect`-count tripwire is now broken, and reads as a false pass rather than failing loudly.**

T11's VALIDATE is `grep -c "Expect" docs/runbooks/driver-device-day.md   # must not grow`. `observed`:
**main 2, head 3.** The guard is red.

The guard's *intent* is not violated — I checked every hit. The third is prose at `:532` (*"Every
§Steps Expect cell that quotes LV…"*), not a fourth copy of the run sheet; the single table header is
still at `:236`. So this is a false positive.

That is the problem. The next pass that genuinely adds an Expect cell sees 3 → 4, finds this
false-positive note, and waves it through — the tripwire the plan set against *"the exact defect PR
#218 shipped to close"* (plan `:808-810`) is now dead.

**Fix.** Either reword `:532` off the bare word (*"Every §Steps expectation cell…"*), or tighten the
check to count the table column: `grep -c '| Expect |'`. Then correct the plan's baseline.

### L1 — Low · `.claude/reports/emulator-gates-224-report.md:197`

**22 pings give 21 gaps, and 22 gaps of 4.2 s do not fit a 90 s window.**

`:162` records step 5 as *"22 `ping_accepted` in 90 s, every `clientAt` gap 4.2 s"* — correct, and
21 × 4.2 = 88.2 s fits. `:197` then calls the same evidence *"step 5's **22 gaps** of 4.2 s"*, which
is 92.4 s and cannot have happened inside the stated window.

An off-by-one in a closing sentence, and the sentence it closes is the load-bearing one (the step 4
ordering proof). Everywhere else the report's gap lists are exact — 13 gaps for 14 pings, `4.2 × 20`
for 21 — so this reads as a slip, not a miscount.

**Fix.** `:197` → *"step 5's 21 gaps of 4.2 s"*.

### L2 — Low · `apps/driver/src/locales-config.test.ts:61-64`

**The precondition case compares locale *keys* but not the *paths*, so the test can drift onto files
`prebuild` no longer reads.** `app.json` maps `lv`/`ru`/`en` to `./locales/{lv,ru,en}.json`,
`observed` — which is what the test imports. But it asserts only

```ts
expect(Object.keys(localeMap ?? {}).sort()).toEqual(Object.keys(locales).sort());
```

Repoint `"lv"` at a different file and the key set is still `['en','lv','ru']`: the test keeps passing
against a file the build ignores. The case is titled *"the precondition the rest reads"* and the
docblock at `:49` claims *"Same three files `app.json` points at"* — nothing checks it.

Otherwise the surface is well covered: a later top-level key is caught (`{...rest}` reaches Android),
an `android` sub-object is caught, and a fourth locale in `app.json` without a matching import fails
this same case.

**Fix.** `expect(Object.values(localeMap ?? {})).toEqual(['./locales/lv.json', './locales/ru.json', './locales/en.json'])`.

### L3 — Low · `apps/driver/src/locales-config.test.ts:1`

**The test imports a package neither `apps/driver/package.json` nor the root declares.**
`@expo/config-plugins` is a transitive of `expo`, reachable only because `.npmrc` sets
`node-linker=hoisted`. The deep `/build/utils/locales` path is also outside the package's `exports`
contract and so exempt from its semver promise.

The sibling `native-module-pins.test.ts:76-86` names its own hoisted-layout dependency and states
what it leaves uncovered. This file inherits the same fragility and says nothing.

**Fix — and this is the one place I differ from the obvious remedy.** Do **not** add
`@expo/config-plugins` to `apps/driver/devDependencies`. Resolving the same hoisted copy
`expo prebuild` loads is precisely what gives this guard its value; a declared version is free to
diverge from the one prebuild actually uses, which would make the test pass while the build fails —
the exact failure mode it was written against. Two sentences in the existing docblock are the right
fix: the import is deliberately undeclared so it resolves the hoisted copy, and the deep path is the
accepted cost of testing the real resolver.

### L4 — Low · `apps/driver/src/locales-config.test.ts:61,67,75,90`

**The four new cases carry none of the `(expected)` / `(edge)` / `(failure)` suffixes both siblings
use without exception** — `build-config.test.ts` 11 of 11, `native-module-pins.test.ts` 16 of 16,
`observed`. That convention is what makes the repo's "≥1 expected + 1 edge + 1 failure" rule
mechanically auditable; without it, whether case 3 is edge or expected is a judgement call.

**Fix.** `:61` `(expected)`, `:67` `(expected)`, `:75` `(edge)`, `:90` `(failure)`.

### L5 — Low · `.claude/reports/emulator-gates-224-report.md:24` vs `:61`, and `docs/runbooks/driver-device-day.md:614`

**The control build is described two different ways, and the 1182 s ÷ 1199 s pairing rests on it.**

- `:24` — *"`edcc579b-…` (**PR #227's verification build**)"* — a different branch's tree.
- `:61` — *"`edcc579b-…`, **same tree minus #232's fix**"*, and the runbook `:614` calls it *"the
  control"*.

The record names `bcd04c21`'s commit (`f4d37e4`) and never names `edcc579b`'s, so "same tree minus one
fix" cannot be checked from the documents that make it. Plausible — `#227` landed the pins that are
now on `main` — but not established.

Low rather than Medium because the mechanism claim does not depend on it: the local
`expo prebuild --clean` repro at report `:35-38` is properly tagged `observed` and isolates the fix on
its own.

**Fix.** Record `edcc579b`'s commit alongside `bcd04c21`'s, or drop "same tree minus" and "control"
for "the previous build".

### L6 — Low · `apps/driver/src/locales-config.test.ts:16-18`

> "…and writes **no default** `values/strings.xml` entry for any of them — the default file carries
> only `app_name`."

The first half is a property of the mechanism and is correct — `android/Locales.js:66` writes only to
`values-b+${lang}/strings.xml`, `observed`. The trailing clause is an app-state-dependent observation
of *this* prebuild output, stated as part of the mechanism and carrying no provenance tag, while the
same docblock tags the build failure `observed` two sentences earlier. It stops being true the moment
a `google-services.json`, a splash config or an RTL option adds a default string.

I did not re-run `expo prebuild` to check the clause itself; the mechanism half I did verify.

**Fix.** Tag it (`observed` 2026-09-18, the prebuild at report `:35-38`) or drop it — the load-bearing
half stands alone.

### L7 — Low · `docs/runbooks/driver-device-day.md:21,25`

**Step 1 gets an unqualified ✅ on the most-scanned surface.** The grid at `:25` and the Outcome row at
`:21` (*"All eight steps ✅ on an emulator"*) mark step 1 passed, but its Expect cell (`:238`) requires
granting background location *and* the notification prompt **when asked** — and `:27-32` records both
as pre-granted with `pm grant` before first launch, so neither prompt was exercised.

The divergence note is honest, specific, and sits directly under the grid, which is most of the
mitigation already. The grid itself carries no marker.

**Fix.** `✅*` in step 1's cell, footnoted to the paragraph already there.

Same theme, one sentence away: `:500` says *"run §Steps rows **2 through 8**"* — seven rows — and
`:502` then says *"**All eight** ran this way"*. Step 1 did run; it just did not run via that
instruction, because it is the sign-in the emulator setup already covered. Say "all eight steps
passed, step 1 by the setup above" or rephrase `:500`'s range.

## What's good

- **The diagnosis is proven, not inferred from a build log.** Reproduced locally with
  `expo prebuild --clean` on `f7446c3` before any fix (report `:35-38`), and the test run red-on-main /
  green-on-fix. I reproduced the second half independently and it holds.
- **The fix is the smallest one that works** — six changed lines of shipped source, no plugin, no
  config toggle, no `withStringsXml` escape hatch. The alternatives are named and correctly rejected.
- **The test pins a condition nothing else in the repo could catch**, and says why: the gate compiles
  no Android resources and `expo install --check` inspects dependency versions, so the only prior
  detector was a 1182-second build and a burnt credit. It sits beside `#220`'s `build-config.test.ts`
  and `#225`'s `native-module-pins.test.ts` — the right shelf, correctly outside a feature slice.
- **The invariant is deliberately stronger than the defect, and says so.** Asserting *no* Android key
  resolves turns a future Android-facing string into a failing test that prompts a mechanism choice
  instead of a fatal lint six minutes into a build. The red arrives with its own instructions.
- **The failure case uses a synthetic `xx` locale, not the real files** — so it keeps testing the
  mechanism rather than going stale when the locale content changes.
- **`expo.locales` really is the only writer of translated Android strings here.** I checked the other
  candidate: `expo-localization` is declared bare at `app.json:66` and its plugin writes only RTL
  options, via the default `values/`, only when those options are set. Within `apps/driver` the guard
  is tight — M1 is a different app.
- **Step 4's ordering claim is pinned on both sides.** A direct 409 from the api, plus a proof that
  the banner kind is unreachable from anywhere else. Every link re-derived here.
- **The PR body states its own head-independence and shows the arithmetic** rather than quoting gate
  figures its last commit invalidated — and tells the next reader to re-derive if a third commit
  lands. That is the `#212` lesson applied without being asked.
- **The five runbook defects are graded honestly**, D4 and D5 marked explicitly as run-method
  artefacts rather than product findings. **D3 is the best of them** — `toLocaleTimeString` with no
  seconds field means an operator watching for a ticking clock calls a healthy page frozen. Only
  running the sheet finds that.
- **`#141` is left open and the closing refs agree with the prose** — GitHub parses exactly #224 and
  #232. On this repo that is not automatic.

## Recommendation

**Request changes** — on M1 primarily, M2 second.

Take M1 and M2 and this merges. M3–M5 are single-clause edits; L1–L7 are polish. Nothing found argues
against the approach, and the fix itself is sound enough that I would not block it on its own merits.

`#224`'s question is answered. `#141` stays open, correctly. **`#232` is the one to look at twice**:
its mechanism is fixed and guarded in `apps/driver`, and untouched in `apps/rider`. Closing it on
this PR is defensible — the issue title scopes it to `driver` — but the runbook's "cleared" heading
and the rider's three unscoped keys should not both stand.
