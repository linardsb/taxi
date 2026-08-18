# PR #121 review — round 3 (post-rebase)

**Head** `feed712` · **Base** `main` @ `d444c72` · `MERGEABLE` / `CLEAN` · 46 files, +3116/−275
**Reviews** what rounds 1 and 2 have not seen: the round-2 remediation commits (`a04e2dd`, `ead4114`, `19dc6c5`), the **rebase landing commit `0a7c519`** (i18n split, `board-ride.ts` extraction, plan reconciliation) and `feed712` (report addendum). Rounds 1 and 2 covered `d607043` and `525b1b2`.

> **Independence caveat, stated up front** (as round 2 did). The PR body's session id is this session's — this is the authoring session after a `/clear`, not a different reviewer. The deep code pass was handed to the `code-reviewer` agent in a clean context, and everything labelled `observed` below is **machine evidence**: my own gate run, three mutation reverts, and the runs that falsify F1. The *reading* is not independent and should be weighted as such; the runs stand on their own.

**Recommendation: request changes.** No Critical. **Two High, one Medium**, and both Highs are things the *rebase* broke rather than anything rounds 1–2 could have caught:

- **F1** — a false claim written into the repo-wide `CLAUDE.md` and into issue #127. It does not reproduce at this head and the mechanism it names is contradicted by the test harness.
- **F2** — `#120`'s H3 fix redefined what `countAttempts` counts, and the board's cap comparison was not re-derived with it. `cascade.ts`'s own docblock predicted exactly this and named the condition; the condition fired in `0a7c519` and the comment was left standing as a warning about something that had already happened.

Everything else is clean: validation green here and on CI at this head, all three mutation rows re-derived to the case name, and every verification the deep pass was asked for — the verbatim move, i18n parity, both conflict resolutions, the rebuilt fixtures — closed.

---

## Validation

