# Implementation Report — Ride-loop contracts, socket catalog, geozone/queue types, money + platform config (`@taxi/shared`)

**Plan**: `.claude/plans/shared-contracts-ride-loop.md`
**Branch**: `feature/shared-contracts-ride-loop`
**Status**: COMPLETE
**Implements**: [#2](https://github.com/linardsb/taxi/issues/2) — the PR body must say `Closes #2`.

## Summary

`packages/shared` goes from a ride *request* + ride *record* to the full MVP ride-loop contract surface. Added the
offer and assignment contracts, the fare-split contract (full fare + explicit commission line — the driver-transparency
wedge), the platform-config row with `resolveCommissionPct()`/`splitFare()`, geozone queue types, integer-cent
primitives, and an 8-event zod socket catalog with room helpers and Socket.IO direction maps. No app or service code
was touched; no dependency was added. The dependency order `enums → money → platform-config → commission →
schemas/{geo,driver,ride} → realtime-events` is cycle-free and readable top-to-bottom in `index.ts`.

## Tasks completed

All 14 plan tasks, in order.

| # | Task | File | Action |
|---|---|---|---|
| 1 | 4 new const tuples (`RIGA_PILOT_DISTRICTS`, `OFFER_STATUSES`, `ASSIGNMENT_SOURCES`, `COMMISSION_SOURCES`) | `packages/shared/src/enums.ts` | UPDATE |
| 2 | Integer-cent primitives + `commissionCentsFor` | `packages/shared/src/money.ts` | CREATE |
| 3 | `platformConfigSchema` / `PlatformConfig` | `packages/shared/src/schemas/platform-config.ts` | CREATE |
| 4 | `resolveCommissionPct`, `fareSplitSchema`, `splitFare` | `packages/shared/src/commission.ts` | CREATE |
| 5 | `commissionPctOverride`, `balanceCents` → `centsSchema` | `packages/shared/src/schemas/driver.ts` | UPDATE |
| 5 | geozone `slug`, `queueEntrySchema`, `geozoneQueueSchema` | `packages/shared/src/schemas/geo.ts` | UPDATE |
| 6 | `fareQuoteSchema` → money primitives; `rideAssignmentSchema`, `rideOfferSchema` | `packages/shared/src/schemas/ride.ts` | UPDATE |
| 7 | `rideSchema` + `geozoneId`/`assignment`/`split`; consistency predicate + assert | `packages/shared/src/schemas/ride.ts` | UPDATE |
| 8 | 8-event zod catalog, room helpers, direction maps | `packages/shared/src/realtime-events.ts` | UPDATE (rewrite) |
| 9 | Barrel exports in dependency order | `packages/shared/src/index.ts` | UPDATE |
| 10 | Cent-primitive tests | `packages/shared/tests/money.test.ts` | CREATE |
| 11 | Config-not-constant gate; resolver/split/sweep tests | `packages/shared/tests/platform-config.test.ts`, `tests/commission.test.ts` | CREATE |
| 12 | Socket payload + catalog tests; offer/assignment/ride/geozone describes | `packages/shared/tests/realtime-events.test.ts`, `tests/schemas.test.ts` | CREATE / UPDATE |
| 13 | Regenerated 8-event table + room/security rules | `.claude/references/realtime-events.md` | UPDATE |
| 14 | All five validation levels | — | — |

## Tests added

31 new tests across 4 new files + extensions to `tests/schemas.test.ts` (13 → 44 total, all passing). Every schema
group ships ≥1 expected + 1 edge + 1 failure case, per the repo rule.

| File | Tests | Covers |
|---|---|---|
| `tests/money.test.ts` | 3 | signed/unsigned cents, zero cases, **floats rejected**, pct out of range |
| `tests/platform-config.test.ts` | 4 | defaults applied, `commissionPct: 0` (S6-7), `{}` rejected, **missing `commissionPct` rejected with the issue path** |
| `tests/commission.test.ts` | 6 | base 15% split, **`0` override beats base**, half-cent rounding (333 → 50+283), **invariant sweep 8 totals × 5 pcts = 40 cases**, non-summing split rejected |
| `tests/realtime-events.test.ts` | 5 | location/status payloads, **inbound ping drops client `driverId`**, room helpers, bad lat + bad timestamp, **`RT` has exactly the 8 wired `domain:action` events** |
| `tests/schemas.test.ts` (extended) | 20 total in file | offer (full / queue-sourced / `queuePosition: 0` / **positive `discountCents` rejected**), assignment (auto / dispatcher+audit / **dispatcher without `dispatcherId`**), ride (null defaults / `.omit()` still composable / **assert throws on driver drift**), geozone + queue (slug, 2-entry queue, `position: 0`) |

**AC #1's "`fareQuoteSchema` semantically unchanged" is now asserted, not just claimed.** The five Task 6a
substitutions were type-identical by inspection, but nothing exercised them — in particular `discountCents`
(`z.number().int().nonpositive().default(0)` → `nonPositiveCentsSchema.default(0)`), where a slip to
`nonNegativeCentsSchema` would have passed every gate and surfaced in #11 as a discount that *adds* to the fare.
Two assertions close it: the default still resolves to `0`, and a positive discount is rejected. Confirmed against
the build that the rejection lands on the right path and that negatives still parse:

```
positive discount accepted? false
rejected on path: ["breakdown.discountCents"]
negative discount accepted? true
```

## Validation results

Every command below was actually run; output is verbatim.

**Level 1 — syntax & style**
```
pnpm --filter @taxi/shared typecheck   →  tsc --noEmit, clean (strict + noUncheckedIndexedAccess)
pnpm turbo run lint                     →  green (included in `pnpm check` below)
```

**Level 2 — unit tests**
```
 ✓ tests/ride-state-machine.test.ts (6 tests)    ✓ tests/money.test.ts (3 tests)
 ✓ tests/platform-config.test.ts (4 tests)       ✓ tests/commission.test.ts (6 tests)
 ✓ tests/realtime-events.test.ts (5 tests)       ✓ tests/schemas.test.ts (20 tests)
 Test Files  6 passed (6)          Tests  44 passed (44)
```

**Level 3 — integration / build**
```
pnpm check                            →  Tasks: 12 successful, 12 total   (baseline 12/12 — no regression)
pnpm turbo run typecheck lint test build →  Tasks: 15 successful, 15 total  (exactly what CI runs)
```

**Level 4a — doc/catalog sync (AC #3)**
```
OK: 8 events documented
```

**Level 4b — no contract declared outside `@taxi/shared` (AC #2)**
```
GATE OK
```
The gate's `grep … && FAILED || OK` construct returns non-zero for *both* "no match" and "grep errored", so a broken
invocation would read as a pass (this actually bit an orientation command earlier — unquoted `--include=*.ts` is
glob-expanded by zsh). Positive control, proving grep can read those trees and the gate is a real negative:
```
grep -rEn '^(export )?(interface|type|const) ' apps services --include='*.ts' --include='*.tsx' | wc -l
     628
```

**Level 4c — commission is config, not a constant**
```
OK: no bare 15 in shared src code
```

**Level 4d — public surface smoke test**
```
OK: all 22 contracts exported
```

**Level 4e — sanity-read the split (the driver pitch)**
```
{
  currency: 'EUR',
  totalCents: 2000,
  commissionPct: 15,
  commissionSource: 'platform_base',
  commissionCents: 300,
  driverNetCents: 1700
}
```
→ "€20.00 fare · €3.00 commission · **you keep €17.00**".

**Level 5 — optional**
```
155 packages/shared/src/realtime-events.ts     ← largest file, well under the 500-line rule
143 packages/shared/src/schemas/ride.ts
 89 packages/shared/src/ride-state-machine.ts
 80 packages/shared/src/commission.ts
 65 packages/shared/src/schemas/geo.ts

no src → tests import: OK
packages/shared/package.json: unchanged (no new dependency)
```

## Deviations from the plan

Five, all intentional — a reviewer should read these as decisions, not accidents.

1. **Direction maps are `interface ClientToServerEvents` / `ServerToClientEvents`, not `CLIENT_TO_SERVER_EVENTS` /
   `SERVER_TO_CLIENT_EVENTS` consts.** The plan contradicts itself: Task 8's code block (the normative spec) writes
   interfaces; the Solution Statement and Forward-references name SCREAMING_CASE consts. Followed the code block —
   Socket.IO's `Server<ClientToServerEvents, ServerToClientEvents>` generics take *types*, and a runtime const would
   not satisfy them. Consequence for #7: import the two interfaces directly. Corollary: because interfaces have no
   runtime keys, the Task 12 completeness assertion is the hand-listed array vs `Object.values(RT)` the plan
   prescribed, not a reflection over the maps.

2. **`RideOfferEvent` and `RideStatusEvent` keep their names but change shape.** `RideOfferEvent` is now
   `z.infer<typeof rideOfferSchema>` (was a 4-field interface with `pickupAddress`); `RideStatusEvent` gains
   `orderId`, `previousStatus`, `reason`. Plan-sanctioned ("keep the three existing exported type names alive as
   `z.infer` types"). Verified no consumer outside `packages/shared` referenced either type.

3. **Kept `offerTimeoutSeconds`, `unclaimedAlertSeconds`, `defaultDispatchMode` in `platformConfigSchema`** —
   plan Assumption 2, whose stated default is "keep". Contracts written in this same ticket (`rideOfferSchema
   .expiresAt`, `dispatch:unclaimed`) are meaningless without them. Deleting the three fields breaks nothing else
   if vetoed.

4. **Exported a `z.infer` type alias for every new schema**, including several the plan's code blocks omitted:
   `FareSplit`, `PlatformConfig`, `QueueEntry`, `GeozoneQueue`, `RideOffer`, `RideAssignment`, `DriverLocationPing`
   (referenced by `ClientToServerEvents` but never listed for export), and each event payload type. Purely additive;
   Level 4d only probes runtime values, so a missing type export would have passed every gate and broken #7.

5. **Added a comment in `realtime-events.ts` requiring `RT` to stay the file's first `as const` block.** The Task 13
   sync script slices `src.indexOf("export const RT")` → `src.indexOf("} as const")`, and the second `indexOf`
   searches from position 0 — any `as const` block above `RT` inverts the slice to empty and silently fails AC #3.
   The comment pins the ordering the script depends on, and points at the durable rule in
   `.claude/references/realtime-events.md` rather than at the plan file (which gets archived when #2 closes).

Minor, within plan spirit: `tests/money.test.ts` also covers `nonPositiveCentsSchema` and a negative percent;
`tests/commission.test.ts` also asserts an entirely absent `commissionPctOverride` resolves to `platform_base`;
`tests/schemas.test.ts` adds the two `discountCents` assertions described above.

## Issues encountered

None that changed the design. Three plan-flagged TypeScript risks were probed empirically against zod 3.25.76 /
TS 5.7 **before** writing any implementation code, in a throwaway file under `packages/shared/tests/` (deleted after):

- `[...DISPATCH_MODES, "dispatcher"] as const` **preserves tupleness** — `z.enum()` accepts it, no literal fallback
  needed (Task 1's fallback was not required).
- **Computed interface keys** from an `as const` object (`[RT.driverLocation]: …`) typecheck fine — Task 8's
  literal-string fallback was not required.
- `.refine()` → `ZodEffects` **does** lose `.omit()` (a `@ts-expect-error` on `refined.omit()` was consumed, i.e. the
  error is real), while nesting `refined.nullable().default(null)` inside a `z.object()` works. This confirms Task 7's
  central decision: `rideSchema` stays a plain `z.object` with the driver-consistency rule as an exported
  predicate/assert pair, so #6 can still derive Drizzle insert shapes.

One orientation command in the plan's Level 4b style failed under zsh (unquoted `--include=*.ts` is glob-expanded);
re-ran with the globs quoted and confirmed **no file outside `packages/shared` references any shape this ticket
changes** — the only consumers of `geozoneSchema`, `fareQuoteSchema` and the three event types are inside the package.

## Ready for the next step

All 14 tasks are complete, all acceptance criteria met, and every validation level passes with no regression
(12/12 `pnpm check`, 15/15 CI command). Next: `piv-commit`, then `piv-create-pr` (body must contain `Closes #2`),
then `piv-review-pr`.
