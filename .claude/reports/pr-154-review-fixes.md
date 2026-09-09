# PR #154 — round-1 review fixes

**Review:** [comment 5543585675](https://github.com/linardsb/taxi/pull/154#issuecomment-5543585675) ·
**Base of the round:** `602d5fb` · 2026-09-09

**All 4 Highs and all 4 Mediums fixed, plus F9 and two of the Lows. F10–F12 and F14 deferred to
issues #157–#160.** Nothing was dropped silently.

The review's verdict was *request changes* on four Highs, and its framing held up: none is a design
problem, and each named fix reached the case it was written for. Two went further than the review
specified, both recorded below with the reason.

## Ground check

| Check | Result |
|---|---|
| PR state | **OPEN**, `MERGEABLE` / `CLEAN`, CI green, not draft (`gh pr view 154`) |
| Head at start | `602d5fb` — unmoved since the review, so no fix had landed |
| Interrupted ops | `ls "$(git rev-parse --git-dir)"/{MERGE,REBASE,CHERRY_PICK}_HEAD` → none |
| Base | `main`, which moved to `6fdde96` during this session (#155, #156 merged). This branch is **deliberately not rebased** — its file overlap with both is empty, and `MERGEABLE/CLEAN` was re-confirmed after both merges. |

**`.claude/code-reviews/pr-154-review.md` was placed here UNTRACKED** (copied from `origin/main`,
where #155 landed it) so that `piv-review-pr`'s round-≥2 fix-mechanism pass can find it at the path
it keys on. It is not staged — staging it would sweep a review into the PR it reviews, the
#138–#142 failure. Same for `.claude/last-gate.json`, which is gitignored on `main` but predates
that rule on this branch.

## Highs

### F1 — unguarded `deactivateKeepAwake` aborts the sign-out chain · FIXED

`use-presence.tsx` awaited `deactivateKeepAwake(KEEP_AWAKE_TAG)` unguarded inside `onBeforeSignOut`,
between two guarded awaits. On Android the call rejects when the Activity that took the lock is
gone, and the rejection skipped `writeIntent('offline')`, the offline `PUT` and the state reset —
so `drivers.status` stayed `online` in Postgres and the persisted intent stayed `online`, which the
next cold launch re-asserts. On a handed-over phone that is the previous driver's presence
re-asserted under a new session.

**Watched it fail first.** The test already existed as `it.failing` with a docblock instructing the
flip. Flipped to a plain `it` *before* touching the source:

```
● a rejecting deactivateKeepAwake still writes the intent and tells the server
  Expected value:  "writeIntent:offline"
  Received array:  ["stopStreaming","push.delete","socket.disconnect","uploader.stop",
                    "queue.clear","keepAwake.off","delete:sakta.driver.session"]
Tests: 1 failed, 1 passed
```

The chain stops dead at `keepAwake.off`. After adding `.catch(() => undefined)`: `Tests: 2 passed`.

**Fix-mechanism check.** The `.catch` swallows the rejection silently, so a keep-awake failure from
some *other* cause is now invisible. That is the same trade the `keep_awake` effect 120 lines above
already makes deliberately ("the lock dies with the Activity anyway"); the new comment records the
reasoning at the site rather than leaving the next reader to rediscover it.

**One correction to the review.** F1 is **not differential to this PR** — `git diff origin/main
origin/feature/driver-offers-active-ride -- apps/driver/src/features/availability/use-presence.tsx`
returns **0 lines**; `main` ships the same unguarded call today. It is fixed here because the review
ruled on the PR body's own D14 question and said to, but "a defect this PR introduces" would be
false. The stale `it.failing` docblock was rewritten to say so.

### F2 — an answered offer is resurrected by the push carrying the same id · FIXED, wider than specified

The dedupe compared only against the card **on screen** (`state.pending?.offer.id`), and every
clearing path nulls `pending` — so after accept/decline/reject/revoke/expiry the same offer id was a
brand-new card. The api emits the socket event and the push together, so a driver who accepts faster
than Expo delivers always has one in flight: the card reappeared over the active ride, the tone
started, and `route_offer` pulled the driver off `/active-ride`.

**Watched it fail first** — `phase` after the late push was `"pending"`, exactly as the review
reproduced.

**Deviation from the review's fix, with the reason.** The review specified
`lastOfferId: string | null`. That closes the reproduced case but **has its own hole**, which I
tested rather than inherited: one id remembers one card, so decline A → offered B → answer B forgets
A, and A's slow push resurrects it inside the window `deadOnArrival` still tolerates. Written as a
test, it reproduced:

```
● a late push for an offer answered TWO cards ago is still dropped
  Expected: "idle"   Received: "pending"
```

So the field is `answeredOfferIds: string[]`, newest first, capped at `ANSWERED_MEMORY = 8` and
populated inside `cleared` — the single funnel all five clearing paths already run through.

**Fix-mechanism check.** The new failure mode is over-suppression: a *legitimate* offer silenced
because its id is remembered. Covered by its own test — a genuinely new offer id after an answered
one still shows with the full `alert_start / route_offer / announce` effect set. A re-offer of the
same *ride* after a real expiry carries a new offer row id, so it is never blocked.

### F3 — a stale `GET /rides/:id` reverts a completed step · FIXED

`loaded` guarded ride **identity** but not **recency**, and the provider issues `fetch_ride` from
three independent triggers (`open`, socket `connect`, `foreground`) with no sequence number and no
abort. The `ApiClient` timeout is 8 s, so a read issued before a step can answer after it.

**Watched it fail first**, at the provider level where the reads actually overlap (the reducer is
correct in isolation, so `active-ride-state.test.ts` cannot reach this):

```
● a GET that was in flight before a step cannot revert it
  Expected: "arriving"   Received: "accepted"
```

The primary button reverts from «Esmu klāt» to «Braucu pie pasažiera»; pressing it posts a step the
ride has already passed and earns a 409 `ride_not_accepted` on a healthy ride.

**Fix**: a monotonic `seqRef` bumped when a read is **issued**, and again on `post_step` /
`post_complete`; captured before the `await` and compared after, dropping both the `loaded` and the
`load_failed` dispatch if it moved. The second bump is load-bearing — without it the step's own
answer is overtaken by the older read.

**Fix-mechanism check.** The new failure mode is dropping a read whose answer was wanted. Two things
bound it: the re-read triggered by `step_failed` (the 409 path) is issued *after* the bump, so it
carries a higher token and still applies — pinned by the pre-existing 409 test, which passes
unchanged. And the ride-room re-join is a *server-side* effect of the GET, so it still happens even
when the answer is discarded; only the stale payload is dropped, never the join.

### F4 — `accessibilityLabel` on a grouping `Pressable` erases the content it wraps · FIXED (2 sites)

`Pressable` defaults `accessible` to true, collapsing the subtree into one node; an explicit
`accessibilityLabel` then **replaces** the accumulated child text instead of adding to it.

**Site 1 — `offer-card.tsx`.** The whole-card accept target announced fare, net and the countdown
and nothing else: payment method, pickup, destination, ETA and the queue line were all inaudible.
That is precisely the field `paymentMethod` was added to `ride:offer` for. Watched it fail:

```
Expected substring: "Skaidrā naudā"
Received string:    "Jauns brauciens. Cena €12.40, jūs saņemat €10.54. Atlikušas 18 sekundes.
                     Pieskarieties, lai pieņemtu."
```

**Fix**: `offerCardProps` now **composes** the label from every line the sighted driver reads.
**Order matters and drove a small i18n change**: the catalog string ended with «Pieskarieties, lai
pieņemtu» (*Tap to accept*), so appending detail after it would tell a blind driver to tap before
they heard whether the fare is cash. The instruction is now its own key,
`driver.offer.a11y_accept`, appended **last** in all three catalogs. Glance mode still hides the
addresses visually; audio keeps them, because speed is not blindness.

**Site 2 — `home-screen.tsx`.** A static «Ieņēmumi» replaced the earnings card's text, so the day's
figure was on screen and absent from the audio channel. Watched it fail:
`Unable to find an element with role: button, name: Šodien: €84.20 · Braucieni: 7`. **Fix**: drop
the static label (the review's option 1) so RN builds the name from the card's own text, and move
the purpose to `accessibilityHint`, which keeps «Ieņēmumi» without overwriting the number.
`home-screen.test.tsx` asserted the old behaviour and now asserts the number is in the name.

## Mediums

| ID | Fix | Verified by |
|---|---|---|
| **F5** | `deadOnArrival` is asked of **pushes only** — `PendingOffer` carries `source: 'socket' \| 'push'` | new test: a fresh socket offer on a clock 45 s fast still shows |
| **F6** | `size = Math.max(entries.length, entries.at(-1)?.position ?? 0)` | new test; **reverted the fix and watched it fail** — `Expected: 3, Received: 2` |
| **F7** | `offerPushDataSchema` + `OFFER_PUSH_PAYLOAD_MAX_BYTES` in `@taxi/shared`; both sides build/parse through it; the dead `expiresAt` removed from the wire | new cross-surface test in `route-notification.test.ts`, plus the api spec now pins the envelope with the shared schema |
| **F8** | deploy-order sentence in the `rideOfferEventSchema` docblock and in `realtime-events.md` | docs only, by design — the review's own instruction |

**F5 detail.** The countdown is deliberately server-relative to survive clock skew; this one check
was not. Measured as clock skew on a fresh offer the drop condition reduces to `skew > 2W` — 40 s at
the default 20 s window — and the drop is a bare `noop`: no card, no banner, no log. A driver whose
phone runs fast reads as online on Dina's board and simply never gets work. The docstring also
claimed a tolerance of "one whole window" for both readings; it is one window as *lateness* and two
as *skew*, and the docblock now states both. A `console.warn` was added on the drop, since it was
otherwise indistinguishable from the api never having offered.

**F7 detail.** The envelope was bare string literals on both sides with nothing spanning them, and
already drifting — the api sent `expiresAt` and nothing read it. `expiresAt` is now gone rather than
newly consumed: it was redundant whenever `offer` fitted, and unused when it did not, on a
size-constrained wire. `OFFER_PUSH_PAYLOAD_MAX_BYTES` moved to shared with the schema, because
whether `offer` is present is part of the envelope's contract, not an api implementation detail.

## Lows

**Fixed here** (both are documentation-accuracy defects — the class CLAUDE.md says the reviewer is
the only check on, and cheaper to fix than to file):

- **F13** — the cost enumeration omitted the Postgres `SELECT` (`geozones.findById`), the only one
  of the three components that leaves the process for a different store, on the sweeper's per-tick
  path. Now named.
- **F15** — `.claude/references/realtime-events.md`'s `ride:offer` row never mentioned
  `paymentMethod`. Now carries the field, its wire-only semantics, the deploy order from F8, and a
  pointer to `offerPushDataSchema`.

**Deferred to issues** — the review marks F10–F15 fine as follow-ups, and a clean small PR beats a
sprawling one:

| Finding | Issue |
|---|---|
| F10 — `ride-read.integration.spec.ts` leaks its `ride:status` listener | [#157](https://github.com/linardsb/taxi/issues/157) |
| F11 — one `try` wraps the whole revoke loop | [#158](https://github.com/linardsb/taxi/issues/158) |
| F12 — the oversize-push test is ASCII-only, so it cannot fail | [#159](https://github.com/linardsb/taxi/issues/159) |
| F14 — four duplications inside the new slices | [#160](https://github.com/linardsb/taxi/issues/160) |

## F9 — the three figures that did not re-derive · FIXED

Every one re-run by me at `602d5fb` rather than inherited from the review:

| Claim | Where | Command | Was | Is |
|---|---|---|---|---|
| `ui-decisions.md` line count | report T22, PR body *Docs* | `git diff --numstat c70572b..602d5fb -- .claude/references/ui-decisions.md` → `5 0` | +6 | **+5** |
| driver test files | report, *Tests added* | `git diff --name-status c70572b..602d5fb -- apps/driver \| grep -cE '\.(test\|spec)\.tsx?$'` → `17` (13 `A` + 4 `M`) | 21 | **17** |
| `no-unsafe-argument` warnings | report, *Validation* | `git diff --name-status c70572b..602d5fb -- …/ride-read.integration.spec.ts` → `A` | "12 pre-existing" | **12 total, 11 pre-existing** |

The count of 12 was right; "pre-existing" was the defect — the 12th is at
`ride-read.integration.spec.ts:69`, in a file this PR adds. Same class as #87/#107: correct
arithmetic on a slightly wrong subject.

## Validation

`observed` — `REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi
pnpm turbo run typecheck lint test build --force`, `--clean`, exit **0**, `short_gate: false`.
Produced by `record-gate.sh` (taken from `origin/main`, where #156 just landed it), not retyped:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m35.099s
```

```
@taxi/api       Test Suites: 76 passed, 76 total · Tests: 716 passed, 716 total
@taxi/driver    Test Suites: 40 passed, 40 total · Tests: 211 passed, 211 total
@taxi/rider     Test Suites: 30 passed, 30 total · Tests: 143 passed, 143 total
@taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
@taxi/shared    Test Files 23 passed (23) · Tests 226 passed (226)
@taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
```

`REDIS_TEST_URL` was set, so the Redis-gated suites ran — 0 skipped, matching the reviewer's own run.

**The deltas against the review's baseline at `602d5fb`, and the arithmetic behind them:**
`@taxi/driver` 204 → **211** is the seven tests this round adds (F2 ×3, F3 ×1, F4 ×0 — F4 tightened
two existing assertions rather than adding cases — F5 ×1, F7 ×2). `@taxi/api` 715 → **716** is F6's
one test. Every other package is byte-identical to the review's table, which is what an
app-and-api-only fix round should look like.

**The block says `at 602d5fb` and carries a dirty-tree caveat, and both are honest.** The run
covers the uncommitted fixes, which are exactly what the commit below contains — nothing changed
between the run and the commit. (That caveat printing *inside* the pasted block rather than only on
stderr is #156's M2 fix, landed an hour earlier, working on its first real use.)

**A first attempt at this gate went RED** and is recorded rather than buried: `@taxi/driver#lint`,
14 prettier errors in the files this round touched, `12 successful, 22 total`. Fixed with
`eslint . --fix`; the run above is the re-run. One api prettier error in F6's new spec was caught
the same way.


## The PR body's own Figures table — swept, because this commit moved it

F9 named three figures. But the body carries a nine-row `## Figures` table whose header claims a
provenance for **all** of them, and this fix commit changed the tree they describe. Re-labelling
that header `cdddf2f` while re-running only the obvious rows would be the #107 shape — a
provenance claim over unverified values — so every row was re-executed at `cdddf2f`:

| Row | Command | Was (`602d5fb`) | Is (`cdddf2f`) |
|---|---|---|---|
| Diff size | `git diff --shortstat origin/main...HEAD` | 101 files, +7,353 / −164 | **105 files, +8,047 / −166** |
| Insertions by surface | `git diff --numstat origin/main...HEAD` summed by prefix | 4,983 + 1,275 + 296 + 735 + 64 = 7,353 | **5,320 + 1,320 + 352 + 991 + 64 = 8,047** (sums exact) |
| Catalog keys added | `git diff … -- i18n/lv.ts \| grep -c "^+  '"` | 50 | **51** (F4's `a11y_accept`) |
| Push payload guard | `grep -rn "OFFER_PUSH_PAYLOAD_MAX_BYTES = "` | `dispatch-notifier.ts:30` | **`packages/shared/src/schemas/offer-push.ts:40`** (moved by F7) |
| Line caps (max 500) | `wc -l` on the five named files | `lv.ts` **442** | `lv.ts` **445** — F4's key plus its comment; still under cap |
| New test/spec files | `git diff --name-status … \| grep -cE '^A.*\.(test\|spec)\.tsx?$'` | 16 | **16** — this round modified test files, added none |
| Glance threshold | `grep -n GLANCE_SPEED_MPS offer-card-props.ts` | 10 / 3.6 | **10 / 3.6** |
| Tone asset | `wc -c apps/driver/assets/sounds/offer-tone.wav` | 44,144 B | **44,144 B** |
| `npx expo install --check` | `… \| grep -E "^ +expo.* - expected version:" \| wc -l` | 9 | **9** |

Five moved, four re-derived identical. The `lv.ts` row is the one that would have shipped stale
under a blanket header: nothing in F1–F9 points at it, and only re-running the `wc -l` finds it.

**Nothing in shipped source is over the 500-line cap** — `find … | xargs wc -l | awk '$1>500'`
returns only `dist/` build output, which the rule exempts.

## Needs a human look

- **Level 4 (device day) is still owed** and is unaffected by this round — no fix here is
  device-only, but F1's Android rejection path and F4's two VoiceOver/TalkBack labels are exactly
  the kind of thing the emulator/device pass should confirm by ear.
- **F8 is a deploy-order constraint, not code.** It now lives in the schema docblock and the
  reference doc, but nothing enforces it. If the api and the driver binary ever ship from one
  pipeline, that ordering needs to be in the pipeline.
