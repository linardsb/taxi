# PR #163 review, round 2 — the five Lows deferred out of the PR #154 review

**Head** `800768f` · **Base** `main` @ `6d72261868c6e24b2466761609e877ca6a90f977`

**Round 2.** Round 1 (`.claude/code-reviews/pr-163-review.md`, head `1403135`, on `docs/pr-163-review`
/ PR #164) approved with three Lows and three nits; `dfac278` fixed L1, L2, L3 and N1, and `800768f`
sharpened two claims in the fixes report. Finding codes continue round 1's, so **L4–L6** below are
new and L1–L3 / N1–N3 always mean round 1's.

Which passes ran, so round 3 does not have to guess:

- **Guarantees pass — skipped, correctly.** Round 1 recorded `**Base** … @ 6d72261868c6…` and Phase 1
  reports the same `baseRefOid`. The base did **not** move; `git merge-base --is-ancestor 6d72261 HEAD`
  → true, so the branch is still linear on it. Round 1 left no rebase notes to close.
- **Fix-mechanism pass — ran, by choice.** Round 1 raised no Critical or High, so the pass has no
  mandatory subjects. It was applied anyway to all four closed findings (L1, L2, L3, N1), asking of
  each what the fix's *mechanism* newly permits rather than whether the original repro passes.
- **Constraint pass — skipped.** No plan and no implementation report for this branch; issues
  #157–#161 stand in as the specification, as round 1 recorded.
- **Numbers pass — ran, and L4 is its finding.**

`.claude/reports/pr-163-review-fixes.md` exists and carries both the per-finding grep list and the
closing-command outputs that `piv-fix-review-findings` §2/§4 require, so no closed finding was
re-opened on procedure.

**On the deep pass:** the `code-reviewer` agent was dispatched and returned three Lows. Two are below
as L5 and L6, **each reproduced by a run before it entered this report** — the repo's rule that a
review's own payoff is a claim (`taxi-review-payoffs-are-claims`). The third is under *Noted*. One of
the agent's provenance statements is corrected there, and one of its proposed repros does not work as
written, so a different mutation was used.

---

## Summary

The four code-change findings from round 1 are genuinely closed, and none of the four fix mechanisms
opens a new hole. Nothing is Critical, High or Medium. Nothing shipped behaves wrongly.

Three Lows, all test-and-prose quality:

- **L4** — the PR body's probe table now mixes two trees, and one row is wrong at HEAD in the
  direction that *understates* the fix it describes.
- **L5** — the new case L1's fix added carries a routing assertion that cannot fail, under a name that
  claims what the assertion does not pin.
- **L6** — the `earnings` slice ships no `(edge)` case, and its loading branch survives deletion with
  every test green. Pre-existing; this PR had both files open.

L4 is the one worth doing before merge, and it is a PR-body edit.

---

## Validation

`observed` — full CI-parity gate on `800768f`, from cleared `dist`, `.next`, `.turbo` and
`tsconfig.tsbuildinfo` (`node` + `fs.rmSync`, 12 paths removed):

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 \
  pnpm turbo run typecheck lint test build --force
```

| Task | PR body claims | This run |
|---|---|---|
| Tasks | 22 successful, 22 total, exit 0, 0 cached | ✅ **22 successful, 22 total**, exit 0, 0 cached, 1m39.455s |
| `@taxi/api` test | 76 suites / 721 tests, 0 skipped | ✅ **76 passed / 721 passed**, 0 skipped, 51.824 s |
| `@taxi/driver` test | 41 suites / 217 tests | ✅ **41 / 217** |
| `@taxi/shared` test | 24 files / 231 tests | ✅ **24 / 231** |
| `@taxi/rider` test | 30 suites / 143 tests | ✅ **30 / 143** |
| `@taxi/dispatch` test | 27 files / 224 tests | ✅ **27 / 224** |
| `@taxi/db` test | 3 files / 17 tests | ✅ **3 / 17** |
| `@taxi/api` lint | 0 errors, 12 warnings | ✅ `✖ 12 problems (0 errors, 12 warnings)`, all `no-unsafe-argument` in integration specs |
| typecheck · lint · build | clean everywhere | ✅ |

Every validation figure in the PR body reproduces **exactly**. The only difference is wall-clock
(1m39.455s here vs the body's 1m30.096s), which is machine variance, not a claim.

`REDIS_TEST_URL` was set, so the 33 Redis-gated tests ran rather than `describe.skip`-ing — 721
total, 0 skipped, as the body says.

Round 1's `drivers.integration` supertest flake (`Parse Error: Expected HTTP/, RTSP/ or ICE/`) did
**not** recur. Two clean full-gate runs now stand against one flaked one, which supports the fixes
report's reading of it.

---

## Issues

Three Lows. No Critical, High or Medium.

### L4 (Low) — the PR body's probe table mixes two trees, and one row is wrong

**PR #163 body**, the *"Each behavioural fix was probed by reverting it…"* table.

Five rows, presented together with no tree named. Three (`#161`, `L1`, `L2`) match HEAD. Two do not —
both are `dispatch-notifier.spec.ts`, which round 2 grew from 8 tests to 9 when L2's both-throw case
landed:

| Row | Body says | `observed` at HEAD `800768f` | Verdict |
|---|---|---|---|
| `#158` — restore the single shared `try` | 2 failed, 6 passed | **3 failed, 6 passed, 9 total** | ❌ wrong at HEAD |
| `#159` — swap `Buffer.byteLength` for `json.length` | 1 failed, 7 passed | **1 failed, 8 passed, 9 total** | ⚠️ stale count |

`observed` — both probes run against HEAD and reverted after (`git status --porcelain` empty each
time):

- **#158.** Restored `main`'s shape — one shared `try` around `emitToRide` *and* the whole revoke
  loop — while leaving L2's `revoke_failed` name in place, so the run isolates #158 rather than
  conflating it with the rename. `Tests: 3 failed, 6 passed, 9 total`.
- **#159.** `Buffer.byteLength(json, 'utf8')` → `json.length` at `dispatch-notifier.ts:75`.
  `Tests: 1 failed, 8 passed, 9 total`.
- File size, twice: `pnpm --filter @taxi/api test -- dispatch-notifier.spec` at HEAD is
  `Tests: 9 passed, 9 total`; the same count at `1403135` is 8.

**Failure scenario.** A reader trusts the table and treats `2 failed` as the measure of what #158's
per-driver `try` buys. It is `3` — L2's both-throw case (`dispatch-notifier.spec.ts:332`) also goes
red under the revert: with a single shared `try`, `emitToRide`'s throw exits before the loop runs, so
one warn is emitted where the case asserts two. That case is a second, independent pin on #158's
structure, and the table hides it. A future de-scoping argument about that tail would stand on a
floor of `2` when the real floor is `3`.

**Why it happened, which is the part worth recording.** Both rows are correct *for `1403135`*. The
round-2 push audited the figures that look like validation figures (720 → 721, 216 → 217, and it says
so out loud) and the retired `notify_failed` claim — but the probe table was carried across
unchanged, because it already read as `observed`. That is `CLAUDE.md`'s own sentence: *numbers flow
plan → implementation → report → PR body, and are inherited, not audited.*

**Fix.** Re-run both probes at HEAD and write in the numbers above; #158's row then says something
stronger *and* true. (Labelling the table "probes at `1403135`" would also be honest, but leaves the
better number unsaid.) `.claude/reports/pr-163-review-fixes.md` is **not** affected — it reports L1's
and L2's probes only, both at the fixed tree, both correct.

### L5 (Low) — the new case's routing assertion cannot fail, and its name overclaims

`apps/driver/src/features/push/push-registrar.test.tsx:206-209`

L1's fix added *"the card the tap lands on draws through the real active-ride labels (edge)"*. Its
label assertions are sound (see the fix-mechanism pass). Its **routing** assertion is not:

> `await mount(<OfferScreen />);`
> `await act(async () => ctx!.receive(wire(), 'socket'));`
> `await tapWith({ kind: 'offer', offerId: OFFER_ID, rideId: RIDE_ID });`
> `expect(router.navigate).toHaveBeenCalledWith('/offer');`  ← already true before the tap

`receive` itself routes a fresh card (`route_offer` → `router.navigate('/offer')`, with `usePathname`
mocked to `/home` in `jest.setup.ts:141`) — which is exactly why the sibling case at `:179-190` calls
`router.navigate.mockClear()` between the `receive` and the tap. This case does not, so the
expectation is satisfied by the setup rather than by the behaviour under test.

**`observed` — reproduced, not argued.** Gated the tap's `router.navigate` call out entirely
(`push-registrar.tsx:46`, `if (hasCard())` → `if (false && hasCard())`) and re-ran the file:

```
✓ a tap for an offer already answered does not move the driver (failure)
✕ an ids-only tap still opens the card the socket delivered (expected)
✓ a tap on any other notification goes to the gate (edge)
✓ the card the tap lands on draws through the real active-ride labels (edge)
Tests: 1 failed, 3 passed, 4 total
```

The tap path is completely broken and the new case stays green. Probe reverted; tree clean.

**Failure scenario.** Someone re-gates the tap hop — `hasCard()` is exactly the kind of line that
gets revisited, and its own comment explains a bug it already fixed once. They read four cases, three
of which mention the tap, and assume the new one covers the render *and* the routing. It covers only
the render. Meanwhile the name — "the card **the tap lands on**" — describes the one thing the case
does not exercise: `receive`, not the tap, put that card there.

**Fix.** One line: `router.navigate.mockClear();` after the `receive`, matching `:182`. That makes
the assertion pin the tap and the name true. (Dropping the `tapWith` call and renaming to what it
actually guards is equally correct and slightly smaller — but the case is an `(edge)` in a
tap-routing file, so clearing is the better fit.)

Low, not Medium: nothing shipped is wrong, and the case's *stated* purpose — standing the L1 landmine
on something — is fully met by the label assertions, which do fail when the mock regresses.

### L6 (Low, pre-existing) — the `earnings` slice ships no `(edge)` case, and its spinner is untested

`apps/driver/src/features/earnings/earnings-screen.test.tsx`

The slice is three files (`index.ts`, `earnings-screen.tsx`, `earnings-screen.test.tsx`) and its spec
is **2 × `(expected)` + 1 × `(failure)`, 0 × `(edge)`** (`observed` — `grep -oE` over the suffixes).
Root `CLAUDE.md` requires ≥1 of each.

The gap is not decorative. `mockEarningsStatus` is declared `'loading' | 'ready' | 'error'` at `:14`
but only ever assigned `'ready'` (`:60`) and `'error'` (`:94`), so the `'loading'` member is dead and
the branch it drives — `earnings-screen.tsx:37-38`, `today === null` → `<ActivityIndicator />` — has
no test in this slice.

**`observed` — reproduced.** Deleted the spinner branch outright, leaving `<Text>{today}</Text>`:

```
✓ renders the day total to the cent, NET of commission, and the empty receipt state (expected)
✓ shows the receipt of the ride just completed, from its persisted split (expected)
✓ a failed total is a dash, never a crash, and the back button pops (failure)
Tests: 3 passed, 3 total
```

Probe reverted; tree clean. (The agent's suggested mutation — inverting the condition — is not the
right probe: with `today` a string in the ready state it flips test 1 red for the wrong reason.
Deleting the branch is what isolates the gap.)

**Failure scenario.** Someone simplifies the card to `<Text>{today}</Text>` while tidying the
extraction this PR performed. Every cold launch of `/earnings` then renders an empty `polite` live
region — no spinner, no text, nothing announced — and the whole gate stays green.

**Provenance, corrected.** The agent could not tell whether this predates the PR. It does:
`git diff 6d72261..800768f -- apps/driver/src/features/earnings/` leaves the JSX block untouched and
changes only the `today` *computation* (inlined → `earningsBody`). What is notable is the asymmetry —
the home card's identical load window **is** pinned, by the case F20 added at
`home-screen.test.tsx:222-233` (*"names the earnings link while the card is still a spinner"*), and
both surfaces now share one `earningsBody`. The screen left without the test is the one this PR just
taught to use the shared mapper.

**Fix.** One case: set `mockEarningsStatus = 'loading'`, assert the total's `Text` is absent and the
`ActivityIndicator` renders (it needs a `testID` — `active-ride-screen.tsx:130` is the precedent with
`ride-loading`). Fine as a follow-up; it satisfies the slice rule and closes the asymmetry.

### Noted, not findings

- **`apps/rider/src/features/booking/format-eur.ts` re-implements `formatEur`.** `observed` — its
  body is character-for-character `packages/shared/src/money.ts:52-58`, and
  `apps/rider/src/features/booking/index.ts:4` re-exports it. That is the "never duplicate a type an
  app can import" rule, and the driver app already models the fix (`availability/format-eur.ts`
  re-exports from `@taxi/shared`). **Pre-existing and outside this diff** — this PR does not open that
  file — but it is the one live copy the fix report's sweep (`pr-163-review-fixes.md:186-200`) could
  not reach, because those greps were scoped to `apps/driver`. Worth a one-line issue, not a change
  here: when the brand copy pass moves `€84.20` → `84,20 €` in `money.ts`, driver, api push bodies and
  dispatch follow and the rider's quote card silently does not.
