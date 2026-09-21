# PR #236 review — round 2

**Head** `0de221f` · **Base** `main` @ `b8d62c58` · **Reviewed** 2026-09-20 · **Round** 2 (prior: `.claude/code-reviews/pr-236-review.md`)

`feat(dispatch): render per-driver stream freshness on the board (#234)` — 21 files, +1743 −40 at head.
Reviewed in a detached worktree at `0de221f`, not in the author's tree.

## Verdict: request changes

**0 Critical · 0 High · 3 Medium · 4 Low.**

All ten of round 1's findings are genuinely closed — each re-checked against the code rather than against
the fix report's prose, and the strongest of its probes reproduced rather than inherited. The gate is
green and every figure in the PR body survived re-derivation, which is worth saying plainly: this repo
has shipped a false PR-body number to `main` three times, and this is the first round in a while where
the numbers pass found nothing but one stale commit count.

Two of the three Mediums are consequences of round 1's own fixes — the class this round exists to look
for. The third is a provenance break this PR caused in a runbook whose step-7 derivation it invalidated,
and which round 1's copy sweep fixed *in the plan* while editing the runbook that still carries it.
Nothing here disputes the approach or the two Highs' fixes.

## Passes run this round

- **Guarantees pass — SKIPPED, and the trigger is recorded rather than remembered.** `git fetch origin
  --prune && git rev-parse origin/main` → `b8d62c58`, identical to the `**Base** … @ b8d62c58` in round
  1's header (`observed` 2026-09-20). The base has not moved under this PR, so no guarantee on the branch
  was written against a tree that has since changed. `mergeStateStatus: CLEAN` corroborates; it is not
  the comparison.
- **Fix-mechanism pass — RUN.** M2 and M3 come from it.
- **Constraint pass — RUN.** `grep -in "do not modify\|do not edit\|read-only\|no changes to\|frozen"`
  on `.claude/plans/board-driver-freshness-234.md` → 2 hits, `:478` and `:547`, both the word "frozen"
  describing a frozen car on a tracking page and a frozen `lastSeenAt`. Neither is a scope guard. No fix
  below touches a frozen surface. Plan `:338`'s GOTCHA (step 6's `HH:MM`/`timeOf` note from #224) was
  diffed byte-for-byte across `b8d62c58..0de221f` and its protected sentences are untouched — the PR
  body's "scope honoured" claim is `observed`, not taken on trust.
- **`code-reviewer` agent — DISPATCHED**, given round 1's closed list so it spent its pass on the delta.
  It returned 0 Critical, 0 High, 2 Medium, 4 Low. Its strongest finding (M1 below) is one this pass had
  not found; every one of its findings was re-verified here before entering this report, per
  `taxi-review-payoffs-are-claims`. Where our severities differ it is noted inline.
- **Numbers pass — RUN**, every figure re-derived rather than inherited. Results in §Numbers.

## Medium

### M1 · This PR shifted `driver-location.policy.ts` down 10 lines and broke four provenance refs — including the one under step 7's binary verdict

`docs/runbooks/driver-device-day.md:318,320` · `.claude/plans/board-driver-freshness-234.md:29,179`

Commit `3615a9a` adds an import and an expanded re-export docblock to the top of
`services/api/src/features/drivers/location/driver-location.policy.ts`, moving every constant in the file
down by exactly 10 lines. Four citations still point at the old numbering. `observed` 2026-09-20 —
`grep -n "^export const\|^export {"` on the file at `b8d62c58` and at `0de221f`:

| constant | at base `b8d62c58` | at head `0de221f` |
|---|---|---|
| `DRIVER_LOCATION_TTL_SECONDS` | `:15` (declared) | **not declared there** — re-exported `:25`, declared `packages/shared/src/driver-presence.ts:26` |
| `PRESENCE_DARK_AFTER_SECONDS` | `:30` | `:40` |
| `PRESENCE_SWEEP_INTERVAL_MS` | `:36` | `:46` |
| `OFFLINE_NUDGE_DELAY_SECONDS` | `:42` | `:52` |

The four broken sites, all inside this PR's diff:

