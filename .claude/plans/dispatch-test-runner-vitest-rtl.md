# Feature: dispatch app test runner (vitest + RTL) + `t/[token]` seed suite

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`apps/dispatch` is the only workspace surface with **zero executable test enforcement**. Its `package.json`
has `dev / build / start / lint / typecheck` and no `test` script, so `pnpm turbo run … test …` runs nothing
for it. Every client-side hard rule on that surface (strings from the LV/RU/EN catalog, accessible names,
≥44 px targets, "show the data's own timestamp, not the poll clock") is enforced by review attention alone.

PR #83 proved the cost: **both** Medium findings were client-side and invisible to typecheck/lint/build —

- **M1** — the planned "stale GPS" edge case never landed; the page stamped the *poll* clock instead of
  `view.position.at`, silently relabelling a dead GPS as fresh every 5 s.
- **M2** — the retry control shipped as a hardcoded `↻` with no accessible name, the one string in the
  feature not sourced from the catalog.

Both were caught late, by human/AI review, not by the gate. This ticket installs the missing enforcement
layer: a real test runner wired into the CI-parity gate, plus a seed suite that ports #63's `t/[token]`
components and **pins M1 and M2 as regression tests**.

This is a **pre-#18 gate**. #63's page is 2 components; #18's live board (sockets, reconnect/backoff,
snapshot-on-reconnect resync, alarm discipline, zones grid) is an order of magnitude more stateful, and its
acceptance criteria ("zero silent staleness", "banner → auto-resync without reload") are exactly the class
of behavior that only an executable test can hold.

## User Story

As the engineer building the dispatch console
I want `apps/dispatch` to have a test runner that the CI-parity gate actually invokes
So that client-side rules (catalog strings, accessible names, honest timestamps) fail the build instead of
relying on someone noticing them in review — before #18 lands an order of magnitude more client state.

## Problem Statement