- **`dispatch.integration.spec.ts:1244,1247`** attach two `sock.on` listeners with no detach at all —
  N1's hazard class. Pre-existing on `main` (`git show 6d72261:…` finds it at `:1240`), untouched
  here, and on a per-test `driverSocket(a.id)` rather than the suite-level `dispatchSock` the fixed
  site uses, so the blast radius differs. Recorded so round 3 does not raise it as new.
- **`receipt.test.tsx`'s third test name** still does not match its body. Pre-existing, declared in
  the PR body, correctly left alone twice. Still a candidate for the next driver-slice ticket.
- **N2** (a spec case for a throwing `emitStatus`) is a decided won't-fix and **N3** (the live region
  inside a collapsed `Pressable`) is on the device day in `ui-decisions.md`. Both re-confirmed open
  by decision, not omission. Neither re-raised.

---

## Routing

| Bucket | Item |
|---|---|
| **AGENT FIXES** | **L4** — PR #163 body, the probe table: re-run `#158` / `#159` at HEAD and write in `3 failed, 6 passed` / `1 failed, 8 passed`. Prose only, no code. |
| | **L5** — `apps/driver/src/features/push/push-registrar.test.tsx:208`: add `router.navigate.mockClear();`. One line, test-only. |
| **HUMAN DECIDES** | **L6** — `apps/driver/src/features/earnings/earnings-screen.test.tsx:14`: fix here, or open an issue for the missing `(edge)` case? Pre-existing, so either is defensible. |
| | `apps/rider/src/features/booking/format-eur.ts:6`: open an issue for the duplicated `formatEur`? Outside this diff — should not be fixed on this branch. |
| **HUMAN READS** | `services/api/src/features/dispatch/dispatch-notifier.ts:130-183` — the assignment emit tail: `emitStatus` outside any `try`, the ride-room emit's `try`, and the per-driver revoke loop. This is the only dispatch-logic change in the PR and the one place a wrong `try` boundary strands a driver's card. |
| | `apps/driver/src/features/availability/earnings-body.ts:26-39` — the three-state mapper both surfaces now share, and the reason the accessible name can be composed at all. |
| **HUMAN TESTS** | The device day already booked in `ui-decisions.md`: #161's two label states by ear, F4's offer-card label, and **N3** — whether `earnings-card.tsx:17`'s `polite` live region is still announced inside a collapsed `Pressable`. |
| **FYI** | `receipt.test.tsx`'s third test is named for behaviour its body does not assert (pre-existing, declared). `dispatch.integration.spec.ts:1244,1247` attach listeners with no detach (pre-existing). Round 1's `drivers.integration` flake did not recur in two clean gates. |

