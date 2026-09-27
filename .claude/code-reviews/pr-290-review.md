# PR #290 review, round 1: approve, fix F1 and F2 before merge

**PR** https://github.com/linardsb/taxi/pull/290 · feat: riders name themselves; Dina's name fills only an empty one (#269)
**Head** `103e9cb` · **Base** main @ `bc0c5d3a6a79cf3a50a6326a0be50871331726b3`
**Reviewed** 2026-09-27, detached at `103e9cb` in a separate worktree (`wt-review290`). First round, so the guarantees and fix-mechanism passes do not apply. The base is current: `origin/main` is `bc0c5d3`, the same sha as `baseRefOid`.

## Summary

The approach is sound. The rider sets their own name through `PUT /riders/me/display-name` (rider-only, 204, `null` clears). Dina's `callerName` goes through one conditional `UPDATE` (`fillEmptyDisplayName`) that writes only where the stored name is NULL or blank, so the rider's own write always wins without any locking code. All three readers of a rider's name (sign-in, caller lookup, driver ride) share `readDisplayName` in `@taxi/shared`, so one bad stored row cannot fail a response. The contract is compatible both ways: `callerLookupSchema.displayName` defaults to `null` for a new console on an old api, and zod drops the unknown key for an old console on a new api.

No Critical or High findings. Two Mediums, both small, both reproduced:
- F1: the dispatch booking dialog loses keyboard focus when the lookup finds a name.
- F2: an over-long `callerName` still fails the booking with a 400, which the new docblock and AC6 say cannot happen.

Counts: 0 Critical · 0 High · 2 Medium · 3 Low.

## Issues

### F1 (Medium) — booking dialog drops focus when the lookup returns a name
`apps/dispatch/src/features/phone-orders/caller-panel.tsx:112-144`

**What goes wrong for Dina:** she types the number, tabs into «Vārds (nav obligāts)» and starts typing. The lookup returns ~400 ms later with `displayName: 'Anna'`. The ternary replaces the focused `<input>` with a `<p>`, so the input leaves the page and focus drops to `<body>`. `DialogShell` handles Escape and the Tab trap in an `onKeyDown` on its container (`dialog-shell.tsx:76-103`), and keys pressed on `<body>` never reach it. Escape stops closing the form until she clicks back in. The shell's own comment at `:135-136` expects this case ("so the container can hold focus itself when a focused child is unmounted mid-step"), but only the `focusKey` effect (`:67-74`) ever focuses the container, and `booking-form.tsx` passes no `focusKey`. Switching from a named caller to a new number swaps the input back in and out again by the same mechanism.

**Evidence (observed):** a throwaway vitest (deleted after) rendered `CallerPanel` inside `DialogShell`, focused `#booking-caller-name`, then re-rendered with `displayName: 'Anna'`. Output: `activeElement = BODY`, `inDialog = false`, and `onClose` called 0 times after an Escape keydown on the active element.

**Fix:** keep one `<input>` mounted and, when a name is known, render it `readOnly` with `value={knownName}` and the «Vārds: …» label. Focus stays put and a screen reader announces it as read-only. Alternative: `tabIndex={-1}` on the `<p>` and move focus to it when the input had focus before the swap. Add the probe above as the failure-case test.

### F2 (Medium) — a `callerName` over 120 characters still fails the booking
`packages/shared/src/schemas/customer.ts:121-126`, `apps/dispatch/src/features/phone-orders/caller-panel.tsx:130-142`

**What goes wrong:** the new docblock says an unusable `callerName` "means 'no name', never a 400 (D4)", and AC6 says "A blank or invalid `callerName` never fails a phone booking." The wire schema is still `z.string().max(120).optional()`, and `bookings.controller.ts:36` runs it through `ZodValidationPipe`, so a 121-character value is a 400 before `BookingsService` sees it. The console does not stop Dina producing one: the input has no `maxLength` and the draft schema is plain `z.string()` (`booking-draft.ts:202`). A pasted name with padding fails too: 118 characters plus two spaces each side is 122 raw, refused on the wire, though `displayNameSchema` would accept it after the trim.

**Evidence (observed)**, against the built `@taxi/shared` dist at `103e9cb`: `dispatcherBookingBodySchema.shape.callerName.safeParse('a'.repeat(121)).success` → `false`; `'  ' + 'a'.repeat(118) + '  '` → `false` on the wire schema and `true` on `displayNameSchema`.

This is not a regression (`max(120)` predates the PR). The finding is that the PR's new absolute claim is false for this case. D4 keeps the wire schema unchanged (plan line 85, "Not changing: `callerName`'s wire schema"), so the fix belongs on the console side: `maxLength={DISPLAY_NAME_MAX}` on `#booking-caller-name`, and "never a 400" in the docblock narrowed to "a blank or control-character value". Both are inside the plan's constraints.

### F3 (Low) — the SQL "empty" test and the JS one disagree on non-space whitespace
`services/api/src/features/customers/customers.repository.ts:102` against `packages/shared/src/schemas/user.ts` (`readDisplayName`)

