# PR #150 review — `feat(rider): auth shell + text-first booking, screen-reader-first (#16)`

**Head** `8cd083f` · **Base** `main` @ `0a619d3` · **Round** 1 · **Reviewed** 2026-09-03
**Scale** 108 files, +8,457 / −1,509 · **State** OPEN · first review pass on this branch

## Recommendation — request changes

One Critical, four High. The approach is not in question — this is careful, well-reasoned work, and
the numbers pass reproduced **every** figure in the PR body without a correction, which has not
happened on this repo before. What the green gate cannot see is that **the live ride-status screen
never receives a single event** (C1): the rider's socket is created strictly after the only moment the
server joins them to their ride room. The screen renders one REST snapshot and then goes quiet for
good. Three of the four Highs are states a rider enters and cannot leave without killing the app.

C1's fix is a design decision (client-held socket vs. an api rejoin), not a patch — decide it before
touching code.

---

## Validation — `observed` 2026-09-03 at `8cd083f`

`pnpm install --frozen-lockfile` (exit 0), then from cleared `dist` / `.turbo` / `.next`:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force      → exit 0, 22/22 tasks, 1m52s
```

| Package | Suites / files | Tests | PR body claims | |
|---|---|---|---|---|
| `@taxi/api` | 73 | 689, **0 skipped** | 689 / 73 | ✅ |
| `@taxi/rider` | 29 | 113 | 113 / 29 | ✅ |
| `@taxi/shared` | 23 | 217 | 217 / 23 | ✅ |
| `@taxi/dispatch` | 27 | 224 | 224 / 27 | ✅ |
| `@taxi/driver` | 27 | 109 | 109 / 27 | ✅ |
| `@taxi/db` | 3 | 17 | 17 / 3 | ✅ |

`REDIS_TEST_URL` was set, so nothing was gated off — not the "green and 33 short" shape. No `.skip`,
`.only` or `.todo` anywhere in the diff. Wall time differs from the PR body's 1m24s; that is the
machine, not the tree.

**A green gate is not evidence here.** C1, H1 and H3 are all green, because each is a property of how
two correct pieces meet. C1 in particular is invisible to `use-ride-status.test.tsx`, which replaces
the socket with a handler map and calls the handlers directly — it pins the wiring, never delivery.

**Findings reproduced rather than argued:** C1 (in the api's own integration harness), H2, M2 and L1
(in the rider app's own RNTL harness). Each repro was reverted after its run; the working tree is
clean and no file in this PR was modified.

---

## Critical

### C1 · `apps/rider/src/features/ride-status/use-ride-status.tsx:64-91` — the status screen receives no `ride:status` event, ever

The rider's socket is created inside `useRideStatus`, which mounts only when `StatusScreen` does — and
`booking-screen.tsx:103-108` reaches `/book/status` by `router.replace` **after** `book()` resolves. By
then the server has already run the rider's only ride-room join.

Every link verified in this review, from source:

| Step | Evidence |
|---|---|
| `ride:status` goes only to the ride room | `realtime.service.ts:22-28` — `emitToRide` → `rideRoom(rideId)` |
| a connecting socket is never auto-joined to one | `room-policy.ts:16-37` — `canJoin` returns `false` for ride rooms; `roomsOnConnect` yields user/driver/dispatch only |
| the join reaches only sockets alive at that instant | `realtime.service.ts:64-66` — `server.in(userRoom(id)).socketsJoin(rideRoom(rideId))` |
| the rider's join runs inside `POST /rides` | `rides.service.ts:400` (`notifyRider`) and `:289` (the idempotent replay) — the **only** two rider joins in `services/api/src`; `dispatch-notifier.ts:66` joins the *driver* |
| the rider socket has one production call site | `createRiderSocket` ← `use-ride-status.tsx:80` only |
| the api's own spec states the constraint | `ride-lifecycle.integration.spec.ts:255-257` and `:323-325` — "Attach this BEFORE `POST /rides` — which is also when `notifyRider` runs the one and only `joinRideRoom` for the rider", and the test connects the rider before booking |

`notifyRider`'s own comment closes it: *"If the rider has no live socket the join is a no-op."* That is
exactly the app's case.

**`observed`, not argued.** I reproduced the app's ordering inside the api's own integration harness —
`book(r.auth)` first, `connectClient(port, r.token)` and `collectStatuses(sock)` **after**, then
`offerTo(ride)` — and asserted both halves:

```
CONTROL  (await rideRow(ride.id)).status                  → 'offered'   ✓ the ride did transition
CLAIM    seen.filter((e) => e.rideId === ride.id)         → []          ✓ the socket saw nothing
```

`jest --runTestsByPath ride-lifecycle.integration.spec.ts -t "REPRO C1"` → **1 passed**. Invert only
the two lines' order — connect before booking, as every other test in that file does — and the events
arrive. The repro is a ~20-line insert into `ride-lifecycle.integration.spec.ts`; it was reverted after
the run and the tree is clean.

**Failure scenario:** rider taps Book → `/book/status` shows «Meklējam auto…» from the single REST read
at `use-ride-status.tsx:72-78` → a driver accepts 20 s later → the screen still says «Meklējam auto…».
The `rider.a11y.status_changed` announcement — the reason the screen exists — never fires. The only
update path left is `if (seenConnect) refetch()` on a *re*connect, so the screen self-heals only when
the network happens to blip.

**And it looks healthy while it happens.** The socket connects fine — it is authorized, it just is not
in the ride room — so `connected` goes `true` (`use-ride-status.tsx:82-87`) and the
`rider.status.reconnecting` banner at `status-screen.tsx:100-102` never renders. The screen actively
reassures the rider that the connection is live while no event can reach it. A silent screen with a
"reconnecting" warning would at least be honest.

**And the docblock names the mechanism, then applies it to the wrong connect.**
`use-ride-status.tsx:37-43` says: *"`roomsOnConnect()` returns no ride room and `joinRideRoom()` only
moved the sockets that existed when it ran, so a socket that just reconnected is NOT in the ride
room."* Correct — and equally true of the socket's **first** connect, which line 89 deliberately skips.
"the reconnect hole patched (D4)" is a guarantee the code does not make. The same claim is repeated in
`rides.service.ts:158-165` and `services/api/src/features/rides/index.ts:14-16`.

The tests miss it because `use-ride-status.test.tsx:36-47` swaps the socket for a handler map and
invokes the handlers directly — it asserts the wiring, not delivery.

**Two candidate fixes, different blast radii:**
- *Client:* hold one socket above `StatusScreen` (created on sign-in, beside `SessionProvider`) so it
  is already in `user:<id>` when `notifyRider` runs. Smallest change; leaves the genuine reconnect hole
  the docblock describes.
- *Server:* have `handleConnection` join the connecting rider's active ride room, or re-join on
  assignment. Closes both; an api change beyond this PR's stated scope.

A client-side poll of `GET /rides/:id` contradicts the budget reasoning in `use-quote.ts:15-17` and
should not be chosen by default.

---

## High

### H1 · `apps/rider/src/features/booking/use-quote.ts:29-30` + `booking-screen.tsx:80-95` — a failed quote is an unrecoverable dead end

`useQuote` fires only while `quoteState === 'idle'`; `quoteFailed` sets `'failed'`
(`booking-draft.ts:98-106`) and only `withFreshAttempt` returns to `'idle'`. There is no retry
affordance — the failure `Banner` at `booking-screen.tsx:167-172` is passed no `action`.

Rider in a lift, dropoff chosen, quote fails `offline`. Network returns. They tap the dropoff row and
re-pick **the same** address. `SearchSheet.done` navigates back with byte-identical params, so
`[address, dispatch, field, lat, lng, placeId]` are unchanged, the effect does not re-run, no
`setDropoff` is dispatched — nothing happens at all. Book stays disabled, the danger banner stays up.
The only escape is choosing a *different* destination or killing the app.

**Fix:** a `quoteRetry` action that clears `quoteState`/`quoteErrorCode` **without** calling
`withFreshAttempt` — the corridor did not change, so the idempotency key must be preserved — surfaced
through `Banner.action`, which already exists, with a `rider.book.retry` key in all three catalogs.

### H2 · `apps/rider/src/features/booking/booking-screen.tsx:67-76` — a late GPS fix silently overwrites a pickup the rider chose by hand

The mount effect dispatches `setPickup` unconditionally when `currentPositionPoint()` resolves. Its
`cancelled` flag guards *unmount only*, and `/book` is **pushed over**, never unmounted, when the rider
opens `/book/address`.

Worse than a stale row: `setPickup` runs `withFreshAttempt` (`booking-draft.ts:110-119`), so the
overwrite discards the quote, mints a **new** `Idempotency-Key`, and — `shouldQuote` going true again —
silently re-quotes a corridor the rider did not choose. A rider looking at €8.40 for their own pickup
gets a different price for the device's position, with nothing saying anything moved. Tap Book while
glancing away and the car goes to the wrong address.

`observed` — repro under the app's own RNTL harness (deferred `getCurrentPositionAsync`, pickup chosen
via route params, then the fix lands): the row reads `Brīvības iela 45` where the rider chose
`Stacijas laukums 1`.

The window is unbounded. `current-position.ts:26-28` passes only `accuracy`, and no timeout exists
anywhere — yet its docblock at `:8-10` lists "a timeout" among the handled outcomes. A second guarantee
the code does not make.

**Fix:** apply the GPS point only while the pickup is still `null` — a `setPickupIfEmpty` action keeps
it pure and avoids the key rotation. Add a real deadline (`Promise.race`) so the docblock becomes true,
or delete the claim.

### H3 · `apps/rider/src/features/auth/use-session.tsx:99-113` + `src/app/_layout.tsx:11-20` — an expired token strands the rider on a dead screen

`api-client.ts:121` fires `onUnauthorized` → `signOut()` → state `signedOut`. **Nothing navigates.**
`GateScreen` is the only auth-aware surface and it lives at `/`, which its own
`<Redirect href="/book" />` has already replaced off the stack. `/book`, `/book/address` and
`/book/status` have no guard, and `_layout.tsx` is `SessionProvider` + `Stack` with no auth branch.

The 30-day token expires while the app is backgrounded (`session-store.ts:27` checks `expiresAt` at
launch only, so a resumed app still reads `signedIn`). The rider picks a destination → the quote 401s →
the session clears → every later request carries no bearer, so `onUnauthorized` is not even reached
(line 121 requires `token`) and every failure renders as `rider.error.generic`. They tap Book against a
dead session with no route back to `/login`.

The copy for this path was written and never wired: `rider.error.session_expired` exists in all three
catalogs and has **zero** references in `apps/rider/src` (grepped).

**Fix:** redirect to `/login` on `state.status === 'signedOut'` from a guard in `_layout.tsx` (or a
layout over the authed routes), carrying `session_expired` into the login screen so the bounce is
explained.

### H4 · `apps/rider/src/features/places/search-sheet.tsx:105-116, 248-256` — the suggestion list is never announced; on iOS the sheet announces nothing

`apps/rider/CLAUDE.md:8` states the design as "type, **hear the suggestions**, tap one". Trace the
status ternary: results `ok` → `current.status` is neither `failed` nor `empty` → `status = 'idle'`
with `searchable === true` → the render ternary at `:249` falls through to `''`. The live region goes
from «Meklē…» to empty and says nothing. There is no results-count copy in any catalog.

Worse on iOS: `:248` is a bare `<Text accessibilityLiveRegion="polite">`, and `Banner.tsx:29-41` — in
this same PR — documents that `accessibilityLiveRegion` is Android-only and that iOS hears nothing
without an explicit `announceForAccessibility`. So a blind rider on iOS hears no "searching", no
"nothing found" and no "8 results": silence until they swipe into the list and discover whether rows
exist. This is the launch differentiator failing on the screen the app's own rules file describes as
the place you hear the suggestions.

**Fix:** reuse `Banner` for the status line (it already does announce-on-iOS + live-region-on-Android)
and add `rider.address.results_count` to lv/ru/en.

---

## Medium

**M1 · `apps/rider/src/features/auth/verify-screen.tsx:30-34, 102` — `phone` is typed `string` but can be `undefined` at runtime.**
`useLocalSearchParams<{ phone: string; … }>()` asserts a param the router does not guarantee, and
`app.json:40` sets `"scheme": "saktacabrider"`, so `saktacabrider://verify` opens this screen with no
params. `formatMessage` treats a present-but-undefined key as present — `format-message.ts:26-28` is
`name in params ? String(params[name]) : match`, and `'phone' in { phone: undefined }` is `true`, so
the placeholder resolves to the string `"undefined"` rather than staying verbatim (re-derived from the
source, not inherited). The hint renders «Kods nosūtīts uz undefined» and `submit` posts
`{ phone: undefined, code }` → 400 → `rider.error.generic` on every attempt. `status-screen.tsx:53-54` gets the identical pattern right (`{ rideId?: string }`, `??
null`, `disabled` guard) — match it.

