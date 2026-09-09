# Code review — PR #154 · driver offer card, active-ride flow and receipt (#15) · **Round 2**

**Head** `67bb82a` · **Base** `main` @ `6fdde96681c49bcc09a36f71c25fa58566054a02` · **Round** 2
**Reviewer** `piv-review-pr` in a fresh context, plus two `code-reviewer` agents (driver delta · api+shared delta).
**Date** 2026-09-09 · **Previous round** `.claude/code-reviews/pr-154-review.md` (`602d5fb`, base `c70572b`)

## Recommendation

**Approve, with F16 and F17 asked for before the merge button.** No Critical, no High, gate green,
and the PR does what it says. Three Mediums and seven Lows, ~30 lines between the two that matter,
none of them a design problem.

I considered request-changes on F16 — a shared contract shipping without tests is a violation of a
stated rule (`packages/shared/CLAUDE.md:9`) and nothing documents it as a deviation. I am not
blocking on it, because the severity table this review is written against puts undocumented
deviations at **Medium**, and a Medium that blocks makes the table decorative. It is a pre-merge ask
instead: F16 is one test file, F17 is one line and a brace.

**Round 1 is discharged.** All four Highs and all four Mediums reach the case they were written
for; I re-derived each rather than reading the fix report's word for it, and ran the two that a
reducer probe can settle. F2 was fixed *wider* than specified and the widening is correct. The
findings below are the residue: one stated rule not followed, one half of F2's own stated harm
still open, one figures table the commit documenting its sweep invalidated, and seven small places
where a comment claims more than the code does.

## Validation

`observed` by me at `67bb82a`, tree clean apart from two untracked review artefacts.

Parity gate from cleared dist (`packages/*/dist`, `services/api/dist`, `apps/dispatch/.next`,
`db/dist` cleared with `fs.rmSync`),
`REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`:

| Task | Result |
|---|---|
| **Gate** | ✅ `Tasks: 22 successful, 22 total` · `GATE_EXIT=0` · `Cached: 0 cached, 22 total` · `Time: 1m28.857s` |
| `@taxi/api:test` | ✅ `76 passed` suites · `716 passed` tests (0 skipped — the Redis-gated suites ran) |
| `@taxi/driver:test` | ✅ `40 passed` · `211 passed` |
| `@taxi/rider:test` | ✅ `30 passed` · `143 passed` |
| `@taxi/shared:test` | ✅ `23 passed` files · `226 passed` |
| `@taxi/dispatch:test` | ✅ `27 passed` files · `224 passed` |
| `@taxi/db:test` | ✅ `3 passed` files · `17 passed` |

Every per-package count in the PR body's `cdddf2f` table reproduced exactly, including the
`204 → 211` and `715 → 716` deltas the fix round claims.

### A red first gate that did not reproduce — not attributed to this PR

My **first** gate run at this head went **RED** and I am recording it rather than burying it.
`@taxi/api:test` → `Test Suites: 1 failed, 75 passed` · `Tests: 16 failed, 700 passed, 716 total`,
`FAIL src/features/rides/rides.integration.spec.ts (321.329 s)`, every one of the 16 the same
`thrown: "Exceeded timeout of 20000 ms for a test."`, and jest then did not exit — so turbo waited
and the gate read as hung rather than red.

What I did before naming a cause, because real red output plus an inferred cause is still an
unverified claim:

- **The spec alone**: `pnpm --filter @taxi/api exec jest src/features/rides/rides.integration.spec.ts`
  → `21 passed, 21 total`, **2.046 s**.
- **The whole api suite again**: `pnpm --filter @taxi/api test` → `76 passed` · `716 passed`,
  **43.802 s**, exit 0.
- **The whole gate again**: green, the table above, `1m28.857s`.

So it does not reproduce, in three attempts at the same head. The mechanism I can evidence is
machine load, not code: `uptime` at the failing run read `load averages: 3.49 7.44 10.78`, and that
run's api suite took **364.783 s against 43.802 s** on the quiet re-run — an 8× slowdown, which puts
the heaviest suite's individual tests past jest's `testTimeout: 20000`
(`services/api/package.json:90`). What I can **not** evidence is a defect: `maxWorkers: 1`
(`:91`) means suites run serially against the shared test DB, so there is no parallel-contention
theory to test, and this PR's only change to that file is a two-line assertion swap on an unrelated
route (D2, `403 → 404`) that cannot time out `findWithQuote`. **Cause named as load; not attributed
to this PR.** Recorded so the next person who sees this shape has a prior — it is the same class as
round 1's own one-off (`drivers.integration.spec.ts`, `socket hang up`).

