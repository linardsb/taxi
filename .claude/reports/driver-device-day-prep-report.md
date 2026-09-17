# Implementation Report — #141 device-day prep

**Plan**: `.claude/plans/driver-device-day-prep.md`   **Branch**: `feature/driver-device-day-prep`   **Status**: COMPLETE

## Summary

Issue #141's code shipped in PR #142/#145; what was owed is a ~10-minute run on a physical Android
phone, and that run was not performable for three reasons unrelated to hardware. All three are
closed: `apps/driver` now has a build route (an `eas.json` `preview` profile producing an APK in
EAS Build's cloud, plus the two repairs without which that build fails), the run sheet has one
durable home at `docs/runbooks/driver-device-day.md` with its two unreadable signals corrected, and
the owed step set is re-derived once and reconciled across the three places that stated it
differently. No shipped `.ts`/`.tsx` source was touched; **#141 stays OPEN** and the device run
stays owed.

## Tasks completed

- `eas-build-post-install` script (B1) → `apps/driver/package.json` (UPDATE)
- Notification-icon signature repair (B3) → `apps/driver/assets/notification-icon.png` (UPDATE, 9 bytes)
- The `preview` build profile → `apps/driver/eas.json` (CREATE)
- `expo-build-properties` + `android.usesCleartextTraffic` → `apps/driver/app.json`, `apps/driver/package.json`, `pnpm-lock.yaml` (UPDATE)
- The corrected run sheet → `docs/runbooks/driver-device-day.md` (CREATE, 231 lines)
- §Level 4 run sheet retired to a pointer + AMENDMENTS entry → `.claude/plans/driver-toggle-off-mid-ride-held.md` (UPDATE)
- §C.14 repointed at the runbook, stale pass-condition clause dropped → `.claude/plans/driver-app-auth-online-location.md` (UPDATE)
- On-demand-context row → `CLAUDE.md` (UPDATE)
- Supersede note on the stale step set → `.claude/reports/driver-toggle-off-mid-ride-held-report.md` (UPDATE — **not in the plan's task list**, see D3)
- Re-derived set + C1/C2 posted to #141 → [comment 5714883938](https://github.com/linardsb/taxi/issues/141#issuecomment-5714883938)

## Tests added

**None, by design** — this ticket changes no shipped source beyond build configuration. The
behaviour under test is already covered by `presence-state.test.ts`, `use-presence.test.tsx` and
`driver-presence.integration.spec.ts` (PR #145). The existing suites are the regression check, and
their counts must not move.

`observed`: driver suite **218 passed / 41 suites**, identical before and after
(baseline taken on this branch at `74828cb`'s tree, re-run after every change). AC #7 met.

## Validation results

| Level | Command | Result (`observed` 2026-09-17) |
|---|---|---|
| L1 | `pnpm turbo run lint --filter @taxi/driver` | ✅ 2/2 tasks |
| L1 | `npx expo config --type prebuild` | ✅ `CONFIG_OK` |
| L2 | `pnpm turbo run test --filter @taxi/driver` | ✅ 2/2 tasks; 218 passed, 41 suites — **unchanged** |
| L3 | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=… pnpm turbo run typecheck lint test build --force` | ✅ **22/22 tasks, 1m28.9s**; api 733 passed / 77 suites (0 skipped — Redis URL set) |
| L4.1 | bundle carries the origin | ✅ — **method corrected, see D1** |
| L4.2 | `bash -n` over each non-device block in the runbook | ✅ 3/3 parse |
| L4.3 | no surviving run-sheet copy | ✅ exactly `docs/runbooks/driver-device-day.md` |
| L4.4 | the three inconsistent step-set statements | ⚠️ **3 hits, not 0 — see D3** |
| L4.5 | `gh issue view 141 --json state` | ✅ `OPEN` |
| L4.6 | checkout unpolluted | ✅ `TREE_CLEAN`, no `apps/driver/android` |
| L4.7 | B1 reproduction on the builder's view of the tree | ✅ both directions — see below |
| L4.8 | `expo prebuild` + cleartext manifest | ✅ `✔ Finished prebuild`, exit 0; `usesCleartextTraffic="true"` in `main` |
| L5 | `expo install --check` / `expo-doctor` | ❌ **not clean — pre-existing, see D5** |

### L4.7 — the B1 reproduction, both directions

Against a scratchpad tree holding exactly the tracked-file set EAS uploads (see D4), with
`pnpm install --frozen-lockfile` green (`Done in 13.8s using pnpm v10.33.2`, 1676 packages):

| # | Step | Result |
|---|---|---|
| 1 | `packages/shared/dist` in the builder's tree | absent |
| 2 | `require.resolve('@taxi/shared')` from `apps/driver` | `MODULE_NOT_FOUND` |
| 3 | `expo export --platform android` | **`Android Bundling failed 1004ms`**, exit 1, no bundle |
| 4 | `sh -c 'cd ../.. && pnpm --filter @taxi/shared build'` — the hook's own command, fired from `apps/driver` as EAS fires it | exit 0 |
| 5 | `require.resolve('@taxi/shared')` | resolves to `packages/shared/dist/index.js` |
| 6 | `expo export --platform android` | exit 0, `entry-*.hbc (3.4MB)` |

Rows 3 and 6 are the pair: same command, same tree, the `eas-build-post-install` command as the
only difference.

### L4.8 — prebuild and cleartext

`expo prebuild --platform android --no-install` in that same tree: `✔ Finished prebuild`,
`PREBUILD_EXIT=0`. The repaired icon is consumed end to end — Expo's image pipeline resized it into
every density bucket (`drawable-mdpi` 24×24 → `drawable-xxxhdpi` 96×96), which is the strongest
available proof the 9-byte repair restored a usable asset rather than a merely well-formed header.

Generated manifests: `main` carries `android:usesCleartextTraffic="true"`; `debug` carries it too;
**no `release/` manifest is generated at all**, so the release variant the `preview` profile builds
inherits `main` — which is why the plugin entry is load-bearing rather than cosmetic.

## Deviations from the plan

**D1 — the plan's `INLINE_OK` check is unsound as written, and its `observed` result does not
reproduce.** The plan's command greps the `expo export` output directory for a sentinel origin.
That output is **Hermes bytecode**: running it verbatim gave `INLINE_FAIL`. The cause is not a
broken inlining — it is that Hermes packs its string table, so *no* app string is greppable in the
`.hbc`. Control (`observed`): `expo-router`, `socket.io`, `sakta.driver.session`, `saktacabdriver`
and `/drivers/me` all return **0 matches** in the same file. The check can therefore never pass,
whatever the build does, and the plan records it under **Observed**.

Replaced with a check that discriminates, run in both directions with the bundler cache cleared:

| Direction | Command | Sentinel in bundle | `apiUrl()`'s throw path |
|---|---|---|---|
| A — variable set | `expo export --platform android --no-bytecode --clear` | **present** → `INLINE_OK` | **0 occurrences** (dead-code eliminated) |
| B — variable unset | same, `env -u` | absent | **1 occurrence** (live) |

`--clear` is not optional: without it, direction B *also* found the sentinel (`observed`), because
Metro served the cached transform of `config.ts` from direction A — the check was an identity
function until the cache was cleared. AC #6 is met on the corrected pair, which proves more than
the original: the origin is inlined **and** the release-build throw path is eliminated exactly when
it is.

**D2 — the icon's decoded pixel count does not reproduce.** The plan states 4872 opaque white
pixels; re-derived here it is **4792** (`observed`: all three chunk CRCs valid, 96×96 RGBA, 4792
pixels at `alpha === 255` and every one of them `#FFFFFF`, 4192 at `alpha === 0`, 232
partially-transparent anti-aliased edge pixels, 9216 total — the three groups sum to the full
frame). **I cannot account for the 80-pixel delta**, and no alpha threshold produces the plan's
figure: counting the anti-aliased edge as opaque gives 5024, not 4872. Stating that rather than
offering a mechanism that does not arrive at the number. The conclusion the figure supports — the
payload was intact, so the fix is a header repair rather than a regeneration — rests on the CRCs
and the decode, not on the count, and is unchanged.

**D3 — Level 4 check 4 returns 3 hits, not the expected 0, and the check's patterns are
miscalibrated rather than the tree being wrong.** The check greps for `4, 5 or 7`, `4, 5, 7 and 8`
and `4, 5, 6 and 8`. But `4, 5, 7 and 8` is the set the plan's own re-derivation calls **correct** —
so the check flags a true statement as a defect. The three hits, each judged individually:

1. `.claude/code-reviews/pr-142-review-round2.md:302` — states the **correct** set, in a dated
   review of a merged PR. **Left.** Not a stale claim.
2. `.claude/plans/driver-toggle-off-mid-ride-held.md:959` — my own AMENDMENTS entry, quoting the
   retired footer *as the thing being retired*. **Left**: naming what was retired is the point of
   the entry, and rephrasing it to satisfy a grep would make the retirement less legible.
3. `.claude/reports/driver-toggle-off-mid-ride-held-report.md:196` — the genuinely stale one: the
   pre-F1 step set **and** a pointer at a run sheet that has moved. **Addressed**, by appending a
   dated supersede note rather than rewriting the sentence, which matches how the held plan took an
   AMENDMENTS entry instead of a silent edit. That file is not in the plan's task list, so this is
   scope the plan did not name — taken because it was the only surviving *stale* copy of the very
   claim the ticket exists to retire.

**D4 — the build-route checks ran against a `git write-tree` archive, not `git archive HEAD`.** The
plan specifies `git archive HEAD`, which would have reproduced the tree *without* the fixes, since
they were uncommitted at that point. `git archive $(git write-tree)` gives the same tracked-file
set with the staged fixes in it, which is what verifying a fix requires. R5 is honoured either way:
everything ran in the scratchpad, and the checkout has no `apps/driver/android` (L4.6).

**D5 — Level 5 expected `expo install --check` and `expo-doctor` clean; neither is.** `observed`:
14 packages one or two patch versions below what SDK 57 expects, and 2 failed doctor checks
("packages match versions required by installed Expo SDK", plus "overridden dependencies" — the
workspace's deliberate `pnpm.overrides`). **This predates the ticket**: all 14 are pinned
identically on `main` (`observed`, compared pin by pin), and `expo-build-properties` — the only
package this ticket adds — is at its expected version and absent from the outdated list. Not fixed
here: a 14-package bump is outside a ticket whose non-goals say it changes no shipped app source,
and the memory `taxi-expo-app-toolchain-pins` warns what dependency churn costs in this app.
**The runbook was corrected instead** — it now states that the check is not clean, why that is not a
build blocker (the hazard is a cross-SDK-major mix, not patch drift within 57), and says not to
`--fix` it on the day.

**D6 — `npx expo install expo-build-properties` auto-wrote a bare-string plugin entry** into
`app.json`'s `plugins` array. Converted to the array form carrying
`{"android": {"usesCleartextTraffic": true}}`, without which the dependency does nothing.

**D7 — prebuild generates three variant directories, not the two the plan lists.** `debug`,
`debugOptimized` and `main` (`observed`). The plan's table names only `main` and `debug`. The
conclusion is unaffected — there is still **no `release/` manifest**, so the release variant
inherits `main`.

**D8 — the runbook is 231 lines against the plan's "aim for a similar size" to
`rider-a11y-walkthrough.md`'s 168.** The excess is the four Setup subsections the plan itself
mandates (R4's pre-flight, R3's discriminator, the different-origins trap, the build invocation)
plus D5's correction. Not trimmed: each was a named control.

**Not a deviation, recorded for the reviewer**: I initially renumbered the steps (opening the
tracking page as a new step 4), which the plan explicitly forbids because issue comments and PR
reviews cite the old numbers. Reverted before validation — the shipped sheet keeps 1–8 unchanged
and folds the early-open instruction into step 3.

## Issues encountered

- **Q6 is confirmed, not theoretical.** `expo prebuild` printed
  `» android: userInterfaceStyle: Install expo-system-ui in your project to enable this feature.`
  (`observed`). `app.json` declares `"userInterfaceStyle": "light"` and `expo-system-ui` is not a
  dependency, so that declaration is **inert on Android** — a driver on a dark-themed phone gets
  whatever the OS does. Not fixed here (out of scope, not a build blocker); it belongs to #14 or
  the brand epic.
- **`npx eas` fetches the wrong package.** The Expo CLI is `eas-cli` (`24.7.0`); the npm name `eas`
  is an unrelated package sitting at `0.1.0`, and neither is a dependency of this repo (`observed`
  2026-09-17). The runbook says `npx eas-cli@latest build …` and states why. **The same latent bug
  is in #14's plan** at `.claude/plans/driver-app-auth-online-location.md:816` (`npx eas init`) —
  left alone as another ticket's file, and flagged here so it is fixed when A2 is attempted.
- `pr-142-review-round2.md:302` cites `driver-toggle-off-mid-ride-held.md:737-746` for the run
  sheet. That line range is now the pointer paragraph. Left as-is — it is a dated review, and the
  pointer it lands on leads to the runbook.
- No migrations in this ticket; `ls db/migrations/*.sql | tail -1` unchanged.
- No open PRs at implementation time (`observed`), so the `pnpm-lock.yaml` move is uncontested.
  Exactly one package was added to the lockfile (`expo-build-properties@57.0.20`, 0 removed) —
  the rest of that file's diff is pnpm peer-suffix re-resolution churn.

## What stays owed

The eight steps, on a phone, with the runbook's Result table filled in. **#141 is OPEN and nothing
here closes it.** The EAS cloud build is `expected`, never `observed` — it needs Linards's
credentials and a build credit. What is observed is that the three failures which would each have
broken that first build are closed by a reproduction.