**M2 · `apps/rider/src/features/places/search-sheet.tsx:117-143` — an out-of-order search response wipes the live list and strands the sheet on "Searching…".**
The cleanup clears the debounce timer but never abandons an already-dispatched request, and the `.then`
writes `setResults({ query, … })` unconditionally. If `"Brī"` answers after `"Brīvības"`, the newer
results are overwritten, `current` evaluates to `null` (`results.query !== query`), and the status line
falls back to `searching` — **with no request in flight**. The rider must type another character to
escape. `observed` under the app's own fake-timer harness.
The inconsistency is the tell: `use-quote.ts` carries a `quoteRequestId` staleness guard and argues for
it at length (deviation 9); its sibling here fires on **every keystroke** and has none. Same fix.

**M3 · `services/api/src/features/rides/index.ts:16-18` — the slice barrel states a guarantee the code does not make.**
It says `GET /rides/:rideId` "returns the ride and nothing else: no driver, no position, no ETA, no
plate." `findForRider` (`rides.service.ts:173-183`) returns `found.ride` straight from
`findWithQuote`, and `toRide` projects `driverId: row.driverId` (`rides.repository.ts:106`) plus, once
the five settlement columns are written, a full `split` with `commissionPct` / `commissionCents` /
`driverNetCents` (`:114-119`). `findForRider` does not filter by status, so: ride completes → driver
settles → the rider reads their own ride → the response carries the commission line. Twenty lines away,
on `rideQuotePreviewSchema` (`packages/shared/src/schemas/ride.ts:149-156`), this PR argues that
publishing the commission to a rider surface is precisely what must not happen. No test pins it either
way. **Fix:** `return { ...found.ride, split: null }`, or rewrite the barrel to say what crosses the
wire.

