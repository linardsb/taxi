# Code review — PR #154 · driver offer card, active-ride flow and receipt (#15)

**Head** `602d5fb` · **Base** `main` @ `c70572b499a3923025378ac16377fd57f3b6e9da` · **Round** 1
**Reviewer** `piv-review-pr` in a fresh context, plus three `code-reviewer` agents (offers+active-ride · api · shared+plumbing).
**Date** 2026-09-04

## Recommendation

**Request changes** — four High findings. None is a design problem; F1–F3 are each a few lines,
and F1 is one the PR body already puts to the reviewer.

This is a strong PR. The security-sensitive part — widening `GET /rides/:rideId` to drivers —
is correct, and I verified it at the guard rather than taking the PR body's word for it. Every
figure in the PR body re-derived exact. The three defects that matter are all races or
accessibility, not architecture.

## Validation

`observed` by me at `602d5fb`, tree clean (`git diff --quiet` → clean) before and after.

Parity gate from cleared dist (`packages/*/dist`, `services/api/dist`, `apps/dispatch/.next`
cleared with `fs.rmSync`), `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi
pnpm turbo run typecheck lint test build --force`:

| Task | Result |
|---|---|
| **Gate** | ✅ `Tasks: 22 successful, 22 total` · `GATE_EXIT=0` · `Time: 1m29.433s` |
| `@taxi/api:test` | ✅ `Test Suites: 76 passed, 76 total` · `Tests: 715 passed, 715 total` (0 skipped — the Redis-gated suites ran) |
| `@taxi/driver:test` | ✅ `40 passed` suites · `204 passed` tests |
| `@taxi/rider:test` | ✅ `30 passed` · `143 passed` |
| `@taxi/shared:test` | ✅ `23 passed` files · `226 passed` |
| `@taxi/dispatch:test` | ✅ `27 passed` files · `224 passed` |
| `@taxi/db:test` | ✅ `3 passed` files · `17 passed` |

Every test count claimed in the PR body reproduced exactly. My wall time (`1m29.433s`) differs
from the PR body's (`1m49.402s`); both are honestly labelled `observed`, and the difference is
machine noise, not a discrepancy.

---

## Findings

### F1 · High · `apps/driver/src/features/availability/use-presence.tsx:315` — an unguarded `deactivateKeepAwake` aborts the sign-out chain

The PR body (D14) asks for the reviewer's call on this. **My call: fix it in this PR.**

```ts
await stopStreaming().catch(() => undefined);   // :311  guarded
await runtime.queue.clear().catch(() => undefined); // :314  guarded
await deactivateKeepAwake(KEEP_AWAKE_TAG);      // :315  NOT guarded
await writeIntent('offline');                   // :316  never runs if :315 rejects
```

The same call is wrapped in try/catch 123 lines earlier at `:190-195`, with the comment
*"Android throws when the Activity that took the lock is gone."* The codebase already knows this
call throws; the sign-out path is the one place it isn't guarded, and it is the only unguarded
`await` in that block.

**Failure**: Android, driver online, signs out while the Activity is being torn down →
`deactivateKeepAwake` rejects → `writeIntent('offline')`, the offline `PUT /drivers/me/status`
and the state reset are all skipped. `drivers.status` stays `online` in Postgres and the device's
persisted intent stays `online`, so the next cold launch re-asserts online. On a handed-over
phone that is the previous driver's presence re-asserted under a new session.

Dispatch exposure is bounded — `stopStreaming()` already ran, so the driver falls out of the
Redis proximity list that feeds `toCandidates` — so this is a durable-state desync, not an
offer flood. That is the honest scope.

**Payoff verified, not assumed** (`observed`): I applied
`await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);`, flipped the `it.failing`
at `use-session.sign-out.test.tsx:196` to a plain `it`, and ran the file —
`Tests: 2 passed, 2 total`, exit 0. Then reverted. The fix is one `.catch` plus that flip,
exactly as the test's own docblock instructs.

### F2 · High · `apps/driver/src/features/offers/offer-state.ts:124` — an answered offer is resurrected by the push carrying the same id

