# PR #139 review — Driver app: auth, online toggle, durable location streaming, dark detection + push nudge (#14) — round 2

**Head** `6f3d1d1` · **Base** `main` @ `9b2a60bc61c45e082cd9a8494e2664591d1ee9fa` · **Round** 2 · 2026-08-31 · reviewed from the `taxi-driver-app` worktree. `git merge-base HEAD origin/main` = `9b2a60b` = round 1's base, so the base has not moved and the guarantees pass is not triggered. Scope: the two fix commits `2ff4be9` + `6f3d1d1` (`git diff --stat 3d32d51..6f3d1d1` → 49 files, +1,108/−169, `observed`), checked against round 1's F1–F25 by three `code-reviewer` agents (api/shared · driver location/availability · driver auth/onboarding/tooling); every High closure and every new Medium re-read in source by the reviewer.

## Summary

**Request changes — one High, and it is round 1's F3 half-closed.** The refetch path now reads `on_ride` as "the server holds us", but the **socket-reconnect** path round 1 named in the same sentence still re-asserts `PUT status online` unconditionally, the api still 409s any PUT while the row is `on_ride`, and `error/driver_on_ride` still flips the toggle and tears the stream down — a Wi-Fi handover during a force-assigned ride loses the car for the ride, exactly as before. The `serverStatusEvent` docblock says the reconnect case is fixed; it is not. The fix is a few lines on either side (app or api — Linards's call) plus one reducer case and one spec.

