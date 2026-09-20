# PR #236 — round-1 review fixes

**Review** [comment 5750050587](https://github.com/linardsb/taxi/pull/236#issuecomment-5750050587) · verdict *request changes*, two High, four Medium, four Low
**Branch** `feature/board-driver-freshness-234` · **base** `main` @ `b8d62c58`, unmoved (`observed` 2026-09-20: `git fetch origin --prune && git rev-parse origin/main` → `b8d62c58…`, identical to the PR's `baseRefOid`)
**Worktree** `/Users/Berzins/Desktop/taxi-wt-234`, clean at `7ca9217` before the pass; no `MERGE_HEAD`/`REBASE_HEAD`/`CHERRY_PICK_HEAD`
**PR state** OPEN. #236 is the **only** open PR — #218, #221, #226, #227, #233, #235 are all MERGED, so no branch is concurrently editing `docs/runbooks/driver-device-day.md` (checked before touching it, because `feature/driver-device-day-prep` is still checked out in the main tree and looks live)

## Triage

| Finding | Severity | Call |
|---|---|---|
| F1 «Raida» for a driver who never sent a fix | High | **Fixed** |
| F2 Panel attributes the console's deafness to the drivers | High | **Fixed** |
| F3 Comment cites the two paths that *do* parse | Medium | **Fixed** (comment + guard); the socket-validation gap → **[#237](https://github.com/linardsb/taxi/issues/237)** |
| F4 Step 5 says a «Klusē» row *is* a failure | Medium | **Fixed** |
| F5 "in seconds rather than minutes" describes only the failure state | Medium | **Fixed** |
| F6 Phone rendered as unclickable text | Medium | **Fixed** |
| F7 "Its text changes only when the SET changes" is not a guarantee | Low | **Fixed** |
| F8 A deferral naming no ticket | Low | **Fixed** — filed **[#238](https://github.com/linardsb/taxi/issues/238)**, cited in the docblock and the plan |
| F9 PR body's AC #3 grep enumeration is wrong | Low | **Fixed in the PR body**, re-derived on the pushed head (below) |
| F10 `>=` renders as "older than" | Low | **Fixed** |

Nothing deferred, nothing dropped as noise. Two items were **added** by the copy sweep and are not on the review's list — see §Copy sweep.

---

## Fixed

### F1 · «Raida» for a driver who has never sent a GPS fix

**Wrong because** `driverFreshness` decides on `lastSeenAt`, which is the `seen` ZSET score — seeded by `markOnline` at go-online time in the same MULTI as the SADD, with no GEOADD (`redis-driver-location.store.ts:75-79`). Only the RECORD script writes a position. A driver who taps the toggle with no lock reaches the board with age ≈ 0 and `location: null`, and the panel called that green «Raida». The `unknown` state built for exactly this keyed off `lastSeenAt === null`, which fires only for a deploy ghost — so the third state was near-dead in production while the case its own docblock describes rendered green.

**Fix** `apps/dispatch/src/features/board/driver-list.tsx` — a new module-level `rowFreshness(driver, nowMs, boardStale)`, used by **both** `DriverRow` and the `silent` filter, so the label and the live-region summary cannot drift:

```ts
if (boardStale || driver.location === null) return 'unknown';
return driverFreshness(nowMs, driver.lastSeenAt);
```

**Test** `driver-list.test.tsx` — *"refuses «Raida» for a driver who has NEVER sent a fix (failure)"*, fixture `{ location: null, lastSeenAt: seenAgo(2_000) }` — the fixture the suite was missing (the existing `never` sets **both** to null and so passed through `driverFreshness`'s own null branch).

**Run against the UNFIXED code** (`observed` 2026-09-20, reverting only the `driver.location === null` clause):

```
FAIL … > refuses «Raida» for a driver who has NEVER sent a fix (failure)
Expected element to have text content:
  Nav signāla
Received:
  Jānis+37129999001CentrsRaida
 ❯ driver-list.test.tsx:185:42
Tests  1 failed | 11 passed (12)
```

Only that test reddened — the fix changes nothing else in the suite.

**New failure mode this fix's mechanism introduces** (Critical/High rule): a driver becomes `unknown` at the *instant* they go online and stays so until their first fix, so the live region now names them at login — where before the summary was silent. That is the `silent` filter picking up a state it previously never saw. Accepted rather than scoped, and argued in the docblock: `findNearby` filters candidates on the position, so a driver the console cannot place is one the engine will not offer to either, and phoning them is the correct response. It is also consistent with the shipped AC test, which already asserts `unknown` belongs in the summary. **Tested**: the same test asserts the region names `noLock`, so the behaviour is pinned rather than incidental. The second-order case — a *malformed* coordinate also yields `location: null` (`redis-driver-location.store.ts:251-254` validates rather than casts), so a reporting driver with a bad fix reads «Nav signāla» — is stated in the docblock as the cautious direction.

### F2 · The panel attributes the console's own deafness to the drivers

**Wrong because** `driverFreshness` compares a ticking `nowMs` (1 Hz, `use-board.ts:98,187-190`) against a `lastSeenAt` that freezes the moment frames stop. Nothing distinguishes *this driver stopped reporting* from *this console stopped receiving*. Worst case is the cold refresh: `hydratedBoard()` restores an arbitrarily old frame with `lastFrameAtMs: null` deliberately, so the first paint would read «Klusē MM:SS» for every driver while every phone streams normally — banner and false rows on the same paint.

**Fix** `boardStale` threaded from `page.tsx:273` as `boardStale={showStaleBanner}` — the same condition the banner renders on, one derivation for both. Inside that branch `frame !== null` holds, so it reduces to `pill === 'offline' || isStale(nowMs, board.lastFrameAtMs)` exactly. The region stays **mounted and empty** (`boardStale || silent.length === 0 ? '' : …`), never conditionally rendered — plan `:281` requires it in the DOM at all times.

**The prop is REQUIRED, not optional-defaulting-to-`false`.** The review's probe used an optional prop; that would let a future mount site drop the discriminator and silently restore the defect with every test still green. Required makes *omitting* it a typecheck failure. Passing a *wrong* value still compiles, which is what the page-level tests below are for.

**Tests**
- `driver-list.test.tsx` — *"blames nobody while the BOARD is the thing that went quiet (failure)"*: three drivers, `boardStale`, all three rows «Nav signāla», region present and empty.
- `dispatch-page.test.tsx`, a new describe — *"reads the drivers as silent while the board itself is fresh (expected)"* is the control (banner absent, «Klusē 01:30» present, so the label below is the panel's derivation and not a fixture artefact); *"shows «Nav signāla» instead of «Klusē» once the board is stale (failure)"*; *"announces nobody on a hydrated cold refresh (failure)"* (`lastFrameAtMs: null`). The two pre-existing page-level cases both supply `lastFrameAtMs: NOW` and `pill: 'live'`, so `showStaleBanner` is `false` in each and **neither exercises the prop's value at all** — these are the cases that go red if the thread is cut.

**The control test does real work.** It was strengthened after the first push, because a pair like this can be green-by-accident: if the fixture produced an empty region either way, the two failure cases would pass for a reason unrelated to `boardStale`. Probed it (`observed` 2026-09-20, throwaway `console.log` of every `[aria-live="polite"]` region's `textContent`, since removed):

```
FRESH-BOARD regions: 2 [ '"Tiešraide"', '"Klusē: Anna"' ]
STALE-BOARD regions: 2 [ '"Atjaunojas…"', '""' ]
```

So the summary is populated when the board is fresh and empty when it is stale — the right reason. The control now asserts both the region **count** (2 — the connection pill's and the driver summary's; a dropped region cannot pass as an empty one) and that the summary **does** carry the silent driver's name; the cold-refresh case asserts the same count rather than `>= 1`. The comment claiming the second region is the alerts panel's was wrong and is corrected: it is `ConnectionPill`'s.

**Runs against the UNFIXED code** (`observed` 2026-09-20), both directions, and **re-run after the strengthening** — `Tests 2 failed | 8 passed (10)`, the same two cases:

```
# cut the thread only: page.tsx boardStale={showStaleBanner} → boardStale={false}
FAIL … > shows «Nav signāla» instead of «Klusē» once the board is stale (failure)
FAIL … > announces nobody on a hydrated cold refresh (failure)
Tests  2 failed | 8 passed (10)

# drop the condition only: rowFreshness `boardStale ||` removed
FAIL … > shows «Nav signāla» instead of «Klusē» once the board is stale (failure)
FAIL … > blames nobody while the BOARD is the thing that went quiet (failure)
Tests  2 failed | 20 passed (22)
```

**New failure mode this fix's mechanism introduces**: the panel now goes quiet in the one situation an operator might most want it — a board that has lost its socket says nothing about any driver, so a genuinely dark driver is hidden behind «Nav signāla» for as long as the console is deaf. That is deliberate (an unprovable claim is the defect the whole ticket is about) but it is a real blind spot, so the **runbook now carries it**: step 5 tells the operator to check the banner first and read the api console, which is primary anyway. Covered by the control test, which proves the panel does *not* go quiet when the board is fresh.

### F3 · The comment justifying the missing `NaN` guard cited the two paths that *do* parse

**Wrong because** `use-board.ts:61,116` are the `localStorage` restore and the HTTP snapshot — the cold-start paths. The live paths call no `.parse()`: `:154` (`applyFrame`) and `:158` (`applyDriverLocation`, the highest-frequency writer of `lastSeenAt`). The fail direction is the bad one: `Date.parse` → `NaN`, `NaN >= x` → `false` → `'live'`.

**Fix** `board-state.ts` — the comment now says what actually holds (`realtime.service.ts:81` parses every emit server-side), names the two cold-start vs two live paths, and cites #237. Plus the guard the review made optional:

```ts
if (Number.isNaN(ageMs)) return 'unknown';
```

**Test** `board-state.test.ts` — *"fails an unparseable timestamp to unknown, never to live (failure)"*.
**Run against the UNFIXED code** (`observed`, guard line removed): `AssertionError: expected 'live' to be 'unknown'` · `Tests 1 failed | 18 passed (19)`.

**Issue filed**: **#237** — `apps/dispatch` is the only one of the three apps that does not validate inbound socket payloads (`apps/driver` does at `use-offers.tsx:201,216` and `use-active-ride.tsx:168,176`; `apps/rider` at `use-ride-status.tsx:200`). `use-board.ts` is not in this diff, so it is a ticket, not an inline fix.

### F4 · Step 5 told the operator a «Klusē» row *is* a failure

`docs/runbooks/driver-device-day.md:247`. Step 5 is one of the four the Verdict rule at `:321` makes binary, so a false ❌ invalidates a device day. The cell now carries the dependent clause and the reason for it: a «Klusē» row is a ❌ **only while the board itself is not stale**; if «Nav jaunu datu» (or «Bezsaistē») is up the rows read «Nav signāla» and say nothing about the phone. F10's `>=` correction is in the same sentence.

### F5 · "in seconds rather than minutes" described only the failure state

`docs/runbooks/driver-device-day.md:248`. `console.driver_streaming` is bare «Raida» with no `{age}` placeholder (`lv.ts:72`); `driver-list.tsx` interpolates `{age}` into `console.driver_silent` only. So on a *passing* run the promised counter does not exist and the `HH:MM` line the operator was told is coarser is the one actually moving. The cell now says the `MM:SS` is a **silence** age that appears only once a stream has stopped, and names the inversion explicitly. **Scope honoured**: plan `:338` GOTCHA 2 freezes step 6's `HH:MM`/`timeOf` note (#224's observation) — untouched; only the sentence *this PR appended* to the cell was rewritten.

### F6 · The phone rendered as unclickable text

`driver-list.tsx:88` was a plain `<span>`. Mirrored `zone-grid.tsx:130-141` — `<a href={`tel:…`}>` with `minHeight: 44`, `display: 'inline-flex'`, `alignItems: 'center'`. It matters more here than in the zone grid, not less: this panel is the only surface carrying a driver in **no zone queue**, which is exactly the driver the feature exists to surface.

**Test** *"makes the phone dialable in one tap (expected)"* — asserts `role="link"`, the `href`, and `minHeight: 44px`.
**Run against the UNFIXED code** (`observed`, reverted to a span): `Unable to find an accessible element with the role "link" and name "+37129999003"` · `Tests 1 failed | 11 passed (12)`.

### F7 · "Its text changes only when the SET changes"

Order is `frame.drivers`' → `listOnline`'s → `SMEMBERS`, documented as not guaranteed (`driver-location.store.ts:88`). Fixed by making the claim true rather than softening it: `.sort()` before `.join(', ')`. The docblock states what the sort buys — **stability**, the same set producing the same string — and explicitly **not** alphabetical order, since `sort()` is code-unit order and mis-sorts Latvian diacritics. Claiming alphabetical would have been a fresh false claim on the line being repaired.

**Test** *"sorts the announced names so SMEMBERS order cannot re-announce (edge)"* — same set as the summary test, opposite input order, same expected string.
**Run against the UNFIXED code** (`observed`, `.sort()` removed): `Expected: Klusē: Anna, Pēteris` · `Received: Klusē: Pēteris, Anna` · `Tests 1 failed | 11 passed (12)`.

### F8 · A deferral naming no ticket

`board-state.ts:218`. Filed **#238** (carry a server-client offset from `frame.at`; scoped to *all* board ages, not just `driverFreshness`, because fixing one alone would leave ride ages and driver freshness on different clocks). Cited in the docblock and in the plan's §NOTES.

### F10 · `>=` rendered as "older than"

`driverFreshness` is `ageMs >= TTL` (`board-state.ts`), so it flips **at** 60 s. The runbook now says "once the last fix reaches `DRIVER_LOCATION_TTL_SECONDS` (60 s) — **at** 60 s, not after it".

---

## Copy sweep

Per-value/per-noun `grep -n`, run in the worktree at the fixed tree. Listed so the reviewer diffs a list rather than trusting a sentence.

| # | Retired value / noun | Command | Hits and what was done |
|---|---|---|---|
| S1 | `older than` (F10's boundary) | `grep -rn "older than" docs/runbooks/driver-device-day.md .claude/plans/board-driver-freshness-234.md apps/dispatch/src/features/board/ packages/shared/src/driver-presence.ts packages/shared/src/realtime-events.ts` | 2 hits, **both checked and left**. `board-state.ts:181` is `isStale`'s heartbeat, a different boundary. `driver-presence.ts:7` — *"the api drops a position older than this from `findNearby`"* — is **accurate**: `zrangebyscore(seenKey, freshSinceMs, '+inf')` (`redis-driver-location.store.ts:162`) is **inclusive**, and `freshSinceMs = Date.now() − TTL×1000` (`driver-location.service.ts:106`), so a position at exactly 60 s is still a candidate. The board's `>=` gives up one millisecond sooner, which is the cautious direction and keeps the file's own guarantee (the console cannot say live while dispatch has stopped offering). |
| S2 | `seconds rather than minutes` (F5) | `grep -rn "seconds rather than minutes\|rather than minutes" docs/ .claude/plans/ apps/dispatch/src/` | 1 hit, `driver-device-day.md:248` — corrected in place; the phrase survives only inside the sentence that now names it as the wrong expectation. |
| S3 | `Klusē` outside code and catalogs (F4) | `grep -rn "Klusē" docs/ .claude/plans/` | 13 hits. Two in the runbook (`:247`, `:248`) corrected. **`:306` found and corrected — a THIRD runbook site the review did not list** (see below). Plan hits at `:232`, `:257`, `:259`, `:335`, `:422`, `:423`, `:474`, `:494`, `:495` are task text or catalog tables; `:499` corrected (see below); `:511` corrected for F8. **Plan line numbers in this row are as of round 1's head (`0de221f`)** — round 2's M2/M3 edits move them, and round 2's report re-runs this grep at its own head. |
| S4 | `SET changes` (F7's guarantee) | `grep -rn "SET changes\|set changes" apps/dispatch/src/ .claude/plans/ docs/` | **0 hits** — the claim is retired, not merely softened. |
| S5 | `its own ticket` (F8's unnumbered deferral) | `grep -rn "its own ticket\|is its own\|own ticket" apps/dispatch/src/ packages/shared/src/ .claude/plans/board-driver-freshness-234.md docs/runbooks/driver-device-day.md` | **0 hits.** |
| S6 | `use-board.ts:61,116` (F3's false citation) | `grep -rn "61,116\|Unreachable" apps/dispatch/src/ .claude/plans/` | 1 hit, `board-state.ts` — the reference survives only inside the corrected sentence, which now names those two as the cold-start paths. |
| S7 | `\b60\b\|60_000\|60000` in the board slice (F9) | re-derived on the **pushed** head — see §F9 below | — |

### Two corrections the sweep found that the review did not list

**`docs/runbooks/driver-device-day.md:306`** — the §Verdict paragraph said the row *"reads «Raida» or «Klusē MM:SS»"*. Two labels, three states; and after F1/F2 the third is reachable in ordinary operation rather than only on a deploy ghost. Corrected to name all three and to say what «Nav signāla» means to the operator — *the console cannot vouch for this driver* — covering both the never-a-fix case and F2's deaf-console case. This is the same undercount DV2 recorded for the original task: the review named two sites, there were three.

**`.claude/plans/board-driver-freshness-234.md:499`** — §UX → States said: *"an offline console showing «Klusē» for everyone is telling the truth about what it knows."* That is F2 stated as intent. **The plan specified the defect**, so fixing only the code would have left the plan asserting the opposite of what shipped. Replaced, with a `SUPERSEDED` note quoting the original.

Also corrected: **§D2's 75 s derivation** cited `driver-location.policy.ts:30,33`; the constants are at **`:40,46`** (`observed` — `grep -n` on the file). The arithmetic and the figure are right; the provenance ref was not. (Named by section rather than by plan line — it was `:474` at this round's head, and round 2's plan edits move it.)
Left as written: **`:335`**'s task text says the row flips *"past"* the TTL. It is a historical instruction rather than a live claim, and the runbook it produced now states the boundary correctly; recorded in the plan's AMENDMENTS instead.

One more claim amended, in this PR's own diff: **`packages/shared/src/realtime-events.ts:183-189`** justified shipping `lastSeenAt` raw on the grounds that *"the client has both this field and its own clock"* — which is the exact pair F2 shows goes wrong. The justification still holds; the docblock now also names the two things a consumer must supply itself (whether a position was ever recorded, and whether its own feed is alive).

---

## Validation

`observed` 2026-09-20 in `/Users/Berzins/Desktop/taxi-wt-234`, after clearing `apps/dispatch/.next` and every `dist` via `fs.rmSync`:

```
env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force

 Tasks:    22 successful, 22 total
Cached:    0 cached, 22 total
  Time:    1m26.113s
```

`EXIT=0`. No suite flaked; no re-run was ever needed for a red.

**The gate ran three times, and these are the THIRD run's figures.** Each re-run was a re-anchoring, not a retry:

| run | wall | why it stopped describing the tree |
|---|---|---|
| 1 | `1m29.706s` | `npx prettier --write` had also reformatted five blocks I did not write — `board-state.test.ts` ×4, `page.tsx`'s `<h1 tabIndex={-1}>`, two `mount('live', …)` calls in `dispatch-page.test.tsx`. Reverting those changed three files after the run. |
| 2 | `1m22.337s` | the figures behind commit `bd10e9c`. Superseded by the control-test strengthening (see F2), which changed `dispatch-page.test.tsx` again. |
| 3 | `1m26.113s` | **current** — the committed tree. |

`git diff` shows no deletion in any changed file that does not trace to a finding (`observed` — the deletion-only diff reviewed file by file, twice: once before each commit).

| package | before this pass (review's run) | after |
|---|---|---|
| `@taxi/api` | 2 skipped, 75 passed suites · 39 skipped, 694 passed, 733 total | **identical** — no api source touched |
| `@taxi/dispatch` | 28 files, 238 passed | **28 files, 246 passed** (+8) |
| `@taxi/shared` | 24 files, 231 passed | **identical** — comment-only change |
| `@taxi/driver` | 44 suites, 250 passed | untouched |
| `@taxi/rider` | 30 suites, 145 passed | untouched |
| `@taxi/db` | 3 files, 17 passed | untouched |

**+8 dispatch tests, derived and counted**: `driver-list.test.tsx` +4 (F1, F2, F7, F6), `dispatch-page.test.tsx` +3 (F2's control + two failure cases), `board-state.test.ts` +1 (F3). 238 + 8 = 246 ✓. The dispatch and shared figures are `observed` from a separate `turbo run test --force --filter=@taxi/dispatch --filter=@taxi/shared`, which prints the per-package summaries the full gate's tail elides.

The 39 skipped are the documented Redis-gated suites with `REDIS_TEST_URL` unset, matching `CLAUDE.md`'s baseline.

---

## F9 — the PR body's AC #3 enumeration

Left until **last** deliberately: F1's new fixture, F7's `.sort()` test and F3's guard test all add hits to that grep, so re-deriving it before the final commit would have shipped a third wrong version of the same table. Order run: every edit → commit → push → re-derive on the pushed head → `gh pr edit`.

`observed` at the pushed head `bd10e9c` — **8 hits**, where the body claimed "the only hits are `age.ts`'s" and the review counted six at `7ca9217`:

```
driver-list.test.tsx:47    lastSeenAt: seenAgo(3 * 60 * 60 * 1000),
driver-list.test.tsx:63    // 01:30 = TTL (60 s) + 30 s of further silence.
driver-list.test.tsx:177   // live — green «Raida» for a phone that has reported nothing, for 60-75 s
driver-list.test.tsx:178   // (TTL 60 + sweep 15) and UNBOUNDED once force-assign makes them
age.ts:17                  const minutes = Math.floor(totalSeconds / 60);
age.ts:18                  const seconds = totalSeconds % 60;
board-state.test.ts:229    * … never against `60`.
board-state.test.ts:256    driverFreshness(NOW, new Date(NOW - 3 * 60 * 60 * 1000)…
```

Two of the six→eight are mine (`:177-178`, F1's docblock). None is a threshold literal, so the AC's own wording ("finds no threshold literal") was satisfied before and is satisfied now; it is the body's restatement of the command's output that was false. The other AC #3 grep re-checked at the same head: `grep -rn "DRIVER_LOCATION_TTL_SECONDS *=" packages/shared/src services/api/src apps/dispatch/src` → `packages/shared/src/driver-presence.ts:26`, sole hit.

### One more body figure re-derived, because these fixes moved it

The body claimed the page-level map-view case is the only thing pinning the panel outside the ternary: *"Moving the panel into the zones branch turns it red and leaves the other six green."* The round-1 fixes add three page-level cases, so "six" was stale by construction. Re-derived rather than adjusted (`observed` 2026-09-20 — moved the panel inside the `view === 'zones'` branch under a fragment, ran `npx vitest run --root apps/dispatch src/features/board/dispatch-page.test.tsx`, reverted, worktree clean):

```
FAIL … > still shows it after switching to the map view (edge)
Tests  1 failed | 9 passed (10)
```

The claim survives — that case is still the only red — and the body now says "every other page-level case" with the count `observed` beside it, rather than a digit that goes stale on the next test added.

## Not done

- **No manual/VoiceOver walkthrough.** Unchanged from the PR body's existing statement; F6's `tel:` link and F2's empty live region are covered by automated assertions on role/href/style and on region text, not by a screen-reader pass.
- **#237 and #238 are filed, not fixed.** Both are out of #234's scope by the review's own reasoning.