The dedupe compares only against the **current** card:

```ts
if (state.pending?.offer.id === incoming.offer.id) return noop(state);
```

Every clearing path goes through `cleared`, which sets `pending: null` (`:100`). After
`accepted` / `declined` / `rejected` / `revoked` / tick-expiry, the same offer id is a brand-new
card. `push-registrar.tsx:47` (`onReceived`) calls `receive()` on **every** foreground offer
push — the documented foreground suppression in `register-push-token.ts:86-93` suppresses the OS
banner, sound and list entry, not the `receive` call.

This fires on the **common** path, not an exotic one: the api sends the socket event and the push
together at `emitOffer`, so a driver who accepts faster than Expo delivers the push always has
one in flight.

**`observed`** — reducer probe at `602d5fb` (offer shown → `accept_pressed` → `accepted` → the
same offer re-delivered 3 s later):

```
phase after the late push = pending
effects                   = ["alert_start","route_offer","announce"]
```

The card reappears over the active ride, the tone starts, and `route_offer` pulls the driver off
`/active-ride`. Accepting it returns 409 `offer_not_pending` → the banner says another driver took
the ride they are currently driving, then `route_home`.

Not covered today: `offer-state.test.ts:67` and `use-offers.test.tsx:228` both only dedupe while a
card is still up.

**Fix**: add `lastOfferId: string | null` to `OfferState`, set it inside `cleared` (so all five
clearing paths are covered), and `noop` when `incoming.offer.id === state.lastOfferId`.

### F3 · High · `apps/driver/src/features/active-ride/active-ride-state.ts:152` — a stale `GET /rides/:id` reverts a completed step

`loaded` guards ride **identity** but not **recency**:

```ts
if (ride.id !== state.rideId) return noop(state); // a stale answer
```

and `use-active-ride.tsx:93-104` issues `fetch_ride` from three independent triggers (`open`,
socket `connect`, `foreground`) with no sequence number and no abort, so reads overlap. The
`ApiClient` timeout is 8 s, so an answer can be that stale.

**`observed`** — reducer probe at `602d5fb`: `open` → `loaded(accepted)` → `step_pressed` →
`step_done(arriving)` → then the in-flight read, issued before the step, answers with the
pre-step snapshot:

```
status after the stale answer = accepted     (was 'arriving')
```

The primary button reverts from «Esmu klāt» to «Braucu pie pasažiera». Pressing it posts
`/rides/:id/arriving`, `guardDriverStep` sees `status !== 'accepted'` and returns 409
`ride_not_accepted` — a red banner on a ride that is perfectly fine.

Not covered today: `active-ride-state.test.ts` never puts two reads in flight.

**Fix**: a monotonic `seq` ref in the provider, bumped when issuing `fetch_ride` **and** on
`post_step`/`post_complete`; capture it before the `await` and drop the `loaded` dispatch if it
has moved. Bumping on the step posts is required, or the sequence above survives.

### F4 · High · a11y — `accessibilityLabel` on a grouping `Pressable` erases the content it wraps (2 sites)

React Native's `Pressable` defaults `accessible` to true, which collapses the subtree into one
node; an explicit `accessibilityLabel` then **replaces** the accumulated child text rather than
adding to it.

**`offer-card.tsx:74`** — the whole-card accept target's label is
`t('driver.offer.a11y_card', { amount, net, seconds })`, which is *"Jauns brauciens. Cena
{amount}, jūs saņemat {net}. Atlikušas {seconds} sekundes. Pieskarieties, lai pieņemtu."*
Fare, net and the countdown — nothing else. The **payment method**, pickup, destination, ETA and
queue line are all inaudible. That is the one thing `paymentMethod` was added for: its own
docblock at `realtime-events.ts:117` says the field exists "so the card can make it unmissable at
accept". A blind driver accepts without knowing whether they are handling cash.

**`home-screen.tsx:82`** — same bug: `accessibilityLabel={t('driver.action.earnings')}` wrapping
`<EarningsCard>`, so the day's earnings figure is gone from the audio channel. The new test
encodes the regression rather than catching it — `home-screen.test.tsx:200` asserts the accessible
name is *exactly* that label.

