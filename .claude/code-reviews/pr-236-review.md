# PR #236 review — round 1

**Head** `7ca9217` · **Base** `main` @ `b8d62c58` · **Reviewed** 2026-09-20 · **Round** 1 (no prior report)

`feat(dispatch): render per-driver stream freshness on the board (#234)` — 20 files, +1159 −40.
539 of the additions are the plan; the reviewable change is 620 lines across 13 shipped-source files
and 3 spec files.

Guarantees pass **skipped**: first round, and the base has not moved — `git fetch origin && git
rev-parse origin/main` → `b8d62c58`, identical to the PR's `baseRefOid` (`observed` 2026-09-20).
Fix-mechanism pass **skipped**: no prior round.
Constraint pass **run**: `grep -in "do not modify\|do not edit\|read-only\|no changes to\|frozen"` on
`.claude/plans/board-driver-freshness-234.md` returns one hit, and it is the word "frozen" describing a
car on a tracking page. No fix below violates an AC. The plan's own scope guards (`:43`, `:44`, `:48`)
and task GOTCHAs (`:281` region stays mounted, `:282` no `mm:ss` in the region, `:338` do not touch
step 6's `HH:MM` note) were checked against every recommendation — none is violated.
No implementation report exists for this branch (`.claude/reports/` holds nothing matching `234` or
`board-driver`) — reviewed against the PR body, the commit messages and the plan instead.

## Verdict: request changes

**Two High, four Medium, four Low. No Critical.**

The ticket's thesis is right and the execution is unusually disciplined — the boundary promotion is the
correct shape, the tests assert against the imported constant rather than `60`, and the page-level test
genuinely pins the structural decision (I broke it and it went red — see Validation). Both Highs are the
same class of defect and it is the one this feature was built to eliminate: **the panel renders «Raida»
in two situations where it has no evidence the driver is reporting.** A freshness column that can be
wrong in the reassuring direction is worse than no freshness column, because #234's whole argument is
that a still pin is uninformative and this panel is the thing that fixes it. The runbook change compounds
it: `docs/runbooks/driver-device-day.md:247` now tells the device-day operator the board corroborates
step 5.

---

## High

### F1 · «Raida» for a driver who has never sent a GPS fix

`apps/dispatch/src/features/board/driver-list.tsx:71` (and `:137-139` for the summary)

`driverFreshness` decides on `lastSeenAt` alone, and `lastSeenAt` is **not** "the last fix" — it is the
`seen` ZSET score, which `markOnline` seeds at go-online time in the same MULTI as the SADD, with **no
GEOADD**:

```
services/api/src/features/drivers/location/redis-driver-location.store.ts:75-79
  .sadd(onlineKey(cityId), driverId)
  .zadd(seenKey(cityId), String(atMs), driverId)   // ← the only write
```

Only the `RECORD` Lua script (`:104`) does the `GEOADD`. So a driver who taps the availability toggle in
an underground car park and never gets a lock reaches `board.service.ts:196-201` as
`{ location: null, lastSeenAt: <go-online instant> }` → age ≈ 0 → `'live'` → green «Raida».

**Failure scenario, `observed`.** Rendered `DriverList` with `{ location: null, lastSeenAt: NOW − 2 s,
status: 'online' }`:

```
Received: Gatis+37129999009Raida
```

The window closes only when the dark sweeper removes them, at `PRESENCE_DARK_AFTER_SECONDS +
PRESENCE_SWEEP_INTERVAL_MS` = 60 + 15 = **75 s worst case** (`derived`, from `driver-location.policy.ts:40,46`).
For 60–75 s the board asserts a driver is reporting who has never reported once.

**And that bound assumes the driver stays `online`.** `ForceAssignService.forceAssign`
(`force-assign.service.ts:52-90`) gates on the driver row and its status, never on a recorded position —
so a driver with `location: null` can be force-assigned to `on_ride`, and `markOfflineByServer` returns
early for `on_ride` (`drivers.service.ts:271`). Nothing sweeps them, and the green «Raida» is
**unbounded**. That is the same unboundedness the PR body names as the case the ticket earns its keep
on, reproduced inside the new panel's reassuring state. It is also reachable on exactly the setup the
runbook documents: force-assign is the only assignment path on a stack without `GOOGLE_MAPS_API_KEY`
(`driver-device-day.md:246`), and auto-dispatch cannot reach a position-less driver at all because
`findNearby` filters on the position.

The `unknown` state was built for exactly this and keys off the wrong field. `board-state.ts:195-197`
says so in terms: *"`lastSeenAt: null` is an online driver whose GEO position was never recorded or was
dropped"*. That condition is `location === null`. `lastSeenAt === null` fires only when the `seen` score
is missing or non-numeric — a set member predating the seeding, which `drivers.service.ts:315-317` calls
a deploy ghost. So the new third state is near-dead in production while the case its own docblock
describes renders green.

**Consequence in the runbook.** Step 2 is a HARD GATE: *"Open `/dispatch`, find that driver on the
board"*, and `:247` now offers «Raida» as corroboration. During the first 60 s a phone that never got a
lock satisfies it.

**Prescribed fix, probed (`observed`).** In `DriverRow`:

```ts
const freshness =
  driver.location === null ? 'unknown' : driverFreshness(nowMs, driver.lastSeenAt);
```

and the same discriminator in the `silent` filter at `:137-139`, which currently omits this driver from
the live-region summary too. I applied it and ran the suites: the probe flips to «Nav signāla» and all
existing cases stay green — `Tests 16 passed` across `driver-list.test.tsx` (8) and `dispatch-page.test.tsx`
(7), plus the probe's inverted assertion. Neither the `never` fixture nor `SILENT_ON_RIDE` is disturbed.
One consequence worth stating rather than discovering later: a *malformed* coordinate also yields
`location: null` (`redis-driver-location.store.ts:251-254` validates rather than casts), so a reporting
driver with a bad fix would read «Nav signāla». That is the cautious direction, and it is the right
trade for a signal whose purpose is to refuse to over-claim.

Add a test with `location: null` and a fresh `lastSeenAt` — it is the fixture the suite is missing, and
without it the same regression re-lands.

### F2 · The panel attributes the console's own deafness to the drivers

`apps/dispatch/src/features/board/driver-list.tsx:71,137-139`, mounted at `app/dispatch/page.tsx:273`

`driverFreshness(nowMs, lastSeenAt)` compares a **ticking** clock against a **frozen** field. `nowMs` is
`Date.now()` on a 1 Hz interval, independent of any frame (`use-board.ts:98,187-190`); `lastSeenAt`
stops advancing the moment frames stop arriving. Nothing in the derivation distinguishes *"this driver
stopped reporting"* from *"this console stopped receiving"* — both freeze the numerator.

**Failure scenario A — cold refresh while the api is unreachable.** `hydratedBoard()` (`use-board.ts:56-67`)
restores an arbitrarily old frame from `localStorage` with `lastFrameAtMs: null`, deliberately, so the
console never traps data. On that first paint every driver's `lastSeenAt` is as old as the snapshot while
`nowMs` is now, so every row reads «Klusē MM:SS» and the summary names all of them — with every phone
streaming normally.

**Failure scenario B — mid-session socket drop.** At T+5 s the stale banner appears (`STALE_MS = 5_000`,
`page.tsx:108-110`); at T+60 s the rows begin flipping and the `aria-live="polite"` region announces.
The banner leading by 55 s limits the harm; it does not remove it, and it does not apply to A at all,
where banner and false rows land on the same paint.

This is the inverse of the rule the board already enforces on itself. `pillFrom` (`board-state.ts:250`)
refuses to claim `live` without a fresh frame precisely because an unprovable freshness claim is the
defect. The new column makes the opposite unprovable claim and escalates it into a live region, on a
console whose alarm budget is governed (`alerts-panel.tsx:49-54`).

The clock-skew docblock at `board-state.ts:211-218` reasons carefully about the *rarer* exposure — a
misconfigured browser clock — and does not reach this one. And `realtime-events.ts:183-189`, added by
this PR, now justifies shipping `lastSeenAt` raw on the grounds that *"the client has both this field and
its own clock"*, which is the pair that goes wrong here.

**Prescribed fix.** The discriminator is already computed one line above the mount: inside the
`frame !== null` branch, `page.tsx:108-110`'s `showStaleBanner` reduces to
`pill === 'offline' || isStale(nowMs, board.lastFrameAtMs)`. Thread it as one prop; when true, render the
freshness column as the `unknown` label and the live-region text as `''`.

Keep the `<p aria-live="polite">` **mounted and empty** — `text = boardStale ? '' : summary`, never
`{!boardStale && <p …>}`. Plan `:281` requires the region be rendered at all times and
`driver-list.test.tsx:92-100` pins it.

**Probed (`observed`).** I applied both fixes together — `boardStale` as an optional prop defaulting to
`false`, threaded from `page.tsx:273` as `boardStale={showStaleBanner}`, with the `location === null`
discriminator from F1 in the same expression and in the `silent` filter — and ran
`npx vitest run --root apps/dispatch src/features/board/dispatch-page.test.tsx src/features/board/driver-list.test.tsx`:
`Test Files 2 passed (2) · Tests 15 passed (15)`. Neither fix breaks the PR's own suites, and in
particular the map-view case that pins the panel outside the ternary stays green — the harness supplies
`lastFrameAtMs: NOW` and `pill: 'live'` (`dispatch-page.test.tsx:52,55`), so `showStaleBanner` is
`false` in both new page-level tests. Reverted; the worktree is clean.

---

## Medium

### F3 · The comment justifying the missing `NaN` guard cites the two paths that *do* parse

`apps/dispatch/src/features/board/board-state.ts:206-210`

> *"Unreachable: every frame arrives through `dispatchBoardEventSchema.parse` (`use-board.ts:61,116`) and
> the field is `z.string().datetime()`, so no guard is added for it."*

`:61` is the `localStorage` restore and `:116` is the HTTP snapshot — the two **cold-start** paths. The
two live paths call no `.parse()`:

- `use-board.ts:154` — `socket.on(RT.dispatchBoard, (frame) => applyFrame(s, frame, Date.now()))`
- `use-board.ts:158` — `socket.on(RT.driverLocation, (event) => applyDriverLocation(s, event))`, and
  `applyDriverLocation` (`board-state.ts:128`) is what writes `lastSeenAt: event.at`. It is the
  highest-frequency writer of the field, and it is unvalidated.

The fail direction matters: `Date.parse` → `NaN`, `NaN >= x` → `false` → `'live'`. A malformed `at`
renders as green «Raida», the third instance of the same class as F1 and F2.

**What actually holds today**, and what the comment should say: every server→client emit is parsed
server-side — `realtime.service.ts:81`, `RT_EVENT_SCHEMAS[event].parse(payload)`. So there is no live
exposure from this api. The claim is the defect, not the code.

Worth recording separately: `apps/dispatch` is the only one of the three apps that does not validate
inbound socket payloads. `apps/driver` does (`use-offers.tsx:201,216`; `use-active-ride.tsx:168,176`) and
so does `apps/rider` (`use-ride-status.tsx:200`). `use-board.ts` is **not in this diff**, so closing that
gap is out of #234's scope — `gh issue create`, not an inline fix here. What belongs in this PR is
correcting the comment (cite `realtime.service.ts:81`), optionally with a two-line
`Number.isNaN(ageMs)` guard so the derivation is honest on its own.

### F4 · Step 5 now tells the operator a «Klusē» row *is* a failure

`docs/runbooks/driver-device-day.md:247`

Verbatim: *"a **still pin is still not a failure** — the pin never moves on a stationary phone — but a
«Klusē» row **is**."*

Given F2, a «Klusē» row is also what the operator's own laptop losing its socket produces, with
`driver.location.ping_accepted` printing in the api console throughout. Step 5 is one of the four the
Verdict rule at `:321` makes binary — *"Any ❌ on 4, 5, 7 or 8 means the fix did not land"* — so a false
❌ here invalidates a device day. The same cell's *"corroborates, it does not decide"* caps the damage
without making the flat sentence true.

**Fix.** One dependent clause: a «Klusē» row is a ❌ only while the board is not itself showing
«Nav jaunu datu».

### F5 · "in seconds rather than minutes" describes only the failure state

`docs/runbooks/driver-device-day.md:248`

The appended sentence offers the driver panel as corroboration for step 6's 90-second **healthy** watch,
claiming it renders freshness *"in seconds rather than minutes"*. But `console.driver_streaming` is bare
«Raida» with no `{age}` placeholder (`lv.ts:72`), and `driver-list.tsx:101-105` interpolates `{age}` into
`console.driver_silent` only. The seconds counter exists **only after** a driver crosses 60 s — only in
the failure state. On a passing run the operator looking for the promised counter finds one static word,
while the tracking line they were told is coarser is the one actually ticking.

**Fix.** Say the panel shows a seconds-resolution *silence age* once a stream has stopped, and nothing
while it is alive. Scope note for the fix pass: plan `:338` GOTCHA 2 freezes step 6's `HH:MM` note (that
is #224's `timeOf` observation). The sentence to correct is the one *this PR appended* to the same cell.

### F6 · The one surface carrying every driver renders the phone as unclickable text

`apps/dispatch/src/features/board/driver-list.tsx:88`

`board-map.tsx:20-22`, edited by this PR, states the panel's distinguishing property: *"It, not the zone
grid, is the one that carries EVERY online driver — the grid lists queue entries, so a driver in no zone
appeared nowhere readable until #234."* For a driver in no zone queue this row is the console's only
rendering of their number, and it is a plain `<span>`.

`zone-grid.tsx:130-141` already settled the doctrine for the same datum and ships the fix —
`<a href={`tel:${entry.phone}`}>` with `minHeight: 44`, `display: 'inline-flex'` — under the comment
*"The phone is ALWAYS visible — degraded mode means Dina dispatches by voice, and hunting for a number
mid-outage is the trap."*

Concrete case: an `on_ride` driver goes dark — the unbounded case the PR body says the ticket earns its
keep on — and is in no zone queue. The panel names them, the summary announces them, and the single
action the whole feature exists for requires select-and-copy. It also misses the 44px target rule.

**Fix.** Mirror `zone-grid.tsx:130-141`.

---

## Low

### F7 · "Its text changes only when the SET changes" is a guarantee, and is not one

`apps/dispatch/src/features/board/driver-list.tsx:127,166`

The text is `silent.map((d) => d.name).join(', ')`, so it also changes when the **order** changes or when
a name changes. Order is `frame.drivers`' order, which is `listOnline`'s, which is `SMEMBERS`
(`redis-driver-location.store.ts:234`) — `driver-location.store.ts:88` documents "Order is not
guaranteed". At pilot scale the set is listpack-encoded and insertion-ordered in practice, so this is
unlikely to bite; the repo's rule is that a guarantee in a comment is a claim regardless.

**Fix.** `.sort()` before `.join(', ')` makes the comment true rather than softening it.

### F8 · A deferral that names no ticket, inside the PR closing a deferral that named no ticket

`apps/dispatch/src/features/board/board-state.ts:218` — *"Correcting it means carrying a server-client
offset from `frame.at`, which would change ride ages too and **is its own ticket**."* No number. That is
the pattern #234 was filed to correct: the runbook paragraph this PR retires says the deferral *"was
found to name no ticket at all"*. `gh issue create` and cite it, or drop the deferral.

### F9 · The PR body's AC #3 grep enumeration is wrong

> *"`grep -rnE '\b60\b|60_000|60000' apps/dispatch/src/features/board` — the only hits are `age.ts`'s
> seconds-per-minute arithmetic; no threshold literal (AC #3)."*

`observed` at `7ca9217` — six hits, not two:

```
driver-list.test.tsx:47   lastSeenAt: seenAgo(3 * 60 * 60 * 1000),
driver-list.test.tsx:61   // 01:30 = TTL (60 s) + 30 s of further silence.
age.ts:17                 const minutes = Math.floor(totalSeconds / 60);
age.ts:18                 const seconds = totalSeconds % 60;
board-state.test.ts:229   * … never against `60`.
board-state.test.ts:256   driverFreshness(NOW, new Date(NOW - 3 * 60 * 60 * 1000)…
```

The **conclusion** survives — none of the four extra hits is a threshold literal, and the plan's own AC
wording ("finds no threshold literal") is satisfied. The PR body's restatement of the output is what is
false, and the PR body is the surface that is not in the working tree.

### F10 · `>=` renders as "older than" in the runbook

`docs/runbooks/driver-device-day.md:247` — *"flips … once the last fix is **older than**
`DRIVER_LOCATION_TTL_SECONDS` (60 s)"*. `driverFreshness` is `ageMs >= TTL` (`board-state.ts:227`), so it
flips **at** 60 s. One second, and the boundary convention is deliberate enough
(`board-state.ts:201-202` argues for it) to be stated correctly.

---

## Checked and clear — including things worth flagging that turn out not to be

| Check | Result |
|---|---|
| Plan not updated for the `age.ts` deviation | **Refuted.** `.claude/plans/board-driver-freshness-234.md:527-535` carries an AMENDMENTS section recording DV1 (`age.ts`) and DV2 (three runbook sites), both argued. The PR body's claim is accurate. |
| `unknown` folded into the silent summary → false alarm at driver login | **Refuted.** `markOnline` seeds the score, so a new driver is never `unknown`. (That same fact is F1 — the seed makes them `live` instead, which is the defect.) |
| `<ul listStyle:'none'>` without `role="list"` | Not a defect. 1-of-5 in `apps/dispatch/src`, and `zone-grid.tsx:188-192`'s rationale is ordering-specific (an `<ol>` where queue position is the data). `ride-queue.tsx`, `alerts-panel.tsx`, `driver-picker.tsx`, `address-field.tsx` all ship without it. |
| Unnamed `<section>`, `h1 → h3` skip | Matches `ride-queue.tsx:145-155` and `alerts-panel.tsx:97` exactly; `page.tsx:161` is the only `<h1>` and there is no `<h2>` anywhere in the console. Pre-existing shape, not a new gap. |
| Theme discipline · the `10px` dot | Clean. Every value is a semantic `var(--…)`; `width: 10, height: 10` is a verbatim copy of `zone-grid.tsx:90-96`'s dot. No hex, no Tailwind, nothing bypassing the theme. |
| `{title} ({count})` header, h3 style | Character-identical to `ride-queue.tsx:146-155`. |
| Live region does not re-announce on the 1 Hz tick | Holds. `mm:ss` is kept out of the region text; React does not mutate an identical text node. Subject to F7's ordering caveat. |
| `drivers.length` / «Neviens šoferis nav tiešsaistē» | Correct. `board.service.ts:185` builds from `listOnline` — the Redis online set — so the count is "who the console can see and phone". |
| `ageOf` move is behaviour-identical | `age.ts:15-19` is the old `ride-queue.tsx:64-72` body with `requestedAt` → `at`. Every remaining `ride-queue.tsx` import is still used. |
| `packages/shared/src/index.ts` insertion | No collision (`DRIVER_LOCATION_TTL_SECONDS` appears nowhere else under `packages/shared/src`); the ordering comment at `:8` still directly precedes `./dispatch-explanation`. |
| The api re-export | All four import sites resolve (`driver-location.service.ts:13`, its spec `:11`, `drivers.service.ts:25` via `PRESENCE_DARK_AFTER_SECONDS`, `driver-presence.integration.spec.ts:19`). No cycle: `@taxi/shared` imports nothing from the workspace. Plan `:179`'s GOTCHA honoured — the Redis-specific rationale stayed in the policy file. |
| `console.map_alt` accuracy in both views | Correct in all three catalogs. The paragraph lives inside `BoardMap` (`board-map.tsx:111-119`), so it renders only in map view, and `page.tsx:264-273` puts `DriverList` immediately after — "is below" is literally true wherever the string appears. |
| i18n key coverage | All three catalogs are `as const satisfies Record<MessageKey, string>` (`en.ts:366`, `ru.ts:371`, `MessageKey` from `lv.ts:455`), so typecheck really does pin the six new keys in all three. |
| `DriverFreshness` placement | Correctly app-local, not in shared. The wire carries `lastSeenAt` raw with no `isStale` boolean, so the three-state derivation is presentation; only the boundary is a contract. That split is right. |
| Hard rules | No money arithmetic, no direct status write, no provider SDK import, no `any` / `as` / `@ts-ignore` / `eslint-disable` in any changed shipped-source file. |
| `max-lines` | `driver-list.tsx` 197, `board-state.ts` 254, `age.ts` 20, `driver-presence.ts` 26 — all well under 500. |
| `markOfflineByServer` never sweeps `on_ride` | Confirmed — `drivers.service.ts:271`, `if (status !== 'online') return false;`. The PR body's unbounded-silence premise is correct. |

---

## Validation

`observed` at `7ca9217` in `/Users/Berzins/Desktop/taxi-wt-234`, after clearing `.next` and every `dist`:
`env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`

```
Tasks:    22 successful, 22 total
Cached:    0 cached, 22 total
  Time:    1m29.313s
```

Exit 0.

| package | PR body claims | my run |
|---|---|---|
| `@taxi/api` | 2 skipped, 75 passed suites · 39 skipped, 694 passed, 733 total | ✅ identical |
| `@taxi/dispatch` | 28 files, 238 passed | ✅ identical |
| `@taxi/shared` | 24 files, 231 passed | ✅ identical |
| `@taxi/driver` | 44 suites, 250 passed | ✅ identical |
| `@taxi/rider` | 30 suites, 145 passed | ✅ identical |
| `@taxi/db` | 3 files, 17 passed | ✅ identical |

The 39 skipped are the documented Redis-gated suites — `REDIS_TEST_URL` unset locally, matching the
baseline in `CLAUDE.md` byte for byte, which is what the first commit's no-behaviour-change claim rests
on. PR checks on GitHub: `check`, `codeql`, `CodeQL`, `audit-diff`, `ready` — all pass.

### Claims in the PR body, re-derived

| Claim | Verdict |
|---|---|
| Gate figures are head-independent because everything after `ea7820c` is plan-only | ✅ `git diff --name-only ea7820c..7ca9217` → `.claude/plans/board-driver-freshness-234.md`, nothing else |
| "Moving the panel into the zones branch turns it red and leaves the other six green" | ✅ `observed` — I moved it and ran `npx vitest run --root apps/dispatch src/features/board/dispatch-page.test.tsx`: `Tests 1 failed \| 6 passed (7)`, the map-view case. Reverted. |
| 75 s = 60 + 15, `derived`, worst case | ✅ arithmetic and both constants correct; `driver-location.policy.ts:40,46` |
| `MIN_FIX_INTERVAL_MS = 4_000` @ `fix-throttle.ts:9` · `distanceInterval: 0` @ `location-options.ts:20` · `DRIVER_LOCATION_TTL_SECONDS = 60` @ `driver-presence.ts:26` · `PRESENCE_SWEEP_INTERVAL_MS = 15_000` @ `:46` · `PRESENCE_DARK_AFTER_SECONDS` @ `:40` | ✅ all five line refs correct |
| AC #1 grep — production reads in `board-state.ts` and `driver-list.tsx` | ✅ four read sites in `driver-list.tsx`, the derivation in `board-state.ts` |
| AC #3 grep — exactly one `DRIVER_LOCATION_TTL_SECONDS` declaration | ✅ `packages/shared/src/driver-presence.ts:26`, sole hit |
| AC #3 grep — "the only hits are `age.ts`'s" | ❌ **F9** — six hits |
| Test coverage added: 4 + 8 + 2 | ✅ counted: 4, 8, 2 |
| Level 4 manual walkthrough not performed | ✅ stated plainly, no VoiceOver pass implied |

## What is done well

- **The promotion is argued from the failure it prevents, not from tidiness.** `driver-presence.ts:1-26`
  names all three readers and states the defect a second copy creates — Dina reading «Raida» while the
  engine has already stopped offering. The api keeps its Redis-specific rationale attached to the
  re-export rather than dragging it into shared.
- **Tests assert against the imported constant, never `60`** (`board-state.test.ts:228-234`,
  `driver-list.test.tsx:13`), with a comment saying why. The AC #2 test (`driver-list.test.tsx:125-140`)
  reads only accessible text and forbids itself from passing on a style value.
- **`dispatch-page.test.tsx:136-181` pins the structural decision, not just the output**, and the PR
  body's claim that it earns its keep is true — I broke it deliberately and it was the only red.
  `vi.waitFor` with #189 cited.
- **Label maps are total over their unions**, so a fourth freshness state or a new `DriverStatus` is a
  build failure rather than a blank cell.
- **The i18n choice is argued from the formatter's limits** (`lv.ts:77-79`): a name list rather than a
  count, because `formatMessage` has no plural support and Latvian agreement cannot be expressed.
- **Both premise corrections were posted to the issue before any code was written.** That is the right
  order and it is rarer than it should be.

## Recommendation

**Request changes.** F1 and F2 first — they are the same defect and it is the one the ticket exists to
close. Both fixes are small and both have a discriminator already in scope (`driver.location`, and
`showStaleBanner` one line above the mount). F3 is a comment correction plus a separate issue for the
dispatch socket-validation gap. F4 and F5 land in the sheet #141's verdict rests on and should not ship
stale. F6 is four lines copied from `zone-grid.tsx`.

Next: `piv-fix-review-findings` on this report, then re-run the gate.
