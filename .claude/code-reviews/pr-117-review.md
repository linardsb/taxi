# Code Review — PR #117 · `feat(dispatch): live dispatch board + merged web app, reliability-first (#18)`

**Branch** `feature/dispatch-console-live-board` → `main` · **Commit** `2859446` · 89 files, +4,579/−489
**Reviewed** 2026-08-15, fresh context (`piv-review-pr`) — three `code-reviewer` agents (api · dispatch app · shared+docs) plus an independent claims audit. Every finding below was re-verified against the source before it was written down; several agent findings were dropped in that pass.

**Recommendation: REQUEST CHANGES.** Nothing here is a blocker — no live crash, no exploitable hole, and the reliability architecture underneath is genuinely sound. But the findings cluster on the one property this ticket exists to guarantee (*the board is truthful under failure*), one of them is the **third consecutive occurrence** of this repo's documented numbers-in-the-PR-body defect class, and one is broken *today*.

---

## Validation — reproduced independently

Run from the worktree with `COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://127.0.0.1:6381`, LAN-IP `DATABASE_URL`.

| Check | Result |
|---|---|
| Gate: `pnpm turbo run typecheck lint test build --force` | **18/18 tasks, exit 0**, `0 cached` (`observed`, this review's run) |
| `@taxi/shared` | 152 passed / 18 files |
| `@taxi/db` | 17 passed / 3 files |
| `@taxi/api` | **483 passed / 55 suites, 0 skipped** — the Redis-gated suites ran |
| `@taxi/dispatch` | 71 passed / 14 files |
| `gh pr checks 117` | pass (3m34s) |
| `Closes #18` | `closingIssuesReferences` populated — the issue **will** close on merge |

Every count matches the PR body exactly. **Not reproduced**: the Level-4 reliability drill (75 frames/150 s, 31 `driver:location` patches, kill/restart resync, live 403) — those figures are taken on the report's word.

---

## Medium

### M1 · The PR body's size note cites wrong digits *and* draws a wrong conclusion from them
**`PR #117 body → "Size note"`**

| Claim | Actual |
|---|---|
| `apps/dispatch +2,803`, via "`git diff --shortstat origin/main..HEAD` per path" | that command on `apps/dispatch` gives **+2,827**; +2,803 is `apps/dispatch/src` |
| "12 of the 20 new dispatch-app files are specs" | **30** added files, **10** specs |
| "45 `console.*` keys" | **44** unique keys × 3 locales = 132 entries — and the report (line 12) says 44 |

The load-bearing one is the second. It is cited to support *"The overshoot is dominated by tests"* — 12/20 = 60% would support that; 10/30 = 33% does not. The arithmetic settles it: `apps/dispatch` adds **+1,080 test lines vs +1,747 non-test**, so non-test source *alone* exceeds the plan's `expected` band of 1,200–1,600 — a band the plan states **included** tests (`.claude/plans/dispatch-console-live-board.md:451`). The explanation is true for the api (+593 shipped source, inside the 450–650 band; tests/scripts add the other +334) and false for the app.

**Why Medium and not a nit**: CLAUDE.md's hard rule — *"Numbers flow plan → implementation → report → PR body, and are inherited, not audited… the reviewer is otherwise the first person to check it, twice running (#87, #107)."* This is the third occurrence, in the surface the rule singles out as "the most-read and the only one not in the working tree". The overshoot itself is fine and was correctly self-flagged per the plan's own instruction; only the accounting is wrong.

**Fix**: `gh pr edit 117` — restate as `apps/dispatch/src +2,803` (or use the path figure), `30 new files, 10 specs`, `44 console.* keys`, and replace "dominated by tests" with the split (`tests +1,080 / non-test +1,747`; the api's overshoot *is* test-dominated).

### M2 · A slow REST snapshot can overwrite a newer socket frame and be re-stamped fresh
**`apps/dispatch/src/features/board/use-board.ts:107-108`, `board-state.ts:70-76`**

`applyFrame` unconditionally sets `lastFrameAtMs = atMs`, and nothing orders the two transports feeding it.

**Failure**: API restarts → `connect` fires → `fetchSnapshot()` issues `GET /dispatch/board`; the cold API answers in ~3 s. At t+2 s the cadence delivers a *fresher* frame, applied correctly. At t+3 s the REST body — built at t+0 — replaces it and stamps receipt as *now*. The board shows a 3-second-old ride set under a green «Tiešraide». Same shape when an in-flight fallback poll lands after the socket recovers. Bounded (≤ one cadence) and self-healing, which is why it is Medium — but it is exactly the silent staleness the ticket exists to prevent, on the very reconnect path AC #2 exercises.

**Fix**, in the pure module, keyed on the server clock both transports already share:
```ts
if (state.frame && Date.parse(frame.at) < Date.parse(state.frame.at)) return state;
```
Strict `<` so a re-delivered identical frame still refreshes `lastFrameAtMs`. The comparison needs no client clock: both transports carry the same server-stamped `at`, taken from one `nowMs` before the awaits (`board.service.ts:70,94`). This also absorbs `retry()` (`use-board.ts:216-220`), which calls `fetchSnapshot()` outside the `pollBusy` gate and can otherwise double-fetch on repeated clicks.

### M3 · Acknowledging an alert beeps for the one underneath it
**`apps/dispatch/src/features/board/alerts-panel.tsx:62-67`**

`newestId = alerts[0]?.id`; the effect beeps whenever it differs from `lastSeenId.current`. Acknowledging the top alert changes `alerts[0]`, which reads as new.

**Failure**: sound on, alerts `[A, B]`, `lastSeenId = A.id`. Dina clicks «Apstiprināt» on A → `alerts` = `[B]` → `B.id ≠ A.id` → beep, for an alarm already on screen and already seen. Clearing N alerts yields N−1 spurious beeps. This contradicts the function's own comment ("never on re-render or acknowledge") and the ISA-18.2 discipline stated in both the plan and `apps/dispatch/CLAUDE.md`. Untested — `alerts-panel.test.tsx` has no ack-while-unmuted case.

**Fix**: replace the single ref with a `Set<string>` of already-beeped ids (pruned to current `alerts`, already capped at `ALERTS_CAP`); beep only on an id absent from it. Add the regression test.

### M4 · The persisted board frame outlives the session — driver PII stays on disk after logout
**`apps/dispatch/src/features/auth/session.ts:26-28`** (with `use-board.ts:28,33-39`)

`clearSession()` removes `taxi.console.session` only. `taxi.console.board-snapshot` — written on **every** frame (0.5 Hz), carrying every online driver's name, phone and last position plus every live ride's pickup address — is never removed. Grep confirms the key is touched in exactly three places, none of them a logout path.

**Failure**: Dina's JWT expires on a shared operator workstation; `fetchSnapshot` gets 401, clears the session, redirects to `/login`. The full driver roster with phone numbers, and rider pickup addresses, remain in localStorage indefinitely with no session present.

This is not covered by the accepted risk in `apps/dispatch/CLAUDE.md:9` — that sanctions XSS exposure of **the token**, not a third-party PII cache that survives the session it belongs to. Stated precisely: it is a *retention* issue, not an access-control bypass — `RequireRole` returns `null` before `DispatchPage` mounts, so an unauthorized visitor cannot read it back through the app, only off disk.

**Fix**: one line — `window.localStorage.removeItem('taxi.console.board-snapshot')` inside `clearSession()`, with the key exported from the board slice.

### M5 · Living AI-layer docs still point at the deleted `apps/admin` — the only thing broken *today*
**`.claude/skills/prime-app/SKILL.md:3,4,20,35` · `.claude/agents/code-reviewer.md:24` · `docs/build-playbook.md:53`**

`prime-app` still offers `admin` as a target surface and maps it to `apps/admin` (`:20`), a path this commit deletes — so `/prime-app admin` **breaks**: its Process step 2 ("Read the surface's `package.json` and list its `src/` structure") reads a directory that is gone, and step 6's `git log -- apps/admin` returns only history. Separately and more mildly, the `code-reviewer` agent definition — the agent *this very review skill dispatches* — still describes the repo as having "Next.js App Router portals (`apps/dispatch`, `apps/admin`)"; that one is prose, so it is stale rather than broken.

*Provenance of this finding*: my own first sweep for surviving `apps/admin` references truncated at `head -20` and reported the cleanup as complete. The third reviewer caught it; the complete sweep is what the paragraph below reports. Flagging that because M1 holds this PR to exactly this standard.

**Fix**: drop the `admin` row and the three other `admin` mentions from the skill (the admin surface is now `/prime-app dispatch`), drop `admin|` from `docs/build-playbook.md:53`, and update the `code-reviewer` agent's repo description.

**On the report's T12 claim** (`.claude/reports/…-report.md:22`, *"no `@taxi/admin` references remain in living docs"*): read literally it is true — no `@taxi/admin` **package** reference survives outside history. The substance it was asserting does not hold: three living, *executable* artifacts still route to a deleted path. Worth stating because the claim's literal form is what made it feel checked. The workspace deletion proper **is** clean — lockfile, `pnpm-workspace.yaml`, CI workflow, `docker-compose.yml`, README, root `CLAUDE.md` and build-playbook Step 8 are all correct, and every other surviving hit is in `.claude/plans/`, `.claude/reports/`, `.claude/code-reviews/`, `.git-blame-ignore-revs` or decision docs, where it belongs.

### M6 · One unparseable `rides.request` takes the whole board dark, on both transports
**`services/api/src/features/rides/rides.repository.ts:238`**

`pickup: rideRequestSchema.parse(ride.request).pickup` runs a **full** parse of the immutable request snapshot for each of the ≤100 live rides; one failure rejects `findBoardRides`, hence `buildBoardState`.

**Failure**: `rideRequestSchema` gains a required field (the seam evolves; `rides.request` is an audit snapshot written at creation and never migrated). One live ride booked before the change now fails to parse → `GET /dispatch/board` 500s **and** every 2 s beat logs `dispatch.board.emit_failed` and emits nothing. The board stays dark until that row leaves the 7-status live window — which includes `accepted`/`in_progress`, so that can be a long time. Strictly wider blast radius than the identical parse in `toAwaiting` (`:70`), which only sees `requested` rows and costs one sweeper pass.

**Fix**: parse per row and degrade rather than abort — `rideRequestSchema.pick({ pickup: true }).safeParse(ride.request)`, dropping the row with a `dispatch.board.ride_unreadable` warn. One bad row then costs one card, not the console.

### M7 · The plan's *Error* state is missing, and the omission is undocumented
**`apps/dispatch/src/app/dispatch/page.tsx:112`**

Plan (`:199`, UX → States): *"Error: snapshot fetch fails while socket up → inline retry row (not full-screen)"*. The login half is implemented; the board half is not, and the report's Deviations list does not mention dropping it. `fetchSnapshot` swallows `!res.ok` (`use-board.ts:106`), and the banner + retry render only under `pill === 'offline'`.

**Failure**: handshake succeeds but the emitter is broken (board build throwing — see M6) → `connected === true`, no frames. After 5 s the pill reads «Atjaunojas…» and stays there indefinitely. `board.lastFrameAtMs` is never surfaced, so Dina cannot tell whether the frozen queue is 6 seconds or 6 minutes old, and has no retry affordance — while ride ages keep ticking off `nowMs`, which makes the panel look alive.

**Fix**: gate the banner + retry on `isStale(nowMs, board.lastFrameAtMs)` rather than `pill === 'offline'`. Needs one new catalog key — `console.stale_banner` opens with «Bezsaistē» and would be a lie in the connected-but-silent case. Deferring to #19 is a legitimate call; it just has to be *written down*.

### M8 · The board's live-status set is hand-restated in three places, so a new status would render nowhere
**`apps/dispatch/src/features/board/ride-queue.tsx:164-168`** (with `services/api/src/features/rides/rides.repository.ts:45-50`)

The api decides what the board carries via `LIVE_BOARD_STATUSES`. The console re-states that set as three independent predicates (`=== 'requested'`, `'offered' || 'queued'`, `ACTIVE.has(...)`). They agree today only because both were hand-written from the same parts.

**Failure**: `LIVE_BOARD_STATUSES`'s own JSDoc contemplates the case — *"`scheduled` is deliberately absent"*. The day the scheduled-rides work adds it, the query returns those rides, `dispatchBoardEventSchema` accepts them (`z.enum(RIDE_STATUSES)` is the full set), and `RideQueue` matches them against no bucket. Dina's board silently omits live work; typecheck, lint and every component test stay green.

**Fix**: export the board's live-status set from `packages/shared` beside `ACTIVE_DRIVER_RIDE_STATUSES` — it is a cross-surface contract, not a query detail — build the `inArray` from it, and type `STATUS_KEY` as a **total** `Record<BoardRideStatus, MessageKey>`. Adding a status then fails the build in both places, and the `: ride.status` fallback (which would print a raw English enum on an LV-only console) can be deleted.

### M9 · Two coverage gaps on behaviour the PR body advertises

- **Snapshot hydration + persistence are untested** (`use-board.ts:33-58`). `use-board.test.tsx` calls `window.localStorage.clear()` in setup and no test ever starts with a stored snapshot, so neither `hydratedBoard()` nor `persistFrame()` has a case — happy path (stale-marked, `lastFrameAtMs === null`), corrupt blob (`'{not json'` → `emptyBoard()`, key removed, no throw), or quota. This is Task 10's stated deliverable and the mechanism behind the PR body's *"last frame persisted so the driver phone list survives a cold refresh with the API down"*. The code reads correct; a regression would simply be invisible. `session.test.ts:44` already models the corrupt-blob shape to mirror.
- **The zone↔driver correlation is positional and nothing tests it** (`board.service.ts:84-90` builds `zones` from `online`; `:110-131` reads `zones[i]`). `board.service.spec.ts` has one positioned driver; its two-driver case gives both a `null` location, and `resolveForPoint` is mocked as a constant ignoring its `point` argument, so a swap would be invisible. Indices align today — not a live bug. **Failure**: a later refactor moves the ghost-drop ahead of the zone lookup (a natural optimisation — it saves PostGIS queries), `zones` shortens, indices shift, and Dina sees driver A tagged with driver B's zone. No throw, no log, a wrong voice-dispatch decision. **Fix**: one case with two *positioned* drivers at distinct coordinates and a `resolveForPoint` mock keyed on `point`.

### M10 · Leaflet tooltip is an HTML-injection sink (latent, not exploitable today)
**`apps/dispatch/src/features/board/board-map.tsx:55`**

`.bindTooltip(driver.name)` passes a string; verified in the installed dependency (`node_modules/leaflet/dist/leaflet-src.js:10033-10034`) that `DivOverlay._updateContent` does `node.innerHTML = content` for string content. `driver.name` is `users.displayName`, `z.string()` with no constraint in `dispatchBoardEventSchema`.

**Stated honestly**: I grepped every write path — nothing in `services/api` writes `displayName` from user input today (seeds, tests, and the new `provision-dispatcher.ts` CLI only), so there is no live exploit. React escapes the same value everywhere else it renders (`ride-queue.tsx:83`, the zone chips); the Leaflet tooltip is the one sink. The reason to fix now: **#20's driver-onboarding review is the ticket that starts populating this field from driver-submitted data**, in a console whose JWT sits in localStorage by design.

**Fix**: pass a node — `const el = document.createElement('span'); el.textContent = driver.name; marker.bindTooltip(el)` — which takes leaflet's `appendChild` branch.

### M11 · `dispatch:unclaimed`'s doc row names one of its three triggers — in a row this PR edited, with the disproving evidence in hand
**`.claude/references/realtime-events.md:14`**

The row says the alert fires *"for an order nobody took past `unclaimedAlertSeconds`"*. `raiseUnclaimed` has three callers: the sweeper's threshold check (`dispatch.sweeper.ts:136`), `attempts >= MAX_OFFER_ATTEMPTS` (`dispatch.service.ts:66`), and no-eligible-candidate (`:112`). The latter two fire regardless of the threshold.

This PR's own drill proved it — the report (`:40`, `:63`) records the alert arriving **~1 s after booking with zero drivers online** via the no-candidate branch, and concludes *"the drill's expectation was wrong, not the code."* The PR then edited this exact row (appending *"Event-driven off the 1 s sweeper — never cadence-bound"*, which is accurate) and left the incomplete trigger description standing.

**Fix**: *"…for an order nobody took — past `unclaimedAlertSeconds`, after `MAX_OFFER_ATTEMPTS`, or immediately when no candidate exists"*.

---

## Low

| # | Where | Issue |
|---|---|---|
| L1 | `ride-notifications.service.ts:21` + `realtime-events.ts:188` | `SmsKind` is a hand-written twin of `dispatchSmsFailedEventSchema`'s enum — the only inline enum literal in a file where every other one is an imported const tuple, and whose own JSDoc admits the mirror. Drift *is* compile-caught (`emitToDispatch` is generic over `EventPayload<E>`), so hygiene not hazard. Fix: `export const SMS_KINDS` in shared, `z.enum(SMS_KINDS)` here, derive the api type from it — which also fixes L2's first half |
| L2 | `alerts-panel.tsx:13,27` · `ride-queue.tsx:17,81` | Two provably-dead fallbacks from weakened `Record` key types. If the SMS one ever fired it would nest the template into its own `{kind}` slot — «Neizdevās nosūtīt Neizdevās nosūtīt {kind}». `zones-panel.tsx:15` and `connection-pill.tsx:8` already do this right |
| L3 | `alerts-panel.tsx:117-119` | `role="alert"` on each `<li>` strips its `listitem` role, leaving a `<ul>` with no list children, and makes N independent live regions. The suite *confirms* this rather than catching it (`:98` asserts zero `listitem`s) |
| L4 | `i18n.ts:91,172,245` | `console.admin_placeholder` ships an internal tracker number in user-facing copy in all three locales — «Administrēšanas sadaļa tiks pievienota vēlāk (#20)», rendered verbatim at `admin/page.tsx:21`. Dina cannot resolve `#20`. The reference already lives in the component's JSDoc, where it belongs |
| L5 | `board-map.tsx:37,84` | Leaflet's default attribution prefix puts a focusable `<a>` inside the `aria-hidden="true"` map container. Inherited from `tracking-map.tsx:310-319`, so fix both. `map.attributionControl.setPrefix(false)` removes the anchor and keeps the required `©` credit |
| L6 | `login-form.tsx:124` | `placeholder="+371…"` is user-facing copy outside the catalog. Also `setStep('code')` swaps the field in place with focus parked on the submit button, whose accessible name silently changes — nothing announces the new field. Focusing the code input on step change fixes both |
| L7 | `use-session.ts:18-32` | The snapshot cache is keyed on the raw stored string only, but `loadSession` also checks expiry — so once cached, an expiring session keeps reading valid in-tab until storage changes, making the client-side expiry check inert. Harmless (the API 401 path and the socket sweep both still redirect), but the comment claims a UX check that does not fire |
| L8 | `ride-queue.tsx:61` | `gap: 2` is a raw px value; the theme's smallest spacing token is `xs: 4`. Every other value in the slice uses `var(--spacing-*)` |
| L9 | `board.service.ts:84-90` | N concurrent `ST_Contains` queries per frame against the pool ride booking uses. Bounded and honestly documented in the code (≤10 pilot drivers); no action now. Worth a note for whoever raises the fleet cap — at 200 online drivers a frame is 200 concurrent queries |

---

## What's good

- **The pill's core invariant is right, and it is the one that mattered.** Only `applyFrame` writes `lastFrameAtMs` — `applyDriverLocation` and the three alert pushes deliberately don't. So `driver:location` patches, which reach the dispatch room by a completely different server path, cannot refresh the freshness clock. Without that, a board whose builds were failing every beat would sit under a green «Tiešraide» while location pings kept flowing. `pillFrom` is the single derivation and requires a fresh frame rather than socket flags; M2 is a defect in what feeds it, not in the derivation.
- **`listOnline` is correct on every failure axis.** Members are read once then passed *as arguments* to `GEOPOS`/`ZMSCORE`, so reply alignment is argument-positional and never depends on SMEMBERS ordering; per-command errors re-throw rather than degrading into "nobody is online in Rīga"; a null position and a missing score each independently yield `null` instead of `{NaN, NaN}`; the empty-set early return avoids a zero-arg `GEOPOS`. The single contract fixture run against **both** the fake and real Redis is what stops the fake inventing an ordering guarantee Redis doesn't give.
- **Authorization is enforced, not just documented.** `@Roles('dispatcher','admin')` sits behind the globally-registered `JwtAuthGuard` → `RolesGuard` chain, proven by a driver-token 403 through the real chain in the integration suite; the socket side is closed by `canJoin` plus the absence of any client-initiated join API. Phone numbers reach only those two gates.
- **The multi-node caveat is more pessimistic than the actual behaviour.** `dispatchRoomSize` is node-local, but any node holding a local dispatcher emits to `dispatch:<cityId>`, which the Redis adapter fans out cluster-wide — so the skip check costs *duplicate frames*, never lost coverage, and duplicates are harmless under wholesale replace.
- **`emitFrame` cannot strand the board**: re-entrancy guard, everything inside try/catch/**finally**, and the guard reset is explicitly asserted — "one bad frame silences the board forever" is a real failure mode, and it is tested. **One `nowMs` captured before the awaits** likewise keeps `at` and every `unclaimedSeconds` on a single clock reading, so a frame can never contradict its own arithmetic.
- **SSR is handled by construction, not by scattered guards**: `useSession`'s `getServerSnapshot: () => undefined` makes `RequireRole` render `null` on the server, so `DispatchPage` never executes there and `useBoard`'s `window`/`navigator` lazy initializers can't produce a hydration mismatch. `RequireRole` returns `null` while reading or redirecting — no flash of gated content.
- **`loadSession` is the right shape for untrusted storage**: `JSON.parse` in a try, then `safeParse`, then expiry, and it *cleans* the store on every miss so a corrupt blob can't bounce every load — with expected/edge/failure cases covering exactly that.
- **The catalog's type-level guarantee is real.** `MessageKey = keyof typeof lv` plus `as const satisfies Record<Language, Record<MessageKey, string>>` makes a missing *or* extra translation a build failure, with runtime parity pinned in `tests/i18n.test.ts` for plain-JS consumers. All 44 `console.*` keys exist in all three locales and all 44 are used. The `{kind}` composition in `console.alert_sms_failed` works grammatically in all three (LV accusative-invariant *SMS*, RU prepositional, EN article), and the status strings carry per-language gender agreement rather than word-for-word translation — non-obvious things most catalogs get wrong.
- **`RT_EVENT_SCHEMAS` + `satisfies`** turns "wire timestamps are ISO strings" into a mechanically enforced invariant across all nine events, and `RealtimeService.emit` parsing before it sends closes the loop. The ninth event slotted in with no special-casing, wired in all four places. Nullable-vs-optional is consistent with the rest of the file, and omitting `.default(null)` on the board fields is the stricter, correct choice.
- **Provenance discipline is followed where the rule bites hardest.** `board.policy.ts` labels its cadence `derived`, states the condition it assumes, and explicitly separates the board cadence from the `dispatch:unclaimed` AC rather than letting one imply the other; the PR body's `unclaimedAlertSeconds` line does the same. M1 is the exception in an otherwise careful PR, not the pattern.
- **The `dispatch:board` JSDoc pre-empts the review it would otherwise get** — it says why `phone` legitimately travels on the wire and why `location`/`lastSeenAt` are nullable rather than filtered. Both correct, and both would have been flagged without the note.
- **Types are derived, never twinned** (L1 aside): `BoardRide`/`BoardDriver` are indexed off `DispatchBoardEvent`; every enum, event name, socket map and message key comes from `@taxi/shared`; `PillState`/`BoardAlert`/`BoardState` are correctly kept local as client view state.
- **Hard rules, cleared explicitly** so it isn't inferred from silence: no money in this diff, no ride-status write (so `assertTransition` is not bypassed), no contract duplicated outside `packages/shared`, the one-way `shared →` flow intact, no provider SDK imports, every shipped file well under 500 lines (largest: `use-board.ts` at 228), zero `any` / `@ts-ignore` / `eslint-disable`.
- Test quality is high throughout: assertions go through rendered output and catalog lookups rather than mock call counts, and the flash test inspects the actual `li` class on both the flashed and the calm row.

---

## Recommendation

**Request changes.** Suggested pre-merge set — all small:

1. **M1** — one `gh pr edit`.
2. **M5** — delete four stale lines; `/prime-app admin` is broken today.
3. **M3**, **M4** — one ref and one line respectively.
4. **M2** — three lines in the pure module plus a test; it is the ticket's own headline property.

**M6–M11** are cheap and belong in the same pass; **M7** is legitimately deferrable to #19 *if the deferral is written down*. The Lows are optional — L1 and L2 are one-liners and fix each other.

None of this is a rethink. The reliability architecture is sound, and the parts that are hard to get right are right. These are gaps in it.
