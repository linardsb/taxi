# PR #227 review fixes — round 1

**Review** [`#227 (comment)`](https://github.com/linardsb/taxi/pull/227#issuecomment-5730426131) ·
**Branch** `fix/expo-worklets-peer-225` · **Base at fix time** `6226549` ·
**Worktree** `~/taxi-worktrees/wt-225`

The review's verdict was **approve**: no Critical, no High, and every one of its nine
findings sits in the guard test rather than in the fix. The two `pnpm.overrides` pins are
untouched by this pass — `package.json` and `pnpm-lock.yaml` are not in its diff.

**Scope, chosen by Linards:** fix M1–M3 and L1–L4; defer L5 and L6 with tracker issues.

| | Finding | Disposition |
|---|---|---|
| M1 | Assertion 4 cannot tell "no violations" from "the walk found nothing" | ✅ fixed |
| M2 | "anywhere in the tree" is a guarantee the walk does not deliver | ✅ fixed |
| M3 | A manifest without a `version` is silently skipped, not reported | ✅ fixed |
| L1 | The suite title hardcodes an SDK the mechanism does not check | ✅ fixed |
| L2 | A non-semver peer range is reported as a version mismatch | ✅ fixed |
| L3 | `range as string` is load-bearing for the typecheck | ✅ fixed |
| L4 | Assertion 2 assumes `bundledNativeModules.json` holds exact versions | ✅ fixed |
| L5 | `react-native` sits outside the guard's scope | ⏭ deferred → #228 |
| L6 | No plan or implementation report exists for this ticket | ⏭ deferred → #229 |

All edits are in one file, `apps/driver/src/native-module-pins.test.ts`.

## The check this whole pass had to not break

M3 changes `peerViolations`' parameter type and collapses its two `.filter`s; L2 adds a
guard inside the same branch. Both sit directly on the path that detects #225. A pass that
traded nine cosmetic findings for the defect the PR exists to prevent would be worse than
no pass at all, so this ran first and last.

**Method.** The review replicated the walk against the pre-fix tree installed in the main
checkout. That tree no longer exists — both checkouts now carry `4.5.1`/`0.10.1`
(`observed` 2026-09-18), so that exact replication is not reproducible. The equivalent
available check is: feed #225's shipped versions (`reanimated 4.6.0`, `worklets 0.12.1`)
into the **real** `declaredPeerRanges()` read from the installed tree, before the edits and
after, and require byte-identical output.

**Before the edits** (`observed`, a JS replication of the walk at `6226549`, saved to the
scratchpad as `baseline-walk.txt`) and **after the edits** (`observed`, a temporary `it`
inside the real test file, calling the real `peerViolations` and `declaredPeerRanges`, then
removed) both print exactly:

```json
[
  { "consumer": "expo-modules-core", "dependency": "react-native-worklets",
    "range": "^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0", "installed": "0.12.1" },
  { "consumer": "react-native-reanimated", "dependency": "react-native-worklets",
    "range": "0.10.x", "installed": "0.12.1" }
]
```

Two, not the review's one, and the difference is not a discrepancy: the review read ranges
from the **pre-fix** tree, where `reanimated@4.6.0` declares `0.12.x` and `0.12.1` satisfies
it. These ranges come from the **fixed** tree, where `reanimated@4.5.1` declares `0.10.x`,
which `0.12.1` does not satisfy. The `expo-modules-core` violation — the one #225 is — is
identical in both, and identical across the edits.

The walk also still reports the same 5 consumers (`@expo/ui`, `expo-modules-core`,
`expo-router`, `react-native-drawer-layout`, `react-native-reanimated`) over 1247 walked
directories, matching the review's count (`observed`).

## Fixed

### M1 — assertion 4 cannot tell "no violations" from "the walk found nothing"

`peerViolations(…)` feeds `expect(…).toEqual([])`, so a walk that discovered zero consumers
passed exactly as a clean tree did — and that assertion is the only one encoding #225's
invariant. Assertions 1–3 could not cover it: they read `package.json`,
`expo/bundledNativeModules.json` and the two pinned manifests **by path**, never by
`readdirSync`.

**Fix** — a canary asserting the walk found `expo-modules-core`, which is a hard dependency
of `expo` and #225's own consumer. It names a package to prove the *mechanism*, not to
enumerate the consumer set the walk exists to discover, so it does not rebuild the blind
spot the docblock argues against.

**Test, run against the unfixed mechanism** (`observed` 2026-09-18). `packageEntries` was
temporarily changed to `readdirSync(path); return []` — a walk that reaches the filesystem
and finds nothing, which is precisely M1's window:

```
✓ no installed package declares a peer range the tree violates (expected)   ← still GREEN
✕ the peer-range walk sees the tree at all (edge)
  Expected value: "expo-modules-core"
  Received array: []
```

The old assertion staying green while the new one reds **is** the finding, demonstrated.

**New failure mode this fix introduces:** the canary hardcodes one package name, so
`expo-modules-core` disappearing from the tree reds it for a reason unrelated to peer
ranges. That is loud and correct — it means the canary itself needs rechoosing — and it is
the same trade the review prescribed. It is not a silent pass.

### M2 — "anywhere in the tree" is a guarantee the walk does not deliver

The walk reads `node_modules/<pkg>` and `node_modules/@scope/<pkg>` — one level plus one
scope level — and never descends. The docblock claimed the whole tree.

**Fix** — narrow the prose; do **not** add recursion, which is real complexity for a case
the pins themselves prevent. Docblock item 3 and the "consumers are discovered" paragraph
now say "in the repo-root `node_modules`", state the depth explicitly, and name what is
uncovered rather than implying coverage: a *consumer* nested under another package's
`node_modules`, and `spikes/gps-harness/node_modules`, which sits outside
`pnpm-workspace.yaml` and which nothing EAS builds reads.

The "stays the real check if the pins are ever removed" clause is dropped as the review
asked — with the overrides gone, assertions 1 and 2 red immediately, so clause 3 never gets
to be the survivor it claimed. What replaces it is the narrower true statement: it reads
installed versions so that a pin *replaced by a direct dependency* is still checked. The
lock-vs-manifest half of that item is load-bearing and is kept verbatim in substance.

**Figures written into the docblock, re-observed in `wt-225`'s own tree rather than
inherited from the review** (`observed` 2026-09-18, `node -e` over
`node_modules/expo/bundledNativeModules.json` and `ls -A node_modules/.pnpm`):

- `node_modules/.pnpm` holds **exactly one entry, `lock.yaml`** — under `node-linker=hoisted`
  there are no store directories at all, so there is no nested copy of either pinned package
  for the walk to miss.
- `bundledNativeModules.json` at `expo@57.0.18`: **123 entries, 22 start with a digit, 101
  are ranges.** (Used for L4.)

The review's own "373 manifests under `node_modules/*/node_modules`" is **not** copied into
the file: it is depth-specific, and a figure that cannot be compared to a count taken at a
different depth is worth less in a docblock than the qualitative statement that replaces it.

No code change, so no test. The claim it retires is verified absent by the sweep below.

### M3 — a manifest without a `version` is silently skipped, not reported

`PackageManifest.version` is optional; `installedVersions()` cast the result to
`Record<string, string>`. A pinned manifest lacking `version` therefore gave
`versions[dependency] === undefined`, and `peerViolations`' first filter dropped **every**
range declared on that package before `satisfies` saw it. Assertion 4 then passed vacuously
for it.

**Fix** — type the return `Record<string, string | undefined>`, drop the cast, and fold the
guard and the narrowing into one `flatMap` so the compiler carries it.

**The review's type claim, verified independently before being relied on** (`observed`,
`tsc 5.9.3 --strict --declaration` on an isolated reproduction): `Object.fromEntries(PINNED.map(…))`
emits `{ [k: string]: string | undefined }`. It does **not** widen to `any`, so removing the
cast needs no replacement annotation. This matches the review's refutation of the finding
originally put to it.