**M4 · `apps/rider/CLAUDE.md:13` — a rules file added by this PR gives a false reason for a true conclusion.**
"Multi-stop, scheduled rides, multi-taxi and rider bids are **not sent** by this app:
`rideQuoteBodySchema` carries none of them, and the booking body sends only pickup, destination and
payment method." But `rideQuoteBodySchema` picks `stops: true`
(`packages/shared/src/schemas/ride.ts:140-146`), and `rideRequestBodySchema` carries `stops`,
`scheduledFor`, `vehicleCount` and `offeredPriceCents`. The conclusion holds only because
`use-quote.ts:41` chooses to send `{ pickup, destination }` — behaviour, not a schema guarantee. The
next person adding a field trusts a guard that is not there.

**M5 · `services/api/src/features/rides/ride-quote.service.ts:76` — the quote path has no failure log.**
`await this.pricing.quote(request)` is uncaught. Its sibling `RidesService.createRide` wraps the
identical call and writes `ride.request.failed` (`rides.service.ts:228-238`) with the reason spelled
out: "without this a 500 on `POST /rides` leaves nothing to tell 'one rider, one corridor' from 'maps
is down'." That transfers verbatim, and `/rides/quote` is the *higher-volume* paid-Routes caller (cap
30 vs 20). On a Routes timeout the only line emitted is `geo.maps.route_failed`, which carries a cell
hash and no actor by design — nothing correlates the outage to riders.

