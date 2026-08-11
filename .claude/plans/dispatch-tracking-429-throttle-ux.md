# Feature: the tracking page tells the truth about a 429

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## ⚠️ Branch state — read before you do anything

Your local `main` may be stale. At plan time it sat at `eb1fa3f`, **15 commits behind `origin/main`** (`5b3911e`),
and `apps/dispatch/package.json` in that checkout has **no `test` script**. Everything below assumes the
merged state of PR #96 (issue #88): **`apps/dispatch` already has vitest + RTL and four passing test files
under `src/features/tracking/`.** If you do not see `apps/dispatch/vitest.config.ts`, you are on the wrong
commit.

```bash
git fetch origin
git log --oneline -1 origin/main          # expect 5b3911e or later
```

**Work in a `git worktree`, branched from `origin/main`.** At plan time PR #101 was open and both `CLAUDE.md`
and `.claude/skills/piv-implement/SKILL.md` were modified in the shared checkout — a concurrent session is
live. In the worktree, run anything DB-touching (including the gate) with `COMPOSE_PROJECT_NAME=taxi`, or
`@taxi/db`'s pretest starts a second Postgres against the occupied 5432.

```bash
git worktree add ../taxi-100 -b feature/dispatch-tracking-429-ux origin/main
cd ../taxi-100 && cp ../taxi/.env .env && pnpm install
```

## Feature Description

`GET /track/:token` gained a token-scoped throttle in #94 — 120 requests per fixed 60 s window, answering
**429** with `{ message: 'too_many_requests', retryAfterSeconds }`. **No client in the monorepo handles that
status.** The result is a working guardrail that reads to the rider as a broken platform:

- **SSR** (`page.tsx:61-63`) branches 404 → not-found, 410 → expired, then `else if (!res.ok) failure =
  'api_down'`. A 429 on initial load renders the full-page **"connection lost"** screen.
- **The poll island** (`tracking-map.tsx:52`) degrades more honestly (`setOffline(true)`, last known data
  kept and stamped) but keeps polling at `POLL_MS = 5_000` with **no backoff** — so the `retryAfterSeconds`
  the API computes reaches nobody, and the page spends 12 requests a minute against a limit it has already hit.

This ticket gives the 429 its own honest failure state on both surfaces, and makes the island honor the
delay the API already computes.

## User Story

As a rider (or the friend they shared their trip link with)
I want the page to say "too many people are watching this ride" instead of "connection lost"
So that I don't call dispatch in a panic about a ride that is proceeding perfectly normally

## Problem Statement

The throttle works exactly as designed and the rider is told the platform is broken. Worse, the two failure
paths are actively counterproductive:

- The SSR "connection lost" screen's retry link is a **full reload**, which immediately spends another
  request against the same window the rider just exhausted.
- The island polls **through** the throttle at 5 s, so a page that has hit the limit keeps hitting it.

