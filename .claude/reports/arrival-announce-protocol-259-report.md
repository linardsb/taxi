# Implementation Report — arrival-announce protocol (#259)

**Plan**: `.claude/plans/arrival-announce-protocol-259.md`   **Branch**: `feature/arrival-announce-protocol-259` (worktree `~/taxi-worktrees/wt-259-impl`, cut from `origin/main` at `2718f39`)   **Status**: COMPLETE. What remains owed, by plan, is outside this Mac: T23 (e4), the push tap from the shade, waits on #14 (FCM), and iOS VoiceOver waits on #257

## Summary

A rider can opt in per booking to «Šoferis pieteiksies balsī» (`options.announceArrival`).

- **Driver, before arrival:** the driver sees a note.
- **Driver, at `arrived`:** the driver sees the words to call out: «Sakta, {name}!», or «Sakta, uz {destination}!» when the rider has set no name.
- **Rider, at `arrived`:** the rider has a button that reaches the driver three ways, all carrying the same `at`, which the driver app dedupes on:
  - the socket event `ride:announce_requested` to `driver:<id>`;
  - a push;
  - a replay through `announceRequestedAt` on the driver's next read (Redis, 600 s).

T0 makes `Banner` speak on Android and removes the double announcements that change would otherwise have spread to both apps.

## Tasks completed

- **T0** `Banner` announces on both platforms, adds `announce?: boolean`, and drops `accessibilityLiveRegion`:
  - `apps/{rider,driver}/src/components/Banner.tsx` (UPDATE).
  - P1–P4, driver: `active-ride-state.ts`, `use-active-ride.tsx`, `active-ride-screen.tsx`. The effect now carries `method` or `reason`, the runner speaks the Banner's own text, and those Banners are `announce={false}`.
  - P6: `places/search-sheet.tsx`, with the `rateLimited` flag.
  - P7: `booking/use-quote.ts`.
  - Live-region comments rewritten in `status-screen.tsx`, `search-sheet.tsx` (both sites) and `auth/gate-screen.tsx`.