---

## The fix-mechanism pass

For each round-1 finding the fix pass closed: what does the fix's *mechanism* newly permit?

### L1 — `requireActual` spread + a rendering case in `push-registrar.test.tsx`

**What it newly permits.** The file now evaluates the real `@/features/active-ride` barrel for the
first time, and `<OfferScreen />` renders inside `<OffersProvider>` where nothing did before.

- **Nothing unmocked is reached at module scope.** The barrel pulls `active-ride-screen.tsx`
  (`@/components`, `expo-router`, `@/features/i18n`), `nav-links.ts` (`Linking`/`Platform` imported
  but only called on press), `receipt.tsx` (pure + the `@taxi/shared` theme) and `use-active-ride.tsx`.
  Its one value import from a fully-replaced module is `getLocationRuntime`, which this file's own
  mock supplies (`:52-59`); the rest are type-only and erase. `@/features/auth` is a *partial* mock,
  so `ApiError` still resolves. `use-offers.test.tsx:42-47` already loads this exact graph.
- **No degraded render passing as a real one.** `useActiveRide` is still stubbed as
  `{ open: mockOpen, state: {} }` while its barrel siblings are now real — so a `.state` read under
  `OfferScreen` would pin a half-drawn card. There is none: `OfferScreen` (`offer-screen.tsx:12-18`)
  reads `useOffers()` only, and the single `useActiveRide` consumer in that path
  (`use-offers.tsx:78`) reads `activeRide.open` and nothing else (`:87-92`). The stub is inert here.
