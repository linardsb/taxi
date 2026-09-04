# Execution Report — Rider app: auth shell + text-first booking, screen-reader-first (#16)

**Issue**: #16 (**stays OPEN** — three acceptance criteria owed on hardware, see Skipped Items) · **PR**: [#150](https://github.com/linardsb/taxi/pull/150), merged `9e8ccc9` on 2026-09-04 · review reports landed by #151 and #152
**Plan**: `.claude/plans/rider-app-auth-booking-screen-reader-first.md`
**Implementation report**: `.claude/reports/rider-app-auth-booking-screen-reader-first-report.md`
**Reviews**: `.claude/code-reviews/pr-150-review.md` (round 1, at `8cd083f`) · `.claude/code-reviews/pr-150-review-round2.md` (round 2, at `1eb97f5`)

## Provenance of this report — read first

Five sessions touched this ticket and **this report's author is none of them.** It was written on
2026-09-04 by the post-merge session that runs the outer loop, from the artifacts above and the diff.

| Phase | Commit | Session | This report's basis |
|---|---|---|---|
| Implementation (2026-09-02) | never committed by its author | implementing session | Second-hand: the plan and the implementation report's 14 documented deviations. The *why* is quoted or paraphrased from that report, never reconstructed. |
| Commit + rebase onto `0a619d3` | `8cd083f` | a second session | The PR body's own "Provenance, stated plainly" paragraph. |
| Review rounds 1 and 2 | — | a third session | The two review reports. Every reproduced finding is labelled by the reviewer as `observed` or read from source. |
| Review fixes | `1eb97f5`, `9f88db1` | a fourth session | The PR body's round-1 and round-2 sections plus the round-2 review's table of which round-1 findings closed. |
| This report | — | **this one** | Figures marked *observed here* were re-derived at `9e8ccc9` in the `taxi-rider` worktree; everything else carries the provenance the source artifact gave it. |

`system-execution-report` says a cold session "can see what changed but not why." The implementing
session left a 380-line report and the reviewers reproduced their findings, so the guard is largely
mitigated — but nothing in Divergences below is this session's inference.

## Meta

**Plan file**: `.claude/plans/rider-app-auth-booking-screen-reader-first.md` (1,210 lines; itself added by this PR)

**Lines changed** — *observed here*, `git diff --shortstat` between the merge base `0a619d3` and each head:

| Range | Files | + | − |
|---|---|---|---|
| `0a619d3..8cd083f` (implementation) | 108 | 8,457 | 1,509 |
| `8cd083f..1eb97f5` (round-1 fixes) | 38 | 1,115 | 170 |
| `1eb97f5..9f88db1` (round-2 fixes) | 22 | 641 | 81 |
| **`0a619d3..9f88db1` (whole PR)** | **114** | **9,966** | **1,513** |

114 = 89 added + 23 modified + 2 deleted, 0 renamed (`--diff-filter`, *observed here*; the split
agrees with the PR body).

**Files added (89)**

- `.claude/`: `plans/rider-app-auth-booking-screen-reader-first.md`, `reports/rider-app-auth-booking-screen-reader-first-report.md`
- `apps/rider/` tooling: `.prettierrc`, `eslint.config.mjs`, `expo-types.d.ts`, `jest.setup.ts`, `locales/{en,lv,ru}.json`
- `apps/rider/src/`: `config.ts` + test, `uuid.ts`
- `apps/rider/src/app/`: `_layout.tsx`, `index.tsx`, `login.tsx`, `verify.tsx`, `book/{index,address,status}.tsx`
- `apps/rider/src/components/`: `Screen`, `Button`, `TextField`, `Banner` (+ 3 tests), `use-screen-focus.ts` + test, `index.ts`
- `apps/rider/src/features/auth/`: `api-client`, `gate-screen`, `login-screen`, `phone-normalise`, `session-guard`, `session-store`, `use-session`, `verify-screen`, `index` (+ 8 tests)
- `apps/rider/src/features/booking/`: `booking-draft`, `booking-screen`, `format-eur`, `payment-chips`, `quote-card`, `use-book-ride`, `use-booking-draft`, `use-quote`, `index` (+ 8 tests incl. the cross-cutting `accessibility.test.tsx`)
- `apps/rider/src/features/i18n/`: `device-language`, `error-key`, `use-t`, `index` (+ 2 tests)
- `apps/rider/src/features/places/`: `address-row`, `current-position`, `saved-places-store`, `search-sheet`, `use-saved-places`, `index` (+ 4 tests)
- `apps/rider/src/features/ride-status/`: `socket`, `status-screen`, `use-ride-status`, `index` (+ 3 tests)
- `docs/runbooks/rider-a11y-walkthrough.md`
- `services/api/src/features/rides/`: `ride-quote.service.ts`, `rider-visible-ride.ts`