- **T1**: retired by the plan (#269 shipped the split).
- **T2** `packages/shared/src/schemas/ride.ts`: adds `announceArrival` and `announceRequestedAt` (UPDATE). The option key is added to the literals and tests the plan lists.
- **T3** (all UPDATE unless marked):
  - `realtime-events.ts`: `RT.rideAnnounceRequested`, the schema, both maps, and the corrected doc-sync docblock.
  - `schemas/announce-push.ts` (CREATE) and `index.ts`.
  - `.claude/references/realtime-events.md`: "all 10 events", a new row, and a note on the REST side.
- **T4** 13 keys in each of `lv.ts`, `lv-rider.ts`, `en.ts` and `ru.ts` (UPDATE).
- **T5** (all CREATE unless marked):
  - `arrival-announce.policy.ts`
  - `arrival-announce.service.ts`
  - `RideLifecycleRepository.findAnnounceTarget` (UPDATE)
  - `POST /rides/:rideId/announce-request` in `ride-lifecycle.controller.ts` (UPDATE)
  - the provider in `rides.module.ts` (UPDATE)
- **T6** `driver-ride.ts` gains `announceRequestedAt`, gated to `arrived`, and `announce` in the deps. `ride-lifecycle.service.ts` gets a one-line injection. Both specs the plan lists were updated (UPDATE).
- **T7** `arrival-announce.service.spec.ts` (CREATE).
- **T8** `arrival-announce.integration.spec.ts` (CREATE). Phone prefix `+371330`, plate prefix `PA`.
- **T9** `boolean-preference.ts` (CREATE). `pickup-pin-preference.ts` now delegates to it and adds `useAnnounceArrivalPreference` (UPDATE).
- **T10**:
  - `preference-switch.tsx` (CREATE).
  - `booking-screen.tsx`: two switches, with `NameRow` still under them.
  - `use-book-ride.ts`: takes an options object and exports the `BookingOptions` type.
- **T11** `use-ride-status.tsx` gains `announceArrival`. Also `use-announce-request.ts` (CREATE), the button and result Banners in `status-screen.tsx`, and `accessibilityHint` on the rider `Button.tsx`.
- **T12**:
  - `arrival-announce.ts` (CREATE): `announcePrompt`, `announceNotice`, `clearStaleAnnounce`.
  - `active-ride-state.ts`: `notice: 'announce_requested'`, `lastAnnounceAt`, the event, the `haptic` effect, and the replay at `loaded`.
  - `use-active-ride.tsx`: socket intake, the haptic runner, and `announceRequested`.
- **T13** `active-ride-screen.tsx`: the `announce-prompt` block and a silent `announce-requested` Banner.
- **T14**:
  - `route-notification.ts`: the `announce` route.
  - `register-push-token.ts`: quiet in the foreground.
  - `push-registrar.tsx`: a warm tap goes to `/active-ride` and a cold one to the gate, with the ride state read through a ref.
- **T15** `apps/dispatch/.../use-booking-form.ts` sends `announceArrival: false`.
- **T16**:
  - `docs/ux-metrics-ledger.md`: a new row.
  - `docs/runbooks/rider-a11y-walkthrough.md`: step 14.
  - `docs/research/rider-ux-evidence.md`: row 7 marked as shipped.
- **T17** `.claude/references/ui-decisions.md`: four lines.
- **T18** the gate: green (below).
- **T19–T20** comments posted on:
  - [#275](https://github.com/linardsb/taxi/issues/275#issuecomment-5855582671) (widened to both options plus a board badge);
  - [#14](https://github.com/linardsb/taxi/issues/14#issuecomment-5855582834) (the third push kind, and the e4 step it owes);
  - [#279](https://github.com/linardsb/taxi/issues/279#issuecomment-5855582968) (the driver's non-Banner live regions);
  - [#16](https://github.com/linardsb/taxi/issues/16#issuecomment-5855583075) (the rider's `TextField` live region).
- **T22** (the API over curl): run against the dev DB. Artifacts are under Validation results.
- **T21** EAS build, **T23** driver TalkBack, **T24** rider TalkBack: all run. Artifacts are under Validation results.

## Tests added

Every count below is `observed` from the gate run named under Validation results.

**shared** (vitest, 291 → 300; the base is 291, `observed` in the PR #290 round-1 review, corrected by PR #293 review F9):
- `schemas-ride-request.test.ts`: the option defaults to off, a legacy object parses to `false`, and a non-boolean is refused.
- `schemas-driver-ride.test.ts`: `announceRequestedAt` defaults to `null`, and a bad datetime is refused.
- `realtime-events.test.ts`: a valid event; a `Date` `at` refused; a bad uuid refused; the push envelope round-trips; the catalog has 10 events.

**api** (jest):
- `arrival-announce.service.spec.ts`, 9 cases:
  - expected: emit, push and replay all carry the same `at`;
  - a 429 inside the window leaves no second emit, push or replay write;
  - accepted again once the window has passed;
  - 409 for a legacy or un-flagged ride;
  - the same 404 for another rider's ride and for a missing one;
  - 409 `ride_not_arrived`, with the window left unspent;
  - `arrived` with no driver;
  - an emit that throws still answers ok and still pushes;
  - the log carries no phone, name or "blind".
- `driver-ride.spec.ts`: 3 cases.
- `arrival-announce.integration.spec.ts`, 6 cases:
  - the main case in the apps' socket order: both offer legs free of the flag, socket to A, push to A's token with the same `at`, nothing to B or the rider within 500 ms, the replay, then a 429;
  - the replay is null after `start`;
  - 409 `ride_not_arrived`;
  - 409 `announce_not_requested`;
  - 404 for another rider, 403 for a driver token;
  - a phone booking carries the flag, and the caller name reaches the driver at `arrived`.
  - The main case also asserts that the offer push carries its `offer` JSON before checking the flag is absent from it, so the D2 check cannot pass on a size-dropped push.

**rider** (jest, 192 → 221):
- `Banner.test.tsx`: +3.
- `search-sheet.test.tsx`: P6 ×3.
- `use-quote.test.tsx`: P7 (assertion changed).
- `announce-arrival-preference.test.tsx`: 6.
- `use-book-ride.test.tsx`: +1.
- `booking-screen.test.tsx`: +2.
- `use-ride-status.test.tsx`: +2.
- `status-screen.test.tsx`: +8. Covers the expected case, D3 ×2, the result clearing, 429 / 409 / offline, and H3.
- `use-announce-request.test.tsx`: 4.

**driver** (jest, 296 → 340):
- `Banner.test.tsx`: +3.
- `active-ride-screen.test.tsx`: P1–P4 ×4, plus #259 ×4.
- `active-ride-state.test.ts`: +1, and two assertions extended.
- `use-active-ride.test.tsx`: P1 and P3, plus three announce cases.
- `arrival-announce.test.ts`: 19.
- `push-registrar.test.tsx`: +5.
- `register-push-token.test.ts`: +1.
- `route-notification.test.ts`: +2.

**Red first, `observed`**. Each test below was run against the unfixed or mutated code and failed, then the code was restored.

| Where | Change | Went red |
|---|---|---|
| T0, both `Banner.test.tsx` | unfixed Banner | 3 of 5 (Android once, `announce={false}` on iOS, no live region) |
| T0 P1–P4 | unfixed driver | 9 of 77 in `active-ride` |
| T0 P6 | unfixed `search-sheet.tsx` | the countdown case and hole 1 |
| T0 P6 | flag keyed on `err.status === 429` | hole 2 |
| T0 P7 | unfixed `use-quote.ts` | the 429 case |
| T7 (a) | flag check removed | "a legacy or un-flagged ride is 409 announce_not_requested" |
| T7 (b) | INCR moved before the status check | "off `arrived` is 409 ride_not_arrived and leaves the window unspent" |
| T8 | `emitToDriver` → `emitToRide` | the main case; its diff shows `riderSeen` receiving the event. A's positive stayed green, as the plan expected |
| T11 | `send` without `setResult(null)` | status-screen H3 and hook H3 |
| T12 L5 | `isNewer` → `!==` | "an OLDER `at` after a newer one is a noop" and the replay case |
| T12 M2 | clear applied only on `status` events | "«Sākt braucienu» clears the notice as the ride leaves arrived" |
| T14 | warm tap → `replace('/')` (round 1) | warm, stale-tray and ref cases |
| T14 | ref update effect removed | the ref case |

## Validation results

**Gate**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`, run from cleared workspace `dist` and `apps/dispatch/.next`. It ran twice, with the same test counts both times:
- **Run 1**, 12:49:45–12:52:13 BST: 22/22 tasks, 2m28s.
- **Run 2**, on HEAD `72b79d3`, after T8's tightened offer-push assertion and T22: 12:57:17–12:58:57 BST, **22 successful, 22 total**, 1m40s (`observed`). Two jest/turbo processes from another session were already running when it started, and it passed anyway.

Neither run skipped a test: the log's three "skipped" strings are event names.

| Package | Result (`observed`, run 2) |
|---|---|
| @taxi/shared | 30 files, 300 tests passed |
| @taxi/db | 3 files, 17 tests passed |
| @taxi/dispatch | 30 files, 278 tests passed |
| @taxi/api | 89 suites, 908 tests passed |
| @taxi/rider | 36 suites, 221 tests passed |
| @taxi/driver | 46 suites, 340 tests passed |

**Line counts** (`observed`, `wc -l`; the cap is 500):

| File | Lines |
|---|---|
| `lv.ts` | 406 (plan's derivation: 406) |
| `lv-rider.ts` | 129 (plan's derivation: 129) |
| `en.ts` | 412 |
| `ru.ts` | 420 (plan's worst case was 427) |
| `active-ride-state.ts` | 488 |
| `ride-lifecycle.service.ts` | 472 |
| `booking-screen.tsx` | 270, down from 296. The extraction alone gave 252; the second switch adds the rest |

**T22, the API over curl** (`observed`). This was the dev DB with the api on port 3041 (`API_PORT=3041 pnpm --filter @taxi/api dev`), started 12:56 BST. The run used a fresh rider `+37121590001`, a fresh driver `+37121590002` (plate `PA9001`), and dispatcher `+37120000099`. Ride `9c443c74-2085-4a19-96ee-6fe27e60854c`, booked with `options.announceArrival: true`:

| Step | Result |
|---|---|
| (a0) `PUT /riders/me/display-name` `{displayName: null}` | 204 |
| (a) force-assign, then driver `GET` | 201. `accepted`, `announceArrival: true`, `announceRequestedAt: null` |
| (b) request at `accepted` | 409 `ride_not_arrived` |
| (c) `arriving` → `arrived` → request | 201 `{ok: true}` |
| (c) again at once | 429 `too_many_requests`, `retryAfterSeconds: 20` |
| (d) driver `GET` | `announceRequestedAt: 2026-09-27T11:56:40.256Z`, which equals the `at` in the `requested` log line. `rider.displayName: null`, so the destination prompt applies |
| (e) api log | One `ride.arrival_announce.rejected` with `cause: ride_not_arrived`, one `ride.arrival_announce.requested` (`rideId`, `orderId`, `riderId`, `driverId`, `at`), one `ride.arrival_announce.push_skipped` with `reason: no_token`, and one `rejected` with `cause: too_many_requests`. No `+3712` phone appears in any announce line (grep count 0) |

Cleanup: the dispatcher cancelled the ride (201) and the driver went `offline` (200). The rider's name stays null.

**T24, the rider app under TalkBack on `sakta224`** (`observed` 2026-09-27, 13:02–13:05 BST; lv-LV; the text is the TTS input from TalkBack's VERBOSE log, not audio heard):
- **Setup:** the installed `lv.saktacab.rider` debug build, pointed at this branch's Metro on **8082** by writing `debug_http_host=10.0.2.2:8082` into the app's own preferences. Port 8081 belongs to `taxi-f0`'s stale Metro from `wt-a11y-276`, which was left running. **The bundle is proven ours:** the log line `Android Bundled 10368ms … (1635 modules)` came from our Metro, and `/book` contains the node `announce-arrival-row`, which exists only on this branch. `EXPO_PUBLIC_API_URL=http://10.0.2.2:3042`. The rider is `+37120000003`, and ride `95b55227-938a-4f19-84f6-1735306d381c` was booked with the flag over curl, force-assigned, and driven to `arrived`.

| Step | Result |
|---|---|
| (a) explore `announce-arrival-row` | ✅ one focus event (`talkback_3`): «izslēgts.», «Šoferis pieteiksies balsī», «Slēdzis. Ieradies šoferis izkāps un skaļi pateiks „Sakta”.». `uiautomator` shows one `android.widget.Switch` node carrying the testID, `checkable=true`. The inner native switch node exists but is not a separate TalkBack stop |
| status line on opening at `arrived` | «Auto ir klāt» spoken **once**, `TYPE_ANNOUNCEMENT` (AC14, rider) |
| (b) explore `request-announce` | ✅ «Palūgt šoferi pieteikties», then «Poga. Šoferis skaļi sauks „Sakta”.» (one focus event) |
| (c) activate | ✅ «Pieprasījums nosūtīts šoferim.» **once**, `TYPE_ANNOUNCEMENT`. Before it, TalkBack re-read the focused button's own state change («atspējots», «Palūgt šoferi pieteikties, aizņemts», `TYPE_WINDOW_CONTENT_CHANGED`). The api logged one `requested` at `2026-09-27T12:04:08.683Z` |
| H3 on device | a second activation 24 s later (outside the window) spoke «Pieprasījums nosūtīts šoferim.» once more (`TYPE_ANNOUNCEMENT`) |
| 429 on device | a third activation 16 s after that spoke «Pārāk daudz mēģinājumu — pagaidiet brīdi» once (`TYPE_ANNOUNCEMENT`). The api logged `rejected`, `cause: too_many_requests` |

- **Finding, not fixed (from T0):** opening `/book/status` also spoke «Meklējam auto…» and «Atjaunojam savienojumu…» (both `TYPE_ANNOUNCEMENT`) before «Auto ir klāt». The status Banner mounts on the first frame (`status: null` → searching), and the reconnecting Banner mounts before the socket joins. Both now speak on Android, as they already did on iOS. That is three announcements to open one screen. It is not in T0's caller audit, which covered pairs and timers, not first-frame Banners. I recommend a follow-up decision, either folded into #16 or decided here. **Fixed in this PR** (PR #293 review F1): see `.claude/reports/pr-293-review-fixes.md`. The device re-run of this step on the fixed source is still owed.
- **Layout note:** once the confirmation Banner mounts above the button, the button moves down about 190 px. My second `input tap` at the old position landed on the Banner. A TalkBack user keeps focus on the button, so this only affects scripted runs.
- **Cleanup:** the dispatcher cancelled the ride (201).

**T21, the driver APK** (`observed`, EAS's own record):
- **Build:** EAS `779073a4-3100-49b4-86cb-a4c0b0ec403c`, profile `preview`, from `748d3b9`. **FINISHED** on the first attempt: `createdAt` 12:00:17.9Z → `completedAt` 12:15:27.4Z = **909.5 s** (`derived` from those two stamps; R7's figure was 807 s). The APK is 110 087 342 bytes.
- **Build-only edits**, all reverted right after queueing (`git status` clean):
  - `eas init --id 976c4e03-…` wrote `extra.eas.projectId` and `owner`, and appended eight `android.permissions`, including `RECORD_AUDIO`. I restored the committed permission list **before** queueing.
  - `eas.json`'s `EXPO_PUBLIC_API_URL` pointed at `http://192.168.1.11:3042`.
- **Install:** the emulator already had a driver app signed with a different key (last updated 2026-09-24 17:05). Installing over it failed with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. With Linards' OK, I uninstalled it and installed this APK.

**T23, the driver app under TalkBack on `sakta224`** (`observed` 2026-09-27, 13:19–13:28 BST; lv-LV; the text is TTS input from TalkBack's VERBOSE log). Setup: the api on 3042; the driver `+37121590002` (car `PA9001`); the rider `+37121590001`; the dispatcher `+37120000099`.

| Step | Ride | Result |
|---|---|---|
| (a) explore `announce-prompt` at `arriving` | 1 `7840b066…`, unnamed | ✅ «Pasažieris lūdz: ierodoties izkāpiet un piesakieties balsī.» (focus) |
| (b) activate «Esmu klāt»; count `TYPE_ANNOUNCEMENT` in the next 5 s | 1 | ✅ **exactly one**: «Esat klāt» (AC9) |
| (b) explore the prompt at `arrived` | 1 | ✅ «Izkāpiet un skaļi sakiet: „Sakta, uz Teika, Rīga!”» |
| (c) rider request, first attempt | 1 | ❌ nothing arrived. **Setup gap, not code:** the driver had gone online through the api, not the app's toggle, and the app creates its socket only when the toggle goes online (`use-presence.tsx`). No socket, so no live event |
| (d) replay: HOME, 22 s, second request (`at` 12:21:01.250Z), relaunch | 1 | ✅ the notice Banner appeared from the foreground re-read, and «Pasažieris jūs meklē: izkāpiet un skaļi sauciet „Sakta”.» was spoken **once** (`TYPE_ANNOUNCEMENT`), with no socket involved. This observes the replay leg |
| (e) «Gatavs» | 1 | ✅ the `announce-requested` node was gone and the prompt stayed |
| (e3) cancel found by a re-read (P3 through `loaded`) | 1 | ✅ one `TYPE_ANNOUNCEMENT`, «Brauciens atcelts.», then TalkBack's focus read of the new screen |
| then: online through the app's toggle | — | «Tiešaistē / Tiešraide». A stray `requested` ride from the dev DB (`5035c41d…`, not mine) was offered and **declined** |
| (b) the named ride | 2 `f0294152…`, name «Anna» | ✅ one `TYPE_ANNOUNCEMENT`, «Esat klāt». The prompt read «Izkāpiet un skaļi sakiet: „Sakta, Anna!”», the headline path |
| (c) the socket leg | 2 | ✅ the Banner appeared, and its text was spoken **once** (`TYPE_ANNOUNCEMENT`, AC14 driver) |
| (e2) focus on the notice's own text, then a second request 16 s later (outside the window) | 2 | ✅ spoken **once** (`TYPE_ANNOUNCEMENT`). No double read: the text did not change, so there was no content-change event. R12's changed-text case was not reachable here |
| (e3) cancel over the socket | 2 | ✅ **one** `TYPE_ANNOUNCEMENT`, «Brauciens atcelts.» (P3) |
| (e3) release: reassign to `+37121590003` | 3 `fc07cb03…` | ✅ **one** `TYPE_ANNOUNCEMENT`, «Dispečers nodeva braucienu citam šoferim» (P2) |
| (e3) back-release: the ride entered **through an offer** (the app accepted it), `KEYCODE_BACK` → `uiautomator` shows `/home` («Tiešsaistē»), then reassign | 4 `ad919b5a…` | ✅ **one** `TYPE_ANNOUNCEMENT` on `/home`, from the reducer. T0's `derived` claim that back leaves the ride state live is now `observed` |
| (e4) push tap from the shade | — | owed by #14 (no `googleServicesFile`), as planned |

- **Seen along the way:**
  - The offer card for ride 4 said nothing about the protocol, and the note appeared only after accepting (D2 on device).
  - A force-assign did not open the ride in an already-open app until a relaunch (#15 step 7, reproduced again).
  - The OTP rate limit hit `+37121590002` after repeated script sign-ins. The script reused a cached token from then on.
  - The haptic cannot be observed on the emulator; T12's unit test is its evidence (`expected` on device).
- **Cleanup (f):**
  - All six test rides are `cancelled_by_dispatcher`. A dev-DB query found none open.
  - Both test drivers are `offline`, and the rider's name is null again.
  - TalkBack is off and its log pref removed; the rider app's `debug_http_host` pref is removed.
  - Animation scales are left at 0, as they were found.
  - The emulator this session booted is shut down, and the api and Metro are stopped.
  - The emulator's driver app is now this branch's EAS build. The old one was uninstalled, with Linards' OK.

**D1 and R4 greps** (T16). Code-side, `git diff origin/main -- packages services apps` adds two lines matching `blind`, and neither is a contract key, a log field or a user-visible string:
- the unit test that asserts the log does *not* contain the word;
- a rewrapped, pre-existing comment in `search-sheet.tsx`.

`grep -rni "pasignaliz\|honk" packages/shared/src/i18n` exits 1, so no copy asks for the horn.

## Deviations from the plan

1. **Level 4 ran in full apart from what the plan itself defers.** T23 (e4) waits on #14, and iOS VoiceOver on #257. Two changes to how it ran:
   - T23 (c)'s first attempt had no socket, because the driver was put online through the api. That attempt became the (d) replay run, and (c) was repeated with the driver online through the app.
   - T24 ran on port 8082 through `debug_http_host`, not on the plan's 8081, which `taxi-f0`'s Metro holds.
2. **T12: the notice-clearing rule lives in one place.** The plan puts the clear in two places, `step_done` and `status`. I apply it after every event instead: `decide` wraps a private `decideEvent` and passes the result through `clearStaleAnnounce`, which keeps an `announce_requested` notice only while the ride is at `arrived`. This also covers a re-read that lands off `arrived`. The M2 mutation (clear only on `status`) turns the `step_done` test red, so the plan's case is still pinned.
3. **T12: `announcePrompt` and the notice helpers moved to `arrival-announce.ts`.** `active-ride-state.ts` was already 462 lines after T0, and its additions would have gone past 500. The plan allowed this for `announcePrompt` "if it passes ~470". I moved `announceNotice`, `isNewer` and `clearStaleAnnounce` there too, which leaves the reducer at 488.
4. **T12 tests are in a new file**, `arrival-announce.test.ts`, not in `active-ride-state.test.ts`. They import `decide`, so they test the same reducer, and the existing 500-line test file stays as it was.
5. **T0 P6: the test file's `useSession` mock is now one stable object.** `search-sheet.test.tsx` returned a new `api` object on every render, so the search effect re-fired on each re-render. Hole 2 could not run: its one-shot mock hit a second request that returned `undefined`. The real `SessionProvider` memoises `api` (`use-session.tsx:71`). With the stable mock, all 12 existing cases still pass.
6. **T0 P7 changes an existing assertion.** `use-quote.test.tsx` "surfaces a 429 as a failed quote…" asserted the failure announce and now asserts there is none. That change is P7's whole fix. Two other existing assertions were extended rather than changed: the reducer's `payment_changed` effect now carries `method`, and the cancel effect carries `reason`.
7. **T10: one existing assertion changed.** In `booking-screen.test.tsx`, `getAllByRole('switch')` goes from 1 to 2, because the screen now has two switch rows. Nothing else in that file changed. The extraction step alone ran 35 suites / 204 tests before and after, with no test edited.
8. **T11: the rider `Button` gains `accessibilityHint`.** The plan assumed the prop existed; the rider's `Button` lacked it, while the driver's has it.
9. **T11: a rider test fixture changed shape.** `use-ride-status.test.tsx`'s `rideAt` fixture returned `request: {}`. The mock hands it back unparsed, and the hook now reads `request.options.announceArrival`. The fixture now carries `request: { options: { announceArrival } }`. No assertion changed.
10. **T11: the offline state is tested.** The UX States table lists `rider.error.offline`, which T11's test list did not include. It is added as one row of the refusal `it.each`.
11. **T8: the phone case uses a plain force-assign.** It runs `POST /dispatch/rides/:id/assign` with no offer, as the plan says. The main case drives `offerNext` directly, so the `ride:offer` capture and the offer push can be asserted before accept.

## Issues encountered

- **Main checkout occupied:** `~/Desktop/taxi` was on another session's `feature/skip-rider-sms-app-bookings-135`. I worked in a new worktree from the start. `db/migrations` latest is `0013_concerned_wiccan.sql`, and this ticket adds no migration.
- **`.env` copy blocked:** the PreToolUse hook blocks copying `.env` into a worktree, even for a command that only lists it. Linards copied it by hand before T8.
- **Test mock traps (worth knowing):**
  - `AccessibilityInfo.announceForAccessibility` is already a `jest.fn` in the RN preset. `jest.spyOn` hands back the same mock with earlier tests' calls still on it, so `search-sheet.test.tsx`'s P6 describe calls `mockClear()` in `beforeEach`.
  - In `status-screen.test.tsx`, H3 needs a held promise per press. A mock that resolves at once lets React batch the clear and the new result into one commit, so the Banner never remounts. Real requests have a round trip between the two.
- **Deferred, noted for review:**
  - «Palūgt šoferi pieteikties» uses the default `primary` variant, so the rider screen has two filled buttons at `arrived` (the other is Cancel, `danger`). The styling is the brand pass's call.
  - The plan does not decide whether the result Banner should also say the seconds on a 429, as search does. It uses the existing copy without the seconds.