- **The literals are real values, not `undefined` rendering blank.** Re-derived rather than read off
  the comment: `splitFare(1240, { pct: 15 })` → `commissionCentsFor = Math.round(186) = 186` →
  `driverNetCents = 1054` → `formatEur(1054) = '€10.54'` (`money.ts:40-58`); `offer-card-props.ts:48`
  passes `pctLabel(100 - 15)` → `'85'`; the fixture's `paymentMethod: 'cash'` maps to
  `driver.offer.payment_cash` (`receipt.tsx:26-35`). All three match the assertions.

`mount(extra?: ReactNode)` is additive — the three existing cases pass `undefined`, which renders as
nothing. All four pass in the gate. The one thing the fix newly permits and did **not** account for
is L5.

### L2 — `dispatch.assign.revoke_failed`

**What it newly permits.** A rename retires the old name *for that site*: anything keyed on
`dispatch.assign.notify_failed` stops seeing revoke failures. `observed` — swept the tree for both
names across every file type: the only hits are `dispatch-notifier.ts:142` and `:176`, four
assertions in `dispatch-notifier.spec.ts`, this PR's two reports, and `pr-82-review.md:29` (a
historical review of a different tree). **No alert, dashboard, config or runbook is keyed on either
name**, so nothing loses visibility. The payload carries `rideId`, `driverId`, `offerId`, `reason`,
`at` — no PII.

