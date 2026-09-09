# PR #154 — round-2 review fixes

**Review** `.claude/code-reviews/pr-154-review-round2.md` · [comment 5601634623](https://github.com/linardsb/taxi/pull/154#issuecomment-5601634623)
**Head at review** `67bb82a` · **Base** `main` @ `6fdde96` · **Date** 2026-09-09

Round 2 raised **F16–F25**: three Mediums and seven Lows, no Critical, no High. The review's own
recommendation was F16/F17/F18 before merge and F19–F25 as follow-ups.

**Triage taken: nine fixed, one deferred.** F19, F21, F22, F23, F24 and F25 were pulled forward
rather than logged, because every one of them is a comment or a one-line expression and the repo
rule treats a false comment as a defect, not a nit — an issue that says "this docblock lies"
costs more to carry than the edit it describes. **F20 is the only deferral** (issue **#161**): it
is the one Low that is not a one-liner, needing state lifted out of `EarningsCard` plus a
cosmetic decision on the loading copy.

## Ground check

PR #154 **OPEN**, base `main`, `MERGEABLE`. Working tree clean apart from the two untracked review
artefacts (`pr-154-review.md`, `pr-154-review-round2.md`) and `.claude/last-gate.json`. No
`MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD` (checked through `git rev-parse --git-dir`).
`git reflog -8` shows only this session's own moves. Review artefacts are staged **by path**, never
a blanket `git add` — the #138–#142 failure.

## The finding whose prescribed fix was wrong

### F17 — the tap navigates off the active ride · FIXED, **not** as specified

The review's harm is real and reproduces. Its prescribed fix is not:

```ts
if (route.offer) { receive(route.offer, 'push'); router.navigate('/offer'); }   // ← the review's
```

That gates the navigation on the **payload**, and the payload is optional by design: an offer whose
two addresses push the JSON past `OFFER_PUSH_PAYLOAD_MAX_BYTES` ships ids-only
(`dispatch-notifier.ts:87`), and today that tap correctly reaches the card the **socket** already
delivered — `emitOffer` sends both. Under the prescribed fix that tap does nothing at all.

The condition the code actually wants is *navigate iff `/offer` will render a card*, which is the
same guard `offer-screen.tsx:16` redirects on. `useOffers` gained `hasCard()`, reading `stateRef`
rather than `state`, so it is stable for the `useEffect` dep list **and** accurate immediately
after `receive` — `dispatch` writes `stateRef.current` synchronously before `setState`
(`use-offers.tsx:95-98`).

```ts
if (route.offer) receive(route.offer, 'push');
if (hasCard()) router.navigate('/offer');
```

**Both directions watched to fail**, `apps/driver/src/features/push/push-registrar.test.tsx`
(new — the app had no test for the registrar at all):

| Probe | `answered tap does not navigate` | `ids-only tap still navigates` |
|---|---|---|
| Unfixed (`navigate` unconditional) | ❌ `Expected number of calls: 0 / Received number of calls: 1` | ✅ |
| **The review's prescribed fix** | ❌ same | ❌ `Expected: "/offer"` — never called |
| Shipped fix | ✅ | ✅ |

The second row is why the second assertion exists: it is the only thing separating the correct fix
from the plausible one. Both probes were written, run and reverted; `push-registrar.tsx` is
byte-identical to the version committed.

The test drives the **real** `OffersProvider` and the **real** `routeNotification` — the Expo tap
listener is captured off the globally-mocked `expo-notifications`, so the assertion spans the whole
path from notification `data` to `router.navigate`, not a mocked context object.

## The rest

### F16 — a shared contract with no test in the seam package · FIXED

`packages/shared/tests/offer-push.test.ts`, five cases: the full envelope, ids-only (`offer`
absent still parses), `kind: 'nudge'` rejected, a non-uuid `offerId` and a nested-object `offer`
rejected, and one pinning `shape.kind.value` — the literal F21 now reads instead of copying.

**No red run to show, and that is not an omission.** There is no unfixed code here: the schema
already worked, the consumer suites simply never fed it invalid input. This is new coverage of a
rejection path, not a regression pin, so a "watch it fail" step would have to be staged to exist.

### F18 — the PR body's Figures table is stale at its own head · FIXED durably

Not by editing the two digits, which is what `67bb82a` did and what recreated the defect one commit
later. The two structurally self-invalidating rows (**Diff size**, **Insertions by surface**) are
now stated to the nearest hundred and say so, with the PR page's own `additions`/`deletions` named
as the exact and always-current source. A commit can no longer falsify them.

The **Push payload guard** row carried F19's false prose (`ids ≤ ~200 B`, `~1.7 KB headroom`) and a
line number the docblock edit moved; both are re-derived, and the line number is gone.

Re-derived as the last act, after the fix commit, so the sha the header names is the head it
describes.

### F19 — F7 moved the constant and left its docblock behind · FIXED

`dispatch-notifier.ts:21-31` deleted: an orphan `/** … */` over nothing, describing a constant that
has lived in `packages/shared` since F7, and describing it wrongly (`kind` + **three** ids +
`expiresAt`, when the envelope carries `kind` + two ids and no `expiresAt`).

Its arithmetic moved into `offer-push.ts`, re-derived for the current envelope and with both drifts
in the surviving copy fixed: 2,048 is **this project's sub-cap on the offer JSON**, not "Expo's
per-notification `data` budget", and the guard measures the **offer JSON alone**
(`Buffer.byteLength(json,'utf8')`), not the whole payload.

`derived`, and the envelope term is now `observed` rather than the old `≤ ~200 B` guess:
`JSON.stringify({kind:'offer',offerId:<uuid>,rideId:<uuid>,offer:''})` is **124 B**
(`node -e`, `Buffer.byteLength`). So 4,096 − 120 − 124 − 2,048 = **1,804 B** spare, which is also
what absorbs the escaping the offer JSON picks up nested as a string.

### F21 — the `kind` half of F7's guarantee was a bare literal · FIXED

`route-notification.ts:28` now reads `offerPushDataSchema.shape.kind.value` instead of `'offer'`.
The gate runs before the parse, so the literal was the one place a `kind` change could pass
typecheck on the app side while every offer push fell to `{ kind: 'gate' }`. Two docblocks claimed
otherwise; they are now true rather than narrowed. Pinned by the last case in `offer-push.test.ts`.

### F22 — the composed a11y label had no sentence boundaries · FIXED

`offer-card-props.ts`: each segment is terminated with a full stop unless it already ends in
`.!?`, then joined with a space. Only `a11y_card` and `a11y_accept` carry terminal punctuation in
the catalogs, so «Skaidrā naudā Iekāpšana: Brīvības 1» had no pause at the one boundary F4's
ordering rationale rests on. A bare `.join('. ')` would double-punctuate after the two that already
have it — asserted directly (`not.toMatch(/\.\./)`) alongside the boundary itself.

### F23 — the docblock recorded more than `cleared` does · FIXED (wording)

`answeredOfferIds` is written only inside `cleared`, so "cards that have already left the screen"
over-claimed: the replace branch swaps `state.pending` without going through it. Narrowed to
"cleared through `cleared` — accepted, declined, expired or revoked", with the replace branch's
absence stated and justified (`findDriverIdsWithLiveOffers` keeps one live card per driver, so it
has no reachable case). Wording, not behaviour — the review offered both and there is no failure
scenario to pin.

### F24 — the fixture carried a field the api cannot send · FIXED

`expiresAt` dropped from `offerData()` in `route-notification.test.ts`. Zod stripped it, so the
four older cases passed while pinning a wire shape F7 removed from the producer.

### F25 — the guard was dead and the comment misread it · FIXED

`Math.max(entries.length, entries.at(-1)?.position ?? 0)` → `entries.at(-1)?.position ?? entries.length`.
`snapshotFrom` assigns `position = index + 1` over the raw list and only ever drops repeats, so
positions ascend and the last is always the largest; `entries.length` can never win, and the `?? 0`
sat behind an `entries.length === 0` early return. The comment now names that monotonicity as the
invariant it rests on and says what `size` means — the largest issued rank, over-counting by the
duplicates ahead of the last unique driver — instead of "take the larger of the two", which implied
either could win. Behaviour identical under the invariant; `queue-notifier.spec.ts:68-86`
(`snapshotFrom(['A','A','B'])` → size 3) is the case that distinguishes it and still passes.

## Deferred

- **F20** → **#161**. The earnings link has no accessible name while `EarningsCard` renders a
  spinner (every cold launch) — a WCAG 4.1.2 failure, transient. Deferred because it is the one Low
  that needs a state lift out of the component plus a catalog/cosmetic decision on the loading
  copy, not a one-line edit. The issue records both, and points at the Level 4 device day.
- **#157–#160** (round 1's F10–F12, F14) remain OPEN and untouched.

## Validation

`observed`, 2026-09-09, on the tree committed here. Parity gate from cleared dist
(`packages/*/dist`, `packages/config/dist`, `services/api/dist`, `apps/dispatch/.next`, `db/dist`
cleared with `fs.rmSync`),
`REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`:

**`Tasks: 22 successful, 22 total`**, `GATE_EXIT=0`, `Cached: 0 cached, 22 total`,
`Time: 1m30.427s`. `REDIS_TEST_URL` set, so the Redis-gated suites ran (0 skipped).

| Package | At `67bb82a` (reviewed) | Now | Moved by |
|---|---|---|---|
| `@taxi/api` | 76 suites · 716 tests | 76 · 716 | — |
| `@taxi/driver` | 40 suites · 211 tests | **41** · **214** (+1 file, +3) | F17's `push-registrar.test.tsx` ×3 |
| `@taxi/rider` | 30 · 143 | 30 · 143 | — |
| `@taxi/shared` | 23 files · 226 | **24** · **231** (+1 file, +5) | F16's `offer-push.test.ts` ×5 |
| `@taxi/dispatch` | 27 files · 224 | 27 · 224 | — |
| `@taxi/db` | 3 files · 17 | 3 · 17 | — |

F22's boundary assertions and F19's docblock live inside files that already existed, so they move
no count — the two that moved are the two new files, and nothing else did. Both PR-body test
tables are re-derived from this run rather than copied forward; that inheritance is what F18 is
about.

Per-fix runs before the gate, `observed`:

- `pnpm --filter @taxi/shared exec vitest run tests/offer-push.test.ts` → `5 passed`, 1.24 s.
- `pnpm --filter @taxi/driver exec jest src/features/push src/features/offers` → `8 passed`
  suites · `52 passed` tests, 4.781 s.
- The two F17 probes above, each run and reverted.

## Needs a human look

- **Level 4 (the device day) is still owed** — `docs/spikes/04-gps-field-test.md` `## #15 device
  day`, 14 steps, not run. F17 is exactly the kind of thing it should confirm: background the app
  at an offer, accept in-app, then tap the stale tray entry mid-ride and check the screen does not
  move. F22's label and F20's (deferred) loading state want the same pass, by ear.
- **F23 was narrowed rather than implemented.** If the api ever allows two live offers for one
  driver, the replace branch has to start recording the outgoing id — the docblock now says so, but
  nothing enforces it.