1. **`driver-device-day.md:318`** — `` `driver-location.policy.ts:36,42` `` → `:46,52`.
2. **`driver-device-day.md:320`** — `` (`:15,30`) `` → `PRESENCE_DARK_AFTER_SECONDS` is `:40`, and the
   TTL is no longer in that file at all. Since moving it is this PR's AC #3, the ref should now read
   `packages/shared/src/driver-presence.ts:26`.
3. **`board-driver-freshness-234.md:29`** — `` (`derived`, from `driver-location.policy.ts:30,33`) `` for
   the 75 s figure. **This is the twin of `:474`, which round 1's copy sweep did correct** to `:40,46`
   (fix report `:162`). The sweep fixed one instance of the citation and missed the other in the same
   file. `:33` was never right — `PRESENCE_SWEEP_INTERVAL_MS` was at `:36` even at base.
4. **`board-driver-freshness-234.md:179`** — the GOTCHA citing the api-only Redis rationale at
   `` `driver-location.policy.ts:7-14` ``. The instruction was *followed* (the paragraph stayed), but it
   now sits at `:19-23`; `:7` is the new import line.

**Why this is Medium and not cosmetic.** `driver-device-day.md:315-321` is the derivation behind step 7's
2-minute window, and step 7 is one of the four steps the Verdict rule at `:325` makes binary. The
arithmetic is right (`≤15 + 30 + ≤15 = 60 s`); only the provenance is wrong — which is the exact defect
shape CLAUDE.md names: *"a figure under an Observed heading that no run produced is the defect even when
its arithmetic is correct."* A reader checking step 7's window opens `:36` and finds
`NEAREST_DEFAULT_LIMIT`'s neighbourhood.

**Fix** — correct all four, then re-run the **noun** grep rather than the sentence grep, which is what
round 1's sweep was missing a column for:

```
grep -rn "driver-location\.policy\.ts:" docs/ .claude/plans/ .claude/reports/ packages/ apps/ services/
```

**Three siblings, scoped honestly and not asked of this PR.**
`.claude/plans/driver-device-day-prep.md:371` carries the same `:36,42` but belongs to #141 and is not in
this diff. `.claude/plans/driver-app-auth-online-location.md:24` and
`.claude/reports/dispatch-override-phone-orders-zones-phase-c-report.md:319` cite `:15`; the second is a
historical record anchored to its own head and should be left alone.
**`board-driver-freshness-234.md:466` is correct as written** — it cites `:15` explicitly `observed at
b8d62c5`, which is the sha-anchored form that survives exactly this kind of move.

*(Found by the `code-reviewer` agent; verified here against both shas.)*

### M2 · `boardStale` inherits `pill === 'offline'`, so the panel blanks itself while the REST fallback is keeping the board current

`apps/dispatch/src/app/dispatch/page.tsx:108-110,283` · `driver-list.tsx:213-220`

F2's argument is entirely about **frame freshness** — `driver-list.tsx:81-89`: *"`driverFreshness`
compares a ticking `nowMs` against a frozen `lastSeenAt`, so a console that has stopped RECEIVING freezes
the numerator."* The value actually threaded is the banner's condition, which is wider:

```ts
const showStaleBanner =
  pill === 'offline' || (frame !== null && isStale(nowMs, board.lastFrameAtMs));
```

`pill === 'offline'` fires on `!browserOnline`, **or** on `!connected && failedAttempts >=
OFFLINE_AFTER_FAILURES` (`board-state.ts:257-262`) — neither of which says anything about frame age. And
`use-board.ts:211-222` starts a read-only REST poll *because* the pill is offline, whose success path is
`setBoard((s) => applyFrame(s, frame, Date.now()))` (`:117`) — so **a successful poll refreshes
`lastFrameAtMs` to now** (`observed` — read from both files at head).

The reachable case is the ordinary one: **websocket blocked, HTTP fine** — a proxy, a corporate network,
the state the poll fallback was built for. The board then carries a frame at most `POLL_MS` old and is
demonstrably current, while `boardStale` stays `true` and every row reads «Nav signāla» with the live
region empty. That is #234's feature disabled in a state where the data is good — the mirror image of the
over-claim F2 removed. The `!browserOnline` arm is the same shape and stays stuck until an `online` event
fires.

