# PR #233 — review round 1 fixes

**Review** `.claude/code-reviews/pr-233-review.md` (round 1, verdict *request changes*) ·
**Reviewed head** `a25fa49` · **Fixed** 2026-09-20 · **Round** 1

Twelve findings — M1–M5, L1–L7. **All twelve fixed; nothing deferred.** Two were scope calls put to
Linards before any code was written, and both came back as the fuller option: M1 *fix rider and copy
the guard*, M2 *bump both citation sets and add a deviation note*.

One finding's **prescribed fix was wrong and was not followed** (M3 — see below), and one finding
turned out to understate its own defect once the primary source was consulted (L5, which produced
N1). Both are recorded rather than quietly absorbed.

---

## Verdict table

| # | Sev | Fixed | Proven by |
|---|---|---|---|
| M1 | Medium | ✅ | rider guard red on the reviewed head's locale files, green on the fix |
| M2 | Medium | ✅ | all 11 anchors text-matched against `origin/main` on the final tree |
| M3 | Medium | ✅ (fix differs from the one prescribed) | mutation A: old test 4/4 green, new test red |
| M4 | Medium | ✅ | `tsc --noEmit` clean with both casts deleted |
| M5 | Medium | ✅ | `grep -c "Expect"` back to main's baseline 2 |
| L1 | Low | ✅ | arithmetic: 22 pings → 21 gaps; 21 × 4.2 = 88.2 s ≤ 90 s |
| L2 | Low | ✅ | mutation B: old test 4/4 green, new test red |
| L3 | Low | ✅ | docblock (no dependency added — deliberately, per the finding) |
| L4 | Low | ✅ | all five cases suffixed |
| L5 | Low | ✅ | commits read from EAS's own API; see N1 |
| L6 | Low | ✅ | clause tagged with its provenance and its expiry condition |
| L7 | Low | ✅ | `✅*` + footnote; `:500`/`:502` range reconciled |
| N1 | — | ✅ | **found while fixing L5** — the build commit on record was the wrong sha |

---

## M1 — the same defect, live in `apps/rider`

**What was wrong.** All three `apps/rider/locales/*.json` declared
`NSLocationWhenInUseUsageDescription` at the top level — the exact shape this PR fixes in the driver
— while `apps/rider/app.json` declared the matching `expo.locales` map. Per the same
`getResolvedLocalesAsync` path, a top-level key lands in the Android `localesMap`, so rider's first
`:app:lintVitalRelease` fails with **3 fatal `ExtraTranslation` errors** (1 key × 3 locales) for the
reason the driver's failed with 6. `apps/rider` has no `eas.json`, so nothing had ever exercised it.

