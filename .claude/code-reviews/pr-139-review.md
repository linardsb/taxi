# PR #139 review — Driver app: auth, online toggle, durable location streaming, dark detection + push nudge (#14)

**Head** `3d32d51` · **Base** `main` @ `9b2a60bc61c45e082cd9a8494e2664591d1ee9fa` · **Round** 1 · 2026-08-31 · reviewed from the `taxi-driver-app` worktree (merge-base = `origin/main`, so the base has not moved under this PR; the guarantees pass is not triggered). Three `code-reviewer` agents by surface (api/shared/db · driver location/availability/push · driver auth/onboarding/tooling); every High below was re-verified in source by the reviewer.

## Summary

**Request changes.** The design is right and the load-bearing paths read as their docblocks say: the ack is a callback parameter, not an event; the uploader deletes only on `accepted: true`, one fix in flight; the server's presence writes are conditional UPDATEs in the Redis-then-Postgres order the comment argues for; the sweeper is a row-driven background process like `DispatchSweeper`. The local gate is green and every size figure in the PR body re-derives exactly. What stops an approve: **CI is red** (F1); a validation claim in the body is false at HEAD and contradicts a rule this PR adds (F2); a driver on a force-assigned ride is taken offline by their own app on the first network blip (F3); the durable queue can lose fixes on a lock collision (F4) and replays stale ones as live (F5); a hung push call suspends dark detection (F6); the primary button has no visible focus ring (F7). Most fixes are a few lines each.

## Issues

No Critical.

### High

**F1 · CI is red — the driver's jest has no `testTimeout`, and the first RNTL test in a file pays the cold transform on the runner.** `apps/driver/package.json` (jest block); `apps/driver/src/features/auth/verify-screen.test.tsx:55`. Run 33402386433: `Exceeded timeout of 5000 ms` on the first test in that file, suite 41.3 s, whole driver run 133 s (`observed`); locally the same suite passes 3/3 in 175–244 ms, three runs running. `ci.yml` caches only the pnpm store, so every CI run transforms `expo-router`/`react-native` cold; the driver's jest block sets no `testTimeout` while the api's sets `20000` (`services/api/package.json:90`). The reading — transform time landing inside the first test — is inferred from those facts, not proven; the fix does not depend on it: a 5 s ceiling is below what this repo already grants its other jest suite. **Fix:** `"testTimeout": 20000` in the driver jest config; push; CI green is the gate, not the local run. The api/dispatch ELIFECYCLE lines in that log are turbo killing siblings (`Failed: @taxi/driver#test` only).

**F2 · `npx expo install --check` is not clean at HEAD, the PR body says it is (`observed`), and the same PR adds a rule that now cannot be followed.** `apps/driver/package.json:38`; `apps/driver/CLAUDE.md:31-32`; PR body Validation ¶2; report line 88. `--check` at `3d32d51` exits 1: `typescript@5.9.3 - expected version: ~6.0.3` (`observed`, this session). The pin is deviation 19 and landed in `2b6d19e` — the commit the body cites as the head "every figure" was observed against — so "Dependencies are up to date" was run before the pin and inherited past it; plan AC line 858 ("`--check` clean") is unmet. `CLAUDE.md:31` tells the next session to run `--check` before any build and `:32` to keep the pin that makes it fail; a session that follows the check's own advice (`--fix`) reintroduces the two-TypeScripts lint break the pin exists to prevent. **Fix:** `"expo": { "install": { "exclude": ["typescript"] } }` in `apps/driver/package.json` (Expo's documented exclusion from `--check`), re-run to exit 0, reword `CLAUDE.md:31` to name the exclusion, correct the body and report line.