The docblock on the prop describes the narrower condition it no longer receives:
`driver-list.tsx:215-216` says *"The board has no fresh frame — `page.tsx`'s `showStaleBanner`"*. In the
polling state there **is** a fresh frame.

**No one-liner prescribed, deliberately.** The obvious fix — pass `isStale(nowMs, board.lastFrameAtMs)`,
already imported at `page.tsx:14` — collides with `POLL_MS === STALE_MS === 5_000`
(`board-state.ts:23,26`), so in exactly the polling state the panel would flap once per cycle. That is
plausibly why the union was chosen. Two defensible directions: give the panel its own window wider than
the poll cadence, or keep the union and make the prop docblock state what it costs while polling. Either
way `driver-list.tsx:215-216` should stop describing a narrower condition than it is handed.

Worth reproducing before acting on it — this finding is `derived` from the code path, not run.

*(Found by the `code-reviewer` agent; the `applyFrame`/`POLL_MS` mechanics verified here.)*

### M3 · The live region announces «Klusē» for a driver whose own row refuses to say it

`driver-list.tsx:245-252` · catalogs `packages/shared/src/i18n/lv.ts:80`, `ru.ts:65`, `en.ts:64` · pinned
by `driver-list.test.tsx:193-197`

`board-state.ts:194-197` states the doctrine in capitals: *"THREE STATES, NOT TWO. … never-streamed is a
different fact from stopped-streaming."* The row honours it — `unknown` renders «Nav signāla», never
«Klusē». The summary does not. `silent` is `rowFreshness(...) !== 'live'`, i.e. `stale` ∪ `unknown`, and
the one string it joins them into is:

| catalog | key | value |
|---|---|---|
| `lv.ts:80` | `console.drivers_silent_summary` | `Klusē: {names}` |
| `ru.ts:65` | same | `Молчат: {names}` |
| `en.ts:64` | same | `Silent: {names}` |

So a driver who has never sent a fix gets a row reading «Nav signāla» and an announcement reading
«Klusē: Jānis» — the summary collapses to two states exactly where the row insists on three, and picks
the *stopped-streaming* word for the *never-streamed* case. The sighted operator reads the honest label;
the screen-reader user, for whom the live region is the primary channel, hears the over-claim.

**Why round 2's and not round 1's.** The mismatch was reachable before F1 and the fix report says why it
did not matter: `unknown` then required `lastSeenAt === null` — *"the third state was near-dead in
production"*, a deploy ghost. F1 makes `unknown` the state of **every driver from go-online until their
first fix**, which `driver-list.tsx:92-96` accepts in writing (*"the live region names them at login"*).
Rare-and-wrong became routine-and-wrong; F1's mechanism newly permits it.

The test locks it in rather than catching it. `driver-list.test.tsx:193-197` asserts the region carries
`drivers_silent_summary` for the no-lock fixture under a comment reading *"the row and the region share
one derivation, so neither can drift from the other."* They share the derivation and still drift, because
the drift is in the **words**.

**Fix — scope it precisely.** Change `console.drivers_silent_summary` **only**, in all three catalogs, to
a state-neutral phrase claiming just what `!== 'live'` proves — LV «Nav datu: {names}», EN "Not
reporting: {names}", RU «Без данных: {names}». **Leave `console.driver_silent` («Klusē {age}») alone**:
it is the row label for the genuinely-`stale` case and is correct, and F4/F5/F10's runbook wording
depends on it. A `grep` for `Klusē` that sweeps both would undo round 1. No code change and no test
change — the four assertions referencing this key
(`driver-list.test.tsx:93,122,194,242`) build their expectation through `formatMessage` and follow the
catalog. The plan's breadboard (`:494`) shows «Klusē: Jānis, Anna» and should move with it; that line
predates F1 and under-specifies for the same reason `:499` did, which round 1 already had to supersede.

The constraint pass found nothing freezing the catalogs or this key, and AC #2 ("not colour alone") is
satisfied either way — this makes the words more accurate, not fewer.

