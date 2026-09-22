# Implementation Report — rider arrival push (#17's push half)

**Branch**: `feature/rider-arrival-push-17`, stacked on `feature/skip-rider-sms-app-bookings-135` (`f2cc6c4`)
**Closes**: PR #253's AC #5 residual — the backgrounded-rider gap
**Status**: COMPLETE for every code task, with **one item owed and named**: no EAS build has run.

## Why this exists

#135 stopped the `driver_arrived` SMS for app-booked rides. PR #253's review found that the
justification ("an app rider sees both moments in-app") was false, and round 1 added
`rider.status.arrived` so the rider app shows the arrival. But a screen is a **foreground** signal.
A rider at the kerb with the phone in their pocket was still told nothing, by any channel — the
regression AC #5 priced at €9.36/mo and deliberately shipped behind a human decision.

Linards chose to close it rather than file it. This is that.

**The push replaces the SMS; it does not join it.** One message either way, and the app channel
still costs no segment, so #135's saving is intact.

## What shipped

| Layer | Change |
|---|---|
| `db` | `users.push_token`, migration `0011_small_polaris.sql` (one column, nullable) |
| `packages/shared` | `expoPushTokenSchema` / `pushTokenUpdateSchema` moved `schemas/driver.ts` → `schemas/push-token.ts`; `push.rider_arrived_{title,body}` and `rider.push.channel_name` in LV/RU/EN |
| `services/api` | new `features/riders/` slice — `PUT`/`DELETE /riders/me/push-token`; `NotificationsRepository.riderPushTarget` + `setRiderPushToken`; `RideNotificationsService.pushArrival`; `NotificationsModule` imports `PushModule` |
| `apps/rider` | `expo-notifications`, `features/push/` slice, `PushRegistrar` in the root layout, `blockedPermissions` entry |

### The send, and the three decisions inside it

`onStatus`'s app-channel guard was a silent `return`. It is now a branch:

```ts
if (details.bookingChannel === 'app') {
  if (kind === 'driver_arrived') await this.pushArrival(details);
  return;
}
```

1. **`driver_assigned` stays silent.** The rider is still *in* the app, having just booked. A push
   per status hop is how an alarm budget gets spent on noise — the same argument
   `rider-ux-evidence.md` makes about alarm discipline.
2. **No SMS fallback when the push fails.** Falling back would re-spend the segment #135 saved on
   every Expo hiccup, and the rider still has the screen when they open the app.
3. **`device_not_registered` NULLs the token; everything else does not.** The seam splits failures
   on exactly one question — *should the token be forgotten?* — and `provider_error` covers
   everything transient **and everything unrecognised**. Forgetting a good token on an Expo 500
   would silently unsubscribe a rider from every future arrival.

### The schema move

`expoPushTokenSchema` lived in `schemas/driver.ts`. A push token is a property of a **phone**, not
of a role — both apps mint the same shape from the same Expo API and register it against their own
`me/push-token` route. Leaving it under `driver` would have made the rider slice import a driver
schema for a value that was never the driver's.

Every consumer imports through the `@taxi/shared` barrel, so **no import statement moved**. The
tests moved with the schema (`tests/push-token.test.ts`).

## The Android permission trap — a rule this nearly broke silently

`apps/rider/CLAUDE.md` forbids `RECEIVE_BOOT_COMPLETED` by name, because Play policy reviews the
driver app's background location against the rider majority and one permission here invalidates the
two-app decision.

**`expo-notifications` ships that permission in its own manifest and merges it in.** `observed`:

```
node_modules/expo-notifications/android/src/main/AndroidManifest.xml
→ android.permission.POST_NOTIFICATIONS
→ android.permission.RECEIVE_BOOT_COMPLETED
```

Nothing in the gate would have caught this — the permission never appears in any file the repo
writes. It is added to `android.blockedPermissions`, beside `ACCESS_FINE_LOCATION`, which was
already there for the same class of reason.

**Blocking it costs nothing used here.** It only reschedules **locally scheduled** notifications
after a reboot; this app schedules none — every notification it shows is a remote push from the api.

The rule now says **merged manifest**, names `expo-notifications` as the concrete case, and tells
the next person to check the merged output rather than the source after adding any Expo module.

