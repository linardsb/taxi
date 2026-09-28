# PR #298 review fixes, round 1

Review: https://github.com/linardsb/taxi/pull/298#issuecomment-5868663041 (round 1, head `ae31fc5`, approve, six Lows).

No scope direction came with the link, so this pass takes the review's own recommendation: all six in one commit on this branch. Nothing is deferred. Every change is in the commit that adds this file, whose parent is `ae31fc5`.

## Fixed

**L1 · `docs/spikes/04-gps-field-test.md:82`.** Step 14 quoted the card label with «Atlikušas N sekundes…», which the label has not had since #263. It now reads «Jauns brauciens. Cena €X, jūs saņemat €Y. …», with the note that it has had no seconds since #263. The trailing «…» stays, because `a11yLabel` goes on past the `a11y_card` template. There is no test for it (docs).

**L2 · `offer-card-props.ts`.** Removed `OfferCardProps.seconds` from the interface and the returned object. The local at `:87` stays because `countdown` is built from it.
- Readers: the review named `offer-card-props.test.ts:239-240`, `offer-card.test.tsx:26` and `:152`. `:197` (`props!.seconds`) was a fifth. It is deleted, since `:198` already asserts the same value through `countdown`.
- In the #263 case, `seconds` became `at18.countdown` / `at3.countdown` against `t('driver.offer.countdown', { seconds: 18 | 3 })`. It still pins what it pinned: the visible prop changes while the label does not.
- `git grep -n OfferCardProps -- apps/` outside `offers/offer-card*` finds only the re-export at `offers/index.ts:8`. Nothing else could read the field.
- Proof (`observed`, this session, in `apps/driver`): with the field removed and the test files restored from `ae31fc5`, `npx tsc --noEmit` printed 5 errors: TS2339 at `offer-card-props.test.ts` 197, 239 and 240, and TS2353 at `offer-card.test.tsx` 26 and 152. That is every reader, and nothing in shipped source. With the updated tests, `tsc` exits 0, `eslint src/features/offers` exits 0 and `jest src/features/offers` gives `Tests: 56 passed, 56 total`.

**L3 · `.claude/references/ui-decisions.md:28`.** Took the record option rather than a separate `Text`. It changes no behaviour and adds no untested tree change. The line now says that the hidden countdown line also carried «Pieņem…» while an accept is in flight, and that this state still reaches a screen reader as the card's `busy` state.

**L4 · `offer-state.ts:106-109`, `use-offers.test.tsx:277-279`.** "~20 s card read" is now "the card read (19.62 s at the default rate, 35.55 s at rate 50: runbook «#279 re-run»)". The value sweep (below) found two more copies: `ui-decisions.md:28` and the plan's two code excerpts. All of them are changed.

**L5 · `ui-decisions.md:28`.** Added the arrival line as the second cause, with its `derived` figure and assumption, and a third revisit trigger: "or the arrival line moves after the name". The arithmetic, from the review's default-rate excerpt:
- 43.402 − 43.391 = 0.011 s gap.
- 41.213 + 19.623 = 60.836, so the name would end at 11:33:00.836.
- 01.024 − 00.836 = 0.188, which is 0.19 s before expiry.
- This assumes TalkBack would start the focus read at the announcement's event time. No run tested that.

**L6 · `offer-countdown-opening-tick-279-report.md:55`.** The 2m26s run is now marked "commit not recorded", and the line points to the PR body's run at `ae31fc5` as the traceable one. I did not reconstruct a sha for it.

### What this commit makes stale

The tree-hash claim. The fix changes `apps/driver/src` (an unread prop, two docblocks), so `git rev-parse HEAD:apps/driver/src` is no longer `89147e9a4ef7`. Run A/B and the TalkBack runs ran on that tree, and the changes have no runtime effect.
- Report `:59` now says "at `ae31fc5`".
- The PR body's two tree-hash lines are reworded the same way after the push.
- The runbook's «#279 re-run» block is left alone. It names the tree the run used, and that is still true.

The PR body's size table. It is re-derived after the push and re-stated against a named head. This file carries no copy of it on purpose.

## Sweep (`observed`, this session, in the worktree and `gh pr view 298 --json body`)

| Retired value / noun | Command | Hits before | After |
|---|---|---|---|
| `~20 s` | `git grep -n "~20 s"` | `offer-state.ts:107`, `use-offers.test.tsx:278`, `ui-decisions.md:28`, plan `:671`, `:710`; PR body: none | none |
| `Atlikušas N sekundes` | `git grep -n "Atlikušas N sekundes"` | `docs/spikes/04-gps-field-test.md:82` | none |
| `Revisit if` | `git grep -n "Revisit if" -- .claude docs` + PR body | `ui-decisions.md:28` only | updated in place |
| `89147e9a4ef7` | `git grep -n 89147e9a4ef7` + PR body | report `:59`, runbook `:435`, PR body `:56`, `:68` | report and PR body reworded to "at `ae31fc5`", runbook unchanged (see above) |
| `.seconds` on the card props | `git grep -n "seconds" -- 'apps/driver/src/features/offers/*'` | props `:25`, `:110`; tests `:197`, `:239`, `:240`, `:26`, `:152` | none on `OfferCardProps` |

## Validation

`observed`: from cleared `dist` dirs and `apps/dispatch/.next`, `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` on this commit's tree, run in `wt-279-countdown` before committing, exit 0:
- `Tasks: 22 successful, 22 total`, `Cached: 0 cached, 22 total`, `2m10.263s`
- Driver: `Test Suites: 46 passed`, `Tests: 357 passed`. The count is unchanged because the fix deletes and rewrites assertions inside existing tests and adds no tests.
- Api: `Tests: 39 skipped, 874 passed, 913 total`. `REDIS_TEST_URL` was unset; the diff does not touch `services/api`.

## Needs a manual look

None. L3's open question, whether TalkBack spoke «Pieņem…» before this PR, is now recorded as unconfirmed rather than tested. Neither device run pressed accept.

## L2 cost: Run A/B re-run at `5ed281b`

`observed`, this session, `npx jest src/features/offers --verbose` in `apps/driver` at `5ed281b`, with the tree restored and `git status --porcelain` empty after each run:
- **Run A** (the 4 source files from `origin/main`): `Tests: 6 failed, 50 passed, 56 total`, down from 7 at `ae31fc5`. «never announces as the seconds run down» is now green on the old source. The old effect keyed off `card.seconds`, the `card()` fixture no longer sets it, and `undefined` never meets the `due` condition. Still red: «the visible countdown is out of the accessibility tree», both reducer arrival cases and all 3 provider cases.
- **Run B** (only the old card effect re-inserted, reading `seconds` through an `any` cast): `Tests: 56 passed, 56 total`, down from 4 failed. The bug needed the effect and the prop together, and L2 removed the prop.

So after L2 the card case pins the new contract, a card that announces nothing whatever its countdown shows, rather than reproducing #276's bug. The red-on-old proof now rests on Run A's provider and reducer cases, which drive the real props. I did not re-add a dead prop to keep Run B meaningful. The impl report and the PR body now name `ae31fc5` as the head for the 7/4 figures and quote these.
