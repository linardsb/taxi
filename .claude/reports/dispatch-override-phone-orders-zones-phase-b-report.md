# Implementation Report — #19 Phase B: phone orders

**Plan**: `.claude/plans/dispatch-override-phone-orders-zones.md` (Tasks B1–B15)
**Branch**: `feature/dispatch-phone-orders` — worktree `/Users/Berzins/Desktop/taxi-phone-orders`
**Base**: `ced2d30` (Phase A tip), **not `main`** — see Deviations D0
**Status**: COMPLETE

## Summary

The console can now take an order on behalf of a caller. A keyboard-first
booking form (`⌥N`) resolves addresses through Google Places (New) behind the
`MapsProvider` seam, pops a repeat caller's record and last three jobs from a
new `customers`/`saved_places` pair, and posts to `POST /dispatch/bookings`,
which resolves the caller's identity and then delegates to `RidesService` —
so a phone order is an ordinary ride with `bookingChannel = 'phone'`. The
telephony seam ships stubbed. The draft survives a refresh, a socket drop and
an API kill.

## Tasks completed

- **B1** telephony seam → `packages/shared/src/seams/telephony-provider.ts` (CREATE)
- **B2** stub + module → `services/api/src/features/telephony/{stub-telephony.provider,telephony.module,telephony.tokens,index}.ts` (CREATE), `app.module.ts` (UPDATE)
- **B3** `searchAddress`/`resolvePlace` on the seam → `packages/shared/src/seams/maps-provider.ts` (UPDATE), `packages/shared/src/schemas/address-search.ts` (CREATE)
- **B4** implementers → `stub-maps.provider.ts`, `caching-maps.provider.ts`, `test/harness.ts` (UPDATE), `place-cache.ts` (CREATE)
- **B5** Places provider → `google-places.provider.ts` + spec (CREATE)
- **B6** env knobs + binding → `env.schema.ts`, `.env.example`, `geo.module.ts` (UPDATE)
- **B7** address-search routes → `address-search.controller.ts`, `address-search.policy.ts` + spec (CREATE)
- **B8** persistence → `db/src/schema/customers.ts` (CREATE), `enums.ts` ×2 (UPDATE), migration `0009_glossy_fantastic_four.sql`
- **B9** customers slice → `services/api/src/features/customers/**` (CREATE), `packages/shared/src/schemas/customer.ts` (CREATE)
- **B10** dispatcher booking → `services/api/src/features/dispatch/bookings/**` (CREATE), `dispatch.repository.ts`, `rides.service.ts`, `dispatch.module.ts` (UPDATE)
- **B11** draft → `apps/dispatch/src/features/phone-orders/booking-draft.ts` (CREATE), `features/auth/session.ts` (UPDATE — `BOOKING_DRAFT_STORAGE_KEY`, dropped in `clearSession()`)
- **B12** combobox → `address-field.tsx`, `ids.ts` (CREATE)
- **B13** caller panel → `caller-panel.tsx` (CREATE)
- **B14** hook + form → `use-booking-form.ts`, `booking-api.ts`, `booking-form.tsx`, `new-order-button.tsx`, `index.ts` (CREATE), `app/dispatch/page.tsx` (UPDATE)
- **B15** LV/RU/EN strings → `packages/shared/src/i18n.ts` (UPDATE — 38 keys × 3 languages)

## Tests added

| File | Cases | Result |
|---|---|---|
| `google-places.provider.spec.ts` | 9 | pass |
| `address-search.controller.spec.ts` | 6 | pass |
| `customers.service.spec.ts` | 6 | pass |
| `bookings.service.spec.ts` | 5 | pass |
| `stub-telephony.provider.spec.ts` | 3 | pass |
| `caching-maps.provider.spec.ts` (places block) | +6 | pass |
| `geo.module.spec.ts` | +2 | pass |
| `bookings.integration.spec.ts` | 6 | pass |
| `customers.integration.spec.ts` | 6 | pass |
| `packages/shared/tests/schemas-customer.test.ts` | 11 | pass |
| `booking-draft.test.ts` | 11 | pass |
| `address-field.test.tsx` | 11 | pass |
| `caller-panel.test.tsx` | 7 | pass |
| `booking-form.test.tsx` | 9 | pass |

