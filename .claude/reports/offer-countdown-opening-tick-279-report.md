# Implementation Report — offer countdown speaks once, on arrival (#279)

**Plan**: `.claude/plans/offer-countdown-opening-tick-279.md`   **Branch**: `fix/offer-countdown-opening-tick-279` (worktree `~/taxi-worktrees/wt-279-countdown`, off `origin/main` `c08b927`)   **Status**: COMPLETE

## Summary

The driver offer card now produces one countdown announcement, «Atlikušas N s», when it arrives, and nothing after that. The offer reducer emits it as `{ type: 'announce', seconds }`, and `OffersProvider` speaks it. `OfferCard` no longer announces. The visible countdown `Text` is out of the accessibility tree, and the duplicate «Jauns brauciens» announcement is gone. TalkBack on `sakta224`, run against the branch head, spoke no countdown line after `expires_at` at the default rate or at rate 50. D2 (the earnings link's loading and failed-first-load states) is recorded verbatim.

## Tasks completed

- 1 `offer-state.ts`: `announce` carries `seconds`, emitted once at `offer_received` (UPDATE)
- 2 `use-offers.tsx`: speaks `driver.offer.countdown` with those seconds (UPDATE)
- 3 `offer-card.tsx`: announce effect, `ANNOUNCE_EVERY_S`, `useRef` and `AccessibilityInfo` removed; countdown `Text` hidden (UPDATE)
- 4 `offer-card-props.ts`: comment only (UPDATE)
- 5 `offer-state.test.ts`: 4 reducer cases (UPDATE)
- 6 `use-offers.test.tsx`: 3 provider cases. `offer-card.test.tsx`: 2 card cases, plus the accepting test's query now uses `includeHiddenElements` (UPDATE)
- Tasks 1–6 were applied as Appendix A with `git apply`. The patch applied cleanly because `origin/main` had not moved from `c08b927`. `git diff --stat` matched the spike's `7 files changed, 165 insertions(+), 33 deletions(-)` (`observed`, before any other edit).
- 7 Red on the old source, both directions (see Tests)
- 8 Full gate (see Validation)
- 9 Level 4 on the branch head. `docs/runbooks/driver-device-day.md`: the #276 row links onward, a new «#279 re-run» block, setup deltas, and two TalkBack-log notes (UPDATE)
- 10 `.claude/references/ui-decisions.md`: one dated line (UPDATE)
- 11 #257 comment: https://github.com/linardsb/taxi/issues/257#issuecomment-5868308030
- Phase 0: plan moved into the worktree. The main checkout's untracked copy is gone (it was moved, not copied).

## Tests added

| File | Case | Result |
|---|---|---|
| `offer-state.test.ts` | announces the whole window once, at arrival (#279, expected) | pass |
| | rounds a part-second window up, as the card draws it (#279, edge) | pass |
| | no tick announces, whenever it falls (#279, edge) | pass |
| | expiry clears the card with no announcement (#279, failure) | pass |
| `use-offers.test.tsx` | time left is announced once, on arrival (#279, expected) | pass |
| | no tick is announced while the card is still being read (#279, edge) | pass |
| | an offer that expires mid-read leaves no countdown line behind (#279, failure) | pass |
| `offer-card.test.tsx` | the visible countdown is out of the accessibility tree (#279, expected) | pass |
| | never announces as the seconds run down (#279, edge) | pass |

`pnpm --filter @taxi/driver exec jest src/features/offers` → `Tests: 56 passed, 56 total`, `Test Suites: 5 passed, 5 total` (`observed`; 47 existing + 9 new).

**Task 7, red on the old source** (`observed`, both `--verbose`):

- **Run A.** The 4 source files were checked out from `origin/main` and the tests run against them: `Tests: 7 failed, 49 passed, 56 total`.
  - Red: both reducer arrival cases, both card cases, all 3 provider cases.
  - Green by design, as regression pins: «no tick announces, whenever it falls» and «expiry clears the card with no announcement». The old reducer never announced on `tick`; the bug lived in the card.
- **Run B.** Only the old card effect was re-inserted into the fixed `offer-card.tsx`, with `ANNOUNCE_EVERY_S` as `5` and the `useRef` / `AccessibilityInfo` imports restored on the one-line import: `Tests: 4 failed, 52 passed, 56 total`.
  - Red: «never announces as the seconds run down» and all 3 provider cases.
  - All reducer tests stay green.

Both counts match the plan's prediction. Both ran at the `ae31fc5` tree.

Re-run at `5ed281b` (review round 1, L2 dropped the unread `OfferCardProps.seconds`): Run A gives `6 failed, 50 passed`, because «never announces as the seconds run down» goes green on the old source. The old effect keyed off `card.seconds`, and the fixed fixture no longer sets it. Run B gives `56 passed`, because the old effect alone no longer has its input. From `5ed281b` on, the card case pins the new contract (the card announces nothing, whatever its countdown shows), and the red-on-old proof is Run A's 3 provider cases plus the reducer arrival cases (`observed`, `pr-298-review-fixes.md`).

## Validation results

- Level 1: `pnpm --filter @taxi/driver exec tsc --noEmit` exit 0. `eslint src/features/offers` exit 0 (`observed`).
- Level 3 gate, from cleared `dist` dirs and `apps/dispatch/.next`: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` → `Tasks: 22 successful, 22 total`, `Cached: 0 cached, 22 total`, 2m26s (`observed`, commit not recorded; the traceable run is the PR body's, at `ae31fc5`: same counts, 1m41.235s).
  - Driver: `46 passed` suites, `357 passed` tests.
  - Api: `Tests: 39 skipped, 874 passed, 913 total`, `2 skipped` suites.
  - `REDIS_TEST_URL` was unset, so the 39 Redis-gated api tests did not run. The diff is driver-only and docs, so this does not bear on it.
- Level 4, TalkBack on `sakta224` against the branch head: driver source tree `89147e9a4ef7`, the value of `git rev-parse HEAD:apps/driver/src` at `ae31fc5` (the review-fix commit after it changes an unread prop and docblocks, so the tree moved). A tree hash is used because the `wip:` commit sha will not survive the squash. Pass rule results (`observed`):

| Check | Default rate | Rate 50 (`settings get` → `50`) |
|---|---|---|
| (a) `TYPE_ANNOUNCEMENT` «Atlikušas 20 s», exactly once | ✅ | ✅ |
| (b) `ttsOutput= {Atlikušas` evaluations = 0 | ✅ 0 | ✅ 0 |
| (c) no «Atlikušas» after converted `expires_at` | ✅ finished 17.63 s before | ✅ finished 16.93 s before |
| (d) no standalone «Jauns brauciens» announcement | ✅ | ✅ |
| (e) the slower rate reached TTS | — | ✅ same text «Atlikušas 20 s» 2.91 s vs 2.18 s (×1.33); card read 35.55 s vs 19.62 s (232 vs 194 characters) |

  - Expiry was converted UTC → BST (+1 h) → emulator (−0.93 s, the mean of three midpoint samples). The runbook block holds the arithmetic.
  - The expiry banner started 2.00 s after expiry at the default rate and 18.63 s after it at rate 50.

- D2, through the proxy in `hang` mode (`observed`):
  - Loading: «Ieņēmumi» → «Poga» → «Lai aktivizētu, Dubultskāriens».
  - Failed first load: «Ieņēmumi. —» → «Poga» → «Lai aktivizētu, Dubultskāriens».
  - «Ieņēmumi» was spoken once in each state.

## Deviations from the plan

1. **Two stale throttle references outside the plan's file list were fixed, both needed for AC5.** Task 4's first grep was predicted to return no hits, and it hit `apps/driver/src/features/offers/offer-card-props.test.ts:231` («starves the throttled countdown announcements»). The wider sweep also found `docs/spikes/04-gps-field-test.md:82`, whose field-test step 14 still expected «a countdown announcement every 5 s then each of the last 5». Both now describe the new behaviour. The spike's diff, and therefore Appendix A, missed both.
2. **Criterion (e) was measured differently from the plan's wording.** The plan measures the card read from the name fragment to «Poga». Neither run spoke «Poga» after the name: the card was gone when the name finished, so there was no role to read.
   - In this re-run the banner's `Speaking fragment` line came before the name's `utterance completed`: 11:33:02.368 against 11:33:03.025, and 11:34:40.917 against 11:34:58.176. In #276's D1 log and in the spike, fragment lines follow the previous completion within a few ms. A fragment line therefore marks when TalkBack handed the text on, which is not always when it was heard.
   - Speech times are therefore taken as the later of the fragment line and the completion of the item ahead.
   - The rate is proven on identical text («Atlikušas 20 s», ×1.33).
   - Both notes are now in the runbook's TalkBack section.
3. **The branch-head figures differ from the spike's, and the docs carry the branch-head ones.** Both sets are valid for their own runs; the spike's logs (session `f320a587…`, `run2.txt` / `run3.txt`) were re-read to check.
   - Clock offset: −0.93 s here, −0.58 s in the spike. This is a fresh boot; even the naive first samples here read −0.80 to −0.87 s.
   - At the default rate the two agree: the name read took 19.51 s in the spike and 19.62 s here, both over 194 characters.
   - The name finished past expiry by 2.00 s and 18.63 s here, against 1.8 s and 11.5 s in the spike.
     - At rate 50 this run's card carried #260's trip line: 232 characters against 194, 35.55 s against 27.92 s.
     - Nothing else was held constant, so the remaining difference is not attributed.
   - In the spike, «Poga» and then the banner followed the name. Here «Poga» was never spoken, and the banner was handed on before the name finished. The cause is not isolated.
   - `ui-decisions.md`'s "measured cost" uses the branch-head figures, with the character counts. The plan's AMENDMENTS points its spike figures at the runbook block.
4. **The D2 loading touch landed 2.98 s after the request, not 0.1 s.** The delay was `adb` process spawn, and the touch was still inside the 8 s timeout. In `hang` mode, «Ieņēmumi» alone can only be the loading label.
5. **Runbook setup deltas go beyond the plan's four items.** Also added:
   - TalkBack's preferences file lives at `/data/user_de/0/…` on this image. `/data/data/…/shared_prefs` held no such file.
   - The earnings card's y position shifts with the battery-optimisation banner.
   - A `Speaking fragment` line is not always speech time (deviation 2).
6. The runbook's #276 table rows were annotated in place («now one announcement at arrival, see «#279 re-run» below»), not rewritten, so #276's historical ❌ stays readable.

UX states: this ticket declares no new loading, empty, error or offline states. D2 confirms by ear the two existing earnings states that the plan names.

## Issues encountered

- The default run's card had no #260 trip line, although `maps:route:v1:quote:56.9496,24.1052|56.9560,24.1210` was already in Redis before run 1; the rate-50 run's card had one. Cause unknown; no issue filed.
- `ls db/migrations/*.sql | tail -1` → `db/migrations/0013_concerned_wiccan.sql`. No migration in this ticket.
- The Redis online set held three other drivers, last seen about 54 days earlier. `findNearby`'s 60 s freshness drops them, and EMU224 got both offers (`driver_id 9690d4dc…` in both `ride_offers` rows).
- The stale Metro from `wt-a11y-276` still holds `:8081`, and the other sessions' apis on 3001 and 3031 were left alone. Teardown result:
  - TalkBack is off, the proxy is back in `pass` mode, and the driver is offline (Redis `SISMEMBER` → `0`).
  - The emulator, api, proxy, Metro and geo loop are killed, and nothing is listening on 3041, 3042 or 8082.
  - `apps/driver/tsconfig.json` is restored after Metro rewrote it.