**Files modified (23)**

- `packages/shared/src/schemas/ride.ts`, `packages/shared/src/i18n/{lv,ru,en}.ts`, `packages/shared/tests/schemas-ride-request.test.ts`
- `services/api/src/features/rides/{index,rides.controller,rides.module,rides.policy,rides.service,rides.service.spec,rides.integration.spec}.ts`, `services/api/src/features/rides/lifecycle/ride-lifecycle.integration.spec.ts`
- `services/api/src/features/geo/{address-search.controller,address-search.controller.spec,address-search.policy}.ts`
- `apps/rider/{CLAUDE.md,app.json,package.json,tsconfig.json}`
- `docs/ux-metrics-ledger.md`, `.claude/references/ui-decisions.md`, `pnpm-lock.yaml`

**Files deleted (2)**: `apps/rider/App.tsx`, `apps/rider/index.ts` (the Expo template entry, replaced by `expo-router/entry`)

## Validation Results

The gate at the merged head, `9f88db1` — `observed` 2026-09-04 by the fixing session from cleared
`dist` / `.next` / `.turbo` with `COMPOSE_PROJECT_NAME=taxi` and `REDIS_TEST_URL` set (PR body §Validation),
independently re-run by the round-2 reviewer at `1eb97f5` (exit 0, 22/22, 1m22.82s). **Not re-run by
this session**: the post-merge branch this report lands on changes no source.