Share-trip (#17) reuses **one** token across viewers, so the budget is genuinely shared. Ten people opening
the shared link inside one window is 10 × 12 + 10 = **130** against a 120 budget, and every viewer — not
just the tenth — then sees the banner intermittently as the fixed window rolls.

## Solution Statement

Three surgical edits and one docblock correction:

1. **One new catalog key** — `page.too_many_viewers` in LV/RU/EN, placeholder-free so both surfaces can use it.
2. **`page.tsx`** — a `res.status === 429` branch placed **above** `!res.ok`, rendering the existing
   `StatusScreen` with the new key. A dead-end notice, exactly like `not_found` and `expired`, and
   deliberately with **no retry control**: a retry link here spends another request against the live window.
3. **`tracking-map.tsx`** — a 429 branch that parses `retryAfterSeconds` out of the body, pauses the poll
   until it elapses (via a **ref**, not state), and shows the same catalog string in the existing banner
   instead of "connection lost". Last known data is kept, exactly as today.
4. **`notifications.policy.ts`** — the docblock bullet that currently asserts "It does NOT break visibly. NO
   client in the monorepo renders a 429" becomes false the moment this ships. Replace exactly that bullet.

The proxy (`data/route.ts`) already forwards status **and body** verbatim, so the 429 body reaches the
island unchanged. **No behavioral change there** — but we add one test pinning it, because the entire
backoff depends on that body surviving the hop.

## Out of Scope / Non-Goals

- **Not included: the L4 env-schema item from the issue's "Also noted here" section.** `MAPS_ETA_FAILURE_TTL_SECONDS`
  → `.nonnegative()` is an API config concern with zero overlap with this client work, it sits under
  *"Also noted here (review finding L4, optional)"* rather than under `## Scope`, and the issue author
  already deferred it to *"the same pass as #13/#16"*. Bundling it makes the diff span two surfaces for no
  reason. **File it as its own issue before closing #100** so the note does not die with `Closes #100`
  (see OPEN QUESTIONS #1).
- **Not included: a `Retry-After` HTTP header on the API side.** The body already carries the value and the
  client already reads the body. Adding a header is a second, unread channel.
- **Not included: a shared zod schema for the 429 body.** See OPEN QUESTIONS #2 — verified: **no error body
  anywhere in this repo has a shared schema**, and adding one here would be inventing a pattern, not
  mirroring one. (`packages/shared/src/schemas/auth.ts:23`'s `resendAfterSeconds` is on
  `otpRequestResponseSchema` — a **200** body, not an error.)
- **Not included: a countdown, an auto-refresh, a `<meta http-equiv="refresh">`, or exponential backoff.**
  The API's window is a fixed 60 s and it tells us exactly how much of it is left. One pause of that length
  is the whole mechanism.
- **Not included: `too_many_viewers` as a `TrackingPageState`.** See GOTCHA — this is the tempting move and
  it is build-breaking.
- **Not changing: `data/route.ts` behavior**, the `api_down` screen, the offline banner's `{time}` fallback,
  the poll interval, or anything in `services/api` beyond one docblock paragraph.
- **Not changing: the rider or driver apps.** Neither reaches `/track/:token`.

## Feature Metadata

**Feature Type**: Enhancement (missing failure state + backoff)
**Estimated Complexity**: Low — four files touched, ~60 lines of source, ~90 lines of test. The runner,
the fixtures and the leaflet mock all already exist from #88.
**Primary Systems Affected**: `apps/dispatch` (tracking slice), `packages/shared` (one catalog key),
`services/api` (one docblock).
**Dependencies**: none new. No `package.json` change, no `pnpm install`, no `turbo.json` change.

## Related Work

**Implements**: [#100](https://github.com/linardsb/taxi/issues/100) — `Closes #100` in the PR body.
**Epic**: none directly. This is a **review-deferred follow-up**, not an epic slice: finding **M2** of
`.claude/code-reviews/pr-99-review.md`, explicitly filed rather than fixed in #99.

**Back-references** (plans this builds on or inherits decisions from):

- `.claude/plans/harden-maps-seam-spend-controls.md` — Why: the plan that **introduced** the throttle (#94/#99).
  Its NOTES (line 623) carry the "does not break visibly … tracked as #100" claim this ticket retires.
  Read its throttle-sizing arithmetic before touching the policy docblock.
- `.claude/code-reviews/pr-99-review.md` (lines 70-100) — Why: the exact wording of finding **M2**, including
  the "minimal fix" this plan implements almost verbatim (`page.too_many_viewers` + a poll delay).
- `.claude/plans/dispatch-test-runner-vitest-rtl.md` — Why: **the test conventions this ticket writes into.**
  Its "Patterns to Follow" section (fixture style, `(expected)/(edge)/(failure)` titles, "assertions
  reference the catalog never a literal", "derive time strings never hardcode") governs every test below.
- `.claude/plans/rider-comms-sms-tracking-page.md` — Why: #63's UX section defines the page's intended
  states and the breadboard this extends.

**Forward-references** (plans that extend or supersede this — append as follow-ups get created):

- (none yet) — the L4 spin-off issue lands here once filed.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

All line numbers are **at `origin/main` = `5b3911e`**.

- `apps/dispatch/src/app/t/[token]/page.tsx` (whole file, 195 lines) — Why: edit target #1.
  - lines 54-67: the fetch + failure branching. `failure` is an **inline union type on the `let`**, which is
    what Task 2 replaces with a named type.
  - lines 69-79: the `StatusScreen` branch you extend.
  - lines 80-121: the `api_down` screen — **leave it alone**. Note its retry `<a>` now points at
    `` `/t/${token}?lang=${lang}` `` (fixed in #96); it is no longer `href=""`.
  - lines 22-31: `params`/`searchParams` are **Promises**; `langFrom` normalizes `?lang`.
- `apps/dispatch/src/features/tracking/tracking-map.tsx` (whole file, 258 lines) — Why: edit target #2.
  - line 15 `POLL_MS = 5_000`; lines 16-20 `TERMINAL`; line 42 the `done` short-circuit.
  - **lines 44-62 — the poll effect you are changing.** Note the deps are `[token, done]`; the interval
    callback closes over the render that created it. This is why the pause must be a **ref**.
  - line 52 `if (!res.ok) return setOffline(true);` — the 429 branch goes **above** this line.
  - lines 56-58 the `catch` — anything that throws inside the try lands here and sets the offline banner.
    **This is the trap the body parse must not fall into.**
  - lines 130-146 the banner. Its `timeOf(lastSeenAt ?? new Date(view.updatedAt))` fallback is
    **poll-clock based on purpose** — it reports when *we* last heard from the API. Do not "fix" it.
  - lines 240-253 `page.position_updated` stamps `view.position.at`, the position's OWN recorded time
    (the **M1** contract from #88). Read the docblock — it is why a backoff is safe here (see NOTES).
- `apps/dispatch/src/features/tracking/states.tsx` (whole file, 55 lines) — Why: **the pattern Task 2
  mirrors.** `STATUS_KEY: Record<TrackingPageState, MessageKey>` at line 13 is exactly the shape the new
  `FAILURE_KEY` takes. `StatusScreen` (lines 33-55) is the component you render — `{ lang, message }`, an
  `<h1>` inside `<main lang={lang}>`.
- `apps/dispatch/src/app/t/[token]/data/route.ts` (whole file, 43 lines) — Why: **read it to confirm you do
  not need to change it.** Line 32-38 `new Response(await res.text(), { status: res.status, … })` forwards
  status and body verbatim. Task 6 adds a test, not an edit.
- `packages/shared/src/i18n.ts` (lines 15-42 for `lv`, 48-74 `ru`, 75-100 `en`) — Why: edit target #3.
  `lv` is the **reference dictionary** — `MessageKey` derives from it, and the `satisfies Record<Language,
  Record<MessageKey, string>>` at line 101 forces `ru`/`en` to carry the same keys or fail to compile.
- `packages/shared/tests/i18n.test.ts` (whole file) — Why: **read it so you do NOT add a redundant test.**
  Key parity, placeholder parity and non-emptiness across all three languages are already pinned.
- `services/api/src/features/notifications/notifications.policy.ts` (lines 58-104) — Why: edit target #4.
  The `TRACKING_VIEW_MAX_PER_WINDOW` docblock. **Only the "It does NOT break visibly" bullet (lines 93-99)
  changes.** The ~9-viewer arithmetic, the fixed-window ~240/60 s worst case, and the two other
  "what it does NOT do" bullets all stay true — do not rewrite them.
- `services/api/src/features/notifications/tracking/tracking.service.ts` (lines 214-238,
  `assertWithinRateLimit`) — Why: the **source of the contract you are consuming**. It throws
  `HttpException({ message: 'too_many_requests', retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS)`, where
  `retryAfterSeconds = Math.max(1, await this.kv.ttl(key))` against a 60 s TTL. That bounds the value to
  `[1, 60]` — which is why the client clamp below is insurance, not arithmetic.
- `apps/dispatch/src/features/tracking/tracking-live.test.tsx` (whole file, 141 lines) — Why: **the file you
  append to.** Reuse its `TOKEN`, `baseView`, `okJson`, `statusOnly`, the leaflet stub, and its
  `beforeEach`/`afterEach` (fake timers at `2026-08-11T09:30:00.000Z`, stubbed `fetch`). Do not re-declare any of them.
- `apps/dispatch/src/features/tracking/tracking-page.test.tsx` (whole file, 151 lines) — Why: the other file
  you append to. Note `renderPage()` (lines 44-60) awaits the async server component then flushes the
  island's dynamic `import('leaflet')` inside `act`. Reuse it.
- `apps/dispatch/src/features/tracking/tracking-data-route.test.ts` (whole file, 62 lines) — Why: Task 6
  appends here. Note the `// @vitest-environment node` docblock on **line 1** and the `call()` helper.
- `apps/dispatch/vitest.config.ts` + `vitest.setup.ts` — Why: read to confirm you need no config change.
  `include: ['src/**/*.test.{ts,tsx}']` already covers every file you touch; `afterEach(cleanup)` is wired.
- Root `CLAUDE.md` + `apps/dispatch/CLAUDE.md` — Why: the hard rules this ticket lives under —
  nothing user-facing hardcoded, ≥1 expected + 1 edge + 1 failure per feature, VSA, the UX/friction rules.
- `.claude/references/ui-decisions.md` — Why: where the copy question goes if you want to argue with the
  Latvian wording rather than debate it mid-ticket.

### New Files to Create

**None.** Every file this ticket touches already exists. If you find yourself creating a file, stop and
re-read the task.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN — HTTP 429 Too Many Requests](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429)
  - Section: the status semantics and `Retry-After`
  - Why: confirms 429 means "the server is fine, you are asking too often" — the exact distinction this
    ticket makes visible. Also confirms `Retry-After` is the *header* convention we are deliberately not
    adding (the body already carries it and the client already reads the body).
- [Vitest — `vi.advanceTimersByTimeAsync`](https://vitest.dev/api/vi.html#vi-advancetimersbytimeasync)
  - Section: advancing timers with async callbacks
  - Why: the backoff tests' whole mechanism. The poll callback is async, so `advanceTimersByTime` (sync)
    would not flush the fetch promise.
- [Vitest — `vi.useFakeTimers`](https://vitest.dev/api/vi.html#vi-usefaketimers)
  - Section: the default `toFake` list
  - Why: it **includes `Date`**, which is what makes `Date.now() < pausedUntil.current` testable at all.
- [React — `useRef`](https://react.dev/reference/react/useRef)
  - Section: "referencing a value with a ref" / refs are not reactive
  - Why: the justification for the pause being a ref — a `setInterval` closure reads the state value from
    the render that created it, so state here would silently never pause.
- [Testing Library — `getByRole` and the `name` option](https://testing-library.com/docs/queries/byrole#name)
  - Why: `getByRole('heading', { name: formatMessage(...) })` is how every assertion below pins
    "the string came from the catalog", per #88's discipline.

### Patterns to Follow

**One key per branch, typed as a Record** — mirror `states.tsx:13`, so a new failure member fails to
compile until it has catalog copy:

```ts
// apps/dispatch/src/features/tracking/states.tsx:13 — the pattern
const STATUS_KEY: Record<TrackingPageState, MessageKey> = {
  searching: 'page.searching',
  …
};
```

**Assertions reference the catalog, never a literal** (#88's M2 discipline — a literal cannot distinguish
catalog-sourced from hardcoded):

```ts
// ✅
screen.getByRole('heading', { name: formatMessage('lv', 'page.too_many_viewers') });
// ❌ never
screen.getByText('Šo braucienu šobrīd skatās pārāk daudzi.');
```

**Test titles end with `(expected)`, `(edge)` or `(failure)`** — every existing `it` in
`src/features/tracking/*.test.tsx` does.

**No vitest globals** — explicit imports, house style across the whole repo:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
```

**Fetch stubs are plain object literals with `as never`, not real `Response`s** — the component reads only
`.ok`, `.status` and `.json()`. This is the existing convention in both test files; keep it.

**Structured warn logs** — not engaged by this ticket (no new logging). `.claude/references/logging-standard.md`
only matters if you find yourself adding a log line; you should not.

---

## UX (breadboard · states · friction audit)

**Breadboard** — the new branch is marked `← NEW`; everything else already ships.

```
SMS link → [open] → /t/:token  (server-rendered)
  ├─ 200  → tracking page: status · driver card · ETA · map · [Zvanīt dispečeram]
  ├─ 404  → not-found notice          (dead end)
  ├─ 410  → expired notice            (dead end)
  ├─ 429  → too-many-viewers notice   (dead end)                          ← NEW
  └─ else → connection-lost screen → [Mēģināt vēlreiz] → /t/:token

tracking page → island polls /t/:token/data every 5 s
  ├─ 200     → refresh view, clear banner
  ├─ 404/410 → island replaced by the notice (terminal, no further polls)
  ├─ 429     → too-many-viewers banner + PAUSE ≤ 60 s → resume automatically  ← NEW
  └─ else    → connection-lost banner, last known data kept and stamped, keep polling
```

**States**

| State | What renders |
|---|---|
| Loading | none — the page is server-rendered; there is no client-side first paint to spin over |
| Empty | n/a — a token either resolves to a ride or 404s |
| Error (429, SSR) | `StatusScreen` + `page.too_many_viewers`. **No control** — see friction audit |
| Error (429, island) | `role="alert"` banner + `page.too_many_viewers`, over the last known view. Self-heals |
| Error (other) | unchanged: `api_down` screen with retry; offline banner on the island |
| Offline | unchanged — `page.connection_lost` with the last-heard-from time |

**Friction audit.** Intent → done stays **1 tap** (open the SMS link); the 429 branch adds **zero** decisions
to the happy path. On the island it costs **0 taps** — the pause expires and polling resumes on its own. On
SSR it costs **1 manual reload**, and that reload is deliberately *not* automated: an auto-refresh (or a
retry link) spends another request against the very window the rider has already exhausted, which is the
exact defect this ticket exists to fix. One unavoidable tap beats a control that makes the problem worse.

**Touch targets / focus.** No new interactive elements. The SSR 429 screen has none, matching the shipped
`not_found` / `expired` screens, so the ≥44 px and visible-focus rules are not newly engaged. The island
banner is non-interactive text.

**Screen reader.** The SSR notice reuses `StatusScreen`'s `<h1>` inside `<main lang={lang}>` — announced on
page load like any heading. The island banner reuses the existing `role="alert"` element, so the switch from
nothing → throttled is announced once, assertively. `lang` is already set on both surfaces, so LV/RU text is
pronounced with the right voice.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation — the contract string

The one thing both surfaces depend on. It is also the only change that touches `packages/shared`, so landing
it first means the two client edits typecheck from the start rather than against a key that does not exist yet.

**Tasks:**

- Add `page.too_many_viewers` to the LV/RU/EN catalogs.

### Phase 2: Core Implementation — the two client edits

**Depends on:** Phase 1 (both edits reference the new `MessageKey`).

The SSR branch and the island branch are **independent of each other** — they touch different files and
share nothing but the catalog key. Do them in either order; there is no parallelism worth a second worktree
at this size.

**Tasks:**

- `page.tsx` — named `Failure` type, `FAILURE_KEY` record, the 429 branch above `!res.ok`, `StatusScreen`
  for every non-`api_down` failure.
- `tracking-map.tsx` — `throttlePauseMs` helper, `pausedUntil` ref, the 429 branch above `!res.ok`,
  `offline: boolean` → `degraded: 'offline' | 'throttled' | null`, banner text switch.

### Phase 3: Testing & Validation

**Depends on:** Phase 2.

**Tasks:**

- Append the SSR 429 case to `tracking-page.test.tsx`.
- Append the backoff pin + the unreadable-body edge case to `tracking-live.test.tsx`.
- Append the proxy-forwards-429 pin to `tracking-data-route.test.ts`.
- Run the full CI-parity gate.
- **Mutation-check the backoff pin** — the step that proves the suite has teeth.

### Phase 4: Documentation truth-up

**Depends on:** Phase 2 (the docblock must describe what actually shipped, not what was planned).

**Independent of:** Phase 3 — but do it *after* the gate, so what you write is what you have seen run.

**Tasks:**

- Replace the one false bullet in `notifications.policy.ts`.
- Append a forward-reference to `.claude/plans/harden-maps-seam-spend-controls.md`.
- File the L4 spin-off issue.

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

### Task 1 — ADD `page.too_many_viewers` to `packages/shared/src/i18n.ts`

- **IMPLEMENT**: One entry per language, inserted directly after `'page.not_found'` in each of the three
  blocks so the three lists stay in the same order:
  ```ts
  // lv (the reference dictionary — MessageKey derives from it)
  'page.too_many_viewers': 'Šo braucienu šobrīd skatās pārāk daudzi.',
  // ru
  'page.too_many_viewers': 'Сейчас эту поездку смотрят слишком многие.',
  // en
  'page.too_many_viewers': 'Too many people are viewing this ride right now.',
  ```
- **PATTERN**: `packages/shared/src/i18n.ts:36-37` — `'page.expired'` / `'page.not_found'` are bare
  statements of fact with no remedy clause and no placeholder. This key matches that house style
  deliberately: it is the only phrasing that is true on **both** surfaces (the SSR dead end, where nothing
  will auto-update, and the island, where it will).
- **IMPORTS**: n/a
- **GOTCHA**: **no placeholder.** A `{time}` or `{seconds}` would force the SSR branch to parse the 429 body
  for a value it has nothing useful to do with, and would make the island's banner and the SSR notice
  diverge. Placeholder-free is what lets one key serve both.
- **GOTCHA**: add it to **all three** languages in the same edit. Omitting `ru` or `en` is a **compile**
  error (`satisfies Record<Language, Record<MessageKey, string>>` at line 101), not a silent gap — but the
  error points at the `MESSAGES` object, not the missing line, so it reads confusingly if you split the edit.
- **GOTCHA**: **do not add a shared test for this key.** `packages/shared/tests/i18n.test.ts` already pins
  key parity, placeholder parity and non-emptiness across all three languages, and totality is a compiler
  guarantee. A "the key exists" test duplicates both.
- **GOTCHA**: if the Latvian wording bothers you, **do not debate it here** — log it as
  `2026-08-11 · tracking page · is "Šo braucienu šobrīd skatās pārāk daudzi." the right register for a
  throttle notice?` in `.claude/references/ui-decisions.md` and move on. Root `CLAUDE.md` rule.
- **VALIDATE**:
  ```bash
  pnpm --filter @taxi/shared test        # i18n.test.ts must stay green — 3 languages, same key set
  pnpm --filter @taxi/shared typecheck
  ```
- **SATISFIES**: AC #3

---

### Task 2 — UPDATE `apps/dispatch/src/app/t/[token]/page.tsx`: a 429 branch that is not `api_down`

- **IMPLEMENT**: Three edits to one file.

  **(a)** Add `type MessageKey` to the existing `@taxi/shared` import:
  ```ts
  import {
    formatMessage,
    LANGUAGES,
    trackingViewSchema,
    type Language,
    type MessageKey,
    type TrackingView,
  } from '@taxi/shared';
  ```

  **(b)** Above `TrackingPage` (next to `API_URL`, module scope), name the failure union and map it:
  ```ts
  /**
   * What the SSR fetch can fail as. `api_down` is deliberately absent from the
   * map below: it is the only failure whose screen carries a retry control and
   * whose message takes a `{time}` placeholder.
   */
  type Failure = 'not_found' | 'expired' | 'too_many_viewers' | 'api_down';

  /**
   * One catalog key per failure, mirroring `states.tsx`'s STATUS_KEY — a new
   * member of `Failure` fails to compile until it has copy.
   */
  const FAILURE_KEY: Record<Exclude<Failure, 'api_down'>, MessageKey> = {
    not_found: 'page.not_found',
    expired: 'page.expired',
    too_many_viewers: 'page.too_many_viewers',
  };
  ```

  **(c)** Replace the inline union on the `let` and the branch ladder (lines 55-79):
  ```ts
    let view: TrackingView | null = null;
    let failure: Failure | null = null;
    try {
      const res = await fetch(
        `${API_URL()}/track/${encodeURIComponent(token)}`,
        { cache: 'no-store' }, // per-request freshness — this page is live data
      );
      if (res.status === 404) failure = 'not_found';
      else if (res.status === 410) failure = 'expired';
      // ABOVE `!res.ok`, or the throttle lands in `api_down` and the rider is
      // told the platform is broken while their ride is fine (#100).
      else if (res.status === 429) failure = 'too_many_viewers';
      else if (!res.ok) failure = 'api_down';
      else view = trackingViewSchema.parse(await res.json());
    } catch {
      failure = 'api_down';
    }

    // Every failure but `api_down` is a one-line dead end. No retry control on
    // the 429 screen ON PURPOSE: a reload spends another request against the
    // window the rider has already exhausted.
    if (failure !== null && failure !== 'api_down') {
      return (
        <StatusScreen
          lang={lang}
          message={formatMessage(lang, FAILURE_KEY[failure])}
        />
      );
    }
  ```
  Leave lines 80-121 (the `api_down` screen) and everything below **untouched**.

- **PATTERN**: `apps/dispatch/src/features/tracking/states.tsx:13-23` — `Record<…, MessageKey>` as the
  compile-pin between a state set and catalog copy. Same shape, one layer up.
- **IMPORTS**: only `type MessageKey` is new. `StatusScreen` and `formatMessage` are already imported.
- **GOTCHA — the branch order is the whole fix.** `429` must sit **above** `!res.ok`. Put it below and the
  code compiles, the tests you are about to write fail, and the bug is unchanged.
- **GOTCHA — do NOT add `too_many_viewers` to `TRACKING_PAGE_STATES`.** It is the tempting move and it is
  build-breaking twice over: `TRACKING_STATE_BY_STATUS` in `notifications.policy.ts` is
  `Record<RideStatus, Exclude<TrackingPageState, 'expired'>>` and there is **no ride status** to map to a
  throttle; and `states.test.tsx`'s distinctness test would then demand `STATUS_KEY` copy for something that
  is not a state at all. A 429 is a **failure branch** (like `api_down`), not a page state.
- **GOTCHA**: TypeScript narrows `failure` to `Exclude<Failure, 'api_down'>` after
  `failure !== null && failure !== 'api_down'`, so `FAILURE_KEY[failure]` indexes cleanly. If you get an
  index error, you wrote the guard differently — fix the guard, do not widen `FAILURE_KEY` to `Partial<…>`
  (that would let a member ship without copy, which is the entire point of the record).
- **GOTCHA**: the old `if (failure !== null || view === null)` guard on line 80 stays exactly as it is —
  it is what makes `view` non-null for the render below. But note your new early-return **changes what
  reaches it**: past that point `failure` can only be `'api_down'` or `null`, so the narrowing TypeScript
  does at line 80 is no longer the narrowing it did before. This is the one place your edit alters control
  flow that a later line depends on — let `tsc` confirm it rather than assuming.
- **VALIDATE**:
  ```bash
  pnpm turbo run typecheck lint --filter @taxi/dispatch
  # ^ specifically watch for an error on the `view` usage below line 80 — see the GOTCHA above
  ```
- **SATISFIES**: AC #1

---

### Task 3 — UPDATE `apps/dispatch/src/features/tracking/tracking-map.tsx`: honor `retryAfterSeconds`

- **IMPLEMENT**: Four edits to one file.

  **(a)** After `POLL_MS` (line 15), add the window constant and the total parse helper:
  ```ts
  /**
   * The API's tracking throttle uses a FIXED 60 s window
   * (`TRACKING_VIEW_WINDOW_SECONDS` — a constant in the API's guardrail file,
   * which this app cannot import: apps never reach into services/api). Used
   * twice below: the ceiling a `retryAfterSeconds` is clamped to, and the
   * delay applied when the 429 body cannot be read at all.
   */
  const THROTTLE_WINDOW_SECONDS = 60;

  /**
   * How long to pause polling after a 429. Deliberately TOTAL — it swallows
   * its own errors and always returns a number, because throwing here would
   * fall into the poll's `catch`, raise the offline banner, and silently drop
   * the backoff: the page would keep hammering a throttle that is working
   * exactly as designed.
   */
  async function throttlePauseMs(res: Response): Promise<number> {
    try {
      const body: unknown = await res.json();
      const seconds = (body as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds, THROTTLE_WINDOW_SECONDS) * 1000;
      }
    } catch {
      // Unreadable body — fall through to the full window.
    }
    return THROTTLE_WINDOW_SECONDS * 1000;
  }
  ```

  **(b)** Replace the `offline` boolean with a union, and add the pause ref (lines 35-40):
  ```ts
    const [degraded, setDegraded] = useState<'offline' | 'throttled' | null>(null);
    const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null);

    // A REF, not state: the interval callback closes over the render that
    // created it, so a state value would read stale and the pause would never
    // take effect — while a banner-only test still passed.
    const pausedUntil = useRef(0);
  ```

  **(c)** The poll effect (lines 44-62):
  ```ts
    useEffect(() => {
      if (done) return;
      const timer = setInterval(() => {
        void (async () => {
          if (Date.now() < pausedUntil.current) return;
          try {
            const res = await fetch(`/t/${token}/data`, { cache: 'no-store' });
            if (res.status === 410) return setFatal('expired');
            if (res.status === 404) return setFatal('not_found');
            // ABOVE `!res.ok`: a throttle is not an outage, and it is the one
            // non-OK status that tells us when to come back (#100).
            if (res.status === 429) {
              pausedUntil.current = Date.now() + (await throttlePauseMs(res));
              return setDegraded('throttled');
            }
            if (!res.ok) return setDegraded('offline');
            setView(trackingViewSchema.parse(await res.json()));
            setLastSeenAt(new Date());
            setDegraded(null);
          } catch {
            setDegraded('offline'); // keep showing the last known data, honestly stamped
          }
        })();
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [token, done]);
  ```

  **(d)** The banner (lines 130-146) — same element, same `role="alert"`, same styles, switched text:
  ```tsx
        {degraded !== null && (
          <p
            role="alert"
            style={{ /* …unchanged… */ }}
          >
            {degraded === 'throttled'
              ? formatMessage(lang, 'page.too_many_viewers')
              : formatMessage(lang, 'page.connection_lost', {
                  time: timeOf(lastSeenAt ?? new Date(view.updatedAt)),
                })}
          </p>
        )}
  ```

  Finally, extend the component docblock (lines 22-27) — it currently says "and the offline banner". Make it
  "the offline/throttled banner", one word, so the file's own summary stays true.

- **PATTERN**: the existing early-return ladder in the same callback (`410` → `404` → `!res.ok`) — the new
  branch is one more rung in the same shape, not a restructure.
- **IMPORTS**: `useRef` is **already imported** (line 12). Nothing new.
- **GOTCHA — ref, not state.** `setInterval` is created once per `[token, done]` change. A `pausedUntil`
  held in `useState` would be read from the closure of the render that armed the interval, i.e. always `0`,
  and the pause would never fire. The insidious part: the **banner** would still work, so a test that only
  asserts the banner text would pass against a completely broken backoff. This is why AC #2's test counts
  fetches (Task 5).
- **GOTCHA — `throttlePauseMs` must never throw.** `res.json()` on an empty or non-JSON 429 body rejects.
  If that rejection escapes, it lands in the poll's `catch`, sets `'offline'`, and leaves `pausedUntil` at
  its old value — the page keeps polling and the banner lies about why. The `try/catch` **inside** the
  helper is load-bearing; Task 5's edge test exists solely to pin it.
- **GOTCHA**: `Math.min(seconds, THROTTLE_WINDOW_SECONDS)` is insurance, not arithmetic —
  `tracking.service.ts:227` derives the value from `kv.ttl()` on a 60 s key, so it is already in `[1, 60]`.
  One `Math.min` is cheaper than reasoning about a future provider that returns 86400.
- **GOTCHA**: the interval keeps ticking during the pause; the guard just returns. Do **not** try to
  `clearInterval` and re-arm with a longer one — that re-enters the effect, complicates the deps, and buys
  nothing (an idle tick costs nothing).
- **GOTCHA**: `setDegraded(null)` on success is what clears the banner. Do not clear `pausedUntil` there —
  it is already in the past by definition if the poll ran.
- **GOTCHA**: `offline` is local state with no other reader — the rename touches only this file. Grep to
  confirm (`git grep -n "setOffline\|offline" apps/dispatch/src`) before you assume it.
- **VALIDATE**:
  ```bash
  pnpm turbo run typecheck lint --filter @taxi/dispatch
  git grep -n "setOffline" apps/dispatch/src        # expect NO output
  ```
- **SATISFIES**: AC #2, AC #4, AC #5

---

### Task 4 — ADD the SSR 429 case to `apps/dispatch/src/features/tracking/tracking-page.test.tsx`

- **IMPLEMENT**: One `it` inside the existing `describe('TrackingPage')`, reusing the file's `renderPage`
  helper and `statusOnly` stub:
  ```tsx
  it('shows the too-many-viewers notice on a 429, not the connection-lost screen (failure)', async () => {
    vi.mocked(fetch).mockResolvedValue(statusOnly(429) as never);
    await renderPage();

    expect(
      screen.getByRole('heading', {
        name: formatMessage('lv', 'page.too_many_viewers'),
      }),
    ).toBeInTheDocument();

    // The regression this pins: a 429 must NOT fall into the `api_down`
    // branch. Without this negative assertion the test would pass against an
    // implementation that renders the connection-lost screen too.
    expect(
      screen.queryByRole('link', { name: formatMessage('lv', 'page.retry') }),
    ).not.toBeInTheDocument();
  });
  ```
- **PATTERN**: `tracking-page.test.tsx:124-141` — the existing 404/410 test. Same `getByRole('heading', …)`
  + catalog-derived name shape.
- **IMPORTS**: none new — `formatMessage`, `screen`, `vi`, `statusOnly` and `renderPage` are all already in
  the file.
- **GOTCHA**: the **negative** assertion is what makes this discriminating. `getByRole('heading', …)` alone
  passes if both screens somehow render.
- **GOTCHA**: `statusOnly(429)` returns `{ ok: false, status: 429, json: async () => ({}) }`. The SSR path
  never reads the body, so that is honest. Do not add a `retryAfterSeconds` to it — you would be stubbing a
  field the code under test does not touch.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch`
- **SATISFIES**: AC #1, AC #6

---

### Task 5 — ADD the backoff pins to `apps/dispatch/src/features/tracking/tracking-live.test.tsx` (**the point of this ticket**)

- **IMPLEMENT**: A local stub factory next to the existing `okJson`/`statusOnly`, then two `it`s inside the
  existing `describe('TrackingLive')`.

  Stub:
  ```tsx
  const throttled = (retryAfterSeconds: number) => ({
    ok: false,
    status: 429,
    json: async () => ({ message: 'too_many_requests', retryAfterSeconds }),
  });
  ```

  **Test 1 — the AC-bearing pin:**
  ```tsx
  it('pauses polling for retryAfterSeconds after a 429 instead of hammering (failure)', async () => {
    vi.mocked(fetch).mockResolvedValue(throttled(28) as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // SIX interval ticks have fired (5 s … 30 s). Exactly ONE spent a request:
    // the first got the 429 and paused until t=33 s. Without the backoff this
    // is 6 — which is the whole defect.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      formatMessage('lv', 'page.too_many_viewers'),
    );

    // …and it resumes on its own once the window the API named has passed.
    vi.mocked(fetch).mockResolvedValue(okJson(baseView) as never);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000); // t=35 s, past the 33 s pause
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  ```

  **Test 2 — the unreadable-body edge:**
  ```tsx
  it('still backs off when the 429 body cannot be parsed (edge)', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => {
        throw new SyntaxError('Unexpected end of JSON input');
      },
    } as never);

    render(<TrackingLive token={TOKEN} lang="lv" initial={baseView} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // The trap: a body parse that throws would land in the poll's catch, raise
    // the OFFLINE banner and leave pausedUntil untouched — polling on at 5 s
    // and lying about why. Both assertions are needed to catch that.
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      formatMessage('lv', 'page.too_many_viewers'),
    );
  });
  ```

- **PATTERN**: `tracking-live.test.tsx:112-127` — the existing "never polls once terminal" test already
  asserts on the fetch **call count** under advanced fake timers. Same mechanism, opposite direction.
- **IMPORTS**: none new. The file already imports `act`, `render`, `screen`, `formatMessage`, `vi`, and
  arms `vi.useFakeTimers()` + `vi.stubGlobal('fetch', …)` in `beforeEach`.
- **GOTCHA — read this twice.** A test that returns 429 and asserts only the banner text **passes against an
  implementation that still fetches every 5 s**. The deliverable of this ticket is "stops hammering", so the
  assertion that carries it is `toHaveBeenCalledTimes`. This is #88's M1 lesson applied to backoff: assert
  the behavior, not its cosmetic side effect.
- **GOTCHA — why `28` and not `30`.** `POLL_MS` is 5 000 ms. The first poll fires at t=5 s and pauses until
  t=33 s, which lands **between** ticks. A multiple of 5 (say 30 → pause until t=35 s) would land exactly on
  a tick and make the resume assertion depend on whether the guard is `<` or `<=`. 28 is boundary-independent
  and just as realistic — `kv.ttl()` returns whatever is left of the 60 s window, rarely a round number.
- **GOTCHA**: wrap every timer advance in `act(async () => …)`. Without it React 19 logs
  "An update to TrackingLive inside a test was not wrapped in act(...)" and the assertion may read
  pre-update DOM.
- **GOTCHA**: `advanceTimersByTimeAsync`, not `advanceTimersByTime` — the poll callback is async, and the
  sync variant fires the timer without flushing the fetch promise, so `fetch` looks uncalled.
- **GOTCHA**: `vi.useFakeTimers()` fakes `Date` by default (armed in the file's `beforeEach`). That is what
  makes `Date.now() < pausedUntil.current` advance with the timers at all. Do not add `toFake` options.
- **GOTCHA**: `queryByRole('alert')` for the *absence* assertion — `getByRole` throws when nothing matches.
- **VALIDATE**:
  ```bash
  pnpm turbo run test --filter @taxi/dispatch
  ```
  then the **mutation check** in VALIDATION Level 4 step 1 — the step that proves the pin has teeth.
- **SATISFIES**: AC #2, AC #5, AC #6

---

### Task 6 — ADD a 429-passthrough pin to `apps/dispatch/src/features/tracking/tracking-data-route.test.ts`

- **IMPLEMENT**: One `it` inside the existing `describe('GET /t/[token]/data')`:
  ```ts
  it('forwards a 429 with its body intact so the island can read retryAfterSeconds (edge)', async () => {
    const body = { message: 'too_many_requests', retryAfterSeconds: 28 };
    vi.mocked(fetch).mockResolvedValue({
      status: 429,
      text: async () => JSON.stringify(body),
    } as never);

    const res = await call(TOKEN);

    // The island's entire backoff depends on BOTH surviving this hop — the
    // route forwards `res.status` and the raw text, and this pins that it
    // keeps doing so.
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual(body);
  });
  ```
- **PATTERN**: `tracking-data-route.test.ts:32-45` — the existing "proxies a valid token through" test.
  Identical shape with a different status.
- **IMPORTS**: none new.
- **GOTCHA**: `data/route.ts` needs **no change** — it already does `new Response(await res.text(), { status: res.status, … })`.
  This is a **pin on existing behavior**, not a fix. If it fails, you changed something you should not have.
- **GOTCHA**: the file's first line is `// @vitest-environment node`. Keep your test inside the same file so
  it inherits that — `Response.json` in the route needs the node environment.
- **VALIDATE**: `pnpm turbo run test --filter @taxi/dispatch`
- **SATISFIES**: AC #6

---

### Task 7 — RUN the full CI-parity gate

- **IMPLEMENT**: no code. From the worktree root:
  ```bash
  COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait
  COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
    pnpm turbo run typecheck lint test build --force
  ```
- **PATTERN**: root `CLAUDE.md` — *"Done = `pnpm turbo run typecheck lint test build --force` green, never say-so."*
- **GOTCHA**: `COMPOSE_PROJECT_NAME=taxi` is **mandatory in a worktree** — compose names its project after
  the directory, so without it `@taxi/db`'s pretest starts a second Postgres against the occupied 5432.
- **GOTCHA**: set `REDIS_TEST_URL` to match your `REDIS_PORT` (6381 locally per `.env`). Without it the
  Redis-backed API suites `describe.skip` and a "green" gate is five tests short.
- **GOTCHA**: do **not** run `pnpm --filter @taxi/dispatch test` directly on a cold checkout — the app
  imports `@taxi/shared`, whose `main` points at `dist/index.js`. Go through turbo, which honors `^build`.
- **GOTCHA**: integration runs are mutually destructive across sessions (global-setup drops the shared test
  DB). One gate at a time — check no other session is mid-gate.
- **VALIDATE**: exit 0, and the output contains a `@taxi/dispatch:test` task line.
- **SATISFIES**: AC #7

---

### Task 8 — UPDATE the `TRACKING_VIEW_MAX_PER_WINDOW` docblock in `services/api/src/features/notifications/notifications.policy.ts`

- **IMPLEMENT**: Replace **exactly** the third "what it does NOT do" bullet (lines 93-99 at `5b3911e`):
  ```
   * - It does NOT break visibly. NO client in the monorepo renders a 429: the
   *   SSR page falls into its `api_down` branch and shows the full-page
   *   "connection lost" screen, and the poll island shows its offline banner and
   *   keeps polling at 5 s, so `retryAfterSeconds` currently reaches nobody. A
   *   rider who hits this is told the platform is down while their ride is fine.
   *   Tracked as #100; until it ships, this limit firing is INVISIBLE as a
   *   throttle and legible only in `ride.notifications.track_view_throttled`.
  ```
  with:
  ```
   * - It DOES break visibly, and as a throttle rather than an outage (#100).
   *   The SSR page has its own 429 branch above `!res.ok` and renders the
   *   `page.too_many_viewers` notice instead of the "connection lost" screen;
   *   the poll island renders the same string, keeps the last known data, and
   *   pauses for the `retryAfterSeconds` computed below rather than polling
   *   through the window. Neither surface shows a countdown or auto-retries —
   *   the island resumes on its own, the SSR screen is a dead end the rider
   *   reloads, deliberately: a retry control there would spend another request
   *   against the same window. Still logged as
   *   `ride.notifications.track_view_throttled` for correlation.
  ```
  The list header ("What it does NOT do, stated so the next reader does not assume otherwise:") now has one
  bullet that says what it DOES do — reword the header to "What it does and does not do, stated so the next
  reader does not assume otherwise:" and nothing else.
- **PATTERN**: commit `822bdcb` ("docs: correct the stale figures the #99 review round left behind") and
  PR #95 ("docs(api): correct the paid-call claims the #87 docblocks overstate) — this repo has twice had to
  correct a docblock that overstated. Write only what you have watched run.
- **IMPORTS**: n/a
- **GOTCHA — surgical.** The other two bullets (the concurrent-burst path, the unbounded-token-minting
  caveat), the ~9-viewer arithmetic, the fixed-window ~240-per-60 s worst case, and the closing "tune when
  the first Google bill exists" paragraph are all **still true**. Do not rewrite them, do not renumber, do
  not "tidy" the prose around your edit.
- **GOTCHA — do not overstate the fix.** The new bullet must not claim the page shows a countdown, retries
  automatically on SSR, or that the throttle is now user-friendly. Re-read it against the code you shipped
  in Tasks 2 and 3, line by line, before you commit. This is the third docblock correction on this file's
  neighborhood; make it the last.
- **VALIDATE**:
  ```bash
  pnpm turbo run typecheck lint test --filter @taxi/api     # docblock-only, must stay green
  git grep -n "NO client in the monorepo renders a 429" services/   # expect NO output
  ```
- **SATISFIES**: AC #6

---

### Task 9 — APPEND a forward-reference to `.claude/plans/harden-maps-seam-spend-controls.md`

- **IMPLEMENT**: In that plan's **Forward-references** list, add:
  ```markdown
  - `.claude/plans/dispatch-tracking-429-throttle-ux.md` — Why: retires this plan's "it does not break
    visibly: no client renders a 429" note (NOTES, line 623) by giving the 429 an honest state on both
    tracking surfaces (#100).
  ```
- **PATTERN**: the plan template's own Forward-references section — *"append as follow-ups get created"*.
- **GOTCHA**: **append a forward-reference; do not edit that plan's NOTES.** Plans are append-only history —
  line 623 was true when it was written, and rewriting it destroys the record of why #100 existed.
  `.claude/reports/harden-maps-seam-spend-controls-report.md:51` is an execution report: leave it entirely alone.
- **VALIDATE**: `git diff --stat .claude/plans/` — one file, one hunk, additions only.
- **SATISFIES**: AC #6

---

### Task 10 — FILE the L4 spin-off issue (before closing #100)

- **IMPLEMENT**:
  ```bash
  gh issue create \
    --title "api: MAPS_ETA_FAILURE_TTL_SECONDS has a code-level kill switch but no config-level one (#99 L4)" \
    --body "Deferred from #100, which shipped only the client half of the #99 review.

  \`CachingMapsProvider\` treats \`failureTtlSeconds: 0\` as \"disable the negative cache entirely\"
  (\`services/api/src/features/geo/caching-maps.provider.ts:205\`) and the \`quote\` facade uses exactly
  that. But \`MAPS_ETA_FAILURE_TTL_SECONDS\` in \`services/api/src/common/config/env.schema.ts:78-82\` is
  \`.positive()\`, so the \`eta\` facade's negative cache cannot be turned off from configuration — it
  needs a deploy.

  Fix: \`.nonnegative()\` on that one var, a docblock line stating that \`0\` disables it, and an
  \`env.schema.spec.ts\` case pinning the boundary on both sides (0 accepted, -1 refused).

  Unreachable today — \`mapsProviderSourceFactory\` (\`geo.module.ts\`) refuses to boot under
  \`NODE_ENV=production\`, so no real provider is bound. Worth doing in the same pass as #13/#16."
  ```
- **PATTERN**: how #100 itself was filed off #99's review — a "deferred from" preamble, the evidence
  inline, the reachability caveat at the bottom.
- **GOTCHA**: file this **before** the PR merges. `Closes #100` retires the only place this note lives.
- **GOTCHA**: `env.schema.spec.ts` uses **jest globals** (`services/api` runs `jest`, not vitest) — do not
  carry a vitest import convention into the spin-off ticket's body.
- **VALIDATE**: `gh issue list --limit 3` shows the new issue.
- **SATISFIES**: AC #8

---

## TESTING STRATEGY

The runner is **vitest 3 + jsdom + RTL 16** in `apps/dispatch` (installed by #88/PR #96), and **jest** in
`services/api`. This ticket writes only vitest tests — no API behavior changes.

### Unit Tests

Three files, all **appended to**, none created:

| File | Adds | Covers |
|---|---|---|
| `tracking-page.test.tsx` | 1 test | SSR 429 → `page.too_many_viewers` heading, **and no retry link** |
| `tracking-live.test.tsx` | 2 tests | poll pauses for `retryAfterSeconds`; pauses on an unparseable body |
| `tracking-data-route.test.ts` | 1 test | the proxy forwards 429 + body verbatim |

Each reuses its file's existing fixtures (`TOKEN`, `baseView`, `okJson`, `statusOnly`, the leaflet stub,
the `beforeEach`/`afterEach` timer + fetch lifecycle). Declaring a second copy of any of them is a mistake.

### Integration Tests

**None needed.** The API side already has them: `tracking.service.spec.ts:93-111` pins that the request past
the limit answers 429 with a positive `retryAfterSeconds`, and `tracking.integration.spec.ts` covers the
endpoint. This ticket changes no API behavior — only a docblock.

### Edge Cases

- **429 body is empty / not JSON** → `throttlePauseMs` falls back to the full 60 s window, banner still says
  "throttled", polling still pauses. (Task 5, test 2 — the trap the whole helper exists for.)
- **429 body has no `retryAfterSeconds`, or a non-number, or `0`, or negative** → same fallback. Covered by
  the same guard; the unparseable case is the one worth a test because it is the one that *throws*.
- **`retryAfterSeconds` absurdly large** → clamped to 60 s by `Math.min`. Not separately tested: it is one
  `Math.min` on a value the API bounds to `[1, 60]` by construction.
- **Pause expiry lands between interval ticks** → the poll resumes on the first tick after expiry, up to
  5 s late. Intended; pinned by Task 5's resume assertion.
- **The ride reaches a terminal state while paused** → nothing to do. `done` short-circuits the effect on
  the next successful poll, and no fetch fires meanwhile. Covered by the existing "never polls once terminal" test.
- **429 on SSR *and* the island** → they are independent code paths with independent tests; the SSR case
  never reaches the island (the page returns the notice before rendering `TrackingLive`).

---

## VALIDATION COMMANDS

Execute every command to ensure zero regressions and 100% feature correctness. Run from the **worktree**
root with `COMPOSE_PROJECT_NAME=taxi`.

### Level 1: Syntax & Style

```bash
pnpm turbo run typecheck lint --filter @taxi/dispatch --filter @taxi/shared --filter @taxi/api
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test                    # i18n catalog parity
pnpm turbo run test --filter @taxi/dispatch        # via turbo — honors ^build for @taxi/shared's dist
```

### Level 3: Full CI-parity gate

```bash
COMPOSE_PROJECT_NAME=taxi docker compose up -d --wait
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 \
  pnpm turbo run typecheck lint test build --force
```

Expect exit 0 with a `@taxi/dispatch:test` line in the output. Without `REDIS_TEST_URL` the Redis-backed
API suites skip and the gate is five tests short of honest.

### Level 4: Mutation checks — prove the pins have teeth

Both are **temporary edits you revert immediately**. A pin that cannot fail is decoration.

1. **The backoff pin.** In `tracking-map.tsx`, delete the single line
   `if (Date.now() < pausedUntil.current) return;` at the top of the poll callback. Re-run
   `pnpm turbo run test --filter @taxi/dispatch`.
   → **Both** Task 5 tests must fail with `expected 1, received 6`. If the banner assertions still pass,
   that is the point: the call-count assertion is the one doing the work. **Revert.**
   (One line out, one unambiguous failure. Do **not** mutate this by swapping the ref for `useState` — that
   edit touches three places, will not compile first try, and makes the result ambiguous.)
2. **The SSR branch order.** In `page.tsx`, move `else if (res.status === 429)` **below** `else if (!res.ok)`.
   → Task 4's test must fail on the heading query. **Revert.**
3. **The body-parse guard.** In `tracking-map.tsx`, remove the `try/catch` inside `throttlePauseMs`.
   → Task 5's test 2 must fail (the throw lands in the poll's catch, the alert says "connection lost", and
   the fetch count is 6). **Revert.**

Record the observed failure counts in the implementation report — a mutation check you did not run is a
claim, not a validation.

### Level 5: Manual validation (what a machine cannot check)

The full path is **not reachable end-to-end today** — `mapsProviderSourceFactory`
(`services/api/src/features/geo/geo.module.ts`) refuses to boot under `NODE_ENV=production`, and the dev
database has no tracking token (tokens are minted by the booking flow, not the seed). Do the two things that
*are* performable and say plainly that the third is not:

1. **Copy review.** Read all three new catalog strings aloud. LV is the working language — does
   "Šo braucienu šobrīd skatās pārāk daudzi." read as a status, not an accusation? If not, log it in
   `.claude/references/ui-decisions.md` rather than debating it.
2. **Forced 429, locally.** Temporarily drop `TRACKING_VIEW_MAX_PER_WINDOW` to `2` in
   `notifications.policy.ts`, boot the API and dispatch dev servers, and hit a real `/t/:token` page three
   times. Confirm: the third **load** shows the too-many-viewers notice (not "connection lost"), an already-open
   page shows the banner over its last known data, and the browser Network tab shows the poll **stop** for
   the pause and resume after. **Revert the constant.** This is the only way to see the feature work before
   a real provider is bound.
3. **Not performable:** a live shared-trip fan-out past 9 viewers against a real deployment. State this in
   the PR body rather than implying coverage you do not have.

---

## ACCEPTANCE CRITERIA

- [ ] **AC #1** — A 429 on initial page load renders a distinct notice (`page.too_many_viewers`), **not** the
      "connection lost" screen, and that screen carries **no** retry control.
- [ ] **AC #2** — After a 429 the poll island pauses for the `retryAfterSeconds` the API returned (clamped to
      the 60 s window) and then resumes on its own, without a reload.
- [ ] **AC #3** — `page.too_many_viewers` exists in the LV, RU and EN catalogs, is placeholder-free, and no
      user-facing string in the diff is hardcoded.
- [ ] **AC #4** — While throttled, the island keeps and displays the last known view, with
      `page.position_updated` still stamping the position's own recorded time.
- [ ] **AC #5** — A 429 whose body cannot be parsed still pauses the poll and still shows the throttled
      banner (never the offline one).
- [ ] **AC #6** — `notifications.policy.ts`'s docblock describes what actually renders; no doc, plan or
      comment in the repo still claims no client handles a 429.
- [ ] **AC #7** — `pnpm turbo run typecheck lint test build --force` is green with `REDIS_TEST_URL` set.
- [ ] **AC #8** — The L4 note survives `Closes #100` as its own filed issue.
- [ ] All three Level 4 mutation checks fail as predicted, and are reverted.
- [ ] No file outside `packages/shared/src/i18n.ts`, `apps/dispatch/src/features/tracking/*`,
      `apps/dispatch/src/app/t/[token]/page.tsx`, `services/api/src/features/notifications/notifications.policy.ts`
      and `.claude/` is modified (`git diff --stat`).

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task validation passed immediately
- [ ] All validation commands executed successfully
- [ ] Full test suite passes (unit + integration)
- [ ] No linting or type checking errors
- [ ] Level 4 mutation checks run, observed, reverted
- [ ] Manual validation steps 1 and 2 performed; step 3 declared unperformable in the PR body
- [ ] Acceptance criteria all met
- [ ] Code reviewed for quality and maintainability

---

## OPEN QUESTIONS / ASSUMPTIONS

1. **L4 is excluded — assumed, not asked.** The issue files it under *"Also noted here (review finding L4,
   optional)"* rather than under `## Scope`, and says *"Worth doing in the same pass as #13/#16."* This plan
   takes that at face value and spins it into its own issue (Task 10). **If you want it in this PR**, it is
   ~4 lines: `.positive()` → `.nonnegative()` on `MAPS_ETA_FAILURE_TTL_SECONDS`, a docblock line saying `0`
   disables the negative cache, and an `env.schema.spec.ts` case pinning `0` accepted / `-1` refused. Say so
   before Task 1 and it costs nothing to fold in; folding it in later means re-running the gate.

2. **No shared zod schema for the 429 body — decided on evidence, worth a reviewer's eye.** The hard rule is
   *"every cross-surface contract lives in `packages/shared`"*, and this body is arguably now one. Against
   that: **zero error bodies anywhere in this repo have a shared schema** (verified —
   `packages/shared/src/schemas/auth.ts:23`'s `resendAfterSeconds` sits on `otpRequestResponseSchema`, a
   **200** body). Adding one here invents a half-pattern, and for it to mean anything the API's throw site
   would have to be typed against it too — a second surface, in a client ticket. The residual risk is real
   but bounded: renaming `retryAfterSeconds` breaks `tracking.service.spec.ts:106-111` on the API side and
   Task 5's test on the client side. Both ends are pinned by tests, just not by types. **If a reviewer
   disagrees, the fix is a follow-up ticket that adds the schema and types both sides — not a widening of this one.**

3. **`THROTTLE_WINDOW_SECONDS = 60` is duplicated in the client.** `TRACKING_VIEW_WINDOW_SECONDS` lives in
   `notifications.policy.ts` and the app cannot import it (apps never reach into `services/api`, and the
   policy docblock argues deliberately that this guardrail belongs in code the API owns). A comment ties the
   two. Moving the constant to `@taxi/shared` would make it importable but would also make a spend guardrail
   editable from a package four surfaces consume — a worse trade. Flagged, not fixed.

4. **The Latvian copy is a first draft.** "Šo braucienu šobrīd skatās pārāk daudzi." is deliberately a bare
   statement, matching `page.expired` / `page.not_found`. If it reads wrong to a native ear, it goes in
   `ui-decisions.md`, not into a mid-ticket debate.

5. **Assumed: nothing else in the repo consumes `offline` from `tracking-map.tsx`.** It is component-local
   state with no export. Task 3's `git grep` confirms it before you rely on it.

## NOTES (open canvas)

**Why a backoff is safe on this page specifically.** Pausing polling for up to 60 s would normally introduce
exactly the dishonesty #88's M1 finding was about — a page showing old data as if it were fresh. It does not
here, because `page.position_updated` already stamps `view.position.at`, the position's **own** recorded
time, rather than the poll clock (`tracking-map.tsx:247-253`, and the M1 regression test pins it). A rider
looking at a paused page sees a timestamp that is honest about how old the position is, independent of when
we last spoke to the API. On a poll-clock-stamped page this backoff would be a bug; on this one it is free.
That is a nice illustration of an earlier ticket's discipline paying for a later ticket's simplicity.

**Alternatives weighed and rejected.**

| Option | Why not |
|---|---|
| Convert the poll to a self-scheduling `setTimeout` with a dynamic delay | The "textbook" backoff shape, and a bigger diff than the fix deserves: it moves the timer out of the effect's steady state, needs its own cleanup discipline, and re-opens the "does the interval re-arm on re-render" question the current `[token, done]` deps have already settled. A ref-gated interval is ~4 lines and testable with the same fake-timer mechanism the file already uses. |
| Exponential backoff on repeated 429s | The API's window is **fixed at 60 s** and it tells us exactly how much is left. Exponential backoff solves a problem (unknown recovery time) this endpoint does not have, and would leave the page stale long after the window cleared. |
| Auto-refresh the SSR 429 screen after `retryAfterSeconds` | Requires parsing the body server-side and a client mechanism (meta refresh or an island) on a screen that currently has neither. And it re-creates the defect the issue names: a machine that reloads into a live window. The rider reloading when *they* choose to spends at most one request. |
| Show `retryAfterSeconds` as a countdown | Needs a `{seconds}` placeholder, which forces the SSR branch to parse a body it otherwise ignores and makes the two surfaces' copy diverge. A rider who is told "43" does nothing different than a rider who is told "in a moment". |
| A new `TrackingPageState` member | Build-breaking twice (see Task 2's GOTCHA). 429 is a transport failure, not a ride state. |
| Reuse `page.connection_lost` for the throttled banner | The literal defect this ticket exists to fix, one layer down. |

**Diff shape, for the reviewer's expectations.**

```
packages/shared/src/i18n.ts                                    +3
apps/dispatch/src/app/t/[token]/page.tsx                       +20 −6
apps/dispatch/src/features/tracking/tracking-map.tsx           +40 −8
apps/dispatch/src/features/tracking/tracking-page.test.tsx     +16
apps/dispatch/src/features/tracking/tracking-live.test.tsx     +50
apps/dispatch/src/features/tracking/tracking-data-route.test.ts +16
services/api/src/features/notifications/notifications.policy.ts +11 −7   (docblock only)
.claude/plans/*.md                                             +4
```

If your diff is materially larger than this, something has been rewritten that should have been extended.

**One thing the issue got slightly wrong, for the record.** It says the poll island "degrades more honestly
… but keeps polling at `POLL_MS = 5_000` with **no backoff**, so the `retryAfterSeconds` the API computes
reaches nobody." True — but it understates the island's second problem: the island also shows *"Savienojums
zudis"* (connection lost), which is the same lie the SSR screen tells, just in a banner. Fixing the backoff
without fixing the banner text would leave the honesty half-done. Both are in scope here; the issue's Scope
bullet 2 only names the delay.

**Sequencing risk.** None material. The three source edits are independent of each other after Task 1, and
nothing here touches a migration, a socket contract, or the ride state machine. The one thing that would
hurt is starting from stale `main` — see the branch-state banner at the top.

## AMENDMENTS

<!-- Append-only. Newest at the bottom. Leave empty until this plan has been executed. -->