Everything else is approve-grade: the other six Highs and all Mediums/Lows are closed in source, each with a test that fails on the unfixed source (spot-checked 2 of 12 files: 8/16 failing = the report's 5/13 + 3/3, `observed`); the gate is green locally at `6f3d1d1` (20/20, 65 s) and on CI (run 33407916845); every figure in the PR body re-derives except two Lows (F27). Two new Mediums surfaced on the way, one of them pre-existing (F31, F32).

## Round-1 closure (F1–F25)

| # | Sev | Status at `6f3d1d1` | Evidence |
|---|---|---|---|
| F1 | High | Fixed (two cuts) | `package.json:59` `testTimeout: 20000`; `jest.setup.ts:125-141` warms `react-native`'s component getters, safe-area, RNTL — no new mocks, no timers, no console silencing. CI green on `6f3d1d1`. Cold local run: 84/84, slowest test 239 ms (`observed`, below). |
| F2 | High | Fixed | `package.json:50-56` `expo.install.exclude: ["typescript"]`; `apps/driver/CLAUDE.md:31` names it. `npx expo install --check` → exit 0 (`observed`). |
| F3 | High | **Half-fixed — open** | Fixed: `presence-state.ts:359-365` `serverStatusEvent()` folds `on_ride` → `server_online` at both call sites (`use-presence.tsx:128,263`); test `presence-state.test.ts:221-234`. **Not fixed:** `socket_connect` with intent online → `put_status online` unconditionally (`presence-state.ts:316-323`); api `setPresence` throws 409 `driver_on_ride` for any status while the row is `on_ride` (`drivers.service.ts:98-103`, before the online/offline branch); `error/driver_on_ride` → `flipOffline` → `TEAR_DOWN` (`:299-305`). See below. |
| F4 | High | Fixed | `sqlite-fix-queue.ts:50-62` `enqueue` = `withTransactionAsync` on the one cached connection; expo-sqlite runs it via `this.execAsync` (same connection, `node_modules/expo-sqlite/build/SQLiteDatabase.js:120-130`) where `withExclusiveTransactionAsync` opened a new one (`:155-176, 560-562`). A foreground `remove()` between the task's awaits executes inside the open transaction — one writer, no `database is locked`. Comment at `:12-19` now true; `sqlite-fix-queue.test.ts:44-63` pins every INSERT to the opened connection. See F33. |
| F5 | High | Fixed (window open) | `use-presence.tsx:280` `queue.clear()` in the sign-out hook, under `Promise.allSettled` so a rejected push-token DELETE cannot skip it; `purge_stale_fixes` first in `GO_ONLINE` (`presence-state.ts:96`) and the alive-task cold launch (`:153`); `dropOlderThan` strict on the fix's own `at` in both queues (`in-memory-fix-queue.ts:39-42`, `sqlite-fix-queue.ts:107-109`) with tests; `MAX_REPLAY_AGE_MS = 5 * 60_000` (`fix-queue.ts:46`). The sign-out `clear()` itself has no test. |
| F6 | High | Fixed | `expo-push.provider.ts:94-96` `AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)`; `:45-48` by-name `TimeoutError`; `timeout` in the closed enum; `sendDueNudges` treats it as `provider_error` — token kept, row already claimed, not retried. Spec `:118-146` resolves the fake fetch only on abort. |
| F7 | High | Fixed | `Button.tsx:114` and `profile-screen.tsx:158` `outlineWidth: 2, outlineColor: colors.fg, outlineOffset: 2`, applied under `focused` only; `Button.test.tsx:11-26` asserts ring ≠ fill and no `borderWidth`. Chip untested (F29). |
| F8 | Med | Fixed | `drivers.service.ts:191-212`: on `!marked` the row is re-read; `on_ride` → `markOnline(cityId, userId, nowMs)` (presence + proof of life, no GEO position — the pin reads null until the next accepted ping, ≤ 4 s); `offline` → nothing left behind. Pinned by `driver-presence.integration.spec.ts:268-307`. Round 1's facet (a) (a fix accepted between `listOnline` and `markOffline` is voided) is a residual of the chosen option, seconds-wide, self-healing via the app's re-assert. |
| F9 | Med | Fixed | `use-presence.tsx:259` refetch returns unless `intent === 'online' && !busy`, read from `stateRef.current`, which `dispatch` writes synchronously (`:88-90`) — no stale closure; `presence-state.ts:205-227` `foreground_denied` with `server === 'online'` emits `put_status offline` + `TEAR_DOWN`, the put's answer sets `server`. Test `:236-263`; the hook's `busy` gate itself untested. See F34. |
| F10 | Med | Fixed | `presence-state.ts:374-387` `runEffects` stops at the first throw and calls `onThrow` once; `use-presence.tsx:92-96` dispatches `error/generic`, which clears `busy` (`:310-313`). Test `:266-295`. See F31. |
| F11 | Med | Fixed in substance | `use-session.tsx:104-112` `live.inFlight ??=` with the reset in `.finally`. The hooks still run once with the dead token — by design: the presence hook is also the local teardown (`use-presence.tsx:277-282`), so skipping it would leave the stream up. Residual: ≤ 2 wasted 401s that join the in-flight promise. `use-session.test.tsx:36-73` drives a real 401 inside a hook → hook ×1, `fetch401` ×1. |
| F12 | Med | Fixed (2 of 3 sites) | `Banner.tsx:29-31` `announceForAccessibility(text)` on `[text]`; `TextField.tsx:35` `accessibilityHint={error ?? rest.accessibilityHint}`. Earnings-card live region left by choice (documented). See F28. |
| F13 | Med | Fixed | `config.ts:12-19` throws in a release build with no origin; called from `use-session.tsx:70` (root render) and `socket.ts:28` — loud failure at launch, not a silent localhost. `config.test.ts:20-30` toggles `__DEV__`. |
| F14 | Med | Fixed | 63 keys ×3 (`observed`), 30–45 s / at most one (`realtime-events.md:7`, report, policy docblock `driver-location.policy.ts:24-34`, `drivers/index.ts:16-20`), "proof of life = fix OR re-assert" where stated, repository docblock digit gone, report's force-assigned-nudge mechanism corrected. Residue grep (`396`, `30 s after`, `no accepted fix for`, `70`/`69 keys`) over source, report and references: empty; the plan keeps its plan-time figures. |
| F15 | Low | Fixed, narrowed | `drivers.service.ts:180-184`: row `offline` → member dropped; `on_ride` kept by design; **no row → kept, unlogged** (`:177-179` says why: the gateway spec's store-only drivers). `drivers/index.ts:20-25` matches. Spec `:251-266`. |
| F16 | Low | Not fixed, by choice | Consistent with the store contract test; F8's new `markOnline` caller runs only for an `on_ride` row the sweep never reads, so the window does not widen. |
| F17 | Low | Fixed | `drivers/index.ts:27-40` exports neither symbol; all importers in-slice and relative. |
| F18 | Low | Fixed | `vehicle-screen.tsx:64` `category: editing?.category ?? 'standard'`; test edits a `limo` and asserts it survives. |
| F19 | Low | Fixed | `api-client.ts:95-101` `res.json()` in try/finally, timer cleared after the body; same `controller.signal` on the fetch; test `:125-153` gives the unbounded path a wrong answer to catch. |
| F20 | Low | Fixed | `src/app/index.tsx` is a one-line re-export; `gate-screen.tsx:11-38` is the removed body verbatim with slice-internal imports. |
| F21 | Low | Fixed | `vehicle-screen.tsx:58` `plate.replace(/\s+/g, '').toUpperCase()` before `safeParse`; `parsed.data` is the request body. |
| F22 | Low | Fixed | `packages/shared/src/schemas/api-error.ts`; pipe body typed `ApiErrorBody` (`zod-validation.pipe.ts:17-24`), 429 `satisfies ApiErrorBody` (`auth.service.ts:145-151`, integral `retryAfterSeconds` holds — Redis TTL is integral, the harness store uses `Math.ceil`); client `safeParse` with `generic` fallback (`api-client.ts:105-112`). Shared imports only `zod`. |
| F23 | Low | Fixed | `fix-throttle.ts:62-68`: dropped only when `−60 s < delta < 4 s`; a delta ≤ −`CLOCK_RESET_WINDOW_MS` is accepted and rebases `lastTs`. A > 60 s-old buffered sample would rebase too, but the batch is sorted so every later fresh sample passes once and `last` is fresh by the batch's end — no gap opens. Test `:43-50`. |
| F24 | Low | Fixed | `sqlite-fix-queue.ts:37-39` `.catch` resets `dbPromise = null` and rethrows; test `:78-90`. |
| F25 | Low | Fixed to the minimum | `location-task.ts:90` `console.warn` (the slice rule allows `warn`/`error`, `eslint.config.mjs:41`); test `:59-78`. Not the logging standard's shape (dotted `event`, `at`), but the app has no logger and its other two log lines are the same `console.warn` — consistent with the app, not the standard. |

## Issues

No Critical.

### High

**F3 (carried) · The reconnect half is still open: a socket reconnect during a force-assigned ride re-asserts `online`, takes the 409, and tears the stream down.** `apps/driver/src/features/availability/presence-state.ts:316-323` (`socket_connect` + intent online → `put_status online`, no look at what the server last said), `:299-305` (`error/driver_on_ride` → `flipOffline` → `TEAR_DOWN`), `:291-297` (`drained` → `put_status offline` — the toggle-off path, accepted in round 1); `services/api/src/features/drivers/drivers.service.ts:98-103` (409 for *any* status while `on_ride`). Round 1's F3 said "and so does every socket reconnect — a Wi-Fi handover is enough"; the fix closed the refetch and put-answer paths and left this one. Scenario: force-assigned from `/dispatch` while online; socket drops on a handover, tunnel or api deploy → reconnect → PUT online → 409 `driver_on_ride` → toggle flips, stream stops, tracking page (#63) and board lose the car for the ride; when #11 releases, intent is `offline`, so the driver sits server-online with no stream until the dark sweep flips them and stamps a nudge. The docblock at `presence-state.ts:352-357` ("… and socket reconnect …") and `apps/driver/CLAUDE.md:25` ("a 409 wins and flips the toggle") describe the bug as fixed. No test covers `error/driver_on_ride` or `socket_connect` against a held driver — the only 409 case is `vehicle_required` (`presence-state.test.ts:71-88`), and `:123-135` pins the unconditional re-assert as "expected". **Fix — one of two halves, Linards's call:** (api) in `setPresence`, 409 only when `status === 'offline'` and answer `PUT online` while `on_ride` with the profile — the app's existing `serverStatusEvent('on_ride')` then does the right thing, one condition + one spec; or (app) keep `on_ride` as a `server` value, skip the re-assert on `socket_connect` when held, and reduce `error/driver_on_ride` as "the server holds us" (intent online, no `TEAR_DOWN`). Either way: a reducer case + spec for `socket_connect` while held, update `:123-135`, retire the two docblock/CLAUDE.md claims.

### Medium

**F26 · `apps/dispatch` keeps a looser twin of the new shared error envelope.** `apps/dispatch/src/features/phone-orders/booking-api.ts:54-57` (`errorBodySchema`: `message` optional, `retryAfterSeconds` un-`int`ed) and `apps/dispatch/src/features/tracking/tracking-map.tsx:50-53` (a hand-rolled `retryAfterSeconds` reader) parse the same 429/400 shape that `apiErrorBodySchema` now defines (`packages/shared/src/schemas/api-error.ts:19-23`). Pre-existing code, but `packages/shared/CLAUDE.md:9` makes "a check of all consumers" part of a contract change, and the hard rule is "never duplicate a type an app can import". Failure: shared tightens `message` and dispatch keeps parsing a shape the api no longer sends. **Fix:** `apiErrorBodySchema.safeParse` in both places (two small edits) — or a named follow-up if Linards keeps this PR to the driver surface.

**F31 · A throw before `permission` in the go-online chain leaves `intent: 'online'` with nothing running — the F9 ghost by another route.** `presence-state.ts:174-190` sets `intent: 'online', busy: true` and then runs `persist_intent` → `persist_marked_offline` → `request_permissions`; `ensureLocationPermissions` is not wrapped (`use-presence.tsx:116-120`); `onThrow` → `error/generic` (`:310-313`) clears `busy` and sets a banner but leaves `intent`. Scenario: SecureStore or the permission call throws → toggle shows ON, no permissions, no put, no stream; next foreground → refetch (intent online, not busy) → `server_offline` → the one re-assert → `server_online` → `kick_uploader` only (`:244-259`, no `start_stream`) → on the board with no stream → dark in 60–75 s → a "you went offline" nudge. Bounded (the next toggle press resets), but a ghost plus a spurious push. **Fix:** give the throw its own code (`effect_failed`) and reduce it as `{ …state, intent: 'offline', streaming: false, busy: false, banner: generic }` with `TEAR_DOWN` plus `put_status offline` when `server === 'online'` — and no `persist_intent` in that branch, or a throwing store re-enters `onThrow`. One reducer case + test.

**F32 · (pre-existing, surfaced here) A 409 on `put_status online` does not stop the `GO_ONLINE` chain.** `use-presence.tsx:122-135` catches the `ApiError`, dispatches `error`, and returns normally, so `runEffects` (`presence-state.ts:374-387`) carries on with `start_stream`, `connect_socket`, `keep_awake on` while `flipOffline`'s `TEAR_DOWN` runs in a second, concurrent chain — whichever native call lands last wins. Scenario: a `vehicle_required` (or F3's `driver_on_ride`) 409 on tap → toggle shows OFF with the banner, but the background task may be left running (foreground-service notification up, queue growing) with a live socket; the next ping's `not_online` ack then re-asserts, takes the 409 again and tears down properly — so it self-heals in ~4 s + RTT, but the reducer's decision is not the runner's, and F3's fix does not close it. Not introduced by the fix diff; round 1 missed it. **Fix:** have `run` return a stop signal for a failed `put_status` (or throw a sentinel `runEffects` recognises) so the chain ends where the reducer already decided; one reducer/runner test.

### Low

**F27 · Figures inherited past the fix commit.** (a) Report line 90 "Largest shipped files (observed `wc -l`) … `drivers.service.ts` 361, `presence-state.ts` 354, `use-presence.tsx` 317" and line 29 "218 → 361" describe `3d32d51`; at `6f3d1d1` they are **382 / 409 / 337** (`observed`, `wc -l`), all still under the 500 cap that `max-lines` enforces — the conclusion holds, the digits do not, and `presence-state.ts` now has 91 lines of headroom. (b) PR body "shared +15 cases (…; +3 for the api error envelope)": the whole-PR diff adds **16** `it(` lines and removes none, no `.each` (`driver.test.ts` 6 + `push-provider.test.ts` 3 + `realtime-events.test.ts` 4 + `schemas-api-error.test.ts` 3 = 16; `observed`). **Fix:** three digits in the report, one in the body — or drop the size line and let `max-lines` be the claim.

**F28 · Banner is likely read twice by TalkBack.** `apps/driver/src/components/Banner.tsx:30` announces on mount/change and `:35` still carries `accessibilityLiveRegion="polite"`; on Android both can fire for a freshly mounted banner. Medium confidence — a device check, not a certainty. **Fix:** gate the effect on `Platform.OS === 'ios'`, or drop the live region now that the announce is explicit; add a TalkBack pass to HUMAN TESTS.

**F29 · Round-2 changes with no test.** The language-chip ring (`profile-screen.tsx:158`; no `profile-screen.test.tsx` exists); `TextField`'s hint returning to `undefined` once `error` clears (`TextField.tsx:35`); the sign-out hook's `queue.clear()` (`use-presence.tsx:280`); the refetch's `busy` gate (`:259`). **Fix:** one focus/blur case on a chip; one re-render with `error={null}`; a hook test for the sign-out order is the larger one and can wait.

**F30 · Spec title says more than the code does.** `driver-presence.integration.spec.ts:251` "whose row is not online" — the sweep drops only `offline`, keeps `on_ride` (`:229` proves it). **Fix:** "whose row says offline".

**F33 · The `enqueue` transaction adds a hazard it does not need.** `sqlite-fix-queue.ts:52-62`. Only `enqueue` opens transactions on the shared connection; if two `enqueue` calls overlap (TaskManager re-invoking the task while a previous batch still awaits — needs a > 4 s sqlite stall, improbable but real under a WAL checkpoint or a 20k-row `prune`), the second `BEGIN` fails, its `ROLLBACK` (`SQLiteDatabase.js:127`) discards the *first* call's INSERTs, and the first `COMMIT` throws — both batches lost, the F4 outcome by a new route. Batches are 1–2 rows; a plain `runAsync` loop (round 1's other option) has no cross-talk. KISS.

