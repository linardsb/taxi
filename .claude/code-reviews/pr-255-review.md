# PR #255 review — round 1

**Head reviewed** `13982ad` · **Base** `feature/skip-rider-sms-app-bookings-135` @ `f2cc6c4` (PR #253)
**Title**: feat(rider): push the arrival to a backgrounded app rider (#17)
**Reviewed and fixed** 2026-09-22 · fresh context, sibling-app comparison

**Recommendation: APPROVE at `2b985f1`.** One High and one Medium were found and
both are fixed on the branch; one Low is reported and deliberately not fixed.

The High is not a wording defect. The rider app registered only
`addNotificationResponseReceivedListener`, which never sees the tap that started
the process — so tapping «Auto ir klāt» on a killed app opened the booking form,
not the ride. That is the exact rider #17 exists for.

This PR is stacked on #253. #253's round-2 close is posted; merge order is
**#253 → #255 → #254**.

---

## Summary

3,098 lines over 36 files at the reviewed head (`observed`,
`git diff --shortstat f2cc6c4..13982ad`), of which the shipped-source core is
small: one nullable column (`users.push_token`, migration `0011_small_polaris`),
a `riders` slice with two write-only routes, `pushArrival` on
`RideNotificationsService`, and a `push` slice in `apps/rider`. The rest is the
implementation report, the i18n strings and the schema move.

The api side is the strong half. Role guard, zod pipe, write-only response,
token rotation and the cross-role refusal each have a test
(`riders.integration.spec.ts:50-120`), the send is covered end-to-end through
the real route in `tracking.integration.spec.ts:373-429`, and the unit spec
drives all five branches of `pushArrival` including a throwing provider. The two
findings are both on the app side, where nothing has ever run on hardware.

---

## Issues

### F1 — High · the tap that LAUNCHES the app was dropped, and a comment said it was not

`apps/rider/src/features/push/register-push-token.ts:90-96` (at `13982ad`) and
`apps/rider/src/app/_layout.tsx:23`.

`installNotificationHandling` registered the response listener and returned:

```ts
  const tapped = Notifications.addNotificationResponseReceivedListener(…);
  return () => tapped.remove();
```

That listener does not receive the response that launched the process. It waits
in `getLastNotificationResponseAsync` — which is precisely why the **driver**
app reads it (`apps/driver/src/features/push/register-push-token.ts:70-76,113`,
with a comment saying why and a dedupe `Set` keyed on the notification id) and
why the driver's tests mock it (`register-push-token.test.ts:107,119`). The
rider app neither called it nor defined it in its `expo-notifications` fake, so
no test could have noticed.

Meanwhile `_layout.tsx:23` justified mounting the registrar at the root with:

> *"it must outlive any one screen: the arrival push can be tapped from a cold
> start, with no screen mounted yet"*

A guarantee in a comment is a claim (CLAUDE.md), and this one was false. It is
the same class as #253's own High, in the PR that answers #253's gate.

**Failure scenario.** A rider's phone sleeps in their pocket; the app is killed
by the OS, which is ordinary on Android after a few minutes. The driver taps
*arrived*. The push fires — this is the ONLY signal that reaches them, because
#135 removed the SMS and `/book/status` is a foreground screen. They tap it. The
app cold-starts on `/book`, the booking form, with no indication which ride the
notification was about. Nothing errors; the push worked, the routing did not.

*Where a cold start lands was checked rather than assumed*, because "the tap is
dropped" and "and it lands on `/book`" are two claims and only the first follows
from the missing call: `apps/rider/src/app/index.tsx` re-exports `GateScreen`,
and `gate-screen.tsx:45` answers a signed-in rider with
`<Redirect href="/book" />` — pinned at `gate-screen.test.tsx:43`.
`SessionGuard` does not intervene: it only bounces a **signed-out** rider, and
`/book` is not in its `PUBLIC_SEGMENTS`.

**Fixed** in `a950f53`. `getLastNotificationResponseAsync` is now read, the
payload goes through `rideIdOf` on this path too (an unknown `kind` routes
nowhere), and `routedColdStartTaps` dedupes by notification id for the driver
app's stated reason — the OS answers with the same response on every call, so a
re-mounted registrar would route the tap twice. `_layout.tsx` now names the
mechanism instead of asserting the outcome.

**Probe** (`taxi-review-payoffs-are-claims` — the fix is a claim too):

```
observed — as fixed:
  pnpm --filter @taxi/rider test -- register-push-token → 14 passed, 14 total
observed — the getLastNotificationResponseAsync block deleted, nothing else:
  → 1 failed, 13 passed, 14 total
     ✕ routes the tap that LAUNCHED the app, exactly once per notification
```

The companion case ("a cold-start response carrying an unknown kind routes
nowhere") stays green without the fix **by construction** — it asserts an
absence. Recorded so it is not mistaken for a second pin.

### F2 — Medium · a three-surface contract held as three literals

`apps/rider/src/features/push/register-push-token.ts:16`,
`apps/driver/src/features/push/register-push-token.ts:14`, and
`services/api/src/features/push/expo-push.provider.ts:90` (at `13982ad`).

The Android channel id `'presence'` was spelled independently in all three. The
rider file's own docblock states the stakes:

> *"this name is a CONTRACT with it, not a local choice: rename it here and
> Android silently drops the notification into the default channel with default
> importance"*

CLAUDE.md: *every cross-surface contract lives in `packages/shared` — never
duplicate a type an app can import*. Three copies of the value that decides
whether an arrival alarm is an alarm is the case the rule is for, and the
failure is silent at every layer: Expo accepts the send, Android accepts the
push, the rider gets a quiet tray line instead of a MAX-importance alert, and
nothing anywhere reports it.

**Failure scenario.** Someone renames the driver app's channel — say when the
offer push gets its own — and updates `expo-push.provider.ts` with it. The rider
app is untouched and still creates `presence`. Rider arrival pushes now name a
channel the rider's phone never created. Android files them under the default
channel at default importance, so the alert that should wake a rider at the kerb
becomes a silent tray entry. Every test in the repo stays green.

**Fixed** in `e515f64`. `PUSH_CHANNEL_ID` now lives in
`packages/shared/src/seams/push-provider.ts`, beside `PushMessage` — the seam
that already owns the push contract and already exports a runtime value
(`PUSH_DELIVERY_FAILURES`), so its "types only" rule is not broken. Both app
constants re-export it under their existing names, leaving each slice's public
API unchanged.

**Deliberate scope deviation, recorded rather than done quietly.** This touches
`apps/driver`, which #17 otherwise does not, against CLAUDE.md's surgical-changes
rule. One line there; the point of the fix is that the literal exists once.

**Probe.** Drifting `PUSH_CHANNEL_ID` to `'drifted'` and rebuilding shared turns
the two independent literal pins red — `@taxi/api` `expo-push.provider.spec`
(1 failed, 4 passed) and `@taxi/rider` `register-push-token.test`'s channel case
(1 failed, 13 passed). The driver's suite stays green at 7/7: it asserts through
`PRESENCE_CHANNEL`, so it moves with the constant and pins nothing on its own.
Two anchors, not three — worth knowing before someone treats the driver test as
one.

### F3 — Low · a rider's failed push logs under the `driver` domain — reported, not fixed

`services/api/src/features/push/expo-push.provider.ts:121-127`.

`ExpoPushProvider.fail()` emits `event: 'driver.push.request_failed'` for every
transport failure. Until this PR the only caller was the driver nudge, so the
domain was right. `pushArrival` is now a second caller, and a rider's arrival
push failing at the HTTP layer writes a line that says `driver`.

**Why this is Low and why it is left alone.** The signal is not lost:
`pushArrival` logs the same failure correctly under
`ride.notifications.push_failed` (`ride-notifications.service.ts:244,252`), so
the mis-domained line is a redundant extra, not a missing one. And a correct
rename is not obvious — `.claude/references/logging-standard.md:5` lists
ride | dispatch | payment | auth | driver | geo | realtime | support, and `push`
is not among them, so the fix is either a domain addition to the standard or a
`reason` the caller passes down. Both are decisions above a review's pay grade,
and both touch the driver push slice's log contract for no behavioural gain.

**Failure scenario.** Someone greps `driver.push.request_failed` while
debugging a driver-nudge outage and counts rider arrival failures into it.
Wrong number, right shape, no way to tell from the line.

---

## Not findings — checked and cleared

1. **Migration `0011` is free.** `origin/main` ends at `0010_smooth_white_queen`
   and no other branch in the repo holds an `0011` (`observed`, `git ls-tree`
   over every remote branch). No renumber needed on rebase.
2. **The duplicate `push_token` column is deliberate and documented.**
   `db/src/schema/users.ts:25-35` states the reason — a driver's token belongs to
   the `drivers` row, and one person can hold both roles on two phones. Not
   contract duplication: two different subjects.
3. **"Every consumer imports through the `@taxi/shared` barrel, so no import
   moved" holds.** `grep -rn "@taxi/shared/"` over `apps services packages db`
   returns **0** deep imports (`observed`), so moving `expoPushTokenSchema` out of
   `schemas/driver.ts` could not have broken a consumer.
4. **The 500-line cap holds where the diff grew.**
   `ride-notifications.service.ts` 384, `register-push-token.ts` 142,
   `push-registrar.tsx` 64, `push-provider.ts` 54 (`observed`, `wc -l` at the
   final head). No `max-lines` disable anywhere in the diff.
5. **`RECEIVE_BOOT_COMPLETED` is handled the right way round.**
   `expo-notifications` merges it in from its own manifest;
   `apps/rider/app.json` blocks it and `apps/rider/CLAUDE.md` now records *why*
   blocking costs nothing (it only reschedules locally scheduled notifications,
   and this app schedules none). Note the asymmetry with PR #115, where the
   **driver** app crashed at startup for the *absence* of that permission — that
   was a headless-task app with a boot receiver, which this one is not.
6. **`riderPushTarget` reads no phone and `riderContact` reads no token.** Two
   methods over one row, split so the SMS path never carries a provider handle
   (`notifications.repository.ts:104-131`). The token never appears in any
   response body — `PUT`/`DELETE` both 204, asserted at
   `riders.integration.spec.ts:61`.
7. **Test-shape rule met on both new slices.** api: expected / edge ×3 /
   failure over `pushArrival`; rider: expected / edge ×3 / failure over
   registration and handling.
8. **`driver_assigned` staying silent for app riders is argued, not forgotten**
   (`ride-notifications.service.ts:132-134`): the rider is in the app having just
   booked, and a push per status hop spends an alarm budget on noise.

---

## Validation

`observed`, in the `wt-rider-push` worktree, on the tree at `a950f53`. The one commit after it (`2b985f1`) amends a markdown report under `.claude/reports/` and touches no compiled or tested path, so this run describes the tip:

```
COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force
→ exit 0 · Tasks: 22 successful, 22 total · Time: 1m18.74s
```

| Package | Result |
|---|---|
| `@taxi/api` | 2 skipped, 81 passed, 81 of 83 suites · **39 skipped, 773 passed, 812 total** |
| `@taxi/rider` | 31 suites passed · **162 passed, 162 total** |
| `@taxi/driver` | 44 suites passed · **250 passed, 250 total** |
| `@taxi/shared` | 28 files · **255 passed** |
| `@taxi/dispatch` | 30 files · **272 passed** |
| `@taxi/db` | 3 files · **17 passed** |

`REDIS_TEST_URL` was not exported, so the 39 gated Redis tests skipped — the
documented opt-in, and the same shape #253's review ran.

**What this gate does not say.** It never builds the Android app. Per
`taxi-android-build-invisible-to-gate`, two blockers (#225 deps, #232
`expo.locales` lint) each needed a real ~20 min EAS build to find, and this PR
adds a native module (`expo-notifications`) plus two manifest permission
entries. A green 22/22 is not evidence that `apps/rider` builds.

**And nothing here has run on a handset.** `apps/rider` has no
`extra.eas.projectId` and no `eas.json` at all, so on a device today
`registerPushToken` returns `no_project`, no token is stored, and `pushArrival`
logs `no_token` — a backgrounded rider gets exactly what they got before this
branch. The PR's own report leads with this (`13982ad`), which is the right
call; it is repeated here because it is the one thing a reviewer must not read
past.

---

## What is good

1. **The `device_not_registered` / `provider_error` split is used exactly as the
   seam defines it**, with the reasoning inverted correctly: forgetting a good
   token on an Expo 500 silently unsubscribes a rider from every future arrival,
   so only the permanent failure NULLs. Both directions have a test, and the
   transient case asserts `pushed` **first** — without that it would be green on
   code that never pushes at all.
2. **No SMS fallback, argued rather than omitted.** Falling back would re-spend
   the segment #135 saved on every Expo hiccup, on the day when most riders have
   no token at all.
3. **The integration case registers through the real route** rather than writing
   the column, so `PUT /riders/me/push-token` is covered end-to-end inside the
   test that proves the send — one test, two contracts.
4. **The schema move is justified by subject, not tidiness**: a push token is a
   property of a phone, not a role. The old location keeps a note saying where it
   went and why, so a reader of `schemas/driver.ts` is not left guessing.

---

## Recommendation

**Approve at `2b985f1`.** F1 and F2 are fixed on the branch with probes; F3 is
reported and left. Merge **#253 first**, then this, then #254.

Two things a green gate cannot answer, both for Linards rather than a reviewer:

- **A2 — is an EAS project owed before this is worth merging?** Nothing in #17
  reaches a rider until `apps/rider` has a `projectId`. Merging it as
  dormant-but-correct is defensible; believing it closes #253's AC #5 today is
  not.
- **An Android build.** Budget one EAS run, and one failure, before treating
  `expo-notifications` as safe.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