**Fix**: compose rather than replace — append the payment label (and pickup) to `a11yLabel` inside
`offerCardProps`, and on home either drop the static label (RN then builds it from the child
`Text`, and `accessibilityRole="button"` still announces) or prefix the today string.

### F5 · Medium · `apps/driver/src/features/offers/offer-state.ts:95-98` — `deadOnArrival` puts the phone clock back on the socket path

The countdown is deliberately server-relative to survive clock skew. This one check is not:

```ts
return pending.receivedAtMs - expiresAtMs > pending.durationMs;
```

`derived`, fresh socket offer, window `W`: the phone reads `receivedAtMs ≈ sentAt + skew` while
`expiresAtMs = sentAt + W` comes off the wire unskewed, so the drop condition reduces to
`skew − W > W`, i.e. **`skew > 2W` = 40 s at the default `offerTimeoutSeconds: 20`**. A phone
whose clock runs 40 s fast drops every offer via `noop` — no card, no banner, no log. The driver
shows online on Dina's board and simply never gets work, which is the hardest failure in this app
to diagnose from outside.

Secondary, and a claim under CLAUDE.md's rule: the docstring says it tolerates "a skew of one
whole window". Measured as clock skew on a fresh offer the tolerance is **two** windows; "one
window" is only true read as lateness past the deadline. Fix the wording or the code.

**Fix**: carry `source: 'socket' | 'push'` on `PendingOffer` and apply `deadOnArrival` to `'push'`
only — which is what the docstring's own reasoning already says ("the socket path is live by
construction"). Add a `console.warn` on the drop either way.

### F6 · Medium · `services/api/src/features/dispatch/queue/queue-notifier.ts:60` — `size` and `position` can disagree, rendering "3 of 2"

`size: entries.length` counts **deduplicated** entries, while `position` is the **raw** list index
(`snapshotFrom`, `dispatch-queue.store.ts:110-119`, skips a repeat driver but keeps `index + 1`
for everyone behind them). `driverQueueEventSchema` permits the result (`position` min 1, `size`
nonnegative), so nothing rejects it.

**`observed`** — calling the compiled `snapshotFrom` directly with the duplicate that
`RedisDispatchQueueStore.joinBack:30-35` documents as a tolerated race:

```
snapshotFrom(['A','A','B']) -> [{A, position 1}, {B, position 3}], length 2
DIVERGENCE: driver B gets "position 3 of size 2"
```

Trigger probability is low — it needs the double-append `joinBack` deliberately tolerates, which
the store's own comment calls theoretical at pilot scale. Severity is Medium rather than Low
because the surface is queue fairness, which the evidence says is exactly where a number that
looks wrong destroys trust.

**Fix**: `const size = Math.max(entries.length, entries.at(-1)?.position ?? 0);` and emit that.
Leave `position` alone — the store makes it count the duplicate on purpose, so Dina's grid and the
driver's app read the same number.

### F7 · Medium · the offer push `data` envelope is a cross-surface contract in neither package

`dispatch-notifier.ts:87-93` builds `{ kind, offerId, rideId, expiresAt, offer }` from bare string
literals; `route-notification.ts:12,24-38` reads them back from bare string literals. Nothing in
`packages/shared` defines the envelope and no test spans both sides. The hard rule is explicit:
*every cross-surface contract lives in `packages/shared`*.

Evidence they are already drifting: the api sends `expiresAt` (`dispatch-notifier.ts:91`) and
`routeNotification` never reads it — `grep expiresAt route-notification.ts` returns nothing. A
dead field on the wire today.

Rename `data.offer`, or drop `kind`, and typecheck + lint + both suites stay green while every
offer push silently degrades to ids-only — or, on a `kind` change, `push-registrar.tsx:42` does
`router.replace('/')` and a tap on an offer push dumps the driver on the gate.

**Fix**: an `offerPushDataSchema` in shared that both sides build/parse through. Either read
`expiresAt` or stop sending it.

### F8 · Medium · `packages/shared/src/realtime-events.ts:126` — `paymentMethod` is required, with a silent-drop failure and no stated deploy order

