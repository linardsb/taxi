# PR #121 review — zone/queue grid, cascade visibility, one shared explanation (#19 Phase C)

**Head** `d607043` · **Base** `feature/dispatch-override-phone-orders` @ `ced2d30` (PR #120, stacked) · 37 files, +2467/−237
**Reviewed against** root `CLAUDE.md`, `apps/dispatch/CLAUDE.md`, `services/api/CLAUDE.md`, `packages/shared/CLAUDE.md`, `.claude/references/{realtime-events,dispatch-strategies,ride-state-machine,logging-standard}.md`, the plan (Tasks C1–C7) and the implementation report (D1–D10, treated as intentional decisions).

**Recommendation: request changes.** Two High, five Medium, six Low. No Critical, and **no hard-rule violation** — money, `assertTransition`, payment-method locking, the seam interfaces, contract location and the one-way `shared` dependency are all untouched and intact. Validation is green and every figure in the PR body reproduces.

The wire design is the strongest part of this PR and none of the findings argue with it. The frame carries the honest, complete shape: every configured zone, offline drivers included, "never offered" distinct from "offered and lapsed". Both High findings are in the same thin layer — `cascade.ts` reads that honest data through two lookups that each answer a slightly different question than the one asked. Both of this PR's headline promises (*whose turn is it*, *why this driver*) are wrong in one case each.

---

## Validation

`observed` — my own run, worktree `/Users/Berzins/Desktop/taxi-zones` at `d607043`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **18/18 tasks, exit 0, 54.0 s**.

| Package | PR body claims | I observed |
|---|---|---|
| `@taxi/api` test | 541 passed, 0 skipped, 59/59 suites | **identical** |
| `@taxi/shared` test | 181 passed (20 files) | **identical** |
| `@taxi/dispatch` test | 158 passed (21 files) | **identical** |
| `@taxi/db` test | 17 passed (3 files) | **identical** |
| typecheck · lint · build | clean | **clean** |

Zero skips reproduced, so the Redis-gated `redis-dispatch-queue.store.spec.ts` genuinely executed C1's `MULTI`/`HSETNX`/`HGETALL` against a real Redis — which is the run that matters for this diff. Neither intermittent failure the PR body reports recurred. GitHub Actions was still pending at review time.

The gate does not block this PR, and could not have found either High. H1's blind spot is a single-zone fixture; H2's is that no test compares the projection against the engine's real candidate rule.

---

## High

### H1 · The cascade explains the wrong zone when a driver sits in more than one rank
`services/api/src/features/dispatch/board/cascade.ts:97-102`, consumed at `:75` and `:84`

```ts
function zoneHolding(zones, driverId) {
  return zones.find((z) => z.entries.some((e) => e.driverId === driverId));
}
```

`zones` is `zoneRows`, built from the catalog in `listForCity` order — `geozones.repository.ts:88` sorts by `name`. So this returns whichever zone the holder is queued in that sorts **first alphabetically**, not the zone the ride was dispatched from.

Multi-zone membership is the steady state, not an edge case. `GeozoneQueueStrategy` lazy-enrolls every eligible candidate into whatever zone *the ride's pickup* falls in (`geozone-queue.strategy.ts:57-69`), and nothing in production calls `DispatchQueueStore.leave()` — the PR body flags that itself. A driver working near a boundary accumulates memberships across a shift.

**Failure scenario**, with the Rīga seed (`db/src/seed/riga.ts`: Lidosta RIX, Rīgas autoosta, Rīgas centrs, Vecrīga — `Lidosta RIX` sorts first): Jānis is #1 in **Rīgas centrs**, 47 minutes waited, and also sits somewhere in **Lidosta RIX** after picking up an airport job three minutes ago. A Centrs ride is offered to him. `zoneHolding` returns Lidosta, so the strip renders «Lidosta RIX rinda #… · zonā 3 min» — wrong zone name and wrong tenure — and `nextInQueue` then walks **Lidosta's** rank to name who is next. The whole sentence describes a queue that has nothing to do with this ride.

`board.service.spec.ts:381-420` cannot catch it: the fixture catalog holds exactly one zone. Neither can `cascade.spec.ts` — same shape.

**Fix** (no extra query): `rides.geozoneId` already exists on the row (`db/src/schema/rides.ts:56`) and `findBoardRides` already selects it; it is simply not projected onto `BoardRide` (`rides.repository.ts:60-68`). Add it, pass a `rideId → geozoneId` map into `BuildCascadesInput`, and resolve the holder's zone **by id**, falling back to `undefined` rather than to a scan when the ride carries no stamped zone. Regression case: a holder queued in two zones, offered a ride in the second.

### H2 · «Nākamais» names drivers the engine will never offer to
`services/api/src/features/dispatch/board/cascade.ts:114-120`

```ts
if (!zone?.queueModeEnabled) return null;
return zone.entries.find((e) => !tried.has(e.driverId))?.name ?? null;
```

`zone.entries` is the queue snapshot, which **deliberately** includes drivers who are offline — D5's whole justification, restated in the wire schema: *"A driver who has gone offline while holding position 1 still appears, with `status: 'offline'`, because that is precisely the thing Dina needs to see and resolve."*

The engine's candidate set is a different set. `GeozoneQueueStrategy.findCandidates` starts from `this.locations.findNearest(...)` — the Redis **online** set with a live position — then filters through `toCandidates`, which requires `status === 'online'` (`candidate-filter.ts:30`) plus category, child-seat, female-driver and debt-limit checks; `offerNext` additionally skips drivers already holding a live card (`dispatch.service.ts:106`). A queued driver who is offline is never a candidate.

**Failure scenario**: Lidosta RIX rank = [Jānis `offline`, position 1], [Anna `online`, position 2]. Jānis stays ranked indefinitely because nothing calls `leave()`. The ride is offered to Anna; `tried = {Anna}`; `nextInQueue` returns **Jānis**. Dina reads «nākamais: Jānis» and lets the cascade run. Anna's offer lapses, `findCandidates` re-runs, Jānis is not in `findNearest`, and the ride goes to someone else or to nobody. She waited on a name the engine had already excluded — on the strip built so that "dispatchers override confidently only when they can see the logic". `on_ride` is the same shape and more common at pilot scale.

The entry already carries the field: `status: z.enum(DRIVER_STATUSES)` on every zone entry. And the function's own docblock at `:104-113` refuses to name anyone under auto-match because *"any name here would be a guess dressed as the engine's intent"* — the same argument applies inside queue mode, where the guess is currently made.

**Fix**: at minimum `zone.entries.find((e) => e.status === 'online' && !tried.has(e.driverId))`. That narrows it without closing it — proximity, eligibility and the busy-set still are not modelled — so pair it with a docblock saying plainly that this is a heuristic over the rank, not a replay of `findCandidates`. Or return `null` and let the strip say nothing, consistent with the auto-match branch. Add a `cascade.spec.ts` case with an offline driver ahead of an online one; the existing "tried-driver skip" proves only the `tried` half.

Worth deciding in the same edit, one line either way: at `attempts >= MAX_OFFER_ATTEMPTS` there is no next driver at all — `offerNext` returns without offering (`dispatch.service.ts:61-68`). The strip still names one.

*(This is not the inherited #120 H3, which is about what `countAttempts` counts. This is a set-membership mismatch introduced by C4.)*

---

## Medium

**M1 · The "byte-identical rank" guarantee is false** — `cascade.ts:26-35` claims that taking the already-built zone rows means *"the rank in the explanation is byte-identical to the rank in the grid beside it … no way for the two panels to disagree about who is where."* Only `secondsInZone` comes from the zone rows (`:90`). The rank handed to `explainAssignment` is `pending.queuePosition` (`:89`) — the position **stamped on the offer row** when the offer was written. A `sendToBack` of anyone ahead of the holder between offer-write and frame-build shifts the live grid rank while the offer row keeps the old number: the grid says #2 and the sentence beside it says #3. **Fix**: either read the rank from `holderEntry?.position ?? pending.queuePosition` (and say why the fallback exists), or amend the docblock to claim only what holds — the *tenure* is the grid's, the *rank* is deliberately the number the driver was actually shown. Per the root rule the sentence is a claim, not decoration, and it is currently load-bearing for a reader deciding whether the two panels can drift.

**M2 · `cascade.spec.ts:119-128` asserts on a row the runtime cannot produce** — the case builds `offer({ source: 'dispatcher', queuePosition: null })`, inheriting `status: 'pending'` from the fixture default (`:16`). There are two production `insertOffer` call sites: `dispatch.service.ts:148` (source is always `auto_match`/`geozone_queue`) and `force-assign.service.ts:115`, which writes `status: 'accepted'`. No `(dispatcher, pending)` row exists, and `cascadeFor` reaches `explainAssignment` only via the *pending* offer — so `explain.dispatcher` can never render on the board. Same defect class as #120's keyboard test firing on the wrong node. **Fix**: rebuild as `offer({ source: 'dispatcher', status: 'accepted' })` and assert what the projection actually yields (no holder, `attempts: 1`, `explanation: null`). If a dispatcher override *should* be explained on the board, that is a projection change, not a test change — and note `CASCADE_STATUSES` (`ride-queue.tsx:61`) would not draw it on an `accepted` ride anyway. The `explain.dispatcher` catalog key stays justified for #15's driver app; it is only unreachable from here.

**M3 · The position announcement rests on `aria-label` on a roleless `<span>`, and its test cannot tell whether it works** — `zone-grid.tsx:74-87`. Three places state that this announces «Vieta rindā 1» rather than a bare "1": the docblock at `:38-40` (*"the a11y bar here is the rider app's"*), the test at `zone-grid.test.tsx:109-118` (named *"announces the position rather than reading out a bare digit"*), and AC #14.

What is **certain**: the test cannot distinguish working from broken. `screen.getByLabelText` matches the `aria-label` *attribute*, not the accessibility tree, so it is green for any element carrying that attribute regardless of role — the shape #120's review found at `assign-dialog.test.tsx:114`. Nothing in this diff verifies the guarantee it states three times.

What is **not verified here**: whether the name reaches AT. ARIA 1.2 puts role `generic` (which a bare `<span>` maps to) in the name-prohibited set, so exposure is not guaranteed — but browser and screen-reader behaviour varies and **I did not open a browser**. This review has no observation either way. Note the plan's Task C5 said to *"copy the `role="img" aria-label` status dot"*; the dot at `:63-65` has the role, the number does not, so the codebase's own pattern was half-applied.

**Fix**: sidestep the `generic` question rather than settling it — a visually-hidden text node carrying the full sentence with the digit `aria-hidden`, which needs no role and no assumption. Then assert against the accessibility tree (`getByRole` / `toHaveAccessibleName`) so the test checks the property its name claims. Same file, same caveat: `<ol style={{ listStyle: 'none' }}>` at `:159-167` — Safari + VoiceOver dropping list semantics under `list-style: none` is well documented and `role="list"` is the standard mitigation, likewise unverified here; cheap insurance on an element whose ordering *is* its content.

**M4 · `console.zone_empty` renders two different facts, and `console.zone_none` is orphaned** — `zone-grid.tsx:156` uses «(tukšs)» for *"nobody is in this rank"*; `:206` uses the **same key** for *"the city has no configured zones at all"*. Those are different facts with different responses (send a car / call whoever configures zones), and a standalone paragraph reading "(tukšs)" is a parenthetical, not a message. `zone-grid.test.tsx:121-128` names that case *"renders a message, not an empty table"* and then asserts the non-message. This diff's own `cascade.ts:34` states the principle being broken: *"'Never offered' and 'offered and lapsed' are different facts and must not render the same."* Separately, `console.zone_none` («Ārpus zonām») lost its only consumer when `zones-panel.tsx` was deleted and survives in all three catalogs with zero callers. **Fix**: a distinct key (`console.zone_none_configured`) across LV/RU/EN; retire `console.zone_none` or say in the PR body which follow-up keeps it.

**M5 · The gated-skip figure in `CLAUDE.md:43` drifts again, and this PR is silent about it** — the file says a `REDIS_TEST_URL`-less gate is *"24 tests short — spread over 4 gated spec files, 2 of which hold nothing else"*. `observed`, my run at this head with the variable unset: **33 skipped, 2 skipped suites, 59 total**. #120's review already moved the true figure 24 → 28; this PR's 5 new gated contract cases move it 28 → **33**. The file count (4) and skipped-suite count (2) still hold. The PR body correctly reports its own zero-skip run and never mentions that the same diff changes what a non-Redis gate looks like. **Fix**: 24 → 33, provenance re-anchored to this head.

---

## Low

- **L1 · `isMessageKey` walks the prototype chain** — `i18n.ts:430-432` is `key in MESSAGES.lv`, so `'toString'`, `'constructor'` and `'valueOf'` all pass. `formatMessage` then reaches a function and `.replace` throws — precisely the outage the docblock at `:417-429` says this guard prevents, reached by a different input. Only `explainAssignment` produces these keys, so it needs an api bug rather than an attacker. One-word fix: `Object.hasOwn(MESSAGES.lv, key)`.
- **L2 · `≤500 rows/frame` is labelled a worst case and is not one** — `BOARD_RIDES_LIMIT = 100` ✓ and `MAX_OFFER_ATTEMPTS = 5` ✓ both check out, but `MAX_OFFER_ATTEMPTS` gates only `offerNext`. `force-assign.service.ts:115` inserts an offer row with no attempts check, and `ReassignService` routes through it, so rows-per-ride is `5 + (dispatcher overrides)`. Restate as `≤ 500 + Σ overrides`, or keep 500 and label it "auto-cascade only". **This figure is in the PR body as well as the report** — per the root rule the PR body is the most-read surface and the only one not in the working tree.
- **L3 · `snapshot()`'s docblock states `≤6 zones per frame` flatly** (`redis-dispatch-queue.store.ts:118-124`). Nothing enforces it: `geozones.repository.ts:78-89` has no `LIMIT` and zones are admin-creatable. `board.service.ts:104` hedges the same figure correctly (*"at pilot scale"*); the store's copy should match. The Rīga seed has **4**, so the number is conservative today — it just needs its condition attached.
- **L4 · The countdown has no clock-skew reference** — `cascade-strip.tsx:24-29` compares the operator's `Date.now()` (`use-board.ts:98`, `:188`) against the server's `expiresAt`. A console a minute fast pins every countdown at `0`; a minute slow inflates them. The docblock's "≤2 s behind" covers cadence, not skew. Not new in kind (`ride-queue.tsx:64-72` does the same for ride age and predates this PR), but `board-state.ts:82-92` already establishes `frame.at` as the skew-free reference, so the fix is available. A stuck-at-0 countdown is indistinguishable from a lapsed offer.
- **L5 · The join-timestamp hash is pruned by nothing and has no TTL** — `dispatch.policy.ts:62-63`. With no production caller for `leave()`, `dispatch:queue:<zone>` never shrinks and `:joined` inherits the property. The report acknowledges this, so it is a documented gap rather than an undocumented divergence, but two consequences are new: zone entries (and so `findBoardContacts`' id list) grow with the *historical* fleet rather than the online one, and each frame now persists those drivers' phone numbers to `localStorage` via `persistFrame` (`use-board.ts:42-48`). The key is session-scoped and dropped by `clearSession()`, so #18's PII rule still holds — the note is about durability, not policy. Redis has no `maxmemory-policy` set anywhere in the repo, so `noeviction` applies and the list and its hash cannot be evicted independently; that hazard appears the moment a policy is set.
- **L6 · Two smaller notes.** The "ONE query" test (`board.service.spec.ts:422-435`) asserts one call to the repository *method*, not one SQL round trip — adequate as a proxy given the method body, but it proves one level less than the PR body says. And `findOffersForRides` is awaited outside the frame's fan-out (`board.service.ts:135`) though it depends only on `rides`, which resolved at `:99` — five serial stages on a 2 s loop where four would do.

---

## Claims audit

Every figure in the PR body was re-derived rather than read.

**Verified true** (`observed` unless noted):

- All four test counts and the zero-skip claim — reproduced exactly.
- The reconciliation arithmetic, every branch: api `(5 × 2) + 7 + 7 + 7 = 31` → 541 − 31 = 510 ✓; shared `10 + 4 = 14` → 181 − 14 = 167 ✓; dispatch `6 + 6 + 2 − 3 = 11` → 158 − 11 = 147 ✓; db 17 ✓. The one input nothing else corroborated — *"3 retired with `zones-panel.test.tsx`"* — is **3** (`git show ced2d30:…/zones-panel.test.tsx` → three `it(` blocks). Suite counts reconcile too: 59 − 2 new spec files = 57 ✓.
- Key counts: **11** distinct `console.*` and **4** distinct `explain.*`, each present in LV/RU/EN (33 and 12 added lines; parity is compiler-enforced by `satisfies Record<Language, Record<MessageKey, string>>` and typecheck is green).
- `zone-grid.tsx` at **252** lines is the largest new shipped file; every new file is under the 500 cap; **no `max-lines` disable** and in fact no `eslint-disable` of any kind in the diff.
- The query-count table: `findOffersForRides` is one `select … where inArray(...)` with an empty-list early return, `listForCity` is one `select`, so `2 + N` → `4 + N` holds line by line, and `2 × 30 = 60` queries/min follows. The Redis side is `1 + 2Z`, bounded by the catalog rather than the fleet, exactly as C4 required.
- `.claude/references/realtime-events.md:13` was genuinely updated to describe what the frame now carries.
- No closing keyword, matching #120 and the stated Phase-C-of-three intent (`closingIssuesReferences` empty ✓).

**The PR body's candour holds up.** "Frame size was NOT measured" and "Manual validation was NOT run" are stated as gaps rather than dressed as results; the deltas are labelled `derived` against an inherited-but-corroborated baseline with the inheritance named; the one red run is reported rather than re-rolled. That is the provenance rule applied correctly, and it is why the claims audit here is short.

**Three claims need correction or a condition** — M1 (the "byte-identical rank" guarantee, which is false rather than imprecise), L2 (`≤500` is not a worst case) and L3 (`≤6 zones` is unenforced). Only M1 is load-bearing.

**One figure elsewhere is now stale because of this diff** — `CLAUDE.md:43`, see M5.

---

## What is good

- **`snapshotFrom()` as one shared function, for the stated reason.** The docblock names the failure it prevents: a rule written twice can pass a contract that compares each implementation only against the fixture and never against the other. The duplicate-driver rule (first occurrence wins, everyone behind still counts the duplicate) means Dina's screen and the driver's phone cannot show different ranks, and the contract runs against both stores.
- **The two queue stores genuinely agree.** `HSETNX` in `joinBack` vs `HSET` in `sendToBack` is correct and correctly mirrored (`in-memory-dispatch-queue.store.ts:43-45`, `:58-59`). The `RPUSH`+`HSETNX` pair sits in one `MULTI`, so the torn-write case the docblock describes is genuinely unreachable rather than merely unlikely, and no path produces a stamp without a list entry.
- **`joinedAt: string | null` with null meaning *legacy*, not defensive padding.** Back-filling would claim a 40-minute wait had just started; the store never manufactures the case. A migration handled by admitting the gap instead of inventing data.
- **`explainAssignment` returns a key + params, not a string** — the only shape under which the console and #15's driver app can be guaranteed to read the identical sentence in different languages. `explain.eta_only` refusing to fall through to «Tuvākais» is the same discipline one level down: it declines to assert a distance ranking that never ran, and `dispatch-explanation.test.ts:83-98` pins both routes into it.
- **Both projections are pure with `nowMs` as an argument** — every fairness question is testable with no Redis, no clock and no database. `secondsSince` handling a future timestamp by flooring at 0 rather than emitting a negative the `nonnegative` schema would reject fails in the right direction, and says why.
- **`buildCascades` takes the already-built zone rows rather than the queue store.** One queue read per frame. H1 and M1 are bugs *inside* this design, not arguments against it.
- **`attempts` is consistent with the engine** — `offers.length` matches what `countAttempts` counts, which is the number `offerNext` compares against `MAX_OFFER_ATTEMPTS`. The board's count and the engine's give-up threshold are the same number, which is the right choice for a board whose job is explaining the engine.
- **The frame-application note added to `dispatchBoardEventSchema`** — that `applyDriverLocation` must never move a driver between `zones` entries, because a rank is earned by joining and not by a GPS ping crossing a boundary — closes a trap before anyone fell in it.
- **VSA and contract discipline hold.** `zones/index.ts` is a real public API and both consumers (`ride-queue.tsx:13`, `page.tsx:17`) go through it — no deep imports. No type duplicated out of `@taxi/shared`; the console derives its view types from `DispatchBoardEvent`. `packages/shared` still imports nothing from the workspace. A real `<table>` with `scope="row"`/`scope="col"`, and `board/index.ts` correctly lost its `ZonesPanel` export.

---

## A recurring pattern worth naming

The two most serious findings and one Medium share a mechanism: **a test passes on a fixture the runtime cannot produce.** H1's single-zone catalog hides multi-membership; M2's `(dispatcher, pending)` offer row cannot exist at all; M3's assertion matches an attribute rather than the tree. #120 shipped the same shape (a keyboard event fired on a node the browser never focuses). The common cause is that fixtures are written against the projection's *input type* rather than against the shapes the two `insertOffer` call sites and the lazy-enrollment path actually emit — the type permits far more than the system produces.

That is a cheaper thing to fix than three bugs: when a spec builds a row, check it against the writers.

---

## A note on the stack

The base `ced2d30` is PR #120's head **as reviewed and unremediated** — one Critical (a reassigned ride settling on the wrong driver's commission) and four High. Nothing in Phase C touches that code and none of it is re-reported here.

Two of #120's findings do change code this PR reads: fixing H3 redefines `countAttempts`, the same row set `cascade.ts` projects as `attempts`; and C1's fix adds a `revoked` transition on `ride_offers` rows that `findOffersForRides` returns. **After the #120 rebase this needs `cascade.spec.ts` and `board.service.spec.ts` re-run, not a fresh review.** Worth a line in the PR body so the rebase does not land silently.

---

## Recommendation

**Request changes.** H1 and H2 both land on the PR's headline claim — that Dina can now see *whose turn it is* and *why this driver*. H2 is wrong in exactly the scenario the feature was built to surface (the offline driver holding rank 1, which the report calls "the thing Dina resolves"); H1 is wrong whenever a driver has worked two zones in a shift, which is most of them.

Suggested order, since the first three sit in one file: H1 (project `ride.geozoneId`, resolve by id), H2 (the `status === 'online'` predicate), M1 (rank source or docblock), each with the regression case that would have caught it. Then M2's fixture, M3's hidden-text-plus-`getByRole`, M4's second key, M5's `CLAUDE.md` line. L1 is one word. L2 and L3 are one clause each, and L2 needs the PR body edited too. L4, L5 and L6 are fine to defer if the PR body names them.
