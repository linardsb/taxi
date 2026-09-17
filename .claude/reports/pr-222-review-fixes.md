# PR #222 — review round 1 fixes

**PR**: [#222](https://github.com/linardsb/taxi/pull/222) · `test/220-cleartext-internal-distribution-guard`
**Review**: `.claude/code-reviews/pr-222-review.md` on [#223](https://github.com/linardsb/taxi/pull/223) (`884627a`), posted as [a PR comment](https://github.com/linardsb/taxi/pull/222#issuecomment-5720442561) plus [two wording corrections](https://github.com/linardsb/taxi/pull/222#issuecomment-5720442561)
**Base of the fixes**: `e029183` · worktree `wt-220`, clean on entry (`git status --porcelain` empty, no `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD`)
**Verdict**: **all five fixed, none deferred.** One High (F1) and four Lows.

## Triage

| # | Severity | Call | Why |
|---|---|---|---|
| F1 | High | **Fixed** | Real correctness defect, confined to the test file. Primary source confirms the mechanism. |
| F2 | Low | **Fixed** | Two rewordings, no behaviour. |
| F3 | Low | **Fixed** | One negative case; the review's documented mutation genuinely survived. |
| F4 | Low | **Fixed** | The direct cast compiles once `BuildProfile` gains `android`. |
| F5 | Low | **Fixed** | One clause in each of two plan paragraphs. |

Nothing was deferred, so no tracker issue was opened.

---

## F1 · High — `resolveDistribution` was blind to `android.distribution`

### What was wrong

`BuildProfile` declared only `distribution` and `extends`, and the resolver read only
`profile.distribution` at each hop of the `extends` chain. EAS build profiles may also set
`distribution` inside the platform block, where it outranks the profile root. Cleartext is an Android
manifest attribute, so `android.distribution` is the value that actually decides whether a build the
guard passes is store-distributed. The guard was therefore wrong in both directions: green on a
store-distributed Android build, red on a legitimately internal android-only profile.

### The mechanism, read from the package rather than inferred

`observed` — read 2026-09-17 from `@expo/eas-json@24.5.0`
(`/Users/Berzins/.npm/_npx/9845298b0950620f/node_modules/@expo/eas-json`, version confirmed by
`node -e "console.log(require('<pkg>/package.json').version)"` → `24.5.0`):

| Fact | Where | What it says |
|---|---|---|
| Platform block beats the profile root | `build/build/resolver.js:11-12` | `const {android, ios, ...base} = easJsonProfile;` then `mergeProfiles(base, easJsonProfile[platform] ?? {})` — the platform block is the *update* side |
| `extends` merges child-over-parent | `build/build/resolver.js:37` | `return mergeProfiles(baseProfile, rest)` — `rest` is the child |
| `android` **deep-merges** key-by-key | `build/build/resolver.js:54-56` | `if (base.android && update.android) result.android = mergeProfiles(base.android, update.android)` |
| Omitted `distribution` defaults to `store` | `build/build/schema.js:44` | `joi.string().valid('store','internal').default('store')` |
| EAS itself rejects cycles and dangling parents | `build/build/resolver.js:16-18`, `:27` | throws at depth ≥ 5 and on a missing parent |

The deep merge at `:54-56` is the fact that makes the fix's shape correct: because `android` merges
key-by-key up the whole chain, an `android.distribution` **anywhere** in the chain outranks a root
`distribution` **anywhere** in it. The review cited these same lines from the package's `src/`; the
citations in the shipped docblock name the built JS I actually opened.

### The fix

Two stages in EAS's own order, in `apps/driver/src/build-config.test.ts`:

- `BuildProfile` gains `android?: { distribution?: string }`.
- A new `extendsChain()` collects the chain child-first, stopping on a cycle or a dangling parent.
- `resolveDistribution()` searches that chain for an `android.distribution` first, then for a root
  `distribution`, falling back to `undefined`.

**The return type stays `string | undefined`** rather than the review's always-`string` sketch. That
keeps `?? 'store (EAS default)'` at the reporting site live, so the offender label — and with it the
PR body's mutation row 1, already `observed` — stays true. The review offered this as the alternative
("Restore the parenthetical at the reporting site if the distinction is worth keeping"); keeping
`undefined` is the smaller change and re-stales nothing.

The naive per-level shortcut (*prefer `android.distribution`, else `distribution`, at each level*) is
**wrong** and is pinned against below.

### Proof: the new cases fail against the unfixed resolver

`observed` — 2026-09-17, the fixed test file with the **pre-fix single-pass resolver** spliced back in,
`pnpm exec jest src/build-config.test.ts` from `apps/driver`:

```
✕ an android-scoped store distribution is caught on the profile itself (failure)
✕ an inherited android store distribution beats a nearer root internal (failure)
✕ an android-only internal distribution is not flagged (edge)
✕ an inherited android internal beats a nearer root store (edge)
Tests: 4 failed, 7 passed, 11 total
```

All four new F1 cases fail without the fix and pass with it. (F3's new case passes against the unfixed
resolver — see F3; its defect is the missing test, not the code.)

### The fix's own new failure mode, and the test for it

**What new failure mode does this fix's mechanism have?** It errs the *other* way: a chain-wide search
implemented per level would let a child's root value beat a parent's `android` one — over-flagging a
profile EAS resolves to `internal`, reddening the gate on a compliant config. F1 was a both-directions
defect; the fix must be pinned in both directions too.

`observed` — 2026-09-17, `resolveDistribution` replaced with the per-level shortcut
(`profile.android?.distribution ?? profile.distribution` at each hop), same 11 cases:

```
✕ an inherited android store distribution beats a nearer root internal (failure)
✕ an inherited android internal beats a nearer root store (edge)
Tests: 2 failed, 9 passed, 11 total
```

`an inherited android internal beats a nearer root store (edge)` exists only for this. Under the
shipped two-stage resolver it is `[]`; under the shortcut it is `['preview']`. Hand-traced against EAS
for the same input: `resolveProfile` merges `base` into `preview` — `base.android` survives because
`update.android` is absent (`:54`'s guard needs both sides), giving
`{distribution:'store', android:{distribution:'internal'}}` — then `:11-12` lets the platform block
win, so EAS resolves `internal` and `[]` is the correct answer.

---

## F2 · Low — the retirement instruction was wrong for the future the plan names

**What was wrong.** The docblock told a future reader *"If this goes false the flag is gone and this
whole file should go with it"*, but the plan in this same PR names a dynamic `app.config.ts` as the
intended remedy. In exactly that future the premise goes false because the flag **moved**, not because
it went away, and the instruction says delete the guard.

**Fixed.** `:45`'s *"the config"* is now *"this `app.json`"*, scoping the claim to what the function
actually reads. The `:88-90` comment now requires reading the *effective* config before retiring
anything, and names the three routes the static read cannot see (`app.config.ts`, a
`withAndroidManifest` plugin, an ejected `android/` tree).

Per the review's own correction, `npx expo config --type prebuild --platform android` was `expected`,
not run — so the reworded comment prescribes the general check (read the effective config) rather than
that command. **Not run here either**, and nothing in the tree now cites it.

---

## F3 · Low — `cleartextEnabled`'s strict `=== true` was unpinned

**What was wrong.** `cleartextEnabled` had exactly one input — the real `app.json`, asserted `true`.
A premise that silently reports enabled when cleartext is off would have survived the whole file.

**Fixed.** One negative case: `a plugin entry that turns cleartext off is not read as enabled (failure)`.

**Proof it bites.** `observed` — 2026-09-17, `:52` mutated from `=== true` to `!== undefined` (the
exact mutation the review documented as surviving), `pnpm exec jest src/build-config.test.ts`:

```
✕ a plugin entry that turns cleartext off is not read as enabled (failure)
Tests: 1 failed, 10 passed, 11 total
```

The review recorded this mutation surviving all six original cases. It now dies.

---

## F4 · Low — the `as unknown as` on `easJson` is gone

**What was wrong.** `easJson as unknown as EasConfig` switched off the only check that compares
`BuildProfile` against the real `eas.json`, which is what let F1's shape mismatch through and would
hide future drift.

**Fixed.** `:85` is now `const eas = easJson as EasConfig;`. `appJson`'s cast at `:84` is left alone,
as the review advised — it is genuinely required.

**Proof the check is live, both directions.** `observed` — 2026-09-17, `eas.json`'s
`"distribution": "internal"` temporarily changed to the number `123` (simulated schema drift),
`pnpm exec tsc --noEmit` from `apps/driver`, `eas.json` restored after:

| Cast at `:85` | `tsc --noEmit` |
|---|---|
| `easJson as EasConfig` (shipped) | **exit 2** · `TS2352 … Types of property 'distribution' are incompatible. Type 'number' is not comparable to type 'string'.` |
| `easJson as unknown as EasConfig` (pre-fix control) | **exit 0** · drift invisible |

---

## F5 · Low — the plan read as a conjunction; the code evaluates the halves independently

**What was wrong.** Both plan paragraphs read *"…other than `internal` **while** `app.json` still
enables cleartext app-wide"*, describing a conditional. `nonInternalProfiles` is computed
unconditionally. The review's call — that the decoupling is right and should stay, and only the plan's
wording needs fixing — is taken as written.

**Fixed.** Both paragraphs now say the two halves are checked **independently by design**, and give
the reason: coupling them would let deleting the flag silently disarm the profile guard. No code
changed.

---

## The sweep — checkable, per `CLAUDE.md`

F1's fix does not retire a *number*; it widens a **scope**. The guarantee became true, and its
description on four surfaces became incomplete: each said the resolution follows `extends`, with no
mention of platform precedence. Retired subject: the phrase describing the resolution as
`extends`-only.

`observed` — 2026-09-17, run from `wt-220` after the edits (`git grep` over tracked files, so
`node_modules` cannot enter; path-only exclusion per memory `taxi-review-payoffs-are-claims`):

| Command | Hits before | Hits after | Surface |
|---|---|---|---|
| `git grep -n --fixed-strings 'through \`extends\`'` | 1 — plan `:1038` | **0** | plan Q2 paragraph |
| `git grep -n --fixed-strings 'following \`extends\`'` | 0 in tree — **1 in the PR body** | **0** in tree; PR body corrected | PR body "What changed" |
| `git grep -n --fixed-strings 'resolves to a distribution'` | 2 — plan `:614`, `:1038` | 2, both now naming the `android` block | both plan paragraphs |
| `git grep -n --fixed-strings 'as unknown as' -- apps/driver/src/build-config.test.ts` | 2 — `:84` `appJson`, `:85` `easJson` | **1** — `:120` `appJson` only | the test file (F4) |
| `git grep -n --fixed-strings 'store (EAS default)'` | 1 — test `:98` | **1** — test `:136` | label deliberately **kept**, so the PR body's mutation row 1 stays true |

The fourth surface — the docblock — is the resolver's own; `:25-29` and the `resolveDistribution`
docblock now both name the platform block.

**The PR body is the surface no working-tree grep reaches.** Corrected there: the `extends`-only
description of the resolution, and the four figures the fix moved. Each is re-derivable at the pushed
head with the command named beside it in the body; they are not restated here, deliberately — a report
that quotes the PR body's size table is stale by construction (memory
`taxi-report-restating-pr-body-figures`).

---

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck
lint test build --force`, run in `wt-220` from cleared `dist`/`.next`:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m29.057s
```

**exit 0.** Per-package, from the same run:

| Package | Suites | Tests | vs the PR body at `e029183` |
|---|---|---|---|
| `@taxi/shared` | 24 files | 231 passed | unchanged |
| `@taxi/dispatch` | 27 files | 224 passed | unchanged |
| `@taxi/rider` | 29 suites | 140 passed | unchanged |
| `@taxi/driver` | 42 suites | **229 passed** | **+5** — the five cases added by F1 and F3 |
| `@taxi/db` | 3 files | 17 passed | unchanged |
| `@taxi/api` | 77 suites | 733 passed, 0 skipped | unchanged |

`REDIS_TEST_URL` was set, so the api suite ran its gated specs: 733 passed, 0 skipped — matching
`CLAUDE.md`'s recorded 694 + 39 skipped = 733 without it.

**The PR body's four mutations were re-run against the fixed tree**, not inherited. `observed`
2026-09-17, each applied to `apps/driver/` and reverted (`git status --porcelain` clean after,
showing only the two intended files and this report):

| Mutation | Before (PR body, 6 cases) | After (fixed tree, 11 cases) |
|---|---|---|
| `production` with an `android` block, no `distribution` key | FAIL · 1 failed, 5 passed · names `production`, `store (EAS default)` | **FAIL · 1 failed, 10 passed** · still names `production` and `store (EAS default)` |
| `production` with `"distribution": "store"` | FAIL · 1 failed, 5 passed | **FAIL · 1 failed, 10 passed** |
| `production` with `"extends": "preview"` | PASS · 6 passed | **PASS · 11 passed** |
| `app.json` loses `expo-build-properties` | FAIL · 1 failed, 5 passed · the premise case alone | **FAIL · 1 failed, 10 passed** |

Every row keeps its verdict; only the pass counts move, by the five added cases. Row 1 keeping the
`store (EAS default)` label is the check that the `string | undefined` return decision held.

Per-file, from `apps/driver`, all `observed` 2026-09-17 against the final tree:

| Command | Exit | Output |
|---|---|---|
| `pnpm exec jest src/build-config.test.ts` | 0 | `Test Suites: 1 passed` · `Tests: 11 passed, 11 total` |
| `pnpm exec tsc --noEmit` | 0 | no output |
| `pnpm exec eslint src/build-config.test.ts` | 0 | no output |

Two `prettier/prettier` errors on the first lint (`107:24`, `147:12`) were cleared with
`eslint --fix`; the re-check above is post-fix.

Every mutation probe in this report was reverted; `git status --porcelain` in `wt-220` shows only the
two intended files.

## Needs a human look

- **The review's own text has an arithmetic slip, and it is not on this branch.** F1's *"why High"*
  says *"that is what the **five** mutations show"* and then cites rows 1–3; the F1 mutation table has
  **three** rows (the five-row table is the separate *fix probe*). The posted correction comment
  repeats *"the five mutations alone"*. This lives in `884627a` on `docs/pr-222-review` (PR #223), not
  in #222, so it is left for you rather than edited from here.
- **Nothing else.** No manual device test is implied by these fixes — the guard is static config
  analysis and never reaches a build.

## Shipped

| | |
|---|---|
| **Fixes commit** | `c7e19c2` · `test(driver): PR #222 review round 1 — apply F1-F5 (#220)` |
| **Pushed to** | `origin/test/220-cleartext-internal-distribution-guard` (`e029183..c7e19c2`), remote head verified by `git ls-remote` |
| **PR** | [#222](https://github.com/linardsb/taxi/pull/222) updated — body re-anchored at `c7e19c2` |
| **Files** | `apps/driver/src/build-config.test.ts` (F1-F4) · `.claude/plans/driver-device-day-prep.md` (F5 + sweep) · this report |

A follow-up commit completes this section, which `c7e19c2` carried as a placeholder. Sizes are
deliberately not quoted here — re-derive with `git diff --numstat origin/main...HEAD`, which is true
at whatever the head is when you read it (memory `taxi-report-restating-pr-body-figures`).

### Closing commands, run against the fixed tree

Every one below was run **after** the last edit it describes, not before it (PR #150 L5's failure
mode). All `observed` 2026-09-17 in `wt-220`.

| Finding | Closing command | Result |
|---|---|---|
| F1 | `pnpm exec jest src/build-config.test.ts` | `Tests: 11 passed, 11 total` |
| F1 | same file with the pre-fix resolver spliced in | `4 failed, 7 passed` — the four new cases are real, not decoration |
| F1 | same file with the per-level shortcut | `2 failed, 9 passed` — the new failure mode is pinned |
| F2 | `git grep -n --fixed-strings 'expo config' -- apps/driver/src/build-config.test.ts` | 0 hits — the reworded comment prescribes reading the effective config, not a specific command |
| F2 | `git grep -n --fixed-strings 'expo config --type prebuild --platform android' -- . ':!<this report>'` | 0 hits — the `expected`, never-run invocation appears nowhere in the tree |
| F3 | `=== true` mutated to `!== undefined`, jest | `1 failed, 10 passed` |
| F4 | `eas.json` drift + `pnpm exec tsc --noEmit` | exit 2, `TS2352`; exit 0 under the pre-fix cast |
| F5 | `git grep -n --fixed-strings 'through \`extends\`'` | 0 hits |
| all | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | exit 0, `22 successful, 22 total` |

`npx expo config --type prebuild --platform android` was **not run** — it was `expected` in the
review and is `expected` still, and it appears nowhere in the tree outside this report.

One correction worth recording, because it is the failure this skill exists to catch. The first
draft of the F2 row above claimed `git grep -n 'expo config --type prebuild'` returned **no hits**.
Run, it returns **seven** — the plan's own VALIDATE steps at `:665` and `:864`, an unrelated spike
doc, and this report. That grep was the wrong one (it asks whether the repo ever mentions the
command, not whether *this fix* prescribes an unrun one) and its result was written before it was
run. The two scoped greps that replace it were run first and are quoted above. For the record, the
plain `npx expo config --type prebuild` is **not** an unrun command in this repo:
`.claude/reports/driver-device-day-prep-report.md:47` records L1 running it, `CONFIG_OK`. Only the
`--platform android` variant the review named was never run.

