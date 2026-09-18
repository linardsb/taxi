# Execution report — `fix(deps): pin reanimated and worklets to Expo SDK 57's bundle` (#225 → PR #227)

> **Provenance — read this before any line below.** This report is a **reconstruction**, written in a
> cold session on 2026-09-18 from PR #227's published body, `.claude/code-reviews/pr-227-review.md`,
> `.claude/reports/pr-227-review-fixes.md`, the four branch commits and their CI runs. It was **not**
> written by the session that did the implementation.
>
> `system-execution-report` tells a cold session to stop rather than write from the diff alone, because
> it "can see what changed but not why". That guard is overridden here deliberately, on #229's
> instruction, and it is overridden on a condition the guard did not anticipate: the *why* for this
> ticket is written down in two independent places — the PR body states the causal chain and the
> options it rejected, and the review re-derived that chain mechanically without the author. What a
> reconstruction still cannot recover is stated as **Q1** under Challenges; it is not guessed at.

## Meta information

- **Plan file:** none. No `.claude/plans/*` entry exists for #225 or #227 — this is the gap #229 exists
  to close, and the report says so rather than naming a substitute. The de-facto plan was **issue #225's
  own body**, which stated the failure, a causal chain and three lettered options (O1 overrides, O2
  direct deps per app, O3 `peerDependencyRules`); the divergences below are measured against it.
- **Loop timing:** issue #225 opened `2026-09-18T06:41:29Z`, PR #227 opened `12:09:47Z`, merged
  `13:46:08Z` — **1h36m** open, **7h05m** issue to close (`observed`, `gh` timestamps).
- **Branch:** `fix/expo-worklets-peer-225`, 4 commits, squash-merged as `cde27af`.
- **Files added:** `apps/driver/src/native-module-pins.test.ts` (+418),
  `.claude/reports/pr-227-review-fixes.md` (+375)
- **Files modified:** `package.json` (+2, the two `pnpm.overrides` pins), `apps/driver/package.json`
  (+2, `semver` and `@types/semver` as devDependencies), `pnpm-lock.yaml` (196 lines changed)
- **Lines changed:** +889 / −104 across 5 files (`observed`, `git show cde27af --stat`). The *fix*
  itself is 4 of those added lines; the other 885 are the guard test and the review-fixes report.

## Validation results

All figures below are `observed` from **CI run `35351299067`, `check` job, at `e0e0f3e`** — the branch's
final head and the content that merged. They are not the review's figures: the review ran two commits
earlier at `6226549`, where the same job logged `43 suites, 238 tests` for `@taxi/driver`. The +4 is the
round-1 review fixes, and any surface anchored at `main` must quote 242, not 238.

- **Syntax and linting:** ✓ — included in the 22 tasks below
- **Type checking:** ✓ — same
- **Unit and integration tests:** ✓ — `@taxi/api` 733 passed / 77 suites · `@taxi/driver` 242 passed /
  43 suites · `@taxi/rider` 140 passed / 29 suites · `@taxi/dispatch` 27 files · `@taxi/shared` 24 files
  · `@taxi/db` 3 files
- **Gate:** ✓ `Tasks: 22 successful, 22 total`
- **`audit-diff`, `codeql`, CodeQL:** ✓ pass, no alerts
- **`ready`:** ✓ at `e0e0f3e`

**One red run, and it is not a defect.** Run `35343217282` at `ade96c7` reports `failure`, and the
failing job is `ready`, not `check` — `check`, `codeql` and `audit-diff` all passed. `ready` exited 1
with `this run tested ade96c7… but PR #227 is now at 6226549…; leaving its draft state alone (#165)`.
That is #165's staleness guard doing its job while the author pushed a second commit during the run.
Anyone reading the run list and counting a red would be counting a race, not a regression.

## What went well