**F3 · `on_ride` from the server is read as `offline`; the app re-asserts, takes the 409, and tears the stream down mid-ride.** `apps/driver/src/features/availability/use-presence.tsx:121-125` and `:244-248` (anything ≠ `'online'` → `server_offline`); `presence-state.ts:243-258` (`server_offline` with intent online → `put_status online`), `:298-305` (`socket_connect` with intent online → `put_status online`), `:281-287` (`driver_on_ride` → `flipOffline` → `TEAR_DOWN`); `services/api/src/features/drivers/drivers.service.ts:102-103` (409). Dina's override (#19) is the pilot's phone-order path and the tracking page (#63) is shipped. A driver force-assigned while online gets `on_ride`; the next foreground refetch maps it to `server_offline` and re-asserts, **and so does every socket reconnect** — a Wi-Fi handover is enough. The api answers 409 `driver_on_ride`, the reducer flips the toggle offline and stops streaming: the tracking page and the board lose the car for the ride. When #11 releases the driver to `online`, the app's intent is `offline`, so they sit server-online with no stream until the dark sweep flips them and stamps a nudge. `presence-state.test.ts:67-84` pins the 409 as correct for a *toggle press*, which it is; the refetch and reconnect paths are the defect. **Fix:** map `on_ride` to `server_online` (or a `server_on_ride` event that keeps streaming and never re-asserts) at both call sites; one reducer case.

**F4 · `enqueue` writes on a second sqlite connection; a lock collision with the uploader's `DELETE` silently drops fixes.** `apps/driver/src/features/location/sqlite-fix-queue.ts:42` (`withExclusiveTransactionAsync`) vs `:65-74` (`remove`), `:88-95` (`prune`); `location-task.ts:87-93`. `Transaction.createAsync` opens the transaction on a **new** connection (`node_modules/expo-sqlite/build/SQLiteDatabase.js:562`, `useNewConnection: true`, `observed`), so the task's INSERTs and the uploader's DELETEs are two writers on one WAL file with no busy timeout set, and the transaction spans several awaits. An ack landing in that window makes one side fail with `database is locked`: if it is `enqueue`, the task catches and logs and **those fixes are never queued** — "written to the queue BEFORE it is sent" fails silently, during a backlog drain (acks every ~50–100 ms after a tunnel), which is the scenario the queue exists for; if it is `remove`, `drain()` rejects unhandled (`uploader.ts:52`) and the row is re-sent later (harmless duplicate). The comment at `:12-15` ("share the same connection") is untrue for `enqueue`. **Fix:** keep everything on the one cached connection — `withTransactionAsync`, or a plain `runAsync` loop (batches are 1–2 rows); reword the comment.

**F5 · Leftover queue rows are replayed as the CURRENT position on the next go-online — hours later, and under the next driver's JWT.** `use-presence.tsx:173-178` (`drain_then_clear` never clears), `:255-274` (sign-out hook does not touch the queue); `presence-state.ts:273-279`; `fix-queue.ts:20-28` (`clear()` has no caller outside tests, `observed`), `:35` (`MAX_QUEUED_FIXES = 20_000`, "a ~22 h ceiling"); `services/api/src/features/drivers/location/driver-location.service.ts` (`ingest` stamps `at = Date.now()`, reads `ping.at` only for the debug line; `findNearby` and the board read the server stamp). Plan D6 chose in-order replay so a dead zone's track reaches the board — right for minutes. Nothing bounds the age: going offline drains ≤ 5 s best-effort, so in a garage or after a dead-zone shift-end the backlog survives, and the next go-online replays it oldest-first, one ack at a time — after an api outage of an hour every driver drains ~900 fixes (`derived`: 3,600 / 4) and for the length of that drain (~1–2 min at ~10 acks/s, `expected`) dispatch can offer on an hour-old position while Dina's board walks each driver along its old track. Second facet: the queue carries no owner, so a phone handed to another driver replays the first driver's track under the second's token (identity is the JWT by design). The plan's §C.9 ("queue intact after re-login") covers only the same-driver case. **Fix (two parts, the second is Linards's call):** `queue.clear()` in the sign-out hook, unconditionally; and an age purge before the first kick on go-online/cold launch (drop rows whose `at` is older than a window — the phone's clock is consistent with its own fixes, which is why this belongs on the phone, not on a server that distrusts client clocks), with the window chosen against §C.9 and D6. Retire "no track data lost" where it no longer holds.

**F6 · `ExpoPushProvider`'s fetch is unbounded, and it runs under the sweeper's `running` lock — a hung Expo call suspends dark detection.** `services/api/src/features/push/expo-push.provider.ts:55-69`; `drivers.service.ts:253`; `presence/driver-presence.sweeper.ts:58-70`. No `signal` on the request (`observed`), where the slice's two other outbound fetches bound theirs (`twilio-sms.provider.ts:58` `AbortSignal.timeout(SMS_HTTP_TIMEOUT_MS)`, `google-places.provider.ts:209`). `sendDueNudges` awaits up to 50 sends sequentially inside `tick()`, which holds `running` across both passes, so every later tick is a no-op until the hang clears (undici's default headers timeout is 300 s). The dark pass is the safety property, the push is best-effort — the dependency is the wrong way round. **Fix:** `signal: AbortSignal.timeout(PUSH_HTTP_TIMEOUT_MS)` (5–10 s) mapped to the closed enum; a spec case with a never-resolving `fetchImpl` under fake timers.

