# PR #163 review — the five Lows deferred out of the PR #154 review

**Head** `1403135` · **Base** `main` @ `6d72261868c6e24b2466761609e877ca6a90f977`

**Round 1.** No prior `.claude/code-reviews/pr-163-review*.md`, so the guarantees pass and the
fix-mechanism pass do not apply. No plan and no implementation report exist for this branch, so
the constraint pass is skipped; issues #157–#161 stand in as the specification.

**On the deep pass:** the `code-reviewer` agent was dispatched and returned; its findings are
merged with a direct full-file pass (every changed file read whole, plus both `emitAssigned`
callers, both slice barrels, the driver import-direction rule, the sibling detach precedent, and
the two catalogs' history). Every finding below was re-derived or reproduced before it entered
this report — L1 by an actual probe run. Four candidates were dropped (see *Checked and dropped*).

---

## Summary

Five deferred Lows, one commit each, and each lands on the issue as written. Two carry behaviour
(#158, #161), two are test integrity (#157, #159), one is deduplication (#160). Nothing here is
Critical or High.

The three departures from the issues' literal text are declared in the PR body and all three are
the better call. #158's superset in particular: taking "move the `try` inside the loop" literally
would have left `emitToRide` bare, and the PR body's justification for wrapping it — a post-commit
tail documented never to throw — is exactly right.

Every figure in the PR body was re-derived against my own runs. All of them hold. Given #87, #107
and #121 that is worth stating rather than assuming.

---

## Validation

`observed` — full CI-parity gate on `1403135`, from cleared `dist`, `.next`, `.turbo` and
`tsconfig.tsbuildinfo`:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 \
  pnpm turbo run typecheck lint test build --force
```

| Task | Result |
|---|---|
| Tasks | **21 successful, 22 total**, exit 1, 1m30.284s, 0 cached |
| `@taxi/api` test | ❌ **1 failed, 719 passed, 720 total** · 76 suites, 0 skipped |
| `@taxi/driver` test | ✅ 41 suites / 216 tests |
| `@taxi/shared` test | ✅ 24 files / 231 tests |
| `@taxi/rider` test | ✅ 30 suites / 143 tests |
| `@taxi/dispatch` test | ✅ 27 files |
| `@taxi/db` test | ✅ 3 files |
| typecheck · lint · build | ✅ all packages; `@taxi/api` lint 0 errors, 12 `no-unsafe-argument` warnings |

**The one failure is a flake, not this branch.**
`drivers/drivers.integration.spec.ts` › activeRideId › "names the ride a driver is committed to"
failed with `Parse Error: Expected HTTP/, RTSP/ or ICE/` — a supertest transport error, in a file
this PR does not touch. `observed`, two follow-up runs at the same tree:

- that suite alone: **31 passed, 31 total**, exit 0
- the whole `@taxi/api` package alone: **76 suites / 720 tests, 0 failed**, exit 0

So the PR body's `22 successful, 22 total` is reproducible in substance; I simply drew the flake.
Worth recording for the next session: `CLAUDE.md`'s flake note names *payments/customers* under
the full run — `drivers.integration` is a third member of that class, same symptom.

`REDIS_TEST_URL` was set, so the 33 Redis-gated tests ran rather than `describe.skip`-ing —
720 total, 0 skipped, matching the PR body.

---

## Issues

Three Lows, three nits. No Critical, High or Medium.

### L1 (Low) — the third `@/features/active-ride` mock was not updated, and it is now a landmine

`apps/driver/src/features/push/push-registrar.test.tsx:37-39`

This PR taught two of the three full-module mocks of `@/features/active-ride` to spread
`requireActual` — `use-offers.test.tsx:42-47` and `earnings-screen.test.tsx:38-41` — because
`offer-card-props.ts` now resolves `paymentMethodLabel` and `pctLabel` through that barrel. The
third was left a full replacement:

```ts
jest.mock('@/features/active-ride', () => ({
  useActiveRide: () => ({ open: mockOpen, state: {} }),
}));
```

That file imports the `@/features/offers` barrel (`:11-15`), which loads `offer-screen.tsx` →
`offer-card-props.ts`, so both bindings resolve to `undefined` inside it.

**Failure scenario.** It passes today only because no test in the file renders `OfferScreen` —
`offerCardProps` has exactly one production call site (`offer-screen.tsx`). The first person to add
an `OfferScreen` render or an offer-card assertion to this file gets a `TypeError` pointing at a
module the test never mentions.

**`observed` — the mechanism, reproduced rather than argued.** I removed the spread from
`use-offers.test.tsx` and ran that file:

```
TypeError: (0 , _activeRide.paymentMethodLabel) is not a function
Test Suites: 1 failed, 1 total
Tests:       5 failed, 5 total
```

So the spread is load-bearing where it was added, and its absence in `push-registrar.test.tsx` is
the same landmine with nothing standing on it yet. Probe reverted; tree clean.

**Fix:** the same three lines the two sibling files already carry.

### L2 (Low) — one event name, two different meanings of `driverId`

`services/api/src/features/dispatch/dispatch-notifier.ts:142` and `:169`

Both catches log `event: 'dispatch.assign.notify_failed'`, but `driverId` names a different person
at each: at `:142` the newly **assigned** driver, at `:169` a **revoked** one. The `:169` site is
new in this PR.

**Failure scenario.** Grouping the log by `event` + `driverId` — the natural query at 02:00 —
conflates "the ride room never heard about the assignment" with "driver X's stale offer card never
cleared". They have different blast radii and different fixes. The only discriminator is whether
`offerId` is present, which is implicit and easy to miss; the code comment at `:167-168` says as
much out loud.

Every other failure site in this slice already gets its own `action_state`:
`dispatch.assign.join_failed` (`:122`), `dispatch.assign.leave_failed`
(`reassign.service.ts:173`), `dispatch.assign.driver_not_claimed` (`dispatch.service.ts:251`).
The sibling this fix mirrors — `emitRevoked`, `ride-lifecycle.service.ts:424` — does reuse
`ride.lifecycle.notify_failed`, but it holds only one such site in that method, so it is not a
precedent for two.

**Fix:** `event: 'dispatch.assign.revoke_failed'` in the loop's catch. The payload can stay as it
is. One line, and `dispatch-notifier.spec.ts:303` updates with it.

### L3 (Low) — the barrel still re-exports `formatEur` to nobody

`apps/driver/src/features/availability/index.ts:3`

`export { formatEur } from './format-eur'` has no consumer outside the slice. `observed` — grep of
`formatEur` across `apps/driver/src`: `offers/offer-card-props.ts:1`, `active-ride/receipt.tsx:4`
and `active-ride/active-ride-screen.tsx:4` all import from `@taxi/shared`; `earnings-body.ts:3`
and `format-eur.test.ts:1` import the local file directly. Nothing imports it from the barrel.

This is the last live remnant of exactly the claim this PR retires two files over — `format-eur.ts`'s
new docblock says "the older claim that every consumer routes through here was never true", then
the slice's public API keeps advertising the route. Deleting the line makes the public API match
the honesty the docblock just bought.

`apps/driver/CLAUDE.md:34` documents that `availability/format-eur.ts` re-exports `formatEur`,
which stays true either way — the file is untouched, only its barrel line goes.

Low, and pre-existing rather than introduced here: the PR simply had the file open.

### N1 (nit) — `stop()` is skipped on a failing run

`services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts:296`

`stop()` is the last statement of the test body, so any earlier assertion failure skips it and the
listener leaks anyway — on precisely the runs where a listener firing into a closing socket adds
noise to the output you are trying to read. `try/finally`, or an `afterEach`, closes it fully.

Filed as a nit, not a Low, on purpose: the sibling #157 named as the pattern to match
(`dispatch.integration.spec.ts:438`) has the identical shape, and matching it is what the issue
asked for. If this gets touched, touch both or neither — a lone divergence here is worse than the
shared weakness.

### N2 (nit) — nothing pins the revoke loop against a throwing `emitStatus`

`services/api/src/features/dispatch/dispatch-notifier.spec.ts:66`

`build()` stubs `{ emitStatus: jest.fn() }`, so no test covers what happens to the revoke loop if
`emitStatus` (`dispatch-notifier.ts:130`, the one call in the method inside no `try`) throws.

Deliberately **not** a request for a third `try`. `emitStatus` catches its own emit
(`ride-transition.service.ts:103-126`) and fires `notifications.onStatus` as `void`, so it cannot
throw — a guard there would be error handling for an impossible state, which the KISS rule in root
`CLAUDE.md` rules out. The open question is only whether a *spec* case is worth it: it would pin a
cross-service assumption from the wrong side of the seam, since the guarantee lives in
`RideTransitionService` and is already pinned there. Judgement call, and defensible either way —
recorded so the next round does not rediscover the unguarded line and mistake it for L-something.

### N3 (nit, for the device day) — is the live region still heard?

`apps/driver/src/features/availability/earnings-card.tsx:17`

The card keeps `accessibilityLiveRegion="polite"` while sitting inside a `Pressable` whose subtree
is collapsed and which now carries an explicit `accessibilityLabel`. React Native does not announce
`accessibilityLabel` changes, and a collapsed child is not its own accessibility node — so whether
the number is announced *when it arrives* (rather than only on focus) is an open question.

Not a regression: the collapse predates this PR and the live region was already inside it. But the
device day is already booked in `ui-decisions.md` for the two label states — this is worth adding
to that same check, since a "polite" region that never fires is the kind of thing only a real
phone answers.

### Noted, not a finding

The PR body volunteers that `receipt.test.tsx`'s third test is named for behaviour its body does
not assert. Confirmed pre-existing (`main` has the same body), correctly declared, and correctly
left alone. It is a fair candidate for the next driver-slice ticket.

---

## The numbers pass

Every figure in the PR body, re-derived. **All hold.**

| Claim | Verdict |
|---|---|
| Gate `22 successful, 22 total`, 0 cached | ✅ task count confirmed (22); my run drew a flake, so 21/22 — see Validation |
| `@taxi/api` 76 suites / 720 tests, 0 skipped | ✅ `observed`, both the gate run and the isolated re-run |
| `@taxi/driver` 41 suites / 216 tests | ✅ `observed` in the gate log |
| `@taxi/shared` 24 files / 231 tests | ✅ `observed` in the gate log |
| `@taxi/api` lint 0 errors, 12 warnings | ✅ `observed`: `✖ 12 problems (0 errors, 12 warnings)`, all `no-unsafe-argument` in integration specs |
| offer wire JSON = **727 UTF-16 units** with an empty address | ✅ **probed directly**: instrumented `dispatch-notifier.spec.ts` to print it, ran the suite, got `overhead units= 727 bytes= 727` — so 727 *and* the "all ASCII" premise both hold. Instrumentation reverted; tree clean. |
| `derived` 727 + 1,100 = 1,827 ≤ cap | ✅ arithmetic sound, and `OFFER_PUSH_PAYLOAD_MAX_BYTES = 2_048` (`packages/shared/src/schemas/offer-push.ts:55`) |
| `derived` 727 + 2,200 = 2,927 > cap | ✅ same |
| Probe #159 — 1 failed, 7 passed | ✅ consistent: `dispatch-notifier.spec.ts` holds exactly 8 tests (`observed`, the run above) |
| Probe #158 — 2 failed, 6 passed | ✅ same file, same 8 |
| Probe #161 — 3 failed, 5 passed | ✅ `home-screen.test.tsx` holds exactly 8 `it(` blocks |

**Attribution check on #159.** The test credits byte-vs-unit counting for the drop. It isolates that
correctly: the control measures the envelope with an *empty* address, so the only variable between
the two halves is the address's encoding, and both `expect`s re-derive the overhead on every run
rather than trusting the comment. This is the shape #107's counterfactual lacked. The guard it
targets (`dispatch-notifier.ts:75`) measures `Buffer.byteLength(JSON.stringify(wire))` — the same
string the test measures via `data.offer` — so the overhead is the guard's own subject, not a proxy.

### Absolute claims in the diff, re-derived

| Claim | Where | Verdict |
|---|---|---|
| "`driver.earnings.today` was byte-identical to `driver.home.today` in all three catalogs" | `earnings-body.ts:21` | ✅ `git show main:` all three — en/lv/ru pairs identical |
| "The offer card reads the same two keys through this one function" | `receipt.tsx:22` | ✅ `paymentMethodLabel` reads `driver.offer.payment_cash`/`payment_card` — byte-identical to the deleted `paymentLabel`. **No user-visible copy changed**, and `offer-card-props.test.ts:94,182` still pins the pill against those literal keys |
| "every other member of `PAYMENT_METHOD_TYPES` (`card`, `balance`, `corporate`)" | `receipt.tsx:20` | ✅ `enums.ts:10` — exactly those four |
| "Other slices take `formatEur` straight from `@taxi/shared` and always have" | `format-eur.ts:9` | ✅ all three named files do, on this branch and on `main` |
| "Stays off `index.ts`: nothing outside the slice reads it" (`TITLE_KEY`) | `active-ride-state.ts:105` | ✅ `active-ride/index.ts` exports `stepFor`, not `TITLE_KEY` |
| "Same shape `earnings-screen.test.tsx` uses for this module" | `use-offers.test.tsx:40` | ✅ that file does spread `requireActual` of `@/features/active-ride` (`:38-41`) |
| "`apps/driver/CLAUDE.md` documents the re-export" (PR body) | — | ✅ `apps/driver/CLAUDE.md:34` |
| "no spec pinned the old payload shape" (PR body, #158's warn) | — | ✅ no pre-existing assertion on `dispatch.assign.notify_failed`'s payload |

### Checked and dropped

Four candidates did not survive re-derivation, recorded so the next round does not re-raise them:

- **`emitStatus` sits outside any `try` in `emitAssigned` (`:130`).** Looked like the same hole
  #158 closes one line down. It is not: `RideTransitionService.emitStatus`
  (`ride-transition.service.ts:103`) guards its own emit and fires `onStatus` as `void` — it cannot
  throw, so it cannot skip the revoke loop. (What remains of it is N2, and N2 is not a fix request.)
- **`use-offers.test.tsx`'s "same shape" comment.** Read as a mismatch against
  `earnings-screen.test.tsx`'s file-level `requireActual`; it is not — that file uses the identical
  barrel spread for this same module.
- **The em dash in the error-state accessible name (`"Ieņēmumi. —"`).** `filter(Boolean)` is right
  for all three states: `null` drops, `'—'` and the today string survive, and no empty string is
  reachable. The ear-check is already logged in `ui-decisions.md` for the device day, which is this
  repo's sanctioned handling of exactly this question. Nothing to change now.
- **`earnings-screen.test.tsx:19-21` reaching around `availability/index.ts`.** A slice-barrel
  reach-around, but the justification is sound and written down: requiring the barrel would
  evaluate `HomeScreen → offers → use-offers → active-ride`, which the same file mocks. A silent
  reach-around would be the defect; this one is declared.

---

## What is good

- **#158 got the right superset, and said so.** The issue's literal instruction would have left
  `emitToRide` bare. The PR widened the fix, named the widening in the body, and the three new
  tests cover the tail that previously had none — expected, failure (a revoke throws), edge (the
  room emit throws). Both call sites (`dispatch.service.ts:231`, `force-assign.service.ts:148`)
  run post-commit with the revokes already persisted, so emitting them even after the room emit
  failed is correct, not just wider.
- **The probe table.** Reverting each behavioural fix and confirming the new tests go red is
  exactly the discipline `taxi-review-payoffs-are-claims` asks for, and the counts are internally
  consistent with the real file sizes.
- **#159's control case.** Measuring the envelope rather than assuming it, and asserting both
  halves of the discrimination on every run, is a materially better test than the issue asked for.
- **F20's fix is honest about the trade it makes.** The comment at `home-screen.tsx:86-99` states
  the collapse mechanic, why F4 relied on it, why that left the control nameless, and what the
  composition costs — a future reader cannot undo it by accident.
- **The `format-eur.ts` docblock correction.** Retiring a false claim by re-deriving it and naming
  the three counter-examples, rather than quietly deleting the sentence, is the right treatment —
  the "retire the subject, not the digits" rule applied to the reviewer's own prior text.
- **The catalog deletion is structurally safe, not merely grep-safe.** `MessageKey` derives from
  `lv` (`lv.ts:444`), the `satisfies Record<Language, Record<MessageKey, string>>` at `i18n.ts:26`
  forces `ru`/`en` to carry the same keys, and `tests/i18n.test.ts:13-17` asserts parity. Removing
  a key from all three narrows the union, so a stale consumer would be a typecheck error, never a
  runtime `undefined`.
- **VSA held.** `offers → active-ride` is the sanctioned direction (`apps/driver/CLAUDE.md:21`),
  both symbols are on `active-ride/index.ts`, and `active-ride` imports none of the new slices, so
  no cycle. All touched files well under the 500-line cap (largest: `home-screen.tsx` at 232).
- **The cosmetic call was logged, not debated** — `ui-decisions.md`, as the rule requires, with the
  device-day check named.

---

## Recommendation

**Approve.**

No Critical, High or Medium; no hard-rule violation. All three Lows are small:

- **L1** is the one worth doing in this PR. It is three lines, it is the direct consequence of a
  change this PR makes, and the two sibling files already carry the fix — leaving the third behind
  is the kind of asymmetry that costs someone an hour a month from now on a `TypeError` in a module
  their test never names.
- **L2** and **L3** are fine as a follow-up. If deferred, put them on one issue together, not two.

The gate's single red test is a documented flake class, green in isolation twice over. The five
issues close cleanly, and `closingIssuesReferences` confirms GitHub parsed all five `Closes #N`
lines (the backtick trap in `taxi-pr-issue-link-backticks` was avoided).

N1–N3 are nits and should gate nothing. N2 is explicitly *not* a request for another `try`, and N3
is a device-day question rather than a code change.

Given the PR body's own framing — five deferred Lows, one commit each — the honest read is that it
did what it said, and did the two behavioural ones better than the issues asked.
