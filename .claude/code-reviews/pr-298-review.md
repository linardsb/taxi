# PR #298 review, round 1: fix(driver): speak the offer countdown once, at arrival (#279)

**Head** `ae31fc5` · **Base** main @ `c08b927` · reviewed 2026-09-28 · first round (no earlier report, so the guarantees pass and the fix-mechanism pass do not apply; `origin/main` was `c08b927` at review time, equal to the PR's base)

**Verdict: approve.** No Critical, High or Medium findings, and six Lows. None of them blocks the merge. L3 and L5 are two lines each in the decision record. L2 is dead code that this PR left behind.

## Summary

Under TalkBack (Android's screen reader), the offer card's spoken name takes about the whole 20 s offer window to read. Countdown announcements queued behind it were heard after the offer had expired. The PR stops the ticks: the reducer (`decide` in `offer-state.ts`, the pure function that owns the card's policy) emits one `announce` effect with the whole window's seconds, on arrival. The card's per-5-second announcement effect is deleted, and the visible countdown `Text` is taken out of the accessibility tree.

What I checked:
- Every changed source and test file was read in full, and the `code-reviewer` agent reviewed the same files independently.
- Both of the PR's "red on the old source" runs were re-run and reproduce exactly.
- Every figure in the runbook block and the PR body re-derives from its own inputs.
- AC5's sweep ("no text still presents the 5-second throttle as current") is clean. AC9's VoiceOver note is on #257.

## Issues

All six are Low.

**L1 · docs · `docs/spikes/04-gps-field-test.md:82`.** The PR rewrote this line, but it still quotes the card label as «Jauns brauciens. Cena €X, jūs saņemat €Y. **Atlikušas N sekundes…**». The label has had no seconds in it since #263: `packages/shared/src/i18n/lv.ts:346` is `'Jauns brauciens. Cena {amount}, jūs saņemat {net}.'`, and `offer-card-props.ts:123` says so. So a tester following step 14 would expect to hear seconds in the card read and would not hear them. **Fix:** drop «Atlikušas N sekundes…» from the quoted label. The plan does not freeze this file (the constraint grep came back empty).

**L2 · leftover code · `apps/driver/src/features/offers/offer-card-props.ts:25,110`.** Nothing in shipped code reads `OfferCardProps.seconds` any more. The deleted card effect was its only reader. `git grep -n seconds -- 'apps/driver/src/**' ':!*.test.ts' ':!*.test.tsx'` at `ae31fc5` lists the declaration (`:25`), the assignment (`:110`) and the local that builds `countdown` (`:87`), and no reader. The global rules say to remove what your own change made unused. **Fix:** drop the field. The only readers left are tests: the #263 case at `offer-card-props.test.ts:239-240` can assert on `countdown`, and `seconds` comes out of the `card()` fixture (`offer-card.test.tsx:26`) and the #279 rerender loop (`:152`).

**L3 · accessibility record · `apps/driver/src/features/offers/offer-card.tsx:101-108`.** The hidden `Text` shows «Pieņem…» (accepting) while an accept is in flight, as well as the countdown. So that text is also out of the tree now. The state still reaches a screen reader through `accessibilityState={{ disabled, busy }}` on the card, so this is not a new defect. It is also plausible that TalkBack spoke the text change before this PR, by the PR's own mechanism: text changes under the focused card are spoken. Neither run pressed accept, so this is unconfirmed. The `ui-decisions.md` line lists every spoken item this PR removes except this one. **Fix:** add «Pieņem…» to the removed items in that line, or render it in its own `Text` that stays in the tree.

**L4 · figure without its case · `offer-state.ts:106-109`, `use-offers.test.tsx:277-279`.** Both docblocks say "~20 s card read" and do not name the case. The runbook's measurements are 19.62 s at the default rate (194 characters) and 35.55 s at rate 50 (232 characters, with #260's trip line). Under the figures rule a single figure is the worst case or says which case it is. Here the number is only context for the design, so this is Low. **Fix:** write "~20 s at the default rate, 35.55 s at rate 50 (runbook «#279 re-run»)".

**L5 · decision record names one cause of the overrun · `.claude/references/ui-decisions.md:28`.** The record gives the cost as "the name still finishes 2.00 s after expiry" and says to revisit if the name is shortened. The runbook excerpt shows that the arrival line itself also delays the name. `derived` from the default-rate excerpt:
- The name's focus event is at 43.402, 0.011 s after «Atlikušas 20 s» completes at 43.391.
- The name takes 19.623 s (03.025 − 43.402).
- If it had started at the announcement's event time instead, it would end at 41.213 + 19.623 = 11:33:00.836. That is 0.19 s before expiry at 01.024.

This assumes TalkBack would start the focus read at the announcement's event time without it, which no run tested. The PR's old «Jauns brauciens» announcement also came first, so the pre-PR baseline had a delay too, of a size nobody measured. At rate 50 the name overruns whether or not the line is there (35.55 s > 20 s). This is Linards' trade-off to make, not a code defect. **Fix:** name the second lever in the record, for example "Revisit if the name is shortened, the offer window grows, or the arrival line moves after the name."

**L6 · gate provenance · `.claude/reports/offer-countdown-opening-tick-279-report.md:55`.** The report's Level 3 line (`22 successful`, 2m26s) names no commit. The PR body's gate (`22 successful`, 1m41.235s) names `ae31fc5`. These are two separate runs, and only one of them can be traced to a commit. **Fix:** add the sha the report's run used, or cite the PR body's run.

**Not raised:**
- The new tests restore their `announceForAccessibility` spies on their last line, and the driver jest config has no `restoreMocks`. A failing assertion would therefore leave the stub in place for later tests in the same file. This is the existing house pattern: `mockRestore()` appears in 12 driver test files on `origin/main` (`git grep -l`, `observed`). It only matters after a test has already failed, and `clearAllMocks` still resets call counts.
- Two of the four reducer #279 tests pass on the old source. The report says this is deliberate (they pin that `tick` never announced), and the slice's real expected, edge and failure cases each go red on the old source in Run A.

## Questions the review asked of the code

- **Is any other `announce` effect affected by the shape change?** No. `active-ride-state.ts` and `presence-state.ts` declare their own `announce` variants. `use-offers.tsx:153-156` is this effect's only consumer, and the PR updates it.
- **Can the spoken seconds disagree with the card's first frame?** No. Both come from `durationMs` (`offer-state.ts:217`, `offer-card-props.ts:87` via `remainingMs = durationMs`). That value is `expiresAt − sentAt`, measured on the server, so phone clock skew cannot enter. A push that arrives late overstates the time left identically on screen and in speech. That behaviour predates this PR, and the server's 409 on accept corrects it.
- **Second offer replacing a pending card:** it would announce the new card's own window, which is correct. An answer in flight blocks the replacement (`offer-state.ts:200-202`).

## Validation

| Check | Result | Provenance |
|---|---|---|
| Driver-scoped gate: `pnpm turbo run typecheck lint test build --force --filter @taxi/driver...` in a worktree at `ae31fc5` | `Tasks: 7 successful, 7 total`, `Cached: 0 cached`; driver `Test Suites: 46 passed`, `Tests: 357 passed` | `observed`, this review |
| Full 22-task gate | CI `check` job on run 36412381139, head `ae31fc5e`, conclusion `success` (4m2s) | `observed` via `gh pr checks` / `gh run view`; not re-run locally |
| `audit-diff`, `codeql`, CodeQL, `ready` | all pass | `observed`, `gh pr checks 298` |
| Run A: the 4 source files from `origin/main`, `jest src/features/offers --verbose` | `Tests: 7 failed, 49 passed, 56 total`: both reducer arrival cases, both card cases, all 3 provider cases | `observed`; matches the PR body |
| Run B: only the old card effect re-inserted into the fixed card | `Tests: 4 failed, 52 passed, 56 total`: «never announces…» plus all 3 provider cases (the provider test mounts `OfferScreen`, which renders the card) | `observed`; matches the PR body |

## Numbers pass

- **Size table:** `git diff --shortstat origin/main..HEAD` per bucket gives 4/+22/−29, 4/+144/−5 and 5/+1051/−3 (`observed`). These match the PR body.
- **Tree hash:** `git rev-parse HEAD:apps/driver/src` = `89147e9a4ef7…` (`observed`), matching the PR body and runbook.
- **Runbook «#279 re-run» arithmetic** (all `derived` from the quoted excerpts, all match):
  - expiry conversion: 10:32:41.954Z + 1 h − 0.93 s + 20 s = 11:33:01.024, and 10:34:20.481Z → 11:34:39.551;
  - «Atlikušas» finished before expiry by 01.024 − 43.391 + 60 = 17.633 s, and by 39.551 − 22.618 = 16.933 s;
  - the card name finished after expiry by 03.025 − 01.024 = 2.001 s, and by 58.176 − 39.551 = 18.625 s;
  - the name read took 19.623 s over 194 characters (101 ms per character) and 35.551 s over 232 characters (153 ms per character);
  - the rate check on identical text: 2.178 s against 2.907 s, a ratio of 1.335;
  - the trip line «Brauciens ~3 min · 1.6 km · €1.92/km. » is 38 characters = 232 − 194.
- **Not re-derived:** the fragment-line figures 0.66 s and 17.26 s, and the D2 timings (2.98 s, 11.42 s). These need the raw logcat and proxy log, which are not in the tree. The 0.66 s and 17.26 s equal the name's completion minus the banner's `TYPE_ANNOUNCEMENT` event time in the excerpt (03.025 − 02.368 = 0.657 s, 58.176 − 40.917 = 17.259 s). So they hold as long as the fragment line sits within a few ms of that event. No finding.
- **Attribution:** the PR body and runbook compare the spike with the branch-head run and say plainly that nothing else was held constant, so they do not attribute the difference. That is correct under the figures rule.

## What is good

- The timing policy now lives in one pure reducer. The card is presentational again and has no timers or announcements left.
- The claim was proven against the bug in both directions (Runs A and B). The provider tests use fake timers across the old 15, 10 and 5 s announcements and expiry, and restore real timers afterwards.
- The device evidence was measured at two speech rates, with the clock-offset method documented. The plan amendments record every place the branch-head run differed from the spike, instead of carrying the spike's figures forward.

## Recommendation

Approve. The Lows can go in one small commit on this branch (L1, L2, L4 in code and docs; L3, L5 in `ui-decisions.md`; L6 in the report), or be accepted as they are. Neither the plan nor this review freezes any file they touch.