## The base moved — the guarantees pass

Round 1 recorded base `c70572b`; `baseRefOid` is now `6fdde96`, so this pass applies.

`main` gained two commits, `b3f9042` (#155) and `6fdde96` (#156). **Their file overlap with this
branch is empty and neither touches shipped source** — between them they change only
`.claude/skills/`, `.claude/reports/`, `.claude/system-reviews/`, `.claude/code-reviews/` and
`.gitignore`. `MERGEABLE` / `CLEAN` confirmed at `67bb82a`. So no guarantee in this PR rests on a
relationship a sibling merge broke, and the branch is correctly left un-rebased.

Round 1 left no rebase notes to close (it *was* the first round). I ran the rest of the pass anyway
over the round-2 delta — conditional comments, and every "always / never / cannot / the same as"
in the added lines. Three did not survive re-derivation and are **F19**, **F21** and **F23** below;
the rest hold, including the two load-bearing ones:

- **`offer-state.ts:47` — "A re-offer of the same RIDE after a genuine expiry carries a new offer
  row id, so it is never blocked by this."** This is what makes F2's `answeredOfferIds` safe, so I
  verified it at the source rather than inheriting it: `RT.rideOffer` is emitted from exactly one
  place (`dispatch-notifier.ts:66`), reached once per created offer, and `ride_offers` has one
  insert site (`dispatch.repository.ts:80`) writing a per-attempt id. Holds.
- **`queue-notifier.ts:56-58` — "the same number Dina's grid shows for this driver."** Holds, and
  more strongly than stated: there is no second size to disagree with. `buildZoneRows`
  (`board/zone-rows.ts:36-62`) emits no size and `zone-grid.tsx:178` uses `entries.length` only for
  the empty state, so `position` is the only number both surfaces show.

## Findings

Codes continue round 1's series so triage stays unambiguous.

### F16 · Medium · `packages/shared/src/schemas/offer-push.ts` — a new shared contract with no test in the seam package

F7's fix is the right shape, but the contract it creates arrives bare. `packages/shared/tests/`
holds 23 files and every other schema module has one (`schemas-dispatch.test.ts`,
`schemas-geo.test.ts`, `schemas-ride-request.test.ts`, …); `offer-push.ts` is the only module in
`src/schemas/` without one. `packages/shared/CLAUDE.md:9` is not ambiguous — *"Every contract change
ships with tests"* — and the repo rule adds *≥1 expected + 1 edge + 1 failure*.

The two consumer suites only ever feed the schema **valid** input
(`dispatch-notifier.spec.ts:115,151`; `route-notification.test.ts:92,110`), so **no test anywhere
exercises rejection** — which is the failure case, and the whole reason the envelope became a schema
rather than staying string literals.

**Fix**: `packages/shared/tests/offer-push.test.ts` — expected (full envelope), edge (ids-only,
`offer` absent, still parses), failure (`kind: 'nudge'` or a non-uuid `offerId`, rejected).

### F17 · Medium · `apps/driver/src/features/push/push-registrar.tsx:38-39` — F2 closed the card, not the navigation

F2's stated harm was two things: the answered card reappearing over the active ride, **and**
`route_offer` pulling the driver off `/active-ride`. `answeredOfferIds` stops the first. The second
is unguarded:

```ts
if (route.offer) receive(route.offer, 'push');   // :38  now a no-op for an answered id
router.navigate('/offer');                        // :39  runs regardless
```

`offer-screen.tsx:16` finds no card and returns `<Redirect href="/home" />`. **A driver mid-ride is
still moved off `/active-ride`** — now to `/home`, which carries no active-ride affordance (grep for
`active-ride` in `home-screen.tsx` returns nothing) and from which nothing routes back:
`route_ride` is emitted only on `assigned` (`active-ride-state.ts:340`), and the only other entries
to `/active-ride` are `use-offers.tsx:130`, `use-active-ride.tsx:144` and the onboarding gate
(`onboarding-state.ts:18`), which runs on app open. Recovery is a relaunch.

**Reachable on the app's own normal path, not an exotic one**: a foreground push is kept out of the
tray (`register-push-token.ts:86-93`), but this app deep-links drivers to Waze / Google Maps
(`nav-links.ts`), so backgrounded-at-offer-time is ordinary. The tray entry for an offer accepted
in-app is never dismissed; tapping it later, mid-ride, lands the driver on `/home`.

Note this is a **narrowing, not a regression** — before F2 the same tap re-showed the card, which
was worse. It is listed because it is the other half of F2's own stated harm.

**Fix**: navigate only when there is something to show — `if (route.offer) { receive(route.offer,
'push'); router.navigate('/offer'); }` — or have `receive` return whether the card was taken and
gate the navigate on that.

### F18 · Medium · the PR body's Figures table is stale at the PR's own head

The table's header claims *"**Every** row below was re-run at `cdddf2f`"*, and that claim is honest
— but the PR's head is `67bb82a`, and that commit (`docs(driver): sweep the whole Figures table…`)
added 26 lines to `.claude/reports/pr-154-review-fixes.md`. **The commit that documented the sweep
invalidated two rows of the table it swept.**

| Row | PR body says | `observed` at `67bb82a` |
|---|---|---|
| Diff size | 105 files, **+8,047** / −166 | 105 files, **+8,073** / −166 |
| Insertions by surface | … + docs+.claude **991** + 64 = **8,047** | … + docs+.claude **1,017** + 64 = **8,073** |

`git diff --shortstat origin/main...HEAD` → `105 files changed, 8073 insertions(+), 166 deletions(-)`,
and `gh pr view 154 --json additions` → `8073`. Any reader comparing the body against the PR page
sees the disagreement. Medium rather than Low because the body is the most-read surface and the only
one not in the working tree, and because this is precisely the self-referential shape the header sets
out to avoid.

**Do not fix it by editing the two numbers.** That is what `67bb82a` did, and it recreates the
defect the moment the F16/F17 fixes land — a third round of the same shape is worse than the first.
The row is **structurally self-invalidating**: every commit changes it, including the commit that
re-derives it. Either drop its precision (a file count and an order of magnitude do the job the row
exists for), or re-run it as the last act before merge and label it with the sha it describes.
Everything else in the table re-derived exact — see the numbers pass below.

### F19 · Low · `services/api/src/features/dispatch/dispatch-notifier.ts:21-31` — F7 moved the constant and left its docblock behind

The block is now an **orphan**: a `/** … */` with nothing under it, separated by a blank line from
the class's own docblock at `:33`, documenting a constant that lives in `packages/shared` since F7.
Its content is also false post-F7 — it enumerates *"`kind` + the three ids + `expiresAt` ≤ ~200 B"*,
while the envelope built at `:91-96` carries `kind` + **two** ids and no `expiresAt`, which F7
deleted from the wire. Retiring a claim means retiring its subject.

Two smaller drifts in the surviving copy, same cause:

- `offer-push.ts:35` calls 2,048 *"Expo's per-notification `data` budget"*. Expo's limit is 4,096
  for the whole message; 2,048 is this project's sub-cap on the offer JSON. The copy with the
  `derived:` provenance is the one being deleted.
- `offer-push.ts:36` says the offer is included *"only if the **whole payload** stays under it"*,
  but the guard measures the offer JSON **alone** (`dispatch-notifier.ts:87`,
  `Buffer.byteLength(json,'utf8')`). Headroom absorbs the difference — no behaviour change.

**Fix**: delete `:21-31`; move its `derived:` arithmetic into `offer-push.ts`, re-derived for the
current envelope (two ids, no `expiresAt`), and say the budget bounds the offer JSON.

### F20 · Low · `apps/driver/src/features/availability/home-screen.tsx:89-97` — F4 site 2 traded a wrong name for an absent one

Site 1 composed; site 2 dropped the label. Dropping it leaves the earnings link with **no accessible
name at all** whenever `EarningsCard` renders no text — `body === null` →
`<ActivityIndicator>` (`earnings-card.tsx:33-34`), which is the load window on every cold launch.
When the *first* load fails the name is `'—'` (`:8`, `:24-25`; `use-earnings.ts` only calls
`setEarnings` on success, so a later error keeps the last good value). `accessibilityHint` is spoken
by both VoiceOver and TalkBack, so the control is not silent — but an empty *name* is a WCAG 4.1.2
failure and a blank row in the rotor. Neither state is covered: `home-screen.test.tsx:184-214` runs
with `mockEarningsStatus = 'ready'`.

Transient, hence Low. **Fix**: compose, as site 1 does — lift the card's `body` and set
`accessibilityLabel={[t('driver.action.earnings'), body].filter(Boolean).join('. ')}`, non-empty in
all three states with the number still in the name when there is one.

### F21 · Low · `apps/driver/src/features/push/route-notification.ts:28` — the `kind` half of F7's guarantee is a bare literal

```ts
if (!isRecord(data) || data.kind !== 'offer') return { kind: 'gate' };   // :28  bare literal
const envelope = offerPushDataSchema.safeParse(data);                    // :33  shared schema
```

The gate runs **before** the shared parse. Change `z.literal('offer')` and the api fails typecheck
(good) — but the fix the developer then makes is on the api side, and `:28` still compiles, so
every offer push falls to `{ kind: 'gate' }` → `push-registrar.tsx:42` → `router.replace('/')`. Two
docblocks state otherwise: `route-notification.ts:29-32` (*"a rename on either side now fails
typecheck rather than silently degrading"*) and `offer-push.ts:11-13`, which names *"renaming `offer`
**or changing `kind`**"* as what the schema closes. The `offer` half is genuinely closed; the `kind`
half is not. Nothing is broken today — the claim is.

**Fix**: `data.kind !== offerPushDataSchema.shape.kind.value`, or narrow both docblocks to `offer`.

### F22 · Low · `apps/driver/src/features/offers/offer-card-props.ts:120-130` — the composed label has no sentence boundaries

Segments 2–6 carry no terminal punctuation (`'Skaidrā naudā'`, `'Iekāpšana: {address}'`,
`'Galamērķis: {address}'`, `'Līdz pasažierim ~{minutes} min · {km} km'`, `'Rindā: {position}. no
{size} · {zone}'` — `lv.ts:296-299,314`), and the join is a bare space. The result runs on:

> …Atlikušas 18 sekundes. **Skaidrā naudā Iekāpšana:** Brīvības 1 **Galamērķis:** Teika…

No pause between the payment method and the pickup — the one boundary F4's ordering rationale rests
on. **Fix**: `.map(s => /[.!?]$/.test(s) ? s : `${s}.`).join(' ')`. A plain `.join('. ')`
double-punctuates after `a11y_card`.

### F23 · Low · `apps/driver/src/features/offers/offer-state.ts:43-46` — the docblock records more than `cleared` does

*"Ids of cards that have already left the screen"* — but `answeredOfferIds` is written only inside
`cleared` (`:156-161`), and the replace branch at `:194-208` swaps `state.pending` for a different
offer id without going through it. No failure scenario attached: reaching it needs two live cards
for one driver, which `dispatch.service.ts:110` (`findDriverIdsWithLiveOffers`) exists to prevent.
**Fix**: record the outgoing id in the replace branch, or narrow the wording to *"answered or
revoked"*.

### F24 · Low · `apps/driver/src/features/push/route-notification.test.ts:34` — the fixture still carries a field the api cannot send

`offerData()` sets `expiresAt: wire.expiresAt`, the key F7 removed from the producer. Zod strips it,
so the four older cases pass while pinning a wire shape that no longer exists — and the file now has
two envelope-construction paths, the new ones (`:91`, `:109`) building through
`offerPushDataSchema.parse`. **Fix**: drop the key, or build the helper through the schema too.

### F25 · Low · `services/api/src/features/dispatch/queue/queue-notifier.ts:66` — the guard is dead and the comment misreads it

`Math.max(entries.length, entries.at(-1)?.position ?? 0)` is correct but neither operand can lose in
the way the comment implies. `snapshotFrom` (`dispatch-queue.store.ts:105-121`) walks the raw list in
order assigning `position = index + 1` and only ever *drops* repeats, so positions ascend and
`entries.at(-1).position >= entries.length` **always**; `?? 0` is unreachable behind the
`entries.length === 0` return at `:43`. So `size` is simply *the largest issued rank* — which
over-counts by the duplicates ahead of the last unique driver (`['A','A','B']` tells A "1 of 3" with
two drivers queued). That is the right trade, but *"Take the larger of the two"* implies either can
win and that `size` still means queue size. **Fix**: `entries.at(-1)?.position ?? entries.length`,
with the `snapshotFrom` monotonicity named as the invariant it rests on.

---

## Round 1 — how each finding was discharged

Re-derived by me at `67bb82a`. Two I settled with a reducer probe rather than reading the fix
report's word for it (written, run, reverted; the driver suite is otherwise untouched by it).

| # | Sev | Discharged | How I checked |
|---|---|---|---|
| **F1** | High | ✅ | `use-presence.tsx:320` guarded, between `queue.clear()` and `writeIntent('offline')`; the comment names the Android cause *and* the durable-state consequence. The fix report's correction is right and worth keeping: **F1 is not differential to this PR**. `observed`, not inherited — I re-ran it against the merged base, since `cdddf2f` has touched that file since the report's own command was written: `git diff origin/main 602d5fb -- …/use-presence.tsx` → **0 lines**, and `git show origin/main:…/use-presence.tsx` carries the unguarded `await deactivateKeepAwake(KEEP_AWAKE_TAG)` at `:315` (the guarded copy is `:192`). |
| **F2** | High | ✅ **wider than specified** | `answeredOfferIds`, cap 8, written in `cleared` — the single funnel. **`observed`**, probe at `67bb82a`: decline A → offer B → accept B → A's late push → `phase = idle` (the case a single `lastOfferId` misses). Control: a genuinely new id after an answer still shows, `["alert_start","route_offer","announce"]`. The widening is justified and the deviation is recorded. Residual: **F17**. |
| **F3** | High | ✅ | `seqRef` bumped on issue **and** on `post_step`/`post_complete` (`use-active-ride.tsx:107,122,131`), captured before the `await`, dropping `loaded` and `load_failed` alike. No read can be dropped without a successor: `step_pressed` requires `state.ride` (`active-ride-state.ts:219`), so `loading` cannot stick, and `busy` (`:222`) blocks a double post. The `step_failed` reconcile read is issued after the bump, so it still applies. |
| **F4** | High | ✅ | Site 1 composes every line the sighted driver reads, with the instruction split into `driver.offer.a11y_accept` and appended **last** — the right call, and correct in all three catalogs (`lv:312`, `ru:268`, `en:264`), with the instruction removed from `a11y_card` so nothing duplicates. Site 2 fixed with a residual: **F20**. Polish: **F22**. |
| **F5** | Med | ✅ | `deadOnArrival` early-returns for `'socket'`. **`observed`**, same probe: a fresh socket offer on a clock 45 s fast → `pending`; the identical shape as a push → `idle` with the new `console.warn`. `source` has one shipped construction site (`use-offers.tsx:164`) and is required, so a missed site fails typecheck. The docblock now gives both tolerances (one window as lateness, two as skew) instead of conflating them. |
| **F6** | Med | ✅ | `size` can no longer be smaller than a position, and the result still satisfies `driverQueueEventSchema`. Nit only: **F25**. |
| **F7** | Med | ✅ | `offerPushDataSchema` in shared, exported at `index.ts:19`, importing only `zod`; shared still imports nothing from the workspace. `data: OfferPushData` is a type annotation rather than a `.parse()`, and that is sufficient for the `offer` half — the type is `z.infer`, so a rename breaks `dispatch-notifier.ts:91` and `route-notification.ts:44` together. `expiresAt` gone from the producer, nothing reads it. Residuals: **F16**, **F19**, **F21**, **F24**. |
| **F8** | Med | ✅ | Deploy order stated at `realtime-events.ts:123-131` and in `realtime-events.md`, and the claim checks out: `paymentMethod` is `z.enum(...)` with no `.default`/`.optional` (`:136`), `use-offers.tsx:182-186` logs `ride:offer dropped` and returns. The refusal to add `.default('cash')` is right. |
| **F9** | Low | ✅ | All three re-derived at `67bb82a`: `ui-decisions.md` `5 0`; driver test files **17**; `no-unsafe-argument` **12 total, 11 pre-existing** — I watched the 12th print in my own lint output at `ride-read.integration.spec.ts:69`. |
| **F13, F15** | Low | ✅ | The `findById` `SELECT` is now named in the cost enumeration (`queue-notifier.ts:19-23`); the `ride:offer` row carries `paymentMethod`. |
| **F10–F12, F14** | Low | ➡️ deferred | Issues **#157**, **#158**, **#159**, **#160** — all four exist and are OPEN, each naming its finding. Correct call: the review said they were fine as follow-ups. |

## The numbers pass

Every figure in the PR body re-derived by me at `67bb82a`, one command each. **Two moved** (F18);
the other nine are exact.

| Claim | Stated | Re-derived at `67bb82a` |
|---|---|---|
| Diff size | 105 files, +8,047 / −166 | ❌ **+8,073** — F18 |
| Insertions by surface | 5,320 + 1,320 + 352 + 991 + 64 = 8,047 | ❌ **docs+.claude 1,017**, total **8,073** — F18; every other prefix exact |
| New test/spec files | 16 | ✅ 16 |
| Catalog keys added | 51 per language | ✅ 51 / 51 / 51 |
| Push payload guard | 2,048 B at `offer-push.ts:40` | ✅ the file is 40 lines and `:40` is the constant; the `4,096 − 120 − 200 − 2,048 = 1,728` arithmetic checks out. Its *prose* is F19 |
| Glance threshold | 10 / 3.6 = 2.78 m/s | ✅ `offer-card-props.ts:16` |
| Tone asset | 44,144 B | ✅ `wc -c`; 44 + 22,050 × 2 = 44,144 |
| Line caps (max 500) | 496 · 470 · 445 · 425 · 417, untouched 481 / 499 | ✅ all seven exact; a repo-wide sweep of shipped source over 500 returns **nothing** |
| `npx expo install --check` | 9 packages drift, all pre-existing | ✅ exactly 9, `expo-audio`/`expo-haptics` correctly absent; `apps/driver/package.json` untouched in round 2 |
| Fix report: `ui-decisions` +5 · driver test files 17 | — | ✅ both |
| Device day | 14 steps, not run | ✅ 14 |
| `Closes #140`, #15 stays open | — | ✅ `closingIssuesReferences` = `[140]`; #15 OPEN |
| Retired docblocks | grep returns nothing | ✅ all gone |

The fix report's own sweep table is honest about what it did: five rows moved, four re-derived
identical, and it names the `lv.ts` 442 → 445 row as the one a blanket header would have shipped
stale. That is the right instinct — F18 is the same instinct applied one commit too early.

## What's good

- **Every fix was watched to fail first, and the failing output is in the report.** F1's
  `Received array` stopping dead at `keepAwake.off`; F2's `Expected: "idle" Received: "pending"`;
  F3's `Expected: "arriving" Received: "accepted"`; F4's `Received string` with the payment method
  absent; F6 reverted deliberately to watch `Expected: 3, Received: 2`. That is the discipline the
  round-1 review asked for, applied without being asked twice.
- **F2 was fixed wider than the review specified, and the widening was tested, not asserted.** The
  reviewer's `lastOfferId` closes the reproduced case and misses the two-cards-back one; that hole
  was found by writing it as a test rather than by reasoning about it. My own probe confirms both
  the hole and the fix.
- **F4's ordering change is the sort of judgement a checklist does not produce.** Appending detail
  after «Pieskarieties, lai pieņemtu» would have told a blind driver to tap before they heard
  whether the fare is cash, so the instruction became its own catalog key and moved last. The
  accessibility fix improved the copy rather than merely satisfying the finding.
- **F7 refused the easy version twice**: `expiresAt` was *deleted* rather than newly consumed
  (it was redundant when `offer` fitted and useless when it did not, on a size-constrained wire),
  and `OFFER_PUSH_PAYLOAD_MAX_BYTES` moved *with* the schema on the argument that whether `offer` is
  present is part of the envelope's contract. Both are right.
- **`dispatch-notifier.spec.ts:113-119` is the assertion that would have caught the original
  drift** — it parses the built `data` with the shared schema *and* re-parses `data.offer` with
  `rideOfferEventSchema`. `queue-notifier.spec.ts:68-86` mocks `snapshotFrom(['A','A','B'])` output
  directly, pinning F6 at the shape that actually produces it.
- **F8 was answered with a sentence and a refusal.** `.default('cash')` would have invented a
  payment method the rider did not choose; the docblock says so, at the schema, where the next
  person to be tempted will read it.
- **A red first attempt at the fix round's own gate is recorded rather than buried** (14 prettier
  errors, `12 successful, 22 total`, fixed and re-run). So is the F1 correction that the finding is
  not differential to this PR — a note that makes the author's own PR look less good and is
  therefore worth more.

## Suggested order

**Before merging:**

1. **F17** — one line and a brace, plus a test that a tap for an answered offer does not navigate.
2. **F16** — one new test file, three cases.
3. **F18** — the durable form, not the two digits.

**After, or as follow-ups alongside #157–#160:** F19–F25. F19 and F21 are the two that state
something the code does not do, so they earn more than their size suggests.

Nothing here needs a re-plan. **Level 4 (the device day) is still owed** and is where F1's Android
rejection path and F4/F20's two screen-reader labels should be confirmed by ear.
