# Code review — PR #28 · `feat(shared): ride-loop contracts, socket catalog, money + commission config`

**Recommendation: REQUEST CHANGES** — 1 High, 3 Medium, 1 Low. Validation is fully green; the High is a
type-safety hole that green validation cannot see.

*(Posted as a comment rather than a formal review: GitHub rejects `--request-changes` from the PR author's
own account. The verdict above is the review's verdict.)*

## Summary

This is a strong contract PR. The package goes from 5 skeleton schemas to the full ride-loop surface, the
tests are real (44, each group carrying expected + edge + failure), and the design decisions that matter —
commission as config with no zod default, the inbound/outbound split on `driver:location`, deriving the
driver's net by subtraction, keeping `rideSchema` a plain `z.object` so `.omit()` survives for #6 — are all
correct and well argued in the code itself.

The findings below are all of one shape: **an invariant this PR states and enforces in one place, but does
not enforce in the parallel place a consumer will actually touch.** That matters more here than in ordinary
code, because this package's only job is to be right for #6, #7, #10, #11, #15, #20 and #27 — a gap here
becomes six downstream bugs, and every one of them typechecks.

Every finding below was reproduced by execution against the branch, not inferred. The five deviations in
`.claude/reports/shared-contracts-ride-loop-report.md` were read first and are treated as decisions; none of
the findings below is one of them.

---

## High

### 1. `ride:offer` is the only event whose declared type does not match what a consumer receives

`packages/shared/src/realtime-events.ts:78` · `packages/shared/src/realtime-events.ts:151`

Seven of the eight events declare wire-accurate timestamps (`z.string().datetime()` → `string`).
`ride:offer` alone is `rideOfferSchema`, whose `sentAt`/`expiresAt` are `z.coerce.date()` — so
`ServerToClientEvents[RT.rideOffer]` promises the consumer a `Date` on a payload that arrives as a `string`.

The rationale at `realtime-events.ts:74-77` is understood and correct **for a consumer that parses**:
`z.coerce.date()` does re-hydrate. The defect is the consumer that trusts the typed handler and does not
parse — which is the normal, type-safe-looking way to use `ServerToClientEvents`, and which the other seven
events make perfectly safe.

Reproduced on this branch:

```
expiresAt is Date on the producer side: true
after wire, typeof expiresAt: string "2026-08-03T10:00:20.000Z"
consumer calling .getTime() on the raw payload:
  RUNTIME: overWire.expiresAt.getTime is not a function
```

**Failure scenario.** #15's offer card counts down to `expiresAt`. `socket.on(RT.rideOffer, o => setRemaining(o.expiresAt.getTime() - Date.now()))`
typechecks — `RideOfferEvent.expiresAt` is `Date` — and throws `TypeError` on the first offer a driver
receives. The same line against any of the other seven events is a compile error, which is the protection
that is missing here.

**Fix — your call, because both options cost something.** Either (a) give the event its own wire shape,
`rideOfferSchema.extend({ sentAt: z.string().datetime(), expiresAt: z.string().datetime() })`, which makes
the type honest but breaks the stated "the offer contract IS the wire payload — one shape, no duplication"
goal and the doc row saying `ride:offer` *is* `rideOfferSchema`; or (b) keep one schema and make the parse
mandatory rather than optional, by declaring the handler payload as unparsed (`unknown`) so the only way to
read a field is `rideOfferEventSchema.parse(payload)`. (b) preserves the one-shape goal and localises the
change to a single line of the direction map; (a) gives consumers a typed payload without a parse.

One dead end worth saving you the attempt: **`z.input` does not solve this.** The instinct is to type the
map entry as `z.input<typeof rideOfferSchema>` so the pre-parse shape is a string — but verified against
zod 3.25.76 on this branch, `z.input<typeof rideOfferSchema>["expiresAt"]` is `Date`, not `string`
(`z.coerce.date()` declares its input as `Date`). It compiles and changes nothing.

Whichever you pick, the rule at `realtime-events.ts:9-15` and `.claude/references/realtime-events.md:3`
should say what `ride:offer` does.

---

## Medium

### 2. The dispatcher audit rule is enforced on the record but not on the event that carries it

`packages/shared/src/realtime-events.ts:91-97` (missing) vs `packages/shared/src/schemas/ride.ts:68-71` (present)

`rideAssignmentSchema` refines "a `dispatcher` assignment requires `dispatcherId`" and the PR body calls
that the force-assign audit trail (S9-2/S9-4). `rideAssignedEventSchema` carries the same two fields with no
refinement, so the identical payload that the record rejects, the wire accepts:

```
dispatcher event WITHOUT dispatcherId accepted? true   (dispatcherId → null)
```

**Failure scenario.** #10 emits `ride:assigned` with `source: "dispatcher"` and no `dispatcherId` — a bug,
a partial refactor, a hand-built payload in a test fixture. Nothing rejects it. Dispatch and admin (#20)
render an override with no actor, which is precisely the unauditable override the record schema exists to
prevent. A test asserts the record path (`schemas.test.ts:198`); nothing asserts the event path.

**Fix.** Same `.refine()` on `rideAssignedEventSchema`, plus the mirrored failure-case test. It is a leaf
wire schema, so the `ZodEffects`/`.omit()` concern documented for `rideSchema` does not apply.

### 3. Nothing ties `split` to the `quote` it splits — on the offer *or* the ride

`packages/shared/src/schemas/ride.ts:93-95` · `packages/shared/src/schemas/ride.ts:112-116`

The no-cent-leak refinement is good, but it only proves the split is internally consistent. It cannot see
the quote sitting next to it. An offer whose split was built from a stale or wrong quote parses clean:

```
offer with quote.totalCents=2000 and split.totalCents=500 PARSES
  -> the S2-5 transparency card reads: "€20.00 fare · you keep €4.25"
same drift on the settled rideSchema record PARSES: 2000 vs 500
```

This one is worth fixing because it attacks the PR's own central claim. S2-5 — the driver sees the real fare
*and* the real commission line — is the wedge, and these two numbers being about the same fare is the whole
content of that promise. The PR guards a one-cent leak inside the split at every parse boundary while a
€15.75 discrepancy between the two halves of the driver's card passes silently.

**Fix.** Mirror the pattern you already established one file over: export
`isOfferSplitConsistent(offer)` / `assertOfferSplitConsistent(offer)` (and the `rideSchema` equivalent,
where both fields are nullable) checking `quote.totalCents === split.totalCents`, called at the write and
emit boundaries in #10/#11. A predicate rather than `.refine()` for the same reason you documented for
`rideSchema` — it keeps `.omit()`/`.extend()` available for #6's insert shapes.

### 4. `splitFare` returns a value typed `FareSplit` that its own schema rejects

`packages/shared/src/commission.ts:70-80`

`splitFare` constructs and returns the object without parsing it, so the type is asserted rather than
verified. With a `pct` outside 0–100 the driver's net goes negative while TypeScript still calls it a
`FareSplit`:

```
splitFare(2000, { pct: 150, source: "driver_override" })
  → {"totalCents":2000,"commissionCents":3000,"driverNetCents":-1000}
  fareSplitSchema.safeParse(...) → false
```

**On reachability, plainly:** both schemas that can supply a `pct` today bound it to 0–100
(`driverProfileSchema.commissionPctOverride`, `platformConfigSchema.commissionPct`), so this is **not
reachable through them**. It is reachable through `CommissionDriverInput`, which is deliberately structural
(`commissionPctOverride?: number | null`) so that it accepts a raw row and so #27 can widen it — i.e. via a
#6 Drizzle row read straight from Postgres without a zod parse, an admin PATCH body that skips the schema,
or #27's widened loyalty input. That is a narrow door, but it is the exact door the interface was designed
to leave open, and the failure it produces is a driver paying the platform.

**Fix.** `return fareSplitSchema.parse({ ... })` — it runs once per offer, so the cost is nothing, and it
makes the returned type earned rather than asserted. Alternatively validate `pct` inside
`resolveCommissionPct` with `commissionPctSchema`. The invariant sweep at `commission.test.ts:50-65` should
then gain an out-of-range case; it currently sweeps only valid percentages.

---

## Low

### 5. Plan and report land in `.claude/`, but CLAUDE.md points at `.agent/`

`.claude/plans/shared-contracts-ride-loop.md` · `.claude/reports/shared-contracts-ride-loop-report.md`

CLAUDE.md's Workflow section says `plan-feature` writes `.agent/plans/<name>.md` and `execution-report`
writes `.agent/execution-reports/`. This PR commits 1,304 lines of process artifact to `.claude/plans/` and
`.claude/reports/` instead.

To be clear about who is wrong here: **the PR is right and CLAUDE.md is stale.** `.agent/` exists but is
empty and untracked, while `.claude/` is where this repo actually keeps its references and skills — so
`.claude/plans/` is the consistent choice. The finding is that CLAUDE.md still points at `.agent/`, and this
is the PR that makes the drift visible. Two lines in CLAUDE.md closes it. Flagging only because it is not
among the report's five deviations, so it would otherwise pass unnoticed.

Separate judgement call for you, not a defect: whether a 1,104-line plan file belongs in the repo
permanently once #2 closes.

---

## Validation

Run on the branch at `8792634`.

| Gate | Result |
|---|---|
| `pnpm check` | **12/12 tasks successful** — but `FULL TURBO`, i.e. all 12 replayed from cache, not executed |
| `pnpm --filter @taxi/shared test` | **44 passed / 6 files**, executed fresh (575ms) |
| `pnpm --filter @taxi/shared build` | clean, executed fresh (`tsc -p tsconfig.build.json`) |
| Working tree | clean; branch = 1 commit ahead of `main` |
| Dependencies | `packages/shared/package.json` unchanged — no new dependency |
| Largest file | `realtime-events.ts` at 156 lines (limit ~500) |

The PR body's validation table is accurate. Nothing in it is overstated, and the two self-caught gaps it
reports (the unasserted `discountCents` sign, and Level 4b's `grep && FAILED || OK` reading a grep *error*
as a pass) are exactly the kind of thing that usually goes unmentioned.

## What's genuinely good

- **Commission as config, with the test that enforces it.** `commissionPct` carrying no zod default, plus
  `platform-config.test.ts:30-39` asserting the *absence* of a default with a comment explaining that a
  future edit to that test means someone re-introduced the constant. That is the rare test that guards a
  decision rather than a behaviour.
- **Deriving the net by subtraction** (`commission.ts:78`) instead of a second `Math.round`. The
  40-case sweep proves it, but the design is what makes it true.
- **The `driver:location` inbound/outbound split**, and the test at `realtime-events.test.ts:32-35` proving
  a client-supplied `driverId` is stripped. Correctly identified as a security boundary rather than tidiness.
- **`rideSchema` staying a plain `z.object`** with the drift guard as an exported predicate — verified
  empirically against zod's `ZodEffects` behaviour *before* writing the code, with the reasoning recorded in
  the file where the next person will read it. `schemas.test.ts:233` then pins it so a future `.refine()`
  breaks a test rather than #6.
- **`resolveCommissionPct` using `!= null`**, with a test for the 0% override specifically. The truthiness
  bug would have silently billed Atis 15%.
- Comments throughout explain *why* and cite the evidence (S2-5, S6-7, S9-2), not what the code already says.

## Recommendation

**Request changes.** Finding 1 should be resolved before merge — it is a contract that hands #7 and #15 a
type they cannot trust, and it ships silently because every gate passes. Findings 2–4 are each a small,
contained addition (one refinement, one predicate pair, one `.parse`), and 2 and 3 both want a mirrored test.
Finding 5 is a one-line call.

Nothing here suggests a wrong approach — the architecture is sound and the reasoning is unusually well
recorded. These are gaps between an invariant and its second enforcement point, which is the failure mode a
pure contract package is most exposed to.
