# Feature: riders get a name — a rider-app name row, and Dina's caller name fills an empty one (#269)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

Every `file:line` below was read on `origin/main` at `170c4b1` (2026-09-27). Re-read before editing; lines drift.

## Feature Description

A rider can tell the platform what the driver should call them, and Dina can do it for a phone caller. The name is `users.display_name`, which #261 already carries to the driver (`rider.displayName`, released `accepted` → `in_progress`) and which #259's arrival prompt will read («Sakta, {name}!»).

- **Rider app.** `/book` gains one row, «Vārds vadītājam: nav norādīts» or «Vārds vadītājam: Anna». Tapping it opens `/name`, which has one optional text field with Save and, when a name exists, Remove. The name is written with `PUT /riders/me/display-name` and mirrored into the stored session.
- **Phone path.** Dina's form already has a caller-name field. Today the api uses it only for a number that has never rung. After this ticket it also fills an **empty** name on an existing rider, in one conditional `UPDATE`. It never overwrites a name that is already set. The caller lookup returns the existing name, and the panel shows it read-only in place of the input.

## User Story

As a rider (in the app or on the phone)
I want the driver to know what to call me
So that the driver can greet me by name at pickup, and a blind rider hears «Sakta, Anna!» and not a street name (#259)

## Problem Statement

The issue says no rider has a name. That is **half wrong**, and the plan corrects it first.

`observed` 2026-09-27 on `origin/main` at `170c4b1`, by reading the source:

- **Phone path: partly working today.** `dispatcherBookingBodySchema.callerName` (`packages/shared/src/schemas/customer.ts:116`) is rendered as an input (`apps/dispatch/src/features/phone-orders/caller-panel.tsx:108-129`) and sent when non-empty (`use-booking-form.ts:307`). `BookingsService.book` passes it to `findOrCreateUser` (`services/api/src/features/dispatch/bookings/bookings.service.ts:43-45`), which inserts it (`customers.repository.ts:69-86`). So **a brand-new phone caller already gets a name**. The issue and #261's plan (`driver-ride-rider-identity.md:39`, "its only caller passes `undefined` (`customers.service.ts:94`)") both missed this second caller.
- **Phone path: what is actually broken.**
  - `existing ?? findOrCreateUser(...)` (`bookings.service.ts:43-45`) skips the write for any caller who already has a `users` row. That includes every repeat caller whose first booking had no name and every app rider who phones. `bookings.integration.spec.ts:153-176` pins this: an existing null-named rider stays null.
  - Dina cannot see whether a name exists. `callerLookupSchema` (`customer.ts:69-74`) has no name, so for an existing caller her typed name is dropped without any sign.
  - `callerName` is `z.string().max(120)` with no trim (`customer.ts:116`), so «   » is stored as a name.
- **Rider app: nothing.** `apps/rider/src/features` is `auth`, `booking`, `i18n`, `places`, `push`, `ride-status`. No screen writes a name, and no api route lets a rider set one. `RidersController` (`services/api/src/features/riders/riders.controller.ts:19-39`) has only the push-token pair.

## Solution Statement

- **Contract** (`@taxi/shared`, `schemas/user.ts`):
  - `DISPLAY_NAME_MAX = 120`.
  - `displayNameSchema`: trim, 1–120 UTF-16 units, no control characters. This is the **write** bound.
  - `readDisplayName(raw)`: the read-side normaliser that #261 wrote inline at `driver-ride.ts:36`, moved here so three readers share it.
  - `riderDisplayNameUpdateSchema = { displayName: displayNameSchema.nullable() }`.
  - `callerLookupSchema` gains `displayName: string | null`.
- **Rider write**: `PUT /riders/me/display-name`, `@Roles('rider')` (inherited from the controller), id from the JWT, `204`. `null` clears. It mirrors `PUT me/push-token` (`riders.controller.ts:25-32`).
- **Phone write**: `BookingsService.book` resolves the user, then calls `CustomersRepository.fillEmptyDisplayName(user.id, name)`, which runs `UPDATE users SET display_name = $name WHERE id = $id AND (display_name IS NULL OR btrim(display_name) = '')`. It is **one statement**, so a rider's concurrent `PUT` can never be overwritten (D3). `callerName` is normalised with `displayNameSchema.safeParse`: a blank or invalid value means "no name". It **never** fails the booking (D4).
- **Rider app**:
  - `SessionProvider` gains `setDisplayName(name | null)`, which rewrites the stored session's `user.displayName`.
  - A new `features/profile` slice holds `NameRow` (on `/book`) and `NameScreen` (`/name`).
- **Dispatch**: `CallerPanel` shows «Vārds: {name}» read-only when `lookup.displayName` is set, and the input only when it is not.

## Decisions

- **D1 (the user, 2026-09-27): ask on `/book`, not after sign-in.** A post-verify step runs only on a fresh OTP sign-in. `verify-screen.tsx:77` does `router.replace('/')`, and `session-store.ts` persists the session for 30 days, so riders who are already signed in would never see a post-verify step. A row on `/book` reaches every rider and adds 0 taps to a booking. It is also the only place to change the name later.
- **D2 (the user, 2026-09-27): Dina's name fills an empty name.** It still never overwrites a set one. The rider's own write always wins, because the rider's `PUT` is unconditional and Dina's `UPDATE` is conditional.
- **D3: one conditional `UPDATE`, never read-then-write.** A read-then-write lets this sequence happen: a phone booking reads null, the rider saves «Anna», then the booking writes «Dina's guess». The `WHERE display_name IS NULL` clause closes that window inside Postgres.
- **D4: `callerName` stays lenient on the wire.** Tightening it to `trim().min(1)` would make a stray space in Dina's field a `400` mid-call, on the one form where a failed submit costs a caller. The schema is unchanged. The service normalises, and an unusable name means "no name".
- **D5: 120, the contract's existing bound, and no first-name cut.** `userSchema.displayName` (`user.ts:15`), `driverRideRiderSchema` and `callerName` all say 120. `smsDriverName` (`notifications/sms-templates.ts:37`) shortens the **driver's** name for the rider's SMS character budget. It has nothing to do with this. The screen asks «Kā vadītājs jūs uzrunās?», so the rider writes what they want said aloud.
- **D6: `204`, no echo.** The app sends a value it has already run through `displayNameSchema` (the same parse the api runs), so it stores that value. That keeps `RidersController`'s rule, "nothing here reads" (`riders.controller.ts:16-17`), true.
- **D7: no `GET /riders/me`.** The session already carries `user.displayName`. `toUser` (`auth/auth.repository.ts:21-29`) puts it into every OTP verify response. The stale case is accepted and documented: Dina fills an empty name while the app shows «nav norādīts». It corrects itself at the next sign-in, or when the rider saves their own name, which wins. See Q1.

## De-risking runs (planning time, 2026-09-27, all reverted)

Every task below was spiked in a scratch worktree on `origin/main` at `170c4b1`, run, and then reverted. The spike diff was kept outside the repo. Each row is `observed` from that run.

| # | Risk | Run | Result |
|---|---|---|---|
| R1 | `lv.ts` split is not a pure move | #259's T1 script (docblock set to #269), with #259's hash command run before and after | **345 keys, `a43374cb71b05908` before and after.** `lv.ts` 495 → 395 lines, `lv-rider.ts` 109. Retired. |
| R2 | catalog files pass 500 after the keys | T4's 11 keys in all three catalogs, then `npx eslint --fix` (prettier wraps the long hints) | `lv.ts` 396, `lv-rider.ts` 120, `en.ts` 394, `ru.ts` 401. All under 500. Retired. |
| R3 | T2/T3/T5 contract and tests | spike of T2, T3 and T5's test file; `@taxi/shared` typecheck, lint, test and build | Green: **30 files, 284 tests.** `dist/schemas/user.d.ts` contains `displayNameSchema`. `\P{Cc}` with `u` works under zod 3.24 (the `'An\u0000na'` and `'An\nna'` cases fail parse). Retired. |
| R4 | session outgrows SecureStore | probe spec: real OTP sign-in → `PUT` 120 × `'中'` → sign in again → `Buffer.byteLength(JSON.stringify(session))` | **409 bytes with no name, 786 with 120 × `'中'`, 666 with 60 × `'𝒜'`** (JWT is 208 chars). +377 matches the derived figure in Notes. Expo documents no enforced limit and cites a historical iOS ceiling of "roughly 2048 bytes" ([docs](https://docs.expo.dev/versions/latest/sdk/securestore/), fetched 2026-09-27), so the worst case uses 38 % of it. Retired. |
| R5 | the route or pipe does not do what D6 says | probe spec against T6's route | `'  Anna  '` → 204 with body `{}`, stored `Anna`. `'   '`, 121 × `x` and `'An\u0000na'` → 400 with the stored value unchanged. `null` → 204 and stored NULL. Driver token → 403, no token → 401. `ZodValidationPipe` returns `result.data` (`common/zod-validation.pipe.ts:26`). Retired. |
| R6 | the conditional fill SQL is wrong, or a race lets Dina overwrite the rider | probe calling `CustomersRepository.fillEmptyDisplayName` directly, plus 20 rounds of `Promise.all([rider PUT, fill])` from NULL | fill NULL → `Dina`; second fill `Other` → still `Dina`; legacy `'  '` → filled `Anna`. **Rider's name survived 20/20 rounds.** Mutations: deleting the whole `or(...)` arm gives `Expected "Dina", Received "Other"` (the null-fill assertion before it stays green). Deleting only the `btrim` arm gives `Expected "Anna", Received "  "`. Retired. |
| R7 | unlisted tests break | T6, T8, T9, T11 and T12 spiked; riders, customers, bookings, auth and driver-ride specs run | 7 failures, all expected: `bookings.integration.spec.ts:175` (T10 rewrites it), four in `bookings.service.spec.ts` (`fillEmptyDisplayName is not a function`, fixed by T9's mock), and **`customers.service.spec.ts:68` and `:110`, which the first draft missed** (the lookup `toEqual` gains `displayName`; now in T11). After T11/T12: auth + driver-ride + ride-read give 10 suites, 100 tests, green, and `driver-ride.spec.ts` needed no edits. A blank stored name is in the session before T11 (`"displayName":"   "`) and absent after it. Retired. |
| R8 | RNTL 14 tests for the rider slice | T13, T14 and T15 spiked with the tests in T14 | `@taxi/rider` typecheck and lint clean. **34 suites, 188 tests passed.** The `_old` rest binding lints clean. Mutation: sending the untrimmed text turns the expected test red (1 failed / 6). `booking-screen.test.tsx` and `accessibility.test.tsx` needed no edits. The one `● Console` "overlapping act()" warning is from `use-saved-places.test.tsx` and is also printed on `170c4b1` without the spike. Retired. |
| R9 | dispatch fixtures | T16 spiked | `@taxi/dispatch` typecheck red until **two** literal `CallerLookup` fixtures gain `displayName: null` (`caller-panel.test.tsx:15` and `use-booking-form.test.tsx:29`). `booking-api.test.ts:64`'s `toEqual` gains `displayName: null` from the schema default. After those: 6 files, 57 tests, green except that one assertion, which T16 now lists. Retired. |

Not run at planning time: the full turbo gate over the finished diff (T18), and Level 4 step 5 (TalkBack on the emulator). Both are validation of the finished work. Every component they exercise ran above.

## Out of Scope / Non-Goals

- Not included: showing the name to Dina on the live board or ride card. #261's Q1 said no; this ticket adds it only to the caller-lookup panel, at booking time.
- Not included: a first-name-only projection for the driver (D5), a name in any SMS, or a name on the tracking page.
- Not included: a general profile screen (language, email). `features/profile` holds the name only.
- Not included: `GET /riders/me` or refreshing the session on foreground (D7).
- Not changing: `customers.label` (Dina's private annotation, #261 D3), `CustomersService.upsert` (it files labels and never names), or `driverRideSchema` and its windows.
- Not changing: `callerName`'s wire schema (D4).
- Not changing: `findOrCreateUser`'s conflict clause. It still never touches `display_name` on conflict. What changes is that it stops taking a name at all (T8), because the fill is the one name writer on the phone path.

## Feature Metadata

**Feature Type**: New Capability (rider) + Bug Fix (phone path drops names silently)
**Estimated Complexity**: Medium (four surfaces, no migration: `users.display_name` exists, `db/src/schema/users.ts:11`)
**Primary Systems Affected**: `packages/shared`, `services/api` (riders, customers, dispatch/bookings, auth, rides/lifecycle), `apps/rider`, `apps/dispatch`
**Dependencies**: none new

## Related Work

**Implements**: #269 · **Epic**: #15's deferred scope (`docs/epics/sakta-cab.prd.md` §5; architecture `docs/epics/sakta-cab.architecture.md` has no decision on rider PII, so D1–D7 are ticket-level)

**Back-references**:

- `.claude/plans/driver-ride-rider-identity.md` (#261): `rider.displayName`, its window, and the read-side normalisation this plan moves into shared. Its line 39 and D2 carry the wrong "one writer" claim that T16 amends.
- `.claude/plans/arrival-announce-protocol-259.md` (#259): reads `rider.displayName` at `arrived`. Its T1 is the `lv.ts` split this plan's T1 reuses.
- `.claude/plans/pickup-pin.md` (#258): the `/book` switch row this plan's row sits beside, and PR #277 M2's one-stop row rule.
- `.claude/plans/driver-pin-field-talkback-280.md` (#280, #286, #287): `TextField` is labelled by its visible label on Android, and inputs are uncontrolled.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `packages/shared/src/schemas/user.ts` (1-18): `phoneSchema`, `userSchema.displayName` bounds at :15. The new exports go here.
- `packages/shared/src/schemas/customer.ts` (58-75, 100-119): `callerLookupSchema`, and `dispatcherBookingBodySchema.callerName` with its docblock at :115 («Prefills the `users` row on first sight; never overwrites an existing one», which becomes false).
- `packages/shared/src/schemas/push-token.ts` (19-20): the shape of a one-field update body.
- `packages/shared/tests/schemas-user.test.ts`, `schemas-customer.test.ts`: where shared schema tests live (`packages/shared/tests/`, not colocated).
- `packages/shared/src/i18n/lv.ts` (495 lines, `rider.*` keys), `en.ts` (382), `ru.ts` (389): catalogs. **`lv.ts` is 5 lines under the 500 cap** (`packages/config/eslint/base.mjs:36`).
- `.claude/plans/arrival-announce-protocol-259.md` (373-395): T1, the `lv.ts` split script and its hash proof.
- `services/api/src/features/riders/riders.controller.ts` (1-39), `riders.service.ts` (1-28), `riders.repository.ts` (1-27), `riders.integration.spec.ts` (1-120): the pattern to mirror, including the 403-driver and 401 cases at :105-119.
- `services/api/src/features/customers/customers.repository.ts` (1-11 imports, 49-58 `findUserByPhone`, 60-86 `findOrCreateUser`).
- `services/api/src/features/customers/customers.service.ts` (30-72 `lookup`, 86-105 `upsert` calling `findOrCreateUser(body.phone, undefined)` at :94).
- `services/api/src/features/customers/index.ts` (:13): docblock about `findOrCreateUser`.
- `services/api/src/features/dispatch/bookings/bookings.service.ts` (28-88).
- `services/api/src/features/dispatch/bookings/bookings.service.spec.ts` (12-58 fixture and mocks, 94-106 existing-rider case).
- `services/api/src/features/dispatch/bookings/bookings.integration.spec.ts` (80-110 new-caller case asserting `displayName` 'Anna', 153-176 the existing-rider case to rewrite).
- `services/api/src/features/customers/customers.integration.spec.ts` (64-93): the lookup case to extend.
- `services/api/src/features/rides/lifecycle/driver-ride.ts` (14-48): `DISPLAY_NAME_MAX` and the inline normaliser at :16-17 and :36.
- `services/api/src/features/auth/auth.repository.ts` (21-30): `toUser`, the session's name source.
- `services/api/test/harness.ts` (694-703): `insertUser` takes only `{ phone, role }`. Set a name with `ctx.db.update(users)`, as #261's plan did.
- `apps/rider/src/features/auth/use-session.tsx` (15-141): the provider to extend. `live.session` at :42-52, `signIn` at :93-97, the context value at :126-129.
- `apps/rider/src/features/auth/session-store.ts` (1-40): `writeSession`, and the "≈ 600 bytes, under SecureStore's iOS ceiling" claim at :4.
- `apps/rider/src/features/auth/use-session.test.tsx` (1-74): the provider test pattern.
- `apps/rider/src/features/auth/verify-screen.tsx` (66-96): the uncontrolled `TextField` (#287) and `errorMessageKey` error path to mirror.
- `apps/rider/src/features/booking/booking-screen.tsx` (54-60, 231-270): where the row goes, and the one-stop switch row (PR #277 M2).
- `apps/rider/src/features/booking/booking-screen.test.tsx` (20-60): `mockSessionContext` has **no** `setDisplayName` and `state: signedOut`.
- `apps/rider/src/features/booking/use-book-ride.ts` (55-75): `AccessibilityInfo.announceForAccessibility` after a success.
- `apps/rider/src/components/TextField.tsx` (1-85), `Button.tsx`, `Banner.tsx`, `Screen.tsx`, `use-screen-focus.ts`.
- `apps/rider/src/features/auth/session-guard.tsx` (10): `PUBLIC_SEGMENTS`. `/name` is not public, so a signed-out rider is bounced.
- `apps/rider/src/app/book/index.tsx`: a route file is a one-line re-export.
- `apps/dispatch/src/features/phone-orders/caller-panel.tsx` (35-129), `caller-panel.test.tsx` (1-142).
- `apps/dispatch/src/features/phone-orders/use-booking-form.ts` (300-310): the body's `callerName`.

### New Files to Create

- `packages/shared/src/i18n/lv-rider.ts`: only if T1's split has not landed (it is #259's T1, not yet implemented at `170c4b1`).
- `packages/shared/tests/schemas-display-name.test.ts`
- `apps/rider/src/features/profile/index.ts`, `name-row.tsx`, `name-screen.tsx`, `name-row.test.tsx`, `name-screen.test.tsx`
- `apps/rider/src/app/name.tsx`

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Zod 3 strings](https://zod.dev/?id=strings): `.trim()` is applied in chain order, so `.trim().min(1)` checks the trimmed value. `@taxi/shared` pins `zod ^3.24.0`.
- [Drizzle filters](https://orm.drizzle.team/docs/operators): `and`, `or`, `isNull`, and `sql` for `btrim`.
- [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/): the per-value size note. The 2048-byte figure below is `expected` from this page; confirm it against the SDK 57 page before quoting it.

### Patterns to Follow

**Rider-self route** (`riders.controller.ts:25-32`):

```ts
@Put('me/push-token')
@HttpCode(204)
setPushToken(
  @CurrentUser() user: JwtClaims,
  @Body(new ZodValidationPipe(pushTokenUpdateSchema)) body: PushTokenUpdate,
): Promise<void> {
  return this.riders.setPushToken(user.sub, body.token);
}
```

**Uncontrolled input** (#287, `verify-screen.tsx:90-96`): no `value` prop. Read the text in `onChangeText` into a ref or state that is not fed back to `value`. Seed it with `defaultValue`.

**Announce on success** (`use-book-ride.ts:66-68`): `AccessibilityInfo.announceForAccessibility(t('…'))`.

**Error → catalog key** (`verify-screen.tsx:79-81`): `const err = e instanceof ApiError ? e : null; setError(errorMessageKey(err?.code ?? 'generic'))`. The api-client throws `ApiError(0, 'offline')` on a network failure (`api-client.ts:102`), so offline needs no extra code.

**Logging**: this ticket adds no log line. If you add one, it carries ids only. **Never a name** (`.claude/references/logging-standard.md`; #261 AC9).

**Lint rules that bite here** (`packages/config/eslint/base.mjs`):
- `max-lines` 500 (:36). `lv.ts` is the file at risk (T1).
- `@typescript-eslint/no-unsafe-assignment` rejects `expect.any()` inside object literals (piv-plan rule). Assert fields individually.
- The rider app's `react-hooks` 7 compiler rules forbid `setState` in an effect body and ref reads during render (`use-session.tsx:36-41` explains the `live` object).

---

## UX

### Breadboard

```
/book
  … payment chips · [PIN row switch] · PIN hint
  [Name row: «Vārds vadītājam: {name | nav norādīts}»] ──tap──> /name

/name
  «Kā vadītājs jūs uzrunās?»  (header, focused on mount)
  hint «Vadītājs redz šo vārdu un pasaka to, kad piebrauc. Nav obligāti.»
  [TextField «Vārds», defaultValue = current name, maxLength 120]
  [Saglabāt] ──ok──> announce «Vārds saglabāts» ──> back to /book (row shows new name)
            ──error──> Banner danger (api code) , stays on /name, text kept
  [Noņemt vārdu]  (only when a name is set) ──ok──> announce «Vārds noņemts» ──> back
```

### States

| State | /book row | /name |
|---|---|---|
| loading | n/a (session is already loaded when /book renders) | Save shows `loading`, both buttons disabled |
| empty | «Vārds vadītājam: nav norādīts» | field empty; Remove hidden; Save with blank input = go back, no request |
| error | n/a | `Banner tone="danger"` with `errorMessageKey(code)`; text kept for retry |
| offline | n/a | same Banner, `rider.error.offline` (api-client code `offline`) |
| signed out | row renders the empty text (no crash); `SessionGuard` moves the rider off | `SessionGuard` bounces to `/login` |

### Touch targets and focus

The row is one `Pressable`, `accessibilityRole="button"`, `minHeight: 44`, with an accent border on focus. It follows the switch-row rule (PR #277 M2): one screen-reader stop with its label and hint. Buttons use `Button`, which is already 44 px with a visible focus state. The field uses `TextField` (44 px, accent focus border).

### Friction audit

- **Booking: 0 taps added.** The row is optional and does not gate Book. Cost: one more screen-reader stop on `/book`, after the PIN hint and before Book. That order is deliberate: pickup, destination, price and payment come first.
- **Set a name: 2 taps + typing** (row → type → Saglabāt, which returns automatically). Each step is needed: there is no name to infer, and saving must be explicit, because an autosave-on-blur would write half-typed names.
- **Change a name**: the same 2 taps. The field is prefilled.
- **Remove a name: 2 taps** (row → Noņemt vārdu).
- Rejected: a post-sign-in step, because riders who are already signed in would never see it (D1). Also rejected: an inline field on `/book`, which costs a text-field stop on every booking and a save decision in the middle of the booking flow.

---

## IMPLEMENTATION PLAN

### Phase A: Contract (`packages/shared`)

T1 split (only if needed), T2 schemas, T3 lookup schema, T4 catalog keys, T5 rebuild `dist`.

### Phase B: api

**Depends on:** Phase A (`dist` rebuilt).
T6–T7 rider write, T8–T10 phone path and lookup, T11 auth `toUser`, T12 `driver-ride.ts` reuse.

### Phase C: apps

**Depends on:** Phase A. **Independent of:** Phase B, since its tests mock the api. Phase C can run in parallel with Phase B.
T13 session, T14 profile slice, T15 route and row, T16 dispatch panel.

### Phase D: docs and the gate

T17 amend #261's plan and correct the `session-store.ts` figure, T18 the gate.

---

## STEP-BY-STEP TASKS

### T1 REFACTOR `packages/shared/src/i18n/lv.ts`: split `rider.*` out (conditional)

- **IMPLEMENT**: `git show origin/main:packages/shared/src/i18n/lv-rider.ts`. If it exists, #259's T1 has landed: skip this task and put the rider keys in `lv-rider.ts` in T4. If it does not, run #259's T1 script **verbatim** (`.claude/plans/arrival-announce-protocol-259.md:375-387`) from `packages/shared/src/i18n`.
- **GOTCHA**:
  - This ticket adds 11 `lv` keys (T4: 10 rider, 1 console). Derived, assuming one line per key: 495 + 11 = 506 > 500, so the split is required even without #135. Observed in R1: the split takes `lv.ts` to 395 lines, and the hash must match before and after. At `170c4b1` both runs printed `345 a43374cb71b05908`; recompute on your base, since #135 or #259 may have added keys.
  - **#135 collides with this file.** It is on a local branch in the main checkout at `f2cc6c4`, not yet pushed, and adds 5 lines to `lv.ts` (`git diff --stat origin/main...f2cc6c4`, observed). Whichever of #135 and #269 lands second must rebase its `rider.*` keys into `lv-rider.ts`. Tell the #135 session (SendMessage, or a note in its PR) when this split is pushed.
  - The script's docblock says "split out of `lv.ts` when #259 pushed it past the 500-line cap". If #269 runs the script, change `#259` to `#269` in the generated `lv-rider.ts`, or the comment is false.
  - Prove the move is pure. Run #259's hash command (`:391`) before and after. The **two outputs must be identical**. Do not compare against #259's `344 2a276af52559cb83`, which is `d6deaa6`'s catalog; the key count has grown since.
  - Before running, check `gh pr list --state open` and `git diff --name-only origin/main...<branch> | grep i18n/lv.ts` for each remote branch. At `170c4b1` the only open PR is #289, which does not touch `lv.ts` (observed).
  - If #259 is being implemented in parallel, tell that session. Two splits of the same file conflict on every line.
- **VALIDATE**: identical hash before and after, then `pnpm --filter @taxi/shared typecheck lint test`, green with no test edits.
- **SATISFIES**: AC9

### T2 UPDATE `packages/shared/src/schemas/user.ts`

- **IMPLEMENT**:

  ```ts
  /** `users.display_name`'s contract bound, shared by every reader and writer (#269). */
  export const DISPLAY_NAME_MAX = 120;

  /**
   * A name as WRITTEN — by the rider (`PUT /riders/me/display-name`) or by Dina
   * (`callerName`, normalised through this). Trimmed first, so «  Anna » stores
   * «Anna» and «   » is not a name. Control characters are refused: the name is
   * rendered on the driver's screen and spoken at the kerb (#259).
   */
  export const displayNameSchema = z
    .string()
    .trim()
    .min(1)
    .max(DISPLAY_NAME_MAX)
    .regex(/^\P{Cc}+$/u, 'control characters are not allowed');

  /**
   * A name as READ from `users.display_name`, which is unconstrained `text`:
   * blank → null, over-long → cut. Every read that feeds a 1–120 contract goes
   * through this, so one bad row cannot fail a whole response (#261's reason).
   */
  export function readDisplayName(raw: string | null | undefined): string | null {
    // `|| null`, not `?? null`: '' must become null. Same form as driver-ride.ts:41, which lints clean.
    return raw?.trim().slice(0, DISPLAY_NAME_MAX) || null;
  }

  /** `PUT /riders/me/display-name`. `null` removes the name. */
  export const riderDisplayNameUpdateSchema = z.object({
    displayName: displayNameSchema.nullable(),
  });
  export type RiderDisplayNameUpdate = z.infer<typeof riderDisplayNameUpdateSchema>;
  ```

  Set `userSchema.displayName` to `.max(DISPLAY_NAME_MAX)`, with the same bounds as today. Do **not** make `userSchema` use `displayNameSchema`: `userSchema` is a read shape parsed out of the stored session, and adding `trim` or a regex there changes what an already-stored session parses to.
- **GOTCHA**:
  - `.slice` cuts UTF-16 units and can split a surrogate pair at 120. That is what `driver-ride.ts:36` does today and it is accepted. The writer's `max(120)` counts the same units, so only legacy rows reach the cut.
  - `\P{Cc}` needs the `u` flag. Zod 3.24 passes the regex through unchanged.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC1, AC3

### T3 UPDATE `packages/shared/src/schemas/customer.ts`

- **IMPLEMENT**:
  - `callerLookupSchema`: add `displayName: z.string().min(1).max(DISPLAY_NAME_MAX).nullable().default(null)`. Docblock: "The rider's own name, as the driver will see it (#269). Shown read-only: Dina's `callerName` only fills an empty one. Not `customer.label`, which is her private annotation (#261 D3)." Import `DISPLAY_NAME_MAX` from `./user`.
  - `callerName` docblock at :115 becomes: "Fills the rider's name when it is empty, and never overwrites a set one (#269 D2). Normalised through `displayNameSchema` server-side; an unusable value means 'no name', never a 400 (D4)." The schema is unchanged.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC5, AC6

### T4 ADD catalog keys (LV/RU/EN)

- **IMPLEMENT**: rider keys go in `lv-rider.ts` (after T1) and in the `rider.*` blocks of `en.ts` and `ru.ts`. The console key goes after `console.caller_name` in all three.

  | key | lv | ru | en |
  |---|---|---|---|
  | `rider.book.name_row` | `Vārds vadītājam: {name}` | `Имя для водителя: {name}` | `Name for your driver: {name}` |
  | `rider.book.name_row_empty` | `Vārds vadītājam: nav norādīts` | `Имя для водителя: не указано` | `Name for your driver: not set` |
  | `rider.book.name_row_hint` | `Atver vārda iestatījumu` | `Открывает настройку имени` | `Opens the name setting` |
  | `rider.name.title` | `Kā vadītājs jūs uzrunās?` | `Как водителю к вам обращаться?` | `What should your driver call you?` |
  | `rider.name.hint` | `Vadītājs redz šo vārdu un pasaka to, kad piebrauc. Nav obligāti.` | `Водитель видит это имя и называет его, когда подъезжает. Необязательно.` | `Your driver sees this name and says it when they arrive. Optional.` |
  | `rider.name.label` | `Vārds` | `Имя` | `Name` |
  | `rider.name.save` | `Saglabāt` | `Сохранить` | `Save` |
  | `rider.name.remove` | `Noņemt vārdu` | `Удалить имя` | `Remove name` |
  | `rider.name.saved` | `Vārds saglabāts` | `Имя сохранено` | `Name saved` |
  | `rider.name.removed` | `Vārds noņemts` | `Имя удалено` | `Name removed` |
  | `console.caller_known_name` | `Vārds: {name}` | `Имя: {name}` | `Name: {name}` |

  10 rider keys and 1 console key make 11 keys per catalog. Prettier wraps the `rider.name.hint` values, so run `npx eslint --fix packages/shared/src/i18n` after inserting them. Observed in R2 after that: `lv.ts` 396, `lv-rider.ts` 120, `en.ts` 394, `ru.ts` 401.
- **GOTCHA**: `packages/shared/tests/i18n.test.ts` checks parity. A key missing from one catalog fails there, and a `{name}` placeholder mismatch fails `formatMessage` typing. Cosmetic wording questions go to `.claude/references/ui-decisions.md`, not into this ticket.
- **VALIDATE**: `pnpm --filter @taxi/shared test -- i18n` and `wc -l packages/shared/src/i18n/*.ts` (all ≤ 500)
- **SATISFIES**: AC7, AC9

### T5 CREATE `packages/shared/tests/schemas-display-name.test.ts`, then rebuild `dist`

- **IMPLEMENT**:
  - **expected**: `displayNameSchema.parse('  Anna Bērziņa ')` → `'Anna Bērziņa'`. `riderDisplayNameUpdateSchema.parse({ displayName: null })` passes. `readDisplayName(' Anna ')` → `'Anna'`.
  - **edge**: 120 × `'ā'` passes and 121 fails. `readDisplayName('   ')` → null, `readDisplayName(undefined)` → null, and a 130-char row reads back at 120. `callerLookupSchema.parse({...without displayName})` gives `displayName: null` (the default, so a new console still parses an old api).
  - **failure**: `'   '`, `''` and `'An\u0000na'` are each rejected by `displayNameSchema`.
  - Then run `pnpm --filter @taxi/shared build`. The apps import shared from `dist` (memory: CI parity gate).
- **VALIDATE** (R3 observed the whole package green at 30 files / 284 tests): `pnpm --filter @taxi/shared test -- schemas-display-name && pnpm --filter @taxi/shared build && grep -c "displayNameSchema" packages/shared/dist/schemas/user.d.ts` (≥ 1; `tsc -p tsconfig.build.json` emits one `.d.ts` per source file, `package.json:15`)
- **SATISFIES**: AC1, AC3

### T6 ADD `PUT /riders/me/display-name` (riders slice)

- **IMPLEMENT**:
  - `riders.repository.ts`: `setDisplayName(riderId: string, name: string | null)`, an unconditional `update(users).set({ displayName: name }).where(eq(users.id, riderId))`. Docblock: "Unconditional on purpose: the rider's own name always wins over Dina's fill-if-empty (#269 D2/D3)."
  - `riders.service.ts`: `setDisplayName(riderId, name)` passes through. Update the class docblock at :4-9 from "One concern today" to "the push token (#17) and the rider's display name (#269)".
  - `riders.controller.ts`: `@Put('me/display-name') @HttpCode(204)` with `ZodValidationPipe(riderDisplayNameUpdateSchema)`, which calls `this.riders.setDisplayName(user.sub, body.displayName)`. The docblock at :16-17 ("Nothing here reads… write-only by design") stays true. Add one line: "The name is write-only here too: the rider's copy lives in their session (#269 D6)."
- **IMPORTS**: `riderDisplayNameUpdateSchema`, `type RiderDisplayNameUpdate` from `@taxi/shared`.
- **GOTCHA**: `ZodValidationPipe` returns `result.data`, which is the **parsed** value (`common/zod-validation.pipe.ts:26`, observed), so the trim reaches the repository.
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC2

### T7 ADD cases to `services/api/src/features/riders/riders.integration.spec.ts`

- **IMPLEMENT**: a new `describe('rider display name (#269)')` reusing `signIn` and `p()` (`+371310` range; use `p(5)` and up). Cases:
  - **expected**: `PUT {displayName: '  Anna  '}` → 204, empty body, stored `'Anna'`. Then `PUT {displayName: null}` → stored null.
  - **edge (session size)**: `PUT` 120 × `'中'` (3 UTF-8 bytes each, the worst case the schema admits; see Notes). Then sign in again and assert `Buffer.byteLength(JSON.stringify(session)) < 2048`, where `session` is the parsed verify body the app stores. R4 observed 786 bytes.
  - **edge (legacy blank)**: `ctx.db.update(users).set({ displayName: '   ' })`, then sign in: the verify body's `user` has no `displayName` key (T11; R7 observed the key present before T11 and absent after).
  - **edge (rider wins)**: `ctx.db.update(users).set({ displayName: 'Dina' })`, then the rider's `PUT 'Anna'` → stored `'Anna'`.
  - **failure**: `'   '` → 400, and `'x'.repeat(121)` → 400, with the stored value unchanged in both. A driver token → 403. No token → 401 (mirror :105-119).
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/riders`
- **SATISFIES**: AC2, AC3, AC8

### T8 UPDATE `services/api/src/features/customers/customers.repository.ts`

- **IMPLEMENT**:
  - `findUserByPhone` selects `displayName: users.displayName` too. Return type: `{ id; role; displayName: string | null }`.
  - Add:

    ```ts
    /**
     * Dina's name for a caller, written ONLY where the rider has none (#269 D2).
     * One statement, so a rider's concurrent `PUT /riders/me/display-name` can
     * never be overwritten (D3). A whitespace-only legacy value counts as empty.
     */
    async fillEmptyDisplayName(userId: string, name: string): Promise<void> {
      await this.db
        .update(users)
        .set({ displayName: name })
        .where(
          and(
            eq(users.id, userId),
            or(isNull(users.displayName), sql`btrim(${users.displayName}) = ''`),
          ),
        );
    }
    ```

  - `findOrCreateUser(phone)`: **drop** the `displayName` parameter and its spread (`:69-78`), because the fill is now the only name writer on this path. Update its docblock at :60-68: the conflict clause is unchanged and "never touches `display_name`" still holds. Update the caller at `customers.service.ts:94` and the docblock at `customers/index.ts:13` if it mentions the name.
- **IMPORTS**: `and, desc, eq, isNull, or, sql` from `drizzle-orm`.
- **GOTCHA**: `CustomersRepository` is imported by `BookingsService` from `'../../customers'`. Check that `index.ts` exports the class, not only the module (it does today, since `bookings.service.ts:3` compiles).
- **VALIDATE**: `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC5

### T9 UPDATE `services/api/src/features/dispatch/bookings/bookings.service.ts` and its unit spec

- **IMPLEMENT**:

  ```ts
  const user =
    existing ?? (await this.customers.findOrCreateUser(callerPhone));
  // Dina's name for the caller fills an EMPTY name only (#269 D2), and an
  // unusable one (blank, control characters) is "no name", never a 400 — a
  // failed submit mid-call costs the caller (D4).
  const name = displayNameSchema.safeParse(callerName);
  if (name.success) {
    await this.customers.fillEmptyDisplayName(user.id, name.data);
  }
  ```

  This goes before `findOrCreateCustomer` and before `rides.request`, so the name is stored before any driver can accept. `displayNameSchema.safeParse(undefined)` fails, which is correct. The log line at :78-85 gains nothing: no name in logs.
- **Unit spec** (`bookings.service.spec.ts`): add `fillEmptyDisplayName: jest.fn().mockResolvedValue(undefined)` to the `customers` mock (:37-44).
  - **expected**: (:61 case) `findOrCreateUser` is called with `('+37129999000')`, one argument, and `fillEmptyDisplayName` with `(RIDER_ID, 'Anna')`.
  - **edge**: (:94 case) for an existing rider, `fillEmptyDisplayName` is called with `(RIDER_ID, 'Anna')`. A new case: `callerName: '   '` means `fillEmptyDisplayName` is not called and `rides.request` still is.
  - **failure**: the staff-phone case (:125) does not call `fillEmptyDisplayName`.
- **IMPORTS**: `displayNameSchema` from `@taxi/shared`.
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/dispatch/bookings/bookings.service.spec.ts`
- **SATISFIES**: AC5, AC6

### T10 UPDATE the phone-path integration specs

- **IMPLEMENT**:
  - `bookings.integration.spec.ts:153-176` ("reuses an existing rider"): keep the rider-reuse assertion. Replace the final block: seed the rider **with** a name (`ctx.db.update(users).set({ displayName: 'Rider-set' })`), book with `callerName: 'Ignored'`, and assert it is still `'Rider-set'`. Rename the comment to "`callerName` never overwrites a set name."
  - New **edge**: an existing rider with `display_name` null, booked with `callerName: '  Anna  '` → stored `'Anna'`.
  - New **edge**: an existing rider with `display_name '  '` (legacy), booked with `callerName: 'Anna'` → stored `'Anna'`.
  - New **failure**: `callerName: '   '` for a new caller → 201, and `display_name` null.
  - The :80-110 new-caller case still asserts `'Anna'`. It now passes through the fill, not the insert.
  - `customers.integration.spec.ts:64-93` (repeat-caller pop): set the user's name first, and assert `body.displayName === 'Anna'`. In the :94 "never rung" case the body stays `null`. Add an **edge**: a `'   '` stored name reads back as `displayName: null`.
- **GOTCHA (mutation run, both halves)**: delete the `or(isNull(…), …)` clause from `fillEmptyDisplayName`, then run the bookings integration spec. Record **both** results:
  - (a) the "never overwrites a set name" case must go **red**;
  - (b) the "null → Anna" case stays **green**.

  Then restore the clause. Also delete the `btrim` arm alone: the legacy-blank case goes red, and the other cases stay green.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/dispatch/bookings src/features/customers`
- **SATISFIES**: AC5, AC6

### T11 UPDATE `customers.service.ts` `lookup`, and `auth/auth.repository.ts` `toUser`

- **IMPLEMENT**:
  - `lookup` returns `displayName: readDisplayName(user.displayName)` in the object at :66-71.
  - `customers.service.spec.ts`: its `findUserByPhone` mock gains `displayName: null`, and the two lookup `toEqual`s at `:68` and `:110` gain `displayName: null` (R7: both go red without this). Add an **edge**: the mock returns `'  Anna '` and the lookup answers `'Anna'`.
  - `toUser` (:21-30), tested by a new **edge** in `auth/auth.integration.spec.ts` (a `'   '` stored name → the verify body's `user` has no `displayName`): replace `...(row.displayName ? { displayName: row.displayName } : {})` with `const name = readDisplayName(row.displayName)` and `...(name ? { displayName: name } : {})`. This means a legacy «  » name never reaches the rider's session as a blank row label, and an over-long one never fails `authSessionSchema` at sign-in.
- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/auth src/features/customers`
- **SATISFIES**: AC3, AC6

### T12 REFACTOR `services/api/src/features/rides/lifecycle/driver-ride.ts`

- **IMPLEMENT**: remove the local `DISPLAY_NAME_MAX` (:16-17). Change :36 to `const name = readDisplayName(identity?.displayName);` and :41 to `? name`. Update the docblock at :27-30: "…is trimmed, blank becomes null and over-long is cut by `readDisplayName` (shared, #269)."
- **VALIDATE**: `pnpm --filter @taxi/api exec jest src/features/rides/lifecycle/driver-ride.spec.ts`, green with **no test edits** (a pure refactor).
- **SATISFIES**: AC3

### T13 UPDATE `apps/rider/src/features/auth/use-session.tsx`

- **IMPLEMENT**:
  - Interface (:20-32): add `setDisplayName(name: string | null): Promise<void>` with the docblock "Mirrors a successful `PUT /riders/me/display-name` into the stored session (#269 D6). A no-op when signed out."
  - Implementation, beside `signIn`:

    ```ts
    const setDisplayName = useCallback(async (name: string | null) => {
      const current = live.session;
      if (current === null) return;
      const { displayName: _old, ...user } = current.user;
      const next: AuthSession = {
        ...current,
        user: name === null ? user : { ...user, displayName: name },
      };
      await writeSession(next);
      live.session = next;
      setState({ status: 'signedIn', session: next });
    }, []);
    ```

    Omit the key rather than setting `undefined`, because `userSchema.displayName` is `.optional()`, not nullable. The unused `_old` binding passes lint: `@typescript-eslint/no-unused-vars` is set with `ignoreRestSiblings: true` (`packages/config/eslint/base.mjs:31`, observed). Add it to the `useMemo` value and deps (:126-129).
  - `use-session.test.tsx`:
    - **expected**: sign in, `setDisplayName('Anna')`, then `state.session.user.displayName === 'Anna'` and `SecureStore.setItemAsync` receives JSON containing `"displayName":"Anna"`.
    - **edge**: `setDisplayName(null)` removes the key, so the stored JSON has no `displayName`.
    - **failure**: while signed out it is a no-op, with no write.
- **GOTCHA**: `readSession` clears the store on any parse failure (`session-store.ts:26-29`). The value written here must satisfy `authSessionSchema`, and the name screen guarantees that by parsing with `displayNameSchema` first (T14).
- **VALIDATE**: `pnpm --filter @taxi/rider test -- use-session`
- **SATISFIES**: AC4

### T14 CREATE `apps/rider/src/features/profile/` (`name-screen.tsx`, `name-row.tsx`, `index.ts`) and tests

- **IMPLEMENT**:
  - `name-screen.tsx` (`NameScreen`):
    - `Screen` → header `Text` (`ref` plus `useScreenFocus`, `accessibilityRole="header"`) with `rider.name.title` → hint `Text` → uncontrolled `TextField` (`label={t('rider.name.label')}`, `defaultValue={current ?? ''}`, `onChangeText` writes to a `useRef<string>`, `maxLength={DISPLAY_NAME_MAX}`, `autoComplete="name"`, `textContentType="givenName"`, `autoCapitalize="words"`, `error={error ? t(error) : null}`) → `Button` `rider.name.save` (`loading={busy}`) → a `Button variant="secondary"` `rider.name.remove`, rendered only when `current !== null`.
    - Save runs `raw.trim() === ''`. If the field is blank and `current` is null, it does `router.back()` with no request. If the field is blank and `current` is set, it takes the remove path. Otherwise it runs `displayNameSchema.safeParse(raw)`. Failure is reachable only through a pasted control character and gives `setError('rider.error.generic')`. Success goes to `submit(parsed)`.
    - `submit(name | null)`: `setBusy(true)` → `api.request('PUT', '/riders/me/display-name', { body: { displayName: name } })` → `setDisplayName(name)` → `AccessibilityInfo.announceForAccessibility(t(name ? 'rider.name.saved' : 'rider.name.removed'))` → `router.back()`. On a catch it takes the verify-screen error path (`errorMessageKey(err?.code ?? 'generic')`) and shows it in a `Banner tone="danger"`, keeping the text.
    - `current` = `state.status === 'signedIn' ? (state.session.user.displayName ?? null) : null`.
  - `name-row.tsx` (`NameRow`):
    - One `Pressable`, `accessibilityRole="button"`, `accessibilityLabel` = the visible text, `accessibilityHint={t('rider.book.name_row_hint')}`, `testID="name-row"`, `minHeight: 44`, `onPress={() => router.push('/name')}`, with a `colors.accent` border when focused (the `TextField` pattern: `onFocus`/`onBlur` state).
    - Text: `t('rider.book.name_row', { name })` or `t('rider.book.name_row_empty')`.
    - Signed out: it renders the empty text.
  - `index.ts`: `export { NameRow } from './name-row'; export { NameScreen } from './name-screen';`
  - Tests (jest + RNTL 14, `await act(async …)` always, per memory):
    - `name-screen.test.tsx`: mock `useSession` as `booking-screen.test.tsx:23-35` does, adding `setDisplayName`.
      - **expected**: type «  Anna », press Save. `mockRequest` gets `('PUT', '/riders/me/display-name', { body: { displayName: 'Anna' } })`, then `setDisplayName('Anna')`, then `announceForAccessibility('Vārds saglabāts')` (spied), then `router.back`.
      - **edge**: with a current name, Remove sends `displayName: null`. Blank plus Save with no current name sends no request and goes back.
      - **failure**: `mockRequest` rejects with `new ApiError(0, 'offline')`. The Banner shows the offline copy, `setDisplayName` is not called, there is no `back`, and the field keeps its text.
    - `name-row.test.tsx`:
      - **expected**: with a signed-in session named «Anna», the row reads «Vārds vadītājam: Anna» and pressing it pushes `/name`.
      - **edge**: with no name, it reads «Vārds vadītājam: nav norādīts».
      - **failure-ish**: signed out, it renders the empty text and does not throw.
- **PATTERN**: `verify-screen.tsx` (whole file), `booking-screen.tsx:240-262` (row), `use-book-ride.ts:66`.
- **GOTCHA**:
  - Uncontrolled field (#287). **No `value` prop.** A controlled field makes TalkBack speak «aizstāts» on every keystroke.
  - `toHaveTextContent` matches whole text (memory: RNTL 14).
  - Do not make the row's `Text` a separate accessible element. The `Pressable` is one stop.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- profile`. R8 ran these exact three cases per file green, with the mutation red. The test shape that worked: `await render(...)`, then `fireEvent.changeText(screen.getByLabelText(label), …)` and `fireEvent.press(screen.getByRole('button', { name }))`, each inside `await act(async () => { … })`; `useSession` mocked through `jest.mock('@/features/auth', …)` with `requireActual`, as in `booking-screen.test.tsx:31-35`; `router.useRouter()` taken from `jest.requireMock('expo-router')`.
- **SATISFIES**: AC4, AC7

### T15 ADD `/name` route and the row on `/book`

- **IMPLEMENT**:
  - `apps/rider/src/app/name.tsx`: `export { NameScreen as default } from '@/features/profile';`
  - `booking-screen.tsx`: `import { NameRow } from '@/features/profile';` and render `<NameRow />` after the PIN hint `Text` (:263-269), inside the `ScrollView`.
- **GOTCHA**:
  - `booking-screen.test.tsx`'s `mockSessionContext` is `signedOut` (:25). The row renders its empty text there, so existing tests stay green. No test there counts buttons (`grep getAllByRole('button')` → none, observed). `accessibility.test.tsx` in the same folder may walk every button's label and size: run it.
  - `/name` is not in `PUBLIC_SEGMENTS` (`session-guard.tsx:10`), so a signed-out rider is bounced, which is correct.
  - `booking-screen.tsx` is 294 lines. The row adds about 2 lines.
- **VALIDATE**: `pnpm --filter @taxi/rider test -- booking-screen && pnpm --filter @taxi/rider typecheck lint`
- **SATISFIES**: AC4

### T16 UPDATE `apps/dispatch/src/features/phone-orders/caller-panel.tsx` and its test

- **IMPLEMENT**:
  - `const knownName = lookup?.displayName ?? null;`
  - In the name block (:108-129): when `knownName !== null`, render `<p id="booking-caller-name-known">{formatMessage(LANG, 'console.caller_known_name', { name: knownName })}</p>` **instead of** the label and input. Otherwise render today's label and input unchanged.
  - Tests (`caller-panel.test.tsx`):
    - **expected**: a lookup with `displayName: 'Anna'` shows «Vārds: Anna» and has no `#booking-caller-name` input.
    - **edge**: a lookup with `displayName: null` (an app-only rider) shows the input.
    - **failure**: a lookup that failed (`lookup === null`, `lookupState: 'failed'`) shows the input, so Dina can still type a name for a caller the api could not look up.
  - Fixture updates (R9, observed): add `displayName: null` to the literal `LOOKUP` in `caller-panel.test.tsx:15` **and** `use-booking-form.test.tsx:29` (typecheck fails otherwise), and to the expected object in `booking-api.test.ts:64` (the schema default puts it in the parsed result).
- **GOTCHA**:
  - A name Dina typed **before** the lookup resolved stays in `draft.callerName` and is still sent. The api ignores it, because the name is set (D2). That is harmless, and the panel now shows the name that will be used. Do not add clearing logic.
  - Run the single file with `npx vitest run --root apps/dispatch src/features/phone-orders/caller-panel.test.tsx` (memory: the `--filter … -- <name>` form runs all 28 files).
- **VALIDATE**: `npx vitest run --root apps/dispatch src/features/phone-orders/ && pnpm --filter @taxi/dispatch typecheck lint`. The whole folder, because of the fixture changes.
- **SATISFIES**: AC6

### T17 UPDATE docs whose claims this ticket retires

- **IMPLEMENT**:
  - `.claude/plans/driver-ride-rider-identity.md`: add an AMENDMENTS entry, "2026-09-27 (#269): line 39 and D2's 'one writer … only caller passes `undefined`' was wrong at `bfca835`. `bookings.service.ts:45` passed `callerName`, so new phone callers were named. #269 replaces both writers with `fillEmptyDisplayName` and `PUT /riders/me/display-name`." Do not edit the historical body.
  - `services/api/src/features/rides/lifecycle/driver-ride.ts:27-30` is done in T12.
  - `apps/rider/src/features/auth/session-store.ts:4`: replace "≈ 600 bytes" with "observed 409 bytes, 786 with a worst-case 120-character name (#269 R4)". Re-run T7 and use its figures if they differ.
  - Grep for the retired subject, not the sentence: `grep -rn "only caller passes\|one writer\|never overwrites an existing" --include='*.ts' --include='*.md' . | grep -v node_modules/`. Fix every live source or docblock hit; plans get amendments only.
- **VALIDATE**: the grep shows only amended plan text.
- **SATISFIES**: AC10

### T18 Gate

- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force` from cleared `dist` and `apps/dispatch/.next` (memory: stale `.next` race).
- **SATISFIES**: all

---

## TESTING STRATEGY

### Unit Tests

- shared: `schemas-display-name.test.ts` (T5) and the i18n parity test.
- api: `bookings.service.spec.ts` (T9). `driver-ride.spec.ts` stays unchanged (T12).
- rider: `use-session.test.tsx` (T13), `name-screen.test.tsx`, `name-row.test.tsx` (T14), `booking-screen.test.tsx` (T15).
- dispatch: `caller-panel.test.tsx` (T16).

### Integration Tests

- `riders.integration.spec.ts` (T7): the real OTP sign-in, the real route and the stored row, plus the session byte size.
- `bookings.integration.spec.ts` and `customers.integration.spec.ts` (T10): the conditional fill against Postgres, with the mutation run recorded.
- No socket or room is touched. The driver sees the name through #261's `GET /rides/:rideId`, which `ride-read.integration.spec.ts` already covers with a DB-set name.

### Edge Cases

| Edge case | Where verified |
|---|---|
| rider saves «  Anna » → «Anna» | T7 integration, T14 name-screen |
| rider removes the name | T7, T13, T14 |
| blank or 121-char or control-char name refused | T5 (schema), T7 (400) |
| rider name set, Dina books with another name → unchanged | T10 (+ mutation a) |
| rider name null, Dina's name fills it | T10 |
| legacy «  » name counts as empty | T10 (+ `btrim` mutation) |
| Dina's blank `callerName` → booking still 201, no name | T9, T10 |
| rider's own `PUT` overwrites a Dina-filled name | T7 "rider wins" |
| session with the worst-case name stays under the SecureStore value limit | T7 edge |
| lookup shows the known name read-only | T16 |
| legacy «  » name never reaches the rider session or the lookup | T11: customers integration edge, plus a new case in `auth/auth.integration.spec.ts` (set `display_name '   '` by `ctx.db.update`, verify OTP, body has no `displayName`); Level 4 step 2 |
| offline save | T14 failure |
| signed-out `/book` row | T14 |
| stale session after a Dina fill (D7) | accepted; Level 4 step 5 shows it |

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared build
pnpm turbo run typecheck lint --filter=@taxi/shared --filter=@taxi/api --filter=@taxi/rider --filter=@taxi/dispatch
wc -l packages/shared/src/i18n/*.ts   # every file ≤ 500
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/api exec jest src/features/dispatch/bookings/bookings.service.spec.ts src/features/rides/lifecycle/driver-ride.spec.ts
pnpm --filter @taxi/rider test
npx vitest run --root apps/dispatch src/features/phone-orders/caller-panel.test.tsx
```

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api exec jest src/features/riders src/features/customers src/features/dispatch/bookings src/features/auth
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force
```

One gate at a time: the shared test DB is dropped by global-setup (CLAUDE.md).

### Level 4: Manual Validation

Everything here is reachable with the seed plus the dev SMS provider. OTP codes come from the api log in dev; check `SMS_PROVIDER` in `.env` against `.env.example`. Check the db container and user names against `.env.example` first. Use a LAN-IP `DATABASE_URL` (memory: port conflicts).

1. **Rider write.** `curl` `POST /auth/otp/request` `{phone:"+37120000003", role:"rider"}`, then `/auth/otp/verify` with the logged code, which gives a token. `curl -X PUT /riders/me/display-name -H "authorization: Bearer $T" -d '{"displayName":"  Anna "}'` → `204`. `psql … -c "select display_name from users where phone='+37120000003'"` → `Anna`.
2. **Session carries it.** Sign in again (step 1's two calls). The verify body's `user.displayName` is `"Anna"`. Set `display_name` to `'   '` by psql and sign in again: the body has **no** `displayName` (T11).
3. **Phone fill.** Set the rider's name to NULL by psql. Sign in as the seed dispatcher and open `/dispatch`, New order. Type `+37120000003`: the panel shows the name **input** (no name yet). Type «Dina Test», book any route, and psql shows `Dina Test`. Open New order and type the number again: the panel shows «Vārds: Dina Test» and no input.
4. **No overwrite.** `PUT` «Anna» as the rider (step 1). Book again from the console with a name typed before the lookup resolved, or through curl `POST /dispatch/bookings` with `callerName: "Other"`. psql still shows `Anna`.
5. **Rider app** (Android emulator `sakta224`, per `docs/runbooks/driver-device-day.md`'s emulator setup; the rider app builds the same way). Sign in and check `/book` shows «Vārds vadītājam: …» with the name from step 4. Tap it, change to «Anna B», Save, and it returns to `/book` showing «Anna B». With TalkBack on: the row is one stop reading label and hint; the field reads «Vārds, Anna B» once and does not chatter while you type (#287); Save announces «Vārds saglabāts». Airplane mode, then Save: the offline Banner appears and the text is kept.
6. **Driver sees it** (#261's path, optional). Run #261's Level 4 steps 1-2 (`.claude/plans/driver-ride-rider-identity.md:480-487`, on the stack from `.claude/plans/driver-15-offers-device-pass.md` §"START the stack and the accounts"). Skip #261's step 1 psql write, because steps 1-5 here already set the name. Expect «Pasažieris: Anna B» on the driver's active-ride screen. `ride-read.integration.spec.ts` already covers this read, so skipping the step loses no logic coverage.

If step 5's emulator is unavailable in the implementing session, record it as not run in the report. The unit and integration tests cover the logic, and the missing part is the TalkBack reading only.

---

## ACCEPTANCE CRITERIA

- [ ] **AC1**: `displayNameSchema`, `readDisplayName`, `DISPLAY_NAME_MAX` and `riderDisplayNameUpdateSchema` are exported from `@taxi/shared` and tested for expected, edge and failure cases.
- [ ] **AC2**: `PUT /riders/me/display-name` sets (trimmed) or clears the caller's own name. It returns 204 with no body, answers 400 on a blank, over-long or control-character name, 403 to a driver token and 401 without one.
- [ ] **AC3**: No stored name, however malformed, fails the rider's sign-in, the caller lookup or the driver's ride read. All three read through `readDisplayName`.
- [ ] **AC4**: `/book` shows the name row (one 44 px stop with a visible focus state), `/name` sets, changes and removes the name, and the stored session reflects it without a re-sign-in.
- [ ] **AC5**: A phone booking fills an empty (NULL or blank) rider name and never overwrites a set one, through a single conditional `UPDATE`. The mutation run in T10 is recorded with both halves.
- [ ] **AC6**: A blank or invalid `callerName` never fails a phone booking. The caller lookup returns `displayName` and the console shows it read-only in place of the input.
- [ ] **AC7**: Every new string is in the LV, RU and EN catalogs. The name screen is usable end-to-end with TalkBack (Level 4 step 5, or recorded as not run).
- [ ] **AC8**: The session with a 120-character worst-case name is under the SecureStore value limit, `observed` in T7 with the figure recorded.
- [ ] **AC9**: Every catalog file is ≤ 500 lines, and the `lv.ts` split (if run here) is proven pure by identical hashes.
- [ ] **AC10**: #261's plan carries an amendment correcting the "one writer" claim. No live source or docblock still states it. No log line carries a name: `git diff origin/main -- services/api | grep -n "logger"` shows no new field beyond ids.
- [ ] Gate green: `pnpm turbo run typecheck lint test build --force` (with `REDIS_TEST_URL`).

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Manual testing confirms feature works (or step 5 recorded as not run)
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

- **Q1 (accepted, D7): the stale session, worst case.** Dina fills an empty name, and the rider app keeps showing «nav norādīts» for up to the session's life (30 days) or until the rider signs in again. Worst case: the rider does not know the driver will say «Dina's spelling». They can fix it by saving their own name, which wins. The cost of closing the gap is a `GET /riders/me` on `/book` focus, deferred. Say if a refresh is wanted.
- **Q2 (ordering, worst case): the rider saves while a phone booking for the same number is in flight.**
  - Rider `PUT` commits first: the conditional fill sees a non-null name and writes nothing. The rider's name stands.
  - Fill commits first: the rider's unconditional `PUT` overwrites it. The rider's name stands.
  - Postgres row locks serialise the two `UPDATE`s. Worst case: if the fill wins and the driver reads the ride before the rider's `PUT` commits, the driver's current copy shows Dina's name until the driver app next re-reads the ride. This plan did not check when that re-read happens.
- **A2 (retired by R4)**: Expo enforces no limit and cites a historical iOS ceiling of roughly 2048 bytes. The observed worst case is 786.
- **A3**: `textContentType="givenName"` nudges the iOS autofill to a first name. The rider can still type anything (D5).

## NOTES (open canvas)

**Worst-case session growth, `derived`.** `displayNameSchema.max(120)` counts UTF-16 units. A BMP character is at most 3 UTF-8 bytes. An astral character is 2 units and 4 bytes, so 2 bytes per unit. `JSON.stringify` does not escape non-ASCII, and control characters are refused, so no `\uXXXX` escapes occur. `"` and `\` escape to 2 bytes each, which is under 3. Worst case: 120 × 3 = **360 bytes** of name, plus `,"displayName":""` = 17 bytes → **+377 bytes**. The condition assumed is that no other session field changes. T7 measures the real total instead of trusting `session-store.ts:4`'s unlabelled "≈ 600".

**Why not keep `findOrCreateUser(phone, name)` for new callers and fill only for existing ones?** Two writers on one path would carry two rules to keep in step. The unified path costs one extra `UPDATE` per phone booking that has a name, which is negligible against a ride insert, a quote and a dispatch cascade. It also gives one statement to test and one to mutate.

**Why the read-only name in Dina's panel, and not a prefilled input?** A prefilled, editable field that the api ignores for a named rider (D2) would accept an edit and drop it without telling her. A read-only line tells her the truth.

**Rejected: `trim().min(1)` on `callerName`.** See D4. The failure would be a 400 in the middle of a call.

**Rejected: storing the name on the device only** (like `pickup-pin-preference.ts`). The driver reads it server-side, so it has to be in `users`.

**Confidence: 10/10** for a one-pass implementation. Every task was spiked and run at planning time (R1-R9), and each spike was reverted. Each risk named in the first draft is retired by an observed run:
- the split (R1, R2);
- the SecureStore figure (R4);
- RNTL 14 (R8).

The spikes also found the three test files the first draft missed (R7, R9). What is left is coordination, not code: if #135 or #259 lands first, T1 changes from running the split to adding keys to `lv-rider.ts`, and that path is written into T1.

## AMENDMENTS

- 2026-09-27: planning-time de-risking (R1-R9), all spiked and reverted. Added the three missed test files (`customers.service.spec.ts` in T11; `use-booking-form.test.tsx` and `booking-api.test.ts` in T16), the observed catalog line counts, the session sizes, the race and mutation results, and the RNTL test shape. Confidence went from 8 to 10.

