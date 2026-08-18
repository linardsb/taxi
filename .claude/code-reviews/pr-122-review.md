# PR #122 review — phone orders: booking form, caller records, Places seam (#19 Phase B)

**Head** `16343ec` · **Base** `feature/dispatch-override-phone-orders` @ `ced2d30` (PR #120, stacked) · 70 files, +7756/−12
**Reviewed against** root `CLAUDE.md`, `apps/dispatch/CLAUDE.md`, `services/api/CLAUDE.md`, `packages/shared/CLAUDE.md`, `.claude/references/{logging-standard,ride-state-machine,realtime-events}.md`, the plan (Tasks B1–B15) and the implementation report (D0–D10, treated as intentional decisions).

**Recommendation: request changes.** One Critical, five High, nine Medium, fifteen Low. Validation is green and reproduces exactly. **No hard-rule violation on money, `assertTransition()`, payment-method locking, the seam boundary or the one-way `shared` dependency** — all four were checked and are intact. The two hard-rule breaches that do exist are both contract duplication, and both are one import away from fixed.

The thesis of this PR is right, and the review does not argue with it: a phone order is an ordinary ride, and the reuse is real — I traced the quote, the commission resolution, the rider-scoped idempotency reservation, the tracking token and the SMS branch that sends a caller with no app a tracking link, and none of them is forked or stubbed on this path. The findings are almost all in the thin layer around that reuse: what the console does after a booking succeeds, and what the wire can actually carry.

The Critical is the one to read first. It loses a booking silently, on the exact flow this feature exists for — the repeat caller.

---

## Validation

`observed` — my own run, worktree `/Users/Berzins/Desktop/taxi-phone-orders` at `16343ec`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **18/18 tasks, exit 0, 60.6 s**.

| Package | PR body claims | I observed |
|---|---|---|
| `@taxi/api` test | 64 suites / 559 tests | **identical** |
| `@taxi/shared` test | 20 files / 178 tests | **identical** |
| `@taxi/dispatch` test | 24 files / 185 tests | **identical** |
| `@taxi/db` test | 3 files / 17 tests | **identical** |
| typecheck · lint · build | clean | **clean** |

Zero skips reproduced, so the four Redis-gated spec files genuinely executed. GitHub Actions `check` is **SUCCESS** on this SHA. `closingIssuesReferences` is empty, which is what a Phase B of three intends.

The gate does not block this PR and could not have found any of the five most serious findings. Each one is named with the test that passes while it ships.

---

## Critical

### C1 · A booked draft keeps its spent idempotency key, so the repeat caller's second ride is silently never created
`apps/dispatch/src/features/phone-orders/use-booking-form.ts:299-300`

```ts
const { rideId } = await book(body, draft.idempotencyKey);
setBookedRideId(rideId);
```

`submit()` sets one piece of component state and nothing else. The draft is not cleared and the key is not rotated. Rotation happens only in `reset()` (`:262-265`), reachable only from the «Jauns pasūtījums» button (`booking-form.tsx:52-58`). The «Aizvērt» button beside it (`:59-66`) calls `onClose` → `page.tsx:59` sets `bookingOpen = false` → `{bookingOpen && <BookingForm …/>}` (`page.tsx:301`) **unmounts the component**, destroying `bookedRideId`, while the draft — phone, name, both addresses and the spent key — survives in `localStorage`.

**Failure scenario.** Dina books for `+37129999000`, key `K`. Success screen. She clicks «Aizvērt» — the button adjacent to the caller hanging up, and the one that does not say "start another order". The same caller rings back twenty minutes later. `⌥N` remounts the form, `restoreDraft()` returns the stored draft verbatim (`booking-draft.ts:173` persists `idempotencyKey`), and `bookedRideId` is `null` again, so the form renders **editable with «Pasūtīt» enabled and no indication this draft was already booked**. She changes the destination and books. Server side: `rideIdempotencyKey(riderId, K)` is rider-scoped (`rides.policy.ts:67`) with a 24 h TTL, the caller resolves to the same `riderId`, `setIfAbsent` fails, and `replay()` returns ride #1 (`rides.service.ts:112-120`). The console renders «Pasūtījums izveidots» carrying the **old** ride id. No car is dispatched for the second call. Nothing logs a problem at either end.

The PII half is the same defect: the caller's phone, name and both addresses stay in `localStorage` after a completed booking until logout or an explicit «Jauns pasūtījums». `session.ts:27-34` states that PII claim precisely and `clearSession()` (`:51-55`) does drop the key — the gap is the success path, not logout.

**Fix**, at the success site:

```ts
const { rideId } = await book(body, draft.idempotencyKey);
setBookedRideId(rideId);
setDraft(emptyDraft(newUuid()));   // clears the PII and rotates the key
```

The success screen reads nothing from `draft`, so this is safe. Regression test: book, **Close, reopen** (not «Jauns pasūtījums»), book again, assert the second `book()` call carries a different key. The existing `mints a NEW idempotency key for the next order (edge)` case at `booking-form.test.tsx:260-277` goes through «Jauns pasūtījums» and therefore passes today while the bug ships.

---

## High

### H1 · `null` is not representable on the lookup wire, so every first-time caller renders as a lookup failure
`services/api/src/features/customers/customers.controller.ts:31-39` → `apps/dispatch/src/features/phone-orders/booking-api.ts:96, 136-141`

`lookup()` returns `Promise<CallerLookup | null>` and the service docblock makes `null` the *ordinary* answer ("a first-time caller is the ordinary case, not a 404"). Nest's `isNil` check sends an **empty body**, not the JSON literal `null`. This PR's own test encodes that: `customers.integration.spec.ts:100` asserts `expect(res.body).toEqual({})`.

The console anticipated the right thing and cannot receive it:

```ts
return authedFetch(`/customers/lookup?${params}`).then((body) =>
  body === null ? null : callerLookupSchema.parse(body),
);
```

`authedFetch` ends in `return res.json()` (`:96`). On an empty body `res.json()` **rejects with a SyntaxError** — it does not resolve to `null`. So the `body === null` branch is dead code, the promise rejects, `use-booking-form.ts:169-175` catches it and sets `status: 'failed'`, and **every new caller shows «Neizdevās atrast zvanītāju» instead of the «Jauns zvanītājs» panel**. The `lookupState: 'none'` branch (`:191-192`) is unreachable in production; any test covering it constructs a state the API never produces. Booking itself still works, which bounds this to the panel — but the panel is the caller-ID feature.

**Fix**: have `authedFetch` read `res.text()` and return `null` for an empty body (one function, no contract change), or make the controller send an explicit JSON `null`. Then change `customers.integration.spec.ts:100` to assert the chosen shape deliberately rather than incidentally.

### H2 · The dispatcher path inherits the rider's cap, and the plan's own venue scenario now 429s
`services/api/src/features/rides/rides.service.ts:83,130` with `rides.policy.ts:14-15`

The 5th parameter is wired correctly — all four call sites verified, and D5's keying argument is sound. What was not re-derived is the **magnitude**. `RIDE_REQUEST_MAX_PER_WINDOW = 20 / 600 s` was sized for a rider, and its own docblock says so ("a real rider re-quotes a handful of times at most"). Plan Q7's motivating example — the example that justifies moving the subject at all — is **a venue booking 25 cars in ten minutes**. Those 25 now count against one dispatcher key, so bookings 21–25 answer `429 too_many_requests`. The sibling policy sized for the same actor disagrees too: `address-search.policy.ts:13` models a busy dispatcher at ~3 bookings/minute, i.e. ~30 per 600 s window, against a cap of 20.

The window is **fixed, not sliding** (`incrWithTtl` sets the TTL only when the key is absent), so this is not a brief ceiling: 20 bookings in the first minute lock the dispatcher out of `POST /dispatch/bookings` for the remaining ~9 minutes, mid-shift, with `retryAfterSeconds` up to 600.

No test can see it — `bookings.service.spec.ts` mocks `rides.request` wholesale and both integration specs stay far under 20.

**Fix**: a `DISPATCHER_BOOKING_MAX_PER_WINDOW` constant of its own, derived from the console's model (≥30 per 10 min with headroom, arithmetic stated in the docblock), with `assertWithinRateLimit` taking the limit alongside the subject.

### H3 · `addressPointSchema` is re-declared as a hand-written twin in two console files, and has already drifted
`apps/dispatch/src/features/phone-orders/booking-draft.ts:162-167` · `booking-api.ts:119-124`

Both hand-roll `z.object({ location: z.object({ lat: z.number(), lng: z.number() }), address: z.string() })`. `packages/shared/src/schemas/geo.ts:9-13` exports `addressPointSchema`, it is in the barrel, and **both files already import `AddressPoint` as a type from `@taxi/shared`**. Root rule: never duplicate a type an app can import; never hand-write a twin of a schema.

The twin has drifted in the direction that matters: shared has `address: z.string().min(1)` and `lat`/`lng` range bounds (`latLngSchema`), the copies have neither. A restored draft or a resolve response with `address: ''` passes the console parse, makes the draft look bookable, and is then rejected by the API's `dispatcherBookingBodySchema` — surfacing to Dina as the generic «Neizdevās izveidot pasūtījumu» for a validation failure the console could have caught locally.

Two of the three reviewers found this independently, from different files.

**Fix**: `import { addressPointSchema } from '@taxi/shared'`; use it as `point: addressPointSchema.nullable()` in `draftAddressSchema` and as the `resolvePlace` parse target.

### H4 · The `/customers/venues` envelope is declared twice and lives in neither package
`services/api/src/features/customers/customers.service.ts:10-13` · `apps/dispatch/src/features/phone-orders/booking-api.ts:53-57`

A hand-written `interface VenueEntry { customer; places }` on the API side, an independent `z.object({ customer, places })` on the console side. Both compose shared leaf schemas correctly — the *envelope*, which is the cross-surface contract, is the twin.

**Failure scenario**: rename `places` → `savedPlaces` on the API side. `pnpm turbo run typecheck` is green on both packages because nothing links them, the gate passes, and Dina's form throws a `ZodError` out of `listVenues()` the first time she opens it. The additive case is worse because it is silent: add a field API-side and the console's non-strict `z.object` strips it with no error anywhere.

**Fix**: `venueEntrySchema` into `packages/shared/src/schemas/customer.ts` beside `callerLookupSchema`, exported with its inferred type; delete both local copies.

### H5 · Escape can never close the booking dialog from an address field, and three places claim it can
`apps/dispatch/src/features/phone-orders/address-field.tsx:192-202`

```ts
if (event.key === 'Escape') {
  event.stopPropagation();      // ← unconditional, before the `open` check
  if (open) { setClosedFor(query); return; }
  onTextChange('');
}
```

`DialogShell`'s Escape handler is a React `onKeyDown` on the dialog `<div>` (`override/dialog-shell.tsx:35-40`) and the combobox input is a descendant, so a stopped synthetic event never reaches it. Escape #1 closes the popup; Escape #2 clears the text; Escape #3 and every one after clears an already-empty field and is swallowed. The dialog never closes — the dispatcher must Tab to «Aizvērt».

Three separate places assert the behaviour that does not happen: the comment two lines above it ("The dialog's own Escape handler sees it only once the popup is shut"), `dialog-shell.tsx:11-13` ("Escape ALWAYS closes — a dispatcher must never be stuck in a dialog she opened by accident"), and plan Task B14 ("Escape closes with the draft intact"). Per the root rule, a guarantee in a comment is a claim; this one is false as written.

**Fix**: scope `stopPropagation()` to the two branches that consume the event and let the terminal Escape bubble. Test it by rendering the field inside a `DialogShell` stub and asserting `onClose` fires on the Escape after the field is empty.

---

## Medium

**M1 · The place cache's write is not gated, so it stores Places content nothing can read** — `caching-maps.provider.ts:471` vs `:493`. The read is correctly gated on `sessionToken === null`; the write is unconditional. Every session-bearing resolve therefore persists `formattedAddress` plus a coordinate — Places *content*, not the caching-exempt place ID — for 30 days into a cache with no reachable reader (verified: the only production caller passes `body.session`, a required uuid). It is also a claim defect: `:461` says the write "keeps entries warm for it", but with a 30-day TTL every entry written today expires before the saved-place refresh (unscheduled) can read one, so the stated purpose is unachievable rather than dormant. Sharpened by plan Q6 recording the 30-day retention limit as `expected` — the terms page was unreadable. **Fix**: gate the write on `sessionToken === null` too; nothing is lost, because the first null-token resolve misses, fetches and writes. All four places specs still pass. *(The geo reviewer graded this High; I moved it to Medium — no wrong behaviour and no user impact today, and the fix is two words.)*

**M2 · The rate limit refuses the one call that saves money** — `address-search.controller.ts:96,105`. Search and resolve share one key, so the **terminating** call is by construction the one refused at the cap. Chain, verified end to end: 429 on the resolve → `address-field.tsx:157-159` rotates the session token inside `.catch` → that Google session is permanently abandoned → under this PR's own model its N autocomplete requests bill individually at 5 × $2.83/1,000 = $14.15/1,000 instead of one $5.00/1,000 Details call. The comment at `:95-96` ("a resolve is the dearer SKU, so exempting it would leave the expensive half of the pair uncapped") is inverted on the honest path. **Fix**: a separate key for resolves, or a small overdraft above the search cap; correct the comment either way.

**M3 · Focus is dropped to `document.body` after every successful booking** — `booking-form.tsx:42-47` vs `:71-75`. Both branches return `<DialogShell>` at the same position, so React reconciles rather than remounts; `DialogShell`'s focus effect has `[]` deps and does not re-run. The focused «Pasūtīt» unmounts, focus falls to the body, the dialog's changed `aria-label` is never announced, and the next Tab restarts from the top of the document — on the one screen specified as usable without a mouse. A screen-reader user gets no signal that the order was created. **Fix**: distinct `key` on the two `DialogShell` returns so the shell remounts and re-runs its focus effect.

**M4 · `users` rows are now minted without the person participating** — `customers.repository.ts:69-86` via `bookings.service.ts:43-45` and `customers.service.ts:89-91`. Three compounding faces: `findOrCreate` deliberately never sets `role` on conflict (the privilege-escalation defence), so a person Dina phone-booked who later signs up as a **driver** silently gets a rider session and a driver app that cannot work, with no error naming the cause; `CustomersService.upsert` lets a dispatcher mint a row for any number with no booking; and identity resolution runs *before* both the idempotency reservation and the rate limit, so a **failed** booking still leaves the rows behind permanently. The staff-phone guard blocks the sharper reverse direction. **Fix**: the real one (a provisional marker on `users` that an OTP signup can adopt) is its own ticket — the minimal move here is to record it as a KNOWN GAP in `features/customers/index.ts` using the idiom already in `features/rides/index.ts:4-65`, and open the ticket.

**M5 · "Normalized to E.164" is false** — `customers.controller.ts:15-20`. `phoneSchema` (`shared/src/schemas/user.ts:5-7`) is a bare regex: it validates, it does not normalize. Plan B9's GOTCHA asked for normalization; it is neither implemented nor in the deviations list. The security half is fine and worth stating — because the regex admits exactly one spelling, two spellings **cannot** create two identities. The defect is operational: `use-booking-form.ts:161` gates the lookup on `phoneSchema.safeParse` of the raw typed text, so a dispatcher typing `+371 29 999 000` or `29999000` gets no caller pop at all (`lookupState: 'idle'`, indistinguishable from "still typing") and a 400 on submit, mid-call. **Fix**: normalize in the console's phone field before it reaches `phoneSchema`. Do *not* bolt a `.transform()` onto shared `phoneSchema` — that changes `otpRequestSchema` and every auth consumer. Correct the docblock either way.

**M6 · The PII access log records no subject** — `customers.service.ts:44-49`. The comment says the line exists because "the lookup returns another person's PII, so it is logged as an event with the dispatcher who asked". It records `dispatcherId` and `found`, and no subject — so it cannot answer the only question a PII-access record exists to answer: *whose* record was read. A dispatcher enumerating numbers produces a log stream indistinguishable from normal work. The standard says *mask* to the last 3 digits, not omit, and `maskPhone` is the established precedent (`auth.service.ts:127`). Compounding: `GET /customers/lookup` is role-guarded but **not rate-limited**, while its sibling `GET /geo/address-search` is (120/60 s) — so any dispatcher token is an unbounded phone-number → identity oracle. **Fix**: `phone: maskPhone(phone)` on the event, plus a per-dispatcher cap mirroring `addressSearchRateKey`. This is the third `assertWithinRateLimit` caller in the repo; at three it has earned extraction.

**M7 · `use-booking-form.test.tsx` is in the plan's file list, was not written, and the omission is undocumented** — plan `.claude/plans/dispatch-override-phone-orders-zones.md:181`. D6 documents files *added* beyond the plan; nothing documents this removal, so it is an undocumented divergence. The hook's untested paths are `submit()`'s success path (**C1 above**), `handleAuthFailure` (`:130-133`, asserted nowhere) and the `LookupRecord` phone-tagging that `:180-193` exists for. The test the plan asked for is the one that would have caught the Critical.

**M8 · `PLACES_BIAS_RADIUS_METERS` has no upper bound** — `env.schema.ts:136-140`. `.positive()` only, while its sibling `MAPS_ROUTE_TIMEOUT_MS` (`:104-108`) carries `.max(30_000)` under a docblock calling the max "the enforcement, not a comment". `locationBias.circle.radius` has a bound Google rejects above. An operator who widens the bias to cover Latvia gets a clean boot and a 500 on Dina's first keystroke — found by support call rather than failed deploy. **Fix**: add the documented `.max()`.

**M9 · The one instrument the whole spend model is read off breaks the log taxonomy and under-counts** — `google-places.provider.ts:211,225,240`. `geo.places.request` carries no state and `geo.places.failed` no verb, against `logging-standard.md:8`; every other event in the service is verb+state. Not cosmetic — the implementation report names `geo.places.request` as the thing that turns the 5-requests-per-field figure from `expected` into `observed`. Second half: the docblock claims "one line per call that cost money", but a timeout and any network fault throw *before* it, and `:181-183` itself concedes a cancelled request "may not bill", i.e. may. The counter under-reports exactly when Google is degraded. **Fix**: `geo.places.request_completed` / `request_failed`; emit before `fetch`, or narrow the docblock to "every call that returned a status".

---

## Low

**L1 · Three figures do not reconcile, one of them across four surfaces.**
- **"38 console keys across LV/RU/EN" is 34.** `observed`, grep on the diff: 34 unique `'console.*'` keys, each appearing exactly 3 times (34 × 3 = 102 added key occurrences; no non-`console.` keys were added). The figure appears in the **PR body**, the **commit message body**, report *Tasks completed* B15, and report *Issues encountered*. Retiring it means grepping the noun, not the sentence.
- **"+3 files" for `@taxi/dispatch` is +4.** 24 observed − 20 in #120's observed baseline = 4, and the report's own *Tests added* table lists four new dispatch test files (`booking-draft`, `address-field`, `caller-panel`, `booking-form`) two lines above the sentence that says three. The absolute 24 and the `+38 tests` are both correct, so all four files are genuinely collected and running — only the delta label is wrong.
- **AC #16's "largest new file is `google-places.provider.ts` at 241 lines" is wrong twice** (report `:236`): the file is **250**, and the largest new shipped-source file is `use-booking-form.ts` at **335**. The AC still holds — the cap is 500 — but the figure is inherited into the PR body.

**L2 · A second file is at 498 of the 500-line cap, and the merge note flags only one.** This PR grew `services/api/src/features/geo/caching-maps.provider.ts` by +86 to **498**. The "two things for whoever merges this stack" note names `i18n.ts` (also 498, confirmed — `max-lines` is configured `skipBlankLines: false, skipComments: false`, so `wc -l` is the right measure) but not this one. Worth knowing before the next edit lands in the maps spend chokepoint.

**L3 · An idempotent replay writes a second audit row** — `bookings.service.ts:66-73`. `insertBookingAudit` runs unconditionally after `rides.request`, including when that call replayed. A double-submit therefore creates one ride and **two** `dispatch_audit_log` rows, and `dispatch.booking.created` fires twice — the S9-2 trail reads as "Dina booked this ride twice". `bookings.integration.spec.ts:127-151` covers the replay but asserts only `rides` length 1.

**L4 · The staff-phone guard is check-then-act** — `bookings.service.ts:38-45`, same shape at `customers.service.ts:84-92`. `findOrCreateUser`'s conflict clause never touches `role`, so on conflict it returns the existing row and nothing re-checks. `findOrCreateUser` already returns `{ id, role }` — re-assert `role === 'rider'` on the returned row and the guard becomes structural, as its docblock already presents it.

**L5 · `listVenues()` is an unbounded N+1 fired on every form mount** — `customers.repository.ts:131-142`, called from `use-booking-form.ts:150-158`. Every `is_venue` row with no limit, then one `listSavedPlaces` per row: 201 queries per `⌥N` at 200 venues. One left join plus a `LIMIT`.

**L6 · Two new events break the logging taxonomy** — `customers.lookup` (`customers.service.ts:45`) is two segments against `domain.component.action_state` with a closed domain list, and is the only two-segment event in the API; `telephony.dial.stubbed` (`stub-telephony.provider.ts:24`) invents a domain outside that list, where the SMS analogue chose `auth.sms.stub_sent`. Suggest `dispatch.customers.lookup_completed` and `dispatch.telephony.dial_stubbed`, or amend the reference doc in this PR.

**L7 · A retyped identical query hides the popup with results in hand** — `address-field.tsx:111` with `:143`. `select()` sets `closedFor = query` and `open` requires `closedFor !== query`, so backspacing to a string that was previously selected runs the search, gets results, and leaves the listbox `aria-expanded="false"` until ArrowDown. Clear `closedFor` in the input's `onChange`.

**L8 · The prefill focus jump misfires on the second venue pick and on restore** — `booking-form.tsx:34-40`. The effect keys on `prefilledFrom`'s value, which stays `'venue'` across picks, so correcting venue A → B leaves focus on the chip; and a restored draft with `prefilledFrom !== null` runs on mount and steals focus from the phone field `DialogShell` just focused. Moving the focus call into the `prefillFrom` callback also retires the `querySelector('input[role="combobox"]')` reach into `AddressField`'s internals.

**L9 · `⌥N` stacks a second `aria-modal` dialog over an open override dialog** — `new-order-button.tsx:22-35`. The INPUT/TEXTAREA/`isContentEditable` guard is right and `event.code === 'KeyN'` is the correct choice for macOS and the Latvian layout; the uncovered case is focus on a *button*, e.g. «Piešķirt» in an open `AssignDialog`. Two focus traps, two `aria-modal="true"`. Guard on `target.closest('[role="dialog"]')`.

**L10 · `isEmptyDraft` has no shipped caller** — `booking-draft.ts:150-158`, referenced only by its own test. Delete it or wire it to the persist skip it was presumably written for.

**L11 · An unreachable disjunct** — `google-places.provider.ts:232-238`. The `PLACES_CONTRACT_VIOLATION` half of the re-throw guard cannot arrive: both throw sites (`:127`, `:165`) are in the callers, after `request()` returns.

**L12 · No abort test for the Places provider** — `google-places.provider.spec.ts`, 9 cases, all against a `fetch` stub that resolves. The untested branch is the one separating `PLACES_TIMEOUT` from `PLACES_UNAVAILABLE`, and it turns on `error.name === 'AbortError'` — on what the runtime's `fetch` actually rejects with. One case pins it.

**L13 · The raw `placeId` param goes straight into the Details URL** — `address-search.controller.ts:102` → `google-places.provider.ts:154`. Not SSRF (`encodeURIComponent` escapes `/`, so the host cannot move), but `.` is unescaped, so `POST /geo/places/%2E%2E/resolve` normalizes to a request that can only fail — with the API key attached. `address-search.ts:33-36` argues the session token must be a uuid *because* it is interpolated into the provider's URL; the same reasoning applies to the id in the path.

**L14 · `GOOGLE_MAPS_API_KEY` is a new secret outside `SECRET_KEYS`** — `env.schema.ts:11-20,125-128`, with no substitute check and no stated reason, unlike `STRIPE_SECRET_KEY` and the Twilio trio. `services/api/CLAUDE.md:26` says a new secret belongs in that check. Latent only because `mapsProviderSourceFactory` refuses production unconditionally — and that clause is exactly what #13/#16 deletes.

**L15 · The harness cannot see the session gating** — `test/harness.ts:345`. `CountingMapsProvider.resolvePlace(placeId)` drops `sessionToken`, so nothing driven through the harness can assert the behaviour M1 is about. Unit specs cover the semantics, so this is a blind spot rather than a hole.

---

## Verified and clean

Checked deliberately, because each is either a hard rule or a claim this PR makes about itself.

- **Hard rules intact.** Money never leaves integer cents on this path (no `parseFloat`/`toFixed(2)` anywhere in the new slices); commission still resolves through `PricingService.quote`, logged as `commissionPct`/`commissionSource`, never a literal; creation goes through `entryStatusFor`, so `assertTransition()` is correctly not involved; the payment method is inherited via `dispatcherBookingBodySchema = rideRequestBodySchema.extend(...)` and narrowed to `BOOKABLE_PAYMENT_METHODS` like the rider path, with nothing touching the lock or reading `ride.request.paymentMethod`; `packages/shared` imports nothing from the workspace; `services/api` has no direct `pg` import; both Places calls are plain `fetch` inside the geo slice behind the seam, with no SDK anywhere.
- **"Reuse, not a parallel path" holds end to end.** The tracking token is minted unconditionally in `createRide`; SMS fires through the same `onRideCreated` hook, which already branches on `bookingChannel === 'phone'` to send a tracking link — so a caller with no app is served correctly; the idempotency reservation stays rider-scoped, as its docblock argues.
- **The 5th positional argument is wired correctly at all four call sites.** `rides.controller.ts:39` (3 args, subject defaults to the rider), `bookings.service.ts:51` (5 args, subject = dispatcher), `tracking.integration.spec.ts:164` (4 args), `rides.service.spec.ts:168` (3 args). Both new params default, so no existing caller was silently re-pointed. D5's grep claim re-verified independently: nothing in `apps/`, `docs/` or the metrics ledger reads the old `riderId` throttle field.
- **Deviation 1's spend argument survives every check.** The read is genuinely gated (`:471`); nothing passes `null` today (the sole production caller passes a required uuid); the code says the read is inert plainly rather than implying a working cache; and the prices are **sourced** — plan Q5 records $2.83 / $5.00 as `observed` on 2026-08-17 with the pricing URLs. The arithmetic re-derives: 5.00 ÷ 2.83 = 1.766, 5 × 2.83 = 14.15. This is the correction #107's lesson asked for, done properly. M1 is about the write, not the reasoning.
- **Deviation 4 / D9 ships and the claim matches the diff.** The change is inline `<style>` in `app/dispatch/layout.tsx:24-30`, not a stylesheet file — which is why it is invisible in a 70-file list scanned for `.css`. `.console textarea:focus-visible` is present, `className="console"` is on `<main>`, and both override dialogs render inside it, so the rule reaches Phase A's two reason fields as well as this phase's note.
- **The sibling-PR test defect does not reproduce.** #120 and #121 both had keyboard tests firing on the wrong node. Every keyboard case in `address-field.test.tsx` fires on `screen.getByRole('combobox')` — the input the real user focuses — and each would fail if its handler were deleted. The gap here is a missing case (nothing asserts Escape reaching the dialog, which is how H5 shipped green), not a wrong target.
- **Migration `0009` is additive and coherent.** One new enum, two new tables, no rewrite of an existing table, no blocking lock on anything live. `customers.user_id` is `NO ACTION` (a person outlives their record), `saved_places.customer_id` is `CASCADE`, and `saved_places_customer_idx` matches the one query that reads it. The snapshot contains all three new objects, so the next `drizzle-kit generate` will not re-emit them. `rides.booking_channel` and its enum **pre-exist** on the base branch (migration `0007`), and db `enums.ts` derives `savedPlaceKindEnum` from shared `SAVED_PLACE_KINDS` — the two agree by construction, not by copy.
- **i18n and a11y basics.** All 34 new keys are present in all three catalogs (no partial translation), no literal user-facing strings anywhere in the slice, every colour/spacing/radius/font-size through `var(--…)`, `minHeight: 44` on every interactive element including listbox options and chips. No `any`, no `ts-ignore`, no `eslint-disable` in the diff.
- **Security basics on the new routes.** All four endpoints are `@Roles('dispatcher','admin')`; the geo rate limit is keyed on `user.sub` from the JWT and is unforgeable; `PLACES_SEARCH_MIN_CHARS` is enforced server-side on the trimmed query before the provider; every Places response is zod-parsed, never indexed; the API key travels in a header, never a URL or a log; field masks are minimal and `location,formattedAddress` is the Essentials mask that terminates the session; every customers query is parameterized Drizzle with no `sql` fragment.
- **Manual (Level 4) is honestly reported as not run.** AC #13's four ledger rows are marked *not measured* rather than quietly skipped, and the report says plainly that nothing was exercised in a browser or against a screen reader. That is the right disclosure, and it is why M3 and H5 were found by reading rather than by running.

---

## What is genuinely well done

The session-cost correction is the best thing in this PR and the reason the spend model is trustworthy: it overturns the plan's own cache design, states the break-even arithmetic with sourced prices, and pins the counter-intuitive half with a test asserting the cache must **not** save money. That is the #87/#107 lesson applied without being asked.

The query-tagged derived state in both `address-field.tsx` and `use-booking-form.ts` makes stale-response bugs unrepresentable rather than guarded against — a strictly better shape than the manual stale-response guard it replaced. `bookings.service.spec.ts:72-79` destructures `rides.request.mock.calls[0]` **positionally** and asserts the subject, which is precisely the guard a new 5th positional argument needs. The harness counts `searchCalls` and `resolveCalls` separately from `routeCalls`, keeping the <€100/mo assertion whole across two new SKUs instead of blending them into one unusable number. And `CustomersRepository.findRecentRides` projecting at the repository with `safeParse`-and-skip is the right shape for a read that happens while a caller is on the line: one odd historical row degrades the pop instead of taking it down.

---

## Recommendation

**Request changes.** C1 is the blocker: it loses a booking silently on the repeat-caller path, which is the flow the caller panel exists to serve, and the one-line fix also closes the PII-after-booking gap. H1 and H5 are each a few lines and each break a promise the code states in a comment. H3 and H4 are the two hard-rule breaches, both one import from fixed. H2 needs a number derived, not a mechanism changed.

Everything in Medium and Low is cheap enough to batch, but two are worth pulling forward with the Highs because they are two words each: M1 (gate the cache write) and M8 (bound the bias radius).

For the merge note: `caching-maps.provider.ts` is at 498/500 alongside `i18n.ts`, so the stack has two ceilings to clear, not one. #121 does not touch the geo slice, so only the `i18n.ts` conflict is live between B and C.

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 5 |
| Medium | 9 |
| Low | 15 |

Suggested next step: `piv-fix-review-findings` on this report, C1 + H1–H5 + M1 + M8, then re-run the gate.
