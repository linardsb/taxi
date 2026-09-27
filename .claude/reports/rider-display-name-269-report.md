# Implementation Report — riders get a name (#269)

**Plan**: `.claude/plans/rider-display-name-269.md`   **Branch**: `feature/rider-display-name-269` (worktree `~/taxi-worktrees/wt-269`, cut from the plan tip `8a40768`, base `origin/main` `170c4b1`)   **Status**: COMPLETE (Level 4 manual steps not run, see Deviations)

## Summary

A rider can set, change and remove the name the driver sees: a row on `/book` opens `/name`, which writes `PUT /riders/me/display-name` (204, write-only) and mirrors the value into the stored session. On the phone path, Dina's `callerName` now fills an EMPTY name (NULL or whitespace) on any rider, new or existing, through one conditional `UPDATE`, and never overwrites a set one. The caller lookup returns the rider's name and the console shows it read-only in place of the input. Three readers (sign-in, lookup, driver ride) share `readDisplayName`, so no stored name can fail a response.

## Tasks completed

- T1 split `rider.*` out of `lv.ts` → `packages/shared/src/i18n/lv-rider.ts` (CREATE), `lv.ts` (UPDATE). Docblock says #269.
- T2 `DISPLAY_NAME_MAX`, `displayNameSchema`, `readDisplayName`, `riderDisplayNameUpdateSchema` → `packages/shared/src/schemas/user.ts` (UPDATE)
- T3 `callerLookupSchema.displayName`, `callerName` docblock → `packages/shared/src/schemas/customer.ts` (UPDATE)
- T4 11 keys × 3 catalogs → `lv-rider.ts`, `lv.ts`, `en.ts`, `ru.ts` (UPDATE)
- T5 → `packages/shared/tests/schemas-display-name.test.ts` (CREATE); `dist` rebuilt
- T6 route → `services/api/src/features/riders/riders.{controller,service,repository}.ts` (UPDATE)
- T7 → `riders.integration.spec.ts` (UPDATE)
- T8 `findUserByPhone` selects the name, `fillEmptyDisplayName` added, `findOrCreateUser(phone)` takes no name → `customers.repository.ts`, caller in `customers.service.ts` (UPDATE)
- T9 → `dispatch/bookings/bookings.service.ts` + `.spec.ts` (UPDATE)
- T10 → `bookings.integration.spec.ts`, `customers.integration.spec.ts` (UPDATE)
- T11 lookup `displayName`, `toUser` via `readDisplayName` → `customers.service.ts`, `customers.service.spec.ts`, `auth/auth.repository.ts`, `auth/auth.integration.spec.ts` (UPDATE)
- T12 → `rides/lifecycle/driver-ride.ts` (UPDATE, pure refactor)
- T13 `setDisplayName` → `apps/rider/src/features/auth/use-session.tsx` + `.test.tsx` (UPDATE)
- T14 → `apps/rider/src/features/profile/{index.ts,name-row.tsx,name-screen.tsx,name-row.test.tsx,name-screen.test.tsx}` (CREATE)
- T15 → `apps/rider/src/app/name.tsx` (CREATE), `booking/booking-screen.tsx` (UPDATE)
- T16 → `apps/dispatch/src/features/phone-orders/caller-panel.tsx` + `caller-panel.test.tsx`, fixtures in `use-booking-form.test.tsx`, `booking-api.test.ts` (UPDATE)
- T17 amendment → `.claude/plans/driver-ride-rider-identity.md`; figure → `apps/rider/src/features/auth/session-store.ts` (UPDATE)
- T18 gate, below

## Tests added

All `observed` on this branch, at `103e9cb`. The PR #290 round-1 fixes change the fill's `btrim` arm to a regex and add tests; see `.claude/reports/pr-290-review-fixes.md` for those and their counts.

- shared `schemas-display-name.test.ts`: trim (expected); 120 vs 121 units, `readDisplayName` blank/undefined/null/130-char, lookup default `displayName: null` (edge); `'   '`, `''`, `'An\u0000na'`, `'An\nna'` refused (failure). Package: 30 files, 290 tests green. (R3 recorded 284; the difference is the extra cases this branch adds, not a regression.)
- api unit: `bookings.service.spec.ts` (one-argument `findOrCreateUser`, fill for new and existing rider, blank `callerName` → no fill and still booked, staff phone → no fill); `customers.service.spec.ts` (fixtures gain `displayName`, new `'  Anna '` → `'Anna'` edge). With `driver-ride.spec.ts` (no edits): 3 suites, 33 tests green.
- api integration (riders, customers, bookings, auth): 13 suites, 120 tests green. New cases: rider PUT trim/204/`{}`/null-clears; worst-case session size; legacy blank kept out of the session; rider overwrites Dina's fill; blank / 121-char / control-char → 400 with the stored value kept; driver 403; no token 401; bookings: set name kept, NULL filled with trimmed `'Anna'`, legacy `'  '` filled, blank `callerName` on a new caller → 201 and NULL; customers: lookup returns the name, legacy blank reads null; auth: legacy blank → no `displayName` key.
- **Mutation run (T10), both halves:**
  - A — the whole `or(isNull(…), btrim…)` arm removed (WHERE on id alone): 1 failed / 8 passed. The only red case is "never overwrites a set name" (`Expected "Rider-set", Received "Ignored"`); the NULL→`Anna` case stayed green.
  - B — only the `btrim` arm removed: 1 failed / 8 passed. The only red case is the legacy-blank one (`Expected "Anna", Received "  "`).
  - Both restored.