**F34 · `foreground_denied` guidance is overwritten by `generic` on a non-network PUT failure.** `presence-state.ts:310-313`: after F9's `put_status offline`, any error code other than `offline` replaces the "grant location" banner with `generic`. **Fix:** keep an existing `foreground_denied` banner in the generic branch.

**F35 · (pre-existing) `ack_not_online` re-asserts without `busy`** (`presence-state.ts:282-286`) while `server_offline` sets it (`:273`), so F9's `busy` gate does not cover that in-flight put: a foreground `active` during the RTT refetches, reads `offline`, and with `reasserted: true` flips via `flipOffline` while the re-assert then succeeds — server online, no stream. Window is one RTT. **Fix:** `busy: true` there too.

## The numbers pass

Every figure in the PR body and the report's round-1 section, re-derived at `6f3d1d1` in this session (`observed` unless marked).

| Claim (body / report) | Says | Re-observed at `6f3d1d1` | Verdict |
|---|---|---|---|
| Whole PR | 158 files, +15,914 / −401 | `git diff --stat 9b2a60b..HEAD` identical; `gh` `additions`/`deletions`/`changedFiles` agree | ✅ |
| Review fixes | 49 files, +1,108 / −169; 8 new files — 6 tests, `gate-screen.tsx`, `api-error.ts` | `git diff --stat 3d32d51..6f3d1d1` identical; `--diff-filter=A` lists exactly those 8 | ✅ |
| Full gate at `2ff4be9` | 20/20, exit 0, 68 s; api 72 suites / 658 (0 skipped); dispatch 222; shared 211 (23 files); driver 84 (22 suites); db 17; api lint 11 warnings | at `6f3d1d1` from cleared `dist`: `Tasks: 20 successful, 20 total`, exit 0, 65 s; api `72 passed / 658 passed` (no skipped line); dispatch 27/222; shared 23/211; driver 22/84; db 3/17; `✖ 11 problems (0 errors, 11 warnings)` | ✅ |
| CI on `2ff4be9` | red — `vehicle-screen.test.tsx` first test at 20 s, suite 55.9 s | run 33407278413 log: `FAIL … vehicle-screen.test.tsx (55.924 s)`, `Exceeded timeout of 20000 ms` at `:75`, `Tests: 1 failed, 83 passed, 84 total` | ✅ |
| CI on `6f3d1d1` | green, 20/20, 5 min 01 s | run 33407916845 `completed/success`, 15:20:53Z → 15:25:54Z = 5 min 01 s; `Tasks: 20 successful, 20 total` | ✅ |
| Cold transform | ~3.5 s per RNTL file cold (3,605 / 3,607 / 3,503 / 3,419 / 2,514 ms); after the warm-up slowest test 187 ms; cold wall 17 → 27 s | `jest --clearCache` then `--verbose`: 84/84, `Time: 19.902 s`, wall 21 s; slowest test **239 ms** (verify auto-submit), every RNTL suite 17.2–17.9 s — the cost sits in setup, off the test clock. Pre-fix per-file figures not re-observed (they need the old `jest.setup.ts`) | ✅ substance; my digits differ (machine load) |
| `npx expo install --check` | exit 0 at `2ff4be9` | exit 0: "Skipped checking dependencies: typescript … Dependencies are up to date" | ✅ |
| `npx expo export --platform android` | 3.3 MB, exit 0 — labelled "at `3d32d51`" | not re-run; the label is honest, but the fix commits change app source, so it is a pre-fix figure | ➖ labelled |
| AC greps | both empty | plan line 856 regex over `apps/driver/src` (tests excluded): empty; `exp.host` outside `features/push`: empty | ✅ |
| Catalog keys | 63 ×3 | `grep -cE "^\s*'(driver\|push)\."` → en 63 / ru 63 / lv 63 | ✅ |
| New api tests | +38 | `it(` in `9b2a60b..HEAD -- services/api`: +42 / −4 = 38 | ✅ |
| New shared tests | +15 (+3 envelope) | +16 / −0, no `.each` (6 + 3 + 4 + 3) | ❌ F27 |
| Driver tests | 84 in 22 suites | 22 suites / 84 tests (gate and cold run) | ✅ |
| Fix tests fail on unfixed source | 12 files, incl. presence reducer 5/13, sqlite queue 3/3 | spot-check 2 of 12: `3d32d51` sources as `.old` copies, HEAD tests re-pointed → `8 failed, 8 passed, 16 total` = 5 + 3 of 13 + 3; the other 10 not re-run | ✅ (sampled) |
| F6 worst case | 50 × 5 s = 250 s (`derived`); ≤ 50 s at pilot scale | `NUDGE_BATCH_LIMIT = 50` (`driver-location.policy.ts:45`), `PUSH_HTTP_TIMEOUT_MS = 5_000` (`expo-push.provider.ts:19`), sends sequential; "≤ 50 s" assumes ≤ 10 due rows per tick | ✅ derived, condition stated |
| F5 figures | `MAX_REPLAY_AGE_MS` 5 min; ~900 fixes per hour of outage (3,600 / 4) | `5 * 60_000` (`fix-queue.ts:46`); `MIN_FIX_INTERVAL_MS = 4_000` | ✅ derived |
| Dark / nudge | 75 s = 60 + 15; 30–45 s = 30 + one 15 s tick; at most one | `PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS = 60`, `PRESENCE_SWEEP_INTERVAL_MS = 15_000`, `OFFLINE_NUDGE_DELAY_SECONDS = 30`; provider error not retried | ✅ derived |
| Residues of retired claims | none | `396`, `30 s after`, `no accepted fix for`, `70`/`69 keys`: none in source, docblocks, report, references | ✅ |
| Report file sizes | `drivers.service.ts` 361 · `presence-state.ts` 354 · `use-presence.tsx` 317 | 382 · 409 · 337 (`wc -l`); all < 500 | ❌ F27 |
| "no re-assert, no 409, no teardown mid-ride" (body, Review round 1 → F3) | claims the whole of F3 closed | true for the refetch and put-answer paths; false for `socket_connect` (`presence-state.ts:316-323`) | ❌ F3 |
| Round 1's re-run list | CI green on the new head; `--check` exit 0; body + report corrected (`--check` line, 63 keys, 30–45 s) | all three discharged (rows above; body "What changed" and Validation ¶3; report lines 17, 88, Issues ¶5) | ✅ |