| Check | Result | Provenance |
|---|---|---|
| Syntax & Linting | ✓ `lint` green in all 6 packages, `@taxi/rider:lint` now in the task list (was absent at baseline — plan R2) | fixing session, `observed` at `9f88db1` |
| Type Checking | ✓ `typecheck` green in all 6 packages; `tsc` at `5.9.3` in `apps/rider` (plan R1) | same |
| Unit Tests | ✓ api 695 / 73 suites, 0 skipped · rider 143 / 30 · shared 217 / 23 · dispatch 224 / 27 · driver 109 / 27 · db 17 / 3 | same |
| Integration Tests | ✓ inside the api count above; `REDIS_TEST_URL` set, so nothing `describe.skip`ped — not the "green and 33 short" shape | same, confirmed by both reviewers |
| Build | ✓ 22/22 turbo tasks, exit 0, 1 m 23.6 s | same |
| CI | ✓ `check` passed, 5m30s, [run 33853406246](https://github.com/linardsb/taxi/actions/runs/33853406246) | *observed here*, `gh pr checks 150` |

**Tests added** (`derived` by the PR body from `it(`/`test(` lines in the diff, agreeing with the gate
arithmetic): shared **+6**, api **+16** (10 at first submission, +2 round 1, +4 round 2), rider **143 in
30 files** as a new package (113 → 136 → 143 across the rounds). Baseline `main` at `f5a8dd1`: api 679,
shared 211, 20 tasks.

**Not proven by a run** (all stated in the PR body, none silently):
- Level 4's ten manual steps, the TalkBack walkthrough (AC #6) and the tap count (AC #7) — hardware, see Skipped Items.
- H4's iOS half: `Banner` announcing the search result count is `expected` until a VoiceOver pass.
- L5/R6's last hop: the merged Android manifest after AGP needs a Gradle build; the `tools:node="remove"` directive is `observed` in the prebuild output, its effect on the final APK is `expected`.

**Flakes recorded, not this branch's**: one api integration run failed E13 and an untouched `customers`
case with `Parse Error: Expected HTTP/` and passed alone and on the next full run (report); `@taxi/dispatch`
failed one case once in each review round while passing inside the full gate and alone, with zero
dispatch files in the diff (PR body).

## What Went Well

- **The pattern source held.** The plan named `apps/driver` as "the" source and the implementation transcribed it — api client, session store, i18n, components, jest/eslint scaffolding. Neither review found a pattern divergence between the two apps.
- **Every risk in the register was closed by its own command.** R1 (`tsc --version` 5.9.3), R2 (`@taxi/rider:lint` and `:test` named by turbo — the gate was blind at baseline and the task count moving 20 → 22 is the receipt), R3 (E13 asserts `maps.routeCalls === 1`, promoting the cache claim from `derived` to `observed`), R4 (`assertWithinRateLimit` untouched in the diff), R5 (the runbook records **blocked** with the reason and a date).
- **Accessibility shipped as assertions, not review notes.** Focus, announcements and the four app-wide properties (44 px floor, busy/disabled state, audio-lean labels, no blank label in any language) each have an RNTL test; `accessibility.test.tsx` is what stops a later screen regressing the differentiator.
- **The numbers pass reproduced every figure in both rounds.** Round 1's reviewer notes this "has not happened on this repo before"; round 2 reproduced all 22 claims again including the C1 repro string.
- **Blocked work was recorded as blocked** at every surface: runbook Result = BLOCKED, ledger = "not measured", PR body names the three owed ACs, `closingIssuesReferences` empty, #16 still OPEN after merge (*observed here*).
- **Repro discipline on both sides.** The reviewer reproduced C1, H2, M2, L1, R1, R2 and R8 in the project's own harnesses with controls; the fixer ran C1, H1, H2, M2, M7, L8 and R1–R3 against the unfixed code before committing the fix. R8's stated payoff was run rather than asserted (PR comment 2026-09-04 08:28).
- **The C1 fix was a third option better than either the review offered** — the owner-scoped read performs the join after the ownership check, closing both the first-connect and the reconnect hole with one mechanism and keeping room names server-side.
- **M4 is the model claim retirement**: `apps/rider/CLAUDE.md` now says "by choice, not by schema" and names what actually keeps the fields out.

## Challenges Encountered

- **The implementation was never committed by its author.** It existed only as working-tree state in the worktree until a second session committed it verbatim, rebased it and opened the PR (PR body §Provenance). Every later correction to the plan, the report and the docblocks was made by someone who had not written the code. Nothing was lost, but it was one accident away from being.
- **The status screen never received an event, and every gate was green (C1).** The rider's socket was created after `POST /rides` ran the only ride-room join; `use-ride-status.test.tsx` replaced the socket with a handler map and pinned wiring, not delivery. The plan's Q4 had asked exactly this question and answered it with the typical case ("a stale first frame") rather than the worst case (a screen that never updates again); D4 named only the reconnect half of the hole.
- **Two round-1 fixes moved their defect rather than closing it (R1, R2).** The C1 fix made delivery depend on a REST call whose failure was swallowed; the L8 serialisation let one rejected write poison the queue for the session, reachable with a 41-character label. Both were invisible to the gate.
- **One round-1 finding was reported fixed and was not (L5 → R6).** Removing `ACCESS_FINE_LOCATION` from `app.json` does not remove it from the build — `expo-location`'s plugin adds it back. The PR body's "every one is fixed; nothing was deferred" was written before the closing command was run.
- **Claim accuracy slipped three more times in the fix pass** (R4: C1's control placed after the throwing line, so the "observed" conjunction could not have been produced by one run; R5: a finding half-closed and the sentence rewritten around the closed half; R11: the report's closing paragraph carried first-submission line counts after the rest was re-measured).
- **Harness work the plan did not budget** (report §Issues encountered): `findNodeHandle` returns `null` under the test renderer even for an attached ref, so focus was unassertable until a Proxy fake in `jest.setup.ts`; a `useSession` mock returning a fresh object per call put a hook into an infinite render loop and OOM'd node; `jest.spyOn` inside the last `it()` reported earlier renders' calls; RNTL 14 dropped `toHaveAccessibilityState`; two self-referential mock objects inferred as `any` were caught by `tsc` and not by the babel-based jest run.
- **`max-lines` pressure on `rides.service.ts`**: 387 at base → 418 → 451 → **481** after two rounds, 19 lines of headroom. Two extractions (`RideQuoteService`, `rider-visible-ride.ts`) kept it under the cap.
- **Hardware.** No Android emulator on this Mac and SDK 57 does not compile for iOS at the Xcode 26.3 ceiling, so nothing manual ran. Known at plan time (A3, R5) and handled as the plan prescribed.

## Divergences from Plan

Each is quoted or paraphrased from the implementation report (deviations 1–14) or the review/fix cycle
(15–21). Types: **B** better approach found · **W** plan assumption wrong · **S** security/spend · **O** other.

1. **`previewQuote` lives in a new `RideQuoteService`** — Planned: on `RidesService`. Reason: the file was 387/500 and the method measured out at ~+100; the split follows a real seam (a preview creates nothing) and makes R4 structural. **B**
2. **The Places session token IS rotated on a 404** — Planned (E9): not rotated. Reason: `caching-maps.provider.ts` bypasses the cache when a token is present, so a 404 means the provider was reached and the billed session spent; carrying it forward bills the next searches individually. Rotate on 200/404, never on 429/offline. **W**
3. **`rider.status.queued` not added** — Planned: with a `{position}` placeholder. Reason: `rideStatusEventSchema` carries no queue position; a key nothing can fill is dead copy. **W**
4. **`still_searching` has no `{minutes}` placeholder** — Reason: it fires once at 60 s and a counter rendered then would lie to a rider who waited five. **B**
5. **`[Save this address]` on the booking screen, not in the search sheet** — Reason: the sheet navigates away the instant a resolve lands; an affordance there costs a step and breaks the three-tap new-destination path. **B**
6. **`expo-crypto` added** — Planned (A4): verify `crypto.randomUUID()` in Hermes. Reason: Hermes ships no WebCrypto global. **W**
7. **`STILL_SEARCHING_MS` = 60 s, below the 100 s cascade** — Planned (Q3): above the offer window. Reason: `MAX_OFFER_ATTEMPTS 5 × offerTimeoutSeconds 20 = 100 s` worst case; 60 s is three whole offer windows and the message does not claim failure, so 100 s of silence is worse. **B**
8. **`findNodeHandle` faked in `jest.setup.ts`** — Reason: returns `null` under the renderer even for an attached ref, making "focus lands on the header" unassertable. **O** (harness)
9. **`useQuote` has no `cancelled` cleanup flag** — Reason: `shouldQuote` flips false on dispatch, so an effect-scoped cancel drops every quote; the reducer's request id is the staleness guard. **B**
10. **`current-position.ts` extracted into `features/places`** — Planned: inline in `booking-screen.tsx`. Reason: keeps the screen composition-only and lets the sheet reuse it. **B**
11. **Gate screen inside `features/auth`**, not its own slice — Reason: a pure session decision; the rider app has no onboarding. **B**
12. **No new repository method** — Planned: a rider-scoped read "check whether `findWithQuote` suffices first". It did. **O**
13. **`no-console: 'error'` plain** where the driver allows `warn`/`error` — Reason: no headless task, no offline queue. The plan asked for this call. **O**
14. **Cross-cutting `accessibility.test.tsx`** beyond the plan's file list — Reason: four of the ten spec properties are properties of the app, not of a screen. **B**
15. **D4/Q4: the read is also the join** (C1, round 1) — Planned: `GET /rides/:rideId` re-reads state on reconnect; the socket connects on `/book/status` mount. Actual: `findForRider` joins the caller's sockets to the ride room after the ownership check, and the app reads on every `connect`, first included. Reason: the plan's answer to Q4 treated a missed creation event as the whole cost; the join is one-shot, so a socket created after `POST /rides` missed every later event. **W**
16. **Retry with backoff and `joined` tracked apart from `connected`; snapshot taken after the join** (R1, R7, round 2) — Reason: the round-1 mechanism made delivery depend on a request whose failure was swallowed, and its snapshot preceded the join. **W** (of the round-1 fix)
17. **AC #9 via `android.blockedPermissions`**, not by omitting `ACCESS_FINE_LOCATION` — Planned: `android.permissions: ["ACCESS_COARSE_LOCATION"]` "and nothing else". Reason: `expo-location`'s plugin and library manifest both add FINE; only the `tools:node="remove"` directive defeats them. **W**
18. **One announcer per status line** (M9) — Planned: accessibility property 6 announced `rider.a11y.status_changed` on the screen while `Banner` announced the same line; every iOS transition spoke twice. `Banner` is the single announcer; the key was deleted. **W**
19. **`SessionGuard` added** (H3) — Not in the plan's breadboard: an expired token cleared the session with no route back to `/login`. A render-nothing guard in `_layout.tsx` bounces a `signedOut` rider carrying `session_expired`. **S**
20. **`POST /rides/quote` answers 200** (L2) — Not stated in the plan; Nest's POST default is 201 for an operation whose defining property is that it creates nothing. **O**
21. **Catalog: 59 keys × 3 languages**, not the plan's ~50 — six added by round 1 (`pickup_empty`, `retry`, `retry_in`, `location_unavailable`, `results_count`, `completed`/`book_again`), five dead keys removed by the Phase 6 sweep, `status_changed` removed by M9. `lv.ts` at 386 lines, under D5's 460 trigger; no split. **O**

## Skipped Items

- **AC #6 — the TalkBack walkthrough has not been run.** Reason: no Android emulator or Android Studio on this Mac; VoiceOver unreachable at the Xcode 26.3 ceiling. The runbook exists (12 steps) and its Result says BLOCKED with both reasons and a date.
- **AC #7 — the tap count is not measured on a built app.** Reason: same. The ledger records "not measured" and the walkthrough step that will produce it; the plan's figure of 2 is `derived`.
- **Level 4, all ten manual steps.** Reason: same. Everything automatable is pinned; a real socket, a real permission dialog and a real empty driver pool are owed.
- **Level 5 (optional: `expo-doctor`, `expo install --check`)** — no record in the report or the PR body of either being run. Unknown, not skipped by decision.
- **`rider.status.queued`** — no data source (divergence 3).
- **D5 catalog split** — measured, not triggered (386 < 460).
- **`.env.example`** — none expected, none needed.
- **No follow-up issue exists for the owed hardware run or for server-backed saved places (D3).** *Observed here*: `gh issue list --state open` has nothing matching walkthrough/TalkBack/saved. The report says "a follow-up ticket should own the hardware and the run"; nobody has created it. #16 stays open as the carrier for now.

## Recommendations

### The finding: four defects in one PR were seams, and every one was green

C1, R1, R2 and R7 are each two correct pieces meeting — a socket meeting a join, a banner's condition
meeting delivery's, serialisation meeting a rejection, a snapshot meeting a room join. None is a bug
inside a function; none is visible to typecheck, lint or the unit suites that pin wiring. The plan's
Testing Strategy had fourteen edge cases and a real integration harness, and still the first delivery-level
test in the app's real connection order was written by the *reviewer*, as a repro.

**For `piv-plan-implementation`** — when a plan touches `realtime`, a socket, or a room join, the
Testing Strategy must name one **delivery test in the api integration harness that connects the client
in the order the app actually does**, and the "flagged, not blocking" questions must state the worst
case for every ordering question, not the typical one. Q4 answered "a stale first frame"; the worst
case was "never updates again". Both are one added instruction in the skill's TESTING STRATEGY and
OPEN QUESTIONS templates.

### A fix that moves the defect is the round-2 shape

Round 2's two Highs were both round-1 fixes whose *mechanism* introduced a new failure mode (a swallowed
`catch`; a promise chain with no terminal `catch`). Round 1's "reproduce against the unfixed code" caught
that the fix fixed the finding; nothing asked what the fix broke.