**F7 · The focus ring on the primary `Button` and on a checked language chip is invisible — the hard rule is "visible focus states on every interactive element".** `apps/driver/src/components/Button.tsx:91` (`primary: { backgroundColor: colors.accent }`) vs `:112` (`focused: { borderWidth: 2, borderColor: colors.accent }`); `features/onboarding/profile-screen.tsx:155,158` the same pair (`observed`). Same colour inside the same bounds on the main action of every screen; a plain `Pressable` gets no native indicator for D-pad/keyboard focus on Android, so the JS ring is the only one. The border also reflows the button 4 px on focus. `TextField.tsx:70` and the `secondary`/`danger` variants are fine. **Fix:** a contrasting ring (`colors.fg`) via `outlineWidth: 2, outlineColor, outlineOffset: 2` (RN ≥ 0.78; the app is on 0.86 — no reflow, visible on any fill); log the colour in `ui-decisions.md`.

### Medium

**F8 · The dark sweep's Redis drop is unconditional; the on_ride race it acknowledges strands presence for the whole ride.** `services/api/src/features/drivers/drivers.service.ts:166-191, 210-221`. Per stale member: `listOnline` → `find` → `markOffline` (Redis, unconditional) → conditional UPDATE. (a) A fix accepted between `listOnline` and `markOffline` — the first after a > 60 s gap — is voided after the phone deleted it; the next ping is `not_online`, the app re-asserts, a spurious offline/online pair reaches the board, and the sweep retries that window every 15 s per stale member. (b) A claim to `on_ride` between `find` and the UPDATE: Postgres stays correct and `offline_skipped` is logged, but Redis presence is gone and nothing restores it — `setPresence('online')` is 409 (`:102`) and `releaseFromRide` never touches Redis — so every ping for the rest of the ride is `not_online` and the tracking pin reads null. The comment at `:180-183` names the race, not this consequence. Window is ms-wide. **Fix:** on `!marked`, re-add presence (`markOnline(cityId, userId, lastSeenMs)`); or make the removal conditional in Lua (`SREM` only if `ZSCORE seen < cutoff`), which closes (a) too.