Two console modules were restructured to satisfy `react-hooks/set-state-in-effect`
(the rule fires only on a cold-dist lint, which is why it surfaced late): the
booking draft is now restored in the `useState` initializer rather than an
effect, and both the caller lookup and the combobox's popup state are TAGGED
with the query/phone they belong to and derived, instead of being cleared
synchronously inside an effect. That also removed the manual stale-response
guard in `address-field.tsx` — a response for an older query can no longer match
the current one.

Every file carries ≥1 expected + 1 edge + 1 failure case.

## Validation results

`observed` — the run named in each line.

- **Baseline before any Phase B change** (cold gate on `ced2d30`): 18/18 turbo
  tasks, api 510 tests / 57 suites, 0 skipped suites (`REDIS_TEST_URL` set).
- **Final gate** — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381
  pnpm turbo run typecheck lint test build --force`, run from a **cold dist**
  (`packages/shared`, `packages/config` and `services/api` dist removed first,
  so the run cannot ride a hand-rebuilt one): **18/18 turbo tasks successful**,
  58.3 s.
  - `@taxi/api` — 64 suites / **559 tests** passed (baseline 57 / 510: +7 suites,
    +49 tests)
  - `@taxi/shared` — 20 files / **178 tests** passed (+1 file, +11 tests)
  - `@taxi/dispatch` — 24 files / **185 tests** passed (+3 files, +38 tests)
  - `@taxi/db` — 3 files / 17 tests passed
- **Skipped-suite count: 0** (AC #11 asks for it to be reported). `REDIS_TEST_URL`
  was set, so the four Redis-gated spec files ran.
- One earlier run failed with `database "taxi_api_test" does not exist` — a
  concurrent session's global-setup dropping the shared test DB mid-run, the
  collision root `CLAUDE.md` documents. Not a code failure; the rerun above is
  the clean one.

## Spend model (AC #7) — re-derived, not inherited

**Controls in place**: one Places session token per address FIELD reused across
its keystrokes; 300 ms client debounce; `PLACES_SEARCH_MIN_CHARS = 3` enforced
server-side (a shorter query answers `[]` and spends nothing, and does not even
consume rate-limit quota); a per-dispatcher rate limit of 120 requests / 60 s
(`address-search.policy.ts`); predictions never cached.

**Prices** — `derived from the plan's record`, not fetched by this run: plan Q5
recorded Autocomplete Requests **$2.83/1,000**, Place Details Essentials
**$5.00/1,000**, Autocomplete Session Usage free, 10,000 free calls per SKU per
month, all `observed` by the planning session on 2026-08-17. This
implementation did not re-fetch them; the arithmetic below is re-derived from
those figures.

**Volume**, `derived`, conditional on all four holding: PRD §7 month-3 target of
100 completed rides/week; every one phone-booked; 2 address fields per booking;
≤5 debounced requests reaching the API per field.

- bookings/month = 100 × 52 ÷ 12 = **433**
- Autocomplete requests = 433 × 2 × 5 = **4,330** → under the 10,000 free SKU
  allowance → **€0**
- Place Details Essentials = 433 × 2 = **866** → under 10,000 → **€0**
- Free-allowance break-even = 10,000 ÷ (433 × 2) ≈ **11.5 requests per address
  field**, above which each further 1,000 costs $2.83.

**What this does not model** (both push the real number up): the free allowance
is per SKU per PROJECT, so #16's rider-side address search shares the same
10,000; and abandoned searches — a dispatcher who types, changes their mind and
retypes — bill autocomplete with no booking attached and are absent from the
433 denominator.