`paymentMethod: z.enum(PAYMENT_METHOD_TYPES)` — no `.default`, no `.optional`. Asymmetric:

- new payload → old client: unknown key stripped by zod. Safe.
- **old payload → new client: `safeParse` fails.** `use-offers.tsx:181-185` logs
  `console.warn('ride:offer dropped')` and returns; `route-notification.ts:30-33` yields
  `offer: null`, `/offer` finds nothing pending and redirects home.

So a driver binary that reaches phones before the api ships T2 receives no work at all, with a
console warning as the only trace. `route-notification.test.ts:76-80` pins exactly that input.
Neither `docs/runbooks/hetzner-deploy.md` nor the plan states a rollout order.

**Fix is a sentence, not code**: state in the PR body and in the docblock at
`realtime-events.ts:115-121` that the api deploys before the driver binary. Do **not** add
`.default('cash')` — inventing a payment method is worse than dropping the card.

### F9 · Low · three figures in the PR body / implementation report don't survive re-derivation

typecheck, lint and test can't read prose, so this is the reviewer's job under CLAUDE.md.
Everything else in the figures table re-derived **exact** (see below); these three did not:

| Claim | Where | Actual (`observed`) |
|---|---|---|
| `ui-decisions.md` **(+6 lines)** | PR body *Docs*, report T22 | **+5** — `git diff --numstat origin/main..HEAD -- .claude/references/ui-decisions.md` → `5 0` |
| "**21** new or extended test files" (driver app) | report, *Tests added* | **17** — 13 `A` + 4 `M`, `git diff --name-status origin/main..HEAD -- apps/driver \| grep -cE '\.(test\|spec)\.tsx?$'` |
| "12 **pre-existing** `no-unsafe-argument` warnings" | report, *Validation results* | 12 total, but **11 pre-existing** — the 12th is `ride-read.integration.spec.ts:69`, a file this PR creates |

The count of 12 is right; the word "pre-existing" is the defect. Same class as #87/#107 — correct
arithmetic attached to a slightly wrong subject.

### F10 · Low · `services/api/src/features/rides/lifecycle/ride-read.integration.spec.ts:214` — `collectStatuses` never detaches its listener

`socket.on(RT.rideStatus, …)` with no matching `off`. The sibling spec removes its equivalent
listener explicitly at `dispatch.integration.spec.ts:438` with the comment *"a listener left
attached outlives the test and fires into a closed socket during teardown"* — the new spec
reintroduces the exact hazard the older one documents. **Fix**: return the handler (or an `off`
closure) and detach at the end of the test.

### F11 · Low · `services/api/src/features/dispatch/dispatch-notifier.ts:141-169` — one `try` wraps the whole revoke loop

`emitToRide` and the entire `for (const other of revoked)` share a single `try`, so the first
`emitToDriver` that throws aborts the remaining revokes: on a force-assign that superseded several
pending offers, only the first driver's card clears. The sibling doing the same job wraps each
iteration individually (`ride-lifecycle.service.ts:414-433`, `emitRevoked`). Low because the
realistic throw source is an adapter failure, which fails all of them anyway — but the two copies
of one tail should not differ. **Fix**: move the `try` inside the loop.

### F12 · Low · `services/api/src/features/dispatch/dispatch-notifier.spec.ts:135` — the oversize-push test can't fail

`'x'.repeat(OFFER_PUSH_PAYLOAD_MAX_BYTES + 52)` is pure ASCII, so `Buffer.byteLength(json,'utf8')
=== json.length` and the case proves only that the drop *branch* works. It never exercises the
byte counting, which is the one thing the guard exists for — and Latvian and Russian addresses are
exactly where the two diverge. The guard itself is **correct** (`:86` uses `Buffer.byteLength(json,
'utf8')`, which is the right measurement). **Fix**: one more case with e.g. `'ā'.repeat(1100)`
(2,200 bytes, 1,100 UTF-16 units) asserting the drop; a `.length`-based guard would pass it.

### F13 · Low · `services/api/src/features/dispatch/queue/queue-notifier.ts:19-20` — the cost claim omits a database round trip