**M6 · `apps/rider/src/features/ride-status/status-screen.tsx:22-33, 104-110` — a terminal ride leaves only a button that will fail.**
`/book/status` is reached by `router.replace`, so there is no back entry. On `cancelled_by_driver` /
`cancelled_by_dispatcher` the only control is «Atcelt braucienu», which 409s. `completed` and `settled`
fall through `:32` to `rider.status.matched` — «Auto ir atrasts» for a finished ride. **Fix:** on any
`cancelled*` / `completed` / `settled`, swap the danger button for one that `router.replace('/book')`.

**M7 · `apps/rider/src/features/booking/booking-screen.tsx:118-126` — the pickup row's empty state uses the dropoff's copy.**
Both rows fall back to `t('rider.book.where_to')`, so with location refused (the E11 / D7 path the app
explicitly supports) a screen reader hears «Kurp?, Iekāpšanas vieta» then «Kurp?, Galamērķis» — two
rows differing only in the trailing word. The plan's breadboard has the pickup row reading
`[Current location: «…»]`, and there is no `rider.book.pickup_empty` key.
`booking-screen.test.tsx:124` records the current copy as intended, so this is an undocumented
divergence rather than a gap in the tests.

**M8 · `apps/rider/src/features/places/search-sheet.tsx:201-211` — denied location is reported as an unexplained failure.**
`currentPositionPoint()` returns `null` for permission-denied, and `current-position.ts:7-10` states in
this PR that `null` "IS AN ORDINARY OUTCOME, NOT AN ERROR (decision D7)". The caller sets
`rider.error.generic` — «Kaut kas nogāja greizi. Mēģiniet vēlreiz.» — so a rider who deliberately
refused location is told the app broke and invited to retry something that will fail identically.