**Does the new spec case target the right emit?** Yes, and it matters because the case counts calls
rather than matching arguments. In `emitAssigned`, `emitToDriver` is called **only** inside the
revoke loop (`dispatch-notifier.ts:161`); the assigned driver is reached by `joinRideRoom` +
`emitToRide`. So `calls === 1 → throw` is unambiguously `REVOKED[0]`, which is the `driverId` the
case then asserts. `joinRideRoom` and `emitStatus` are plain `jest.fn()` in `build()`, so
`toHaveBeenCalledTimes(2)` cannot be diluted by a third warn.

The name matches `logging-standard.md:8`'s `domain.component.action_state` and the slice's own
`join_failed` / `leave_failed` / `driver_not_claimed`.

### L3 — the barrel's `formatEur` re-export deleted

**What it newly permits.** Nothing: a deleted export with a consumer is a typecheck error, and the
gate is green from cleared `dist` across all 22 tasks. `observed` — no importer existed: every
`formatEur` hit in `apps/driver/src` takes it from `@taxi/shared` or from `./format-eur` directly.
`apps/driver/CLAUDE.md:34` names the **file**'s re-export, untouched and still true, as is
`format-eur.ts:6-12`'s corrected docblock, which names `earnings-body.ts` and `format-eur.test.ts` —
both of which import the file.

