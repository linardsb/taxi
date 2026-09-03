# Implementation Report — Rider app: auth shell + text-first booking, screen-reader-first (#16)

**Plan**: `.claude/plans/rider-app-auth-booking-screen-reader-first.md`
**Branch**: `feature/rider-app-auth-booking` (worktree at `/Users/Berzins/Desktop/taxi-rider`, cut from `origin/main` @ `a6481aa`)
**Status**: COMPLETE — with three acceptance criteria **blocked on hardware** (AC #6, AC #7, Level 4), documented below.

## Summary

`apps/rider` goes from the bare Expo template to a real app: SMS-OTP sign-in, then a
single booking screen with **no map** — pickup defaulted from coarse GPS, dropoff typed
into an address search, an upfront price shown before anything is booked, and a status
screen that speaks. Three api additions make that expressible: `POST /rides/quote`
(a quote with no ride), rider access to the geo typeahead (own caps, own key
namespaces), and `GET /rides/:rideId` (rider-owner-scoped) so a reconnecting socket can
recover its ride. Accessibility is implemented as assertions rather than as a review
note: focus is moved explicitly on every screen, async changes are announced, and each
of those is pinned by an RNTL test.

## Tasks completed

**Phase 1 — contracts (`packages/shared`)**

- `rideQuoteBodySchema` + `rideQuotePreviewSchema` → `src/schemas/ride.ts` (UPDATE)
- rider `rider.*` catalog block, 54 keys × 3 languages → `src/i18n/{lv,ru,en}.ts` (UPDATE)
- quote-body / preview cases → `tests/schemas-ride-request.test.ts` (UPDATE)
- **D5 measured, not triggered**: `lv.ts` is **368 lines** (`observed`, re-measured after the dead keys came out), under the 460 split threshold. No catalog split.

**Phase 2 — api (`services/api`)**

- `RIDE_QUOTE_MAX_PER_WINDOW = 30`, `rideQuoteRateKey` → `src/features/rides/rides.policy.ts` (UPDATE)
- `RideQuoteService.previewQuote()` → `src/features/rides/ride-quote.service.ts` (CREATE)
- `RidesService.findForRider()` → `src/features/rides/rides.service.ts` (UPDATE)
- `POST /rides/quote`, `GET /rides/:rideId` → `src/features/rides/rides.controller.ts` (UPDATE)
- provider registration → `src/features/rides/rides.module.ts` (UPDATE); KNOWN-GAP text → `src/features/rides/index.ts` (UPDATE)
- rider caps + key namespaces → `src/features/geo/address-search.policy.ts` (UPDATE)
- `@Roles(…, 'rider')` on both routes, cap/key by role, `dispatcherId` → `actorId` + `role` in the throttle log → `src/features/geo/address-search.controller.ts` (UPDATE)
- `#13/#16` → `#134` in the production-boot guard → `src/features/geo/geo.module.ts` (UPDATE)
- rider-path cases → `src/features/geo/address-search.controller.spec.ts` (UPDATE)
- quote-preview / ride-read / E13 / E14 cases → `src/features/rides/rides.integration.spec.ts` (UPDATE)

**Phase 3 — app tooling (`apps/rider`)**

- `package.json` rewritten (UPDATE): `main: expo-router/entry`, TS `~5.9.3`, `expo.install.exclude`, the full `jest` block, **`lint` and `test` scripts**
- `tsconfig.json` (UPDATE); `eslint.config.mjs`, `.prettierrc`, `expo-types.d.ts`, `jest.setup.ts` (CREATE)
- `app.json` (UPDATE) — `lv.saktacab.rider`, foreground location only; `locales/{lv,ru,en}.json` (CREATE)
- DELETE `App.tsx`, DELETE `index.ts`
- `src/config.ts` + test, `src/uuid.ts`, `src/components/{Screen,Button,TextField,Banner}.tsx` + tests + `index.ts`, `src/components/use-screen-focus.ts` + test (CREATE)

**Phase 4 — app: i18n and auth**

- `src/features/i18n/{device-language,use-t,error-key,index}.ts` + 2 tests (CREATE)
- `src/features/auth/{api-client,session-store,phone-normalise,use-session,login-screen,verify-screen,gate-screen,index}` + 6 tests (CREATE)
- `src/app/{_layout,index,login,verify}.tsx` (CREATE)

**Phase 5 — app: places, booking, status**

- `src/features/places/{saved-places-store,use-saved-places,address-row,search-sheet,current-position,index}` + 4 tests (CREATE)
- `src/features/booking/{booking-draft,use-booking-draft,use-quote,use-book-ride,quote-card,payment-chips,booking-screen,format-eur,index}` + 7 tests (CREATE)
- `src/features/ride-status/{socket,use-ride-status,status-screen,index}` + 3 tests (CREATE)
- `src/app/book/{index,address,status}.tsx` (CREATE)

**Phase 6 — sweep, docs**

- `src/features/booking/accessibility.test.tsx` (CREATE) — the cross-cutting properties
- `docs/runbooks/rider-a11y-walkthrough.md` (CREATE) — 12 steps, result section marked **blocked** with the hardware reason
- `docs/ux-metrics-ledger.md` (UPDATE) — Rider rows 1 and 2
- `apps/rider/CLAUDE.md` (UPDATE) — the pin, multi-stop and balance lines were false

## Tests added

| Package | Suites | Tests | Notes |
|---|---|---|---|
| `@taxi/shared` | +0 files | +6 | quote body/preview schemas |
| `@taxi/api` | +0 files | +10 | 4 geo rider-access, 6 rides (incl. E13, E14) |
| `@taxi/rider` | 29 files | 113 | the whole app, from zero |

Edge cases from the plan's table, and where each is verified:

| # | Verified in | |
|---|---|---|
| E1 | `booking-draft.test.ts` — quote discarded, key rotated | ✅ |
| E2 | `use-quote.test.tsx`, `booking-screen.test.tsx` | ✅ |
| E3 | `use-ride-status.test.tsx` (fake timers), `status-screen.test.tsx` | ✅ |
| E4 | `search-sheet.test.tsx`, `use-quote.test.tsx`, `address-search.controller.spec.ts` | ✅ |
| E5 | `use-book-ride.test.tsx` — 409 retried with the SAME key | ✅ |
| E6 | `use-book-ride.test.tsx` — offline, key preserved | ✅ |
| E7 | `use-ride-status.test.tsx` — refetch on reconnect, not on first connect | ✅ |
| E8 | `use-ride-status.test.tsx` — `accepted → requested` followed | ✅ |
| E9 | `search-sheet.test.tsx` — row removed on 404 | ✅ |
| E10 | `use-session.test.tsx` | ✅ |
| E11 | `booking-screen.test.tsx` — permission denied, booking still reachable | ✅ |
| E12 | `saved-places-store.test.ts`, `use-saved-places.test.tsx` | ✅ |
| E13 | `rides.integration.spec.ts` — `maps.routeCalls === 1` | ✅ |
| E14 | `rides.integration.spec.ts` — 404, not 403 | ✅ |

## Validation results

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
→ **22 successful, 22 total; exit 0** (`observed`).

`REDIS_TEST_URL` is set, so no suite is gated off — this is not the "green and 33
tests short" shape root `CLAUDE.md` warns about.

| Package | Suites | Tests | Baseline at `a6481aa` | Δ |
|---|---|---|---|---|
| `@taxi/shared` | 23 | 217 | 211 | +6 |
| `@taxi/api` | 72 | 672 | 662 | +10 |
| `@taxi/driver` | 27 | 109 | 109 | **0 — untouched** |
| `@taxi/dispatch` | 27 | 224 | 224 | **0 — untouched** |
| `@taxi/db` | 3 | 17 | 17 | 0 |
| `@taxi/rider` | 29 | 113 | **task did not exist** | +113 |

**Baseline** `observed` on the same command at `a6481aa` before any edit: 20
successful, 20 total, exit 0 — with `@taxi/rider:lint` and `@taxi/rider:test`
absent from the task list entirely. That absence is R2, and the task count moving
20 → 22 is what closes it.

**One re-run was needed, and it was not this ticket's code.** A first pass of the
full gate failed two api integration cases with `Parse Error: Expected HTTP/, RTSP/
or ICE/` — E13 and `customers › caps a dispatcher walking the number range`, the
latter untouched by this ticket. Both pass run alone
(`pnpm --filter @taxi/api test -- rides.integration customers.integration` →
28/28) and both pass on the next full gate. This is the cross-suite integration
flake already recorded for this repo, not a regression.

Additional checks:

- `pnpm --filter @taxi/rider exec tsc --version` → **5.9.3** (R1).
- `npx expo config --type public` in `apps/rider` resolves
  `android.permissions` to exactly `ACCESS_COARSE_LOCATION` and
  `ACCESS_FINE_LOCATION` (plus their fully-qualified twins from the
  `expo-location` plugin). No `ACCESS_BACKGROUND_LOCATION`, no
  `FOREGROUND_SERVICE*`, no `RECEIVE_BOOT_COMPLETED` — **AC #9 `observed`**, not
  argued from the manifest source.
- Largest shipped source file touched: `services/api/src/features/rides/rides.service.ts`
  at **418** lines; `packages/shared/src/schemas/ride.ts` at **372**. Cap is 500.

## Risk register — every risk closed by its own command

| Risk | Closing command | Result |
|---|---|---|
| R1 — TS 6 reddens `@taxi/shared` lint | `pnpm --filter @taxi/rider exec tsc --version` | **5.9.3** (`observed`); `@taxi/shared` lint exits 0 |
| R2 — turbo green on an app with zero tests | `pnpm turbo run lint test --filter=@taxi/rider` | names `@taxi/rider:lint` **and** `@taxi/rider:test`. At baseline `a6481aa` the same gate listed only `@taxi/rider:typecheck` — the blindness was real and is closed |
| R3 — the cache claim stays `derived` | `pnpm --filter @taxi/api test -- rides.integration` | E13 passes: **one** paid Routes call across preview + booking. The claim is now `observed` |
| R4 — `assertWithinRateLimit` re-derived | `git diff origin/main -- services/api/src/features/rides/rides.service.ts` | **no change** to its signature or body |
| R5 — the SR pass silently skipped | the runbook's result section | records **blocked**, names the hardware reason, and is dated |

## Post-review fixes (found by a second pass over the plan's States table)

Four things the Phase 6 sweep missed, all in the same blind spot: a state the plan
declares that nothing in the diff shows missing.

- **`booking-screen.tsx` rendered the ANNOUNCE string as the quote-failure banner.**
  `draft.quoteErrorCode` was written by the reducer, asserted in
  `booking-draft.test.ts`, and read nowhere — so a 429, a maps outage and a dead
  network all read as one generic sentence, and the `/book` **Offline** row was
  unreachable. Now `t(errorMessageKey(draft.quoteErrorCode ?? 'generic'))`, with
  three cases pinning offline, throttle and generic separately. This is the #18/M7
  shape and it would have reached review.
- **Accessibility property 6's fifth announce trigger was unasserted.** The
  no-drivers timeout does fire (the effect keys on the rendered line), but
  `status-screen.test.tsx` only checked the rendered text. Four of five triggers
  were proven; now five.
- **The `/book/address` Error row's "cooldown copy with seconds" did not exist.**
  Added: a 429 sets a ticking countdown from `retryAfterSeconds`, the field stops
  searching while it runs, and it resumes on the SAME session token — because the
  throttled call never reached the provider. New key `rider.book.retry_in`.
- **Four dead catalog keys removed** — `rider.book.change`, `rider.action.retry`,
  `rider.action.save`, `rider.action.cancel`. Each was written for an affordance
  this app does not have (the pickup row is tappable in place rather than carrying
  a `[Change]` button; the gate's banner takes no action). Verified by grep: no
  call site in `apps/rider/src`. The rider block is **54 keys × 3 languages**.

## Deviations from the plan

Fourteen, each with its reason. The first two are the ones a reviewer should look at hardest.

1. **`previewQuote` lives in a new `RideQuoteService`, not on `RidesService`.** The plan
   put it on `rides.service.ts`, which was 387/500 lines; the method, its docblock and
   the private throttle helper measured out at roughly +100, leaving almost no headroom
   under the `max-lines` cap. The split is along a real seam — the preview creates
   nothing (no reservation, no repository write, no emit, no transition) — and it makes
   R4 structural rather than a promise. `rides.service.ts` ends at **418**.

2. **The Places session token IS rotated on a 404 `place_not_found`.** The plan's E9
   says it is not. Reading the source disagrees with the plan, and with the plan's own
   stated rationale: `caching-maps.provider.ts:470` bypasses the place cache whenever a
   session token is present and line 477 always calls the inner provider, so a 404 means
   the provider **was** reached and the billed session **is** spent. Carrying a spent
   token into the next searches bills them individually — exactly the cost
   `ADDRESS_RESOLVE_MAX_PER_WINDOW`'s docblock computes. The rule now shipped is: rotate
   when the api answered (200 or 404), never on a 429 or an offline failure, because
   those never reached the provider. Both halves are tested.

3. **`rider.status.queued` was not added to the catalog.** The plan lists it with a
   `{position}` placeholder, but `rideStatusEventSchema` carries no queue position and
   `driver:queue` is emitted to a driver room. The rider has no source for the number, so
   the key could never render. A key nothing can fill is dead copy.

4. **`rider.status.still_searching` carries no `{minutes}` placeholder.** It fires once at
   60 s; a counter rendered then and never updated would say "1 min" to a rider who has
   waited five. Keeping it honest costs a ticking timer and an announcement every minute,
   for a message whose only job is "we are still looking".

5. **`[Save this address]` is on the booking screen, not in the search sheet.** The plan's
   breadboard puts it in `/book/address`, but the sheet navigates away the instant a
   resolve lands, so an affordance there would need an extra step and would break the
   three-tap new-destination path the friction audit budgets for. It sits under the
   filled dropoff row instead, where the rider can see what they are naming.

6. **`expo-crypto` added as a dependency.** Plan assumption A4 said to verify
   `crypto.randomUUID()` in Hermes at implementation time. Hermes ships no WebCrypto
   global, and the dispatch console's `newUuid` fallback exists for jsdom, not for a
   phone. `expo-crypto@~57.0.2` is what the SDK bundles. Never hand-rolled —
   `idempotencyKeySchema` is `z.string().uuid()`.

7. **`STILL_SEARCHING_MS` stays at 60 s, with the arithmetic that Q3 asked for.** The
   cascade is `MAX_OFFER_ATTEMPTS = 5` (`dispatch.policy.ts:35`) ×
   `offerTimeoutSeconds = 20` (`platform-config.ts:40`) = **100 s** worst case. 60 s is
   three whole offer windows, so at least three drivers have been asked when it fires.
   Deliberately **below** the cascade rather than above it: the plan wanted to clear the
   whole thing, but this message does not claim failure, and 100 s of silence is worse
   for a rider with no spinner to watch. The reasoning is in the constant's docblock.

8. **`findNodeHandle` is faked in `jest.setup.ts`.** Under this renderer it returns `null`
   even for a ref that IS attached (`observed` via a probe). `useScreenFocus` guards that
   null, so without the fake `setAccessibilityFocus` is never called and "focus lands on
   the header" — the app's whole differentiator — is unassertable. A Proxy fakes that one
   function and passes everything else through, preserving the lazy getters the warm-up
   block exists for.

9. **`useQuote`'s effect has no `cancelled` cleanup flag.** Caught by its own test:
   `shouldQuote` flips false the moment the effect dispatches `quoteRequested`, so an
   effect-scoped cancel tears down before any response arrives and drops **every** quote.
   The request id in the reducer is the staleness guard and is the correct place for it.

10. **`current-position.ts` extracted into `features/places`.** The plan had the
    reverse-geocode inline in `booking-screen.tsx`. Extracting keeps that screen
    composition-only under the 500-line rule and lets the search sheet's
    `[Use current location]` reuse it.

11. **The gate screen lives in `features/auth/gate-screen.tsx`,** not a new slice — it is
    purely a session decision, and the rider app has no onboarding.

12. **`GET /rides/:rideId` reuses `RidesRepository.findWithQuote`;** no repository method
    was added, per the plan's own instruction to check first.

13. **The rider eslint config sets `no-console: 'error'` plain,** where the driver allows
    `warn`/`error`. This app has no headless task and no offline queue, so every failure
    it can have is one a rider is looking at. The plan asked for exactly this call.

14. **A cross-cutting `accessibility.test.tsx`** was added beyond the plan's file list.
    Four of the ten spec properties are properties of the app rather than of any one
    screen (44 px floor, disabled/busy state, audio-lean labels, no blank labels in any
    language); they needed one home so a later screen cannot quietly break them.

## Blocked, and not quietly

Three items in the plan cannot be completed on this hardware. None is a code gap.

- **AC #6 — the TalkBack walkthrough has not been run.** `~/Library/Android/sdk/emulator`
  does not exist and Android Studio is not installed (`observed` 2026-09-02); `adb` is
  present with nothing to talk to. VoiceOver is separately unreachable: this Mac is at
  the Xcode 26.3 ceiling and SDK 57 needs 26.4 for iOS. The runbook exists, is
  performable, and its result section says **blocked** with both reasons rather than
  claiming a pass. The RNTL suite is what ships as the gate.
- **AC #7 — the tap count is not measured.** The plan's figure of 2 is `derived`. The
  ledger records "not measured" and names the walkthrough step that will produce the
  real number, rather than inheriting the plan's digit.
- **Level 4 (all ten manual steps) did not run,** for the same reason. Every step that
  could be pinned by an automated test is; the ones that need a real socket, a real
  permission dialog or a real empty driver pool are owed.

A follow-up ticket should own the hardware and the run.

## Issues encountered

- **`react-hooks/set-state-in-effect`** rejected the `stillSearching` reset in the effect
  body. Moving it into the cleanup is both what the rule wants and what the semantics
  want: leaving `requested` is what makes the flag stale, and status can move backward
  (E8), so a released ride starts its minute over.
- **Jest hoists `jest.mock` factories** above the consts they close over and only allows
  `mock`-prefixed names; two spec files needed renames.
- **A `useSession` mock returning a fresh object literal per call** put `useRideStatus`
  into an infinite render loop and OOM'd node. The real provider memoizes its value, so
  this was a harness artifact — the mock now holds one object.
- **`jest.spyOn` created inside the last `it()` of a file** reports the focus calls the
  earlier renders in that file made. Every focus assertion now installs its spy in
  `beforeEach` and restores it in `afterEach`.
- **`tsc` caught what jest could not:** two self-referential mock objects
  (`return socket` from inside their own initializer) inferred as `any`. The babel-based
  jest run is blind to that; the gate is not. This is why `pnpm check` is not the gate.
- **`toHaveAccessibilityState` is gone in RNTL 14** — the checked state is queried
  through `getByRole(role, { checked })` instead, which also fails when the state is
  absent rather than merely wrong.

## Ready for the next step

Next: `piv-commit`, then `piv-create-pr`, then `piv-review-pr`.

**The PR body must not inherit any figure from this report** — re-derive each at HEAD.
The ones that carry weight: `lv.ts` at 368 lines, `rides.service.ts` at 418, the 100 s
cascade arithmetic behind `STILL_SEARCHING_MS`, and E13's single route call. And when
closing #16, grep the issue and the PR body for `pin`, `drag` and `map`: the original
acceptance criterion was retired by subject, not just by sentence.