**Fix.** The key moved under `"ios"` in all three files, and the guard was copied to
`apps/rider/src/locales-config.test.ts` (5 cases, adapted to rider's single localized key). iOS
behaviour is preserved: `apps/rider/app.json:13` declares the matching key in `ios.infoPlist`, so the
localized string stays live rather than inert.

**Scope is closed, not merely bounded.** `apps/driver` and `apps/rider` are the only two `app.json`
files in the tree declaring an `expo.locales` map; `spikes/gps-harness/app.json` has none —
`observed`, and the reviewer's own enumeration, re-run here.

**Proof, both directions** (`observed` 2026-09-20,
`scratchpad/prove-rider-red.sh`):

| rider `locales/*.json` | Result |
|---|---|
| this fix | **5 passed / 5** |
| reviewed head `a25fa49`'s (unscoped) | **1 failed**, 4 passed — the failure is `resolves no Android string`, the intended one |

**New failure mode this fix's mechanism introduces**, named as the skill requires even though no
finding here is Critical or High: the guard hard-codes `LOCALIZED_IOS_KEYS`, so legitimately adding a
fourth localized string reds two cases until the literal is updated. That is the intended tripwire,
not an accident — but it is now a second place to edit, and the docblock says so.

---

## M2 — nine stale plan anchors, and an undocumented deviation

**What was wrong**, and it is two things. (1) T11's constant-line-count constraint was exceeded by
**+20 lines** with no deviation recorded anywhere — `grep -inE "deviat|constant line count|line
count|shifted|anchor"` returned nothing in the report or the PR body, re-run and confirmed. (2) Nine
of the ten runbook anchors the tracked plan cites stopped resolving.

**Fix.** The deviation is now recorded in `.claude/reports/emulator-gates-224-report.md` under a new
`## Deviations` heading — stating that exceeding the constraint was the right call and why, so the
next reader does not "fix" it by compressing the divergence note away. The full old → new mapping
sits in T11's GOTCHA itself, where the stale anchors were, with an instruction to re-derive rather
than add another +20.

**Both citation sets re-pointed**, per the scope answer:

| Plan line | Was | Now |
|---|---|---|
| `:174` | `:86-88` | `:106-108` |
| `:178` | `:246` | `:266` |
| `:179` | `:282` | `:302` |
| `:359` | `:37-52` | `:57-72` |
| `:571` | `:246` | `:266` |
| `:1239` (was `:1222`) | `:296-299` | `:316-319` |
| `:814-815`, `:822-823` | the bare checklist | kept as-is, with the mapping appended beneath it |

`:186`'s `:13-22` needed no change — it still spans the Result heading and field table.

**Two the review did not list, found here:** `:179`'s bare `:282` and `:1222`'s `:296-299`. The
review's table had nine rows; the live citation set has eleven anchors across six lines.

**Proof** (`observed` 2026-09-20, after every runbook edit, against the final tree — text match, not
arithmetic):

```
:13 →:13  EXACT   :37 →:57  EXACT   :86 →:106 EXACT   :222→:242 EXACT
:233→:253 EXACT   :246→:266 EXACT   :282→:302 EXACT   :290→:310 EXACT
:311→:331 EXACT   :296→:316 EXACT
:35 → reflowed, sentence now begins at :53 (the one non-+20 case, as the review said)
```

**Edit order mattered and was deliberate.** M5, L5, L7 and M1's runbook bullet all edit the same file
whose shift M2 corrects. Every runbook edit landed first; the three hunks at or above `:529` are
constant line count (`-16,15 +16,15` · `-499,8 +499,8` · `-529,15 +529,15`), and the only additive
hunks sit at `:601`+ — below every anchor. The mapping above was then computed against the finished
tree, not predicted from +20.

**Explicitly left alone**, per the review: `pr-218-review.md`, `pr-218-review-round2.md`,
`pr-219-review.md`, `pr-219-review-fixes.md` and `pr-226-review-fixes.md` carry now-shifted runbook
line numbers. They are head-anchored records of merged PRs; re-anchoring one re-stales it on the next
edit.

---

## M3 — the iOS case asserted nothing about *which* keys survive

**What was wrong.** The case asserted only that the iOS key set was non-empty and identical across
the three locales. Renaming both `NSLocation*` keys consistently in all three files kept it green
while the iOS permission dialogs lost their localized strings in every locale.

**The review's prescribed fix is wrong, and was not followed.** It said to assert the resolved set
equals what `app.json` declares in `expo.ios.infoPlist`, parenthesising *"exactly those two today, so
it passes as-is"*. It is not two — `observed`:

```
["UIBackgroundModes","NSLocationWhenInUseUsageDescription",
 "NSLocationAlwaysAndWhenInUseUsageDescription","LSApplicationQueriesSchemes"]
```

A bare `toEqual` against that set goes red immediately. `UIBackgroundModes` and
`LSApplicationQueriesSchemes` are Info.plist entries that are not localizable strings and must never
appear in a locale file.

**What was done instead** — both halves of the contract, as two cases rather than one:

- Case 3 asserts the resolved iOS key set equals a **literal** `LOCALIZED_IOS_KEYS`, per locale.
- Case 4 asserts every key in that literal **is** declared in `expo.ios.infoPlist` — the real
  contract the review was reaching for (a localized `InfoPlist.strings` key does nothing without the
  matching `Info.plist` key), without the false claim that the two sets are equal.

The `return`-not-`continue` amplifier at `ios/Locales.js:62` is recorded in the case's comment, since
it is why an unnoticed empty resolution costs every later locale rather than its own.

**Proof — three mutations, old test vs new** (`observed` 2026-09-20,
`scratchpad/prove-red.sh` and `prove-case4.sh`; OLD = the reviewed head's file, materialised from
`HEAD:apps/driver/src/locales-config.test.ts`):

| Mutation | OLD test | NEW test |
|---|---|---|
| none (baseline) | 4 passed / 4 | 5 passed / 5 |
| A — rename both `NSLocation*` keys in all three locale files | **4 passed / 4** | **1 failed**, 4 passed |
| B — repoint `app.json`'s `lv` at `en.json` (L2) | **4 passed / 4** | **1 failed**, 4 passed |
| C — drop `NSLocationWhenInUse…` from `app.json`'s `ios.infoPlist` | not applicable (no such case) | **1 failed**, 4 passed |

A and B are the two defects the review named; the old test passes both. C proves case 4 fails on its
own direction rather than riding case 3.

---

## M4 — `as unknown as` suppressed the drift the test exists to catch

**What was wrong.** Both call sites cast the locale objects to `Record<string, string>`, asserting
the values are strings when they are objects. Beyond being false, `as unknown as` suppresses *any*
future signature change — so if Expo narrowed `ExpoConfigLocales` to paths only, the test would keep
compiling while exercising a path the library no longer supports.

**Fix.** Both casts deleted. `locales.d.ts:12` declares the parameter as
`ExpoConfigLocales = NonNullable<ExpoConfig['locales']>`, which `@expo/config-types` defines as
`{ [k: string]: string | { [k: string]: any } }` — `observed` at
`node_modules/@expo/config-types/build/ExpoConfig.d.ts:179`. The inline-object form is structurally
assignable with no cast; the failure case now annotates its literal `: ExpoConfigLocales` instead.

The review's related point is taken: the docblock justified the inline form by citing an
implementation detail, and now cites the typed contract plus `@expo/config-types`' own doc comment
(*"Platform-specific locale strings should be nested under `ios` and `android` keys"*). That is a
stronger footing than the one previously claimed.

`appJson as { expo?: … }` was left in place and widened to cover `ios.infoPlist` — it matches
`build-config.test.ts:121` and is a narrowing, not a lie about a type.

**Proof.** `npx tsc --noEmit` in `apps/driver` and `apps/rider`, both exit 0 with no cast present
(`observed` 2026-09-20). This is the only thing that can prove it; no runtime assertion would.

---

## M5 — the `Expect`-count tripwire read as a false pass

**What was wrong.** T11's VALIDATE is `grep -c "Expect" … # must not grow`. `observed`: **main 2,
head 3**. The guard was red, and red for a harmless reason — the third hit was prose at `:532`, not a
fourth copy of the run sheet. A false positive that the next pass would wave through, killing the
tripwire the plan set against the exact defect PR #218 shipped to close.

**Fix.** Reworded `:532` off the bare word (*"Every §Steps expectation cell…"*), which is the option
that restores the baseline rather than moving it — tightening the grep instead would have left the
plan's own `must not grow` line to be edited too. The plan's VALIDATE now also carries
`grep -c '| Expect |'` (the table header, which prose cannot trip) and one sentence saying why the
bare-word count is deliberately noisy.

**Proof** (`observed` 2026-09-20, final tree):

```
grep -c "Expect"     docs/runbooks/driver-device-day.md  → 2   (main: 2)
grep -c '| Expect |' docs/runbooks/driver-device-day.md  → 1
```

---

## L1 — 22 pings give 21 gaps

`:162` records *"22 `ping_accepted` in 90 s, every `clientAt` gap 4.2 s"*. `:197` called the same
evidence *"22 gaps"*, which is 92.4 s and cannot fit a 90 s window. 21 × 4.2 = 88.2 s does.

**Fix.** `:197` now reads *"step 5's 21 gaps of 4.2 s"*. An off-by-one in the sentence closing the
step 4 ordering proof — the load-bearing one.

---

## L2 — the precondition compared keys but not paths

Covered by mutation B above. The case now asserts the whole map —
`{lv: './locales/lv.json', ru: …, en: …}` — so repointing a locale at a different file reds it. The
docblock's *"Same three files `app.json` points at"* is now a thing the test checks rather than a
thing it claims.

---

## L3 — an undeclared, deep import, unexplained

**Fix, and the review's reasoning is followed exactly: no dependency was added.**
`@expo/config-plugins` stays out of `apps/driver/package.json` and out of `apps/rider`'s. Resolving
the same hoisted copy `expo prebuild` loads is what gives the guard its value; a declared version
would be free to drift from the one prebuild uses, and the test would then pass while the build
failed — the exact failure mode it was written against.

Two paragraphs in each docblock now state that the import is deliberately undeclared, why, and that
the deep `/build/utils/locales` path is outside the package's `exports` contract and so outside its
semver promise — the accepted cost of testing the real resolver, with a breaking move showing up as a
red import rather than a silent pass. This mirrors `native-module-pins.test.ts:76-86`, which names
its own hoisted-layout dependency and what it leaves uncovered.

---

## L4 — missing case-type suffixes

All five driver cases and all five rider cases now carry one: `(expected)` ×2, `(edge)` ×2,
`(failure)` ×1 per file. Matches `build-config.test.ts` (11 of 11) and `native-module-pins.test.ts`
(16 of 16), and makes the repo's "≥1 expected + 1 edge + 1 failure" rule mechanically auditable here
too.

---

## L5 + N1 — the control build, and the sha the APK was actually built from

The review said the "same tree minus one fix" claim could not be checked from the documents that make
it. It can be checked — from EAS. Reading `builds.byId` over the Expo GraphQL API (`observed`
2026-09-20) turned a Low into a correction with two parts.

**L5 as filed.** `edcc579b`'s commit is `ade96c7c`, whose parent is `fa6277d` and which sits on
`fix/expo-worklets-peer-225` — **PR #227's branch head**. So `:24`'s *"PR #227's verification build"*
was the accurate description and `:61`'s *"same tree minus #232's fix"* was not: they are different
lines of history, not one tree with a fix removed.

The pairing is still sound, and now says why in a way a reader can run:
`git diff ade96c7c 4e6ffb68` touches 12 paths, of which **only the three `apps/driver/locales/*.json`
files are build inputs**. The other nine are eight `.claude/` documents and two jest tests nothing in
the app imports; no `package.json`, `pnpm-lock.yaml`, `app.json` or `eas.json` differs. The builds do
differ by #232's fix in everything Gradle reads. "Same tree" was the wrong word for a right idea.

**N1, which the review did not catch.** `bcd04c21`'s commit is **`4e6ffb68`**, not the `f4d37e4` the
report (`:59`) and runbook (`:19`, `:540`) both recorded. They are sibling commits off the same
parent `f7446c3`, seven minutes apart (21:48:47 vs 21:55:58), and `git diff 4e6ffb68 f4d37e4` is
`apps/driver/src/locales-config.test.ts` and nothing else — so every Gradle input is identical and no
conclusion moves, but the APK was not built from the sha on record. All three places now say
`4e6ffb68` and explain the pair.

**The wall times survive re-derivation, and now carry which figure they are.** Both were
`completedAt − createdAt`: `edcc579b` 12:09:07.489 → 12:28:49.096 = 1181.6 s ≈ **1182 s**;
`bcd04c21` 20:49:41.024 → 21:09:40.560 = 1199.5 s ≈ **1199 s**. EAS's own `buildDuration` field
excludes the queue and reads 1077 s and 1189 s. The documents quote the wall, which is what a person
waiting on a build experiences, and now say so — previously a reader had no way to know which of the
two a figure was.

---

## L6 — an app-state observation stated as mechanism

*"…and writes no default `values/strings.xml` entry for any of them — the default file carries only
`app_name`."* The first half is a property of `android/Locales.js:66` and is correct. The trailing
clause describes *this* prebuild's output, carried no provenance tag, and stops being true the moment
a splash config, `google-services.json` or RTL option adds a default string.

**Fix.** Tagged `observed` 2026-09-18 against the prebuild at report `:35-38`, with its expiry
condition stated and an explicit note that the mechanism does not depend on it. Not dropped: it is
useful, it just needed to stop impersonating a law.

---

## L7 — step 1's unqualified ✅, and "2 through 8" vs "all eight"

**Fix, both halves.** The grid cell is now `✅*`, footnoted to the divergence paragraph directly
beneath it (which now opens `**\* One divergence, on step 1.**`), and the Outcome row says *"All
eight steps ✅ on an emulator, step 1 with its prompts pre-granted (see the divergence below)"*. The
divergence note itself was already honest and specific — only the two most-scanned surfaces carried
no marker.

`:502` now reads *"All eight steps passed on 2026-09-18 — step 1 by the emulator setup above, 2
through 8 this way"*, which is consistent with `:500`'s seven-row range instead of contradicting it
one sentence later.

---

## The number sweep

Retired values chased by **value**, not by topic word, and by **subject** as well. Each command was
re-run against the finished tree; this is the list, not a claim that a list was made.

| Retired | `grep -n` run | Hits, and what happened to them |
|---|---|---|
| `22 gaps` | `grep -rn '22 gaps' .claude/ docs/ apps/` | **0** — the only copy was report `:197`, fixed. Control: the same pattern against `a25fa49` returns **1**, so the pattern can match and the 0 is real |
| `f4d37e4` as the build commit | `grep -rn 'f4d37e4' .claude/ docs/ apps/` | **6**: report `:70`, `:71`, `:298`; runbook `:540`, `:624`, `:625`. All six are now the *explanation* of why `4e6ffb68` is correct, or the pre-review gate anchor. No hit still asserts it as the build commit |
| `same tree minus` | `grep -rn 'same tree minus' …` | **1** — report `:74`, which is the sentence retiring it |
| bare `Expect` (M5's subject) | `grep -c 'Expect' docs/runbooks/driver-device-day.md` | **2**, equal to `origin/main`'s 2 |
| `\| Expect \|` | `grep -c '\| Expect \|' …` | **1** — the single run-sheet header, unmoved |
| `driver-device-day.md:` (M2's subject) | `grep -rln 'driver-device-day\.md:' .claude/ docs/` | **6 files**: the plan + 5 historical PR records the review scoped out. In the plan, 7 lines match — `:174`, `:178`, `:359`, `:571`, `:1239` re-pointed; `:186` (`:13-22`) correct as-is; `:841` is the VALIDATE command, not a citation. `:179`'s bare `:302` is an eighth anchor this pattern does not match, and was re-pointed too |
| unscoped locale key | **not greppable — see below** | structural check: **0** files, both apps |
| driver suite figures | `grep -rn 'Tests 249\|Test Suites 44\|2m3\.161s' .claude/ docs/` | **2** — `emulator-gates-224-report.md:303` and `:305`, the pre-review gate block. Correctly left standing: `:298-300` now scopes it as the run at `f4d37e4` *as the branch stood at the reviewed head*, and points here for the run that covers the fixes. See the note below on how this row was first got wrong |

**One sweep row could not be done with `grep`, and saying so is the point.** The obvious check —
`grep -rn '^\s*"NSLocationWhenInUseUsageDescription"' apps/` — returns **8 hits on the fixed tree**
and would have been recorded as a failure, or worse, as a pass if the count had been eyeballed
against the wrong baseline. The pattern cannot tell a top-level key from one nested under `ios`:
both are indented string keys. The defect is *structural*, so the check has to be:

```bash
for f in apps/*/locales/*.json; do
  node -e "const k=Object.keys(require('./$f')).filter(k=>k!=='ios'&&k!=='android');
           if(k.length) console.log('BAD  $f', k)"
done   # prints nothing when every locale file is correctly scoped
```

`observed` 2026-09-20 — **0 files with an unscoped key**, across all six (driver ×3, rider ×3). The
same check against the reviewed head `a25fa49` returns `["NSLocationWhenInUseUsageDescription"]` for
each of the three rider files, which is the defect M1 named.

**The same mistake was then made a second time in this very table, and caught only on review.** The
row for the driver suite figures originally read *"`grep -rn '249 tests\|44 suites'` → **0** in live
artifacts"*. Zero, because `249 tests` does not match the text `Tests 249 passed, 249 total` and
`44 suites` does not match `Test Suites 44 passed`. The correct pattern returns **2** hits, both in
the pre-review gate block, both correctly left standing. Twice in one pass a sweep pattern matched
the *idea* of a value and not its *form* — once on a key name, once on a test count. The lesson is
narrower than "grep carefully": **a sweep row reporting 0 is the row to distrust**, because a
mistyped pattern and a genuinely clean tree are indistinguishable from the output alone. Every 0 in
this table was re-run against a known-positive control (the reviewed head, or the pre-fix text)
before being written down.

**The PR body was checked separately**, since no working-tree grep reaches it. Four retired claims
were found there and **were corrected** — `gh pr edit 233 --body-file`, run 2026-09-20 after the fix
commit was pushed, so the body's figures anchor at the head that produced them:

1. *"1199 s, against a 1182 s control that died at lint on the same tree minus the fix"* → both
   commits named, and the tree claim replaced with the build-inputs one (L5/N1).
2. *"at `f4d37e4`"* as the gate anchor → `29483ae`, the current head.
3. The *"branch is two commits; `f4d37e4` carries every line the gate can read"* head-independence
   argument → **retired, not re-quoted**. It is now false: `29483ae` carries gate-readable source
   too (the driver test, three rider locale files, the new rider test), so the run is anchored at
   the head itself.
4. The gate block's `2m3.161s` / `249 tests` figures → the 2026-09-20 run, with `@taxi/rider` added.

Re-checked against the live body after the edit (`observed`): `249 tests` 0 hits, `2m3.161s` 0 hits,
``at `f4d37e4`.`` 0 hits; the two surviving `f4d37e4` mentions are the sentences explaining why
`4e6ffb68` is correct, and the one retiring the head-independence argument.

---

## Validation

**Gate, `observed` 2026-09-20**, from the `taxi-wt-224` worktree:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force

Tasks:    22 successful, 22 total       Time: 1m29.804s      exit 0
@taxi/api    : Test Suites 77 passed, 77 total   Tests 733 passed, 733 total
```

`REDIS_TEST_URL` was set, so the 39 Redis-gated tests ran rather than skipping — 77 of 77 suites.

**Per-app totals, `observed` the same day** by `pnpm --filter @taxi/<app> test`:

| Package | Suites | Tests | Was | Delta |
|---|---|---|---|---|
| `@taxi/driver` | 44 | **250** | 44 / 249 | +1 case (the guard went 4 → 5) |
| `@taxi/rider` | 30 | **145** | 29 / 140 | +1 suite, +5 cases (the new guard) |

The rider baseline was **measured, not inferred** — the new file was moved aside and the suite re-run
(29 suites / 140 tests), then restored.

**One gate failure on the way, recorded rather than smoothed over.** The first run went red in 46 s
on `@taxi/rider#lint` — a `prettier/prettier` break in the new rider test at `:125`. `eslint --fix`
on both new files, then the clean 22/22 above. It was a formatting error in code written this pass,
not an environment flake.

**Not run:** no Android build. Nothing in the gate compiles Android resources — which is the whole
premise of these guards — so the rider fix's real oracle is a future `apps/rider` release build that
does not exist yet. The guard is the substitute, and it is proven red-on-defect rather than merely
green.

---

## Nothing deferred

No follow-up issue was filed, because nothing was left. The two scope questions were asked before any
code was written and both came back as the fuller option.