### N1 — `try`/`finally` at both detach sites

**What it newly permits.** A throwing `finally` would mask the assertion error that sent you there.
It cannot here: both detaches are a bare `socket.off(…)` — `stop` is
`() => void socket.off(RT.rideStatus, onStatus)` (`ride-read.integration.spec.ts:226`), and the
dispatch site is `dispatchSock.off(RT.dispatchUnclaimed, countExtra)`.

**Did anything move inside the `try` that should have stayed out?** No, and no read was reordered
against the detach: in the ride-read spec the connect and `collectStatuses(b)` stay above the `try`
(they must — `stop` has to exist), `mine` is declared *inside* it at `:295`, and the block is the
last statement; in the dispatch spec `extra` is read at `:439`, inside. Both suites PASS in the gate.
Both sites were touched, which was round 1's stated condition.

---

## The numbers pass

Beyond L4, every other figure on this branch re-derived.

| Claim | Where | Verdict |
|---|---|---|
| Gate 22/22, exit 0, 0 cached | PR body + fixes report | ✅ `observed`, my own run |
| `@taxi/api` 76 / **721**, 0 skipped | both | ✅ `observed` |
| `@taxi/driver` 41 / **217** | both | ✅ `observed` |
| shared 24/231 · rider 30/143 · dispatch 27/224 · db 3/17 | both | ✅ `observed`, all four |
| api lint 0 errors, 12 warnings | both | ✅ `observed`, verbatim |
| "720 → 721 (L2's) and 216 → 217 (L1's)" | PR body | ✅ both deltas are exactly one new test, and both new tests exist |
| Probe `#161` — 3 failed, 5 passed | PR body | ✅ consistent: `home-screen.test.tsx` holds 8 `it(` blocks at HEAD, untouched by round 2 |
| Probe `L1` — 1 failed, 3 passed | PR body | ✅ `push-registrar.test.tsx` is 4 at HEAD, 3 at `1403135` |
| Probe `L2` — 2 failed, 7 passed | PR body | ✅ 9 at HEAD |
| Probes `#158` / `#159` | PR body | ❌ **L4** |
| `727` UTF-16 units of envelope; 727+1,100 = 1,827 ≤ 2,048; 727+2,200 = 2,927 > 2,048 | PR body | ✅ inherited from round 1, which probed the 727 by instrumenting the spec; `OFFER_PUSH_PAYLOAD_MAX_BYTES = 2_048` re-confirmed, and #159's probe above still discriminates exactly as claimed |
| `splitFare(1240, 15%)` nets 1054 and keeps 85 | `push-registrar.test.tsx:215` | ✅ re-derived from `commission.ts` + `money.ts`, not from the comment |

**Retired-claim subjects, swept by noun rather than by sentence form:**

- `notify_failed` as the revoke loop's name — gone from the code, and the PR body was updated in the
  same push to say `revoke_failed` *and* to name the review finding that changed it. No survivor.
- The `offerId`-is-the-discriminator comment — the one copy, rewritten in the same hunk.
- The barrel `formatEur` route — export gone; the two docs that mention `format-eur.ts` both stay
  true because they name the file, not the barrel.
- `216` / `720` as live totals — `grep -rn "216 tests\|720 tests" .claude docs` finds them only in
  `pr-163-review.md`, anchored to `1403135` and correctly left as observed of that commit.