Postgres `btrim(text)` strips only ASCII spaces. JS `trim()` also strips tab, NBSP and other Unicode whitespace. A legacy row holding `'\u00a0'` reads as `null` in the lookup, so the panel shows the input, Dina types «Anna», and the fill writes nothing because `btrim(E'\u00a0') = ''` is false. The driver still sees no name. **Observed:** `select btrim(E'\u00a0') = '', btrim(E'\t') = '', btrim('  ') = ''` on `taxi-db-1` → `f|f|t`. Low because no writer in this PR can create such a value (both go through `displayNameSchema`'s JS trim), so it affects only legacy rows. Fix: match with a regex covering the same class, e.g. `display_name ~ '^[[:space:]\u00a0\ufeff]*$'`, or compare-and-swap on the raw value `findUserByPhone` already read. Either keeps the single statement, so D3's race protection holds.

### F4 (Low) — the session-size comment names a test that does not produce its figures
`apps/rider/src/features/auth/session-store.ts:4-7`

"Observed 409 bytes, 786 with a worst-case 120-character name (#269, `riders.integration.spec.ts`)." That spec asserts `< 2048` and measures neither figure; the report says both came from a probe placed inside it and then removed. Per CLAUDE.md, an `observed` figure names the run that produced it. The figures themselves are consistent: 786 − 409 = 377 = 360 (120 × 3-byte `中`) + 17 (`,"displayName":""`), derived. Fix: cite the removed probe ("#269 T7 probe, since removed"), or have the spec assert both sizes.

### F5 (Low) — a failure test's name claims more than it checks
`apps/rider/src/features/profile/name-screen.test.tsx:114` ("shows the offline banner, keeps the text and stays on the screen")

The test checks that the retry sends `'Anna'` from the ref. It never checks that the field still shows `Anna`. No bug behind it. Add `getByDisplayValue('Anna')` or rename the test.

Not flagged: `NameScreen` shows `rider.error.generic` for a pasted control character, where `rider.error.invalid_field` would fit better. Plan T14 specifies `generic`, so this is Linards's call, not a defect.

## Numbers pass

| Figure (PR body / report) | Provenance | Check |
|---|---|---|
| 38 files, +1922 / −172; `.claude` 3 files +785; rest 35 files +1137 / −172 | observed | re-run `git diff --shortstat` at `103e9cb`: identical |
| Gate 22/22, api 888 / 87 suites, shared 291, dispatch 275, driver 296, rider 192, db 17 | observed | re-run, see Validation: identical counts |
| Report's api 884 / shared 290 pre-rebase, +4 / +1 from #289 | observed, attributed | consistent with the rebase note; not re-run on the old tree |
| Catalog split pure, 11 new keys per catalog | observed | lines removed from `lv.ts` vs lines added to `lv-rider.ts`: identical apart from 11 added keys (3 `rider.book.name_row*` + 8 `rider.name.*`); `...lvRider` spread last into `lv` |
| `lv.ts` 396, `lv-rider.ts` 120, `en.ts` 394, `ru.ts` 401 lines | observed | `wc -l`: identical |
| Session 409 / 786 bytes | observed in a removed probe | not re-run; arithmetic consistent (F4) |
| Mutation runs (1 failed / 8, twice; 1 failed / 4) | observed during implementation | not re-run in this review |

The PR body is honest about what did not run: Level 4 manual steps, including TalkBack (report D-a).

## Validation

`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`, from cleared `packages/shared/dist`, `db/dist`, `services/api/dist` and `apps/dispatch/.next`, at `103e9cb`, exit 0 (observed):

| Package | Result |
|---|---|
| turbo | 22 successful, 22 total · 0 cached · 2m18.54s |
| @taxi/api | 87 suites, 888 tests passed |
| @taxi/shared | 30 files, 291 tests passed |
| @taxi/dispatch | 30 files, 275 tests passed |
| @taxi/driver | 45 suites, 296 tests passed |
| @taxi/rider | 34 suites, 192 tests passed |
| @taxi/db | 3 files, 17 tests passed |

CI on the PR: `check`, `audit-diff`, `codeql`, CodeQL, `ready` all pass.

## What is good

- The phone-path fill is a single conditional `UPDATE` against the rider's unconditional PUT: row locks serialise them and the rider always wins. The mutation runs show each arm of the `WHERE` is pinned by its own test.
- `readDisplayName` fixes the read side in one place, with legacy-blank integration tests on both sign-in and lookup.
- The read-only name in Dina's panel, instead of an editable field the api would silently ignore, is the right UX call (plan line 691).
- `NameScreen` mirrors the api's own parse before writing the session, so `readSession` cannot discard the stored session on the next launch.
- The #269 amendment to #261's plan corrects a wrong "one writer" claim instead of leaving it.

## Recommendation

**Approve.** Fix F1 and F2 before merge; both are a few lines and neither touches the plan's frozen items. F3–F5 can ride in the same fix pass or be dropped. Note for the merge order: #135's branch adds `rider.status.arrived` to `lv.ts`; whichever of #135 and #290 merges second moves it into `lv-rider.ts` (PR body already says this).