> "At ≤ 10 drivers per zone that is one `LRANGE` and ≤ 10 room emits per mutation (`expected`)."

`broadcast` also awaits `this.geozones.findById(geozoneId)` at `:42` → a Postgres `SELECT`. The
enumeration omits the only one of the three components that leaves the process for a different
store, and the caller runs on the sweeper's per-tick path (`geozone-queue.strategy.ts:75`).
Magnitude is small; under CLAUDE.md an enumeration that omits a component is still the defect.
**Fix**: name the `findById` in the sentence.

### F14 · Low · duplication introduced within the new slices

- `driver.earnings.today` (`lv.ts:330`) is byte-identical to `driver.home.today` (`lv.ts:267`), in
  all three catalogs — six entries, one string. `earnings-screen.tsx:29` can reuse the existing key
  until the copy actually diverges.
- `TITLE_KEY` is defined twice, identically, inside one slice: `active-ride-state.ts:99-104` and
  `active-ride-screen.tsx:26-31`. Export one.
- `pctLabel` is byte-identical in `offer-card-props.ts:49` and `receipt.tsx:14`, and
  `paymentLabel`/`paymentMethodLabel` are one function under two names. `active-ride/index.ts:20`
  already exports both and `offers → active-ride` is the sanctioned direction
  (`apps/driver/CLAUDE.md:21`).
- `format-eur.ts`'s docblock keeps the file so "every consumer keeps importing through
  `@/features/availability`" — but its first new consumer, `earnings-screen.tsx:1`, imports
  `formatEur` straight from `@taxi/shared`. Fix the import or the docblock.

### F15 · Low · `.claude/references/realtime-events.md:10` — the `ride:offer` row wasn't updated for the new field

`realtime-events.ts:16-17` says "keep the two in sync". The row still enumerates what the event
carries ("Carries `quote` **and** `split`") and doesn't mention `paymentMethod`. The doc-sync test
(`realtime-events.test.ts:529-548`) pins event **names** only, so nothing catches payload drift.
The `driver:queue` row and the re-join rule *were* both updated correctly — this is the one miss.

---

## The numbers pass — everything that did re-derive

Re-derived by me at `602d5fb`, one command per claim. `origin/main` confirmed equal to the PR's
`baseRefOid` first.

| Claim | Stated | Re-derived |
|---|---|---|
| Diff size | 101 files, +7,353 / −164 | ✅ exact |
| Insertions by surface | driver 4,983 + api 1,275 + shared 296 + docs/.claude 735 + other 64 = 7,353 | ✅ exact; "other" is `pnpm-lock.yaml` alone |
| New test/spec files | 16 | ✅ exact |
| Catalog keys added | 50 per language | ✅ 50 / 50 / 50 |
| Push payload guard | 2,048 B | ✅ `dispatch-notifier.ts:30`; the ~1.7 KB headroom arithmetic (4,096 − 120 − 200 − 2,048 = 1,728) checks out, labelled `derived` |
| Glance threshold | 10 / 3.6 = 2.78 m/s | ✅ `offer-card-props.ts:16` |
| Tone asset | 44,144 B | ✅ `wc -c`; 44 + 22,050 × 2 = 44,144 |
| Line caps | 496 · 470 · 442 · 425 · 417, untouched 481 / 499 | ✅ all five exact, nothing over 500 |
| `expo install --check` | 9 drift, all pre-existing | ✅ exactly 9, and each pin byte-identical to `origin/main`; `expo-audio`/`expo-haptics` correctly absent from the list |
| Retired docblocks | grep returns nothing | ✅ all three phrases gone |
| `Closes #140`, #15 stays open | — | ✅ `closingIssuesReferences` = `[140]` only |

Two claims I checked because they are the kind that goes wrong here, and both held:

- **The per-route role widening is correctly scoped.** `RolesGuard` really does use
  `getAllAndOverride(ROLES_KEY, [getHandler(), getClass()])` (`roles.guard.ts:20-23`), so the
  method list replaces the class list. Only `@Get(':rideId')` carries `@Roles('rider','driver')`;
  `@Post()` and `@Post('quote')` still inherit the class-level `@Roles('rider')`. Nothing else
  widened.