- **Session size (AC8):** 409 bytes with no name, **786 bytes with 120 × `中`** (probe inside `riders.integration.spec.ts`'s worst-case test, then removed). The spec asserts `< 2048`. Matches R4.
- rider: `use-session.test.tsx` +3 (set → live and stored; null removes the key; signed-out no-op, no write); `name-screen.test.tsx` 4 (save trimmed + mirror + announce «Vārds saglabāts» + back; remove sends null + «Vārds noņemts»; blank Save with no name → back, no request, no Remove button; offline → Banner, no mirror, no back, retry sends the kept text); `name-row.test.tsx` 3 (named row reads «Vārds vadītājam: Anna» and pushes `/name`; «nav norādīts»; signed out renders the empty text). Profile + booking folders: 10 suites, 55 tests green; `booking-screen.test.tsx` and `accessibility.test.tsx` needed no edits. Mutation: sending the untrimmed text turns the expected test red (1 failed / 4).
- dispatch: `caller-panel.test.tsx` +3 (known name shown read-only with no input; null name → input; failed lookup → input). Phone-orders folder: 6 files, 58 tests green. R9 recorded 57 for its spike; its test set is not in the repo, so the difference of 1 is not reconciled here.

## Validation results

- T1 hash before and after the split: `345 a43374cb71b05908` both (observed). `wc -l`: `lv.ts` 396, `lv-rider.ts` 120, `en.ts` 394, `ru.ts` 401, all ≤ 500 (observed after T4).
- Level 1: `pnpm turbo run typecheck lint --filter=@taxi/shared --filter=@taxi/api --filter=@taxi/rider --filter=@taxi/dispatch` → 10/10 tasks successful (observed, after one prettier fix in the riders spec).
- Level 2/3: as above.
- T18 gate: `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force` from cleared `packages/shared/dist`, `db/dist`, `services/api/dist` and `apps/dispatch/.next`, at the `wip:` commit plus the riders-spec prettier fix: **22/22 tasks successful, exit 0** (observed). api 87 suites / 884 tests, rider 34 / 192, driver 45 / 296, dispatch 30 files, shared 30 files, db 3 files, all passed.
- AC10: `git diff origin/main -- services/api | grep -n "^+.*logger"` → no output. No new log line.

## Deviations from the plan

- **D-a: Level 4 manual validation not run (steps 1–6).** That includes step 5, TalkBack on the `sakta224` emulator, so AC7's TalkBack half is recorded as **not run**, which the plan allows. Each step's logic is covered by the integration and RNTL tests above. What is missing is the device reading: the row as one stop, the field not chattering (#287), and the announce.
- **D-b: `/name` shows its error in a `Banner` only, not also through `TextField error=`.** T14 named both. The UX States table names the Banner. Rendering both would make a screen reader read the same message twice (the field's error becomes its hint and a live region). The pasted-control-character parse failure uses the same Banner.
- **D-c: the name row's focus state is an accent outline** (`outlineWidth: 2, outlineColor: colors.accent, outlineOffset: 2`, `Button`'s pattern) and not an accent border. A border that appears on focus shifts the layout. A permanent transparent border would need a colour literal the theme does not have.
- **D-d: T10's repeat-caller lookup case sets the name with `ctx.db.update` after the booking** instead of before it. The booking in that test sends no `callerName`, so the order does not matter to what is asserted.
- **D-e: T7's control-character case sends `'An\u0000na'`** as a third `it.each` row, and each row signs in on its own phone (`p(9)`, `p(11)`, `p(12)`) so no row inherits another's stored name.
- Everything else as planned. `findOrCreateUser`'s conflict clause is unchanged. `customers/index.ts` needed no edit: its docblock does not mention the name.

## Issues encountered

- **The plan was only on an unpushed local branch** (`docs/plan-269-rider-names`, in another session's scratchpad worktree), and the main checkout was on #135's branch. The work is in a new worktree cut from the plan tip, so the three plan commits ride into this PR.
- **The `.env` copy into the worktree was blocked by the PreToolUse hook.** `DATABASE_URL` came from the session env (`settings.local.json`); Redis was confirmed live on 6381 with `docker port taxi-redis-1`. A fresh worktree also needed `@taxi/db` built before api typecheck resolved it.
- **#135 collides with the split.** `feature/skip-rider-sms-app-bookings-135` (local, no PR yet) adds `'rider.status.arrived': 'Auto ir klāt'` plus a 4-line comment to `lv.ts`. Whichever of #135 and #269 merges second must move that key and its comment into `lv-rider.ts`. There was no way to tell which peer session owns #135, so this is recorded here and in the PR body rather than sent by message.
- Last migration on this branch: `db/migrations/0013_concerned_wiccan.sql`. This ticket adds none.
- api lint reports pre-existing `no-unsafe-argument` warnings on `request(ctx.app.getHttpServer())` in every integration spec. The new `describe` in `riders.integration.spec.ts` adds one more of the same kind. Lint passes; it has no `--max-warnings 0`.