**F9 · The foreground refetch re-asserts `online` while the permission dialog is open; a denial then leaves the server online with no stream.** `use-presence.tsx:234-252` (AppState `active` → `refetch` → `server_offline`, gated on `intent` only, not `busy`); `presence-state.ts:170-187` (`toggle_pressed` sets `intent: 'online'` before `request_permissions`), `:253-258`, `:201-211` (`foreground_denied` → no `put_status offline`). The system dialog pauses the host activity on Android (`background` → `active`) and resigns active on iOS; Android 11+'s background step is a Settings round-trip. Each `active` re-asserts, `setOnlineIfEligible` sets the driver online with no socket and no stream; a denial flips intent offline with a banner and never tells the server — the driver sits on the board until the dark sweep flips them 60–75 s later and stamps a nudge: a "you went offline" push to someone who never went online. It also spends the one re-assert (`reasserted: true`), so the next genuine disagreement flips instead of re-asserting. **Fix:** skip the refetch while `stateRef.current.busy`; have `foreground_denied` emit `put_status offline` + `TEAR_DOWN` when `state.server === 'online'`.

**F10 · A thrown effect aborts the chain with an unhandled rejection and can leave `busy` with no exit.** `use-presence.tsx:82-90` (no try/catch around `for … await runRef.current(effect)`); `:103-108` (`persist_*` → SecureStore), `:109-114` (`request_permissions`), `:163-166` (`keep_awake`), `:170-172` — all uncaught; only `start_stream`/`put_status`/`stop_stream` catch. On go-online, `persist_intent` and `request_permissions` run before `put_status`, the only effect that clears `busy` on failure; a SecureStore throw (a known Android keystore mode) leaves `busy: true`, `toggle_pressed` is ignored (`presence-state.ts:171`), and the only way out is the F9 race. **Fix:** try/catch per effect in the loop, `dispatch({ type: 'error', code: 'generic' })` on a throw and stop the chain.

**F11 · A 401-driven sign-out re-enters itself through its own hooks — bounded, but it fires the hooks' requests with a dead token and runs `clearSession`/`setState` up to three times; `use-session.tsx` has no test.** `apps/driver/src/features/auth/use-session.tsx:66,93-102`; `api-client.ts:101`; `push-registrar.tsx:37-39`; `use-presence.tsx:257-268`. `signOut` guards on `live.session === null`, set only after `await Promise.allSettled(hooks)`; both hooks call the api with the token that just failed, each 401 calls `onUnauthorized` → `void live.signOut()` → the guard passes → the hooks fire again. Because `onUnauthorized` is fire-and-forget the first sign-out completes after one RTT and the guard closes, so the driver is signed out and the fan-out is ~4–6 redundant requests, not unbounded — but it is the "expired-token path" `api-client.ts:53-56` claims to handle, and untested. **Fix:** single-flight (`live.inFlight ??= …`), skip the hooks on the dead-token path; one test: 401 inside a hook → exactly one hook pass, session cleared.

**F12 · Error and banner announcements are Android-only; VoiceOver hears nothing.** `apps/driver/src/components/Banner.tsx:27`, `TextField.tsx:48`, `features/availability/earnings-card.tsx:30`. `accessibilityLiveRegion` is a no-op on iOS; the `announce` effect (`use-presence.tsx:179-187`) covers status flips only. A `danger` Banner (profile-save error, `vehicle_required`, `foreground_denied`, battery, generic) and the field error after a wrong OTP (`verify-screen.tsx:64-66` refocuses the input, which reads only its label) are silent. **Fix:** `AccessibilityInfo.announceForAccessibility(text)` in a `useEffect([text])` in Banner; `accessibilityHint={error ?? undefined}` on the TextInput.

**F13 · A release build with `EXPO_PUBLIC_API_URL` unset silently targets `http://localhost:3001`.** `apps/driver/src/config.ts:7-8`. On a phone that is the phone: every request reads as `offline`, indistinguishable from an outage, and the report's own handoff says the variable lives in an EAS profile nobody has written. **Fix:** `process.env.EXPO_PUBLIC_API_URL ?? (__DEV__ ? 'http://localhost:3001' : throwMissing())`.

