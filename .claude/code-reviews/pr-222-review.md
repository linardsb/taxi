# PR #222 review — round 1

**PR**: [#222](https://github.com/linardsb/taxi/pull/222) · test(driver): bind cleartext to internal-distribution profiles
**Head** `e029183` · **Base** `main` @ `70ed34c` · base live tip `70ed34c` — **unmoved**, the guarantees pass does not apply
**Round**: 1 (no prior report) — the fix-mechanism pass does not apply
**State** (read 2026-09-17 at head `e029183`): OPEN, ready for review, `mergeStateStatus: CLEAN` · all five checks pass
**Verdict**: **Request changes** — one High, four Lows. No Critical, no hard-rule violation. **The High
is a hole in the guard itself, contained in one 13-line function; the approach is right and the fix
is small.**

## Summary

This closes [#220](https://github.com/linardsb/taxi/issues/220): `apps/driver/app.json` enables
`android.usesCleartextTraffic` for every Android build it can produce, while the decision that put it
there (the plan's Q2) is scoped to *internal-distribution* builds. JSON takes no comment, so the
remedy is a jest test holding a pairing neither file can state alone. That is the cheaper of the two
remedies the issue offered, it is wired into the gate — the part the issue said its own `nchk` sketch
was missing — and the flag itself is deliberately left alone. All three calls are right.

**The deviation from the issue's sketch is an improvement, and the EAS schema backs it.** The issue
proposed `nchk apps/driver/eas.json '"(production|development)"'` — a check on profile *names*. This
PR checks the resolved `distribution` instead. Profile names carry no semantics in EAS; `distribution`
is a typed schema key. Treating an omitted value as `store` is likewise sourced rather than guessed:
`eas-json/src/build/schema.ts:49` is `Joi.string().valid('store','internal').default('store')`.

**F1 is that the resolution is incomplete, and it breaks in both directions.** EAS lets a build
profile carry `distribution` inside its platform-specific `android` block, where it **wins** over the
profile-root value. The flag being guarded is Android-only. So the resolver misses the one shape that
ships cleartext to a store while keeping the guard green — and it also reds the gate on a
legitimately internal Android-only profile. Both verified by live mutation below.

**Everything I could re-derive in the PR body reproduces.** Twenty-one figures checked against my own
runs: the 22-task gate, the six `<NONEXISTENT>` task names verbatim, all six per-package test counts,
the Redis-gated 733/0-skipped, three of the four mutation-table rows re-run from scratch, the driver
suite's exact growth, and the three diff sizes. **Zero discrepancies.** The `expo export` claim I
discharged by mechanism rather than by re-running it — see *Claims re-derived*. On a repo where the
numbers pass has caught a false figure two tickets running, this one is clean.

---

## Findings

### F1 · High — `resolveDistribution` is blind to `android.distribution`, and errs in both directions

`apps/driver/src/build-config.test.ts:30-33` (`BuildProfile`), `:61-73` (`resolveDistribution`), `:76-81` (`nonInternalProfiles`)

`BuildProfile` declares only `distribution` and `extends`, and the resolver reads only
`profile.distribution` at each hop. EAS build profiles may *also* set `distribution` inside the
platform block, and that value takes precedence over the root one:

- **Schema** — `eas-json/src/build/schema.ts:154` wires `android: AndroidBuildProfileSchema`;
  `AndroidBuildProfileSchema` is `PlatformBuildProfileSchema.concat(…)`, which is
  `CommonBuildProfileSchema.concat(…)`, which carries `distribution` at `:49`. So
  `build.<profile>.android.distribution` is a **valid key**, not an unknown one EAS would reject.
- **Types** — `eas-json/src/build/types.ts:125-129`: `EasJsonBuildProfile` nests
  `Partial<AndroidBuildProfile>`, which extends `Omit<CommonBuildProfile,'autoIncrement'>`, which
  declares `distribution: DistributionType` at `:49`.
- **Resolver** — `eas-json/src/build/resolver.ts:23-27` destructures `{android, ios, ...base}` and
  returns `mergeProfiles(base, easJsonProfile[platform] ?? {})`. The platform block is the *update*
  side of the spread, so `android.distribution` overrides the root. The docs agree: *"You can specify
  common properties both in the platform-specific configuration object or at the profile's root"* and
  *"The platform-specific options take precedence over globally-defined ones."*

**`observed`** — three mutations at `e029183`, each run against the committed test file and reverted
(`git status` clean after each):

| Mutation of `apps/driver/eas.json` | `pnpm exec jest src/build-config.test.ts` | EAS-effective Android distribution | Verdict |
|---|---|---|---|
| `preview` keeps root `"distribution": "internal"`, gains `"android": { "buildType": "apk", "distribution": "store" }` | **PASS** · 6 passed | `store` | **false negative** |
| `preview` extends a `base` whose `android.distribution` is `"store"` | **PASS** · 6 passed | `store` | **false negative** |
| `preview` drops the root key, keeps `"android": { "buildType": "apk", "distribution": "internal" }` | **FAIL** · 1 failed, 5 passed — flags `preview` as `store (EAS default)` | `internal` | **false positive** |

Rows 1–2 are release-variant Android builds distributed through a store, inheriting `main/
AndroidManifest.xml` with cleartext on — the exact outcome #220 exists to prevent — and the gate stays
green. Row 3 reds the gate on a profile that is genuinely internal. A guard that fails both ways is a
correctness defect, not missing hardening.

**Why High rather than Medium.** `eas.json:12-14` *already has* an `android` block on `preview` —
`buildType` lives there. Someone adding a store profile reaches for that block, not the profile root,
so the bypass is the ergonomic shape rather than an exotic one. And the PR asserts the guarantee in
absolute terms on four surfaces, each false for this case:

- `apps/driver/src/build-config.test.ts:26-27` — *"`distribution` is the condition the plan's sentence actually rests on"*
- `.claude/plans/driver-device-day-prep.md:613-614` — *"fails if any profile here resolves to a distribution other than `internal`"*
- `.claude/plans/driver-device-day-prep.md:1037-1039` — *"fails if any `eas.json` profile resolves (through `extends`) to a distribution other than `internal`"*
- the PR body — *"every `eas.json` build profile resolves to `distribution: \"internal\"` — following `extends`, and treating an omitted value as EAS's `store` default"*

Per `CLAUDE.md`, retiring the claim means retiring its **subject** on every surface including the PR
body, which is the one not in the working tree.

**Fix — mirror EAS's own two-stage resolution, and mind the order.** Merge the whole `extends` chain
first (child over parent), *then* let the platform block beat the root within the merged profile:

```ts
interface BuildProfile {
  distribution?: string;
  extends?: string;
  android?: { distribution?: string };
}

/** The `extends` chain, child first; stops on a cycle or a dangling name. */
const chain = (build: Record<string, BuildProfile>, name: string): BuildProfile[] => {
  const out: BuildProfile[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = name;
  while (cur && build[cur] && !seen.has(cur)) {
    seen.add(cur);
    out.push(build[cur]);
    cur = build[cur].extends;
  }
  return out;
};

/**
 * EAS merges `extends` child-over-parent first, then lets a platform-specific value
 * beat the root value in the merged profile (eas-json/src/build/resolver.ts:19-28).
 * Cleartext is an Android manifest attribute, so only android's answer bears on this.
 */
const resolveDistribution = (
  build: Record<string, BuildProfile>,
  name: string,
): string => {
  const profiles = chain(build, name); // child first
  return (
    profiles.find((pr) => pr.android?.distribution)?.android?.distribution ??
    profiles.find((pr) => pr.distribution)?.distribution ??
    'store' // eas-json/src/build/schema.ts:49
  );
};
```

The naive shortcut — *at each level, prefer `android.distribution`, else `distribution`* — is
**wrong**, and mutation row 2 is the counter-example: a child's root `internal` must not beat a
parent's `android.distribution: "store"`, because EAS merges the chain before it applies platform
precedence. Resolve `android` only; `ios.distribution: "store"` carries no cleartext risk and
flagging it would over-constrain a file the plan wants left alone.

Since the resolver now always returns a string, `:98`'s `?? 'store (EAS default)'` goes dead — my
probe simply dropped it, which changes the failure label from `store (EAS default)` to `store`.
Restore the parenthetical at the reporting site if the distinction is worth keeping. Add the two
cases the gap leaves untested:

```ts
it('an android-scoped store distribution beats an inherited root internal (failure)', () => {
  expect(nonInternalProfiles({ build: {
    base: { android: { distribution: 'store' } },
    preview: { extends: 'base', distribution: 'internal' },
  }})).toEqual(['base', 'preview']);
});

it('an android-only internal distribution is not flagged (edge)', () => {
  expect(nonInternalProfiles({ build: {
    preview: { android: { distribution: 'internal' } },
  }})).toEqual([]);
});
```

**This prescription was run, not reasoned.** A review's proposed fix is a claim like any other
(memory `taxi-review-payoffs-are-claims`), so I applied the resolver and both new cases to the tree at
`e029183`, probed five `eas.json` shapes against it and re-ran the toolchain, reverting after
(`git status` clean):

| Tree under the fixed resolver | Result |
|---|---|
| committed `eas.json` / `app.json` | **8 passed** — all four original synthetic cases survive unchanged |
| `preview` root `internal` + `android.distribution: "store"` | **FAIL** · 1 failed, 7 passed — flags `preview` as `store` |
| `preview` extends a `base` whose `android.distribution` is `"store"` | **FAIL** · flags both `base` and `preview` |
| `preview` with `android.distribution: "internal"` and no root key | **8 passed** — the false positive is gone |
| a plain `production: {}` store profile | **FAIL** · flags `production` as `store` — the original catch is not regressed |
| `pnpm exec tsc --noEmit` · `pnpm exec eslint src/build-config.test.ts` | both clean |

The fix stays inside the test file. It does **not** require adding a profile, so it does not touch the
plan's `:588` constraint (*"Do not invent a `production` or `development` profile"*), which I checked
under the constraint pass.

### F2 · Low — the retirement instruction is wrong for the very future the plan names

`apps/driver/src/build-config.test.ts:88-90` vs `.claude/plans/driver-device-day-prep.md:1039-1040`

The docblock tells a future reader: *"If this goes false the flag is gone and this whole file should
go with it."* But the plan, **in this same PR**, names the intended future remedy as scoping cleartext
through a dynamic `app.config.ts`. In exactly that future, `cleartextEnabled(app)` at `:91` goes false
because the flag *moved*, not because it went away — cleartext is still on for some profile — and the
instruction says delete the guard.

`cleartextEnabled` reads only `app.json`'s `plugins` array. I checked whether Expo's app config offers
a second static route to the same flag, which would make the premise bypassable today: it does not.
`grep -rn usesCleartextTraffic node_modules/@expo/config-types/` returns **0** hits; the key exists
only at `node_modules/expo-build-properties/build/pluginConfig.d.ts:162`. So the narrow check is
correct *now*. The uncovered routes are all future ones: `app.config.ts`/`app.config.js` (which Expo
prefers over `app.json`; **`observed`** — neither exists in `apps/driver` today), a custom
`withAndroidManifest` plugin, and an ejected `android/` tree.

Two one-line fixes. Reword `:88-90` to require checking the *effective* config before retiring the
guard — *"confirm the flag is gone from `npx expo config --type prebuild --platform android`, not
merely moved to `app.config.ts`"*. And soften `:45`'s *"True when the config enables Android cleartext
for every build it produces"* to say **this `app.json`**, not *the config*.

### F3 · Low — `cleartextEnabled`'s strict `=== true` is unpinned; a silently-true premise survives every case

`apps/driver/src/build-config.test.ts:46-53`, `:87-92`

All six cases are distinct and all six can fail, but five exercise `nonInternalProfiles` only.
`cleartextEnabled` gets exactly one input — the real `app.json` — asserted `true`. The direction that
matters is a premise that silently reports enabled when it is not, and nothing pins it.

**`observed`** — mutating `:52` from `=== true` to `!== undefined` (key-presence only), reverted after:

| Tree | `pnpm exec jest src/build-config.test.ts` |
|---|---|
| mutated resolver, `app.json` unchanged | **6 passed** — mutation survives the whole file |
| mutated resolver, `app.json` set to `usesCleartextTraffic: false` | **6 passed** — the guard reports cleartext on while it is explicitly off |
| unmutated resolver, `app.json` set to `usesCleartextTraffic: false` (control) | **1 failed**, 5 passed |

The control shows the strict comparison works today; rows 1–2 show nothing would tell you if it
stopped. One negative case closes it — note the annotation, or TS widens the literal out of the tuple:

```ts
it('a plugin entry that turns cleartext off is not read as enabled (failure)', () => {
  const entry: PluginEntry = ['expo-build-properties', { android: { usesCleartextTraffic: false } }];
  expect(cleartextEnabled({ expo: { plugins: ['expo-router', entry] } })).toBe(false);
});
```

### F4 · Low — the `as unknown as` on `easJson` is what let F1 through

`apps/driver/src/build-config.test.ts:84-85`

`as unknown as EasConfig` switches off the one check that would have surfaced F1's shape mismatch:
`EasConfig`/`BuildProfile` are never compared against the real `eas.json`, so the missing
`android.distribution` field is invisible to typecheck, and future drift in `eas.json` stays invisible
too.

The `appJson` cast at `:84` is genuinely required — the inferred `plugins` type is comparable in
neither direction with `PluginEntry[]`, and `expo-build-properties` does not re-export
`PluginConfigType` from its package entry, so the honest alternative is a deep subpath import. Leave
`:84` alone. For `:85` only: once `BuildProfile` gains `android` per F1, check whether a plain
`easJson as EasConfig` (or `const eas: EasConfig = easJson`) compiles, and drop the `unknown` hop if
it does — that keeps the check live for the next schema change.

### F5 · Low — the plan describes the pairing as a conjunction; the code evaluates the halves independently

`.claude/plans/driver-device-day-prep.md:613-615` and `:1037-1039`

Both plan paragraphs read *"…other than `internal` **while** `app.json` still enables cleartext
app-wide"*, which describes a conditional. In the code, `nonInternalProfiles` is computed
unconditionally — the profile assertion would still fail in a tree where cleartext had been removed.

**That decoupling is right and should stay.** Making the profile check read the premise would be
strictly worse: deleting the flag from `app.json` would then silently disarm the profile guard. The
offender message at `:99` already names both remedies (*"this profile must be internal, or the flag
must be scoped"*), so a red gate with cleartext off still gives correct advice. The PR body argues
the decoupling is deliberate; the plan is the surface that persists, and it reads the other way. One
clause in both spots saying the profile check is unconditional **by design** removes the ambiguity at
no cost.

---

## Validation

**`observed`** — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run
typecheck lint test build --force`, run by this review in `wt-220` at `e029183` from cleared
`dist`/`.next`, **exit 0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m36.179s
```

| Package | Suites | Tests | PR body claims | Match |
|---|---|---|---|---|
| `@taxi/shared` | 24 files | 231 passed | 24 / 231 | ✅ |
| `@taxi/dispatch` | 27 files | 224 passed | 27 / 224 | ✅ |
| `@taxi/rider` | 29 suites | 140 passed | 29 / 140 | ✅ |
| `@taxi/driver` | 42 suites | 224 passed | 42 / 224 | ✅ |
| `@taxi/db` | 3 files | 17 passed | 3 / 17 | ✅ |
| `@taxi/api` | 77 suites | 733 passed, 0 skipped | 77 / 733, 0 skipped | ✅ |

`REDIS_TEST_URL` was set, so the api suite ran its gated specs — 733 passed, 0 skipped, matching the
PR body and consistent with `CLAUDE.md`'s 694 + 39 skipped = 733 without it.

GitHub checks at `e029183`: `CodeQL` pass · `audit-diff` pass · `check` pass (3m31s) · `codeql` pass ·
`ready` pass. Five of five.

## Claims re-derived

| Claim | Check | Result |
|---|---|---|
| `Tasks: 22 successful, 22 total` | my own gate run | ✅ 22/22 |
| the six `<NONEXISTENT>` task names | `turbo run … --dry=json`, filtered | ✅ all six verbatim |
| six per-package test counts | my own gate run | ✅ 6 of 6 |
| api 733 passed / 0 skipped with `REDIS_TEST_URL` | my own gate run | ✅ |
| `39 skipped` without it | `CLAUDE.md`'s recorded observation | ✅ consistent |
| mutation row 1 — `production` with no `distribution` key → FAIL, 1 failed / 5 passed | re-run, reverted | ✅ exact, names `production` and `store (EAS default)` |
| mutation row 2 — `production` with `"distribution": "store"` → FAIL, 1 failed / 5 passed | re-run, reverted | ✅ exact |
| mutation row 3 — `production` with `extends: "preview"` → PASS, 6 passed | the file's own `:104-113` edge case + my F1 probe 2 | ✅ corroborated |
| mutation row 4 — `app.json` loses `expo-build-properties` → FAIL, 1 failed / 5 passed | re-run, reverted | ✅ exact, the premise case alone |
| the file's six new cases are the whole of the driver suite's growth | `pnpm exec jest --testPathIgnorePatterns "build-config"` at `e029183` → `41 passed, 218 passed`, vs `42 / 224` full | ✅ +1 suite, +6 tests, nothing else moved |
| `+152` / `141 lines` / `+11 lines` | `git diff --stat origin/main...HEAD`, `wc` | ✅ |
| `Time: 1m26.323s` | not comparable — wall clock differs per machine and cache state (mine: 1m36.179s) | — |
| `expo export`: 1504 modules, `build-config` 0, `app.json` 0, `eas.json` 0, `.test.` 0 | **mechanism, not re-run** | ✅ true by construction |

On that last row: I did not re-run `expo export`. I checked the mechanism instead, which is stronger
than reproducing a count. `grep -rn "build-config" apps/driver/src` returns **no importer** outside the
file itself; the only thing that reaches it is jest's `testMatch` (`apps/driver/package.json:68-71`,
`<rootDir>/src/**/*.test.ts`); Metro traverses from `expo-router/entry` (`package.json:4`); and
expo-router's `require.context` is scoped to `src/app/**` (`apps/driver/CLAUDE.md:23`). A module with
zero importers cannot enter a bundle built by graph traversal, so `eas.json`'s hardcoded LAN origin
cannot ride in through this edge regardless of what any particular export prints. The PR was right to
ask the question and right about the answer.

## Checked and clear

- **Typecheck of the JSON imports.** `expo/tsconfig.base` sets `resolveJsonModule: true` (`:15`), and
  imported JSON enters the program through module resolution regardless of `include`. Importing
  `../app.json` from inside `src/` is fine.
- **Lint.** `apps/driver/eslint.config.mjs` turns `max-lines` off for `**/*.test.ts`; at 141 lines it
  would not have mattered anyway. `CLAUDE.md`'s 500-line cap explicitly exempts `.test.ts`.
- **Gate inclusion.** The plan's *"now runs in the gate"* (`:613`) is accurate: `turbo.json` defines
  `test`, `@taxi/driver` has `"test": "jest"`, and `testMatch` picks the file up — confirmed by the
  218 → 224 delta above.
- **Placement.** `src/config.test.ts` + `src/config.ts` is the established home for app-wide,
  non-slice concerns. More decisively, `testMatch` is `<rootDir>/src/**/*.test.ts`, so a test anywhere
  else would not run at all — `src/` is forced, not chosen. Worth one docblock sentence saying so,
  since this is the first test in `src/` with no sibling module.
- **The operator's local `env` edit.** The guard asserts only on `distribution`, so the plan's
  expectation that the LAN-origin edit stays locally dirty (`:583-586`) will not turn the gate red.
- **Hard rules.** No money handling, no ride-status writes, no payment-method path, no
  `packages/shared` contract touched, no provider SDK imports, no user-facing strings, no PII logging.
- **Out of scope, correctly.** `eas.json` profiles do not bound *every* Android build — a local
  `expo run:android --variant release` produces a cleartext release APK with no profile involved — but
  that is the right scope for a pre-pilot solo repo.

## What is good

- **The deviation is the best decision in the PR**, argued from the condition the plan's sentence
  rests on rather than the shape the issue happened to sketch. The EAS schema backs it: profile names
  are free-form, `distribution` is typed.
- **`store` as the omitted default is sourced, not assumed** — it matches
  `eas-json/src/build/schema.ts:49` exactly.
- **The docblock's factual claims hold up — every one checked.** `transports: ['websocket']` with no
  polling fallback is at `apps/driver/src/features/location/socket.ts:30`. The missing
  `release/AndroidManifest.xml` matches the `observed` prebuild table at plan `:628-632`. And
  *"plain HTTP to the origin was rejected for #13 because OTP codes and JWTs would cross in the
  clear"* is verbatim at `docs/epics/sakta-cab.architecture.md:90`, including that reasoning. On a
  repo whose own rules say claims in comments get inherited unaudited, these were worth checking and
  they survived.
- **The mutation table is real evidence and it holds.** Three rows re-run from scratch, all exact,
  down to the `store (EAS default)` label in the failure output. `CLAUDE.md` asks for `observed`
  figures with a named run; this PR delivered them and they survived re-observation.
- **The failure message is engineered** — profile name, resolved distribution, and the fix, rather
  than an empty-array diff a future reader would have to decode.
- **The cycle arm** (`:67`) is a real defence with a sound stated reason. EAS itself throws at depth
  ≥ 5 (`resolver.ts:40-44`), so a cycle is unreachable in a config EAS would accept — this fails safe
  on a hand-edited one instead of recursing.
- **Leaving the flag alone is the right trade**, and it is argued rather than assumed: scoping needs a
  dynamic `app.config.ts`, which is worse until a second profile exists.
- **The plan amendment is honest about what it did not do** (`:1039-1040`) — the flag is unchanged and
  the deferral is named, not quietly skipped.

## Recommendation

**Request changes** for F1. The approach is right and the evidence discipline is the strongest I have
reviewed on this repo. But the PR states a guarantee on four surfaces that one valid `eas.json` shape
defeats, and that shape is the ergonomic one for anyone adding an Android store profile — which is the
only event this guard exists for. The same gap reds the gate on a legitimate android-only internal
profile, so it is wrong in both directions rather than merely incomplete.

F1's fix is confined to `resolveDistribution` plus two test cases, after which the claim's subject
needs retiring on all four surfaces — the docblock, the two plan paragraphs, and the PR body. F2–F5
are one-line changes; take or leave them.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01RfRZkpCRBwk1wxjZbrUKK7
