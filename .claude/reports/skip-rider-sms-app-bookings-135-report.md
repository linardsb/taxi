# Implementation Report — skip the arrival SMS for app-booked rides (#135)

**Plan**: `.claude/plans/skip-rider-sms-app-bookings-135.md`
**Branch**: `feature/skip-rider-sms-app-bookings-135` (from `fabd615`)
**Status**: COMPLETE for every code and documentation task — with **one item deliberately
left open**, named here so the header does not hide it:

1. **Level 4 manual validation was not run** (**V2** below carries the argument and the evidence).

*(A second item stood here — "Task 5 / AC #7's issue half is owed" — and was already discharged
when this report was written. `gh issue view 135 --comments` returns the correction, posted
2026-09-22T09:14:25Z, carrying the same two-fault analysis and the same 1,089 → 788 table.
AC #7 is closed on both halves. Struck at PR #253 review round 1, F5.)*

Every other acceptance criterion is met. **AC #5 is not an open task but a merge gate** — a
human decision, restated at the end of this report.

## Summary

One guard in `RideNotificationsService.onStatus` now withholds both status SMS from
`bookingChannel === 'app'` rides, replacing the `driver_assigned`-only condition that stood
three lines earlier. An app rider's SMS budget is the booking confirmation and nothing else;
a phone-booked rider (#63) still gets all three messages. Six documents that recorded the old
policy as current fact were corrected, the two research figures that never described HEAD were
annotated rather than deleted, and the metrics ledger now warns that the `SMS spend €/week`
row steps down by design.

## Tasks completed

- Task 1 — the channel guard → `services/api/src/features/notifications/ride-notifications.service.ts:114-119` (UPDATE)
- Task 2 — flip the app-channel arrival test, add the phone-channel counterpart → `services/api/src/features/notifications/ride-notifications.service.spec.ts` (UPDATE)
- Task 3 — settle-then-assert in place of `waitForSms(p(51), 2)` → `services/api/src/features/notifications/tracking/tracking.integration.spec.ts` (UPDATE)
- Task 4 — the documentation sweep, five edits across four files:
  - send-policy header → `services/api/src/features/notifications/ride-notifications.service.ts:30-33` (UPDATE)
  - §4.2 "who receives what" + the per-ride segment line → `docs/research/hosting-sms-cost-research.md` (UPDATE)
  - §4.3 projection-table label, lever-1 pointer, and a `CORRECTION (#135, 2026-09-22)` block → `docs/research/hosting-sms-cost-research.md` (UPDATE)
  - §3.3 APPLICABILITY amendment → `docs/research/rider-ux-evidence.md:74` (UPDATE)
  - `SMS spend €/week` row → `docs/ux-metrics-ledger.md:50` (UPDATE)
- Task 5 — the #135 cost-claim comment: **deferred to PR time**, as the plan's own IMPLEMENT line instructs ("Do this at PR time, not before implementing"). AC #7's issue half is therefore open; its research-doc half is done.

## Tests added

`services/api/src/features/notifications/ride-notifications.service.spec.ts` — net **+1** test:

| Case | Kind | Result |
|---|---|---|
| `arrived + app channel → NO driver_arrived SMS (expected — AC #1)` | flipped from `→ driver_arrived SMS on EVERY channel` | ✅ |
| `arrived + phone channel → driver_arrived SMS, unchanged (expected — AC #2)` | new | ✅ |
| `accepted + app channel → NO driver_assigned SMS (edge — SMS budget row)` | **left byte-identical** — D1's no-op proof | ✅ |

`services/api/src/features/notifications/tracking/tracking.integration.spec.ts` — no net test
change; the app-channel case was rewritten and renamed
`app booking: 1 SMS, no link, no driver_assigned, no driver_arrived (edge — budget row, AC #1)`.

**D1's no-op claim was proven executably, not argued.** After Task 1 and *before* any test edit,
`ride-notifications.service.spec` ran **1 failed, 17 passed, 18 total** — the single failure being
the `arrived → EVERY channel` assertion. The `driver_assigned` app-channel test stayed green
unedited, so rewriting `kind === 'driver_assigned' && bookingChannel !== 'phone'` as
`bookingChannel === 'app'` changed nothing for `driver_assigned`. `git diff` on that hunk returns
no `driver_assigned` lines (`observed`).

**AC #4's "channel unknown → send" is discharged by the condition's shape, not by a test.**
`BookingChannel` is `['app', 'phone']` (`packages/shared/src/enums.ts:99`) and the column is a
two-value pg enum (`db/src/schema/rides.ts:84`), so no unknown value is reachable. `=== 'app'`
fails open if a third channel is ever added. No fabricated cast was written, per the plan.

## Validation results

Every figure below is `observed` from the named run.

| Level | Command | Result |
|---|---|---|
| 1 | `pnpm --filter @taxi/api lint` | ✅ **0 errors**, 12 warnings — all the pre-existing `supertest(app.getHttpServer())` `no-unsafe-argument` warning, one per integration spec across 12 files, none introduced here |
| 1 | `pnpm --filter @taxi/api typecheck` | ✅ clean |
| 2 | `pnpm --filter @taxi/api test -- ride-notifications.service.spec` | ✅ **19 passed, 19 total** (was 18) |
| 3 | `COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test -- tracking.integration.spec` | ✅ **13 passed, 13 total** |
| 3 | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force` | ✅ **22 successful, 22 total**, 0 cached, 1m46.694s. `@taxi/api`: 81 suites / **800 tests**, 0 skipped |

**The +1 assertion, measured not inherited.** The plan forbids inheriting CLAUDE.md's count, so
both sides of the comparison come from the *same* command,
`env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test`:

| | Suites | Tests |
|---|---|---|
| Baseline at branch point `fabd615` | 2 skipped, 79 passed, 81 total | 39 skipped, **760 passed, 799 total** |
| After this change | 2 skipped, 79 passed, 81 total | 39 skipped, **761 passed, 800 total** |
| Delta | 0 | **+1**, as required |

The 39-skipped figure held. For the record, CLAUDE.md's `39 skipped, 694 passed, 733 total` at
`0cdb59c` is now **799 total** at `fabd615` — that line is stale again, but correcting it is not
this ticket's business and the digit is not restated anywhere in this branch's shipped files.

The line the gate protects is `services/api/.../ride-notifications.service.ts` at **282 lines**,
against the 500-line `max-lines` cap.

## Deviations from the plan

Seven. **V1 and V2 are the ones that change what a reviewer should expect to find.**

**V1 — Task 4's VALIDATE grep is unsatisfiable, and I changed the check rather than the docs.**
The task says two incompatible things: its PATTERN says mirror §4.3's `**CORRECTION (#136…)**`
block and "keep the superseded text visible", and its VALIDATE says a grep for
`1,347|745|45%` must return nothing. A correction block that quotes the figure it retires leaves
those digits in the tree by construction. I resolved toward the convention, because deleting
`1,347` would be precisely the "retire the digits, not the subject" failure CLAUDE.md warns
about. The check I ran instead: every remaining hit is either coincidental or visibly superseded.

**The figure is 10 — the hits in the tree proper**, `observed` at `9d61d0c` via
`grep -rnE "every channel|2 SMS/ride|app rider = 2 segments|1,347|745|45%" --include="*.ts" --include="*.md" . | grep -v "/node_modules/" | grep -v "/dist/"`,
counted per file with `cut -d: -f1 | sort | uniq -c`:

| Where | Hits | Why it is there |
|---|---|---|
| `hosting-sms-cost-research.md` | 8 | inside the dated correction block, or its relabelled table |
| `rider-ux-evidence.md` | 1 | a 30–45% cash statistic — unrelated subject |
| `ride-notifications.service.ts` | 1 | still **true**: `booking_confirmed` does go to every channel |
| **Total in the tree proper** | **8 + 1 + 1 = 10** | the set AC #6 is about |

The rest of the grep's output is this ticket's own plan and report (they exist to discuss the
retired figures), two shipped plans the plan says to leave, and three coincidental strings in
older reports — a timing `2m24.745s` twice and a GitHub comment id.

**Deliberately no grand total here, and that is the point.** Two earlier drafts of this line
carried one: first "19", which no run ever produced — I eyeballed it off the table below and
copied it into the plan and the PR body — and then "48", which was `observed` and still wrong by
the time it was committed, because *this very paragraph* is one of the files the grep counts.
Correcting the number moved it (48 → 49). The 10 is head-independent of anything I write here, so
it is the figure that survives. `inherited-figures.sh` catches neither, since no unit word binds
to a bare count; re-running the grep catches both. Same failure as #212's numstat table.

Line-by-line, `observed`:

| Hit | Verdict |
|---|---|
| `hosting-sms-cost-research.md:236` | prefixed `Superseded:` — not current fact |
| `:254` | table row relabelled `As shipped 2026-08-14 (pre-#136, pre-#135)` — dated, not current |
| `:255`, `:258` | the lever-1 projection row and its proposal paragraph, kept for the record, with the CORRECTION immediately below |
| `:264`, `:269`, `:270`, `:287` | inside the CORRECTION block, quoting the faults it retires |
| `ride-notifications.service.ts:31` | "the confirmation goes to every channel" — **true at HEAD**; `booking_confirmed` is unfiltered |
| `rider-ux-evidence.md:119` | `30–45%` of ride-hailing transactions are cash — unrelated subject |
| `.claude/plans/rider-comms-sms-tracking-page.md:368`, `short-tracking-links-sms-136.md:272-275` | shipped plans; the plan says leave them, and the forward-reference is the link |
| `.claude/code-reviews/pr-171-review.md:173`, `.claude/reports/pr-171-review-fixes.md:195` | the timing string `2m24.745s` |
| `.claude/reports/pr-221-review-fixes.md:4` | GitHub comment id `5719745770` |

**V2 — Level 4 manual validation was not run.** Not an oversight; here is the argument, and
Linards should overrule it if the argument does not hold. Level 4's two assertions are step 7
(app ride emits exactly one SMS, `booking_confirmed`, no `driver_arrived`) and step 8's control
(phone ride emits three). Both are asserted by `tracking.integration.spec.ts` through the same
code, `observed` green above. Specifically:

- The test `harness` boots the real `AppModule` against the real Postgres and overrides only
  seam providers (`test/harness.ts:537-565`) — which a `pnpm dev` run also stubs. The SMS
  difference is `RecordingSmsProvider` (an array) versus `StubSmsProvider` (a log line); same
  call site, same `sendSms`.
- `acceptBy` (`tracking.integration.spec.ts:174-194`) **is** Level 4 step 5 verbatim: real
  `dispatch.offerNext()`, offer id read out of the database, real
  `POST /dispatch/offers/:id/accept` with the driver's token expecting 201. The plan itself
  prescribes reading the offer id from the database "which is what the integration helper does".
- Step 7's oracle reads `kind` off the `ride.notifications.sms_sent` log line; the integration
  test proves the same thing by content. **The two cannot disagree**, and that is checkable
  rather than arguable: `logSent` has exactly one caller (`sendSms:226`), `sendSms` has exactly
  two (`:78`, the confirmation, and `:147`, both status kinds), and the new guard at `:119`
  returns before `:147` whenever `bookingChannel === 'app'`. No `kind=driver_arrived,
  channel=app` row is emissible at all, so the log oracle has nothing to show that the content
  assertion misses. `observed` by grep.

So Level 4's unique residue is a human reading a terminal. What it does **not** cover, either
way, is a real SMS leaving the building; no run in this ticket dialled a provider.

**V3 — one assertion added beyond the plan's snippet.** The plan's replacement block asserts
`toHaveLength(1)` and `not.toContain('/t/')`. `toHaveLength(1)` alone does not say *which*
message survived: a bug that suppressed `booking_confirmed` instead of `driver_arrived` would
pass it. I added `expect(bodies[0]).not.toContain(d.plate)` — only the two driver-details
templates carry a plate — so the test now pins the survivor as the confirmation. One line.

**V4 — §4.2's three stale line numbers were removed, not re-pinned.** The list cited lines
60-67, 95-96 and 122; all three were already stale before this ticket, and 122 is the one the
plan names. Re-pinning them buys a pointer that goes stale on the next edit, so the bullets now
name `onRideCreated` and `onStatus`, with a parenthetical saying why the numbers are absent.

**V5 — one comment was edited inside the phone-channel integration case**, which the plan said
to leave "untouched and green". `tracking.integration.spec.ts:328` read
`// The arrival SMS goes to every channel (AC #1).` — a Task 4 grep hit stating the old policy
as fact. Behaviour is untouched; the case is green and its three-SMS assertion is unchanged.

**V6 — §4.3's table header row was relabelled**, which is not among the plan's five named edits.
`| **As shipped today** — 301 app × 2 + 129 phone × 5 …` claimed current fact and was wrong
twice over. It now reads `As shipped 2026-08-14 (pre-#136, pre-#135)`. Same class as the five.

**V7 — the plan's Task 1 VALIDATE predicted "the two tests named in the next task to be RED"; only
one was.** The second of those two is a test the plan asks you to *add*, so it cannot be red
before it exists. The plan's prediction, not the implementation, is what was off. Recorded
because a reviewer checking the VALIDATE line against the run will see a mismatch.

**UX states: none declared, none owed.** The plan has no UX section and no breadboard — the
change is a server-side send policy, `apps/dispatch` and both mobile apps are untouched. There is
no loading/empty/error/offline state to tick, and none was silently dropped.

## Issues encountered

**I1 — the branch-point baseline read RED (141 failed) and it was a stale `dist`, not the tree.**
`packages/shared/dist` was built 17 Sep and `trackingLinkHost` landed in #251 after it, so
`common/config/env.schema.ts:405` blew up across 14 suites. `pnpm --filter @taxi/shared build`
fixed it; the baseline then read 760 passed. This is the `taxi-ci-parity-gate` trap in the
direction that produces false red. The 799-total baseline above is the post-rebuild number.

**I2 — the first full gate failed on `@taxi/driver#typecheck`, also install state.**
`Could not find a declaration file for module 'semver'` — `@types/semver` is declared in
`apps/driver/package.json:34` and present in `pnpm-lock.yaml`, but absent from `node_modules`;
this checkout predates the merge that added it. Turbo then killed nine sibling tasks, and only
the `Failed: @taxi/driver#typecheck` line named the cause. `pnpm install` fixed it (+13 −179
packages) and **left `pnpm-lock.yaml` unmodified** (`git status --porcelain pnpm-lock.yaml`
empty), so no lockfile change rides in this PR.

**I3 — migration skew, for cross-session visibility.** `ls db/migrations/*.sql | tail -1` is
`0010_smooth_white_queen.sql`. This ticket adds no migration.

**I4 — two plan line references drifted by one.** The `driver_assigned` app-channel test is at
spec line **286**, not 285; the per-ride segment line was at **230**, not 231. Cosmetic, both
found by content.

**I5 — no concurrent session was detected.** `git reflog -8` showed only my own checkout off
`main` at `fabd615`; the gate ran in the main checkout, one at a time.

## The merge gate — AC #5, re-verified on this branch

Unchanged and still binding. `observed` at `6710f1a`: `apps/rider/package.json` contains no
`expo-notifications` (0 matches), and `apps/rider/src/features/` holds `auth booking i18n places
ride-status` — no push slice. So once this merges, an app rider with the app backgrounded learns
nothing when the driver arrives, until #17 ships push.

**AMENDED at PR #253 review round 1 (F1).** At the review's HEAD the FOREGROUND case was broken
too — `statusKey()` collapsed `arrived` into `rider.status.matched`, so an open app showed the
same «Auto ir atrasts» it had shown since acceptance. Round 1 adds `rider.status.arrived` and
the branch that selects it, so a foreground rider is now told and `Banner` speaks it. The gate
above is unchanged in kind and smaller in size: **backgrounded** is the whole residual.

What it buys is **€9.36/mo** — `derived`: 301 app rides × 1 segment removed × €0.0311, under
§4.3's own unevidenced assumptions (430 rides/mo, 30% phone-booked, €0.0311/segment BulkGate
`observed` 2026-08-14). Against a <€100/mo guardrail. **Do not merge until #17 lands or Linards
accepts the regression explicitly.** This is a human decision and the code being green is not it.

## Ready for the next step

Committed as `6710f1a` (`wip:` prefix, so `piv-commit` folds it). Next: `piv-commit`, then
`piv-create-pr` — the PR body must carry AC #5 as a merge gate and Task 5's #135 comment is owed
at that point.