**F14 · Numbers and guarantees that did not survive re-derivation** (root `CLAUDE.md`: a figure is a claim; give the worst case or say which one it is).
- **70 catalog keys ×3** (PR body; report Phase 1 says 69, deviation 6 says "70, not 69"): **63** per language (`observed`: `grep -cE "^\s*'(driver|push)\." lv.ts ru.ts en.ts` → 63/63/63, every key enumerated). The plan's "~70 keys" estimate (plan line 432) travelled into both without a count.
- **"one push nudge 30 s after"** (PR body Summary and What changed; report line 7; `.claude/references/realtime-events.md:7`): 30 s is the best case — the send happens on the first tick with `now ≥ due`, so **30–45 s** (`derived`: 30 + the 15 s cadence). The plan (`:853`) said "+30–45 s"; the report and the reference dropped the worst case — #87's shape. And "one" is "at most one": a `provider_error` is not retried (`drivers.service.ts:224-228`).
- **Report line 124** ("the nudge query filters `status='offline'`, so it fires only after the ride ends"): wrong mechanism — a force-assigned offline driver is never claimed (`drivers.repository.ts:261-268`, WHERE `status='online'`), so the row stays `offline` for the whole ride and the nudge fires *during* it, 30–45 s after the server offline. Harmless; the stated reason is false.
- **"no accepted fix for 60 s"** (`drivers/index.ts:14-17`, the policy docblock, report line 7): proof of life is now "accepted fix **or** `markOnline` re-assert"; a GPS-dead phone re-asserting every < 60 s is never dark. Say so where the rule is stated.
- `driver-presence.repository.ts:19` "the 396-line `drivers.repository.ts`": 398 (`observed`). Drop the digit.

### Low

**F15 · Partial-failure ghosts the sweep cannot see; KNOWN GAPS overstates.** `drivers.service.ts:172`; `drivers/index.ts:17-19`. The sweep enumerates Redis: a Postgres UPDATE that throws after `markOffline` leaves an `online` row with no member that no tick revisits; a member whose row is not `online` hits the early return with no log and no removal and stays on the board every tick. `index.ts` says the deploy-surviving member "the sweep also marks dark" — only when Postgres also says `online`. Fix: drop the member on the early-return path too; narrow the sentence.

**F16 · `markOnline` refreshing `seen` re-dates an old GEO position.** `redis-driver-location.store.ts:70-80` (+ `test/harness.ts:181-195`). On the reconnect-racing-its-predecessor path the gateway names (`:57-63`), a pre-drop position becomes fresh for up to 60 s with no fix behind it and `lastSeenAt` reports the re-assert time against it. Documented as deliberate in the contract test; window is seconds. `ZADD … NX` for the seed is the alternative.

**F17 · Unused barrel surface.** `drivers/index.ts:23-24` exports `DriverPresenceSweeper` and `ServerOfflineReason`; the only consumers are inside the slice. Remove, or make the spec import through the barrel if that is the intent.