`observed` — my own run, worktree `/Users/Berzins/Desktop/taxi-zones` at `feed712`:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` → **18/18 tasks, 0 cached, exit 0, 1m10.838s**.

| Package | PR body claims | I observed |
|---|---|---|
| `@taxi/api` | 615 passed, 66 suites, 0 skipped | **identical** (41.662 s) |
| `@taxi/shared` | 195 passed, 21 files | **identical** |
| `@taxi/dispatch` | 222 passed, 27 files | **identical** |
| `@taxi/db` | 17 passed, 3 files | **identical** |
| typecheck · lint · build | clean | **clean** — 0 errors; the 9 `no-unsafe-argument` warnings are all in pre-existing integration specs this PR does not touch |

**Round 2's M6 is closed.** CI ran on this exact head: run **32128678759**, `pull_request` event, head `feed712`, **conclusion success**, 4m12s (`observed` — `gh run list`). That is the independent green on GitHub's runner with its own Redis that round 2 said the merge lacked.

**The dispatch flake did not recur** — `LoginForm > moves focus to the code field on step 2 (edge)` passed in my run (27 files, 222 tests).

---

## F1 · High — `CLAUDE.md` ships a claim that does not reproduce, and #127 is filed on it

**`CLAUDE.md:43`** (also `…phase-c-report.md:33`, the PR body's Rebase section, and issue **#127**):

> `REDIS_TEST_URL` is **not optional any more — without it `@taxi/api` is RED, not green-and-short.** … #19 Phase B's `bookings.integration.spec.ts` and `customers.integration.spec.ts` fail outright — 8 tests, because the `POST /rides` idempotency reservation needs Redis and those two specs are not gated. `observed` … twice: `8 failed, 33 skipped, 574 passed, 615 total`.

**It does not reproduce, and the mechanism is wrong.** Three pieces of evidence, all `observed` at `feed712` in the same worktree, same machine, same `.env`:

1. **The exact command from the claim** — `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test` → **exit 0**, `Test Suites: 2 skipped, 64 passed, 64 of 66 total`, `Tests: 33 skipped, 582 passed, 615 total`. Green and 33 short. 582 = 574 + 8: the eight tests the claim says fail are exactly the eight that passed.
2. **The two named specs, run alone, with the variable unset** — `--testPathPattern "(bookings|customers).integration"` → **2 suites passed, 13 tests passed, exit 0**. 13 is their full complement (6 + 7 `it(`), so nothing was skipped into a false green.
3. **The harness makes them Redis-free by construction.** `services/api/test/harness.ts:454` overrides `KV_STORE` with `InMemoryKeyValueStore`, alongside `DISPATCH_QUEUE_STORE` and `DRIVER_LOCATION_STORE` — its own comment at `:457-458` says "*between them, no ioredis … this is what keeps the integration suite Redis-free*". Both specs build their app through `createTestApp`. That override is **not** new: `git log -S KV_STORE -- test/harness.ts` puts it at `b9059ce` (the SMS-OTP auth feature), and `git show d444c72:services/api/test/harness.ts` has it too — so the rebase did not fix it either.

The idempotency reservation therefore never dials Redis in test, and the specs are not "ungated Redis specs". **The author's `8 failed` was real output misattributed to a cause the code rules out.** The most likely actual cause is the one `CLAUDE.md:47` documents two paragraphs later — *"Integration runs are mutually destructive across sessions (global-setup drops the shared test DB)"* — which produces exactly this shape: several integration specs 500-ing together while unit specs stay green, reproducibly for as long as the other session's run holds.

**Why this is High rather than a docs nit, and the precise shape of the mistake.** `CLAUDE.md` is the file every session loads. Note what happened here: **M5's original correction was right.** Rounds 1–2 asked for the digit `24`/`28` → `33`, and 33 is what I observe. The rebase-era rewrite then replaced a *true* sentence carrying a corrected digit with a *false* sentence carrying the same corrected digit — the sentence "a green gate can be N tests short" describes this gate exactly, and it was retired on the strength of a diagnosis the harness rules out. So the line is not "wrong a fourth time" in the way the paragraph means; it was **right, and then over-corrected**. It also spawned issue **#127**, whose title and body carry the same wrong diagnosis.

**Failure scenario**: a session runs the gate while another session's integration run is mid-flight, sees 8 failures in `bookings`/`customers`, reads `CLAUDE.md:43`, concludes "known — Phase B's specs need Redis, tracked in #127", sets `REDIS_TEST_URL`, gets a different green, and never finds the shared-test-DB collision that actually caused it.

**Fix — this is a revert, not a rewrite.** Keep M5's `33`; delete the RED half; put the old sentence back around it:

1. `CLAUDE.md:43-45` — restore "a green gate can be **33** tests short — spread over 4 gated spec files, 2 of which hold nothing else and so report as *skipped suites*". The figures to put in it, **`observed` — my run at `feed712`, `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test`, exit 0**: `Tests: 33 skipped, 582 passed, 615 total` · `Test Suites: 2 skipped, 64 passed, 64 of 66 total`. Label them that way rather than inheriting them from this review. Keep the "re-observe the whole claim, not the digit" lesson — it is a good rule, and the honest version of the story it tells is that the digit was corrected correctly and the sentence around it was then broken.
2. `…phase-c-report.md:33` and the PR body's Rebase item 2 — same correction. The report's framing ("two claims were false, not merely stale") survives with **one** claim in it: the auto-retarget one, which I confirmed independently (both PRs were retargeted by hand; `deleteBranchOnMerge: false`).
3. **#127** — close it, or re-scope it to "find what actually made those 8 integration tests fail". Do not leave the current diagnosis on it.

Nothing here touches shipped source, so the fix costs one commit and no re-validation beyond a gate.

---
## F2 · High — the board's attempt cap counts rows the engine stopped counting (`cascade.ts:189`)

Raised by the `code-reviewer` agent's independent pass; **re-derived against the source before inclusion**, not taken on its word.

**Defect.** `buildCascades` computes `attempts` as `offers.length` — every `ride_offers` row for the ride, any status, since booking (`findOffersForRides`, `dispatch.repository.ts:132-146`: `inArray(rideOffers.rideId, …)` and nothing else) — and hands it to `nextInQueue`, which returns `null` at `attempts >= MAX_OFFER_ATTEMPTS` (`cascade.ts:189`). The engine no longer counts that way. Post-rebase, both engine call sites read `findLastReleasedAt` first and pass it: `dispatch.service.ts:61-62` and `dispatch.sweeper.ts:135-136` → `countAttempts(rideId, pooledSince)`, which is `gt(rideOffers.sentAt, since)` when a release exists (`dispatch.repository.ts:205-215`). The two agree **only while the ride has never been released**.

**This is the branch's own prediction coming true.** `cascade.ts:180-181` says: *"#120's H3 redefines what `countAttempts` counts; if it stops meaning 'rows for this ride', this comparison needs re-deriving with it."* `0a7c519` is where that landed. The PR body even records H3's arrival as verified (*"`countAttempts(rideId, since)` with `since` required, and `findLastReleasedAt` alongside it"*) — the fact was checked, the consequence was not followed through. Round 2's claims audit had verified the opposite (*"Same row set ✓"*), and it was right at `525b1b2`; the rebase falsified it.

**Failure scenario**, every step against a real writer:
1. A Centrs ride cascades through 5 offers and goes unclaimed (`dispatch.service.ts:59-70`).
2. Dina force-assigns driver X — `force-assign.service.ts` inserts offer row **6** with no attempts check (the PR body says this itself, in the `≤ 500 + Σ dispatcher overrides` correction).
3. X stalls. Dina reassigns: `reassign.service.ts:147` writes `payload: { event: 'released', from }` and the ride returns to the pool.
4. Engine, next sweep: `findLastReleasedAt` returns the release instant, `countAttempts` = **0**, `offerNext` proceeds and offers to a fresh driver — row **7**, ride moves to `offered`/`queued`.
5. Board, same frame: `offers.length` = 7 ≥ 5, so `nextDriverName` is `null` — **permanently**, since nothing deletes `ride_offers` rows. `CASCADE_STATUSES` is `{'offered','queued'}` (`ride-queue.tsx:61`), so the strip renders: «Mēģinājumi: 7», no «Nākamais». Dina reads *the cascade is spent, this one is mine* while the engine is mid-cascade with a full budget of 5.

That inverts this PR's headline promise (*whose turn is it*) in the exact flow #19 Phase A shipped. It needs a dispatcher release, which is why it is High rather than Critical — it fails toward Dina doing manual work, not toward a lost ride.

**Fix.** The board cannot cheaply scope the count: `findOffersForRides` selects no `sentAt`, and the release instant lives in `dispatch_audit_log` — a per-ride read per frame is precisely the cost `board.service.ts:170-175` already declines to pay for `unclaimedSeconds`. So the honest fix is to **drop the cap guard** (`cascade.ts:189`) and say in the docblock that the board cannot know the engine's budget, because the budget is release-scoped and the frame carries no release timestamp. `nextInQueue` is already declared a heuristic over the rank rather than a replay of `findCandidates`, so this is consistent with what the function claims to be.

**Not a one-line deletion.** It turns `cascade.spec.ts`'s *"names nobody next once the ride has burned its attempts (failure)"* red: that fixture's sixth entry (Fēlikss, online and untried) exists specifically so the case discriminates the cap guard, as its own comment says. It has to be rewritten as the assertion of the new rule, not deleted. Also correct the PR body's line 95 — *"«Nākamais» now requires online and returns null past `MAX_OFFER_ATTEMPTS`"* — which is the guarantee this breaks, and which per round 1's L2 lives on the one surface not in the working tree.

**Why no test caught it, and why that matters.** `buildCascades` is pure over `offers`/`zones`/`rideZones`; a released ride and an un-released one are indistinguishable in that input, so the divergence **cannot be expressed as a `cascade.spec.ts` case at all**. Rounds 1 and 2 both found tests passing on fixtures the runtime cannot produce. This is the mirror image: a runtime state no fixture can reach. Worth one line in the report, because the remedy is different — it is a seam problem, not a fixture problem.

---

## F3 · Medium — the docblock that asserts F2 (`cascade.ts:176-181`)

**Defect.** *"`offerNext` compares `countAttempts` against the same cap but reads it BEFORE writing the new row, so 5 rows with one pending means the engine gives up on the next tick rather than this one"* — false at this head for any released ride, where the two sides count different row sets rather than the same set off by one.

**Failure scenario.** The next author reads it, trusts that `offers.length` and `countAttempts` are the same number modulo an off-by-one, and derives something else from it. That is how #87 and #107 shipped — a number inherited rather than re-derived.

**Fix.** One edit, folded into F2's: say the board's `attempts` is cumulative-since-booking, the engine's budget is scoped to `findLastReleasedAt`, and name the released-ride case where they part. Retire the conditional at `:180-181` rather than leaving it as a warning about something that has already happened.

---

## Claims audit — everything else re-derived, not read

`observed` at `feed712` unless stated.

- **Test-count deltas reconcile against the tree, independently of the baselines.** Counting added/removed cases in the diff `d444c72..feed712`: api **26** new `it(` in spec files **+ 5** in `test/dispatch-queue-store.contract.ts` × **2** stores = **36** ✓; shared **+17** ✓; dispatch **15 added − 3 retired = +12** ✓. Those match the PR body's `+36 / +17 / +12` exactly, and 579+36=615, 178+17=195, 210+12=222 against my observed totals — so the `main` baselines are corroborated arithmetically as well as by the author's run. Suite deltas check too: api +2 (`zone-rows.spec`, `cascade.spec`), shared +1 (`dispatch-explanation.test`), dispatch +2 new −1 retired.
- **Mutation evidence — all three rows re-derived independently at this head**, each reverting only source with tests held at `feed712`. **Shared**: `Object.hasOwn` → `key in` gives **1 failed, 194 passed, 195 total**, the failure being `isMessageKey > rejects an inherited Object property (failure)`. **Dispatch**: `git checkout 67e5697 -- zone-grid.tsx` gives **3 failed, 219 passed, 222 total**, the three named `ZoneGrid` cases. **api**: `git checkout 67e5697 -- cascade.ts board.service.ts` (a consistent pre-fix pair, `rides.repository.ts` left at HEAD so the `board-ride.ts` extraction still compiles — the extra `geozoneId` field is simply unused pre-fix) gives **5 failed, 610 passed, 615 total**, and the five are exactly the H1/H2 regression cases: *explains the ride's own zone when the holder holds two ranks*, *explains the zone the RIDE came from when the holder is in two ranks*, *claims no zone at all when the ride carries no stamped one*, *skips an offline driver when naming who is next*, *names nobody next once the ride has burned its attempts*. Three rows, three exact matches to the PR body's table — the re-derivation claim holds.
- **Board cost table** ✓ — read off `board.service.ts:97-157`: `findBoardRides` + `listForCity` + `findBoardContacts` + `findOffersForRides` + one `resolveForPoint` per positioned driver = **4 + N**, Redis `listOnline` + one `snapshot()` (LRANGE + HGETALL) per catalog zone = **1 + 2Z**. Both added Postgres reads are flat.
- **Constants** ✓ — `BOARD_EMIT_INTERVAL_MS = 2_000` (`board.policy.ts:18`), `BOARD_RIDES_LIMIT = 100` (`:26`), `MAX_OFFER_ATTEMPTS = 5` (`dispatch.policy.ts:35`), `DRIVER_LOCATION_TTL_SECONDS = 60` (`driver-location.policy.ts:15`). So 30 frames/min, +60 queries/min, ≤500 auto-cascade rows/frame — and the body's "**not** a whole-system worst case, `≤ 500 + Σ dispatcher overrides`" is the honest form of it.
- **Line counts** ✓ — `zone-grid.tsx` **289**, `rides.repository.ts` **464** after the extraction (the body's "504 before" is the reason for it), `cascade.ts` 203, `zone-rows.ts` 80, `board-ride.ts` 57. No `max-lines` disable in the diff. `packages/shared/src/i18n.ts` is **47**. (The "dropped 454 → 47" framing is wrong at both ends and was corrected 2026-08-18: **#122's** split took the file 498 → 26 in `0e2d0d7`, and over this PR's own base `d444c72..59b3feb` it **grew** 26 → 47. 454 is `d67c82a`, the pre-rebase Phase C tip, so the drop straddles the rebase and credits Phase C with #122's work.)
- **i18n parity** ✓ — 151 keys in each of `lv`/`ru`/`en`, and the three key sets are **byte-identical when sorted** (`diff` clean both ways). 4 `explain.*`, 9 `console.zone_*`, 4 `console.cascade_*` per language. `satisfies Record<Language, Record<MessageKey, string>>` in the assembly file keeps typecheck as the enforcement.
- **The plan reconciliation cites tests that exist** ✓ — all seven test names quoted in the new D1/D1b sections resolve to the files named (`dispatch.integration.spec.ts` ×6, `bookings.integration.spec.ts` ×1). Citing by name rather than line is the right call and is stated as such.
- **The commit-history caveat is accurate** ✓ — `git show --stat c190120` lists no `i18n/{lv,ru,en}.ts`, while its message describes splitting `console.zone_none_configured` and swapping in `Object.hasOwn`. Disclosing this rather than rewriting history is the right trade; the tree is correct at every step.
- **`board-ride.ts` really is a verbatim move** ✓ — checked line by line against the block removed from `rides.repository.ts`: `boardPickupSchema`, `BOARD_STATUS_SET`, `isBoardStatus` and the `BoardRide` fields are identical bodies; the only edits are `const` → `export const` on the two the repository still imports, plus a file docblock. The arithmetic reconciles: 41 lines out, 1 import line in, 504 − 40 = **464** ✓. So "no new test file because there is no new behaviour" is justified, and coverage travels with `findBoardRides`.
- **Both conflict resolutions kept both sides** ✓ — `dispatch.repository.ts` has #120's `findLastReleasedAt` (`:173`) and `countAttempts` (`:205`) *and* Phase C's `findOffersForRides` (`:132`), with a clean union import and every symbol used. `rides.repository.ts` keeps `UNASSIGNABLE_RIDE_STATUSES` (`:45`, used at `:430`) and Phase C's `geozoneId` projection (`:284`). (F2 is not a lost hunk — both halves survived; what did not survive is the *relationship* between them.)
- **i18n parity is enforced in both directions** ✓ — beyond the sorted-set equality above: `ru.ts` and `en.ts` each carry their own `satisfies Record<MessageKey, string>` on a fresh object literal, so excess-property checking catches an *extra* key as well as a missing one. The assembly file's own docblock credits its `satisfies` clause with this, which is only half true — that clause alone enforces one direction, because `ru`/`en` reach it as references. #122's line, not this PR's.
- **The rebuilt `cascade.spec.ts` fixtures are producible** ✓ — positions are 1..n matching `snapshotFrom`'s `index + 1`, and the five offer rows are five distinct drivers matching `findTriedDriverIds` + the one-shot rule. The one shape that looks suspect (driver A holding the fifth offer while sitting at position 1 with the longest tenure) is reachable: `offerNext` skips a driver holding a live card on another ride without writing a row, and `joinBack` never overwrites the join stamp. Round 1's and round 2's recurring defect does not recur.
- **The `zones-panel.tsx` deletion left nothing dangling** ✓ — the only surviving mentions in source are four deliberate historical references explaining what the grid replaced. `BoardRide` still reaches its one consumer through `features/rides/index.ts`, so the extraction changed no import outside the slice.
- **Review reports are not in the diff** ✓ — both live in the main checkout, uncommitted, as the PR body says and as this repo's own gotcha requires.
- **Frame size is honestly unmeasured** ✓ — labelled `expected`, with "measure before treating the localStorage budget as settled". That is the correct handling of a figure nobody ran.

---

## What is good

- **The rebase was landed as a reviewable event, not smuggled.** The PR body and report addendum both say plainly that every pre-rebase figure was re-run rather than edited, and the superseded numbers are left in place instead of being quietly overwritten. That is the discipline `CLAUDE.md` asks for, applied to the hardest case — one where editing a digit would have been invisible.
- **Two pre-rebase claims were retired by *subject*, not by digit.** The auto-retarget claim was replaced with the mechanism (`deleteBranchOnMerge: false`, retarget fires on deletion) and recorded as a plan GOTCHA, which is where the next session will hit it. F1 is the same instinct applied to a diagnosis that happens to be wrong — the process worked, the conclusion did not.
- **The 500-line resolution went the right way.** `rides.repository.ts` hit the cap because two branches added to it; the answer was to move the pure projection to a sibling with one consumer, not to raise the cap or disable the rule. Flagging it as a verbatim move *so the review does not read it as untested new source* is exactly the disclosure that makes a review cheap.
- **The i18n split absorbed Phase C cleanly.** **59** lines of new strings landed in three dictionaries with byte-identical key sets (`lv +25`, `en +17`, `ru +17`; 80 was the four-file total, including 21 non-string assembly lines in `i18n.ts` — corrected 2026-08-18), and the assembly file is 47 lines. The one casualty — `dispatch-explanation.test.ts`'s stale `formatMessage` import — was caught by the gate and repointed, which is the seam working.
- **The plan reconciliation deletes nothing.** Every D1 item says where it went, D1b exists so Phase D does not re-scope four tests Phase A already shipped, and a loose phrase in the changelog ("pulled forward from Phase D") is corrected rather than left.

---

## Inherited, not this PR's — recorded so the next author does not re-derive them

- `packages/shared/src/format-message.ts:5-13` says the split left `i18n.ts` holding "nothing but the three dictionaries" and that the `lv`/`ru`/`en` objects "stayed exactly where they were". Both are false at this head — the dictionaries are in `i18n/`, and `i18n.ts` holds the assembly plus `isMessageKey`. #122's file; not in this PR's diff.
- `packages/shared/src/i18n.ts:18-20` credits its own `satisfies` clause with forcing key parity; that clause enforces one direction only (see the claims audit). This PR's hunk on that file appends `isMessageKey` and nothing else.
- `apps/dispatch/src/app/dispatch/page.tsx:45-47` still says "the only controls are the view toggle, alert acknowledge/mute, and the offline retry". #120 added assign/reassign/cancel and #122 added New Order.

Also still true and worth moving next time the file is open: `rides.repository.ts`'s "ONE UNREADABLE ROW COSTS ONE CARD, NEVER THE BOARD" block sits above `findActiveRideIdsByDriver` rather than the `findBoardRides` it describes (carried from round 2).

---

## Recommendation

**Request changes.** Two Highs, both narrow, neither questioning the approach:

1. **F2 + F3** — `cascade.ts`: drop the cap guard, rewrite the docblock, rewrite the one test whose fixture exists to discriminate that guard, and correct the PR body's «Nākamais» guarantee. This is the one that shows Dina something false.
2. **F1** — restore the `CLAUDE.md` sentence around M5's already-correct `33`, fix the two copies in the report and PR body, and close or re-scope #127.

The rest is approve-ready: validation green on my machine and on CI at this exact head, all three mutation rows reproducing to the case name, and every claim I could re-derive holding. Money, the ride state machine, `isPaymentMethodLocked()`, the seam boundaries and the `shared`-imports-nothing rule are all untouched; every shipped file is under 500 lines and there is no `eslint-disable` of any kind in the diff.

The deferred set (L4 clock skew, L5 queue TTL, L6 the "ONE query" proxy, L8/#124 the queue-mode disagreement, L12) is unchanged and correctly named in the PR body. Nothing in this round moves any of them.

**One transferable lesson for the execution report.** The rebase addendum swept **figures** — thoroughly, and the sweep holds. It did not sweep **guarantees**, and F2 is a guarantee the rebase invalidated *in a file that carried a comment naming the exact condition that would invalidate it*. The next rebase-onto-a-merged-base checklist wants a second line: re-derive the conditional comments, not just the numbers.
