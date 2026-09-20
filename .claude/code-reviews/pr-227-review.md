# PR #227 review — `fix(deps): pin reanimated and worklets to Expo SDK 57's bundle (#225)`

**Head** `6226549` · **Base** `main` @ `fa6277dd760de71d0c1e737547b9e6a313bd3b5f` · **Reviewed** 2026-09-18 · **Round** 1

Guarantees pass **skipped**: no prior `pr-227-review*.md` exists, so there is no recorded base
to compare against. For the record, the base branch's live tip (`git fetch origin &&
git rev-parse origin/main` → `fa6277d`, `observed`) equals `baseRefOid`, and
`mergeStateStatus` is `CLEAN` — the base has not moved under this PR.

Constraint pass **skipped**: no plan or RCA artifact exists for #225/#227
(`ls .claude/plans/`, `ls .claude/reports/`, `grep -rl 225 .claude/plans .claude/reports` — no
match, `observed`). See L6.

## Verdict — approve

No Critical or High findings. The root cause is verified mechanically and independently of the
author's EAS build; the fix is the minimum change that reaches a *required* peer; the guard test
fails in both directions and is `observed` running in CI.

Three Medium and six Low findings, **all of them in the guard test and none in the fix**. M2 is
the one worth doing before merge — it is a comment stating a broader guarantee than the code
delivers, which is the defect class this repo's CLAUDE.md names by hand — and it is a prose edit.
M1 and M3 are each a few lines and can ride this branch or a follow-up; neither can make the guard
falsely red on a good tree, and neither lets #225's actual shape through (`observed` — the guard
catches that tree).

One finding put to this review was run and **refuted** rather than relayed: the claim that
`Object.fromEntries(PINNED.map(…))` widens to `any`. It does not — see M3's closing paragraph for
the emitted declaration.

## Summary

Two root `pnpm.overrides` pins take `react-native-reanimated` to `4.5.1` and
`react-native-worklets` to `0.10.1` — Expo SDK 57's own bundled pair — and a 295-line guard test
in `apps/driver` makes the pins fail loudly when they stop being right. `pnpm-lock.yaml` is
regenerated; `semver` + `@types/semver` join `apps/driver`'s devDependencies as the guard's only
new dependency.

### Root cause, re-derived by this review

Every step of the PR body's causal chain reproduces on the pre-fix tree (the main checkout's
installed `node_modules`, which still carries reanimated `4.6.0` / worklets `0.12.1`):

| Claim | Result |
|---|---|
| `react-native-drawer-layout@4.2.10` declares `react-native-reanimated: ">= 2.0.0"` as a **required** peer, no `peerDependenciesMeta` entry | ✅ confirmed |
| `react-native-reanimated@4.6.0` declares `react-native-worklets: "0.12.x"` | ✅ confirmed (registry + installed manifest) |
| `expo-modules-core@57.0.14` declares `^0.7.4 \|\| ^0.8.0 \|\| ^0.9.0 \|\| ^0.10.0`, marked optional | ✅ confirmed |
| `expo-router@57.0.17` declares reanimated `*`, **optional** — the issue's named cause | ✅ confirmed, and the PR body's correction stands: the optional peer alone would not have forced a resolution |
| Exactly 5 consumers declare a peer on either package across the installed tree | ✅ confirmed (`@expo/ui`, `expo-modules-core`, `expo-router`, `react-native-drawer-layout`, `react-native-reanimated`) |

The compile error itself, verified without the EAS log (`observed` 2026-09-18):

- `node_modules/expo-modules-core/android/src/main/cpp/worklets/WorkletJSCallInvoker.cpp:27`
  calls `workletRuntime->executeSync(...)`.
- `react-native-worklets@0.12.1` as installed on the pre-fix tree contains **0** occurrences of
  `executeSync` anywhere (`grep -r … | wc -l` → 0). The member genuinely does not exist.
- The published `react-native-worklets@0.10.1` tarball declares it in
  `Common/cpp/worklets/WorkletRuntime/WorkletRuntime.h` (8 occurrences across 3 files).

So the pin restores exactly the member `expo-modules-core`'s C++ calls. That is independent
mechanical confirmation of the fix's direction, and it does not rest on the EAS build.

### Fixed-tree peer satisfaction, re-derived

`react-native-worklets@0.10.1` against every range declared on it: `*` (`@expo/ui@57.0.14`) ✅,
`^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` (`expo-modules-core`) ✅, `0.10.x` (reanimated 4.5.1) ✅.
`react-native-reanimated@4.5.1` against every range declared on it: `*` (`expo-router`) ✅,
`>= 2.0.0` (`react-native-drawer-layout`) ✅. Both accept `react-native@0.86.3` through their
shared `0.83 - 0.86` peer ✅. All six `observed` via `semver.satisfies` against registry
metadata. The PR body's enumeration is complete and correct.

Both pins equal `node_modules/expo/bundledNativeModules.json` at `expo@57.0.18`
(`reanimated: 4.5.1`, `worklets: 0.10.1`, `observed`).

### The lockfile regeneration is surgical

`pnpm-lock.yaml` is +92/-104, which is more churn than two pins suggest, so I diffed the
resolved set rather than the text. Parsing the `packages:` and `snapshots:` keys at both
revisions and diffing `name@version` gives, at **both** levels and with nothing else moving
(`observed`):

```
- react-native-reanimated@4.6.0      + react-native-reanimated@4.5.1
- react-native-worklets@0.12.1       + react-native-worklets@0.10.1
                                     + @types/semver@7.8.0