- **The fix is 4 lines and it reaches a *required* peer.** The PR body corrected the issue's own causal
  chain: #225 blamed `expo-router`'s *optional* `react-native-reanimated: "*"` peer, but the
  load-bearing declaration is `react-native-drawer-layout@4.2.10`'s **required** `">= 2.0.0"`, pulled in
  via `@react-navigation/drawer`. That correction is what rules out the tempting non-option ("just don't
  install it") and leaves overrides as the only lever. Finding it changed the answer, not just the prose.
- **Rejected options are recorded with reasons, not dropped silently.** O2 and O3 each get a paragraph
  saying why they lose to O1 under `node-linker=hoisted`. This is the part a missing plan usually
  destroys, and here the PR body absorbed it.
- **The condition was made executable in the same PR.** A pin is a claim that goes stale silently; the
  guard test puts it in the gate on every PR instead of relying on someone typing
  `npx expo install --check`.
- **The guard discovers its consumers instead of listing them**, explicitly because #225 happened to a
  package no file named.
- **The review's numbers pass found no mislabelled figure** — 10 of 11 figures in the PR body were
  independently confirmed, and the one that was not (`eas build:view` for build `edcc579b-…`) is
  labelled in the review as relayed rather than verified, because the deliberately-uncommitted
  `extra.eas.projectId` makes it unreachable from any checkout on this machine.
- **Scope held.** The same EAS build surfaced a second blocker (`:app:lintVitalRelease`, 6 fatal
  `ExtraTranslation`); it was diagnosed in the body and left for its own ticket rather than folded in.

## Challenges encountered

- **Nothing in the repo could see the defect.** pnpm warns on an unmet peer and installs anyway;
  `expo install --check` only inspects packages an app *declares*, and neither package was declared
  anywhere in the workspace; the gate compiles no Android C++. The full gate was green on the broken
  tree. The only signal was a 468-second EAS build failing in CMake.
- **The reproducing tree stopped existing.** Once both checkouts installed `4.5.1`/`0.10.1`, the review's
  replication against the pre-fix tree could not be re-run. The review-fixes pass worked around this by
  feeding #225's shipped versions into the *real* walk before and after its edits and requiring
  byte-identical output — a good substitute, and worth reusing whenever a fix destroys its own repro.
- **The review's seven fixes sat directly on the detection path.** M3 changed `peerViolations`' parameter
  type and collapsed its filters; L2 added a guard in the same branch. A cosmetic pass that broke the
  defect the PR exists to prevent would have been worse than no pass, which is why that check ran first
  and last in `pr-227-review-fixes.md`.
- **Q1 — why no plan was written is not recoverable from the artifacts, and is not guessed at here.**
  Nothing in the issue, the PR body, the review or the commits states a decision to skip
  `piv-plan-implementation`. The plausible reading is that a one-line dependency pin found by a build
  failure did not look like it needed one — but "plausible" is how #120's invented cause got written, so
  this stays a question for Linards rather than an answer. It is the question #229 asks, and the
  evolution review carries it forward as the open decision.

## Divergences from plan

No plan existed, so each divergence is measured against **issue #225's body**, which is what the
implementation was working from.

**The causal chain in the issue was wrong, and the fix depends on the correction**

- Planned: #225 attributed the floating resolution to `expo-router`'s optional `"*"` peer.
- Actual: the required `">= 2.0.0"` peer of `react-native-drawer-layout@4.2.10`, reached through
  `@react-navigation/drawer`, is what forced pnpm to resolve reanimated at all.
- Reason: the optional peer would have permitted "do not install it" as a fix; the required one does not.
  The implementation traced the chain rather than accepting the issue's version of it.
- Type: **Plan assumption wrong** — and caught, which is the outcome the fact-verification step exists
  for.

**Two pins, where the issue's title names one package**

- Planned: #225 is titled for `react-native-worklets` being outside `expo-modules-core`'s range.
- Actual: both `react-native-reanimated@4.5.1` and `react-native-worklets@0.10.1` are pinned.
- Reason: pinning worklets alone leaves reanimated 4.6.0 with a violated `0.12.x` peer and its own
  Android C++ built against the wrong worklets. The pair is internally consistent and both come from one
  source, `expo/bundledNativeModules.json`.
- Type: **Plan assumption wrong**.

**A guard test was added that no option in the issue asked for**

- Planned: #225's O1 is two lines of `pnpm.overrides`, and nothing more.
- Actual: 418 lines of guard test shipped with the 4-line fix, plus two devDependencies.
- Reason: O2's one real benefit was bringing the pair under `expo install --check`; the guard delivers
  that better, in the gate, on every PR. Stated in the PR body as the reason O2 is not taken.
- Type: **Better approach found** — and the largest single judgment call in the loop, made with no plan
  to record it in. It is the clearest case for why a plan step would have had something to say here:
  not to stop it, but because a 418-line test beside a 4-line fix is a decision, and a decision made in
  flight is one no reviewer sees until the diff arrives.

**Neither `expo` nor the apps' own dependency lists were touched**

- Planned: O2 would have added both packages to `apps/driver` and `apps/rider`.
- Actual: not taken.
- Reason: under `node-linker=hoisted` the overrides already collapse each package to one version in one
  root `node_modules`, so O2 adds two unused dependencies to two apps and still lets the `*` spec float.
- Type: **Better approach found**.

## Skipped items

- **L5 — `react-native` sits outside the guard's scope.** Deferred on Linards's scoping call to **#228**,
  now fixed in **PR #230** (`test/pin-guard-peers-by-228`). The deferral reasoning in the issue was
  sound: the blind spot is milder than #225's because `react-native` *is* a declared dependency of
  `apps/driver`, so `expo install --check` sees it.
- **L6 — no plan or implementation report.** Deferred to **#229**, which this report answers.
- **`:app:lintVitalRelease`** — the second blocker from the same EAS build. Not this ticket; the review
  recommended filing it and the PR body holds the diagnosis to paste.

## Recommendations

- **Plan skill:** a dependency-version fix has no feature slice and no UX section, and the
  `piv-plan-implementation` template is shaped for one. That shape mismatch is the most likely mechanical
  reason a plan was skipped here — a hypothesis, not a finding, and the evolution review tests it against
  Q1 rather than acting on it.
- **Execute skill:** the "fix destroys its own repro" pattern from `pr-227-review-fixes.md` (feed the
  broken versions into the *real* detector, before and after, require byte-identical output) is a
  reusable method, currently recorded only in one report.
- **CLAUDE.md:** nothing. Two things this loop teaches are already in it (a figure carries its
  provenance; a claim in a comment is a claim), and CLAUDE.md prose remedies are on record here as not
  firing — the ledger's *Accepted risks* section says so directly.

## One correction this report owes #229

#229's premise line — "`.claude/plans/` and `.claude/reports/` carry nothing for #225 or #227
(`ls .claude/plans .claude/reports | grep -i '225\|227'` — no match, `observed` 2026-09-18)" — was true
of the review's head `6226549` and is **false at `main`**. `.claude/reports/pr-227-review-fixes.md`
landed with the merge, added in commit `9ad789e` *after* the review ran, and that same `ls … | grep`
returns it at `cde27af` (`observed` 2026-09-18, in `~/taxi-worktrees/wt-229`).

What is genuinely absent is narrower and still worth the ticket: **no plan**, and **no `piv-implement`
implementation report**. A review-fixes report is not either of those — it starts after the fix exists
and is organised by finding, so it records what a reviewer asked for, never what the implementer
intended before the first line was written.

The correction matters more than the digit. #229 inherited a claim from a review, stamped it `observed`
with today's date, and did not re-derive it at the head it was about to be read against — the same
mechanism as #87 and #107, one surface further along. That is a finding for the evolution review, not a
footnote here.