**The 5-requests-per-field figure is `expected`, not measured.** The counter
that makes month 2 `observed` ships here: `geo.places.request` logs one line per
call that cost money, carrying `sku` (`autocomplete` | `details`) and the HTTP
status — the two SKUs counted separately, because one combined number could not
be checked against either price.

**Correction to the plan's cache design** (found in review, fixed in code):
caching a *session-bearing* `resolvePlace` is a spend REGRESSION, not a saving.
A cache hit means no Place Details call, so the session never terminates and its
N autocomplete requests bill individually. Break-even is N < 5.00 ÷ 2.83 ≈ 1.77;
at the expected 5 per field a hit costs 5 × $2.83 = **$14.15/1,000** against
**$5.00/1,000** for the miss — ~3× worse. `CachingMapsProvider.resolvePlace`
therefore reads the cache **only when `sessionToken === null`** (a saved-place
re-resolve, where nothing was typed and nothing was billed). Today nothing calls
that path, so the read is inert and only the write is live — stated plainly in
the code rather than left to look like a working cache.

## Deviations from the plan

- **D0 — base.** The plan's Task 0 and the ticket both say Phase B is cut from
  `main` after Phase A merges. Phase A is committed at `ced2d30` on
  `feature/dispatch-override-phone-orders` but is **not merged and not pushed**
  (no PR). Phase B is based on `ced2d30`, pinned by SHA. Cutting from `main` was
  not viable: the plan file itself lives only on that branch, and Phase B edits
  the same shared contracts Phase A just added. When Phase A merges, `ced2d30`
  becomes an ancestor of `main` (its history is merge commits) and this branch
  needs no rebase — unless Phase A is squash-merged, which needs `rebase --onto`.
- **D1 — no scheduled-time field.** The plan's tab order names "time", while its
  own Out of Scope says scheduled rides are #21's and phone orders are ASAP-only.
  A control that can only mean "now" is a tab stop that costs a keystroke and
  buys nothing, so it is omitted. Tab order: phone → caller name → pickup →
  destination → payment → note → book.
- **D2 — `RecentRide.completedAt` → `bookedAt`.** `rides` has no completion
  timestamp; `updated_at` dates the last status change, which for a cancelled
  ride is the cancellation. Booking time is what makes a job recognizable when
  read back to a caller.
- **D3 — `callerLookupSchema` gained `userId`, and `customer` is nullable.** A
  rider who has only ever used the app has a `users` row and a ride history but
  no `customers` row. The panel shows their last jobs under an unnamed header
  rather than claiming the number is unknown.
- **D4 — one `POST /customers`, not `POST` + `PATCH /customers/:id`.** The phone
  IS the key, so create and update are the same operation to every caller; two
  routes would only add a decision Dina has to make mid-call.
- **D5 — `RidesService.request` gained a 5th parameter** (`rateLimitSubject`,
  defaulting to the rider) so the dispatcher path counts against the DISPATCHER
  — the plan's own Q7 recommendation. The throttle log field renamed
  `riderId` → `subjectId` to stay truthful about who was throttled; nothing else
  in the repo reads that event (`observed`, grep).
- **D6 — files not in the plan's list**, each to keep a file under the 500-line
  cap or to follow an existing repo pattern: `telephony.tokens.ts`,
  `place-cache.ts`, `address-search.policy.ts`, `booking-api.ts`, `ids.ts`,
  `new-order-button.tsx`, `packages/shared/src/schemas/address-search.ts`.
- **D7 — `resolvePlace`'s session token is now `string | null`** on the seam, and
  the cache is session-aware. Reasoned in full under Spend model above.
- **D8 — the 429 retry window is read, not assumed.** `ApiError` carries the
  api's `retryAfterSeconds`; the form renders it. An earlier draft interpolated a
  literal `60` while `RIDE_REQUEST_WINDOW_SECONDS` is 600 — caught in review,
  and pinned by a test (`renders the API retry window, not a literal`).
