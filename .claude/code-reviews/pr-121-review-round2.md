# PR #121 review — round 2 (the review-fix pass)

**Head** `525b1b2` · **Base** `feature/dispatch-override-phone-orders` @ `ced2d30` (PR #120, stacked) · round-2 diff `d607043..525b1b2`, 12 files, +454/−54
**Reviews** the two commits answering round 1 (`.claude/code-reviews/pr-121-review.md`, main checkout): `d67c82a` (the ten fixes) and `525b1b2` (one docblock).

> **Independence caveat, stated up front.** The commits under review were authored by this session before its context was cleared — the session id in the PR body is this one. The deep pass was handed to the `code-reviewer` agent in a clean context; the mutation run below is machine evidence rather than reading. Anything else here is the same session re-reading its own work and should be weighted as such.

**Recommendation: approve.** All ten claimed fixes close their finding rather than their test — verified by mutation, not by reading. No Critical, High or code-level Medium. One process Medium (CI has never run on the remediated head) and six Low, of which **L7 is the one worth taking before merge**: it is a one-clause docblock correction in the same function the review just corrected for an overclaiming docblock.

---

## Validation

`observed` — my own run, worktree `/Users/Berzins/Desktop/taxi-zones` at `525b1b2`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **18/18 tasks, 0 cached, exit 0, 57.5 s**.

| Package | PR body claims | I observed |
|---|---|---|
| `@taxi/api` test | 546 passed, 0 skipped, 59/59 suites | **identical** |
| `@taxi/shared` test | 184 passed | **identical** |
| `@taxi/dispatch` test | 159 passed | **identical** |
| `@taxi/db` test | 17 passed | **identical** |
| typecheck · lint · build | clean | **clean** |

No cross-session interference this run — the one red run the PR body reports did not recur.

**M5's figure re-observed independently**, second run, same head with `REDIS_TEST_URL` unset:
`Test Suites: 2 skipped, 57 passed, 57 of 59 total` · `Tests: 33 skipped, 513 passed, 546 total`.
That is exactly what `CLAUDE.md:43` now says. ✓

---

## The evidence that matters: mutation, not reading

The PR body claims *"every regression case was run against the pre-fix source first and observed to fail"*. I re-ran that check rather than taking it — round 1's closing note was that this codebase's recurring defect is a test that passes on a fixture the runtime cannot produce, and only red-then-green rules it out.

`observed` — I reverted `cascade.ts` to the round-1 logic in place (`zoneHolding` back to the catalog scan; `nextInQueue` back to no `status === 'online'` filter and no `MAX_OFFER_ATTEMPTS` guard), left everything else at `525b1b2`, and ran the two board suites:

```
Tests:  5 failed, 23 passed, 28 total
```

**All five new cases failed, and only those five**, with the exact wrong values round 1 predicted — «Anna Bērziņa» where the fixed code says «Kārlis Liepa», `explain.geozone_queue`/Lidosta where it says Centrs, a name where it should be null past the cap. The worktree was restored to `525b1b2` clean immediately after (`git status --porcelain` empty, head unchanged).

So the regression suite is real. That single run is worth more than the rest of this review.

---

## Round-1 closure

| # | Verdict | Evidence |
|---|---|---|
| **H1** wrong zone | **closed** | `rides.geozoneId` projected onto `BoardRide` and passed as a `rideId → geozoneId` map; `zoneHolding` resolves by id and returns `undefined` when the holder is not in the ride's zone. No new query — `findBoardRides` already selected the column. Both regression cases (unit + service-level, the latter driving the real in-memory queue store) fail on the pre-fix source. |
| **H2** unreachable next driver | **closed** | `status === 'online'` predicate plus a `attempts >= MAX_OFFER_ATTEMPTS` return. Docblock now states plainly it is a heuristic over the rank, not a replay of `findCandidates`, and names what is still unmodelled (proximity, eligibility, busy-set). Both cases fail pre-fix. |
| **M1** false "byte-identical rank" | **closed** | Docblock replaced with the split — tenure from the grid, rank from the offer row — and why the offer row is the right source. Round 1 offered exactly this as one of two acceptable fixes. |
| **M2** unproducible fixture | **closed** | Rebuilt as `(dispatcher, accepted)`. `observed`: `force-assign.service.ts:86-87` passes `source: 'dispatcher', status: 'accepted'`, and it is one of only two `insertOffer` call sites — the other never writes `dispatcher`. The fixture now matches the writer exactly, and the test asserts the projection's real output (no holder, `attempts: 1`, `explanation: null`). |
| **M3** aria-label on a roleless span | **closed** | Visually-hidden sentence + `aria-hidden` digits (clip-rect, so it stays in the tree), `role="list"` restated on the `<ol>`, and the status dot's assertion upgraded from `getByLabelText` to `toHaveAccessibleName` — that one *can* be asserted against the tree because `role="img"` accepts a name. See L7 for the remaining honesty note. |
| **M4** one key, two facts | **closed** | `console.zone_none_configured` added across LV/RU/EN; `console.zone_none` retired with **zero** residue (`observed` — grep across `packages/shared/src`, `apps/dispatch/src`, `services/api/src` returns only the new key). Test asserts both the new string's presence and `console.zone_empty`'s absence. |
| **M5** stale gated-skip figure | **closed** | 24 → 33, re-derived at this head, and the line now carries its own volatility warning. Re-observed above. |
| **L1** prototype-chain guard | **closed** | `Object.hasOwn`, with a three-key loop over `toString`/`constructor`/`valueOf`. |
| **L2** `≤500` not a worst case | **closed** | Restated as `≤ 500 + Σ dispatcher overrides` in **both** the report and the PR body — the surface round 1 specifically flagged as the one not in the working tree. |
| **L3** `≤6 zones` unenforced | **closed** | Condition attached: catalog-bounded, `listForCity` has no `LIMIT`, seed has 4, pilot scale. |

**L4, L5, L6 are deferred and named in the PR body**, which is what round 1 asked for. Not re-reported.

---

## New findings

One Medium (process, not code), six Low. Nothing Critical or High.

> The `code-reviewer` agent's independent pass — the part of this review that is not the authoring session re-reading itself — produced L7, L8, L9, L10a and the inherited note. I re-derived each against the source before including it; L7's 60-second freshness window and L8's `showPosition={zone.queueModeEnabled}` are both `observed`, not taken on the agent's word. It reached the same verdict on all ten closures independently, and counted api's 546 from the tree by a different route than mine (per-file `it(` count plus `it.each` expansion) and landed on the same number.

- **M6 · CI has never run on the remediated head.** `observed` — the only Actions run for this branch is **32070068153** at `d607043`, the round-1 head. There is no run for `d67c82a` or `525b1b2`, and `gh pr checks 121` reports *"no checks reported"*. The remote head *is* `525b1b2`, so the push landed; the `pull_request` (`synchronize`) event simply did not fire a run — the same silent miss `ci.yml:7-12` documents from #52. This matters more than usual here because CI is the only environment that runs the gate with `REDIS_TEST_URL` set on a clean checkout (`ci.yml:33-36`, plus the reachability probe at `:48-49`), and my local run and the author's share one machine and one Redis. **Fix**: `gh workflow run ci.yml --ref feature/dispatch-zones-cascade` before merging — `ci.yml` is present on this ref, so the dispatch caveat in its own comment does not apply. Not a code defect; the merge just currently has no independent green.
- **L7 · H2's own docblock still overclaims, in the sentence written to correct an overclaim.** `cascade.ts:150-153` says the filter means it no longer names *"someone the engine CANNOT reach at all"*. The paragraph above honestly lists what is unmodelled, but the engine's candidate **universe** is narrower than `status === 'online'`: `findNearest` passes `freshSinceMs: Date.now() - DRIVER_LOCATION_TTL_SECONDS * 1000` (`driver-location.service.ts:82`, `driver-location.policy.ts:15` — 60 s), and `drivers.status` is not tied to that window. **Failure scenario**: Jānis is #1 in Centrs, `drivers.status = 'online'`, socket alive, but his pings stopped three minutes ago (iOS background suspension, revoked location permission, or a swallowed `ingest` failure). He is not in `findNearest`, so he is unreachable outright — not merely skipped — and the strip names him «Nākamais». That is H2's failure mode by a different mechanism, and narrower (an ordinary quit clears presence via `handleDisconnect`), which is why it is Low. **Fix, one clause, no code**: say the filter *narrows the class* — `drivers.status` is the column `toCandidates` rejects on, but `findNearest` additionally drops positions older than `DRIVER_LOCATION_TTL_SECONDS`, so an app that stopped pinging while still marked online can still be named. **This is the one item I would take before merge**, because it is a guarantee sentence in the function the review just corrected for a guarantee sentence.
- **L8 · The two halves of one cascade object disagree about whether queue mode ran.** `cascade.ts:178` gates on `zone.queueModeEnabled`; `explainAssignment` keys off `pending.source`. Those are not the same condition — `DispatchStrategyResolver.forZone` runs `GeozoneQueueStrategy` when the zone flag is `false` **and** `config.defaultDispatchMode === 'geozone_queue'`, which its own docblock calls out deliberately. **Failure scenario**: city default `geozone_queue`, `Centrs` with `queueModeEnabled: false`. The strategy enrolls and ranks, the offer row is `source: 'geozone_queue'` with a real `queuePosition`, so the strip renders «Centrs rinda #1 · zonā 47 min» *and* refuses to name who is next. `zone-grid.tsx:206` (`showPosition={zone.queueModeEnabled}`) then also hides a rank dispatch **is** honouring — the inverse of that component's own docblock. Pre-existing (the remediation rewrote this docblock without touching the predicate), needs a deliberate admin config since both DB and zod defaults are `auto_match`, and it fails safe. **Fix**: gate on `pending.source === 'geozone_queue'` — the fact already in hand, and it makes the two halves agree by construction.
- **L9 · Two new fixtures build rows the writers cannot emit — the round-1 pattern, restated inside the commit answering it.** `cascade.spec.ts:163,172` gives a two-entry Lidosta rank `position: 4` and `5`; every production position is `index + 1` (`dispatch-queue.store.ts:116`, `snapshotFrom`), so a two-entry rank is 1 and 2. `cascade.spec.ts:249-255` writes **four offer rows for `DRIVER_C` on one ride**; `findTriedDriverIds` (`dispatch.repository.ts:109-115`) returns every driver already offered and `offerNext` filters on it, so five auto-cascade rows means five distinct drivers. Neither weakens what its test discriminates — the position field is never read from that zone, and the attempts case returns before touching `entries` — and both still fail pre-fix. **Fix**: positions 1/2; and five distinct tried drivers plus a sixth untried online entry, which isolates the guard *and* is producible.
- **L10 · Two claims that are one commit or one case out of date.** (a) The report's *"every regression case was run against the pre-fix source first and observed to fail"* (`…phase-c-report.md:208-210`) is true of eight of the nine new cases but not of M2's rebuilt `(dispatcher, accepted)` fixture, which exercises unchanged behaviour and passes pre-fix — M2 was a fixture defect, as the table's own Fix column says. My mutation run bears this out precisely: five failed, and the dispatcher case was not among them. (b) The report's M3 row names the test *"keeps list semantics under `list-style: none`"*, which `525b1b2` renamed to *"states the list role explicitly rather than relying on the tag"* one commit later. **Fix**: name the four genuine red-then-green cases (H1's two, H2's two), say the `eta_only` case is new-API rather than a regression and M2's is a fixture correction, and re-sync the test name.
- **L11 · Two forward-looking claims stated in the present tense.** `cascade.ts:41-42` says the offer row's `queuePosition` is *"also what the driver app reads"* — `apps/driver` has no `src/` at this head (`observed`), so that is `expected`, not a fact. The wire schema supports it (`schemas/ride.ts:160` carries `queuePosition` on the offer), so the design intent is sound; the tense is the issue, again in a docblock written to correct a false claim.
- **L12 · One new test is a lint assertion wearing a behaviour test's name.** `zone-grid.test.tsx:125` — `expect(screen.getByRole('list')).toHaveAttribute('role', 'list')` is circular on its face. It does discriminate (delete the attribute and the assertion fails), and `525b1b2` already renamed it to say what it actually checks. Noted rather than raised: jsdom cannot see the Safari/VoiceOver behaviour the mitigation exists for, and the comment says exactly that.

*Marginal, inherited, not this PR's*: `rides.repository.ts:241-259`'s "ONE UNREADABLE ROW COSTS ONE CARD, NEVER THE BOARD" block now sits above `findActiveRideIdsByDriver` rather than `findBoardRides` at `:283`, whose `flatMap` it describes — #120 inserted a method between them. Worth moving next time the file is open, not worth a commit.

---

## Claims audit

Re-derived, not read.

- **Test-count deltas.** api **+5** = 4 new `it(` in `cascade.spec.ts` + 1 in `board.service.spec.ts` (the dispatcher-override case was *replaced*, not added) → 541 + 5 = **546** ✓. shared **+3** = the new `isMessageKey` describe → 181 + 3 = **184** ✓. dispatch **+1** = the list-role case; M3's and M4's cases were rewritten in place → 158 + 1 = **159** ✓. db **0** → 17 ✓. Total 906 ✓.
- **`countAttempts` vs `offers.length`.** `525b1b2`'s entire content is this claim, so it got checked directly: `countAttempts` (`dispatch.repository.ts:148-154`) is `count()` over `eq(rideOffers.rideId, …)` with **no status filter**, and `findOffersForRides` (`:132-146`) is the same predicate with a column list. Same row set. ✓ And the off-by-one is stated correctly: `offerNext` (`dispatch.service.ts:61-68`) reads `countAttempts` *before* inserting, so 5 rows with one pending means the engine gives up on the **next** tick — exactly what the docblock says, and why returning null there is right rather than premature. The `#120 H3` warning is well placed: with no status filter today, a fix that adds one moves this boundary.
- **`(geozone_queue, geozoneId: null)` is producible**, so the new `explain.eta_only` case is not another unproducible fixture. `DispatchStrategyResolver.forZone(undefined, config)` falls through to `config.defaultDispatchMode`, so a pickup in no configured zone still runs queue mode when the city default is `geozone_queue`; `setGeozone` is guarded by `if (zone && …)` (`dispatch.service.ts:85-88`) and never fires. The `BoardRide.geozoneId` docblock says exactly that. ✓
- **The cost table survives the remediation unchanged.** H1's fix adds no query: `rideZones` is `new Map(rides.map((r) => [r.id, r.geozoneId]))` off the `rides` array already resolved at `board.service.ts:100`, and `geozoneId` was already in `findBoardRides`' select. So `4 + N` Postgres and `1 + 2Z` Redis per frame still hold, and the PR body's table needed no edit.
- **`zone-grid.tsx` = 289 lines** ✓ (PR body's figure), under the 500 cap. No `max-lines` disable in the diff. `packages/shared/src/i18n.ts` is at 454 — still under, worth watching as the catalogs grow.
- **i18n parity** — 255 `console.*` and 12 `explain.*` entries across three catalogs = 85 and 4 per language ✓, and `satisfies Record<Language, Record<MessageKey, string>>` makes typecheck the real enforcement.
- **`@taxi/dispatch` 159 / 21 files and `@taxi/shared` 184 / 20 files re-observed standalone**, outside the turbo run, matching the PR body's file counts as well as its test counts.
- **`BoardRide.geozoneId` stays api-internal** — `BoardRide` is exported from `services/api/src/features/rides/index.ts` and consumed only by `board.service.ts`. Nothing new reaches the wire, so no schema change was owed.
- **The #120 conflict disclosure is accurate.** `git show 34633a4:CLAUDE.md` → **28** on `feature/dispatch-override-phone-orders`; this branch moves the same line to 33 from a base that predates it. The PR body's instruction — re-run the gate without the variable at the merged head rather than picking a digit — is the right resolution.

---

## What is good

- **The mutation discipline.** Ten findings, ten fixes, and the one that mattered most (H1) got two regression cases at different levels — a pure-projection unit test *and* a `board.service` test driving the real in-memory queue store through `joinBack` with a manipulated clock, which is the level where the multi-zone state actually assembles.
- **H1 was fixed at the source of the ambiguity, not at the symptom.** Round 1 offered "resolve by id"; the fix took it and added the honest degradation — no stamped zone means `explain.eta_only`, saying only the part that is true, rather than borrowing a name off whichever rank the holder happens to occupy.
- **H2's docblock is the model for the whole repo.** It states what the function is (a heuristic over the rank), what it is not (a replay of `findCandidates`), which filters are unmodelled by name, and what would invalidate the comparison it makes. That is a claim carrying its own conditions.
- **M4's key split cites the response, not the string.** "Empty rank → send a car; no zones configured → ring whoever configures them" is the reason two keys exist, written where the next reader will find it.
- **M2 was answered by fixing the fixture *and* saying why the key stays.** `explain.dispatcher` is unreachable from the board and justified for #15's driver app — stated in the test rather than left as a dangling catalog entry.
- **The report's remediation table names the test that proves each fix**, which is what made the mutation check cheap to run.

---

## Recommendation

**Approve.** Both Highs are genuinely closed, verified by reverting the fix and watching the new cases go red. The three deferrals are named in the PR body with their consequences. Nothing below M6 blocks.

Two things I would do before hitting merge, neither of which needs a re-review:

1. **M6** — `gh workflow run ci.yml --ref feature/dispatch-zones-cascade`. The merge currently has no independent green; my gate and the author's ran on the same machine against the same Redis.
2. **L7** — the one-clause docblock correction in `nextInQueue`. L8–L12 can ride along with the next touch of these files.

Merge order still matters: this is stacked on #120, whose own Critical and Highs are unremediated at the base commit `ced2d30`. After the #120 rebase, `cascade.spec.ts` and `board.service.spec.ts` need a **re-run, not a fresh review**, and `CLAUDE.md:43` needs the gated-skip figure re-derived at the merged head rather than resolved by picking 28 or 33 — both already stated in the PR body.

*(Round-1 report: `.claude/code-reviews/pr-121-review.md`, main checkout, deliberately not committed to this branch.)*
