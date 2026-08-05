# Code Review — PR #36

**`feat(api): drivers slice — profile/vehicle CRUD, presence, Redis GEO location ingestion`**
Branch `feature/api-drivers-slice` → `main` · 30 files · +3748 / −10 · Implements #8 · Epic #1

Two independent passes over the same diff: the `code-reviewer` agent against the project's standards,
plus a fresh-context review with live validation, a coverage run and a runtime probe. Rubric =
`CLAUDE.md`, `services/api/CLAUDE.md`, `packages/shared/CLAUDE.md`,
`.claude/references/{realtime-events,logging-standard}.md`. The **six documented deviations** in
`.claude/reports/api-drivers-slice-report.md` are intentional decisions and are **not** counted as
issues below, nor are the stated Non-Goals (no migration, no `ride_tracks`, no ETA, no eligibility
filter in the nearest query, no geozone queue, no admin endpoints, no ping rate limiter).

## Summary

The hard parts are right, and right for stated reasons rather than by luck. Both passes independently
walked the load-bearing claims and **all of them hold** — the table below is verification, not
restatement. The test design is the strongest thing here: one fixture built so a lat/lng transposition
*inverts* the answer, run against both store implementations, plus a `DRIZZLE` provider that throws on
any property access so "a ping never touches Postgres" fails the build rather than the review.

**One High blocks merge**, and it is small: the gateway's `NEVER throws` contract — written in capitals
because a driver mid-shift must not be disturbed by one bad frame — holds for both input-rejection
paths and not for the third. Beyond it, four of the seven Mediums are gaps neither the plan nor the
report claims (`remove()` skipping an `on_ride` driver, no disconnect handling at all, a spread where
the sibling repository documents an allowlist, a socket that outlives its JWT), and three are test
issues, two of them branches that ship untested today.

Nothing here is structural. The architecture, the security boundaries and the correctness reasoning
all survive scrutiny; what is missing is error handling on one path, two symmetry gaps and some
coverage.

## Verification of the PR's load-bearing claims

Checked against the code, not the prose. **All hold:**

| Claim | Verdict |
|---|---|
| Lua `RECORD` is atomic and correctly indexed | **Correct.** `eval(script, 3, online, geo, seen, driverId, lng, lat, atMs)` → `KEYS[1..3]`, `ARGV[1..4]` line up. `GEOADD KEYS[2] ARGV[2](lng) ARGV[3](lat) ARGV[1](member)` is the right `key lng lat member` order. `SISMEMBER` returns an integer, so `== 0` is valid Lua. EVAL is atomic. |
| `findNearby` ordering, `[lng,lat]` mapping, no `COUNT` | **Correct.** `ASC` gives distance-ascending; filtering preserves order; breaking at `limit` after the filter yields the `limit` nearest *fresh* drivers. Omitting `COUNT` is genuinely required (Redis applies it pre-filter). `{lat: coord[1], lng: coord[0]}` is right. Both pipeline legs rethrow instead of degrading to an empty list. The pipeline's non-atomicity is benign — both interleavings fail toward exclusion. |
| `setPresence` "both halves fail toward not-dispatchable" | **Holds in every branch.** Online, a Redis failure leaves PG `online` but out of the online set → `record` returns false → no position → invisible to `findNearby`. Offline, a PG failure leaves them already undispatchable. `vehicle_required` runs before any write, so the 409 leaves no partial state. |
| Privilege allowlist | **Airtight.** `driverProfileUpdateSchema` is a plain `ZodObject` under `.refine()`, so zod strips unknown keys *and then* the refine runs on the stripped object — `{commissionPctOverride: 0}` alone is a 400, not a silent no-op. The repository's explicit two-key `set` is a real second layer. Nothing reaches `balanceCents`, `commissionPctOverride`, `rating`, `fleetId` or `status`. |
| Vehicle ownership 404-not-403 on every path | **Enforced.** `update` and `remove` both scope with `and(eq(id), eq(driverId))` in SQL; `create` spreads `driverId` *after* `...input`, so a body-supplied owner cannot win even if zod ever stopped omitting it. No fetch-then-compare anywhere. |
| Options-less `@WebSocketGateway()` shares server + handshake middleware | **Correct.** Nest keys cached servers on `{port, path}`; neither gateway declares options; this one declares no `afterInit`/`handleConnection`, so nothing double-registers. `client.data.user` is set by the verified-JWT middleware (`realtime.gateway.ts:62-80`) and is trustworthy. |
| `ingest` server-stamps `at`, never injects DRIZZLE | **Correct**, and the throwing-Proxy provider is real enforcement, not a comment. |
| `findOrCreate`'s no-op `SET` | **Correct.** `onConflictDoNothing().returning()` does yield `[]` on conflict; `DO UPDATE SET user_id = user_id` is the idiom that always returns the row. |
| `updated_at` maintenance | **N/A** — neither table has a timestamp column, so nothing is being missed. |
| Money | `balanceCents` is `integer`/`centsSchema` end to end. No float touches an amount. |