- **D9 — one line of #18's console CSS changed.** `dispatch/layout.tsx`'s
  focus-visible selector covered `a`, `button` and `input` but not `textarea`,
  so three focusable controls fell back to the browser default: both override
  dialogs' reason fields (Phase A) and this phase's note field. `textarea` added
  — one word, and it closes the gap for all three rather than only mine.
- **D10 — Phase A's stale barrel note left alone.** `services/api/src/features/dispatch/index.ts`
  still lists "NO `reassign` AND NO `cancel`" as a known gap; Phase A shipped
  `reassign`. Not corrected here — that file is Phase A's, and editing it would
  create a merge conflict in the branch that owns the claim. **Phase A should
  retire it before its PR merges.**

## Issues encountered

- **The console resolves `@taxi/shared` from `dist`, not source.** An i18n key
  added to `src` and not built made 11 console tests fail with
  `Cannot read properties of undefined (reading 'replace')` inside
  `formatMessage`, with a stack trace pointing at `src/i18n.ts` (source maps).
  `pnpm --filter @taxi/shared build` fixes it. The final gate was run from a
  **cold dist** to prove it does not depend on a hand-rebuilt one — `turbo.json`
  gives `typecheck`, `lint`, `test` and `build` all `dependsOn: ["^build"]`.
- **`GOOGLE_MAPS_API_KEY` needed the empty-string transform.** `.min(1).optional()`
  rejects the empty value the committed template ships, so every dev checkout
  would have failed to boot. Matched to `STRIPE_SECRET_KEY`'s
  `.optional().transform()` shape.
- **`packages/shared/src/i18n.ts` is at 498 of its 500-line cap.** Phase B's 38
  keys consumed nearly all the headroom; Phase C's zone and cascade strings will
  trip `max-lines`. Not refactored here (out of scope, and it would conflict with
  Phase A/C) — but Phase C must split the catalog first.

## Acceptance criteria touched by Phase B

- **AC #5** — met. `bookings.integration.spec.ts` books a phone order end to end:
  `bookingChannel = 'phone'`, `status = 'requested'`, quoted, and an audit row
  naming the dispatcher.
- **AC #6** — met. Typeahead over Places (New), "iela + number" passed through
  unaltered, resolves to a bookable `AddressPoint`, fully keyboard-operable per
  the ARIA APG combobox table (Down / Alt+Down / Up / Enter / Escape-then-clear).
- **AC #7** — met; arithmetic above.
- **AC #8** — met. Seam + stub bound in `TelephonyModule`; no SIP/VoIP SDK
  anywhere.
- **AC #9** — met. Draft persists on every keystroke (200 ms debounce), restores
  after refresh, survives offline with submit disabled *and a stated reason*.
- **AC #10** — partially verified. `observed` in source and pinned by tests:
  every user-facing string comes from the LV catalog (no literals), every
  interactive element sets `minHeight: 44`, status regions are always mounted,
  and the whole booking flow completes by keyboard alone. **Not verified in a
  browser**: focus-visible rendering. The `.console` rule now covers `textarea`
  too (D9), but nothing here was run against a real screen reader — the Level 5
  VoiceOver pass has not been done.
- **AC #11** — see the gate figures below; skipped suites: 0.
- **AC #12** — the column is `rides.booking_channel`; the share query is
  `SELECT booking_channel, count(*) FROM rides GROUP BY 1;`. No counter built.
- **AC #13** — **not measured.** The four Dispatch ledger rows need a timed run
  against a live console (plan Level 4, steps 1–9). Explicitly deferred, not
  quietly skipped.
- **AC #16** — met for changed shipped source; largest new file is
  `google-places.provider.ts` at 241 lines. `i18n.ts` at 498 is the constraint
  Phase C inherits.