**Test** — a characterization case, and labelled as one in the file. It asserts `[]`, which
is what the old code returned too, so it is **not** a red-before-green regression guard and
is not presented as one. M3 is a type defect, not a behaviour defect: the review itself
notes the tree is covered today by assertion ordering (assertion 3 reds first), and this
pass does not change that ordering. What changed is that the type now states the drop out
loud instead of a cast hiding it.

The real behavioural half of "silently skipped" is the unparseable-range path, and that one
does get a red-before-green test — see L2.

### L1 — the suite title hardcodes an SDK the mechanism does not check

Every assertion reads whatever `node_modules/expo` happens to be, so after an SDK 58 bump
that keeps both digits the test would be green with a false title.

**Fix** — three sites, not the two the review named. `:196` (describe title) and `:26`
(docblock item 1) as prescribed, **plus** the `it` title at `:209`
(`"each pin equals Expo SDK 57's bundled version"`), which carries the identical false
claim. That is completing L1, not widening it. All three now say "the installed SDK".

No version assertion was added: that would re-freeze exactly what assertion 1 is designed
to leave floating.

The `expo-modules-core@57.0.14` reference in the opening paragraph is **left alone** — it
records what was observed when #225 happened, not a condition the test checks.

### L2 — a non-semver peer range is reported as a version mismatch rather than skipped