Two things worth stating because they change what the numbers mean:

- **CI does run the Redis contract.** `.github/workflows/ci.yml:16-29` brings up `redis:7-alpine` and sets
  `REDIS_TEST_URL`, with an explicit host-reachability probe so a silent `describe.skip` cannot hide.
  The Lua script and the GEO argument order are covered by the merge gate, not merely by an opt-in
  local run.
- **`main.ts:17` calls `enableShutdownHooks()`**, so `RedisDriverLocationStore.onModuleDestroy` really
  does run — the module comment's claim checks out.

## Validation

Run here, not quoted from the PR body:

| Gate | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` (cold `dist`, CI parity) | **pass — 18/18** |
| `@taxi/api` jest (default) | **71 passed, 11 skipped**, 13 suites |
| `@taxi/api` jest with `REDIS_TEST_URL` | **82 passed, 0 skipped, 13/13 suites** |
| `@taxi/shared` vitest | **8 files passed** |
| eslint | **0 errors**, 2 warnings |
| Coverage, `features/drivers/**` (with Redis) | 95.21% stmts · 72.22% branch |

Both warnings are the `request(app.getHttpServer())` `no-unsafe-argument` pattern — one pre-existing at
`auth.integration.spec.ts:47`, one new at `drivers.integration.spec.ts:33` following the same shape.
Not a finding. Every number in the PR body reproduces exactly, including the 82/0.

## Issues

### High

**H1 · The gateway's documented `NEVER throws` contract does not survive a Redis failure — the driver gets an `exception` frame per ping**
`services/api/src/features/drivers/location/driver-location.gateway.ts:68`

The class comment is explicit: *"NEVER throws. A `WsException` emits an `exception` frame and a raw zod
error is worse — a driver mid-shift must not be disturbed by one bad frame."* That holds for the two
input-rejection paths, which `return`. It does not hold for the third: `await this.locations.ingest(…)`
is unguarded, and `ingest` awaits `store.record()`, which rejects whenever Redis is unreachable.
Nest's `WsProxy` hands the rejection to `BaseWsExceptionFilter`, and no global WS filter is registered
in `main.ts` or the harness to change that.

**Probed, not inferred** — the real app with `record()` stubbed to reject:

```
[Nest] ERROR [WsExceptionsHandler] Error: redis down
PROBE FRAMES: [{"event":"exception","payload":{"status":"error","message":"Internal server error",
  "cause":{"pattern":"driver:location","data":{"location":{"lat":56.9512,"lng":24.1136},"at":"…"}}}}]
PROBE CONNECTED: true
```

Three consequences, in order of how much they matter:

- A 30-second Redis blip mid-shift sends **every driver an `exception` frame per ping**. At a 1–5 s
  cadence that is a frame storm precisely when the system is already unwell, and the driver app has no
  way to tell it from a fatal protocol error.
- Nothing in the `driver.location.*` taxonomy is logged. The on-call sees a generic
  `WsExceptionsHandler` ERROR, not the structured event the logging standard requires — and
  `ping_ignored` / `ping_rejected` already exist as siblings.
- The frame's `cause.data` echoes the driver's own coordinates back. Harmless here — their own
  position, their own socket — but it is an error path returning request payloads by default.

**Fix:**

```ts
try {
  await this.locations.ingest(user.sub, parsed.data);
} catch (err) {
  this.logger.error({
    event: 'driver.location.ingest_failed',
    driverId: user.sub,
    reason: err instanceof Error ? err.message : 'unknown',
    at: new Date().toISOString(),
  });
}
```

Worth a spec case too (store rejects → socket stays up, no `exception` frame), since this is the
class's stated contract. Note this is the *opposite* call from the one `findNearby` makes deliberately
— that one throws on a pipeline error so dispatch never reads an outage as "no drivers in Rīga". The
asymmetry is correct; a one-line comment saying so would stop the next person unifying them.

### Medium

**M1 · `VehiclesRepository.update` spreads the patch where its sibling documents an explicit allowlist**
`services/api/src/features/drivers/vehicles.repository.ts:57`

`DriversRepository.updateProfile:69-75` carries an instruction in capitals — *"The `set` object is an
explicit two-column ALLOWLIST … do not replace it with a spread of the patch."* Twenty lines away,
`VehiclesRepository.update` does exactly that: `.set(patch)`.

It is **safe today**. `vehicleUpdateSchema` derives from `vehicleCreateSchema`, which omits `id` and
`driverId`, and zod strips unknown keys. But `vehicles` has the same class of non-driver-writable
column that `drivers` does, and the only thing between a driver and re-parenting a car onto another
driver is one `.omit()` in a different package. Add `driverId` back for an admin path, or reach for
`.passthrough()`, and this line silently becomes privilege escalation — with no local signal, because
the sibling file documents the opposite rule.

Mirror the drivers repository with the seven explicit `...(patch.x === undefined ? {} : {x: patch.x})`
entries.

**M2 · Deleting your last vehicle while `on_ride` leaves the invariant broken once #11 restores you**
`services/api/src/features/drivers/vehicles.service.ts:61`

`remove()` forces offline only when `profile.status === 'online'`, so a driver in `on_ride` who deletes
their last car falls through the early return untouched. When #11 completes the ride and restores them
to `online`, the slice's own invariant — *online ⟹ at least one vehicle*, the thing `setPresence`'s
`vehicle_required` 409 exists to enforce — is violated, and #10 gets a candidate with no `categories`
and no `hasChildSeat` that it can only ever discard. The state is reachable **today**; only the
recovery half waits on #11.

Simplest fix, and consistent with how the rest of the slice treats `on_ride` as #11's territory —
hoist the profile read above the delete and refuse outright:

```ts
const profile = await this.drivers.findOrCreate(userId);
if (profile.status === 'on_ride') throw new ConflictException('driver_on_ride');
```

Refusing to delete the car you are currently driving is also the better product behaviour.

**M3 · Nothing ever clears presence on disconnect — a force-quit leaves a ghost driver forever**
`driver-location.gateway.ts` (no `handleDisconnect`) · `redis-driver-location.store.ts:29-31`

`grep -rn 'handleDisconnect' services/api/src` returns **nothing**. Presence is only ever cleared by an
explicit `markOffline`, so a driver who force-quits the app, loses their phone or drops off the network
stays `status = 'online'` in Postgres and stays a member of `drivers:online:<city>`,
`drivers:geo:<city>` and `drivers:seen:<city>` indefinitely — no key TTL, no sweeper, no hook.

Dispatch itself is protected, which is why this is Medium and not High: `DRIVER_LOCATION_TTL_SECONDS`
drops them from `findNearby`, so a ghost cannot be offered a ride. But `findMatchAttributes` keeps
reporting `status: 'online'` for them, so #18's board and #20's stats will both be wrong, and the three
Redis keys grow monotonically with driver churn. This is not in the plan's Non-Goals, so it reads as a
gap rather than a deferral.

Either add a `handleDisconnect` that calls `markOffline` — noting a driver can hold several sockets, so
it needs a last-socket check (`server.in(driverRoom(id)).fetchSockets()`) first, and that adding
`handleDisconnect` to *this* class is fine since the header's prohibition covers `afterInit`,
`handleConnection` and gateway options — or state it in the slice header as a known gap with the
mitigating freshness filter spelled out, so the next reader knows it was seen.

**M4 · The offline half of `setPresence` — the branch the PR's headline claim is about — never executes in the suite**
`services/api/src/features/drivers/drivers.service.ts:86-89`

The service comment explains at length why the two stores are written in **opposite** orders, and the
design is right. Coverage says only the `online` order actually runs:

```
drivers.service.ts | 93.54 | 78.57 | 100 | 93.1 | 87-88
```

Lines 87–88 are `markOffline` then `setStatus('offline')` — uncovered in both the default and the
`REDIS_TEST_URL` run. Walking all 14 integration cases confirms it: case 4 is the 409, case 5 the
online happy path, case 8 the contract-level `on_ride` rejection, case 10 sends `offline` but throws
`driver_on_ride` first, and case 14 reaches `markOffline` through `VehiclesService.remove`, not this
branch. **No case ever completes `PUT /drivers/me/status {"status":"offline"}` successfully.** The
Level-5 walkthrough covers it by hand — exactly the kind of check that stops being run.

```ts
it('takes a driver offline in both stores (expected)', async () => {
  const d = await driver(16);
  await addCar(d.auth);
  await http.put('/drivers/me/status').set('authorization', d.auth)
    .send({ status: 'online' }).expect(200);

  await http.put('/drivers/me/status').set('authorization', d.auth)
    .send({ status: 'offline' }).expect(200);

  expect((await d.row())!.status).toBe('offline');
  expect(ctx.locations.isOnline(cityId, d.id)).toBe(false);
});
```

(`p(16)`–`p(18)` are free; the spec currently uses 1–10 and 12–15.)

**M5 · `PATCH /drivers/me/vehicles/:id` ships with no expected case at all**
`services/api/src/features/drivers/vehicles.service.ts:46` and `:56`

```
vehicles.service.ts | 86.66 | 62.5 | 100 | 92 | 46,56
```

`:46` is `return updated;` — the **success** path of a vehicle update. The route has an edge case
(case 6, another driver's car → 404) and a failure case (case 7, non-UUID → 400) but nothing that ever
updates a vehicle successfully. `CLAUDE.md` requires ≥1 expected + 1 edge + 1 failure per feature.

It matters more than usual here because it is the test that would pin down M1's `.set(patch)`, and
because `packages/shared/tests/driver.test.ts:134` calls out the `.partial()`-over-`.default()` gotcha
as the thing which, if it flipped, would silently reset `category` and `hasChildSeat` behind the
driver's back — rider-visible filters changing themselves. The contract half is tested; the
end-to-end half is not.

```ts
it("updates a driver's own vehicle without resetting defaulted fields (expected)", async () => {
  const d = await driver(17);
  const car = await addCar(d.auth);   // category standard · hasChildSeat true

  const res = await http.patch(`/drivers/me/vehicles/${car.id}`)
    .set('authorization', d.auth).send({ plate: 'XY9999' }).expect(200);

  const updated = vehicleSchema.parse(res.body);
  expect(updated.plate).toBe('XY9999');
  expect(updated.hasChildSeat).toBe(true);       // NOT reset to the schema default
  expect(updated.category).toBe('standard');
});
```

`:56` is `remove`'s `vehicle_not_found` throw — deleting a vehicle that is not there, also untested.
Lower value but one line. Deleting a *non-last* vehicle (driver must stay online) is uncovered too.

**M6 · The rider-role gateway test can pass for the wrong reason**
`services/api/src/features/drivers/location/driver-location.gateway.spec.ts:91-104`

The case emits from the rider socket, then from the driver socket, then waits only for
`recorded.length > 0` — which the *driver's* ping satisfies — and immediately asserts `recorded`
contains only the driver.

The two pings travel on two different TCP connections, so nothing guarantees the rider's frame has been
processed when the assertion runs. Delete the role check at line 47 and the test still passes on any
run where the driver's frame lands first. The spec itself shows the author knew the principle — the
very next case reasons *"Same socket, so ordering is guaranteed"* — it just was not applied here.

The clean fix is to stop asking a socket test to prove an absence across connections: assert the role
branch in a direct unit test of `DriverLocationGateway.handleLocation` with a stub socket whose
`data.user.role` is `'rider'`, asserting the store was never called, and keep the socket-level test for
the authenticated happy path. That is deterministic by construction.

**M7 · The socket outlives its JWT, and this PR is the first code to make an authorization decision from it**
`driver-location.gateway.ts:36-40, 46-47` ← `realtime.gateway.ts:61-81`

`client.data.user` is populated once, in the handshake middleware, and never re-verified —
`AuthTokenService.verify` runs at connect and nothing re-checks `exp` afterwards. `JWT_EXPIRES_IN`
defaults to `30d` (`env.schema.ts:11`) and there is no revocation list in the codebase yet, so a
continuously-connected socket keeps its `role: 'driver'` claim past token expiry or a role change.

**Inherited from #34, not introduced here**, and the practical exposure is small: a reconnect re-runs
the handshake and fails, and the worst a stale claim buys is writing your own position. It is listed
because this slice is the first thing to branch on `client.data.user.role` as an *authorization* check,
which turns a dormant property into a live one — and because the gateway comment currently reads *"It
is optional in the type even though the middleware guarantees it"*, which overstates what the
middleware guarantees over a socket's lifetime.

**Not a code change for this PR.** The ask is the comment correction plus a ticket for a periodic `exp`
re-check or a server-initiated disconnect on expiry.

### Low

| # | Where | What |
|---|---|---|
| L1 | `drivers.service.ts:92` | `driver.presence.changed` breaks the `verb + state` taxonomy every other event follows (`rooms_joined`, `send_failed`, and this PR's own `ping_ignored` / `forced_offline`). Suggest `status_changed`. No PII anywhere in the slice — notably no coordinates logged on the location path, which is right. |
| L2 | `driver-location.service.ts:78-87` | `findNearest`'s `radiusMeters` / `limit` overrides have **zero callers** — production, tests and the documented #10 seam all take the policy defaults. YAGNI; re-adding is one line. |
| L3 | `driver-location.gateway.spec.ts:11` | Deep import `../../auth/auth-token.service` reaches around `features/auth/index.ts`, which exports it. Low because this PR is *consistent with existing practice* — `realtime.gateway.spec.ts:16` and `redis-io.adapter.spec.ts:10` do the same. Fix all three in a separate tidy-up, not here. |
| L4 | `redis-driver-location.store.ts:66` | `eval` ships the Lua source on every ping; `defineCommand` gives EVALSHA with NOSCRIPT fallback. Noise at 9k pings/hour, but easier to change now than after #10 and #14 read this path. |
| L5 | `drivers.repository.ts:60-67` | `ON CONFLICT DO UPDATE SET user_id = user_id` is still an UPDATE — a dead tuple per `GET /drivers/me`, on the driver app's bootstrap call. The form is right for the *write* paths; `getMe` could `SELECT` first. |
| L6 | `redis-driver-location.store.ts:113-114` | `as string[]` / `as GeoSearchRow[]` are unchecked over ioredis's untyped replies; a shape change yields `{lat: NaN, lng: NaN}` typed as a `LatLng` that was never parsed. Mitigated by the contract spec running in CI. |
| L7 | `drivers.repository.ts:66, 90, 102` | `toProfile(row!)` on `.update().returning()` is a bare 500 if the WHERE matches nothing. Unreachable today (every caller runs `findOrCreate`; no delete path for `drivers`). A note, not a bug. |
| L8 | `drivers.service.ts:82-85` · `vehicles.service.ts:54-64` | TOCTOU: concurrent `DELETE last vehicle` + `PUT status=online` can leave a driver online with zero vehicles. T1 counts 1 and passes; T2 deletes, counts 0, reads status `offline`, returns early; T1 sets online. No transactions in the slice. Needs same-driver concurrency, self-heals on the next toggle, #10 filters anyway. |
| L9 | `env.DEFAULT_CITY_ID` consumers | If it ever changes, drivers under the old id are orphaned — `markOffline` targets the new keys and `drivers.status` stays `online`. Same shape as M3; a real `cityId` on the `drivers` row is the eventual answer. Note for #18. |
| L10 | `vehicles.repository.ts` / db schema | `vehicles.plate` has no unique index and no duplicate handling, so two drivers can register the same plate — the identity a rider matches at the kerb. Schema changes are an explicit Non-Goal, so: follow-up ticket, not a change request. |
| L11 | `vehicles.controller.ts:39-53` | A driver self-declares `category`, which is what puts a car into the `vip`/`limo` pricing tier, with no verification step. #20 owns driver approval and is an explicit Non-Goal here, so this is almost certainly a deferral — worth one line in the slice header saying so, rather than leaving it inferable. |

## What's good

- **The lat/lng transposition fixture** (`test/driver-location-store.contract.ts:19-55`). Choosing
  offsets so `east` and `north` *swap ranks* under a transposition turns the single hardest bug in geo
  code — one a round-trip test is structurally blind to — into a deterministic ordering assertion. The
  arithmetic in the comment checks out, and the report shows the claim was verified by mutating the
  store and watching exactly one case fail. Running that one fixture against both implementations is
  what makes the fake trustworthy for the rest of the suite; the fake's `atMs < freshSinceMs` matches
  Redis's inclusive `ZRANGEBYSCORE` lower bound and its post-filter `slice` matches the real store's
  break-after-limit.
- **The throwing-Proxy `DRIZZLE` provider** (`driver-location.service.spec.ts:19-26`). Turns an
  architectural constraint into a test that fails the day it is broken. Right shape.
- **The atomic Lua gate.** The correct fix for a real TOCTOU window, and the comment connects it to the
  same lesson learned in `auth.service.ts`'s cooldown claim — institutional memory applied, not
  restated.
- **Deliberately opposite write orders in `setPresence`.** Unusual enough to be suspicious, and it
  survives case analysis in every branch.
- **The privilege boundary defended twice**, with tests on both halves and a comment on each explaining
  why the other is not sufficient alone.
- **`@WebSocketGateway()` reuse is proven, not asserted** — `driver-location.gateway.spec.ts:66` is the
  one assertion that would catch a forked, unauthenticated second server, and the realtime-events
  reference was updated to codify the pattern for future slices.
- **The `:id`-route omission** in `drivers.controller.ts:15-19` — `@Get(':id')` would shadow
  `@Get('me')` under Express matching. Documented as a deliberate absence, the only way that survives
  the next person. Same instinct as `DRIVER_PRESENCE_STATUSES` being written out rather than filtered
  from `DRIVER_STATUSES`.
- **Slice hygiene.** `index.ts` states exactly what #10 may consume and why; files run 21–302 lines,
  well inside the ~500 limit; `DriverMatchAttributes` and `NearbyDriver` are correctly kept *out* of
  `packages/shared` with a stated justification, while the genuinely cross-surface schemas live there
  with their own tests; socket names come from `RT`; no `any`; `zod` is a direct dependency.
- **`services/api/CLAUDE.md`** gained three rules encoding this slice's invariants, and removing
  `vehicles` from the slice menu rather than annotating it is the right instinct.

## On the judgment call you flagged

You asked for a second opinion on requiring ≥1 vehicle to go online, and forcing offline when the last
one is deleted. **Keep it.** The rationale in the PR is sound — `auto_match` filters on `category` and
`hasChildSeat`, so a vehicle-less online driver is a candidate #10 can only ever discard — but the
better argument is about the driver: "you are online" and "you can be offered a ride" must not be able
to disagree, or the first bug report of the pilot is a driver sitting online for an hour wondering why
nothing arrives. M2 and L8 are holes *in* the rule, not arguments against it. If you ever do drop it,
M5's PATCH test is independent and should stay.

## Recommendation

**Request changes** — 0 Critical · 1 High · 7 Medium · 11 Low. None structural.

Before merge: **H1** (~10 lines, makes a documented invariant true), **M2** (three lines, closes a
reachable invariant break), **M4** and **M5** (three test cases against branches that ship untested
today, one of them the PR's own headline claim).

Same pass if convenient: **M1** (cheap, and M5's test pins it) and **M6** (the role check currently has
no deterministic proof).

**Decisions rather than patches — your call:** **M3** (disconnect handling has a multi-socket wrinkle,
and "state it as a known gap" is a legitimate answer at ≤10 drivers), **M7** (comment fix here, ticket
for the rest), **L10** (plate uniqueness needs a migration, an explicit Non-Goal), **L11** (vehicle
category verification is plausibly #20's). Everything else in Low is a note for #10/#18.

Next step: `piv-fix-review-findings` on H1 · M1 · M2 · M4 · M5 · M6, decide M3 and M7, re-run
`pnpm turbo run typecheck lint test build --force`, then merge.

---

## Disposition — the fix pass this review produced

Triaged 2026-08-05. Every finding got a decision; nothing was silently dropped.

### Fixed in this PR

| # | What changed | The test that pins it |
|---|---|---|
| **H1** | `handleLocation` wraps `ingest` in try/catch and logs `driver.location.ingest_failed`, with a comment stating why this is deliberately the *opposite* call from `findNearest`. | Two: a socket case asserting **no `exception` frame** and the socket stays up while `record` rejects, and a unit case asserting `handleLocation` **resolves** rather than rejecting. Both fail with the try/catch removed. |
| **M1** | `VehiclesRepository.update` replaced `.set(patch)` with the same explicit allowlist its sibling documents. | A repository-level case passing a rogue `{driverId, id}` **past zod** — the layer that would matter if `.omit()` ever changed. Fails against `.set(patch)`. |
| **M2** | `remove()` reads the profile **before** the delete and throws `driver_on_ride`. | Deleting while `on_ride` → 409 **and the vehicle survives**. Fails without the check. |
| **M4** | — (no code change; the branch was correct, just untested) | `PUT /drivers/me/status {"offline"}` end to end. Closed `drivers.service.ts` lines 87–88: **93.1% → 100% lines**. |
| **M5** | — (no code change) | PATCH success asserting `hasChildSeat`/`category` are **not** reset by an unrelated patch; delete-a-missing-vehicle → 404; delete a **non-last** vehicle → still online. `vehicles.service.ts` **92% → 100% lines**. |
| **M6** | Deleted the cross-connection socket test that could pass for the wrong reason. | Replaced with unit cases on `handleLocation`: rider-role → store never called, and no-claims → store never called. Deleting the role check now fails a test (it did not before). |
| **M7** | Comment only — the gateway no longer claims the middleware guarantees more than it does; it now says the JWT is verified **at connect** and points at #37. | n/a (comment) |
| **L1** | `driver.presence.changed` → `driver.presence.status_changed`, matching the verb+state taxonomy. | n/a |
| **L2** | Dropped `findNearest`'s unused `radiusMeters`/`limit` overrides. | Existing `findNearest` cases; no caller passed them. |
| **L11** | Documented in the slice header that `category` is self-declared and unverified until #20. | n/a |

### Deferred, with tickets

| # | Where it went |
|---|---|
| **M3** — ghost driver on disconnect | **#38**, plus a KNOWN GAPS block in `features/drivers/index.ts` spelling out the mitigating freshness filter and the multi-socket wrinkle. Accepted for a ≤10-driver pilot because dispatch cannot offer a ride to a ghost. |
| **M7** — socket outlives its JWT | **#37** (the `exp` re-check itself; the comment was fixed here). |
| **L10** — no unique index on `vehicles.plate` | **#39**. Needs a migration, an explicit Non-Goal of #8. Flagged there as the highest-value item of the batch. |
| **L3–L9** | **#39**, one section each. |

### Validation after the fixes

| Gate | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` | **pass — 18/18** |
| `@taxi/api` jest with `REDIS_TEST_URL` | **91 passed, 0 skipped, 13/13 suites** (was 82) |
| eslint | **0 errors**, the same 2 pre-existing warnings |
| Coverage, `features/drivers/**` | 95.21% → **97.25% stmts** · 72.22% → **73.57% branch**; every file the review named is now **100% lines** |
| Live smoke test | `/health` 200; `/drivers/me`, `PATCH`/`DELETE .../vehicles/:id` all **401** unauthenticated (guards fail-closed) |

Each of H1, M1, M2 and M6 was verified by mutation — reverting the fix makes its test fail — rather than by the test merely being green alongside it.

**Local gotcha worth recording:** the dev machine's docker Redis is on **6381**, not 6379 (6379/6380 are taken), so the opt-in suites need `REDIS_TEST_URL=redis://127.0.0.1:6381`. Port 8123 is held by an ssh tunnel that answers `/health` with a *different* service's payload — a smoke test pointed there looks like it passes.

---

### Method note

Combined coverage across the two passes is complete, but neither pass alone was: the `code-reviewer`
agent is read-only, so it ran nothing and did not read `services/api/CLAUDE.md` or the guards' source
(it inferred guard behaviour from the integration test's 403). This pass read both and ran everything —
the CI-parity gate, the Redis-enabled suite, the coverage run, and the H1 probe. The two agreed on
every load-bearing claim in the verification table and reached the same verdict independently.