`apps/dispatch` has no `test` script. `pnpm turbo run typecheck lint test build --force` therefore validates
its **types, its lint rules and that it compiles** — and nothing about what it renders. A component can drop
a planned behavior (M1), hardcode a user-facing string (M2), or lose an accessible name, and the gate stays
green. The next ticket on this surface (#18) multiplies the stateful client logic that this blind spot
covers.

## Solution Statement

Install **vitest 3 + jsdom + React Testing Library** in `apps/dispatch`, add `"test": "vitest run"` to its
`package.json` (which is the *entire* turbo wiring — the root `turbo.json` already declares a `test` task
with `dependsOn: ["^build"]`), and write a seed suite over the tracking slice that:

1. pins the **M1** contract poll-discriminatingly — the position line must keep showing `view.position.at`
   after a poll returns the *same* position with a newer `updatedAt`;
2. pins the **M2** contract — every interactive element is queried `getByRole(role, { name })` with the name
   derived from `formatMessage(...)`, so a hardcoded or nameless control fails the query;
3. covers the required `expected / edge / failure` triad per component.

Framework choice is **vitest + RTL, not Playwright CT** — decided, not re-litigated (rationale in NOTES).

## Out of Scope / Non-Goals

- **Not included: Playwright / any browser-driven E2E.** The seed suite is jsdom-only. (`ci.yml` would need a
  `playwright install --with-deps` step and ~400 MB of browser download per run; nothing under test needs
  real browser geometry — the map div is `aria-hidden="true"`, so the *text alternative* is the tested
  surface.)
- **Not included: coverage thresholds or a `@vitest/coverage-v8` dependency.** No other package in the repo
  sets one. Adding a threshold here creates a number to game before there is a suite to measure.
- **Not included: a lint rule for hardcoded user-facing strings.** Tempting after M2, but it is a separate
  concern with its own design (which strings? which files?) — log as a follow-up ticket, do not smuggle it in.
- **Not included: test runners for `apps/rider`, `apps/driver` (Expo/RN — different runner story) or
  `apps/admin`** (see OPEN QUESTIONS — #18's re-slice retires that workspace).
- **Not included: any `turbo.json` edit.** The root `test` task already exists with the correct
  `dependsOn: ["^build"]`. Adding a redundant per-package override is the failure mode to avoid here.
- **Not changing: `states.tsx`, `tracking-map.tsx`, `data/route.ts`, and all of `page.tsx` bar one line.**
  This suite is a **regression pin on current behavior**. If a component turns out to be awkward to test,
  that is a NOTE for a follow-up, **not** a licence to refactor the code under test. Do not weaken an
  assertion to make it pass.
  - **The one permitted exception has already fired**, and is scoped to exactly one line: the spike proved
    `page.tsx`'s retry `<a href="">` is not exposed as a link to assistive technology (see SPIKE
    VERIFICATION #2). That fix is **in scope and required** (Task: FIX the retry href). Nothing else in
    `page.tsx` changes. If you find a *second* a11y defect, report it — do not fix it here.
- **Not included: Next.js `next/navigation`, router or middleware test scaffolding.** Nothing in the tracking
  slice uses it.

## Feature Metadata

**Feature Type**: New Capability (test infrastructure) + regression pinning
**Estimated Complexity**: Medium — the tests are small; the interop risk was **retired by a spike before this
plan was finalized** (see SPIKE VERIFICATION below), which surfaced two hard blockers now folded in as tasks.
**Primary Systems Affected**: `apps/dispatch` (package.json, new `vitest.config.ts`, `vitest.setup.ts`,
4 new test files) **plus root `package.json`** (a required `pnpm.overrides` react pin — Task 0) and **one line
of `apps/dispatch/src/app/t/[token]/page.tsx`** (a real a11y defect the spike uncovered). No `turbo.json`
change. No CI workflow change.
**Dependencies**: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/dom`,
`@testing-library/jest-dom` — all new devDependencies of `@taxi/dispatch` only.

---

## SPIKE VERIFICATION — this plan was executed end-to-end before being finalized

Every claim below was **run**, not reasoned about, in a throwaway detached `git worktree` at `80bd98c` with a
full `pnpm install`. Final state: **17/17 tests passing**, and
`pnpm turbo run typecheck lint build test --force` green across `@taxi/dispatch`, `@taxi/admin`,
`@taxi/rider`, `@taxi/driver` (**10/10 tasks**). The worktree has been removed; the code below is the code
that passed.

**Confirmed as planned** — implement these with confidence, they are not guesses:

| Claim | Result |
|---|---|
| The five pins install on Node 20.20.2 | ✅ resolved exactly: vitest 3.2.7, jsdom 26.1.0, jest-dom 6.9.1, RTL 16.3.2, @testing-library/dom 10.4.1 — no engine errors |
| No `@vitejs/plugin-react` needed (`esbuild.jsx: 'automatic'`) | ✅ JSX compiles, all renders work |
| No `turbo.json` edit needed | ✅ `@taxi/dispatch:test` ran under turbo off the script alone |
| **CJS `@taxi/shared` dist inlined by Vite** — the plan's biggest named risk | ✅ **works untouched. `server.deps.external` was NOT needed** — the pre-written escape hatch proved unnecessary |
| `@` alias resolves `@/app/t/[token]/page` | ✅ |
| `import 'leaflet/dist/leaflet.css'` under vitest | ✅ no-op, no config needed |
| `vi.mock('leaflet', () => ({ default: … }))` with chainable returns | ✅ |
| `render(await TrackingPage({...}))` for the async server component | ✅ |
| `// @vitest-environment node` for the route handler (`Response.json`) | ✅ 3/3 pass |
| `afterEach(cleanup)` is load-bearing | ✅ **verified by removing it** → 3 tests fail with "Found multiple elements" |
| Both mutation checks fail the suite | ✅ each fails **exactly one** test — surgical, no collateral |
| Timezone: derive time strings, never hardcode | ✅ **empirically decisive** — `09:00Z` renders as **`10:00`** on this machine (Europe/Riga, UTC+3). A hardcoded `'09:00'` would pass in CI (UTC) and fail locally |

**Two hard blockers the plan did NOT anticipate** — both now mandatory tasks, both would have stopped a
"one-pass" implementation dead:

1. 🔴 **Dual React instances → every single render dies.** `.npmrc` sets `node-linker=hoisted` (*"Expo
   requires hoisted node_modules in pnpm monorepos"*), and `apps/rider`/`apps/driver` pin **react 19.2.3**
   while `apps/dispatch`/`apps/admin` pin **19.2.4**. Hoisting therefore puts react@19.2.3 at the root,
   nests react@19.2.4 under `apps/dispatch`, and leaves `react-dom` resolving *up* to the root with a **third**
   nested copy. The component's `useState` and react-dom's dispatcher come from different module instances:

   ```
   TypeError: Cannot read properties of null (reading 'useState')
     ❯ TrackingLive src/features/tracking/tracking-map.tsx:33:27
   ```

   **9 of 17 tests failed on this alone.** The visible early warning was in `pnpm install` output the whole
   time: `apps/driver └─┬ react-dom 19.2.4 └── ✕ unmet peer react@^19.2.4: found 19.2.3`.
   `resolve.dedupe: ['react','react-dom']` **does not fix it** (verified — vitest externalizes `node_modules`,
   so Vite's resolver never sees them). Fix is Task 0 below. Once applied, `dedupe` is unnecessary — verified
   by removing it, still 17/17.

2. 🔴 **A real accessibility defect in shipped #63 code.** The API-down retry control is `<a href="">`.
   Verified in jsdom: the text renders, `hasAttribute('href')` is `true`, and
   **`queryAllByRole('link')` returns `0`** — an empty `href` does not map to the `link` role, so the *only*
   interactive affordance on that error screen is **not exposed to assistive technology at all**. PR #83's M2
   fix corrected the *string* and left the control unreachable. Against the project's hard rule
   (*"Every rider-app screen must be fully usable with VoiceOver/TalkBack"*) this is a live violation, and it
   is exactly the "permitted exception" this plan's Non-Goals carved out — so it is now a required one-line
   task, not a finding to report.

## Related Work

**Implements**: [#88](https://github.com/linardsb/taxi/issues/88) — `Closes #88` in the PR body.
**Epic**: none directly. This ticket is a **system-evolution output**, not an epic slice: it is the
"Recommended, not applied" item from `.claude/system-reviews/rider-comms-sms-tracking-page-review.md`
("the highest-leverage single change this review found"). It gates [#18](https://github.com/linardsb/taxi/issues/18)
(part of epic #1).

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/rider-comms-sms-tracking-page.md` — Why: this ticket ports **that plan's** components and
  pins the two behaviors that plan named but did not land (M1 stale-GPS, M2 retry accessible name). Read its
  UX section for the intended states.
- `.claude/system-reviews/rider-comms-sms-tracking-page-review.md` — Why: the root-cause analysis that
  mandated this ticket. The M1/M2 `root_cause` blocks define what the seed suite must make impossible.
- `.claude/code-reviews/pr-83-review.md` — Why: the exact wording of both Medium findings.
- `.claude/plans/lint-coverage-shared-db.md` — Why: prior art for adding an enforcement layer to a package
  that lacked one; mirror its "wire it, then prove the gate invokes it" shape.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- [#18](https://github.com/linardsb/taxi/issues/18) dispatch live board — **blocked on this ticket**; will be
  the first consumer of the runner installed here.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `apps/dispatch/package.json` — Why: the file to wire. Note it has **no** `test` script and no `"type": "module"`.
- `apps/dispatch/tsconfig.json` (lines 1-30) — Why: `jsx: "react-jsx"` (drives the esbuild JSX decision),
  `paths: { "@/*": ["./src/*"] }` (the alias vitest must reproduce), and `include: ["**/*.ts", "**/*.tsx"]`
  — which means **your new test files and `vitest.config.ts` are typechecked by `tsc --noEmit` and by
  `next build`**. They must typecheck cleanly.
- `apps/dispatch/src/features/tracking/states.tsx` (all 55 lines) — Why: unit under test #1. Note the
  `Record<TrackingPageState, MessageKey>` compile-pin the system review praised, and `StatusScreen`'s
  `lang` attribute + `<h1>`.
- `apps/dispatch/src/features/tracking/tracking-map.tsx` (all 258 lines) — Why: unit under test #2, and the
  home of **M1**. Read carefully:
  - line 15 `POLL_MS = 5_000`; lines 16-20 `TERMINAL` set; line 42 `done` short-circuit.
  - lines 44-62 the poll effect (`return` early when `done` → **no interval, no fetch**).
  - lines 65-91 the Leaflet effect — `(await import('leaflet')).default`, and note
    `L.map(...).setView(...)` is assigned to `map.current` (so the mock's `setView` **must return the map**)
    and `L.marker(...).addTo(...)` is assigned to `marker.current` (so `addTo` **must return the marker**).
  - lines 113-117 `timeOf` uses `toLocaleTimeString` with a locale derived from `lang` → **timezone-dependent**.
  - lines 240-253 the M1 fix: `new Date(view.position.at)`, with the docblock explaining why it is not the
    poll clock. **That comment is the contract your test must pin.**
- `apps/dispatch/src/app/t/[token]/page.tsx` (all 195 lines) — Why: unit under test #3, and the home of
  **M2** (lines 102-118: the retry `<a href="">` whose text is `formatMessage(lang, 'page.retry')`). Also
  note `langFrom` (lines 26-31) and that `params`/`searchParams` are **Promises** (lines 22-23).
- `apps/dispatch/src/app/t/[token]/data/route.ts` (all 43 lines) — Why: unit under test #4. `NextRequest` is
  a **type-only** import, so nothing from `next/server` loads at runtime.
- `packages/shared/tests/tracking.test.ts` (lines 1-45) — Why: **the fixture and style pattern to mirror** —
  the `validView` object shape, `VALID_TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q'`, `dispatchPhone: '+37160000000'`,
  and the `(expected)` / `(edge)` / `(failure)` title convention.
- `packages/shared/vitest.config.ts` — Why: the minimal-config house style to extend (no `globals`,
  explicit `include`).
- `packages/shared/package.json` (scripts block) — Why: `"test": "vitest run"` is the exact script string to
  copy; `vitest ^3.0.0` is the version line to match.
- `packages/shared/src/i18n.ts` (lines 104-112) — Why: `formatMessage(lang, key, params)` signature. Note the
  catalog is `satisfies Record<Language, Record<MessageKey, string>>` — **totality is already compiler-pinned**,
  so do NOT write a "every key exists" test (it would be redundant with the type system).
- `packages/shared/src/schemas/tracking.ts` (lines 28-64) — Why: `TRACKING_PAGE_STATES` and
  `trackingViewSchema` — the exact fixture shape the poll response must satisfy (`position.at` is
  `z.string().datetime()`, i.e. an ISO string, never a `Date`).
- `.npmrc` (2 lines) — Why: **the cause of Task 0.** `node-linker=hoisted`, commented *"Expo requires hoisted
  node_modules in pnpm monorepos"*. Hoisting + the react 19.2.3/19.2.4 skew between the Expo apps and the web
  apps is what produces the dual-React-instance failure. Read it before touching Task 0 so you understand why
  the fix is a version override rather than a vitest setting.
- Root `package.json` (the `pnpm` key) — Why: Task 0 edits it; `onlyBuiltDependencies` stays untouched.
- `turbo.json` (whole file, 12 lines) — Why: **read it to confirm you do not need to change it.** The `test`
  task already exists with `dependsOn: ["^build"]` — verified in the spike, turbo ran `@taxi/dispatch:test`
  off the package script alone.
- `.github/workflows/ci.yml` — Why: confirm the gate command (`pnpm turbo run typecheck lint test build`) and
  that CI pins `node-version: 20` — this is what forces the dependency pins below.
- `apps/dispatch/CLAUDE.md` + root `CLAUDE.md` — Why: the hard rules the suite enforces (catalog strings,
  a11y, VSA, ≥1 expected + 1 edge + 1 failure per feature).

### New Files to Create

- `apps/dispatch/vitest.config.ts` — runner config: jsdom, `@` alias, setup file, test include glob.
- `apps/dispatch/vitest.setup.ts` — jest-dom matchers + **explicit `afterEach(cleanup)`** (see GOTCHA).
- `apps/dispatch/src/features/tracking/states.test.tsx` — `statusLine` + `StatusScreen`.
- `apps/dispatch/src/features/tracking/tracking-live.test.tsx` — the `TrackingLive` island, incl. **M1**.
- `apps/dispatch/src/features/tracking/tracking-page.test.tsx` — the server page's branches, incl. **M2**.
- `apps/dispatch/src/features/tracking/tracking-data-route.test.ts` — the polling proxy route handler.

**Test file location — VSA, deliberately**: all four live in `src/features/tracking/`, the slice that owns
the `t/[token]` route surface. Root `CLAUDE.md`: *"one folder per feature owning routes/service/schemas/tests"*
and *"Tests mirror slices."* This also keeps `src/app/` free of non-route files — zero risk of Next.js
treating a test file as part of the route tree. The two route-level tests import across via the `@` alias
(`@/app/t/[token]/page`), which is why the alias must work.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Vitest — Configuring Vitest / `test.environment`](https://vitest.dev/config/#environment)
  - Section: `environment`, `setupFiles`, `include`
  - Why: the three options this config sets; confirms `jsdom` needs the `jsdom` package installed separately.
- [Vitest — `server.deps.external` / dependency handling](https://vitest.dev/config/#server-deps-external)
  - Section: how linked workspace packages are inlined rather than externalized
  - Why: the documented escape hatch for the `@taxi/shared` **CJS-dist** risk (see GOTCHA below).
- [Vitest — Fake Timers (`vi.useFakeTimers`, `vi.advanceTimersByTimeAsync`, `vi.setSystemTime`)](https://vitest.dev/api/vi.html#vi-usefaketimers)
  - Section: `advanceTimersByTimeAsync` and the default `toFake` list (which **includes `Date`**)
  - Why: the M1 test's whole mechanism — and why the poll clock must be moved with `setSystemTime` to make
    the assertion discriminating.
- [Testing Library — `getByRole` and the `name` option](https://testing-library.com/docs/queries/byrole#name)
  - Section: `name` (accessible name computation)
  - Why: `getByRole('link', { name })` **is** the M2 assertion — it fails if the control is missing, has the
    wrong role, or has no/incorrect accessible name.
- [Testing Library — `cleanup` / auto-cleanup](https://testing-library.com/docs/react-testing-library/api#cleanup)
  - Section: "if you're using a test framework without global `afterEach`, you must call cleanup yourself"
  - Why: we run with `globals: false` (house style), so auto-cleanup **does not fire**. See GOTCHA.
- [React 19 — `act`](https://react.dev/reference/react/act)
  - Why: advancing fake timers triggers React state updates; they must be wrapped or React logs an act warning.
- [Next.js — async request APIs (`params` / `searchParams` are Promises)](https://nextjs.org/docs/app/api-reference/file-conventions/page#params-optional)
  - Why: the page's props must be constructed as `Promise.resolve({...})` in tests.

### Patterns to Follow

**Test file naming & titles** (from `packages/shared/tests/tracking.test.ts`, and the root rule
"≥1 expected + 1 edge + 1 failure case"):

```ts
describe('trackingTokenSchema', () => {
  it('accepts a 22-char base64url token (expected)', () => { … });
  it('rejects wrong lengths (edge)', () => { … });
  it('rejects classic-base64 alphabet leaking in (failure)', () => { … });
});
```

Every `it` title ends with `(expected)`, `(edge)` or `(failure)`. Keep that.

**No vitest globals** — import explicitly, exactly as `packages/shared` and `db` do:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
```

(There is no `globals: true` anywhere in this repo. Do not introduce it — it would also mask the RTL cleanup
problem instead of solving it explicitly.)

**Fixture style** — a module-level `validView` object spread per test, mirroring `tracking.test.ts`:

```ts
const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q'; // 22 base64url chars, same as shared's spec
const baseView: TrackingView = {
  state: 'arriving',
  driverName: 'Jānis',
  driverPhotoUrl: null,
  vehiclePlate: 'AB-1234',
  position: { lat: 56.95, lng: 24.1, at: '2026-08-11T09:00:00.000Z' },
  etaMinutes: 4,
  dispatchPhone: '+37160000000',
  updatedAt: '2026-08-11T09:00:00.000Z',
};
```

**Assertions reference the catalog, never a literal** — this is the M2 discipline expressed as a test rule.
A test that hardcodes `'Mēģināt vēlreiz'` would pass against a hardcoded component:

```ts
// ✅ pins "the string came from the catalog"
screen.getByRole('link', { name: formatMessage('lv', 'page.retry') });

// ❌ never — a literal here cannot distinguish catalog-sourced from hardcoded
screen.getByText('Mēģināt vēlreiz');
```

**Time assertions derive the expected string, never hardcode it** — `timeOf` calls `toLocaleTimeString`, which
reads the **system timezone**. CI runs UTC; the dev machine is Europe/Riga. A hardcoded `'12:00'` passes in
one and fails in the other:

```ts
const expectedTime = new Date('2026-08-11T09:00:00.000Z').toLocaleTimeString('lv-LV', {
  hour: '2-digit',
  minute: '2-digit',
});
screen.getByText(formatMessage('lv', 'page.position_updated', { time: expectedTime }));
```

**Mock-first, module-scope** — `vi.mock` calls hoist; declare them above the imports-under-test.

---

## IMPLEMENTATION PLAN

Phases run **top to bottom by default** — each assumes the phase above it is done.

### Phase 1: Foundation — install the runner and *retire the interop risk*

The residual one-pass risk in this ticket is not the tests, it is the
**Next 16 + Vitest 3 + React 19 + RTL 16 + pnpm-workspace-CJS** interop. This phase exists to surface any
surprise at task 3, not task 12. It ends with **the full gate run**, not just `vitest`.

**Tasks:**

- **Task 0 first**: pin one React across the workspace via root `pnpm.overrides` — **without it every
  rendering test fails**; this is not optional ordering.
- Add the five devDependencies at the pinned versions (Node-20 constraint — see GOTCHA).
- Add `"test": "vitest run"` to `apps/dispatch/package.json`.
- Create `vitest.config.ts` and `vitest.setup.ts`.
- Write **one smoke test** — `tracking-live.test.tsx` with its leaflet mock and **one** terminal-state render
  — and run the **full CI-parity gate**.
- Confirm the gate output shows `@taxi/dispatch:test` executing.

> Phase 1 is now **belt-and-braces rather than exploratory**: the spike already ran this exact sequence to
> green. Keep the boundary anyway — it is cheap, and it catches an environment that differs from the spike's
> (a different Node patch, a stale lockfile, someone else's concurrent workspace edit).

> **Why the smoke test is `TrackingLive` and not the simpler `StatusScreen`:** `states.tsx` imports nothing
> but `@taxi/shared`, so rendering it would leave **three of the four interop risks untouched** — the
> `import 'leaflet/dist/leaflet.css'` at `tracking-map.tsx:10`, the dynamic `import('leaflet')` in the
> position effect, and the `vi.mock` hoisting that stubs it. A terminal-state `TrackingLive` render loads all
> of them plus the CJS `@taxi/shared` path, still costs ~15 lines, and needs no fake timers (a terminal state
> short-circuits the poll). That is the whole point of having a Phase 1 boundary: it must exercise the
> surface it claims to de-risk.

### Phase 2: Core Implementation — the seed suite

**Depends on:** Phase 1 (an unproven config makes every failure ambiguous).

The remaining tests, in ascending order of interop surface: pure functions → the rest of the client island →
server page → route handler.

**Tasks:**

- `states.test.tsx` — `statusLine` totality/distinctness across all states × languages; `StatusScreen` render.
- `tracking-live.test.tsx` (continued) — the **M1 poll-discriminating** test + the expected/edge/failure triad.
- `tracking-page.test.tsx` — the server page's four branches, including **M2**.
- `tracking-data-route.test.ts` — the proxy route (node environment via docblock).

### Phase 3: Integration

**Independent of:** nothing — but note there is **deliberately almost nothing here**. The wiring is one
`package.json` line; `turbo.json` and `ci.yml` are already correct.

**Tasks:**

- Verify (do not edit) `turbo.json` — the `test` task with `dependsOn: ["^build"]` already covers the new script.
- Verify (do not edit) `.github/workflows/ci.yml` — `pnpm turbo run typecheck lint test build` already picks it up.
- Confirm `eslint` (bare, lints cwd) passes on `vitest.config.ts`, `vitest.setup.ts` and the four test files.
- Confirm `tsc --noEmit` and `next build` typecheck the new files.

### Phase 4: Testing & Validation

**Tasks:**

- Run the full CI-parity gate with `--force` and `REDIS_TEST_URL` set.
- **Mutation-check the two regression pins** (the step that proves the suite has teeth — see VALIDATION Level 4).
- Confirm no source file under `src/features/tracking/` or `src/app/` was modified (`git diff --stat`).

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently testable.

### Task Format Guidelines

Use information-dense keywords for clarity:

- **CREATE**: New files or components
- **UPDATE**: Modify existing files
- **ADD**: Insert new functionality into existing code
- **REMOVE**: Delete deprecated code
- **REFACTOR**: Restructure without changing behavior
- **MIRROR**: Copy pattern from elsewhere in codebase

---

### Task 0 — UPDATE root `package.json`: pin one React across the workspace (**BLOCKER, do this first**)

- **IMPLEMENT**: Add an `overrides` block inside the existing `pnpm` key of the **root** `package.json`:
  ```jsonc
  "pnpm": {
    "onlyBuiltDependencies": [ /* … leave exactly as-is … */ ],
    "overrides": {
      "react": "19.2.4",
      "react-dom": "19.2.4"
    }
  }
  ```
  Then `pnpm install`.
- **PATTERN**: the root `package.json` already owns workspace-wide pnpm config (`onlyBuiltDependencies`);
  this is the same key, one level down.
- **IMPORTS**: n/a
- **GOTCHA**: **Without this, every rendering test fails** with
  `TypeError: Cannot read properties of null (reading 'useState')` — 9 of 17 in the spike. Cause:
  `.npmrc`'s `node-linker=hoisted` (required by Expo) + react 19.2.3 in rider/driver vs 19.2.4 in
  dispatch/admin ⇒ three separate react copies, and react-dom's dispatcher lands on a different instance
  than the component's `useState`. See SPIKE VERIFICATION #1.
- **GOTCHA**: do **not** try to fix this in `vitest.config.ts`. `resolve.dedupe: ['react','react-dom']` was
  tried and **does not work** — vitest externalizes `node_modules`, so Vite's resolver never handles them.
  With the override in place, `dedupe` is unnecessary (verified by removing it: still 17/17).
- **GOTCHA**: this also silences a **pre-existing, real** peer violation that `pnpm install` has been printing
  all along (`apps/driver → react-dom 19.2.4 → unmet peer react@^19.2.4: found 19.2.3`). It is a patch bump
  within 19.2.x for the Expo apps — see OPEN QUESTIONS for the one residual risk worth a sanity check.
- **VALIDATE**:
  ```bash
  pnpm install 2>&1 | grep -i "unmet peer"      # expect NO output
  node -e "console.log(require.resolve('react',{paths:['./apps/dispatch']}));console.log(require.resolve('react-dom',{paths:['./apps/dispatch']}))"
  # both must resolve to the SAME root node_modules — no apps/dispatch/node_modules/react, no nested copy

  pnpm --filter @taxi/rider start   # boot-and-look, then Ctrl-C
  # The ONE thing the spike could not settle: Expo SDK 57 under react 19.2.4.
  # Do it HERE, not before merging — if Expo objects, re-running Task 0 in the
  # other direction costs one install; finding out after the suite is written
  # costs a second install AND a second full gate run. See OPEN QUESTIONS #5.
  ```
- **SATISFIES**: AC #1 (prerequisite for every rendering test)

---

### UPDATE `apps/dispatch/package.json` — devDependencies

- **IMPLEMENT**: Add exactly these five devDependencies at these ranges:
  ```
  "@testing-library/dom": "^10.4.1",
  "@testing-library/jest-dom": "~6.9.1",
  "@testing-library/react": "^16.3.2",
  "jsdom": "^26.1.0",
  "vitest": "^3.0.0"
  ```
  Install with `pnpm --filter @taxi/dispatch add -D <pkgs>` (or hand-edit + `pnpm install`).
- **PATTERN**: `packages/shared/package.json` devDependencies — `"vitest": "^3.0.0"` (resolves to 3.2.7, already
  in the lockfile; matching the range keeps one vitest version across the workspace).
- **IMPORTS**: n/a
- **GOTCHA** — **these pins are forced by Node 20, do not "upgrade" them**. Verified with `pnpm view … engines`:
  | package | latest | latest's `engines.node` | verdict on Node 20.20.2 |
  |---|---|---|---|
  | `jsdom` | 30.0.1 | `^22.22.2 \|\| ^24.15.0 \|\| >=26` | ❌ **breaks** → pin `^26.1.0` (`>=18`) |
  | `@testing-library/jest-dom` | 7.0.1 | `>=22` | ❌ **breaks**; and 6.10.0 also moved to `>=22`, so `^6.9.1` would silently resolve to it → pin **`~6.9.1`** (last `>=14` release) |
  | `vitest` | 4.1.10 | peer `vite ^6\|^7\|^8` | avoid — would fork the workspace off shared/db's 3.2.7 → pin `^3.0.0` |
  | `@testing-library/react` | 16.3.2 | `>=18` | ✅ peers `react ^19`, `@testing-library/dom ^10` |
  Local `node -v` = **v20.20.2**; `ci.yml` sets `node-version: 20`. `@testing-library/dom` must be listed
  **explicitly** — RTL 16 declares it as a *peer*, not a dependency.
- **GOTCHA**: Do **not** add `@vitejs/plugin-react`. Its current major (6.x) peers on `vite ^8`, which
  conflicts with vitest 3's `vite ^5||^6||^7`. It is also unnecessary: Vite's esbuild compiles `.tsx` with
  the automatic JSX runtime, and the config below sets `esbuild.jsx: 'automatic'` explicitly so this does not
  depend on tsconfig discovery. Fast Refresh (the plugin's real job) is meaningless in a test run.
- **VALIDATE**: `pnpm install && pnpm ls --filter @taxi/dispatch --depth 0 2>&1 | grep -E "vitest|jsdom|testing-library"`
  — expect vitest 3.2.x, jsdom 26.x, jest-dom 6.9.x, RTL 16.x, @testing-library/dom 10.x.
- **SATISFIES**: AC #1

---

### UPDATE `apps/dispatch/package.json` — scripts

- **IMPLEMENT**: Add `"test": "vitest run"` to the `scripts` block, placed after `"lint"` / `"typecheck"` to
  match sibling ordering.
- **PATTERN**: `packages/shared/package.json:` `"test": "vitest run"` — byte-identical string.
- **IMPORTS**: n/a
- **GOTCHA**: **This is the entire turbo wiring.** `turbo.json` already declares
  `"test": { "dependsOn": ["^build"] }`. Do **not** add a per-package `turbo.json`, a `//#test` root task, or
  an `outputs` array. A redundant override is the specific mistake to avoid.
- **GOTCHA**: `pnpm --filter @taxi/dispatch test` run directly will **fail on a cold `@taxi/shared` dist** —
  the app imports `@taxi/shared`, whose `main` points at `dist/index.js`. Always go through turbo
  (`pnpm turbo run test --filter @taxi/dispatch`), which honours `^build`, or build shared first.
- **VALIDATE**: `node -e "console.log(require('./apps/dispatch/package.json').scripts.test)"` → `vitest run`
- **SATISFIES**: AC #1, AC #2

---

### CREATE `apps/dispatch/vitest.config.ts`

- **IMPLEMENT**:
  ```ts
  import { fileURLToPath } from 'node:url';
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    // JSX without @vitejs/plugin-react: esbuild's automatic runtime is all a
    // test run needs (the plugin exists for Fast Refresh, and its current major
    // peers on vite 8 — incompatible with vitest 3).
    esbuild: { jsx: 'automatic' },
    resolve: {
      // Mirrors tsconfig.json's `paths: { "@/*": ["./src/*"] }` — page.tsx and
      // the route-level tests import through it.
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      environment: 'jsdom',
      // Tests live beside their slice (VSA), not in a top-level tests/ dir.
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['./vitest.setup.ts'],
    },
  });
  ```
- **PATTERN**: `packages/shared/vitest.config.ts` — same minimal `defineConfig({ test: { environment, include } })`
  shape, extended only where this app genuinely differs (jsdom, alias, setup, JSX).
- **IMPORTS**: `node:url` (`fileURLToPath`) — `@types/node` is already a devDependency of the app.
- **GOTCHA**: use `fileURLToPath(new URL('./src', import.meta.url))`, **not** `path.resolve(__dirname, …)`.
  Vite shims `import.meta.url` when bundling the config in either module format; `__dirname` depends on the
  package being CJS-typed and is the more fragile of the two.
- **GOTCHA**: this is the **exact file that passed the spike** — 17/17 tests, 10/10 gate tasks. Add nothing
  else to it. In particular:
  - **No `server.deps.external` for `@taxi/shared`.** The CommonJS `dist/index.js` consumed through a pnpm
    link was this plan's biggest named risk; it **just works**. The escape hatch that earlier drafts
    pre-wrote turned out to be unnecessary — do not add it speculatively.
  - **No `resolve.dedupe`.** It does not solve the React-instance problem (Task 0 does), and once Task 0 is
    applied it is dead config — verified by removing it.
  - **No `css` option.** `import 'leaflet/dist/leaflet.css'` is already a no-op under vitest's defaults.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch` (after the smoke test exists) — vitest boots and
  reports the config without a resolution error.
- **SATISFIES**: AC #1

---

### CREATE `apps/dispatch/vitest.setup.ts`

- **IMPLEMENT**:
  ```ts
  import '@testing-library/jest-dom/vitest';
  import { cleanup } from '@testing-library/react';
  import { afterEach } from 'vitest';

  // RTL's auto-cleanup only fires when the runner exposes a GLOBAL afterEach.
  // This repo runs vitest without `globals: true` (house style: explicit
  // imports), so cleanup must be wired by hand — otherwise every render leaks
  // into the next test and getByRole starts finding multiple elements.
  afterEach(cleanup);
  ```
- **PATTERN**: no in-repo precedent (first setup file in the workspace); `db/vitest.config.ts`'s `globalSetup`
  is the nearest analogue for the *config key*, not the content.
- **IMPORTS**: as shown.
- **GOTCHA**: `afterEach(cleanup)` is **load-bearing**, not boilerplate. Omit it and the failures are
  confusing (`Found multiple elements with the role "link"`) and appear in whichever test happens to run
  second. This is the single most likely cause of a bewildering red run in this ticket.
- **GOTCHA**: import the `/vitest` entry point (`@testing-library/jest-dom/vitest`), not the bare package —
  the bare entry wires into Jest's `expect` and will not extend vitest's.
- **VALIDATE**: covered by the next task's gate run.
- **SATISFIES**: AC #1

---

### CREATE `apps/dispatch/src/features/tracking/tracking-live.test.tsx` — mocks, fixtures + **the Phase 1 smoke test**

- **IMPLEMENT**: The file header (leaflet mock + fixtures + lifecycle hooks) **and exactly one test**, then
  stop and run the gate. Header:
  ```tsx
  import { formatMessage, type TrackingView } from '@taxi/shared';
  import { act, render, screen } from '@testing-library/react';
  import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
  import { statusLine } from './states';
  import { TrackingLive } from './tracking-map';

  // Leaflet touches real layout/geometry; jsdom has none. The map div is
  // aria-hidden — the TEXT alternative is the tested surface — so a structural
  // stub is the honest boundary here.
  const mapStub = { setView: vi.fn(), remove: vi.fn() };
  mapStub.setView.mockReturnValue(mapStub);          // L.map(...).setView(...) is what gets stored
  const markerStub = { setLatLng: vi.fn(), addTo: vi.fn() };
  markerStub.addTo.mockReturnValue(markerStub);      // L.marker(...).addTo(...) is what gets stored
  vi.mock('leaflet', () => ({
    default: {
      map: () => mapStub,
      tileLayer: () => ({ addTo: vi.fn() }),
      marker: () => markerStub,
    },
  }));

  const TOKEN = 'Ab3_-6qhTGplK0vwXz9y-Q';
  const POSITION_AT = '2026-08-11T09:00:00.000Z';
  const baseView: TrackingView = { /* per the fixture in Patterns to Follow */ };

  const okJson = (view: TrackingView) => ({ ok: true, status: 200, json: async () => view });
  const statusOnly = (status: number) => ({ ok: false, status, json: async () => ({}) });

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T09:30:00.000Z')); // 30 min AFTER the fixture position
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
  ```
  And the single smoke test — a **terminal** state, so no poll fires and no timer advance is needed, while
  the position effect still loads Leaflet:
  ```tsx
  describe('TrackingLive', () => {
    it('renders a terminal ride from the server view (expected)', async () => {
      render(<TrackingLive token={TOKEN} lang="lv" initial={{ ...baseView, state: 'completed' }} />);
      // Flush the dynamic import('leaflet') the position effect kicks off.
      await act(async () => {});
      expect(screen.getByText(statusLine('lv', 'completed'))).toBeInTheDocument();
    });
  });
  ```
- **PATTERN**: `packages/shared/tests/tracking.test.ts` — fixture at module scope, explicit vitest imports,
  `(expected)` title suffix.
- **IMPORTS**: as shown. `act` comes from `@testing-library/react` (it re-exports React 19's `act`).
  `@taxi/shared` is imported here **on purpose** — this smoke test is what exercises the CJS-dist risk.
- **GOTCHA — STOP HERE AND RUN THE FULL GATE before writing anything else.** This is the phase boundary that
  makes the confidence score defensible. This one render exercises **every** interop risk at once: the CJS
  `@taxi/shared` dist through a pnpm symlink, `import 'leaflet/dist/leaflet.css'` at `tracking-map.tsx:10`
  (expected to be a no-op under vitest's default `css: false` — this is where you find out), the dynamic
  `import('leaflet')` inside the effect, `vi.mock` hoisting, jsdom, RTL 16 + React 19, and JSX via esbuild.
  If any of it bites, it bites now on ~30 lines rather than after 200.
- **GOTCHA**: write the header **and** the one `it` in the same step — vitest errors on a file containing no
  tests, so a mock-header-only file fails the gate for an unrelated reason.
- **GOTCHA**: the mock's `setView` **must return the map** and `addTo` **must return the marker** —
  `tracking-map.tsx:73` and `:80` store the *return value*. Return `undefined` and the next poll's
  `marker.current?.setLatLng(...)` silently no-ops, or `map.current.setView(...)` throws.
- **GOTCHA**: return **plain object literals** from the fetch mock, not `new Response(...)`. Whether Node's
  `Response` survives into vitest's jsdom environment is an unnecessary thing to depend on; the component only
  ever reads `.ok`, `.status` and `.json()`.
- **GOTCHA**: `vi.useFakeTimers()` fakes **`Date` by default**. `setSystemTime` to 09:30 while the fixture
  position is stamped 09:00 is what makes the M1 assertion discriminating — see two tasks down.
- **VALIDATE**: `REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`
  — must be green, **and** the output must contain a `@taxi/dispatch:test` task line.
- **SATISFIES**: AC #1, AC #2, AC #4

---

### CREATE `apps/dispatch/src/features/tracking/states.test.tsx`

- **IMPLEMENT**: A `describe('StatusScreen')` block with the expected case:
  ```tsx
  const message = formatMessage('lv', 'page.not_found');
  render(<StatusScreen lang="lv" message={message} />);
  expect(screen.getByRole('heading', { name: message })).toBeInTheDocument();
  ```
  plus a `describe('statusLine')` block:
  - **(expected)** — for each `lang` of `LANGUAGES`, `statusLine(lang, 'arriving')` equals
    `formatMessage(lang, 'page.arriving')`.
  - **(edge)** — for each `lang`, mapping `TRACKING_PAGE_STATES` through `statusLine` yields **8 distinct,
    non-empty strings**. This is the test that earns its place: it catches the copy-paste class
    (`arrived: 'page.arriving'`) that the `Record<TrackingPageState, MessageKey>` type **cannot** catch,
    because both sides are valid `MessageKey`s.
    ```ts
    const lines = TRACKING_PAGE_STATES.map((s) => statusLine(lang, s));
    expect(new Set(lines).size).toBe(TRACKING_PAGE_STATES.length);
    ```
  - **(failure)** — `statusLine` never leaks an unresolved key or placeholder: assert no returned string
    matches `/^page\./` or contains `{`.
- **PATTERN**: `packages/shared/tests/tracking.test.ts:79` — "pins the page-state set so a new state visits
  the renderer deliberately". Same intent, one layer up.
- **IMPORTS**: `import { LANGUAGES, TRACKING_PAGE_STATES, formatMessage } from '@taxi/shared';`
  `import { render, screen } from '@testing-library/react';`
  `import { StatusScreen, statusLine } from './states';`
- **GOTCHA**: Do **not** write a "every state has catalog copy" test — `i18n.ts`'s
  `satisfies Record<Language, Record<MessageKey, string>>` plus `states.tsx`'s
  `Record<TrackingPageState, MessageKey>` already make that a **compile** error. Duplicating a compiler
  guarantee in a test is noise. Distinctness is the gap; test the gap.
- **GOTCHA**: distinctness was verified to hold in all three catalogs at plan time (lv/ru/en each yield 8
  distinct strings). If it fails, that is a **real catalog bug** — report it, do not relax the assertion.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch`
- **SATISFIES**: AC #3

---

### ADD to `tracking-live.test.tsx` — the M1 regression pin (**the point of this ticket**)

- **IMPLEMENT**:
  ```tsx
  it('keeps stamping the position\'s OWN recorded time after a poll (edge — stale GPS)', async () => {
    // Same position.at, NEWER updatedAt: the driver's GPS has gone silent while
    // the ride record keeps ticking. This is the ONLY shape that discriminates
    // — before the first poll, lastSeenAt is null and both implementations agree.
    const polled: TrackingView = { ...baseView, updatedAt: '2026-08-11T09:30:00.000Z' };
    vi.mocked(fetch).mockResolvedValue(okJson(polled) as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });

    const expectedTime = new Date(POSITION_AT).toLocaleTimeString('lv-LV', {
      hour: '2-digit', minute: '2-digit',
    });
    expect(
      screen.getByText(formatMessage('lv', 'page.position_updated', { time: expectedTime })),
    ).toBeInTheDocument();
  });
  ```
- **PATTERN**: the docblock at `tracking-map.tsx:247-249` states the contract in prose — this test is that
  comment made executable.
- **IMPORTS**: `import { TrackingLive } from './tracking-map';`
- **GOTCHA — read this twice**: a test that only renders with an old `position.at` and asserts the time
  **passes against the regressed implementation too**, because `lastSeenAt` is `null` on first render and the
  buggy code fell back to `view.updatedAt`. The regression reproduces **only after a poll returns the same
  position**. The `advanceTimersByTimeAsync(5_000)` + identical `position.at` + newer `updatedAt` +
  `setSystemTime(09:30)` combination is the whole test. Do not simplify any of the four.
- **GOTCHA**: derive `expectedTime` with `toLocaleTimeString` as shown — **never hardcode `'09:00'`**. This is
  not theoretical: in the spike the assertion resolved to **`Atrašanās vieta atjaunota 10:00`**, because the
  dev machine is Europe/Riga (UTC+3 in August) while CI runs UTC. A hardcoded `'09:00'` would have gone green
  in CI and red locally — or worse, the reverse.
- **GOTCHA**: wrap the timer advance in `act(async () => …)`. Without it React 19 logs
  "An update to TrackingLive inside a test was not wrapped in act(...)" and the assertion may read
  pre-update DOM.
- **GOTCHA**: the `as never` on `mockResolvedValue(okJson(polled) as never)` is **deliberate, not sloppiness** —
  `fetch`'s type demands a full `Response`, but the component reads only `.ok`, `.status` and `.json()`.
  Constructing a real `Response` to satisfy the compiler would add a jsdom-environment dependency for zero
  behavioral gain. Keep the narrow stub and the cast; do not "fix" it by widening the fixture.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch` — then the **mutation check** in
  VALIDATION Level 4 step 1.
- **SATISFIES**: AC #4, AC #6

---

### ADD to `tracking-live.test.tsx` — expected / edge / failure triad

- **IMPLEMENT**: three more tests:
  - **(expected)** — renders the status line, driver name, plate and ETA from `baseView`:
    `screen.getByText(statusLine('lv','arriving'))`, `getByText(/Jānis/)`, `getByText(/AB-1234/)`, and
    `getByText(formatMessage('lv','page.eta_minutes',{ eta: 4 }))`.
  - **(edge)** — a **terminal** state never polls:
    ```tsx
    render(<TrackingLive token={TOKEN} lang="lv" initial={{ ...baseView, state: 'completed' }} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    ```
    (pins `tracking-map.tsx:42` `done` short-circuit — the battery/cost contract for a finished ride.)
  - **(failure)** — a poll returning **410** swaps the island for the expired notice, announced politely:
    ```tsx
    vi.mocked(fetch).mockResolvedValue(statusOnly(410) as never);
    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(screen.getByRole('status')).toHaveTextContent(formatMessage('lv', 'page.expired'));
    ```
- **PATTERN**: root `CLAUDE.md` — "each feature ships ≥1 expected + 1 edge + 1 failure case".
- **IMPORTS**: add `import { statusLine } from './states';`
- **GOTCHA**: the offline banner (`role="alert"`, non-OK poll → `page.connection_lost`) is a **tempting
  fifth test**. It is fine to add, but note its `timeOf(lastSeenAt ?? new Date(view.updatedAt))` fallback is
  deliberately *poll-clock* based — that is correct there (it reports when *we* last heard from the API, not
  when the GPS last spoke). Do not "fix" it to match M1; they are different clocks answering different
  questions.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch`
- **SATISFIES**: AC #4

---

### CREATE `apps/dispatch/src/features/tracking/tracking-page.test.tsx` — incl. the M2 pin

- **IMPLEMENT**: The server-component tests. `TrackingPage` is `async`, so **call it and render the returned
  tree** (RTL cannot render an async component directly; the returned tree is all-sync):
  ```tsx
  import TrackingPage, { generateMetadata } from '@/app/t/[token]/page';

  const renderPage = async (searchParams: Record<string, string | string[]> = {}) =>
    render(await TrackingPage({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve(searchParams),
    }));
  ```
  Four tests:
  - **(failure — M2)** API unreachable → the retry control is a real, named link:
    ```tsx
    vi.mocked(fetch).mockRejectedValue(new Error('ECONNREFUSED'));
    await renderPage();
    expect(
      screen.getByRole('link', { name: formatMessage('lv', 'page.retry') }),
    ).toBeInTheDocument();
    ```
    This single query pins **role + presence + catalog-sourced accessible name** — a hardcoded `↻` or an
    icon-only control fails it.
  - **(expected)** — a 200 renders the title heading, the language switcher links for the two non-active
    languages, and the `tel:` call-dispatch link:
    `getByRole('link', { name: formatMessage('lv','page.call_dispatch') })` and assert its `href` is
    `tel:+37160000000`.
  - **(edge)** — `?lang=xx` (unknown) and `?lang=['ru','en']` (array) both normalize: heading text equals
    `formatMessage('lv','page.title')` for the former and `formatMessage('ru','page.title')` for the latter
    (pins `langFrom`, `page.tsx:26-31`).
  - **(failure)** — 404 → `page.not_found` heading; 410 → `page.expired` heading.
  - Optionally, `generateMetadata` returns the catalog title for the requested language.
- **PATTERN**: same mock/fixture header as `tracking-live.test.tsx` (fake timers are **not** needed here —
  the server page does not poll; keep this file on real timers so nothing surprising happens inside
  `TrackingLive`'s effects).
- **IMPORTS**: `TrackingPage` is the **default** export; `generateMetadata` is named.
- **GOTCHA**: `params` and `searchParams` are **Promises** (`page.tsx:22-23`). Passing bare objects
  typechecks-fails and, if forced, hangs on `await`.
- **GOTCHA**: the **expected** case renders `TrackingLive`, so the Leaflet mock from the sibling file does
  **not** apply — `vi.mock` is per-file. Duplicate the leaflet mock in this file (or extract it to a small
  local `./__fixtures__/leaflet-mock.ts` if duplication bothers you; a shared file must still be
  `vi.mock`-ed per test file, so duplication is the simpler call for two files).
- **GOTCHA**: `<a href="">` — an `href` attribute is present, so the accessible role **is** `link`. If
  `getByRole('link', …)` unexpectedly fails to find it, that is a finding about the markup worth reporting;
  do **not** weaken the assertion to `getByText`, which would defeat the entire purpose of the M2 pin.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch` — then the **mutation check** in VALIDATION
  Level 4 step 2.
- **SATISFIES**: AC #5, AC #6

---

### FIX `apps/dispatch/src/app/t/[token]/page.tsx` — expose the retry control as a link (**one line**)

- **IMPLEMENT**: Run the page test first and **watch the M2 case fail** — that failure is the defect being
  demonstrated, not a mistake. Then apply exactly this, at `page.tsx:103`:
  ```diff
           <a
  -          href=""
  +          href={`/t/${token}?lang=${lang}`}
             style={{
  ```
  Re-run: the M2 test passes. **Nothing else in the file changes.**
- **PATTERN**: `page.tsx:154` — the language-switcher anchors already use exactly this form
  (`href={`/t/${token}?lang=${l}`}`). This makes the retry control consistent with its own file, not novel.
- **IMPORTS**: none — `token` and `lang` are already in scope in that branch.
- **GOTCHA — why this is in scope at all** (the plan otherwise forbids touching source): `<a href="">`
  renders the text but yields **`queryAllByRole('link') === 0`**. An empty `href` does not map to the `link`
  role, so the only interactive affordance on the API-down screen is invisible to VoiceOver/TalkBack. Verified
  in the spike; see SPIKE VERIFICATION #2. This is the a11y exception the Non-Goals carved out.
- **GOTCHA**: a full navigation to the same URL **is** the retry — `page.tsx:81-82`'s own comment says so
  ("a full reload IS the retry; there is no client state to preserve"). Preserving `?lang` means the retry
  does not silently drop the reader back to Latvian. Do **not** reach for `onClick`/`location.reload()`:
  this is a server component, and adding a handler would force `'use client'` on the whole page.
- **GOTCHA**: this fix is a **behavior change on a shipped page** — call it out explicitly in the PR body and
  the execution report. It is the one deviation from "no source changes", and reviewers should see it argued,
  not buried in a diff.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch` (M2 case green), then
  `git diff --stat -- 'apps/dispatch/src/app/t/[token]/page.tsx'` → **1 file changed, 1 insertion, 1 deletion**.
- **SATISFIES**: AC #5, AC #6, AC #8

---

### CREATE `apps/dispatch/src/features/tracking/tracking-data-route.test.ts`

- **IMPLEMENT**: Node-environment tests for the polling proxy:
  ```ts
  // @vitest-environment node
  ```
  as the **first line of the file**, then:
  - **(expected)** — a valid token proxies through: stub `fetch` to return
    `{ status: 200, text: async () => JSON.stringify(baseView) }`; assert the handler's response `status` is
    200, `content-type` is `application/json`, `cache-control` is `no-store`, and the body round-trips.
  - **(failure)** — a malformed token (`'..'`) answers **404 locally without calling fetch**:
    `expect(vi.mocked(fetch)).not.toHaveBeenCalled()` (pins the `route.ts:20` shape-check guard, which exists
    so a path-traversal-shaped token cannot cost an API hop).
  - **(edge)** — the API throwing yields **502** with `{ message: 'api_unreachable' }`.
- **PATTERN**: `services/api`'s `*.spec.ts` style is the nearest node-environment analogue; the assertions
  themselves mirror `packages/shared/tests/tracking.test.ts`'s token cases.
- **IMPORTS**: `import { GET } from '@/app/t/[token]/data/route';` — call it as
  `await GET({} as never, { params: Promise.resolve({ token }) })`. `NextRequest` is a **type-only** import in
  the route, so the first argument is never touched at runtime and `{} as never` is honest.
- **GOTCHA**: the `// @vitest-environment node` docblock is not optional politeness — the handler uses
  `Response.json`, and node is simply the correct environment for server code with no DOM. It must be the
  **first line**, before imports.
- **GOTCHA**: if this file turns into config surgery beyond that one docblock (e.g. `Response.json` still
  missing, or `next/server` pulling runtime code), **drop the file** and note why in the execution report —
  the ticket's named scope is the states/map components; this route test is a cheap bonus, not a hill to die on.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch`
- **SATISFIES**: AC #5

---

### UPDATE `apps/dispatch/CLAUDE.md`

- **IMPLEMENT**: Add one line to the bullet list recording that the app has a test runner and where tests
  live, e.g.:
  `- Tests: vitest + RTL (jsdom), co-located as `src/features/<name>/*.test.tsx`; run via `pnpm turbo run test --filter @taxi/dispatch` (direct `pnpm --filter … test` needs a built `@taxi/shared`).`
- **PATTERN**: the file's existing terse one-line-per-rule bullets.
- **IMPORTS**: n/a
- **GOTCHA**: one line. Do not restate the root `CLAUDE.md` testing rules — the root already owns
  "tests mirror slices" and the expected/edge/failure triad.
- **VALIDATE**: `git diff --stat apps/dispatch/CLAUDE.md` shows a 1-line addition.
- **SATISFIES**: AC #7

---

### VERIFY the change surface is exactly what was planned

- **IMPLEMENT**: Confirm the diff touches **only**: root `package.json` (the override) · `pnpm-lock.yaml` ·
  `apps/dispatch/package.json` · `apps/dispatch/CLAUDE.md` · the two new config files · the four new test
  files · **one line** of `apps/dispatch/src/app/t/[token]/page.tsx`. The spike's final `git status` was
  exactly this set — anything extra needs a reason.
- **PATTERN**: the Non-Goals section — this suite pins current behavior, with one carved-out exception.
- **IMPORTS**: n/a
- **GOTCHA**: if a test could only be made to pass by editing a component **other than the one-line retry
  href**, **stop** and treat it as a finding to report — not a second exception. One documented deviation is
  a judgment call; two is scope creep.
- **VALIDATE**:
  ```bash
  # must be EMPTY:
  git diff --stat -- apps/dispatch/src/features/tracking/states.tsx \
                     apps/dispatch/src/features/tracking/tracking-map.tsx \
                     'apps/dispatch/src/app/t/[token]/data/route.ts' \
                     'apps/dispatch/src/app/t/[token]/layout.tsx'
  # must be exactly 1 insertion / 1 deletion:
  git diff --stat -- 'apps/dispatch/src/app/t/[token]/page.tsx'
  ```
- **SATISFIES**: AC #8

---

## TESTING STRATEGY

The deliverable *is* tests, so "testing strategy" here means: what the seed suite must be able to catch.

### Unit Tests

Four files, all vitest + RTL in jsdom (except the route handler, node). Explicit vitest imports, no globals.
Every `it` title carries `(expected)` / `(edge)` / `(failure)`. Fixtures mirror
`packages/shared/tests/tracking.test.ts`. Leaflet is structurally stubbed; `fetch` is stubbed per test with
plain object literals.

### Integration Tests

None, deliberately. Real-browser and cross-process behavior stays with the manual E2E documented in #63's
plan and (later) with whatever #18 needs. Adding Playwright here is an explicit Non-Goal.

### Edge Cases

Each edge case below **names where it is verified** — the discipline the system review added to this skill,
and the exact thing whose absence let M1 evaporate:

| Edge case | Verified in |
|---|---|
| Stale GPS: silent driver, ticking ride record → position line keeps the position's own time | `tracking-live.test.tsx` — "keeps stamping the position's OWN recorded time after a poll" **+ mutation check L4.1** |
| Terminal ride → polling stops (no battery/API burn) | `tracking-live.test.tsx` — "(edge)" terminal-state test |
| Poll returns 410 mid-session → expired notice via `role="status"` | `tracking-live.test.tsx` — "(failure)" |
| API down at SSR → retry control present **and named from the catalog** | `tracking-page.test.tsx` — "(failure — M2)" **+ mutation check L4.2** |
| `?lang` unknown / array-valued → normalizes to `lv` / first value | `tracking-page.test.tsx` — "(edge)" `langFrom` |
| 404 / 410 at SSR → the right catalog heading | `tracking-page.test.tsx` — "(failure)" |
| Path-traversal-shaped token → local 404, zero API cost | `tracking-data-route.test.ts` — "(failure)" |
| API unreachable from the proxy → 502 | `tracking-data-route.test.ts` — "(edge)" |
| A state mapped to the wrong catalog key (compiles fine) | `states.test.tsx` — distinctness "(edge)" |
| Timezone drift between CI (UTC) and dev (Europe/Riga) | every time assertion derives its expected string via `toLocaleTimeString`; no literals |

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness.

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --filter @taxi/dispatch
```
Covers `vitest.config.ts`, `vitest.setup.ts` and all four test files — `tsconfig.json`'s
`include: ["**/*.ts", "**/*.tsx"]` pulls them in, and the app's bare `eslint` lints the whole cwd.

### Level 2: Unit Tests

```bash
pnpm turbo run test --filter @taxi/dispatch
```
Direct `pnpm --filter @taxi/dispatch test` works **only** with a warm `@taxi/shared` dist — prefer the turbo
form, which honours `dependsOn: ["^build"]`.

### Level 3: Integration Tests — the real gate

```bash
docker compose up -d --wait
REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force
```
This is CI parity, not `pnpm check` (which omits `build` and rides a warm `dist`). `--force` and
`REDIS_TEST_URL` are both required: without the env var, five Redis-backed suites `describe.skip` and the gate
is silently short. Port **6381** per this machine's local port conflicts (6379 is taken); CI uses 6379.

**Read the output, not just the exit code**: it must contain a `@taxi/dispatch:test` line. A suite that exists
but is never invoked is precisely the failure this ticket removes.

### Level 4: Manual Validation — **mutation checks** (the step that proves the suite has teeth)

A green suite proves nothing if it would also be green against the bug. Perform both, revert both.
**Both were run in the spike and each failed exactly one test** — no collateral, no vacuous passes — so a
result other than "1 failed | 4 passed" means something drifted:

1. **M1** — in `tracking-map.tsx:251`, change
   `{ time: timeOf(new Date(view.position.at)) }` → `{ time: timeOf(lastSeenAt ?? new Date(view.updatedAt)) }`
   (the shape of the shipped bug). Run `pnpm turbo run test --filter @taxi/dispatch`.
   **Expect: the stale-GPS test FAILS.** Then `git checkout -- apps/dispatch/src/features/tracking/tracking-map.tsx`.
2. **M2** — in `page.tsx:117`, replace `{formatMessage(lang, 'page.retry')}` with `{'↻'}` (the shape of the
   shipped bug). Run the suite. **Expect: the M2 test FAILS.** Then `git checkout -- 'apps/dispatch/src/app/t/[token]/page.tsx'`.
3. Confirm `git status` is clean of source edits before committing (`git diff --stat` over `src/`).

If either mutation leaves the suite green, the corresponding test is decorative — fix the test, not the
mutation. Record both results in the execution report.

### Level 5: Additional Validation (Optional)

```bash
# Confirm no accidental turbo.json / CI drift
git diff --stat turbo.json .github/workflows/ci.yml   # expect empty

# Confirm the pins actually resolved as intended (Node-20 constraint)
pnpm ls --filter @taxi/dispatch --depth 0 | grep -E "jsdom|jest-dom|vitest|testing-library"
node -v   # expect v20.x — if this machine has moved to Node 22+, see OPEN QUESTIONS
```

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — `apps/dispatch` has a working vitest + jsdom + RTL setup: five pinned devDependencies,
      `vitest.config.ts`, `vitest.setup.ts`, and `"test": "vitest run"` in `package.json`.
- [ ] **AC #2** — The CI-parity gate **invokes** it: `pnpm turbo run typecheck lint test build --force` output
      contains a `@taxi/dispatch:test` task line and is green. No `turbo.json` or `ci.yml` change was needed.
- [ ] **AC #3** — `states.test.tsx` covers `statusLine` (all states × all languages, distinctness) and
      `StatusScreen`, with expected/edge/failure titles.
- [ ] **AC #4** — `tracking-live.test.tsx` covers the island with expected/edge/failure **and** contains the
      poll-discriminating stale-GPS test (same `position.at`, newer `updatedAt`, timers advanced past one poll).
- [ ] **AC #5** — `tracking-page.test.tsx` covers the page's 200 / 404 / 410 / api-down branches and `langFrom`
      normalization; `tracking-data-route.test.ts` covers the proxy's proxy/guard/unreachable cases (or is
      dropped with a written reason).
- [ ] **AC #6** — **Both mutation checks fail the suite** (Level 4 steps 1 and 2), demonstrating the two PR #83
      Mediums are now regression-pinned. Results recorded in the execution report.
- [ ] **AC #7** — `apps/dispatch/CLAUDE.md` records the runner in one line.
- [ ] **AC #8** — Source changes are **exactly one line**: the `page.tsx` retry `href`. `git diff --stat` over
      `states.tsx`, `tracking-map.tsx` and `data/route.ts` is **empty**; over `page.tsx` it is
      **1 insertion, 1 deletion**. The change is called out in the PR body and the execution report.
- [ ] **AC #9** — No regressions: every other workspace's tasks stay green in the same `--force` run.
- [ ] Node-20 dependency pins hold (`jsdom ^26.1.0`, `@testing-library/jest-dom ~6.9.1`, `vitest ^3.0.0`).

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] Phase 1 gate run performed **before** writing the rest of the suite
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (`--force`, with `REDIS_TEST_URL`)
- [ ] No linting or type checking errors
- [ ] Both mutation checks confirmed red, then reverted
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability
- [ ] PR body carries `Closes #88` and notes that #18 is now unblocked

---

## OPEN QUESTIONS / ASSUMPTIONS

**Assumptions this plan makes:**

1. **`apps/admin` is deliberately excluded.** The workspace still exists on disk (`apps/admin/**`, a bare
   Next.js scaffold with no `src/features/`), but #18's re-slice states *"apps/admin workspace retires;
   #20's scope becomes `/admin` routes inside this app."* Wiring a runner into a workspace slated for
   deletion is churn. **If that decision has been reversed**, admin needs the same five-line treatment — say
   so before executing.
2. **Node stays at 20** for this ticket. Every dependency pin above is a consequence of that
   (`jsdom@30` and `jest-dom@7`/`6.10` all require Node ≥22, and `ci.yml` pins `node-version: 20`). If the
   repo moves to Node 22 later, these three pins can float — worth a one-line note in the PR so the next
   person knows the pins are dated, not arbitrary.
5. **React 19.2.4 is safe for the Expo apps.** Task 0's override bumps `apps/rider`/`apps/driver` from
   19.2.3 → 19.2.4 (a patch within 19.2.x) and **removes** a peer violation those apps already had. The spike
   verified `typecheck` stays green for both, and `build` for admin/dispatch. **What it did not verify is
   Expo runtime** — no simulator was launched. Residual risk is low but non-zero: Expo SDK 57 pins React
   versions, which is why the boot check is folded into **Task 0's VALIDATE** rather than left as a
   pre-merge note — discovering it there costs one re-install; discovering it after the suite is written
   costs a second install and gate run.
   **If Expo objects, the fallback is to align in the other direction** — override to `19.2.3` and let
   dispatch/admin follow. The finding is that *one instance* matters, not which version wins.
   Note the fallback is **not** "scope the override to the web apps": `pnpm.overrides` is workspace-global,
   and its `>pkg@version` selector constrains which *dependency edge* is rewritten, not which workspace
   package the rule applies to. There is no per-workspace-package override; don't burn time looking for one.
3. **The Leaflet map itself is out of test scope.** The div is `aria-hidden="true"` and the plan's own comment
   names the `<p>` beside it as the text alternative; a structural stub is therefore the honest boundary, and
   real map behavior remains a manual/E2E concern.
4. **The seed suite pins current behavior, including behavior nobody has re-litigated** — e.g. the offline
   banner's poll-clock timestamp (correct: it reports API contact, not GPS freshness). If a test surfaces
   behavior that looks wrong, report it rather than changing it.

**Questions that would change the plan if answered differently:**

- Should the route-handler test (`tracking-data-route.test.ts`) be in scope at all? #88 names *"states/map
  components"*. The plan includes it because the `..`-token guard is a genuine failure case costing one
  docblock — with an explicit escape hatch (drop it if it needs more than that). If you'd rather keep the
  ticket strictly to its letter, cut that one file; nothing else depends on it.
- Is a jsdom-level suite sufficient for **#18**? For #63's two components, yes. #18's socket
  reconnect/backoff and snapshot-on-reconnect resync may eventually want a real browser. That is a decision
  for #18's own plan — this ticket installs the layer that must exist first either way, and choosing vitest
  now does not preclude adding Playwright later for the cases that need it.

---

## NOTES (open canvas)

### Why vitest + RTL, not Playwright CT — settled, with the discriminating facts

The ticket left the choice open ("pick vitest+RTL or Playwright CT"). Three facts decide it:

| | vitest + RTL | Playwright CT |
|---|---|---|
| Monorepo fit | `packages/shared` and `db` already run `vitest@3.2.7` with `"test": "vitest run"` — same runner, same idiom, one version | a second, unrelated runner in a 9-package workspace |
| CI cost | zero new steps; `ci.yml` untouched | needs `playwright install --with-deps` added to `ci.yml` + ~400 MB browser download per run, against a **<€100/mo budget guardrail** |
| Does anything need a real browser? | no — the map div is `aria-hidden="true"`; the *text alternative* is the tested surface, and both Mediums (a timestamp string, an accessible name) are pure DOM assertions | its one advantage (real layout/geometry, i.e. Leaflet) is precisely the part the components declare untestable-by-design |

Playwright CT is also still officially experimental. Nothing here forecloses adding it later for #18's
reconnect scenarios if jsdom proves insufficient — but paying its cost *now*, for two components, would be
buying the wrong tool first.

### Why no `@vitejs/plugin-react`

`@vitejs/plugin-react@6` peers on `vite ^8`; vitest 3 peers on `vite ^5 || ^6 || ^7`. Installing the plugin
either forces vitest 4 (forking this app off the workspace's 3.2.7) or pins the plugin back to 4.x. Neither
is necessary: the plugin's job is Fast Refresh + optional Babel passes, and a test run needs neither. Vite's
esbuild compiles `.tsx` with the automatic JSX runtime; `esbuild: { jsx: 'automatic' }` states it explicitly
rather than relying on tsconfig discovery. **One fewer dependency, one fewer version conflict.**

### Why no `turbo.json` change (despite the ticket saying "mind `dependsOn: ["^build"]`")

The ticket's warning is well-aimed but already satisfied: root `turbo.json` declares

```jsonc
"test": { "dependsOn": ["^build"] }
```

and turbo runs a package's `test` script whenever one exists. So adding the script *is* the wiring, and
`^build` already guarantees `@taxi/shared`'s `dist` is fresh before dispatch's tests import it. The trap the
ticket is pointing at is real, though — it's just that falling into it now would mean **adding** redundant
config, so the plan makes "verify, don't edit" an explicit task.

### The one thing that would make this ticket worthless

A suite that passes against the bugs it claims to prevent. The M1 test is the sharp case: the obvious version
(render with an old `position.at`, assert the time) is **green against both implementations**, because
`lastSeenAt` is `null` before the first poll and the buggy code fell back to `view.updatedAt` — which, on
first render, happens to equal the truth. Only a poll that returns the *same position* with a *newer*
`updatedAt`, with the system clock moved forward, separates them.

That is why Level 4 is mutation checks rather than a click-through. It is the cheapest possible proof that
the enforcement layer enforces — and it directly answers the system review's diagnosis: *"A plan edge case
with no named verification step silently evaporates."* Here every edge case names its verification, and the
two that mattered most name a falsification step on top.

### Sequencing / risk — what the spike actually taught

The plan's risk model was **right in shape and wrong in target**. It correctly identified "toolchain interop"
as the thing that could sink a one-pass run, and correctly built a Phase 1 boundary to hit it early. But the
specific risk it named and pre-wrote an escape hatch for — the **CJS `@taxi/shared` dist** inlined by a
Vite-based runner — simply worked, first try, no config. Meanwhile the two things that *did* break were both
absent from the plan:

- **dual React instances** (`node-linker=hoisted` + a 19.2.3/19.2.4 skew), which failed 9 of 17 tests and
  cannot be fixed from `vitest.config.ts` at all; and
- **`<a href="">` exposing no `link` role**, a live a11y defect in already-shipped, already-reviewed code.

Neither was reachable by reading files carefully — the first needs a resolver, the second needs an
accessibility tree. Both took minutes to find by running. The generalizable lesson, worth carrying into the
next plan whose confidence rests on interop: **a pre-written escape hatch is a guess with good posture.**
Spending ten minutes in a throwaway worktree converts the guess into a fact and, more valuably, surfaces the
risks you didn't think to guess about.

Second-order risk, unchanged and now verified: RTL cleanup with `globals: false` fails *late and confusingly*
(multiple-element errors in whichever test runs second), which is why `afterEach(cleanup)` is called out as
load-bearing rather than left to boilerplate instinct.

The phase boundary is only worth having if it exercises the surface it claims to de-risk — which is why the
smoke test renders `TrackingLive` rather than the simpler `StatusScreen`. `states.tsx` imports nothing but
`@taxi/shared`, so a `StatusScreen` smoke test would have left the leaflet CSS import, the dynamic
`import('leaflet')` and `vi.mock` hoisting to fail later, in Phase 2, with the boundary having proved
nothing about them. One terminal-state render covers all four risks at once.

Second-order risk: RTL cleanup with `globals: false`. It fails *late and confusingly* (multiple-element
errors in whichever test runs second), so `afterEach(cleanup)` is called out as load-bearing rather than
left to boilerplate instinct.

### Confidence

**9.8/10** for one-pass success — raised from 9.5 because the plan was **executed end-to-end in a throwaway
worktree before being finalized**, not merely reasoned about. The suite reached 17/17 and the gate 10/10 over
dispatch, admin, rider and driver. Every code block in this plan is transcribed from what passed.

That spike changed the plan materially rather than just confirming it. The 0.5 I had reserved for
"CJS-dist interop" turned out to be **spent on the wrong risk**: the CJS dist worked untouched, while two
things the plan never mentioned — a hoisted-pnpm dual-React instance that killed *every* render, and a
shipped `<a href="">` that is invisible to screen readers — were the actual blockers. Neither was findable by
reading; both took ten minutes to find by running. That is the argument for spiking before finalizing a plan
whose confidence claim rests on interop.

The remaining 0.2 is honest residual, not ritual: **Expo runtime under React 19.2.4** is the one thing the
spike could not settle without launching a simulator (see OPEN QUESTIONS #5), and the implementer's machine
may differ from the spike's in Node patch or lockfile state — which is why Phase 1's gate boundary stays even
though it is now expected to pass on the first try.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. -->

- **2026-08-11 — de-risking spike run before first execution; plan revised, confidence 9.5 → 9.8.**
  Executed the whole plan in a throwaway detached worktree at `80bd98c` (removed afterwards; the main
  working tree, which had another session's uncommitted work in it, was never touched). Outcome: 17/17 tests
  and 10/10 gate tasks green. Three classes of change:
  1. **Two blockers added as tasks.** (a) New **Task 0** — root `pnpm.overrides` pinning react/react-dom to
     19.2.4; without it `node-linker=hoisted` + the 19.2.3/19.2.4 skew gives dual React instances and *every*
     rendering test dies on `useState` of null (9/17 failed). `resolve.dedupe` was tried and does not work.
     (b) New **FIX task** — `page.tsx`'s retry `<a href="">` exposes no `link` role at all, so the API-down
     screen's only affordance is invisible to assistive tech; the a11y exception in Non-Goals is now a
     required one-line change, and AC #8 was rewritten from "no source changes" to "exactly one line".
  2. **Risk removed.** The `server.deps.external` escape hatch for the CommonJS `@taxi/shared` dist — the
     plan's single largest named risk — was verified **unnecessary**; the config task now forbids adding it
     speculatively. `resolve.dedupe` and a `css` option were likewise ruled out as dead config.
  3. **Claims upgraded from predicted to verified**, and a SPIKE VERIFICATION table added near the top:
     dependency pins on Node 20, no plugin-react, no `turbo.json` edit, the `@` alias, the leaflet CSS/mock
     path, `render(await TrackingPage(...))`, the node-env route tests, `afterEach(cleanup)` being
     load-bearing (proved by removing it), and both mutation checks failing exactly one test each. The
     timezone rule became decisive rather than theoretical: `09:00Z` renders as `10:00` locally
     (Europe/Riga), so a hardcoded literal would have passed CI and failed on the dev machine.