**For `piv-fix-review-findings`** — for every Critical/High fix, write one line answering "what new
failure mode does this mechanism have?" and add the test for it before moving on. And **run the closing
command before writing the closing sentence**: "every one is fixed; nothing was deferred" was false of L5
because the `expo config` run predated the fix.

**For `piv-review-pr`** — on round ≥ 2, add a checklist line: for each round-1 fix to a High or
Critical, look for the new failure mode of its mechanism, not only whether the original repro passes.

### Uncommitted work is one accident from lost

The implementation lived for a day as working-tree state and was committed by a different session,
cold. `piv-implement` reports COMPLETE with no commit; nothing in the loop objects.

**For `piv-implement`** — end every run with a WIP commit on the feature branch (`wip(<slug>): …`,
squashed by `piv-commit` later) so the working tree is never the only copy. A skill edit; the Stop hook
cannot express a soft warning.

### ACs known at plan time to be unperformable should not stay on the ticket

A3 and R5 knew on 2026-09-02 that no TalkBack pass could run here, and the plan still carried AC #6, #7
and Level 4 as this ticket's completion criteria. The honest outcome was reached — recorded as blocked,
#16 left open — but the issue is now a carrier for three owed items with no owner and no follow-up.

**For `piv-plan-implementation`** — when an AC's verification needs hardware, credentials or a device
the planning session has confirmed absent, move it to a follow-up issue created *during planning* and
reference that number in the AC. Then the PR can close its issue and the owed work has a home.