`semver.satisfies` catches an invalid `Range` internally and returns `false`, so a peer
declared as `patch:`, `workspace:*`, `catalog:` or an `npm:` alias reds the gate naming a
version conflict that does not exist.

**Mechanism verified before the fix was written** (`observed` 2026-09-18, scratch script
against `wt-225`'s `semver`). All four pnpm spec forms throw in `new Range` and return
`false` from `satisfies`; all four ranges actually present in this tree parse cleanly:

| Spec | `new Range` | `satisfies('0.10.1', …)` |
|---|---|---|
| `^0.7.4 \|\| ^0.8.0 \|\| ^0.9.0 \|\| ^0.10.0` | parses | `true` |
| `*` · `>= 2.0.0` · `0.10.x` · `0.12.x` · `0.83 - 0.86` | parses | as expected |
| `workspace:*` · `catalog:` · `npm:…` · `patch:…` | **throws** `TypeError` | `false` ← the false violation |

**Fix — the review's second option, not its first.** It offered `catch { return []; }` or
"bucket unparseable ranges into a separately named failure". The swallow would reintroduce
exactly M1's defect class one function over — a vacuous pass on a range nobody can read — so
this takes the bucket: `isSemverRange()`, an `unparseableRanges()` reporter, and its own
assertion `expect(unparseableRanges(declaredPeerRanges())).toEqual([])`. Red there means a
range needs a human, and says so, rather than naming a version.

**Test, run against the unfixed mechanism** (`observed`). The `isSemverRange` guard was
temporarily removed from `peerViolations`:

```
✕ a pnpm patch: spec is named as unreadable, not as a version conflict (failure)
  - Array []
  + Array [ { "consumer": "react-native-gesture-handler",
  +           "dependency": "react-native-worklets",
  +           "installed": "0.10.1",
  +           "range": "patch:react-native-worklets@npm%3A0.12.0-nightly#…" } ]
```

That is the false violation, reproduced.

**The near-miss is real, and re-verified rather than inherited** (`observed` 2026-09-18):
`react-native-gesture-handler@3.2.1` declares `react-native-worklets` as
`patch:react-native-worklets@npm%3A0.12.0-nightly-20260810-fb9cb5596#~/.yarn/patches/…` — in
`devDependencies`, which the walk does not read. One published package moving a spec of that
shape into `peerDependencies` is all it takes.

**New failure mode this fix introduces:** a range that is genuinely a version constraint but
which this `semver` version cannot parse would now be routed to `unparseableRanges` instead
of being checked. It is still **red** — the new assertion requires that list to be empty — so
nothing goes quiet; it reds under a different name. That is the trade, and it is the right
way round.

### L3 — `range as string` is load-bearing for the typecheck

`expect(range).toBeDefined()` throws at runtime but narrows nothing for TypeScript, so the
cast on the next line was carrying the compile.

**Fix** — replaced both with
`if (range === undefined) throw new Error('expo-modules-core no longer declares a react-native-worklets peer — the #225 case needs rewriting')`.
Narrows properly, keeps the same red, and the message says what to do.

No new test: the assertion it replaces is exercised by the case it guards, which still
passes.

### L4 — assertion 2 assumes `bundledNativeModules.json` holds exact versions

True for these two today, but not the file's habit. Docblock item 1 now states the
assumption with the arithmetic (22 of 123 entries start with a digit, the other 101 are
ranges — `observed` at `expo@57.0.18`, re-run here rather than copied) and names the
consequence: Expo writing `~4.5.1` for the same effective version would red this on a
non-regression, which is a one-line review, not a hole.

No code change, as the review asked.

## Deferred

- **L5 → [#228](https://github.com/linardsb/taxi/issues/228)** — peers declared *by* a
  pinned package (`reanimated → react-native: "0.83 - 0.86"`) are outside the guard.
  Deferred because both of the review's mitigations hold: `react-native` **is** declared by
  `apps/driver` (`0.86.3`), so `expo install --check` sees it — the blind spot #225 did not
  have — and `bundledNativeModules.json` already carries it, so the belt is one entry
  whenever it is wanted. The issue records both the one-line belt and the real
  generalisation.
- **L6 → [#229](https://github.com/linardsb/taxi/issues/229)** — no plan or execution report
  for #225/#227. A loop artifact, not a change to this PR. The issue carries the
  `system-execution-report` action and the question worth asking there: whether a
  dependency-pin ticket found by a build failure should skip the plan step at all.

## The copies sweep

M2 retires a **guarantee** ("anywhere in the tree") and L1 retires a **value** ("SDK 57").
Per the repo rule, the exact commands and their hits, run against the fixed tree
(`observed` 2026-09-18):

```
grep -rn "anywhere in the tree" apps/driver/src/native-module-pins.test.ts .claude/plans .claude/reports
  → 0 hits

grep -rn "stays the real check" apps/driver/src/native-module-pins.test.ts .claude/plans .claude/reports
  → 0 hits

grep -rn "SDK 57" apps/driver/src/native-module-pins.test.ts
  → 0 hits
grep -rn "SDK 57" .claude/plans .claude/reports
  → 30 hits across 11 files, ALL unrelated: driver-app-auth, dispatch-test-runner,
    rider-app-auth, spike-gps-field-test-ios-run, emulator-oracle-141,
    driver-device-day-prep, driver-offers-active-ride, deps-audit-backlog-180.
    Every one is about the Expo SDK itself (Xcode ceilings, bundled pins, docs links),
    none is a copy of this guard's title claim. Left alone.

ls .claude/plans .claude/reports | grep -i "225\|227"
  → no match — there is no plan or report to re-anchor. That absence IS L6, now #229.

grep -n "anywhere in the tree|SDK 57|stays the real check|9 cases"  ← on the PR BODY
  (fetched with `gh pr view 227 --json body`, since no working-tree grep reaches it)
  → 4 stale claims found, all corrected. See below.
```

**The PR body** — the surface no working-tree grep reaches, and the first thing the next
reviewer reads. Four edits, applied after the push so the gate figures in them are the ones
this commit produces:

| Where | Was | Now |
|---|---|---|
| "satisfies every range declared against it **anywhere in the tree**" | M2's retired guarantee | "in the repo-root `node_modules`" |
| "each pin equals **Expo SDK 57's** `bundledNativeModules.json` entry" | L1's retired value | "the installed Expo SDK's" |
| "every installed version satisfies every peer range declared against it **anywhere in the tree**" | M2 again | "in the repo-root `node_modules`" |
| "Three assertions over a precondition that both pins exist" | an incomplete map of a file that now has 13 cases | one added sentence naming the two structural guards that sit under assertion 3 |
| "**4 of its 9 cases** red … On the fixed tree: 9/9 green" **and its trailing parenthetical** | the suite is now 13 cases, and the parenthetical's provenance argument is falsified by this commit | "4 of its 13 cases red" (`derived`) … "13/13 green" (`observed`), each labelled inline, and the parenthetical rewritten — see below |

**The `4 of 13` figure, and why its provenance changes.** The author's `4 of 9` was
`observed` on a reverted-and-reinstalled tree at `ade96c7`. This pass did not redo that
reinstall, so the updated figure is **`derived`**, and the arithmetic is: the four red cases
are the four that read the tree and depend on the overrides — pins-present, pin-equals-bundled,
installed-equals-pin, and peer-violations. None of the four cases added here joins them:

- *the peer-range walk sees the tree at all* — `expo-modules-core` is present on either
  tree, so green;
- *no declared peer range is unreadable by semver* — the only range that differs between
  the trees is reanimated's own (`0.10.x` → `0.12.x`), and `0.12.x` parses (`observed`,
  the L2 table above), so green;
- the `patch:` case and the missing-version case take synthetic inputs and never read the
  tree, so green either way.

4 red + 9 green = 13. **Condition:** this assumes the revert is overrides-removed plus a
reinstall that restores `4.6.0`/`0.12.1`, the same operation the author ran.

**The parenthetical under that figure had to go, not just its digit.** The body read
*"(Run at `ade96c7`; `6226549` changes only this test file's directory walk, so the
reverted-tree result stands.)"* — a provenance argument, and this commit falsifies it. The
head is no longer `6226549`: this pass changes the violation machinery, the types and the
case list, so "only the directory walk moved" is no longer why the result stands. Swapping
`9` for `13` and leaving that sentence would be the failure CLAUDE.md names on #121 — the
digit re-observed, the sentence around it inherited. It now names this head and says
plainly that the reverted-tree run was **not** redone here.

The `13/13 green` half of the same sentence *is* `observed` — it is this pass's own jest
run — while the `4 red` half is `derived`. Both are labelled inline in the body, because an
unlabelled pair in one sentence reads as a single observation, and the body is the surface
the next reviewer re-runs against.

## Validation

`observed` in `~/taxi-worktrees/wt-225`, 2026-09-18.

| Check | Result |
|---|---|
| `pnpm --filter @taxi/driver run typecheck` (`tsc --noEmit`) | ✅ clean |
| `pnpm --filter @taxi/driver run lint` (`eslint .`) | ✅ clean |
| `pnpm --filter @taxi/driver exec jest src/native-module-pins.test.ts` | ✅ **13 passed, 13 total** (was 9) |
| `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | ✅ **22/22 tasks**, exit 0, 1m29.898s |

Per-package, from that same run (`observed`):

| Package | Suites | Tests |
|---|---|---|
| `@taxi/api` | 77 passed, 77 total | **733 passed, 733 total** |
| `@taxi/driver` | 43 passed, 43 total | **242 passed, 242 total** |
| `@taxi/rider` | 29 passed, 29 total | 140 passed, 140 total |

`REDIS_TEST_URL` was set, so the api figure is 733 *passed* — a gate without it reports
694 passed + 39 skipped out of the same 733 total, the split CLAUDE.md records `observed`
at `0cdb59c`. That split is inherited here, not re-run.

**`@taxi/driver` moved 238 → 242**, +4, which is exactly the four cases this pass adds:
the walk canary (M1), the unreadable-range assertion and the `patch:` case (L2), and the
missing-version characterization (M3). Suite count is unchanged at 43 — every new case
lands in the existing file. The 238 baseline is the review's own figure from CI job
`105594487337` on `6226549`.

The guard still fails in both directions after every edit: proved above for M1 (blind walk),
for L2 (pre-guard machinery), and for the #225 detection itself (identical violation output
before and after).

### Not fixed, and not deferred either

Nothing. Every finding in the review is either fixed above or filed as #228 / #229.