```

`semver@7.8.5` adds no entry because it was already resolved transitively — it now resolves
from the repo-root `node_modules` under the hoisted linker, which is where `apps/driver`'s
`require` already finds it (`observed`). The remaining +/- lines (`styled-jsx`,
`eslint-plugin-import`, `debug`, `eslint-import-resolver-typescript`) are peer-suffix and
ordering churn inside snapshot blocks, not version changes. **No unrelated dependency drift
rode in on the regeneration.**

## Findings

None Critical or High. **Every finding below is in the guard test, not in the fix.** The two
`pnpm.overrides` pins are correct, minimal, and proved; nothing here argues against them.

### Medium

**M1 — assertion 4 cannot tell "no violations" from "the walk found nothing".**
`apps/driver/src/native-module-pins.test.ts:104-109` returns `[]` on any `readdirSync` error, and
`:137-139` `continue`s past any manifest it cannot read. Both are deliberate and documented. But
the assertion they feed is `expect(peerViolations(…)).toEqual([])`, so a walk that discovered
**zero** consumers is indistinguishable from a clean tree — and that assertion is the only one
that encodes #225's actual invariant.

The window is narrow, and worth stating precisely rather than as a general worry: assertions 1–3
would not catch it, because they read `package.json`, `expo/bundledNativeModules.json` and the two
pinned manifests by path, never by `readdirSync`. So the vacuous case is exactly "`readdirSync` on
the repo-root `node_modules` fails while `readFileSync` on files inside it succeeds" — a
permissions oddity or a mid-run race, not an everyday state. One line closes it, and it does not
rebuild the blind spot the docblock argues against at `:42-46`, because it names a package to
prove the *mechanism* rather than to enumerate the consumer set:

```ts
it('the peer-range walk sees the tree at all (edge)', () => {
  expect(Object.keys(declaredPeerRanges())).toContain('expo-modules-core');
});
```

`expo-modules-core` is a hard dependency of `expo` and is #225's own consumer, so it is the right
canary. Related, and milder: a pinned package missing from `node_modules` makes
`installedVersions()` throw a raw `ENOENT`, and a moved `bundledNativeModules.json` throws inside
the `describe` body, killing the file with "Test suite failed to run". Both are *loud* — red, not
green — so they are message quality, not a hole.

**M2 — "anywhere in the tree" is a guarantee the walk does not deliver.**
`:32-33` and `:44-46`. The walk reads root `node_modules/<pkg>` and `node_modules/@scope/<pkg>` —
one level plus one scope level — and never descends. `observed` in this tree: **373** manifests
sit under `node_modules/*/node_modules` and are never visited — that count is this review's own
scan, one level deep with scoped packages included, so it is not comparable to a count taken at a
different depth. Add 39 under `services/api/node_modules` and 2 under
`apps/dispatch/node_modules`. **None of them declares a
peer on either pinned package and none is a second copy**, so the check is not wrong today — but
the sentence is broader than the code, which is the class CLAUDE.md singles out ("a guarantee in a
comment is a claim, not decoration").

Two corrections to how far this goes, both `observed` rather than reasoned:

- The hoisted layout genuinely does put everything at top level here.
  `ls node_modules/.pnpm` → **1 entry, `lock.yaml`**: under `node-linker=hoisted` there are no
  `<pkg>@<ver>/node_modules/` store directories at all. There is no nested copy of either pinned
  package for the walk to miss.
- **The guard would *not* go green on the tree #225 actually shipped.** I replicated the walk
  against the pre-fix tree still installed in the main checkout (reanimated `4.6.0`, worklets
  `0.12.1`) and got exactly one violation — `expo-modules-core` /
  `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` / `0.12.1` — because the hoisted layout put `0.12.1` at
  root top level. A hypothetical *nested loser* copy would be missed; #225's real shape is not one.

**Fix: narrow the prose, do not add recursion.** Recursing is real complexity for a case the pins
themselves prevent. `:32-33` → "declared in the repo-root `node_modules`"; `:44-46` → state the
assumption the code actually rests on (the overrides collapse each pinned package to one version,
so no nested copy of *these two* can exist; a nested *consumer* would still be missed). The
"stays the real check if the pins are ever removed" rationale at `:33-35` is the one clause
worth dropping: with the overrides gone, assertions 1 and 2 red immediately anyway, so clause 3
never gets to be the survivor it claims to be.

Same paragraph, one more scope note: `spikes/gps-harness/node_modules` is outside
`pnpm-workspace.yaml` (`apps/*`, `services/*`, `packages/*`, `db`) and carries its own
isolated-linker install. Nothing EAS builds reads it, so it is correctly out of scope — it is just
another thing "anywhere in the tree" claims and the walk does not cover.

**M3 — a manifest without a `version` is silently skipped, not reported.**
`:153-159` and `:175`. `PackageManifest.version` is optional (`:74`); `installedVersions()` casts
the result to `Record<string, string>`. If a pinned manifest ever lacked `version`,
`versions[dependency]` is `undefined`, and `peerViolations`' first filter
(`versions[dependency] !== undefined`, `:175`) drops **every** peer range declared on that
package before `satisfies` ever sees it. Assertion 4 then passes vacuously for it.
`observed`, running the function as written:

```
peerViolations({'react-native-worklets': undefined},
               {'expo-modules-core': {'react-native-worklets': '^0.10.0'}})  →  []
```

Assertion 3 (installed equals pin) does red first on that tree, so the case is covered today — by
assertion ordering, not by the types. **Fix:** type the return as
`Record<string, string | undefined>`, drop the cast, and fold the guard and the narrowing into one
step so the compiler carries it:

```ts
Object.entries(peers).flatMap(([dependency, range]) => {
  const installed = versions[dependency];
  if (installed === undefined || satisfies(installed, range)) return [];
  return [{ consumer, dependency, range, installed }];
})
```

*Not* a defect, though it was put to me as one: `Object.fromEntries(PINNED.map((n) => [n, x]))`
does **not** widen to `any` here. Emitting the declaration for that exact expression under
`--strict` gives `{ [k: string]: string | undefined }` (`observed`, tsc 5.9) — the generic overload
matches, `as const` on the tuple changes nothing, and the cast at `:159` is a deliberate narrowing
rather than a consequence of lost inference. The behaviour above is the real finding; the type
mechanism behind it is not what it looked like.

### Low

**L1 — the suite title hardcodes an SDK the mechanism does not check.**
`:196` reads `native module pins track Expo SDK 57 and satisfy every peer (#225)`, but every
assertion reads whatever `node_modules/expo` happens to be. After an SDK 58 bump that keeps both
digits, the test is green and its own title is false. Drop the `57` from `:196` and `:26`. Adding a
version assertion would be the wrong fix — it re-freezes exactly what assertion 1 is designed to
leave floating.

**L2 — a non-semver peer range is reported as a version mismatch rather than skipped.**
`:177`. `semver.satisfies` catches an invalid `Range` internally and returns `false`, so a peer
declared as `patch:`, `workspace:*`, `catalog:` or an `npm:` alias reds the gate with a message
that names a version conflict which does not exist. `observed`:

```
peerViolations({'react-native-worklets':'0.10.1'}, {x:{'react-native-worklets':'patch:react-native-worklets@npm%3A0.12.0-nightly#…'}})
  →  [{consumer:'x', …, range:'patch:…', installed:'0.10.1'}]      // false violation
peerViolations({'react-native-worklets':'0.10.1'}, {y:{'react-native-worklets':'workspace:*'}})
  →  [{consumer:'y', …}]                                           // false violation
```

A near-miss already sits in the tree: `node_modules/react-native-gesture-handler/package.json`
declares `react-native-worklets` as
`patch:react-native-worklets@npm%3A0.12.0-nightly-20260810-fb9cb5596#~/.yarn/patches/…` — in
`devDependencies`, which the walk does not read (`observed`). One published package moving a spec
like that into `peerDependencies` reds the gate for the wrong reason. **Fix:** `try { new Range(range) } catch { return []; }`
in the violation branch, or bucket unparseable ranges into a separately named failure.

**L3 — `range as string` at `:239` is load-bearing for the typecheck.**
`expect(range).toBeDefined()` at `:235` throws at runtime but narrows nothing for TypeScript.
Replacing both with
`if (range === undefined) throw new Error('expo-modules-core no longer declares a react-native-worklets peer — the #225 case needs rewriting');`
narrows properly, keeps the same red, and says something more useful when it fires.

**L4 — assertion 2 assumes `bundledNativeModules.json` holds exact versions.**
`:209-213` compares with strict equality. True for these two today, but **101 of that file's 123
entries are ranges** (`~57.0.16`, `^15.0.2`, …) and only 22 start with a digit (`observed`). If
Expo ever writes `~4.5.1` while pinning the same effective version, the gate reds on a
non-regression. One sentence in the docblock stating the assumption is enough; no code change.

**L5 — `react-native` sits outside the guard's scope, so reanimated's own RN peer is unwatched.**
`:83` — `PINNED` holds the two pinned packages, and `declaredPeerRanges()` keeps only peer entries
whose *key* is in `PINNED`. Peers declared **by** a pinned package on something else are dropped:
`react-native-reanimated@4.5.1` declares `react-native: "0.83 - 0.86"`, and a bump of
`react-native` alone past `0.86` leaves all nine cases green. Mitigated in practice —
`react-native` *is* a declared dependency of `apps/driver` (`0.86.3`), so `expo install --check`
does see it, which is exactly the blind spot #225 did not have; and `bundledNativeModules.json`
already carries `react-native: 0.86.3` (`observed`), so assertion 1's pattern extends to it in one
entry if you want the belt.

**L6 — no plan or implementation report exists for this ticket.**
`.claude/plans/` and `.claude/reports/` carry nothing for #225 or #227. The PR body carries the
reasoning that would normally live in them, and it is unusually thorough, so nothing is lost for
*this* review — but it means the constraint pass had no ACCEPTANCE CRITERIA or `GOTCHA` to grep,
and a later ticket inheriting these figures has only the PR body to go on. Worth one
`system-execution-report` if the loop is closed.

## The numbers pass

Every figure in the PR body, checked against a run:

| Figure | Claimed as | Verdict |
|---|---|---|
| `22/22` tasks, `733/733` api tests, `77/77` suites | `observed` (author, local, `6226549`) | ✅ **independently confirmed** — CI `check` job `105594487337` on this head logs `Tasks: 22 successful, 22 total`, `Tests: 733 passed, 733 total`, `Test Suites: 77 passed, 77 total` |
| `694 passed + 39 skipped` without `REDIS_TEST_URL` | explicitly labelled inherited from CLAUDE.md at `0cdb59c`, **not re-run** | ✅ correctly labelled; matches CLAUDE.md |
| `1m35.1s` gate wall time | `observed` (author's local run) | not re-run; CI's own `check` job took 3m0s, which is a different machine and not a contradiction |
| "4 of its 9 cases red" on the reverted tree | `observed` (author, `ade96c7`) | ✅ **agrees with this review's `derived` count of 4** — see below |
| `pnpm install --frozen-lockfile` passes | `observed` | ✅ CI runs exactly that (`.github/workflows/ci.yml:52`) and the job is green |
| Pins read from `expo/bundledNativeModules.json` | `observed` | ✅ confirmed at `expo@57.0.18` |
| `0.10.1` satisfies `*` / four-clause / `0.10.x`; both accept RN `0.86.3` via `0.83 - 0.86` | `observed` via `semver -r` | ✅ all six re-derived |
| Control build `a47b0b19-…`, 468 s, `EAS_BUILD_UNKNOWN_GRADLE_ERROR` at `1c87592` | explicitly "quoted from the issue rather than re-run, so it describes that commit and not this branch" | ✅ correctly scoped; matches #225 verbatim, and `1c875929…` is a real former `main` head (CI run `35274025207`) |
| `git diff ade96c7 6226549` is one test file, touching neither `package.json` nor `pnpm-lock.yaml` | `observed` | ✅ confirmed: `apps/driver/src/native-module-pins.test.ts` only, +24/-10 |
| `2 keys × 3 locales = 6` `ExtraTranslation` errors | `derived`, arithmetic shown | ✅ `app.json`'s `expo.locales` names `lv`/`ru`/`en`, and each file holds exactly the two `NS*` iOS keys and nothing else (`observed`) |
| EAS build `edcc579b-…`: CMake succeeded on all 3 ABIs · `executeSync` 0× in a 450 KB log · 1182 s vs 468 s | `observed` (author) | ⚠️ **not independently verified by this review** — `eas build:view` needs the deliberately-uncommitted `extra.eas.projectId`, and no checkout on this machine carries it. The claims are consistent with the mechanism verified above and nothing contradicts them; they are relayed as the author's observation, not as this review's |

**The `4 of 9` derivation** (`derived`, from reading all nine `it` blocks). Four cases feed
`peerViolations`/`missingPins` purely synthetic inputs and are tree-independent — green either
way. A fifth, the `expo-modules-core` real-range case, reads that package's installed manifest
but supplies a synthetic `0.12.1`, and `expo-modules-core` is `57.0.14` with the same range on
both trees (`observed`), so it is green either way too. 4 + 1 = 5 green. The remaining four read
the tree and all go red with the overrides removed: pins-present (both missing), pin-equals-bundled
(`undefined` vs `4.5.1`/`0.10.1`), installed-equals-pin (`4.6.0`/`0.12.1` vs `undefined`), and
peer-violations — the last confirmed directly by this review, which replicated the walk against
the pre-fix tree and got exactly one violation: `expo-modules-core` /
`^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` / `0.12.1`. 4 red, 5 green. Matches.

No figure in the PR body is mislabelled, and no `derived` figure sits under an `observed`
heading. The body also states what it did *not* prove — that the device days in #141, #14, #16
and the drive in #4 stay blocked by `:app:lintVitalRelease` — rather than claiming the ticket
unblocks them.

## Validation

| Check | Result | Source |
|---|---|---|
| `check` (`pnpm turbo run typecheck lint test build`) | ✅ 22/22 tasks · 733/733 tests · 77/77 suites · 3m0s | CI job `105594487337` on `6226549` |
| `audit-diff` | ✅ pass | CI |
| `codeql` + CodeQL | ✅ pass, no alerts | CI |
| `ready` | ✅ pass (PR flipped out of draft) | CI |
| The new guard actually runs in the gate | ✅ `PASS src/native-module-pins.test.ts` | CI `check` log |
| `@taxi/driver` suite | ✅ 43 suites, 238 tests | CI `check` log |
| Root cause reproduced | ✅ 5 peer consumers, 1 violation, `executeSync` absent from 0.12.1 and present in 0.10.1 | this review, `observed` |

The gate was **not** re-run locally. CI ran the parity command on this exact head, and a local
re-run would have cost a fresh hoisted `pnpm install` in a new worktree plus a shared-test-DB
collision against the other live sessions (12 worktrees, 18 `claude` processes `observed`) for a
strictly weaker observation. The two CodeQL rows are one scan, not two: the `CodeQL` check run is emitted by
`github/codeql-action/analyze@v4` inside the same `codeql` job (`.github/workflows/ci.yml:118`),
whose own gate is `.github/scripts/codeql-gate.sh` (`:125`).

## What's good

- **The correction to the issue's causal chain is the substantive part of this PR**, and it is
  right. #225 named `expo-router`'s *optional* `*` peer; an optional peer alone would have let
  "just don't install reanimated" work, and the PR body says so explicitly and rules that fourth
  option out by naming the required peer below it. Re-derived here and confirmed.
- **The guard fails in both directions**, which is the property most dependency-pin tests lack.
  Reverting the fix reds four of nine cases; the fixed tree greens all nine.
- **Reading peer ranges from the installed manifests rather than `pnpm-lock.yaml`** is the right
  call and the reason the guard is not vacuous. The docblock asks a reviewer to check this rather
  than take it on trust, and it holds (`observed`, this branch's own lock): `pnpm-lock.yaml:4986`
  records `expo-modules-core@57.0.14`'s worklets peer as `react-native-worklets: 0.10.1`, while
  `node_modules/expo-modules-core/package.json:56` really declares
  `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0`; `pnpm-lock.yaml:7010` records
  `react-native-drawer-layout`'s reanimated peer as `4.5.1` where its manifest (`:67`) says
  `">= 2.0.0"`. A lock-sourced check really would assert `0.10.1` against `0.10.1`.
- **Ignoring `peerDependenciesMeta.optional` is correct, and the comment explaining why is the
  best line in the file.** `expo-modules-core` marks `react-native-worklets` optional
  (`node_modules/expo-modules-core/package.json:57-61`, `observed`) and compiles C++ against it
  regardless — optionality governs whether pnpm must *install* the package, not which version the
  consumer builds against. That is #225 in one sentence.
- **The `expo-modules-core` failure case reads its range from the installed manifest instead of
  restating it** — the repo's inherited-figures discipline (#87, #107) applied inside a test, so
  the case follows the package rather than freezing a digit that can move.
- **Consumers are discovered, not enumerated.** #225 happened because nobody was looking at a
  package no file named; a hardcoded list of the three known consumers would have rebuilt that
  blind spot for the fourth.
- **Assertion 1 ties the pins to the SDK, not to today's digits** — an `expo` bump that moves
  either `bundledNativeModules.json` entry reds deliberately instead of leaving a stale pin.
- The `types: ["jest"]` constraint is respected rather than widened: `apps/driver/tsconfig.json`
  includes `**/*.ts` with only `node_modules`/`dist`/`android`/`ios` excluded, so this file **is**
  under `typecheck` with the narrow types array, and the `jest.requireActual('node:fs')` route is
  a real workaround rather than a stylistic one.
- Scope discipline: the second blocker found by the same build (`:app:lintVitalRelease`, 6 fatal
  `ExtraTranslation`) is diagnosed, attributed to `app.json` rather than to any dependency
  version, and left for its own ticket.

## Recommendation

**Approve.** Nothing blocks merge, and the dependency fix ships as-is.

Suggested order if you take the guard findings: **M2** (prose, narrows a false guarantee) →
**M1** (one canary `it`) → **M3** (types + one folded filter, which also subsumes L3) → the
remaining Lows in the same pass. L4 and L5 are documentation-only.

Two follow-ups, neither a condition of merge:

1. **File the `:app:lintVitalRelease` ticket.** No open issue covers it (`gh issue list`, 26 open,
   `observed`) and it is the remaining blocker on #141, #14, #16 and #4. The PR body already
   contains the diagnosis to paste.
2. `Closes #225` is registered in `closingIssuesReferences` (`observed`) — the issue will close on
   merge.

---
Reviewed with `piv-review-pr` (round 1). A human reviews the code and this review, then merges.