### Claim inheritance, fourth and fifth receipts

R4, R5 and R11 are the "grep the noun, not the sentence" miss inside the fix pass itself: the control
moved but its `observed` label did not; `split` was stripped and "no driver" stayed; the report's body
was re-measured and its closing paragraph was not. `CLAUDE.md` already says this. The skill does not.

**For `piv-fix-review-findings`** — after the fix pass, grep the subject noun of every retired claim
across the plan, the report and the PR body, and list the hits in the fix commit. Five files carried
figures for this ticket; the sweep is one `grep -n` per noun.

### Housekeeping

- The post-merge step for this ticket ran in a job whose `CLAUDE_PROJECT_DIR` pointed at a removed
  worktree, so every hooked tool was refused (`Failed to spawn`) until the hook path was recreated by
  hand. The hook command `uv run "$CLAUDE_PROJECT_DIR/.claude/hooks/pre_tool_use.py"` has no fallback.
  A settings edit fixes it: resolve the script from the git toplevel when the project-dir copy is
  absent. Memory note: `taxi-hooks-dead-project-dir.md`.
- Create the two follow-up issues named in Skipped Items, or fold the hardware run into #4's field-test
  ticket, which has the same blocker.
- `rides.service.ts` is at 481/500. The next addition to it must extract, not grow.