*(The agent scored this Low, on the grounds that both states lead the operator to the same action — ring
the driver. Kept at Medium here because a test pins the wrong wording, so it will survive refactors
silently, and because the a11y channel is where AC #2 actually lands.)*

## Low

### L1 · The slice's public API exports the derivation F1 proved insufficient, and hides the one that is correct

`apps/dispatch/src/features/board/index.ts:6,10`

F1 split one derivation into two: `driverFreshness(nowMs, lastSeenAt)` reads a timestamp;
`rowFreshness(driver, nowMs, boardStale)` (`driver-list.tsx:105`) also refuses «Raida» without a recorded
position or a live feed. The correct one is module-private. The insufficient one is published, along with
its type.

Before F1 that export was coherent — `driverFreshness` *was* the whole derivation. After F1 the slice's
front door hands a caller exactly the function whose sole use produced two High findings, with only a
docblock between them and the defect.

It also makes the line above it false. `index.ts:1-3` says *"The board slice's public API — the /dispatch
page composes exactly these."* The page composes seven of them (`page.tsx:9-17`); it does not compose
`driverFreshness`, and nothing anywhere composes `DriverFreshness`.

**Verified, not assumed** (`observed` at `0de221f`): every hit of `driverFreshness` across
`apps/dispatch/src packages/shared/src services/api/src` outside `board-state.ts` is `index.ts:6`, a
docblock mention, or an import from `./board-state` — `driver-list.tsx:11` and `board-state.test.ts:12`
both reach past the barrel to the module (`board-state.test.ts:21` is `from './board-state'`). **Zero
consumers outside the slice, for either symbol**, so deleting both barrel lines cannot break the suite.

**Fix** — drop `driverFreshness` from `index.ts:6` and `DriverFreshness` from the type block at `:10`.
Two tokens. The docblock's "exactly these" becomes true, and the only freshness derivation reachable from
outside the slice is the one that cannot say «Raida» without evidence. If a future surface needs one, the
export to add is `rowFreshness`.

### L2 · The AC #2 test's closing assertion compares two catalog constants and never touches the panel

`driver-list.test.tsx:151-153`

```ts
expect(formatMessage('lv', 'console.driver_streaming')).not.toBe(
  formatMessage('lv', 'console.driver_silent', { age: '01:30' }),
);
```

Both operands are catalog lookups. Nothing rendered participates, so it stays green if `DriverRow` drops
the label, renders both states identically, or is deleted — the opposite of its comment (*"The two states
must not share a label — that is the whole defect"*). The two `toContain` assertions above it read
`live().textContent` and do real work; this one supplies confidence it has not earned, in the test named
for #234's AC #2.

**Fix** — assert on the rendered rows: take the last child of `rows[0]` and `rows[1]` and require their
`textContent` to differ, keeping the existing `toContain` checks.

*(Found by the `code-reviewer` agent; confirmed by reading — both operands are `formatMessage` calls.)*

### L3 · The empty state asserts current knowledge on a stale board — F2's defect in the branch F2 did not reach

`driver-list.tsx:262-271`

F2 threaded `boardStale` into the rows and the live region. The empty branch was left alone, so a deaf
console with a hydrated frame carrying no drivers says «Neviens šoferis nav tiešsaistē» — *no drivers
online*, a present-tense claim from a board that has stopped receiving.

Low on two counts: the stale banner is on screen in every such state by construction (`boardStale` *is*
`showStaleBanner`), and the heading's `({drivers.length})` reads `(0)` beside it. The plan shares the gap
— `:499` specifies *"empty — `console.drivers_empty`"* unconditionally — so this is not a divergence from
it. Either make the string `boardStale`-aware or note that the banner is considered sufficient; the
second is a legitimate answer and costs one comment.

### L4 · "Four atomic commits" does not count the PR's commits

PR body, §What changed, first line.

The PR has **7** commits (`git log --oneline b8d62c58..0de221f | wc -l` → 7, `observed`). The body names
**6**: four in §What changed (`858114d`, `3615a9a`, `1663bf9`, `ea7820c`) and two in §Review round 1
(`bd10e9c`, `0de221f`). **`7ca9217`** — `docs(plans): record #234's two deviations and tick its
acceptance criteria` — is named nowhere.

Cosmetic; nothing de-scopes on it, which is why it is Low. Listed because this project treats a number in
a PR body as a claim, and the body is the one surface no working-tree grep reaches. **Fix**: say seven
and fold `7ca9217` into the list, or drop the count and keep the three groups.

## Checked and clear — including the things that looked like findings

Recorded so the next round does not re-spend the time; three of these were live hypotheses the code
refuted.

- **`rowFreshness` can now reach `unknown` with a non-null `lastSeenAt`, so the `age` interpolation runs
  where it was previously always `''`.** This looked like «Nav signāla 00:03». It is not:
  `console.driver_no_signal` carries no `{age}` placeholder in any catalog (`lv.ts:76`, `ru.ts:64`,
  `en.ts:63`) and `formatMessage` ignores extra params, so the call is inert.
  `driver-list.tsx:164-167`'s comment says exactly this and is accurate. **Refuted.**
- **F1's guard could have been protecting an unreachable state.** It is not.
  `board.service.ts:185-205` `flatMap`s `listOnline` and drops a driver only when no `contacts` row
  exists (an FK impossibility); `location: d.location` passes through untouched. The store interface says
  so in writing (`driver-location.store.ts:85-90`: *"EVERY member of the online set, with whatever
  position is recorded … NO freshness filter"*) and the wire schema is `latLngSchema.nullable()`
  (`realtime-events.ts:289`). A position-less online driver does reach `frame.drivers`. **F1 is
  load-bearing**, and this is the check that makes saying so mean anything.
- **F2's page-level pair could have been green for F1's reason.** It is not: `SILENT_DRIVER`
  (`dispatch-page.test.tsx:144-155`) carries `location: { lat: 56.95, lng: 24.11 }` and `FRESH_DRIVER`
  spreads it, so `rowFreshness`'s `location === null` clause never fires and `boardStale` is the only
  thing under test. The fixture also derives `lastSeenAt` from the **imported**
  `DRIVER_LOCATION_TTL_SECONDS` — AC #3 honoured in the test data too.
- **The `tel:` link has a real focus treatment, and the mirror is complete.**
  `apps/dispatch/src/app/dispatch/layout.tsx:25-28` sets
  `.console a:focus-visible { outline: 3px solid var(--color-accent); outline-offset: 2px; }` and
  `page.tsx:129` puts `className="console"` on the `<main>` wrapping both `DriverList` and `ZoneGrid`.
  Attribute-for-attribute `driver-list.tsx:129-141` is byte-identical to `zone-grid.tsx:130-141`.
  CLAUDE.md's 44px + visible-focus rule is satisfied. (Note the path: the docblock cites
  `zone-grid.tsx:130-141` with no directory and the file is in the **zones** slice.)
- **F7's `.sort()`.** `silent.map(d => d.name).sort()` sorts the array `map` just allocated, so nothing is
  mutated in place; `name` is `z.string()` so no `undefined` reaches the comparator. The docblock's claim
  is carefully hedged — stability, explicitly *not* alphabetical, code-unit order and Latvian diacritics
  named — and the hedge is correct. Two drivers sharing a display name would render `Klusē: Jānis, Jānis`;
  only set-stability is claimed, so that is not a false claim.
- **F2 re-announces the same set when a flaky console flaps.** Real — the region text is a function of
  (set, `boardStale`), so a >5 s frame gap empties it and recovery re-announces the same names. Not raised
  separately: `aria-live="polite"` queues rather than interrupts, the connection pill's own region flaps
  identically on the same edge, and the banner appears alongside. It is subsumed by M2, which is where the
  fix decision belongs.
- **Step 5's «Klusē»-while-stale conditional** (`driver-device-day.md:247`). The agent argued it is
  unreachable — after F2 the banner and the panel render off the same boolean in the same paint, so a
  «Klusē» row and a stale banner cannot co-occur, and the "because" clause explains the pre-fix failure.
  Both observations are correct; **not raised as a finding** because the clause is the *rationale* for a
  check the UI happens to enforce, and an operator reading a runbook benefits from knowing why. Cutting it
  would remove the only place the trade is explained to the person running the device day. Recorded so the
  next round does not re-litigate it.
- **The constant promotion is behaviour-neutral, and the test count was not taken for it** (the PR body
  asked the reviewer not to). Exactly one declaration — `packages/shared/src/driver-presence.ts:26` —
  re-exported at `driver-location.policy.ts:25`, so `driver-location.service.spec.ts:11`'s
  `from './driver-location.policy'` resolves unchanged; `PRESENCE_DARK_AFTER_SECONDS` aliases it at `:40`;
  `packages/shared/src/index.ts:7` re-exports the module. The api's `39 skipped, 694 passed, 733 total`
  being byte-identical to the baseline is corroboration, not the argument.
- **The `realtime-events.ts` amendment is honest.** The half that stands (raw `lastSeenAt`, no
  pre-computed flag) is kept; the half that stopped being true (each client picking its own threshold) is
  replaced, and `:191-196` now names the two things a consumer must supply itself. It cites an app file
  from inside `packages/shared`, which inverts the dependency direction *in prose only* — no import, and
  the repo cross-references this way elsewhere.
- **`max-lines` 500**: `driver-list.tsx` 290, `board-state.ts` 267, `page.tsx` 342, `age.ts` 20,
  `driver-presence.ts` 26. All clear, no `max-lines` disable anywhere.
- **i18n / theme / types**: no hardcoded user-facing string — every label goes through `formatMessage`,
  and `FRESHNESS_KEY`/`DRIVER_STATUS_KEY` are `Record`s total over their unions, so a fourth state cannot
  ship without a catalog entry. All six new keys exist in all three catalogs. Every colour, spacing,
  radius and font size is a `var(--…)` semantic token. No `any`, no `as`, no `@ts-ignore` in the diff;
  `BoardDriver` is `DispatchBoardEvent['drivers'][number]`, i.e. `z.infer`-derived.
  `const LANG: Language = 'lv'` matches all ten existing dispatch components.
- **Slice boundaries**: the board slice reaches into no other slice. `ageOf` moved to its own `age.ts`
  precisely to keep `@/features/override` and `@/features/zones` out of the list's module graph — a
  documented deviation, and an improvement on what the plan preferred. `DRIVER_STATUS_KEY` being a second
  copy is argued at `driver-list.tsx:17-22` rather than solved by reaching into the zones slice.

## Numbers pass

Every figure in the PR body re-derived at `0de221f`. **One stale figure — L4's commit count. Everything
else exact.**

| claim | how checked | result |
|---|---|---|
| gate `22 successful, 22 total`, exit 0 | ran it in a fresh worktree | ✅ `22 successful, 22 total`, `EXIT=0` |
| `@taxi/api` 2 skipped / 75 passed suites · 39 skipped / 694 passed / 733 total | same run's tail | ✅ exact, and identical to `CLAUDE.md`'s baseline |
| `@taxi/dispatch` 28 files, 246 passed | separate `turbo run test --force --filter=…` | ✅ `Test Files 28 passed (28)` · `Tests 246 passed (246)` |
| `@taxi/shared` 24/231 · `@taxi/driver` 44/250 · `@taxi/rider` 30/145 · `@taxi/db` 3/17 | same run | ✅ all four exact |
| 5 `driverFreshness` · 12 `DriverList` · 5 page-level = 22 | `grep -cE "^\s*(it\|test)\("` at `b8d62c58` and head | ✅ board-state 14→19 (+5), driver-list 0→12 (new file), dispatch-page 5→10 (+5) |
| "8 of those arrived with the round-1 fixes" · dispatch 238 → 246 | same counts at `7ca9217` | ✅ driver-list 8→12 (+4), dispatch-page 7→10 (+3), board-state 18→19 (+1) = **8** |
| AC #3 grep → 8 hits, none a threshold literal, "unchanged at `0de221f`" | re-ran at the **head**, not at `bd10e9c` | ✅ 8 hits, line-for-line the body's list; `bd10e9c..0de221f` touches only `dispatch-page.test.tsx` and the report, neither contributing a hit |
| AC #3: exactly one `DRIVER_LOCATION_TTL_SECONDS =` | grep across all three trees | ✅ sole hit `driver-presence.ts:26` |
| 75 s = 60 + 15, `derived` | read both constants | ✅ `PRESENCE_DARK_AFTER_SECONDS` `:40`, `PRESENCE_SWEEP_INTERVAL_MS = 15_000` `:46` — figure and condition correct; **the plan's line refs for it are M1** |
| the four "head-independent" constants | read all four | ✅ `MIN_FIX_INTERVAL_MS = 4_000` (`fix-throttle.ts:9`), `distanceInterval: 0` (`location-options.ts:20`), `DRIVER_LOCATION_TTL_SECONDS = 60` (`driver-presence.ts:26`), `PRESENCE_SWEEP_INTERVAL_MS = 15_000` (`:46`) |
| runbook's «Nav jaunu datu» / «Bezsaistē» | `lv.ts:90-93` | ✅ both strings exist as quoted |
| `Tests 1 failed \| 9 passed (10)` map-view probe | reconciled against the file's case count | ✅ 10 page-level cases at head; every probe total in the fix report reconciles with the four files' counts |

**One of the fix report's probes reproduced rather than inherited**, because the report is credited below
for its probes and credit should be `observed`. Removed the `boardStale ||` clause from `rowFreshness`
(`driver-list.tsx:108`) and ran both spec files:

```
npx vitest run --root apps/dispatch src/features/board/driver-list.test.tsx \
                                    src/features/board/dispatch-page.test.tsx

 ×  DriverList > blames nobody while the BOARD is the thing that went quiet (failure)
 ×  DispatchPage — a deaf console … > shows «Nav signāla» instead of «Klusē» once the board is stale
 Tests  2 failed | 20 passed (22)
```

Byte-for-byte the pair the fix report claims, including *which two* — and the cold-refresh case correctly
staying green, because the JSX region guard at `driver-list.tsx:245` carries its own `boardStale` check
that this edit did not touch. Reverted; worktree clean at `0de221f`.

Two things worth crediting specifically, because this repo's standing failure mode is the opposite:

- **F9 was left until last on purpose**, and the fix report says why — F1's, F3's and F7's own new tests
  each add hits to that grep, so re-deriving before the final commit would have shipped a third wrong
  version of the same table. The stated order (edit → commit → push → re-derive on the pushed head →
  `gh pr edit`) is right, and the enumeration is correct at the head I checked.
- **The "one test earns its keep" claim was re-derived rather than adjusted** when the round-1 fixes moved
  it from six green to nine. Rewording it to "every other page-level case" makes it head-independent,
  which is the durable form.

## Round-1 fix verification

Each closed finding checked against the code; the fix report's probe output treated as a claim to
confirm, not a receipt.

| # | Sev | Closed | Confirmed by |
|---|---|---|---|
| F1 | High | ✅ | `location === null` clause at `driver-list.tsx:105-110`, reachability traced end-to-end through `board.service.ts:185-205` and the store interface. M3 is its cost. |
| F2 | High | ✅ | Prop genuinely **required** (`:213-220`), threaded at `page.tsx:280-284`, mounted inside the `frame !== null` branch so the stated reduction holds; probe reproduced above. M2 is its cost. |
| F3 | Med | ✅ | `Number.isNaN(ageMs)` at `board-state.ts:239`; corrected comment names two cold-start and two live paths and cites #237, which exists. |
| F4 | Med | ✅ | `:247` conditions the ❌ on the board not being stale and names both banner strings — verified in `lv.ts:90-93`. |
| F5 | Med | ✅ | `:248` states the inversion and names `driver_streaming`'s missing `{age}`, which `lv.ts:72` confirms. Plan `:338`'s frozen sentence byte-identical across the whole PR. |
| F6 | Med | ✅ | Byte-exact mirror of `zone-grid.tsx:130-141`, with a real `:focus-visible` treatment behind it. |
| F7 | Low | ✅ | `.sort()` at `:249` on a fresh array; the docblock's hedge is accurate. |
| F8 | Low | ✅ | `board-state.ts:224-226` cites **#238**. |
| F9 | Low | ✅ | Re-derived at the head — see §Numbers. |
| F10 | Low | ✅ | `ageMs >= TTL` at `:240`; runbook says "**at** 60 s, not after it". |

The two corrections the fix pass found on its own — `driver-device-day.md:306` (two labels named where
there are three) and the plan's `:499` (which specified F2 *as intended behaviour*, so fixing the code
alone would have left the plan asserting the opposite of what shipped) — are both real, and the second is
the more valuable. Retiring a claim's subject rather than its sentence is exactly what this repo's
standing instruction asks for. M1 is the same sweep one column short.

## Validation

`observed` 2026-09-20, detached worktree at `0de221f`, fresh `pnpm install --frozen-lockfile`.

```
env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force

 Tasks:    22 successful, 22 total
Cached:    0 cached, 22 total
  Time:    2m22.845s
```

`EXIT=0`. No suite flaked; no re-run needed.

| check | result |
|---|---|
| typecheck · lint · test · build (22 tasks) | ✅ 22/22, exit 0 |
| `@taxi/api` | ✅ 2 skipped, 75 passed suites · 39 skipped, 694 passed, 733 total |
| `@taxi/dispatch` | ✅ 28 files, 246 passed |
| `@taxi/shared` | ✅ 24 files, 231 passed |
| `@taxi/driver` | ✅ 44 suites, 250 passed |
| `@taxi/rider` | ✅ 30 suites, 145 passed |
| `@taxi/db` | ✅ 3 files, 17 passed |
| GitHub checks | ✅ `check`, `codeql`, `CodeQL`, `audit-diff`, `ready` all pass |

Wall time differs from the PR body's `1m26.113s` — machine load, not a discrepancy. Task count, exit code
and every per-package total match exactly. The 39 skipped are the documented Redis-gated suites with
`REDIS_TEST_URL` unset.

## What is done well

- **The round-1 fix pass is the best this repo has produced.** Every finding carries a run against the
  **unfixed** code, in both directions where the fix had two halves — F2's "cut the thread" and "drop the
  condition" probes are different edits reddening different pairs. One of them reproduced exactly here.
  That is the `taxi-review-payoffs-are-claims` standard applied without being asked.
- **F2's control test was strengthened after the first push**, unprompted, because a fresh/stale pair can
  be green-by-accident if the fixture yields an empty region either way. The probe output is recorded, the
  region **count** is now asserted so a dropped region cannot pass as an empty one, and a wrong comment
  about which second region it was got corrected in the same pass. An author auditing their own new test's
  payoff is rare.
- **F1's accepted consequence is argued rather than hidden.** `driver-list.tsx:92-101` states the
  unknown-at-login window, gives the reason it is the right trade (`findNearby` filters on position, so
  the engine will not offer to them either), names the second-order case, and pins it with a test. M3 is a
  gap in the *wording* of that trade, not in the reasoning.
- **F7 was fixed by making the claim true rather than softening it**, and the replacement was checked for
  the fresh-false-claim trap — stability, explicitly not alphabetical, because `sort()` is code-unit order
  and mis-sorts Latvian diacritics.
- **Two of the issue's premises were re-observed and found false before any code was written**, and posted
  to the issue rather than quietly worked around. AC #3's "already a shared constant" and AC #2's assumed
  driver row were both wrong; saying so is what made the scope correct.
- **The `on_ride` unbounded-silence case** — `markOfflineByServer` returns early for anything but
  `online`, so an `on_ride` driver who goes dark is never swept — is the strongest argument in the PR and
  is nowhere in the issue. The feature earns its keep on that case.

## Recommendation

**Request changes.** In order of value:

1. **M1** — correct the four provenance refs, then re-run the noun grep. This is the one that should not
   merge as-is: it is wrong, this PR caused it, and it sits under a step whose verdict is binary.
2. **M3** — one catalog string in three files, scoped to `drivers_silent_summary` only, plus the plan's
   breadboard line. No code or test change.
3. **M2** — needs a decision, not a keystroke, because the obvious one-liner collides with
   `POLL_MS === STALE_MS`. Reproduce it first; at minimum, correct the prop docblock so it stops
   describing a narrower condition than it receives.
4. **L1, L2, L4** are small and mechanical. **L3** is a judgement call between a `boardStale`-aware string
   and a comment saying the banner suffices.

Nothing here disputes the approach, the scope, or the two Highs' fixes, and no finding can make the board
claim a dark driver is live — the failure direction that matters stayed closed all round.