## A comment that claimed behaviour the code did not have

Caught during the lint pass, and worth recording because it is the exact defect class PR #253's
whole review was about. `installNotificationHandling`'s docblock said an arrival push arriving
while the app is active "is suppressed" — and the handler returned `shouldShowBanner: true`
unconditionally.

Fixed by implementing the suppression, not by softening the comment. The rider on `/book/status`
already reads «Auto ir klāt» and has already had it announced by `Banner`; a banner on top is the
double-announcement that screen was explicitly fixed to avoid. Suppression is gated on **our**
payload, not on app state alone, so a future notification kind with no on-screen equivalent still
shows.

## Probes — each against the unfixed code

| Probe | Unfixed | Shipped |
|---|---|---|
| remove the push branch, restore the silent `return` | `5 failed, 18 passed, 23 total` | `23 passed` |
| force the foreground handler to show unconditionally | `1 failed, 11 passed, 12 total` | `12 passed` |

The first probe initially caught only **3** of 5. Two cases — "a transient failure leaves the token
alone" and "a throwing provider never reaches the caller" — passed **vacuously** on code that never
pushes at all, because "no send" also writes no token and also does not throw. Both now assert the
send was reached first (`expect(pushed).toHaveLength(1)`, `expect(calls).toContain('push.send')`),
and the probe then caught all five. Recorded because a passing test that cannot fail is the thing
this repo keeps re-learning.

## Validation

`observed`, in the worktree, `COMPOSE_PROJECT_NAME=taxi`:

```
pnpm turbo run typecheck lint test build --force
→ Tasks: 22 successful, 22 total · Time: 1m33.92s
```

| Package | Result | Delta vs `f2cc6c4` |
|---|---|---|
| `@taxi/api` | 2 skipped, 81 passed, 81 of 83 suites · **39 skipped, 773 passed, 812 total** | **+12** — 4 notification cases, 3 riders service, 5 riders integration |
| `@taxi/rider` | 31 suites · **160 passed, 160 total** | **+12** — the push slice's tests |
| `@taxi/shared` | **28 test files** | **+1** — `push-token.test.ts`, moved with its schema |

Two red gates preceded the green one, both reported rather than hidden:

1. `@taxi/shared#test` — `tests/driver.test.ts` still imported the moved schema by path. Fixed by
   moving the block to `tests/push-token.test.ts`.
2. `@taxi/rider#lint` then `@taxi/api#lint` — prettier, plus `no-console`, which **this app bans and
   the driver app does not**. The driver's twin logs on every failure branch; the rider's cannot. The
   return value carries the diagnosis instead, which is why `no_project` and `unavailable` are
   distinct values rather than one falsy result.

## Owed, and not verified

**No EAS build has run, and the gate cannot stand in for one.** This adds a native module to the
rider app. `taxi-android-build-invisible-to-gate` is explicit: a 22/22 green gate says nothing about
whether an Android build works, and two separate blockers (#225 deps, #232 `expo.locales` lint) each
needed a real ~20-minute build to surface. Budget one build **and one failure**.

Two specific things only a build can answer:

1. **The merged manifest actually lacks `RECEIVE_BOOT_COMPLETED`.** `blockedPermissions` is the
   documented mechanism and is already load-bearing in this file for `ACCESS_FINE_LOCATION`, but the
   claim above is `derived` from Expo's documented behaviour, not `observed` in a built artifact.
2. **`apps/rider` has no EAS project id.** `extra.eas.projectId` is deliberately out of git
   (`taxi-eas-project-id-not-committed`), and the id on record is the **driver** app's. The rider app
   needs its own project and its own FCM credentials before any token is mintable — until then
   `registerPushToken` returns `no_project` and the feature is inert on a device.

`npx expo install --check` on `apps/rider` reports nine packages behind their expected versions —
**all pre-existing drift**, not introduced here; `expo-notifications@~57.0.15` matches what
`apps/driver` already pins. Bumping them is a separate change that itself needs a build.

## Merge order

This branch is stacked on `feature/skip-rider-sms-app-bookings-135` (PR #253) because the send
branch edits a guard that PR introduces. #253 merges first. Once both land, AC #5's gate is
discharged: a foreground rider sees the screen, a backgrounded rider gets the push.