## Validation

| Check | Result | Provenance |
|---|---|---|
| `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` (cleared `dist`) | **green** — 20/20 tasks, exit 0, 65 s | observed, this session, worktree at `6f3d1d1` |
| Per package | api 72 suites / 658; driver 22 / 84; shared 23 / 211; dispatch 27 / 222; db 3 / 17; `@taxi/api:lint` 11 warnings (pre-existing supertest) | observed |
| GitHub Actions `check` on `6f3d1d1` | **green** — run 33407916845, 5 min 01 s | observed |
| Driver jest cold (`--clearCache`, `--verbose`) | 84/84, 19.9 s, slowest test 239 ms | observed |
| Unfixed-source spot-check (`presence-state.ts`, `sqlite-fix-queue.ts` @ `3d32d51` under HEAD's tests) | 8 failed / 8 passed of 16 | observed; worktree clean after |
| `npx expo install --check` | exit 0 | observed |
| Plan AC greps (LV strings, `exp.host`) | both empty | observed |
| `git merge-base HEAD origin/main` | `9b2a60b` — base unchanged since round 1 | observed |

## What's good

- Every review-fix test asserts the property, not the literal: `Button.test.tsx` checks ring ≠ fill and no reflow; the F19 test hands the unbounded path a wrong answer; `use-session.test.tsx` drives a real 401 re-entry instead of mocking `signOut`; the F8 spec makes the race deterministic with `mockImplementationOnce` rather than sleeping for it; `sqlite-fix-queue.test.ts` proves the connection contract with a fake that has no `withExclusiveTransactionAsync` at all.
- `serverStatusEvent` is one mapping used at both call sites; the purge order, the `foreground_denied` PUT and the runner's stop-on-throw are all provable from effect lists in `presence-state.test.ts`.
- `isTimeout` by name with the jest-realm reason written down (`expo-push.provider.ts:40-44`) — the "why not `instanceof`" comment that saves the next session an hour.
- F15 was narrowed after a real spec failure and the reason lives in code (`drivers.service.ts:171-179`), not only in the report.
- `satisfies ApiErrorBody` on the 429 and the annotated pipe body make the producer side a typecheck-time contract; the driver client consumes the same schema as `z.infer`. The hand-typed twin is gone from the app.
- The F1 second cut is measured, not inferred, and the measurement is in the setup file's docblock next to the run numbers that motivated it.
- The PR body's "Review round 1" section names what was not fixed and why, and what is still open for Linards — the reviewer did not have to reconstruct it.

## Routing

**AGENT FIXES** — F3 once the half is chosen (reducer case + spec + the two doc claims), F31, F32, F27 (four digits), F29, F30, F33, F34, F35. F28 after a device check.

**HUMAN DECIDES**
- F3 — api half (answer `PUT online` while `on_ride` with the profile; 409 only for `offline`) or app half (`on_ride` as a `server` value, no re-assert while held, `driver_on_ride` = "held"). The api half is smaller and leaves the reducer's rule intact.
- F26 — sweep `apps/dispatch` onto `apiErrorBodySchema` in this PR (two edits) or as a named follow-up.
- F5's window (5 min) — still open, as the body says. One consequence worth a conscious yes: the queue is cleared on **every** sign-out including a 401-driven one (plan §C.9 now says "lost by design"), so a token that expires mid-shift in a dead zone drops that track. `JWT_EXPIRES_IN` defaults to `30d` (`env.schema.ts:42`), so it is rare, not impossible; clearing only on an explicit sign-out would keep the D6 same-driver case at the cost of the handed-phone case.
- F28 — keep the live region or the explicit announce on Android, after a TalkBack pass.

**HUMAN READS**
- `apps/driver/src/features/availability/presence-state.ts:291-323` — `drained`, `error`, `socket_connect`: where F3, F31 and F32 live; `:353-365` the docblock that overstates.
- `services/api/src/features/drivers/drivers.service.ts:94-110` — the 409 gate (F3's api half) and `:162-212` the `offline`/`on_ride`/rowless split with the F8 restore.
- `apps/driver/src/features/auth/use-session.tsx:99-113` — the single-flight sign-out and why the hooks still run.

**HUMAN TESTS** (unchanged from round 1, all still owed)
- Level 4 §C 1–11 on the emulator, incl. §C.5 "no hole > 8 s"; §C.9's signal is now `Rindā: 0` after re-login.
- Force-assign from `/dispatch`, foreground the app, **toggle Wi-Fi mid-ride** (F3): the pin must stay on the tracking page — at `6f3d1d1` it will not.
- First go-online on Android: deny foreground location, watch the board for 75 s (F9).
- D-pad/keyboard pass over the primary buttons and the language chips (F7).
- VoiceOver on a wrong OTP and a profile-save error (F12); **TalkBack on any banner** (F28).

**FYI**
- `.claude/plans/driver-app-auth-online-location.md` in the main checkout is now **stale**, not byte-identical: it lacks the fix commit's §C.9 edit (`observed`, `diff`). Delete it there before pulling `main` after the merge, or the pull refuses to overwrite it.
- #13's uncommitted work in the main checkout edits `env.schema.ts` (+39/−4), `env.schema.spec.ts` (+31) and the env template; this PR adds to the same three files (+13 / +31 / +14). Whichever lands second rebases across the other; Notes 17's two runbook rows are still owed to `docs/runbooks/hetzner-deploy.md`.
- `presence-state.ts` at 409 lines is the closest driver file to the 500 cap; F3/F31/F32 each add a case there.
- `gh pr review --request-changes` fails on this repo (author = reviewer), so this verdict is posted as a comment.

## Recommendation

**Request changes** — F3's reconnect half before merge (a few lines on one side + one reducer case + one spec + two doc sentences); F31 and F32 alongside (both are reducer cases in the same file); F26 as two edits or a named follow-up; F27 a four-digit docs edit; F28–F30, F33–F35 at the author's discretion. Re-run: the gate and CI green on the new head, `presence-state.test.ts:123-135` updated for the held case. Level 4 §C/§D stay owed to Linards, as the body says; merging does not close #14.