**The five `Closes #N` lines survived the body rewrite.** Worth re-checking because the round-2 push
edited the body and this repo has been bitten in both directions
(`taxi-pr-issue-link-backticks`). `observed` — `gh pr view 163 --json closingIssuesReferences`
returns **5**: #157, #158, #159, #160, #161. No backtick crept in; nothing extra was picked up.

**Standards sweep — clean.** Every changed shipped file is under the 500-line cap (`lv.ts` 444,
`active-ride-state.ts` 374, `home-screen.tsx` 232). No hardcoded hex, font size, padding or margin in
any added line; no user-facing string outside the catalogs (`NO_EARNINGS = '—'` is punctuation and
documented as such). No `any`, no `@ts-ignore`/`@ts-expect-error`, no `max-lines` disable. Money is
integer cents throughout, rendered from the persisted `FareSplit` and never recomputed. No direct
status write — `active-ride-state.ts:242` mirrors `DRIVER_STEPS[step].to` into *client* state after
the REST answer. Operative `ride.paymentMethod` everywhere. `packages/shared` still imports nothing
from the workspace, and the catalog deletion is structurally safe: `MessageKey` derives from `lv.ts`,
so a stale consumer is a typecheck error rather than a runtime `undefined`.

---

## What is good

- **The both-throw case is worth more than its finding.** L2 asked for a rename; the fix added a case
  where *both* emits throw, and that case turns out to be a second independent pin on #158's
  per-driver `try` — it goes red under #158's revert too. Asserting the new string alone would have
  passed under any name. The PR body undersells it (L4), but the test is the right one.
- **L1's fix stands the landmine on something.** Adding the `requireActual` spread alone would have
  kept the hole quiet. Rendering `OfferScreen` and asserting through the two symbols that resolve to
  `undefined` under a full replacement means the next regression fails loudly, in this file, naming
  the module. That is closing a finding's *class*, not just the finding — L5 is a blemish on one
  assertion inside an otherwise well-judged case.
- **The L2 comment credits the mechanism that does the work.** `dispatch-notifier.ts:168-175` names
  the event as the discriminator instead of the incidental presence of `offerId` — the previous
  comment was a claim the code only accidentally supported.
- **Three of the four fixes carry a "new failure mode of the fix" section, written by the author.**
  The barrel evaluating for the first time, the rename retiring the old name, the re-indent
  reordering a read against the detach. That is the fix-mechanism pass done before the reviewer asked
  — and `800768f` added the third one unprompted, which is why L4 is the only inherited-figure defect
  left rather than several.
- **N1's re-indent check was real, not decorative.** `mine` is declared inside the `try`, so a read
  after the block would not even compile — but the report checked the weaker property (nothing reads
  after the detach) instead of leaning on that, which is the right order.
- **N2 was left alone for a stated reason and N3 routed to the device day.** Neither silently
  dropped, both recorded where round 3 will find them.
- **Two clean gates now stand against round 1's single flake**, and the fixes report resisted calling
  it fixed — it said the suite passed inside the full run and left it there.

---

## Recommendation

**Approve.**

No Critical, High or Medium; no hard-rule violation introduced. All four round-1 code findings are
closed, each with its mechanism interrogated rather than its repro re-run, and the gate is green end
to end at HEAD with every PR-body validation figure reproducing exactly.

On the three Lows:

- **L4 before merge.** It is a PR-body edit, and the correct number makes the PR's own case stronger.
  It matters only because this repo has now had #87, #107 and #121 reach `main` on an unaudited
  figure with the reviewer as the sole check — and because a `2` that is really a `3` is exactly the
  floor a future de-scoping argument would stand on.
- **L5 before merge if it is cheap** — one `mockClear()` line, and it makes the case's name true.
  Defer it and the file keeps three honest tap tests plus one that reads like a fourth.
- **L6 as a follow-up**, on its own issue. Pre-existing, and it closes the asymmetry this PR created
  by giving both surfaces the same `earningsBody` while only one of them pins the load window.

The rider's duplicate `formatEur` (under *Noted*) deserves a one-line issue of its own. It is outside
this diff and should not be fixed here.
