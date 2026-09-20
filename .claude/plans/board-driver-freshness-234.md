# Feature: board driver freshness — render `lastSeenAt` so a dead stream stops looking like a live one (#234)

The following plan should be complete, but its important that you validate documentation and codebase patterns and task sanity before you start implementing.

Pay special attention to naming of existing utils types and models. Import from the right files etc.

## Feature Description

`apps/dispatch/src/features/board/board-state.ts:127` folds `lastSeenAt: event.at` into each driver on every `driver:location` event, and no production code in the board slice reads it back. Dina's board therefore renders **position and no freshness**.

The driver app streams a fix every 4 s whether or not the vehicle moves — the throttle is time-based (`apps/driver/src/features/location/fix-throttle.ts:9`, `MIN_FIX_INTERVAL_MS = 4_000`) and `distanceInterval` is `0` (`apps/driver/src/features/location/location-options.ts:20`), both deliberate so the fix stream doubles as the dark-detection heartbeat. A parked driver's pin does not move, so **a live stream and a dead one are pixel-identical on the board**.

This ticket gives the board a per-driver freshness state derived from `lastSeenAt`, rendered on an accessible, always-visible driver list.

## User Story

As **Dina, the dispatcher**
I want to **see, per driver, whether their app is still reporting**
So that **I ring the driver whose phone has gone silent instead of assuming the still pin means a parked car**

## Problem Statement

Three things are true at once and they compound:

1. **A silent driver looks parked.** Position without freshness cannot distinguish them.
2. **The one place `frame.drivers` reaches the DOM is unreadable to a screen reader and is hidden by default.** `frame.drivers` has exactly one consumer — `apps/dispatch/src/app/dispatch/page.tsx:266` → `BoardMap` — whose container carries `aria-hidden="true"` (`board-map.tsx:100`). The page's default view is `'zones'` (`page.tsx:50`), so the map is not even mounted until Dina clicks «Karte». `ZoneGrid` renders `frame.zones[].entries`, which carry no `lastSeenAt` and, being queue rows, omit any driver not in a zone queue.
3. **An `on_ride` driver who goes dark stays on the board indefinitely.** `markOfflineByServer` returns early at `services/api/src/features/drivers/drivers.service.ts:271` (`if (status !== 'online') return false;`) — deliberate, so a mid-ride app crash does not drop the driver off the ride and their last position keeps feeding the rider's tracking page. The consequence for the board is that the sweeper never removes them, `listOnline` applies no freshness filter of its own (`redis-driver-location.store.ts:233` — SMEMBERS plus GEOPOS/ZMSCORE, no cutoff), and the row sits there with an ever-ageing `lastSeenAt` and a green «Izpilda braucienu» label.

That third case is the one this ticket is really for, and it is stronger than the issue's own framing. For an `online` driver the board's silence is bounded — the sweeper marks them dark and drops them from the online set within `PRESENCE_DARK_AFTER_SECONDS + PRESENCE_SWEEP_INTERVAL_MS` = 60 + 15 = **75 s** of the last accepted fix (`derived`, from `driver-location.policy.ts:40,46`; the drivers slice states the same figure at `services/api/src/features/drivers/index.ts:16`). For an `on_ride` driver it is **unbounded**.

`cascade.ts:159-162` already names this class in prose — *"An app that stopped pinging while still marked online — backgrounded, permission revoked, a swallowed `ingest` — is unreachable outright and can still be named here"* — and nothing renders it.

## Solution Statement

1. **Promote `DRIVER_LOCATION_TTL_SECONDS` to `@taxi/shared`** (new `packages/shared/src/driver-presence.ts`), re-exported from `services/api/.../driver-location.policy.ts` so every existing api import site and `PRESENCE_DARK_AFTER_SECONDS` keep resolving unchanged. See **D1** below for why this, not a console-local literal.
2. **Add a pure `driverFreshness(nowMs, lastSeenAt)` derivation to `board-state.ts`**, returning a total `'live' | 'stale' | 'unknown'`, mirroring `isStale(nowMs, lastFrameAtMs)`'s shape (no clock of its own, caller passes time).
3. **Add a `DriverList` component to the board slice**, rendering `frame.drivers` as a real `<ul>` of rows: status dot (already labelled), name, phone, zone, and a **text** freshness label plus, for a stale row, an `mm:ss` silence age using `ride-queue.tsx`'s existing `ageOf` idiom. One `aria-live="polite"` summary line naming the silent drivers — it changes only when the *set* changes, so the announcement is the transition, never the tick.
4. **Render it always**, in the right-hand column between the view panel and `AlertsPanel`, so freshness survives the zones/map toggle. Update `console.map_alt`, whose current text points a screen-reader user at the zones view for the driver list — a claim that becomes wrong once the real list is elsewhere and always present.
5. **Retire the runbook's two now-false paragraphs** (AC #5).

## Out of Scope / Non-Goals

- **Not included: stale styling on the map pin.** The map subtree is `aria-hidden` and a pin restyle is shape/colour only, so it cannot satisfy AC #2 on its own and adds surface for no accessible gain. The always-visible list covers map view too. Defer until someone asks for it.
- **Not changing: `zones[].entries`.** Adding `lastSeenAt` there is an api + `packages/shared` schema change the issue's scope guard rules out, and zone entries are a queue, not a roster.
- **Not changing: matching / dispatch candidacy.** `driver-location.service.ts:106` already filters `findNearby` at `Date.now() - DRIVER_LOCATION_TTL_SECONDS * 1000`. This ticket is the human operator's read.
- **Not changing: the presence sweeper's `on_ride` carve-out** (`drivers.service.ts:257-271`). It is correct for the ride; the board rendering the consequence is the fix.
- **Not fixing: runbook step 6's `HH:MM` note (#224 D3).** That is the *tracking* page's `timeOf` (`tracking-map.tsx:178-182`), and the runbook already documents the limitation correctly at line 248.
- **Not adding: a sound alert for a driver going dark.** `AlertsPanel` owns the audible budget (ISA-18.2, the alarm is the edge); a silent driver is a condition to read, not an alarm to buzz. Revisit only with a real operator complaint.

## Feature Metadata