- **D6's ordering claim holds.** `geozone-queue.strategy.ts:75` broadcasts before candidates are
  returned, so before `emitOffer`; the decline path broadcasts after `sendToBack` inside try/catch.

## Two observations, neither attributed to this PR

- **A flake, seen once.** Under `env -u REDIS_TEST_URL COMPOSE_PROJECT_NAME=taxi pnpm --filter
  @taxi/api test` at `602d5fb`, `drivers.integration.spec.ts › keeps a driver online when a vehicle
  that is not their last is deleted (edge)` failed with `socket hang up` (`1 failed, 35 skipped,
  679 passed`, exit 1). It then passed alone (`31 passed`) and passed on a full re-run of the same
  command (`35 skipped, 680 passed`, exit 0). **Cause not attributed** — I have no evidence it is
  this PR's, and F10 is the only concrete listener-hygiene gap in the area, which is not sufficient
  to explain it. Recorded so the next person who sees it has a prior.
- **CLAUDE.md's gated-test digit has drifted again.** The file says 33 skipped without
  `REDIS_TEST_URL`; the observed figure at `602d5fb` is **35** (2 skipped suites, as documented).
  **Not this PR** — it touches none of the five Redis-gated spec files. Worth a separate one-line
  correction, and worth noting the sentence around the digit was already re-observed in #121.

## What's good

- **`active-ride-screen.test.tsx:38-40` sets `request.paymentMethod: 'card'` against an operative
  `'cash'` and asserts the pill reads cash.** The payment-method hard rule pinned by a test that
  goes red the moment someone reads the snapshot instead of the operative field. That is the right
  way to enforce a rule that prose can't.
- **`PAYMENT_METHOD_EDITABLE_STATUSES` is derived, not listed** (`ride-lifecycle.policy.ts:52-53`):
  `RIDE_STATUSES.filter(s => !isPaymentMethodLocked(s) && !isTerminal(s))`. "Never bypass
  `isPaymentMethodLocked()`" made structurally impossible to bypass by copy-paste, and it can't rot
  when #21/#22 add a status.
- **`findForDriver` re-checks ownership on both reads** (`ride-lifecycle.service.ts:352`, `:373`),
  so a dispatcher release landing between them degrades to a truthful 404 rather than a stale
  snapshot — and the join sits strictly between them, so a stranger's socket is never put in the
  room the 404 is about to deny. One 404 shape for missing and foreign, asserted byte-identical at
  `ride-read.integration.spec.ts:289-310`. No enumeration oracle.
- **`stepFor` iterates the shared `DRIVER_STEPS` rather than restating it**
  (`active-ride-state.ts:89-97`), so the button the app shows is by construction the step
  `guardDriverStep` will accept — and `ride-state-machine.test.ts:16-42` pins the table as *edges of
  `ALLOWED_TRANSITIONS`* whose `from` set **equals** `ACTIVE_DRIVER_RIDE_STATUSES`, which is what
  makes moving it across a package boundary safe.
- **`route-notification.ts` gets untrusted-input discipline right**: `JSON.parse` inside the try,
  shared-schema validation, degraded-but-useful output on junk, and tests feeding it both malformed
  JSON and a schema-valid payload missing the new field.
- **`offer-card-props.test.ts:26-33` builds the split from a `platformConfigSchema` row through
  `resolveCommissionPct`**, so the 15 lives in a config fixture and never in an assertion — and the
  0%-override case proves the card reads «100%» rather than a hardcoded 85.

## Suggested order

1. **F1** — one `.catch`, flip `it.failing` → `it`. Verified to work.
2. **F2**, **F3** — write the failing test first in each case; neither is covered today.
3. **F4** — two labels.
4. **F5**–**F8** — F8 is a sentence; F6/F7 are small.
5. **F9** — correct the three figures in the PR body and the report.
6. **F10**–**F15** — cleanup, fine as follow-ups.

Nothing here needs a re-plan. After the fixes, re-run the gate and this review is discharged.
