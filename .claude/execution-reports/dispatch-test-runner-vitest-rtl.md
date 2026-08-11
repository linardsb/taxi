# Execution Report — dispatch test runner (vitest + RTL) + `t/[token]` seed suite

**Feature**: `apps/dispatch` test enforcement (ticket #88) · **Branch**: `feature/dispatch-test-runner-vitest-rtl` · **PR**: [#96](https://github.com/linardsb/taxi/pull/96) (merged `7f742b0`)

> Written from live implementation context, not reconstructed after a clear.

## Meta Information

- **Plan file**: `.claude/plans/dispatch-test-runner-vitest-rtl.md` (1,243 lines — spike-verified before finalization, self-rated 9.8/10)
- **Implementation report**: `.claude/reports/dispatch-test-runner-vitest-rtl-report.md`
- **Origin**: not an epic slice — the "Recommended, not applied" item from
  `.claude/system-reviews/rider-comms-sms-tracking-page-review.md`. Gated #18.
- **Files added**: `apps/dispatch/vitest.config.ts`, `apps/dispatch/vitest.setup.ts`,
  `apps/dispatch/src/features/tracking/{states,tracking-live,tracking-page}.test.tsx`,
  `apps/dispatch/src/features/tracking/tracking-data-route.test.ts` (+ the plan and implementation report)
- **Files modified**: `package.json` (root — `pnpm.overrides`), `pnpm-lock.yaml`,
  `apps/dispatch/package.json`, `apps/dispatch/CLAUDE.md`, `apps/dispatch/src/app/t/[token]/page.tsx` (1 line)
- **Lines changed**: +2,431 −77 across 13 files — but **436 of those are hand-written source** (407 test,
  29 config). The plan is 1,243 and the lockfile 647.

## Validation Results

- **Syntax & Linting**: ✓ `@taxi/dispatch:lint` clean (the new files are linted — the app's bare `eslint` covers cwd)
- **Type Checking**: ✓ — note `tsconfig.json`'s `include: ["**/*.ts","**/*.tsx"]` means the test files and
  `vitest.config.ts` are typechecked by both `tsc --noEmit` and `next build`
- **Unit Tests**: ✓ **19 passed** (4 files) — `@taxi/dispatch:test` present in the gate output, which was the
  actual deliverable
- **Integration Tests**: ✓ `@taxi/api` 53 suites / **439 passed** (unchanged by this slice)
- **Full gate**: ✓ `pnpm turbo run typecheck lint test build --force` → **21/21 tasks, exit 0**, with
  `REDIS_TEST_URL` set (no silent skips) — re-run after rebasing onto the current `main`
- **CI parity**: ✓ `pnpm install --frozen-lockfile` exit 0; GitHub CI green on PR #96
- **Mutation checks** (the step that proves the suite has teeth): **M1 → `1 failed | 9 passed`**;
  **M2 → `1 failed | 15 passed`**. Each reintroduced bug failed exactly one test. Both reverted.

## What Went Well

- **The spike-before-finalize practice paid off completely.** Every code block the plan transcribed from its
  throwaway worktree ran as written: the vitest config (no `@vitejs/plugin-react`, no `server.deps.external`,
  no `resolve.dedupe`), the chainable leaflet mock, `render(await TrackingPage({…}))` for the async server
  component, `// @vitest-environment node` for the route handler, and `afterEach(cleanup)`. Zero config
  archaeology. This is the strongest evidence yet for spiking a plan whose confidence rests on interop.
- **Both mutation checks were surgical** — one failing test each, exactly as the spike predicted. That is the
  difference between a suite that pins behavior and one that decorates it, and it cost about four minutes.
- **The plan's "derive time strings, never hardcode" rule was load-bearing, not pedantry.** `09:00Z` renders as
  `10:00` on this machine (Europe/Riga) and `09:00` in CI. A literal would have gone green in one and red in
  the other.
- **The M1 test design held up.** The naive version (render with an old `position.at`, assert the time) passes
  against the *bug* too, because `lastSeenAt` is null on first render. Only same-position + newer `updatedAt` +
  advanced timers + moved system clock discriminates. The plan said so in bold; it was right.
- **Change surface landed exactly as specified** — empty diffs over `states.tsx`, `tracking-map.tsx`,
  `data/route.ts`, `turbo.json` and `ci.yml`; `page.tsx` exactly 1 insertion / 1 deletion.
- **Worktree isolation was the right call twice over** (see Challenges).

## Challenges Encountered

- **The shared working tree was owned by a live sibling session, and mutated mid-inspection.** Between two
  consecutive read commands, `packages/shared/src/i18n.ts` went from `M` to clean and `HEAD` moved
  `80bd98c → 6efde7e` — the sibling committed the Twilio slice while I was orienting. Its next PIV step
  (`piv-create-pr`) pushes whatever branch is checked out, so a `git checkout -b` there would have hijacked its
  PR. Cost: one full `pnpm install` in an isolated worktree (13 s — the pnpm store made it cheap).
- **Shared-Postgres contention produced a convincing false red.** The first full gate showed
  `@taxi/api:test` 6 suites / 35 tests failing on `duplicate key value violates unique constraint
  "users_phone_unique"`. Attribution took three steps: the table was **empty** afterwards (so not stale data →
  concurrent writer), four worktrees share one `taxi-db-1`, and the suite passed **409/409 alone**. Nothing in
  this slice touches `services/api`.
- **`expo start` produced no usable signal** — buffered because non-TTY, 11 minutes with an empty output file.
  `npx expo-doctor` wanted a download. The check that actually worked was `expo install --check` with the
  already-installed CLI — and it **contradicted the plan** (below).
- **`docker compose` from a worktree derives its project name from the directory**, so `pretest` would have
  started a second Postgres against the taken 5432. Fixed by prefixing `COMPOSE_PROJECT_NAME=taxi` (already
  recorded in auto-memory; confirmed here that it reuses rather than recreates).
- **`main` moved three times during the ship step** (PRs #89, #90, #93, #95 merged), forcing two rebases.
  Cheap because the branch was one unpushed commit; this is the tax of four concurrent worktrees.

## Divergences from Plan

**1. React override pinned to `19.2.3`, not `19.2.4`**
- Planned: Task 0 — `pnpm.overrides` with `react`/`react-dom` at `19.2.4`, flagged BLOCKER, do first
- Actual: same mechanism, opposite direction — `19.2.3`
- Reason: the plan's Task 0 VALIDATE asked for an Expo boot check that yields no signal. `expo install --check`
  does: **Expo SDK 57 pins `react: 19.2.3` exactly** and rejects 19.2.4. Under 19.2.3 the react line disappears
  (only pre-existing `expo@`/`react-native` drift remains, present on `main` independently). All four properties
  the fix needs still hold — no unmet peers, one instance at the root, no nested copies, 19/19 green — and both
  `next build`s compile. This is the plan's own documented fallback (OPEN QUESTIONS #5): *one instance* is the
  fix, not a particular version. **Net risk went down**: rider/driver now resolve exactly what they already
  declared, so the plan's reserved "Expo runtime unverified" residual is gone rather than merely unmeasured.
- Residual: `apps/dispatch`/`apps/admin` declare `19.2.4` and resolve `19.2.3`. Declarations left alone
  deliberately — editing them widens the diff past AC #8, and rewriting a resolution is what overrides are for.
- Type: **Plan assumption wrong** (verified backwards by a check the plan didn't specify)

**2. 19 tests, not the spike's 17**
- Planned: 17 tests over 4 files
- Actual: 19 — added a `StatusScreen` `lang`-attribute assertion (the plan's context notes call the attribute
  out; a RU notice inside an LV document must be announced in RU), split the `langFrom` edge case into two
  tests for a clearer failure message, and included the plan's optional `generateMetadata` test
- Reason: all within the plan's named scope, all cheap
- Type: **Better approach found** (marginal)

**3. Expo validation method substituted**
- Planned: `pnpm --filter @taxi/rider start` — "boot-and-look, then Ctrl-C"
- Actual: `pnpm --filter @taxi/rider exec expo install --check` + rider/driver typecheck in the gate
- Reason: the planned step is not falsifiable — it has no assertion, and in practice emitted nothing at all.
  The substitute produces a checkable line and is what surfaced Divergence 1.
- Type: **Better approach found**

**4. Built in a git worktree rather than the primary tree**
- Planned: implicit — `piv-implement`'s preamble says "already on a feature branch → use it"
- Actual: `git worktree add` off `main`; the primary tree was never touched
- Reason: the checked-out feature branch belonged to a *different, live* ticket
- Type: **Plan assumption wrong** (skill-level; see Recommendations)

## Skipped Items

**None.** Every task in the plan shipped, including the two it marked optional or droppable: the
route-handler test file (`tracking-data-route.test.ts` — the plan gave an explicit escape hatch if it needed
config surgery beyond one docblock; it did not) and the `generateMetadata` case.

The plan's Non-Goals were all honored: no Playwright, no coverage thresholds, no hardcoded-string lint rule,
no runner for rider/driver/admin, no `turbo.json` edit.

## Recommendations

*Ordered by damage prevented, not by skill.*

### 1. Execute skill (`piv-implement`) — branch detection **[highest value; mostly already in flight]**

> ⚠️ **Largely superseded — check before acting.** At the time of writing, another session has **uncommitted**
> edits in the primary checkout adding exactly this to `piv-implement/SKILL.md` and `CLAUDE.md` (liveness
> detection via `git reflog -8` + fresh mtimes → `git worktree add`, plus the `COMPOSE_PROJECT_NAME=taxi`
> recipe), as an output of the **#87** evolution review. Two independent slices reaching the same conclusion
> in the same afternoon is the strongest possible signal it was the right call. **Do not re-apply it.**

- **The preamble's "Already on a feature branch or in a worktree → use it" is actively unsafe here.** The
  checked-out branch belonged to a *different ticket* driven by a *live* session whose next step
  (`piv-create-pr`) pushes whatever is checked out — so following the skill literally would have hijacked
  another PR. **This is the only finding here that would have prevented real damage rather than wasted effort.**
- **The residual gap the in-flight edit does not close** — and the only part worth applying on top: that edit
  adds a *new* bullet keyed on **liveness** (another session active now) while leaving the old
  *"Already on a feature branch → use it"* bullet unchanged, so the two sit in tension. Liveness is the wrong
  discriminator on its own: even with every sibling session idle, a feature branch belonging to a **different
  ticket** is still the wrong place to build. The cheap, deterministic check is **branch vs. plan slug** —
  if they disagree, the tree is occupied regardless of whether anyone is currently typing in it. Suggested as
  an amendment to the existing bullet, not a third one:
  *"Already on a feature branch **whose slug matches this plan** → use it; **a different ticket's branch → treat
  the checkout as occupied and `git worktree add` off the base.**"*
- **Add a "triage a red gate before reacting" step.** The api false red looked exactly like a regression. The
  discriminator is in auto-memory but not the skill: map failing files to who owns them, then re-run the
  failing package alone before touching anything.

### 2. Plan skill (`piv-plan-implementation`) — make VALIDATE steps mechanically checkable

- **A VALIDATE step must name the string or exit code that constitutes a pass.** The defect in Task 0 was not a
  missing command — the plan *did* give one (`pnpm --filter @taxi/rider start`). It was a command whose success
  criterion was a human eyeball ("boot-and-look, then Ctrl-C"), so it emitted nothing and silently guarded the
  plan's single largest residual risk. `expo install --check` has a pass/fail line; the boot does not. Phrased
  as "name the expected output", this is checkable by a plan reviewer — "be falsifiable" is not.
  This is the plan's own M1 lesson (*"an edge case with no named verification step silently evaporates"*)
  applied one level up, to the plan's own validation steps.
- **Encode "spike before finalizing when confidence rests on interop."** This plan ran itself end-to-end in a
  throwaway worktree first, and the payoff was total: every transcribed block worked, and the two blockers it
  found (dual React, `<a href="">` exposing no role) were unreachable by reading. The plan's own phrasing is
  worth lifting: *"a pre-written escape hatch is a guess with good posture."*

### 3. CLAUDE.md / repo

- ~~**Add the worktree gate recipe** to the Commands block~~ — **already in flight** in the same uncommitted
  `CLAUDE.md` edit described above (`COMPOSE_PROJECT_NAME=taxi`, reflog check, one-gate-at-a-time). The only
  thing it omits is that a worktree has no `.env` (gitignored), so `DATABASE_URL` must be supplied — build one
  from `.env.example` rather than copying the real file, which the secrets hook correctly blocks.
- **File a ticket: make the api integration suite worktree-safe.** Root cause is fixed phone fixtures
  (`phoneFor('+371280', n)`) against a shared database — two runs collide on the same row. Per-run schema or
  randomized fixtures would fix it. With four worktrees active this recurs, and each occurrence costs a
  misdiagnosis. *(This slice already extended `taxi-concurrent-sessions` memory with the second failure
  signature — `duplicate key` vs the previously-recorded `terminating connection` — and the 0-rows-after-the-run
  discriminator.)*
- **No new hard rule is warranted.** The rules this slice exercised (catalog strings, a11y, VSA test placement,
  expected/edge/failure) all already exist and all held. What was missing was enforcement, which is what
  shipped.