**Feature Type**: Enhancement (closes a rendering gap deferred from #141)
**Estimated Complexity**: Medium — one new component, one pure derivation, one constant promotion across two packages, three catalogs, two doc paragraphs.
**Primary Systems Affected**: `apps/dispatch` (board slice, dispatch page), `packages/shared` (new constant + i18n), `services/api` (re-export only, zero behaviour change), `docs/runbooks/driver-device-day.md`
**Dependencies**: none new

## Related Work

**Implements**: [#234](https://github.com/linardsb/taxi/issues/234) · **Epic**: #18 (Dina's console) / #19 (zones + cascade) — no separate architecture doc; the board's design decisions live as prose in `board-state.ts` and `realtime-events.ts`.

**Back-references**:

- `.claude/plans/driver-device-day-prep.md` — Why: #141's step 5 had to be re-pointed away from `/dispatch` because the board could not carry this signal. This ticket is that deferral.
- `.claude/plans/driver-app-auth-online-location.md` — Why: owns the 4 s fix cadence and the dark-detection contract this renders.

**Forward-references**: (none yet)

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `apps/dispatch/src/features/board/board-state.ts` (whole file, 208 lines) — Why: where the derivation goes. `isStale` at :171-173 and `pillFrom` at :182-200 are the exact shape to mirror — pure, `nowMs` passed in, no clock. `applyDriverLocation` at :111-131 is the write this ticket finally gives a reader.
- `apps/dispatch/src/features/board/ride-queue.tsx` (lines 61-71, 100-128) — Why: `ageOf(nowMs, requestedAt)` is the existing `mm:ss` age idiom — *"digits only, no words to translate"*. Reuse the shape; do not invent a second one.
- `apps/dispatch/src/features/zones/zone-grid.tsx` (lines 16-26, 34-50, 71-120) — Why: `DRIVER_STATUS_KEY` / `DRIVER_STATUS_COLOR` as compile-pinned `Record<DriverStatus, …>`, the `visuallyHidden` clip-rect idiom, and the `role="img"` + `aria-label` status dot. The new list reuses all four patterns. **`visuallyHidden` is defined locally in that file and is not exported** — restate it in the new file (a cross-slice import would break the slice boundary), and say so in a comment.
- `apps/dispatch/src/features/board/alerts-panel.tsx` — Why: the board slice's own panel shell (heading, `<ul>`, empty state) and its `aria-live` handling. Match its chrome so the new panel does not look bolted on.
- `apps/dispatch/src/app/dispatch/page.tsx` (lines 46-52, 240-270) — Why: the mount point. Note `view` state at :50 defaults to `'zones'`; the new panel must sit **outside** the `view ===` ternary at :263.
- `apps/dispatch/src/features/board/index.ts` — Why: the slice's public API; `DriverList` and `driverFreshness` are exported here or the page cannot reach them.
- `packages/shared/src/realtime-events.ts` (lines 176-183, 270-280) — Why: the `lastSeenAt` field declaration and the comment *"staleness is the client's presentation concern"* that Task 2 amends. `drivers[].lastSeenAt` is `z.string().datetime().nullable()`; the null case is real and must be handled.
- `services/api/src/features/drivers/location/driver-location.policy.ts` (lines 1-45) — Why: the constant's current home and the `PRESENCE_DARK_AFTER_SECONDS` comment that already argues for one number across surfaces.
- `services/api/src/features/drivers/drivers.service.ts` (lines 249-275, 319-331) — Why: proves the `on_ride` carve-out and the sweep cutoff. Read before restating either in a comment.
- `apps/dispatch/src/features/board/board-state.test.ts` (lines 1-45) — Why: the fixture builder (`frame(over)`) the new pure tests extend; `DRIVER`, `AT`, `NOW` consts already exist.
- `apps/dispatch/src/features/board/alerts-panel.test.tsx` (lines 1-60) — Why: the RTL pattern for a board panel — `formatMessage('lv', key)` for expected text, `getAllByRole('listitem')`, no string literals in assertions.
- `apps/dispatch/src/features/board/dispatch-page.test.tsx` (lines 1-65) — Why: how the page is mounted with `useBoard` mocked and leaflet stubbed. Its `frame()` has `drivers: []`; the new page-level test needs its own frame with a driver in it.
- `apps/dispatch/eslint.config.mjs` — Why: `max-lines` 500 is restated here (this app does not consume `@taxi/config/eslint/base.mjs`), and `**/*.test.tsx` is exempt.
- `docs/runbooks/driver-device-day.md` (lines 247-248, 298-307) — Why: the two paragraphs AC #5 retires.

### New Files to Create

- `packages/shared/src/driver-presence.ts` — the promoted `DRIVER_LOCATION_TTL_SECONDS` and nothing else.
- `apps/dispatch/src/features/board/driver-list.tsx` — the accessible driver list with freshness.
- `apps/dispatch/src/features/board/driver-list.test.tsx` — its RTL tests.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [ARIA 1.2 — `aria-live`](https://www.w3.org/TR/wai-aria-1.2/#aria-live)
  - Specific section: `polite` semantics
  - Why: the summary line must announce on set change only. A region whose text changes every second is a screen-reader firehose; `tracking-map.tsx:186-187` already states this rule for the same reason.
- [ARIA 1.2 — Name From Author, prohibited roles](https://www.w3.org/TR/wai-aria-1.2/#namefromprohibited)
  - Specific section: role `generic`
  - Why: `zone-grid.tsx:60-64` explains why a bare `<span>` cannot carry `aria-label` — the new list makes the same choice and should not re-derive it.
- `.claude/references/realtime-events.md` — Why: the board frame's cadence and the wholesale-replace rule this list inherits.
- No external library research is needed: this ticket adds no dependency.

### Patterns to Follow

**Compile-pinned label maps** — never a `Partial`, never a fallback (`ride-queue.tsx:29-46`, `zone-grid.tsx:16-26`):

```ts
const FRESHNESS_KEY: Record<DriverFreshness, MessageKey> = {
  live: 'console.driver_streaming',
  stale: 'console.driver_silent',
  unknown: 'console.driver_no_signal',
};
```

Adding a state to the union without a key is then a build failure in `apps/dispatch`, which is the point.

**Pure derivation, caller owns the clock** (`board-state.ts:171-173`):

```ts
export function isStale(nowMs: number, lastFrameAtMs: number | null): boolean {
  return lastFrameAtMs === null || nowMs - lastFrameAtMs >= STALE_MS;
}
```

**`mm:ss` age, digits only** (`ride-queue.tsx:62-71`) — `ageOf` is module-private to `ride-queue.tsx`. Do **not** import it across files; either export it from `ride-queue.tsx` and import it in `driver-list.tsx` (same slice, allowed), or restate it. **Prefer exporting** — two copies of a time formatter is exactly the drift `max-lines` discipline does not catch.

**Status dot** (`zone-grid.tsx:85-95`) — `role="img"` plus `aria-label`, reusing `DRIVER_STATUS_KEY`. That map is module-private to `zone-grid.tsx` in another slice; restate it in `driver-list.tsx` rather than reaching across, and keep it `Record<DriverStatus, MessageKey>` so it stays total.

**Theme + catalog only** — colours via `var(--color-*)`, spacing via `var(--spacing-*)`, every string via `formatMessage(LANG, key)` with `LANG: Language = 'lv'` as every console file declares it.

---

## IMPLEMENTATION PLAN

### Phase 1: The shared constant

Promote `DRIVER_LOCATION_TTL_SECONDS` so the console can import the same number the api filters on, with the api's behaviour unchanged.

**Tasks:** new `packages/shared/src/driver-presence.ts`, export from `index.ts`, re-export from the api policy, amend the `realtime-events.ts` comment.

### Phase 2: The pure derivation

**Depends on:** Phase 1 (imports the constant).

**Tasks:** `DriverFreshness` type + `driverFreshness()` in `board-state.ts`, with tests.

### Phase 3: The catalog

**Independent of:** Phase 2 — can run in parallel; both are inputs to Phase 4.

**Tasks:** new `console.*` keys in `lv.ts` (reference), `ru.ts`, `en.ts`; amend `console.map_alt`.

### Phase 4: The component

**Depends on:** Phases 2 and 3.

**Tasks:** `driver-list.tsx`, export from the slice `index.ts`, mount in `page.tsx`, retire the stale `board-map.tsx` comment.

### Phase 5: Tests and docs

**Depends on:** Phase 4.

**Tasks:** component tests, page-level test, runbook edits, full gate.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom.

### CREATE `packages/shared/src/driver-presence.ts`

- **IMPLEMENT**: Export `DRIVER_LOCATION_TTL_SECONDS = 60` with a doc comment written for **both** consumers: it is the one window inside which a recorded position counts as proof of life, and every surface that decides "is this driver still reporting" reads this number — the api to drop a stale position from `findNearby`, the presence sweeper to mark a driver dark, the console to tell Dina the stream has stopped. State explicitly that a second copy in any of the three is the defect this file prevents, and that a console-local threshold would put the board's «streaming» and dispatch's candidacy on different clocks.
- **PATTERN**: `packages/shared/src/idempotency.ts` (22 lines) — a small single-purpose module with a long comment and a short body is the established shape here.
- **IMPORTS**: none.
- **GOTCHA**: Do **not** move the api-specific rationale across. The *"READ-TIME FILTER, not a Redis key expiry … GEO members are sorted-set members and carry no per-member TTL"* paragraph (`driver-location.policy.ts:19-23` at the head; `:7-14` before this ticket's import shifted the file down 10 lines) explains a Redis implementation and belongs in `services/api`. It stays there, attached to the re-export.
- **VALIDATE**: `pnpm --filter @taxi/shared typecheck`
- **SATISFIES**: AC #3

### UPDATE `packages/shared/src/index.ts`

- **IMPLEMENT**: `export * from './driver-presence';`
- **PATTERN**: the file is a flat list of `export *` lines with ordering comments only where order matters (`:7`). This one has no ordering constraint — place it near `./idempotency`.
- **GOTCHA**: `packages/shared` imports from nothing in the workspace (root CLAUDE.md). This file must not import from the api; the dependency runs the other way.
- **VALIDATE**: `pnpm --filter @taxi/shared build`
- **SATISFIES**: AC #3

### UPDATE `services/api/src/features/drivers/location/driver-location.policy.ts`

- **IMPLEMENT**: Replace the `export const DRIVER_LOCATION_TTL_SECONDS = 60;` declaration at `:15` with an import from `@taxi/shared` plus a re-export, keeping the existing comment (reworded to say the number now lives in `@taxi/shared` and why, with the Redis-TTL paragraph intact):

  ```ts
  import { DRIVER_LOCATION_TTL_SECONDS } from '@taxi/shared';
  export { DRIVER_LOCATION_TTL_SECONDS };
  ```

  `PRESENCE_DARK_AFTER_SECONDS = DRIVER_LOCATION_TTL_SECONDS` at `:30` then resolves through the import and needs no edit.
- **PATTERN**: `services/api/src/features/drivers/index.ts:34` already re-exports a symbol it does not declare.
- **IMPORTS**: `@taxi/shared` is already a dependency (`services/api/package.json:37`).
- **GOTCHA**: **Every existing import site must keep working unchanged** — `driver-location.service.ts:13`, `driver-location.service.spec.ts:11`, and the prose citation in `cascade.ts:159`. Re-exporting rather than rewriting call sites is what keeps this a zero-behaviour-change task. Verify with the grep in VALIDATE, not by reading.
- **VALIDATE**: `grep -rn "DRIVER_LOCATION_TTL_SECONDS" services/api/src` shows the same call sites as before, then `pnpm --filter @taxi/api typecheck`
- **SATISFIES**: AC #3

### UPDATE `packages/shared/src/realtime-events.ts` (the `lastSeenAt` comment, ~line 181)

- **IMPLEMENT**: Amend *"staleness is the client's presentation concern"*. The half that stays true: the wire carries `lastSeenAt` raw and no pre-computed stale flag, so rendering is the client's. The half that is now false: the client does **not** pick its own threshold — it reads `DRIVER_LOCATION_TTL_SECONDS` from this package, so the board's «silent» boundary and dispatch's candidacy boundary cannot drift apart. Name the constant so a reader can follow it.
- **PATTERN**: the file's existing style — a paragraph stating a rule and the failure it prevents.
- **GOTCHA**: Do not delete the sentence. It is the reason the wire has no `isStale` boolean, and that decision stands.
- **VALIDATE**: `pnpm --filter @taxi/shared test`
- **SATISFIES**: F1 reconciliation (see **D1**)

### ADD `DriverFreshness` + `driverFreshness()` to `apps/dispatch/src/features/board/board-state.ts`

- **IMPLEMENT**:

  ```ts
  export type DriverFreshness = 'live' | 'stale' | 'unknown';

  export function driverFreshness(
    nowMs: number,
    lastSeenAt: string | null,
  ): DriverFreshness {
    if (lastSeenAt === null) return 'unknown';
    const ageMs = nowMs - Date.parse(lastSeenAt);
    return ageMs >= DRIVER_LOCATION_TTL_SECONDS * 1000 ? 'stale' : 'live';
  }
  ```

  Comment it with: why three states and not two (`lastSeenAt: null` is an online driver whose GEO position was never recorded or was dropped — never-streamed is not the same fact as stopped-streaming, and «Klusē MM:SS» has no age to print); why `>=` and not `>` (matches `isStale`'s boundary convention at `:172`, and makes the boundary case deterministic in tests); and the visibility bands from **D2** below.
- **PATTERN**: `isStale` at `:171-173` — same signature shape, same "caller passes the clock" rule stated in the module header at `:8-11`.
- **IMPORTS**: add `DRIVER_LOCATION_TTL_SECONDS` to the existing `@taxi/shared` type-import block at `:1-6` — note that block is currently `import type`, so a **value** import needs its own `import { DRIVER_LOCATION_TTL_SECONDS } from '@taxi/shared';` line.
- **GOTCHA**: `Date.parse` on an invalid string returns `NaN`, and `NaN >= x` is `false` — which would silently report `'live'` for garbage. The wire schema is `z.string().datetime()` and `useBoard` parses every frame through `dispatchBoardEventSchema` (`use-board.ts:61,116`), so a non-datetime string cannot reach this function. Say that in the comment rather than adding an unreachable guard (root CLAUDE.md: no error handling for impossible scenarios).
- **GOTCHA 2**: `ageOf` has no hour field — `Math.floor(totalSeconds / 60)` with `padStart(2, '0')` renders three hours of silence as `180:00`, not `03:00:00`. That is the **D2 unbounded case**, and it is the one this ticket exists for, so it will be seen. **Decision: leave it.** `180:00` is unambiguous and monotonic, an hours field would mean a second formatter for a case a dispatcher should never let reach an hour, and any cap («>59:59») throws away the one number that says how bad it is. State this in the `driverFreshness` comment so the next reader does not file it as a bug.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- board-state`
- **SATISFIES**: AC #1, AC #3

### ADD tests to `apps/dispatch/src/features/board/board-state.test.ts`

- **IMPLEMENT**: a `describe('driverFreshness')` block with **expected** (a fix 4 s old → `'live'`), **edge** (exactly `DRIVER_LOCATION_TTL_SECONDS * 1000` old → `'stale'`, pinning the `>=` boundary; and one at TTL − 1 ms → `'live'`), and **failure** (`lastSeenAt: null` → `'unknown'`, so a never-positioned driver is never reported as streaming).
- **PATTERN**: the file's existing `it('… (expected)')` / `(edge)` / `(failure)` naming and its `NOW`/`AT`/`DRIVER` constants at `:21-25`.
- **IMPORTS**: `DRIVER_LOCATION_TTL_SECONDS` from `@taxi/shared` — **assert against the imported constant, never against `60`**, or the test re-states the literal AC #3 forbids.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- board-state`
- **SATISFIES**: AC #4

### ADD catalog keys to `packages/shared/src/i18n/lv.ts`, `ru.ts`, `en.ts`

- **IMPLEMENT**: add beside the existing `console.driver_status_*` keys (`lv.ts:67-69`):

  | key | lv | ru | en |
  |---|---|---|---|
  | `console.drivers_title` | `Šoferi` | `Водители` | `Drivers` |
  | `console.drivers_empty` | `Neviens šoferis nav tiešsaistē` | `Нет водителей в сети` | `No drivers online` |
  | `console.driver_streaming` | `Raida` | `Передаёт` | `Reporting` |
  | `console.driver_silent` | `Klusē {age}` | `Молчит {age}` | `Silent for {age}` |
  | `console.driver_no_signal` | `Nav signāla` | `Нет сигнала` | `No signal` |
  | `console.drivers_silent_summary` | `Nav datu: {names}` | `Без данных: {names}` | `Not reporting: {names}` |

  > **AMENDED by PR #236's round-2 review (M3), 2026-09-20.** The summary row originally read `Klusē: {names}` / `Молчат: {names}` / `Silent: {names}`. It names every driver whose freshness is not `live` — `stale` **and** `unknown` — so it cannot use the stopped-streaming word for the never-streamed case; the row above it says «Nav signāla» for the same driver. Round 1's F1 is what made this routine rather than a deploy ghost: `unknown` is now every driver's state from go-online until their first fix. `console.driver_silent` («Klusē {age}») is unchanged — it is the row label for the genuinely-`stale` case and is correct there.

  Amend `console.map_alt` (`lv.ts:58-59`): the current LV text ends *"Saraksts pieejams zonu skatā."* ("list available in the zones view"), which stops being true once the driver list is always on screen. Re-point it at the drivers list, e.g. `Karte ar šoferu atrašanās vietām. Saraksts ar šoferiem un to statusu ir zemāk.` — and the matching `ru`/`en`.
- **PATTERN**: `lv.ts` is the reference dictionary — `MessageKey` derives from it and the `satisfies` clause in `i18n.ts:22-26` forces `ru`/`en` to carry exactly the same keys. Add to `lv` first; the other two are then a typecheck error until filled.
- **GOTCHA**: `formatMessage` is a plain `{placeholder}` replace with **no plural support** (`format-message.ts`). `console.drivers_silent_summary` therefore takes a comma-joined **name list**, not a count — LV plural agreement (1 šoferis / 2 šoferi / 21 šoferis) cannot be expressed here, and a name list is more useful to Dina anyway. Do not introduce a count placeholder.
- **VALIDATE**: `pnpm --filter @taxi/shared test` (`tests/i18n.test.ts` pins placeholder parity across the three catalogs)
- **SATISFIES**: AC #2

### CREATE `apps/dispatch/src/features/board/driver-list.tsx`

- **IMPLEMENT**: `export function DriverList({ drivers, nowMs }: Readonly<{ drivers: BoardDriver[]; nowMs: number }>)`.

  Structure:
  - `<section>` with an `<h3>` (`console.drivers_title`) matching `AlertsPanel`'s chrome.
  - One `<p aria-live="polite">` holding `console.drivers_silent_summary` with the comma-joined names of every driver whose freshness is `'stale'` or `'unknown'` — **empty string when none**, so nothing is announced while the fleet is healthy and the announcement fires on the transition.
  - `<ul>` → one `<li>` per driver: the `role="img"` status dot, name, phone, `zoneName` when non-null, and the freshness label.
  - Freshness label is **text**, from `FRESHNESS_KEY[state]`. For `'stale'` it interpolates `{age}` with `ageOf(nowMs, driver.lastSeenAt)`. Colour (`var(--color-success)` / `var(--color-warning)` / `var(--color-fg-muted)`) is carried **in addition to** the text, never instead of it.
  - Empty list → `console.drivers_empty`, mirroring `ride-queue.tsx:170-178`'s empty bucket.
- **PATTERN**: `zone-grid.tsx:71-120` for the row and the dot; `alerts-panel.tsx` for the panel shell; `ride-queue.tsx:62-71` for `ageOf`.
- **IMPORTS**: `formatMessage`, `type DispatchBoardEvent`, `type DriverStatus`, `type Language`, `type MessageKey` from `@taxi/shared`; `driverFreshness`, `type DriverFreshness` from `./board-state`; `ageOf` from `./ride-queue` (export it there — same slice, one formatter).
- **GOTCHA**:
  - `'use client'` on line 1. Every interactive/stateful console component carries it.
  - The `aria-live` element must be **rendered at all times** with changing text, not conditionally mounted — a region inserted into the DOM at the same moment its content appears is unreliably announced across screen readers. Render `<p aria-live="polite">{summary}</p>` where `summary` is `''` when nothing is silent.
  - Do **not** put the ticking `mm:ss` inside the live region. Only the name set goes there.
  - `visuallyHidden` in `zone-grid.tsx:39-50` is module-private and in another slice — restate it here with a one-line comment saying why, or omit it if the row needs no hidden text (the freshness label is already a visible sentence, so it probably does not).
  - Keep under 500 lines (`apps/dispatch/eslint.config.mjs:21`). It should land around 130.
- **VALIDATE**: `pnpm --filter @taxi/dispatch lint && pnpm --filter @taxi/dispatch typecheck`
- **SATISFIES**: AC #1, AC #2

### UPDATE `apps/dispatch/src/features/board/ride-queue.tsx`

- **IMPLEMENT**: change `function ageOf` (`:62`) to `export function ageOf`. No other change.
- **GOTCHA**: Surgical — do not touch the surrounding comment or reorder anything. The comment *"mm:ss since the ride was requested"* is now slightly narrow; widen it to *"mm:ss since an ISO instant"* in the same edit, since a second caller now exists.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- ride-queue`
- **SATISFIES**: AC #2

### UPDATE `apps/dispatch/src/features/board/index.ts`

- **IMPLEMENT**: `export { DriverList } from './driver-list';` and add `driverFreshness` + `type DriverFreshness` to the existing `board-state` exports at `:6-7`.
- **PATTERN**: the file's alphabetical-ish grouping and its header comment *"the /dispatch page composes exactly these"*.
- **VALIDATE**: `pnpm --filter @taxi/dispatch typecheck`
- **SATISFIES**: AC #1

### UPDATE `apps/dispatch/src/app/dispatch/page.tsx`

- **IMPLEMENT**: add `<DriverList drivers={frame.drivers} nowMs={nowMs} />` inside the right-hand column `<div>` at `:261`, **between** the `view ===` ternary (`:263-267`) and `<AlertsPanel …>` (`:268`), so it renders in both views. Add `DriverList` to the `@/features/board` import at `:9-16`.
- **GOTCHA**: It must sit **outside** the ternary. Putting it in either branch reintroduces exactly the defect this ticket closes for the other view. `nowMs` is already in scope from `useBoard()` at `:49`.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- dispatch-page`
- **SATISFIES**: AC #2

### UPDATE `apps/dispatch/src/features/board/board-map.tsx` (the header comment, `:15-20`)

- **IMPLEMENT**: the line *"`aria-hidden`: the zones panel and phone list ARE the text alternative (console.map_alt says so)"* names a surface that is no longer the driver list. Re-point it at `DriverList`, which is always rendered and carries every online driver including the zone-less ones the zone grid never showed.
- **GOTCHA**: Retire the **noun**, not the sentence shape — grep `map_alt`, `text alternative` and `phone list` across `apps/dispatch/src` and fix every hit, not just this one. `console.map_alt`'s own text is edited in the catalog task above; confirm the two now agree.
- **VALIDATE**: `grep -rn "phone list\|text alternative" apps/dispatch/src` returns only corrected lines
- **SATISFIES**: AC #2

### CREATE `apps/dispatch/src/features/board/driver-list.test.tsx`

- **IMPLEMENT**: see TESTING STRATEGY.
- **PATTERN**: `alerts-panel.test.tsx` — `formatMessage('lv', key)` in every assertion, `getAllByRole('listitem')`, no bare string literals.
- **GOTCHA**: `toHaveTextContent` matches against the element's **whole** text, so a row assertion sees name + phone + zone + label concatenated. Assert on the row element with the label substring, not on equality.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- driver-list`
- **SATISFIES**: AC #4

### ADD a page-level test to `apps/dispatch/src/features/board/dispatch-page.test.tsx`

- **IMPLEMENT**: one test that mounts the page with a frame carrying a stale driver and asserts the freshness label is present in the **default zones view**, then clicks «Karte» (`getByRole('button', { name: formatMessage('lv', 'console.map') })`) and asserts it is **still** present. This is the test that pins the "outside the ternary" decision; without it a later refactor can silently move the panel into one branch.
- **PATTERN**: the file's `mount(pill, board, nowMs)` helper at `:56-64`; its `frame()` at `:43-49` needs a variant with a populated `drivers` array.
- **GOTCHA**: the view toggle is a `useState` click, so wrap the assertion after it in `await vi.waitFor(...)` — the dispatch RTL commit-vs-effect race flakes ~2-in-12 on CI and 0-in-27 locally (`.claude/plans/dispatch-test-runner-vitest-rtl.md`, #189). The existing leaflet stub at `:25-36` covers the map branch.
- **VALIDATE**: `pnpm --filter @taxi/dispatch test -- dispatch-page`
- **SATISFIES**: AC #2, AC #4

### UPDATE `docs/runbooks/driver-device-day.md`

- **IMPLEMENT**: two edits.
  1. **Line ~247 (step 5's Expect cell)**: *"`/dispatch` is NOT the signal here: the board renders position and no freshness, so a still pin is not a failure"* — replace with the board now carrying the signal: the driver's row shows «Raida» while the stream is alive and flips to «Klusē MM:SS» past `DRIVER_LOCATION_TTL_SECONDS`. Keep the api console as **primary** (it timestamps every accepted fix and is what proves the 4 s cadence); the board becomes a second in-product corroboration alongside `t/<token>`.
  2. **Lines 298-307 (the "Why `/dispatch` is not the freshness signal" paragraph)**: retire it. Replace with a short note that #234 closed it, naming the new surface, and keep the 4 s / `distanceInterval: 0` explanation — that part is still the reason a still pin proves nothing on its own.
- **GOTCHA**: Grep the **noun** across the whole file — `freshness`, `still pin`, `no freshness`, `renders position` — not the sentence form. The paragraph is cross-referenced from step 5 and from the Verdict section, and #212's lesson is that the surface nobody greps is the one that stays wrong. Also check the base before editing — **`git fetch --prune && git log origin/main -1`**, and rebase if it moved. "Re-read at HEAD" is not enough: this worktree is pinned at `b8d62c5`, so HEAD is the stale copy. Main already moved twice on 2026-09-20 (#233, then #235, which rewrote this very runbook), and every line number in this plan is `observed` at `b8d62c5`.
- **GOTCHA 2**: Do **not** touch step 6's `HH:MM` note at line 248 — that is the tracking page (#224 D3) and is out of scope.
- **VALIDATE**: `grep -n "freshness\|still pin" docs/runbooks/driver-device-day.md` — every remaining hit is either corrected or the deliberate 4 s explanation
- **SATISFIES**: AC #5

### RUN the gate

- **VALIDATE**: `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force`
- **SATISFIES**: AC #6

---

## TESTING STRATEGY

### Unit Tests

**`board-state.test.ts` — `driverFreshness` (pure, no DOM):**

| case | input | expect |
|---|---|---|
| expected | `nowMs = NOW`, `lastSeenAt = NOW − 4_000` | `'live'` |
| edge | `lastSeenAt = NOW − DRIVER_LOCATION_TTL_SECONDS * 1000` | `'stale'` (pins `>=`) |
| edge | `lastSeenAt = NOW − (DRIVER_LOCATION_TTL_SECONDS * 1000 − 1)` | `'live'` (pins the other side) |
| failure | `lastSeenAt = null` | `'unknown'` — never `'live'` |

**`driver-list.test.tsx` (RTL):**

| case | scenario | expect |
|---|---|---|
| expected | two drivers, one fresh one silent | two `listitem`s; the fresh row contains `console.driver_streaming`, the silent row contains the `console.driver_silent` text with a real `mm:ss` |
| expected | the live region | exactly one `aria-live="polite"` element, its text naming the silent driver and **not** the fresh one |
| edge | all drivers fresh | the live region is present but **empty** — nothing announced |
| edge | `lastSeenAt: null` | row shows `console.driver_no_signal` and the driver **is** named in the silent summary |
| edge | `drivers: []` | `console.drivers_empty`, no `listitem`s |
| failure | colour independence | the silent row's accessible text alone distinguishes it — assert on `toHaveTextContent`, with no assertion that depends on a style value. State in a comment that this test is the AC #2 "not colour alone" check, so a later refactor cannot quietly satisfy it with a swatch. |

### Integration Tests

None. This ticket touches no socket, no room join and nothing under `features/realtime` — `applyDriverLocation` already delivers `lastSeenAt` into board state and `board-state.test.ts:112-130` already covers that path. The api change is a re-export with zero behaviour change, covered by the existing `driver-location.service.spec.ts` continuing to pass unmodified (which is itself the assertion).

### Edge Cases

Every one is owned by a named test above except these two:

- **An `on_ride` driver silent for well over the sweep window** — the unbounded case from the Problem Statement. Verified by `driver-list.test.tsx`'s silent-row case with `status: 'on_ride'` in the fixture; add it as a third driver in the "expected" case rather than a separate test, so the row proves the status dot and the freshness label are independent axes.
- **Clock skew between the api and the console** — `lastSeenAt` is the api's clock, `nowMs` is the browser's. A browser clock 2 minutes slow reports every driver `'live'`; one 2 minutes fast reports every driver `'stale'`. **Not tested and not defended against** — the same exposure `ride-queue.tsx`'s `ageOf` already carries for every ride age on the board, and the frame-level `pillFrom` deliberately uses server-clock ordering *because* client clocks are untrusted (`board-state.ts:82-86`). Record it in NOTES as a known limitation with the existing precedent; do not invent a skew correction for this ticket.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```bash
pnpm --filter @taxi/shared lint
pnpm --filter @taxi/dispatch lint
pnpm --filter @taxi/api lint
```

### Level 2: Unit Tests

```bash
pnpm --filter @taxi/shared test
pnpm --filter @taxi/dispatch test
```

### Level 3: Integration Tests

```bash
COMPOSE_PROJECT_NAME=taxi pnpm --filter @taxi/api test
```

Expect no change from base. Re-run once before diagnosing: any `@taxi/api` integration suite flakes under load and passes alone.

### Level 4: Manual Validation

**Preconditions**: `docker compose up -d --wait`, `pnpm dev`, a dispatcher session on `/dispatch`.

The one state the seed cannot produce is a driver in the Redis online set with a recorded position — only a real `PUT /drivers/me/status online` plus a `driver:location` ingest does that. **This ticket needs no new instrument**: `services/api/scripts/mint-tracked-ride.ts` already drives the whole chain (OTP sign-in → vehicle → online → `POST /rides` → sweeper offer → accept → a walk that emits real positions), run as `pnpm --filter @taxi/api mint:ride` (`services/api/package.json:16`). `observed`: the script exists at `b8d62c5` and its teardown marks the driver `offline` and cancels the ride.

That teardown is the detail the steps below turn on. Killing the script with **Ctrl-C** skips it — Node's default SIGINT handling terminates without running `finally` — leaving a driver `on_ride`, still in the Redis online set, with a position that stops ageing. That is exactly the **D2 unbounded case**, reachable in one keystroke and not otherwise producible by hand. A later full `mint:ride` run resets the presence state.

Steps:

1. Start `pnpm --filter @taxi/api mint:ride`. Open `/dispatch` in the default zones view while it walks. **Expect**: the drivers panel lists the driver with «Raida».
2. **Ctrl-C the script mid-walk.** Keep watching the row. **Expect**: within `DRIVER_LOCATION_TTL_SECONDS` it flips to «Klusē 01:00» and keeps counting past it without the row disappearing — the `on_ride` carve-out means no sweep removes them. **This is the ticket's success condition**: the board is carrying a signal it could not carry before.
3. Switch to «Karte». **Expect**: the drivers panel is still present and still says «Klusē».
4. With VoiceOver (⌘F5), confirm the silent driver's name is announced **once**, on the transition, and that the `mm:ss` is not re-announced every second.
5. Let `mint:ride` run to completion instead (no Ctrl-C). **Expect**: the driver returns to «Raida» while walking, then leaves the panel entirely at teardown — `PUT status offline` drops the Redis member, so the row is gone rather than stale. Both outcomes are correct and they are different; the step exists to prove the panel distinguishes them.

Step 5's `online`-driver sweep path (the row vanishing within ~75 s of a stopped stream, rather than at an explicit `offline`) is **not** reachable from this script, because its teardown always marks offline explicitly. Reproducing it means holding a driver `online` with no ride and no emitter — out of reach of the instruments this repo has today, and not a blocker: the code path is `markDarkDrivers` (`drivers.service.ts:319-331`), which `services/api`'s own suite already covers. Record it as not performed rather than claiming it.

### Level 5: Additional Validation

None applicable.

---

## ACCEPTANCE CRITERIA

Mapped 1:1 to the issue's, with the two corrected premises noted.

- [x] **AC #1** — `lastSeenAt` has at least one production reader in `apps/dispatch/src/features/board/`: `driverFreshness()` in `board-state.ts`, called from `driver-list.tsx`. Verify: `grep -rn "lastSeenAt" apps/dispatch/src/features/board` shows a read, not only the `:127` write.
- [x] **AC #2** — the board distinguishes streaming from silent, without colour alone: a text label on every driver row, present in **both** views, pinned by the page-level toggle test and the colour-independence test.
- [x] **AC #3** — the threshold is imported, not restated. **Premise corrected**: the constant was not in `@taxi/shared` at filing; this ticket puts it there (see **D1**). Verify: `grep -rnE '\\b60\\b|60_000|60000' apps/dispatch/src/features/board` finds no threshold literal (a bare `"60"` grep is a false pass — the slice uses `fontWeight: 600` in several files), and `grep -rn "DRIVER_LOCATION_TTL_SECONDS" services/api/src packages/shared/src apps/dispatch/src` shows exactly one declaration.
- [x] **AC #4** — ≥1 expected + 1 edge + 1 failure case, mirroring the board slice's specs: satisfied several times over by the tables above.
- [x] **AC #5** — the runbook's *"Why `/dispatch` is not the freshness signal"* paragraph is re-pointed or retired, **and** step 5's Expect cell with it (the issue named only the paragraph; the same claim appears twice).
- [x] **AC #6** — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` green.
- [x] No behaviour change in `services/api`: its test suite passes unmodified.

---

## COMPLETION CHECKLIST

- [x] All tasks completed in order
- [x] Each task validation passed immediately
- [x] All validation commands executed successfully
- [x] Full gate green (task count and result recorded with provenance)
- [x] No linting or type checking errors
- [x] Level 4 manual steps 1-3 performed, or explicitly recorded as not performed and why
- [x] Acceptance criteria all met
- [x] Issue #234 updated with the two corrected premises (**D1**, **D2**)

---

## OPEN QUESTIONS / ASSUMPTIONS

**D1 — promote the constant to `@taxi/shared` rather than define a console-local one.** *Decided, not open — recorded because it changes two packages the issue's scope guard never mentions.*

The issue's AC #3 says *"The threshold is already a shared constant; it should be imported, not re-stated."* It is not: `DRIVER_LOCATION_TTL_SECONDS` is declared once, at `services/api/src/features/drivers/location/driver-location.policy.ts:15` (`observed` at `b8d62c5`, grep across `packages/`, `services/`, `apps/`). `apps/dispatch` cannot import it — contracts flow one way through `packages/shared` (root CLAUDE.md).

Promoting it, rather than writing a board-local `STALE_DRIVER_MS`, because the api has **already** made this argument for itself. `driver-location.policy.ts:34-39` at the head (`:24-29` at the base this plan was written against — the same +10 shift as the refs above), on `PRESENCE_DARK_AFTER_SECONDS`: *"Equal to the dispatch freshness window ON PURPOSE: the moment `findNearby` stops seeing a driver is the moment the durable record says offline — one number, no window in which the board says online while dispatch excludes."* The board is the third consumer of that same fact and is currently outside the guarantee. A console-local copy would put Dina's «Raida» and dispatch's candidacy on different clocks, which is the precise failure that comment exists to prevent.

The counter-argument is `realtime-events.ts:181` — *"staleness is the client's presentation concern."* That sentence is about the **wire**: the frame carries `lastSeenAt` raw and no pre-computed stale flag, and that stays true. What it cannot mean, once a third surface reads the same boundary, is that each client picks its own number. The task above amends it to say which half holds.

**D2 — how long a stale row is actually visible, and why the `on_ride` case is the real one.**

For a driver with `status: 'online'`: the row shows «Klusē» from the moment the age crosses `DRIVER_LOCATION_TTL_SECONDS` (60 s) until the presence sweeper marks them dark and drops the Redis member, at `PRESENCE_DARK_AFTER_SECONDS + PRESENCE_SWEEP_INTERVAL_MS` = 60 + 15 = **75 s** worst case after the last accepted fix (`derived`, from `driver-location.policy.ts:40,46`; the same figure is stated at `services/api/src/features/drivers/index.ts:16`). So the visible «Klusē» band is **0-15 s** — 15 s if the last fix landed just after a sweep tick, 0 s if it landed just before one. Short, and honest: past that the driver is gone from `frame.drivers` entirely, which is itself the answer.

For a driver with `status: 'on_ride'`: **unbounded**. `markOfflineByServer` returns at `drivers.service.ts:271` (`if (status !== 'online') return false;`) before touching Redis, deliberately — `:257-266` explains that a mid-ride app crash must not drop the driver off the ride, and their last position still feeds the rider's tracking page. Nothing else removes them. So a dark `on_ride` driver sits on the board with a green «Izpilda braucienu» and an `lastSeenAt` ageing forever.

That is the case this ticket earns its keep on, and the issue does not mention it. It is also the case where the operator most needs to act: the rider is watching a frozen car on `t/<token>` and only Dina can phone the driver.

**A1 — the `aria-live` summary is worth its complexity.** Assumed, not measured. The alternative is a list with no live region: a driver going dark is then visible but silent, and Dina staring at the ride queue misses it. The board's stated design runs the other way ("zero silent staleness"; ISA-18.2 edge alarms in `use-board.ts:200-206`), so one polite region naming the silent drivers is in keeping. It is deliberately **not** audible — `AlertsPanel` owns the sound budget. If Level 4 step 4 shows it chattering, cut it to a plain paragraph and log the decision in `.claude/references/ui-decisions.md`.

**Q1 — does the drivers panel belong in the right column, or should it replace the zones/map toggle with a three-way?** Assumed: right column, always rendered, toggle untouched. It keeps monitoring at 0 interactions (`page.tsx:45-46`) and satisfies AC #2 in both views, at the cost of a longer right column. A three-way toggle would hide freshness by default, which is the defect restated. If Linards wants the vertical space back, the panel can collapse to the silent-only summary — a cosmetic call for `ui-decisions.md`, not a re-plan.

**Q2 — does the drivers panel duplicate the zone grid?** Partly, and deliberately. The zone grid lists **queue entries** (including offline drivers holding a place); the new panel lists **the online set** (including drivers in no zone, whom the grid has never shown). Different sets, different questions. If the overlap grates in use, the zone grid's chips are the ones to thin, not this list — but not in this ticket.

**Friction audit** (root CLAUDE.md requires one): intent «is this driver still reporting?» → done. **Before**: impossible — 0 taps, no answer available in product. **After**: **0 taps** — the panel is on screen in both views, no click, no hover, no tooltip. Every alternative considered (map tooltip, third toggle view, expandable row) costs at least 1 tap and hides the signal by default, so the lowest-count option is the one planned. Touch targets: the panel adds **no** interactive elements, so the 44 px rule has nothing to bind to here; the existing toggle and ack buttons are unchanged.

**UX breadboard**:

```
[/dispatch]
  → (place) board, right column
      → (affordance) «Šoferi» panel, always present
          → (place) driver row: ●status · name · phone · zone · «Raida» | «Klusē MM:SS» | «Nav signāla»
          → (affordance) aria-live summary «Nav datu: Jānis, Anna»  → announced on set change only
  → [Zonas] / [Karte] toggle  → changes the panel ABOVE it, never this one
```

**States**: *loading* — the page's existing `console.loading` covers it; the panel is not rendered until `frame !== null` (`page.tsx:242`). *empty* — `console.drivers_empty`. *error* — none of its own; a dead API is the pill's and the stale banner's job. *offline* — the hydrated snapshot still renders the list, and every row reads «Nav signāla» with the summary silent.

> **SUPERSEDED by PR #236's round-1 review (F2), 2026-09-20.** This line originally read *"every row reads as silent because `lastSeenAt` is genuinely old. That last one is correct behaviour and worth a comment: an offline console showing «Klusē» for everyone is telling the truth about what it knows."* It is not telling the truth about what it knows: `lastSeenAt` freezes when the CONSOLE stops receiving exactly as it does when a DRIVER stops sending, so «Klusē MM:SS» there attributes the console's own deafness to every phone — and the worst case, a cold refresh off `localStorage`, paints it on drivers who are all streaming normally. The panel now takes `boardStale` and falls to «Nav signāla» with an empty live region, matching `pillFrom`'s existing refusal to claim `live` without a fresh frame.

> **AMENDED AGAIN by the round-2 review (M2), 2026-09-20.** The line above originally said the panel takes *"the same condition the stale banner renders on"*. It no longer does, and passing that condition was itself a defect: the banner also fires on `pill === 'offline'`, and while the pill is «Bezsaistē» `use-board.ts`'s read-only poll refreshes `lastFrameAtMs` every cycle — so in the websocket-blocked/HTTP-fine state the fallback exists for, the board was current and the panel blanked anyway (`observed`: pill `offline`, frame 1 s old, both rows «Nav signāla», live region empty). The panel now reads FRAME AGE against its own wider window, `PANEL_STALE_MS = 2 × POLL_MS + STALE_MS = 15 s` (`derived`; two poll cadences because `pollBusy` skips a tick while a fetch is in flight, plus the heartbeat as the round-trip allowance). The banner can now be up while the panel keeps reading the rows — deliberate, and the panel's condition stays a strict subset of the banner's, so a caveat is always on screen when the panel gives up.

---

## NOTES (open canvas)

**Rejected: putting freshness on the map pin only.** The issue offers it ("rendered on the driver row and/or the map pin"). It fails AC #2 twice over: the map container is `aria-hidden="true"` (`board-map.tsx:100`) so no pin content reaches a screen reader, and the default view is `'zones'` (`page.tsx:50`) so the map is not mounted at all until Dina clicks. A signal you have to click to see is not a monitoring signal.

**Rejected: joining `lastSeenAt` into the zone grid by `driverId`.** Tempting — the grid is already always visible in the default view. But it is a *queue*, not a roster: a driver in no zone never appears, and those are exactly the drivers with no other text surface. It would also mean the board slice reaching into the zones slice's rendering, or the page plumbing a lookup map between two slices.

**Rejected: a stale flag on the wire.** The api could compute `isStale` server-side. `realtime-events.ts:181` already decided against it, and rightly: the frame's `at` and the client's clock are both available, the constant is now shared, and a boolean on the wire cannot express the `mm:ss` age. Left alone.

**Known limitation to record, not fix — client clock skew.** `lastSeenAt` is the api's clock; `nowMs` is the browser's. A browser 2 minutes slow reports everyone «Raida»; 2 minutes fast reports everyone «Klusē». The board already carries this exposure for every ride age (`ride-queue.tsx:62-71`), and the frame-level pill deliberately avoids it by ordering on the server clock (`board-state.ts:82-86`) — a precedent for *ordering*, not for *ages*. Defending against it would mean carrying a server-client offset from `frame.at`, which is a separate ticket and would change `ageOf` for rides too. Note it in the `driverFreshness` comment; do not fix it here. **That separate ticket is [#238](https://github.com/linardsb/taxi/issues/238)** — filed 2026-09-20 off PR #236's review (F8), which caught the docblock deferring "its own ticket" while naming no number: the exact pattern #234 itself was filed to correct.

**Size budget** (`derived`, all against the 500-line `max-lines` cap):

| file | now | after, approx |
|---|---|---|
| `board-state.ts` | 208 | ~235 |
| `driver-list.tsx` | — | ~130 |
| `page.tsx` | 325 | ~327 |
| `realtime-events.ts` | 385 | ~390 |
| `driver-presence.ts` | — | ~25 |

Nothing approaches the cap. Test files are uncapped (#112).

**Order note.** Phase 1 touches `services/api` for a re-export only. Run `pnpm --filter @taxi/api test` immediately after it and before touching `apps/dispatch` — an unchanged green api suite is the cleanest possible evidence that the promotion changed no behaviour, and it is much harder to read that signal once the console changes are in the diff too.

## AMENDMENTS

<!-- newest at the bottom -->

- **2026-09-20 — shipped as PR #236; two deviations from this plan, both taken deliberately.**

  **DV1 — `ageOf` moved to a new `apps/dispatch/src/features/board/age.ts` instead of being exported from `ride-queue.tsx`.** This plan said *"Prefer exporting — two copies of a time formatter is exactly the drift `max-lines` discipline does not catch."* The no-duplication half of that still holds; the export half was wrong and the test run proved it: `ride-queue.tsx` imports `@/features/override` and `@/features/zones`, so importing `ageOf` from it pulled two other slices into `driver-list.tsx`'s module graph for ten lines of arithmetic (`observed` — the first `driver-list.test.tsx` run failed with *"Cannot find package '@/features/override' imported from ride-queue.tsx"*). Its own module keeps one formatter AND keeps the board list's imports to the board slice.

  **DV2 — the runbook task had three sites, not two.** This plan named step 5's Expect cell and the §Verdict paragraph. Grepping the noun rather than the sentence — which the task itself instructed — turned up a third: step 6's *"This is the only in-product surface that renders freshness"*, which the board now falsifies. Fixed in the same commit. The plan's own AC #5 wording ("the issue named only the paragraph; the same claim appears twice") undercounted by one for the same reason the issue undercounted by one.

  Decided as planned, no deviation: **Q1** (right column, always rendered, toggle untouched) and **A1** (the `aria-live` summary kept). **D1** and **D2** were posted to the issue as a comment before implementation.

  Not performed: the Level 4 manual walkthrough — stated in the PR body rather than implied.

- **2026-09-20 — PR #236 review round 1 applied. Two Highs, and both were the plan's own blind spot, not a slip in implementing it.**

  **The plan's freshness derivation reads the wrong field, and this plan specified it that way.** Task 2 (`:232`) told the implementer to key the three states off `lastSeenAt`, with `lastSeenAt: null` as *"an online driver whose GEO position was never recorded or was dropped"*. That sentence describes `location === null`, not `lastSeenAt === null`. `markOnline` seeds the `seen` ZSET score at go-online time in the same MULTI as the SADD with **no GEOADD** (`redis-driver-location.store.ts:75-79`); only the RECORD script writes a position. So a driver who taps the toggle with no GPS lock reaches the board with a fresh `lastSeenAt` and `location: null`, and the panel called that **«Raida»** — green, for a phone that has reported nothing — for 60–75 s, and **unbounded** once force-assign makes them `on_ride`, which `markOfflineByServer` never sweeps. The `unknown` state built for exactly this case was near-dead in production. `driver-list.tsx`'s `rowFreshness` now discriminates on `location`, and `driver-list.test.tsx` carries the fixture this plan's test task never asked for: `location: null` with a FRESH `lastSeenAt`.

  **The plan blessed the second High in writing** — see the SUPERSEDED note in §UX → States. `driverFreshness` compares a ticking `nowMs` against a frozen `lastSeenAt`, so a console that stops receiving freezes every driver's age identically to every driver going quiet at once.

  **What this plan's AC set could not have caught.** AC #2 pins that the two states differ in TEXT; AC #3 pins that the boundary is imported. Neither asks whether the derivation reads a field that means what the label claims — the one question both Highs turn on. A plan whose ACs are all about the OUTPUT cannot fail on a wrong INPUT.

  Also applied: the `Number.isNaN` guard in `driverFreshness` (the docblock had justified its absence by citing `use-board.ts:61,116`, which are the two COLD-START parse paths — the two live socket handlers parse nothing; [#237](https://github.com/linardsb/taxi/issues/237) closes that app-wide); the phone as a `tel:` link with a 44px target, mirroring `zone-grid.tsx:130-141`, which matters most on this panel precisely because it is the only surface carrying a driver in no zone queue; `.sort()` on the live-region names, since `frame.drivers` is `SMEMBERS` order and the docblock claimed the text changes only with the set; three runbook corrections (the `>=` boundary reads **at** 60 s not "older than"; a «Klusē» row is a ❌ only while the board is not itself stale; and step 6's promised seconds counter exists only in the FAILURE state — «Raida» carries no `{age}`).

  **Corrected by the copy sweep, beyond the review's list:** §D2's 75 s derivation cited `driver-location.policy.ts:30,33`; the constants are at `:40,46`. (Named by section, not by line: round 2's edits move this plan's own line numbers, so a digit here goes stale the moment it is written.) `:335`'s task text says the row flips *"past"* the TTL — left as written because it is a historical instruction, but the boundary is `>=`, so it flips **at** the TTL, and the runbook it produced now says so.