**F18 · Editing a vehicle from the app resets `category` to `standard`.** `features/onboarding/vehicle-screen.tsx:61,84-85` — `validate()` hardcodes it and the same body goes to `updateVehicle`, so an admin-set `limo`/`vip` (#20) is downgraded on any edit. Fix: `category: editing?.category ?? 'standard'`.

**F19 · The 8 s api timeout covers headers only.** `api-client.ts:85-92` — `clearTimeout` runs in `finally` before `res.json()`. Fix: clear after the body read.

**F20 · The gate is a full screen inside a route file.** `apps/driver/src/app/index.tsx:10-54` vs `apps/driver/CLAUDE.md:18`. Fix: `features/onboarding/gate-screen.tsx`, re-export.

**F21 · Plate inner whitespace survives.** `vehicle-screen.tsx:55` — `AB 1234` / `AB1234` / `AB-1234` are three plates against the `upper(plate)` unique index. Fix: `.replace(/\s+/g, '')` now; shared normalisation in `vehicleSchema` later.

**F22 · The api error envelope is hand-typed on the client.** `api-client.ts:4-7,98-108` — `{ message, retryAfterSeconds, issues[] }` is a cross-surface contract (`zod-validation.pipe.ts:16-22`, `auth.service.ts:145`) with no schema in `@taxi/shared`. Fix: `apiErrorBodySchema` in shared, `safeParse` here.

**F23 · A backwards clock jump silences the throttle until the clock catches up.** `fix-throttle.ts:52`; `location-task.ts:35,60`. A negative delta is `< 4000` and dropped; `lastEnqueuedTs` only moves forward, so a correction > ~60 s produces a silent gap long enough for the dark flip. Fix: treat a delta below a replay window (`raw.timestamp < last - 60_000`) as a reset — accept and rebase.

**F24 · `dbPromise` is poisoned forever by one failed open.** `sqlite-fix-queue.ts:16-32`. A rejected `openDatabaseAsync` is cached; every later call rejects for the life of the process. Fix: reset `dbPromise = null` in a `.catch` before rethrowing.

**F25 · The task's own `error` is swallowed without a trace.** `location-task.ts:86` — TaskManager's error is the one signal that background location died. At minimum warn; better, surface it to the runtime listeners so presence can show a banner.

## The numbers pass

Every figure in the PR body and the report, re-derived at `3d32d51` in this session (`observed` unless marked).

| Claim (body / report) | Says | Re-observed at `3d32d51` | Verdict |
|---|---|---|---|
| `git diff --stat` | 148 files, +14,971 / −397 | 148 / +14,971 / −397 | ✅ (identical at `2b6d19e`; the last commit is net zero) |
| Generated | lockfile +4,670/−244; snapshot +1,811; sql +2; journal +7 → 6,490 | same four numbers; 4,670+1,811+2+7 = 6,490 | ✅ |
| Hand-written | 14,971 − 6,490 = 8,481 | holds | ✅ derived |
| Buckets | driver 85/+5,033/−51 · api 42/+1,867/−94 · shared 10/+492/−4 · db 4/+1,834 · docs+.claude 5/+1,061/−4 · root 2/+4,684/−244 | all six identical (`awk` over `--numstat`); sum 14,971 | ✅ |
| `apps/driver/src` split | shipped 3,376 · tests 1,327 · tooling 330 | 3,376 / 1,327; non-`src` driver insertions 330 | ✅ |
| Catalog keys | 70 ×3 | **63** ×3 | ❌ F14 |
| `lv.ts` · `drivers.service.ts` | 218 → 296 · 218 → 361 | 218 → 296 · 218 → 361 | ✅ |
| Largest shipped files | 398 / 366 / 361 / 354 / 317 / 296 | identical (`wc -l`) | ✅ — the repository docblock's "396" is F14 |
| 9-event catalog test untouched | yes | `realtime-events.test.ts` +41/−0; the `toHaveLength(9)` case at 519–534 unchanged; additions are 3 ack-schema cases + 1 type-level case | ✅ |
| Full gate | 20/20, exit 0; api 72 suites / 655 (0 skipped); dispatch 222; shared 208; driver 17 / 65; db 17 | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` from cleared `dist`: `20 successful, 20 total`, exit 0, 59.9 s; api `72 passed, 655 passed, 655 total` (no skipped line); dispatch 27 files/222; shared 22/208; driver 17/65; db 3/17; `@taxi/api:lint` 11 warnings (pre-existing) | ✅ locally — **CI red, F1** |
| New api tests | "+~35" | `it(` in the api diff: +39 / −4 = 35 | ✅ |
| Socket ack cases | 3 over a real socket | `driver-location.gateway.spec.ts:218,229,244` (+ malformed unit at 268, rider-role at 318) | ✅ |
| `npx expo install --check` | "Dependencies are up to date" (`observed` at `2b6d19e`) | **exit 1: `typescript@5.9.3 - expected version: ~6.0.3`** | ❌ F2 |
| `npx expo export --platform android` | one 3.3 MB Hermes bundle, exit 0 | `entry-e4127faa….hbc` 3,327,347 bytes, exit 0 | ✅ |
| AC greps | no hardcoded LV strings in `apps/driver/src/**/*.tsx`; no `exp.host` outside `features/push` | both empty | ✅ |
| Dark worst case | 75 s, `derived` 60 + 15 | `PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS = 60`, `PRESENCE_SWEEP_INTERVAL_MS = 15_000`; first eligible at T+60, next tick ≤ 15 s later, assuming ticks on schedule (F6 is the case where they are not) | ✅ derived, condition stated in the policy docblock |
| Nudge delay | "30 s after" | 30 s is the best case; 30–45 s | ❌ F14 |
| Throttle · ack timeout · drain grace · pill windows · api timeout | 4 s · — · ≤ 5 s · ≤ 10 s / ≤ 60 s · 8 s | `MIN_FIX_INTERVAL_MS = 4_000`; `ACK_TIMEOUT_MS = 5_000`; `DRAIN_GRACE_MS = 5_000`; `LIVE_WINDOW_MS = 10_000` / `RECONNECTING_WINDOW_MS = 60_000`; `api-client.ts:60` `8_000` | ✅ |
| `markOnline` callers pass a clock | "every caller passes `Date.now()`" | one production caller, `drivers.service.ts:128` | ✅ |
| Production refuses the stub | yes | `push.module.ts:20` throws under `NODE_ENV=production`; `push.module.spec.ts:27` | ✅ |
| Level 4 §C.5 "no hole > 8 s" | **not observed** (body says so) | not run here either | ✅ labelled honestly — HUMAN TESTS |
| `findDueNudges` seq scan | "≤ 100 rows every 15 s at pilot scale (`expected`)" | labelled `expected` | ✅ |
| Report: `presence-state.ts` 354, `use-presence.tsx` 317 | — | 354 / 317 | ✅ (one agent reported 355/318; `wc -l` says the report is right) |

## Validation

| Check | Result | Provenance |
|---|---|---|
| `pnpm turbo run typecheck lint test build --force` (cleared `dist`, `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL` set) | **green** — 20/20 tasks, exit 0 | observed, this session, worktree at `3d32d51` |
| GitHub Actions `check` on `3d32d51` | **red** — `@taxi/driver#test` 1 failed / 64 passed; `verify-screen.test.tsx:55` "Exceeded timeout of 5000 ms"; driver run 133 s, that suite 41 s | observed, run 33402386433 |
| `verify-screen.test.tsx` alone, locally | 3/3 ×3 runs, 175–244 ms for the failing case | observed |
| `npx expo install --check` | **exit 1** — `typescript@5.9.3`, expected `~6.0.3` | observed |
| `npx expo export --platform android` | 3,327,347-byte Hermes bundle, exit 0 | observed |
| Plan AC greps (LV strings, `exp.host`) | both empty | observed |
| `closingIssuesReferences` on the PR | empty — #14 stays open as the body intends | observed |

## What's good

- The ack is exactly where the plan put it: a callback parameter on both client→server maps, `driverLocationAckSchema` in shared, no `RT` entry, and a type-level test that fails compilation if the parameter is dropped (`realtime-events.test.ts:25`). The `unknown`-typed listen map and the typed emit map are the right shape for a trust boundary.
- `driver-presence.repository.ts` — every server write is a conditional UPDATE whose RETURNING row is the answer; `claimNudge` nulling the column as the send lock is right for a second node, and the integration suite pins `on_ride` as never overwritten.
- `uploader.ts` reads as its own spec: one fix in flight, delete on `accepted` or `malformed` only, `store_unavailable`/timeout back off from the same row, `not_online` stops and hands off to presence; `socket.timeout(ms).emit` plus "unparseable ack = timeout" means a disconnect mid-ack re-sends rather than loses.
- The reducer/effect split: every online/offline rule in one pure file with ordered effects, tests reading those effect lists directly — the one-re-assert rule, drain-before-offline, D14 and the `busy` gate are all provable without a device.
- `DriverPresenceSweeper` mirrors `DispatchSweeper`: no auto-start under `NODE_ENV=test`, overlapping-tick guard, each pass isolated, interval unref'd and cleared. The ping path is still Postgres-free — the throwing `DRIZZLE` proxy spec passes with the ack added.
- `ExpoPushProvider`: parsed-not-cast response, closed-enum `reason`, a spec asserting `MessageTooBig` never reaches a log line. Earnings: timezone bound as a parameter, midnight computed in Postgres against a `timestamptz`, wire-schema parse on the way out.
- `normalisePhone` validates through the api's own `phoneSchema`; `readSession` cleans the store on any miss; `MeProvider` keyed on `user.id` makes sign-in/out a remount.
- The size section of the PR body is the first in this repo where every figure re-derives exactly, generated lines are separated and the sums are shown.

## Routing

**AGENT FIXES** — F1, F2, F4, F6, F7, F10, F12, F13, F14, F15, F17, F18, F19, F20, F21, F22, F23, F24, F25.

**HUMAN DECIDES**
- F3 — how the app treats `on_ride`: fold into `server_online`, or a `server_on_ride` event (the offer card in #15 will want the distinction).
- F5 — the age window for the go-online purge, against plan D6 and §C.9; `clear()` on sign-out is not in question.
- F8 — re-add presence on `!marked`, or a conditional Lua removal.
- F9 — gate the refetch on `busy` (simplest) vs a PUT offline on `foreground_denied`; both, ideally.
- F11 — auth-adjacent: single-flight sign-out and skipping hooks on the dead-token path.

**HUMAN READS**
- `packages/shared/src/realtime-events.ts:313-333` — the ack on the contract.
- `services/api/src/features/drivers/drivers.service.ts:161-221` — Redis-then-Postgres order, the `on_ride` guard, the dark pass.
- `services/api/src/features/drivers/presence/driver-presence.repository.ts:33-85` — the conditional UPDATEs.
- `apps/driver/src/features/location/uploader.ts:70-112` — delete-only-on-ack.
- `apps/driver/src/features/availability/presence-state.ts:142-305` — every online/offline rule (F3, F9, F10 live here).

**HUMAN TESTS**
- Level 4 §C 1–11 on the emulator, including §C.5 ("no hole > 8 s") — still owed, as the body says.
- Force-assign a driver from `/dispatch`, then foreground the app and toggle Wi-Fi mid-ride (F3): the pin must stay on the tracking page.
- First go-online on Android: deny foreground location, then watch the board for 75 s (F9).
- A D-pad/keyboard pass over the primary buttons on login, verify and vehicle (F7).
- VoiceOver on a wrong OTP and on a profile-save error (F12).

**FYI**
- `.claude/plans/driver-app-auth-online-location.md` sits **untracked and byte-identical in the main checkout**; delete it there before pulling `main` after this merges, or it collides with the incoming tracked file (or is swept into #13's commit).
- #13's uncommitted work in the main checkout also edits `env.schema.ts`, `env.schema.spec.ts` and the env template; whichever lands second rebases across the other. Notes 17's two runbook rows are still owed to `docs/runbooks/hetzner-deploy.md`.
- Deviation 5's `lastSeenAt` change reaches `apps/dispatch` only as an event overlay (`board-state.ts:127`); no rendered "last seen" changed.
- `@taxi/api:lint` reports 11 warnings — the pre-existing supertest ones, not this PR's.

## Recommendation

**Request changes.** F1–F7 before merge; F8–F14 alongside (F14 is a body/report/reference edit); the Lows at the author's discretion. Re-run: CI green on the new head, `npx expo install --check` exit 0, and the PR body + report corrected (the `--check` line, 63 keys, 30–45 s). Level 4 §C/§D stay owed to Linards as the body already says.