**M9 · `apps/rider/src/features/ride-status/status-screen.tsx:66-73` + `components/Banner.tsx:43-47` — the status line is spoken twice on iOS.**
`Banner` announces its `text` on iOS via its own effect; `StatusScreen` separately announces
`rider.a11y.status_changed` built from the same `line`. Both are keyed on `line`, so every change
produces «Auto ir atrasts» immediately followed by «Brauciena statuss: Auto ir atrasts». Drop one.

---

## Low

**L1 · `search-sheet.tsx:129-142`** — a dead error banner survives the next successful search: the
`.then` never calls `setError(null)` (only `resolve()` and `fillFromCurrentLocation()` do). `observed`
— a rejected search followed by a successful one leaves `rider.error.generic` above a healthy list, and
on iOS `Banner` re-announces the stale text. One line: `setError(null)` beside `setResults`.

**L2 · `rides.controller.ts:72-78`** — `POST /rides/quote` answers **201 Created** for an operation
whose defining property is that it creates nothing (Nest's POST default). The route docblock and the
test title both say the opposite. `@HttpCode(HttpStatus.OK)`; three assertions in
`rides.integration.spec.ts` (437, 468, 497) move 201 → 200, and the rider client is status-agnostic on
success.

**L3 · `address-search.controller.spec.ts:6`** — `import { ROLES_KEY } from
'../auth/decorators/roles.decorator';` reaches past the slice barrel, which already exports it
(`features/auth/index.ts:7`). The only import in `services/api/src` that reaches inside
`features/auth/`; the `.spec` carve-out covers `max-lines`, not slice boundaries.

**L4 · `search-sheet.tsx:34-39`** — name the case where the mirror stops agreeing. `MIN_CHARS = 3`
mirrors `PLACES_SEARCH_MIN_CHARS`, and the comment says "below this the api answers `[]` anyway —
matching it here saves the round trip rather than deciding anything". True at the default only: the
server value is `z.coerce.number().int().positive().default(3)` (`env.schema.ts:169`) and a live knob
(`.env.example:76`). Raise it to 5 and the app sends 3- and 4-character queries the api answers `[]`
to — the rider sees "Nothing found", which is a lie. No test can express the divergence; the two values
sit on opposite sides of a network boundary. Amend the comment.

**L5 · `app.json:25-28`** — `ACCESS_FINE_LOCATION` is declared alongside `ACCESS_COARSE_LOCATION`,
while both `CLAUDE.md` files and `current-position.ts` describe pickup as defaulting from **coarse**
GPS and the code asks for `Accuracy.Balanced` (~100 m), which coarse satisfies. A wider ask than the
design states. (The foreground-only rule itself is respected — `observed` clean of
`ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE*`, `RECEIVE_BOOT_COMPLETED`.)

**L6 · `booking-screen.tsx:163`** — `draft.dropoff!`. Safe today (inside `draft.dropoff !== null`), but
the assertion will outlive the guard. Bind a narrowed local above the block.

**L7 · `Banner.tsx:24,30`, `Button.tsx:20-24`, `Screen.tsx:8`** — driver-app docblocks carried over
verbatim: Banner describes "a state change the **driver** should hear" and «Izlaist» from the battery
explainer; Button documents "the home toggle is a `switch`". None of those surfaces exist here. Rewrite
the prose — but keep `Banner.action`, which H1 and M6 both need.

**L8 · `use-saved-places.tsx:58-72`** — `save` and `remove` close over `places`, so two saves dispatched
before the first `setPlaces` commits both read the same array and the second overwrites the first in
AsyncStorage. Reachable by double-tapping «Saglabāt».

---

## The numbers pass — every figure reproduces

Re-derived at `8cd083f`, one check per claim. Nothing in the PR body needed correcting.

| Claim | Re-derived | |
|---|---|---|
| 108 files, +8,457 / −1,509 | `git diff --shortstat 0a619d3..8cd083f` — exact | ✅ |
| 86 added / 20 modified / 2 deleted | `--diff-filter=A/M/D` → 86 / 20 / 2, 0 renames | ✅ |
| `rider.*` = 54 keys × 3 languages | 54 in each of lv/ru/en | ✅ |
| lv/ru/en key sets identical | 268 keys each; `diff` empty both ways | ✅ |
| `RIDE_QUOTE_MAX_PER_WINDOW = 30` | `rides.policy.ts:77` | ✅ |
| `lv.ts` 368 · `rides.service.ts` 418 · `ride.ts` 372 | `wc -l` → 368 / 418 / 372 | ✅ |
| `rides.service.ts` "was 387/500" | `git show 0a619d3:…` → 387, +31 | ✅ |
| 100 s cascade = `MAX_OFFER_ATTEMPTS` 5 × `offerTimeoutSeconds` 20 | `dispatch.policy.ts:35`; `platform-config.ts:40` | ✅ |
| rider caps "4× tighter"; `5 × $2.83 = $14.15` | 120/30 = 4; 5 × 2.83 = 14.15 | ✅ |
| the geo cap model assumes a 60 s window | `ADDRESS_SEARCH_WINDOW_SECONDS = 60` | ✅ |
| the quote cap model assumes 600 s | `RIDE_REQUEST_WINDOW_SECONDS = 600` | ✅ |
| `geo.module.ts` "byte-identical to main's" | `git diff 0a619d3..8cd083f -- <file>` empty | ✅ |
| "main gained 14 commits under this branch" | `git rev-list --count a6481aa..0a619d3` = 14 | ✅ |
| runbook "12 steps" | 12 step headings | ✅ |
| +10 api tests, +6 shared | new `it(`/`test(` in the diff: 10 and 6, none removed | ✅ |
| `#16` stays open | `closingIssuesReferences` empty | ✅ |
| AC #6 / #7 recorded as blocked | runbook Result = **BLOCKED**; ledger = **not measured** | ✅ |

**Two apparent discrepancies, both settled as correct:**

- The PR body reconciles against `main`'s gate at **`f5a8dd1`**, which is not the base — `0a619d3` is
  nine commits ahead of it. Harmless: those nine touch only `.claude/` docs and one skill file
  (`git diff --stat f5a8dd1..0a619d3`), no source and no tests, so the `+10 api / +6 shared / 20 → 22
  tasks` deltas hold. Name the base sha next time rather than a convenient ancestor.
- The report's table says api **72** suites; the PR body says **73** on both sides. Both are right:
  `card-payments-disabled.provider.spec.ts` landed on `main` between `a6481aa` and `0a619d3` (#147).
  This branch adds **no** api suite, only cases.

## The guarantees pass

First round, so there is no prior `**Base** @ <sha>` to compare against — but the PR body documents a
rebase from `a6481aa` onto `0a619d3` with one conflict, so the pass was run anyway.

- **The conflict is resolved correctly.** `geo.module.ts` is byte-identical to `main`'s, so #147's
  `ALLOW_STUB_MAPS_PROVIDER` prose won and nothing from this branch was dropped. Verified, not
  inherited.
- **Conditional comments in the diff:** two, both benign — the `RIDE_QUOTE_MAX_PER_WINDOW` docblock's
  "re-derive two LIVE MONEY CAPS" and E13's "re-derive the cap … if it fails". Neither names a
  condition that has fired.
- **Absolute claims re-derived.** The load-bearing ones hold: `api-client.ts:104` ("LAST, so a caller's
  `headers` cannot replace the live session's bearer") is true as written; `booking-draft.ts:97` ("a
  late response … must never overwrite a newer quote") is true and tested.
  **Four do not** — C1 ("the reconnect hole patched"), M3 ("returns the ride and nothing else"), M4
  ("`rideQuoteBodySchema` carries none of them"), and H2's "a timeout" among `current-position.ts`'s
  handled outcomes. All four are guarantees rather than figures, which is the shape this pass exists to
  catch, and none of them is visible to typecheck, lint or test.
- **Two surfaces counting the same thing:** L4 (`MIN_CHARS` ↔ `PLACES_SEARCH_MIN_CHARS`).

## What is good

- **E13 promotes the cap's load-bearing assumption from `derived` to `observed`, unasked.**
  `rides.integration.spec.ts:460-486` proves a preview and the booking that follows share one
  `routeCacheKey` and cost one paid Routes call — on a corridor reserved for that case, so no earlier
  test can pre-warm the cache and make it pass for the wrong reason. The comment even names the correct
  response to a failure: re-derive the cap, do not weaken the assertion.
- **E14 gets 404-not-403 right and proves it with two distinct riders.** `:542-562` creates rider A's
  ride, reads it as rider B, and asserts the same 404 a fabricated uuid gets — closing the existence
  oracle a 403 would open. A driver token gets 403 on both new routes. Re-run here rather than
  inherited.
- **The rate-limit widening is tested as a widening.** `address-search.controller.spec.ts:147-185`
  asserts the rider's counter lands in `geo:search:rate:rider:<id>` *and* that the dispatcher key stays
  `null`; the negative assertion is what makes the caps independent rather than merely different.
  `:203-223` reads the `@Roles` metadata off the descriptor so a fourth role cannot creep in.
- **The preview provably mints nothing.** `previewQuote` touches one writer (the rate counter) and
  returns; `rides.integration.spec.ts:447` asserts the rider has **zero** rides afterwards — not "none
  for this corridor".
- **The idempotency-key lifecycle is the best-reasoned part of the PR.** Rotate on corridor change,
  preserve on payment change, one 409 retry on the same key with a stated reason for not looping. The
  pure reducer plus an injected `newKey` makes the rule testable without a native module — and the
  tests test it.
- **`accessibility.test.tsx:41-75` asserts app-wide properties, not screen details** — that no rider
  string in any of the three languages echoes its role into its label, and that no key is blank in any
  language. That is what stops a *future* screen regressing the differentiator.
- **`jest.setup.ts:101-120` is honest about its own fake**, stating that `findNodeHandle` returns
  `null` under this renderer even for an attached ref, and that only the TalkBack walkthrough can
  confirm the OS moves the cursor. `Banner.tsx:36-41` labels its Android behaviour `expected`, not
  observed.
- **The Places session-token lifecycle is right where it is easy to get wrong** — one token per field
  visit, rotated after a resolve *and* a 404 (the provider was asked), deliberately **not** after a 429
  or an offline failure, with the cost of the alternative costed out and a test pinning it.
- **Every cap docblock states its provenance and its condition.** `rides.policy.ts:55-77` and
  `address-search.policy.ts:46-90` both say `derived`, show the arithmetic, and name the model assumed.
- **Security fundamentals are clean.** Session in `expo-secure-store` (saved places in AsyncStorage —
  the right split, with the size rationale written down); bearer applied last so a caller's headers
  cannot displace it; `no-console: error` across `src/features/**`; a release build bundled without
  `EXPO_PUBLIC_API_URL` **throws** rather than silently targeting `localhost` on the phone; no
  client-side OTP counter and no enumeration oracle (`gate-screen.tsx:9-23` deliberately refuses a
  "this number is a driver" message).
- **Money is integer cents end to end.** `format-eur.ts:6-12` is pure integer arithmetic with the sign
  taken before the split; commission via `resolveCommissionPct` and then discarded from the preview at
  the schema layer, with `schemas-ride-request.test.ts:215-228` proving a `split` handed to
  `rideQuotePreviewSchema` is *dropped*, not merely unused.
- **Blocked work is recorded as blocked.** The a11y runbook's Result table says **BLOCKED** with both
  hardware reasons and a date; the ledger says **not measured** and names the walkthrough step that
  will produce the number rather than inheriting the plan's `derived` 2. The PR closes nothing, and
  `closingIssuesReferences` confirms it.

## Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 4 |
| Medium | 9 |
| Low | 8 |

**Request changes.** C1 first, and as a decision rather than a patch — the two candidate fixes have
different blast radii. Then H1–H4, each a state a rider can enter and cannot leave. M3 and M4 are cheap
and are exactly the claim-accuracy defect this repo has now shipped three times; M2 and M5 are the next
tier. The Lows are the author's call.

Next: `piv-fix-review-findings` on this report, then re-run the gate.
