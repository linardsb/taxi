# Implementation Report — dispatch test runner (vitest + RTL) + `t/[token]` seed suite

**Plan**: `.claude/plans/dispatch-test-runner-vitest-rtl.md`
**Branch**: `feature/dispatch-test-runner-vitest-rtl`
**Status**: COMPLETE
**Implements**: #88 (`Closes #88`) — unblocks #18

## Summary

`apps/dispatch` now has a real test runner that the CI-parity gate invokes: vitest 3 + jsdom + React
Testing Library, wired by a single `"test": "vitest run"` script (no `turbo.json` or `ci.yml` change was
needed, as the plan predicted). The seed suite is 19 tests across 4 files covering the `t/[token]` tracking
slice, and it **pins both PR #83 Medium findings as regression tests** — verified by mutation checks, each of
which fails exactly one test. One shipped accessibility defect the plan carved out was fixed in one line: the
API-down retry control was `<a href="">`, which exposes **no `link` role at all** to assistive technology.

## Where the work lives — read this first

The main working tree (`~/Desktop/taxi`) was **never touched**. A sibling session was actively working there
(it committed `6efde7e` mid-session), and its next PIV step (`piv-create-pr`) pushes whatever branch is checked
out — so switching branches there would have hijacked its PR. This ticket was built in an isolated worktree:

```
/private/tmp/claude-501/-Users-Berzins-Desktop-taxi/cb034f84-1881-47fd-9b94-8469e6dd5aa5/scratchpad/dispatch-tests
```

branched from local `main` (`80bd98c` — the exact commit the plan's spike ran at). Commits land in the shared
`.git`, so the branch survives if `/private/tmp` is reaped. **`git worktree list`** shows four concurrent
worktrees on this repo; that contention matters below.

## Tasks completed

| Task | File | Action |
|---|---|---|
| Task 0 — pin ONE react across the workspace | `package.json` (root) | UPDATE (`pnpm.overrides`) |
| Five pinned devDependencies | `apps/dispatch/package.json` | UPDATE |
| `"test": "vitest run"` | `apps/dispatch/package.json` | UPDATE |
| Runner config | `apps/dispatch/vitest.config.ts` | CREATE |
| jest-dom matchers + explicit `afterEach(cleanup)` | `apps/dispatch/vitest.setup.ts` | CREATE |
| `statusLine` + `StatusScreen` | `src/features/tracking/states.test.tsx` | CREATE |
| `TrackingLive` island incl. **M1** | `src/features/tracking/tracking-live.test.tsx` | CREATE |
| Server page branches incl. **M2** | `src/features/tracking/tracking-page.test.tsx` | CREATE |
| Polling proxy (node env) | `src/features/tracking/tracking-data-route.test.ts` | CREATE |
| Retry control exposed as a link | `src/app/t/[token]/page.tsx` | FIX (1 line) |
| Runner recorded in one line | `apps/dispatch/CLAUDE.md` | UPDATE |
| Verified, NOT edited | `turbo.json`, `.github/workflows/ci.yml` | — (empty diff) |

## Tests added — 19 tests, 4 files, all passing

- **`states.test.tsx`** (5): catalog-sourced status lines *(expected)*; all 8 states distinct and non-empty in
  all 3 languages *(edge)* — the copy-paste class the `Record<TrackingPageState, MessageKey>` type cannot
  catch; no leaked key or placeholder *(failure)*; `StatusScreen` heading *(expected)*; `lang` attribute so a
  RU notice is announced in RU *(edge)*.
- **`tracking-live.test.tsx`** (5): terminal-state render *(expected, the Phase 1 smoke test)*; status/driver/
  plate/ETA *(expected)*; **M1 stale-GPS pin** *(edge)*; terminal ride never polls *(edge)*; 410 mid-session →
  expired notice via `role="status"` *(failure)*.
- **`tracking-page.test.tsx`** (6): **M2 retry-link pin** *(failure)*; 200 renders title, language switcher and
  `tel:` link *(expected)*; unknown `?lang` *(edge)*; array-valued `?lang` *(edge)*; 404/410 headings
  *(failure)*; `generateMetadata` title *(expected)*.
- **`tracking-data-route.test.ts`** (3, node env): proxy with `no-store` JSON headers *(expected)*;
  path-traversal-shaped token → local 404 with **zero** fetch calls *(failure)*; API unreachable → 502 *(edge)*.

## Validation results

**Full CI-parity gate — `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run
typecheck lint test build --force` → exit 0, `Tasks: 21 successful, 21 total`.**

| Check | Result |
|---|---|
| `@taxi/dispatch:test` invoked by turbo (AC #2) | ✅ present in gate output, 4 files / **19 passed** |
| `@taxi/dispatch:build` / `@taxi/admin:build` under the react override | ✅ both `Compiled successfully` |
| `@taxi/api:test` | ✅ 50 suites / **409 passed** |
| `@taxi/rider` + `@taxi/driver` typecheck | ✅ green |
| Redis-backed suites | ✅ no skips (`REDIS_TEST_URL` set to 6381 per this machine) |
| `pnpm install --frozen-lockfile` (what CI runs) | ✅ exit 0 — lockfile consistent with root `package.json` |
| Dependency pins on Node v20.20.2 | ✅ vitest 3.2.7, jsdom 26.1.0, jest-dom 6.9.1, RTL 16.3.2, dom 10.4.1 |

**Mutation checks (AC #6) — the proof the suite has teeth. Both reverted.**

1. **M1** — reintroduced the shipped bug in `tracking-map.tsx`
   (`timeOf(new Date(view.position.at))` → `timeOf(lastSeenAt ?? new Date(view.updatedAt))`):
   **`1 failed | 9 passed`** — only the stale-GPS test. Surgical, no collateral.
2. **M2** — replaced `{formatMessage(lang, 'page.retry')}` with `{'↻'}`:
   **`1 failed | 15 passed`** — only the M2 test.

**Change surface (AC #8)** — `git diff --stat` over `states.tsx`, `tracking-map.tsx`, `data/route.ts` and
`layout.tsx` is **empty**; over `page.tsx` it is exactly **1 insertion, 1 deletion**. `turbo.json` and
`ci.yml` diffs are **empty**.

## Deviations from the plan

**1. The react override direction was flipped: `19.2.4` → `19.2.3`.** This is the plan's own documented
fallback (OPEN QUESTIONS #5: *"If Expo objects, the fallback is to align in the other direction… The finding
is that one instance matters, not which version wins"*), and Expo objected concretely. Task 0's VALIDATE asked
for an Expo boot check; `expo start` gave no usable signal (buffered, non-TTY), so I ran the stronger check
with the already-installed Expo CLI:

```
$ pnpm --filter @taxi/rider exec expo install --check     # with override 19.2.4
  react@19.2.4 - expected version: 19.2.3      ← Expo SDK 57 pins react exactly
  expo@57.0.2 - expected version: ~57.0.12     ← pre-existing drift, unrelated
  react-native@0.86.0 - expected version: 0.86.2  ← pre-existing drift, unrelated
```

Under `19.2.3` the react line **disappears**; only the two pre-existing drifts remain (they are on `main`
independently of this ticket). All four properties the plan actually needs still hold: no unmet peers, one
react instance at the workspace root, no nested copies, and 19/19 tests pass.

*Consequence worth reviewing:* `apps/dispatch` and `apps/admin` declare `"react": "19.2.4"` but now resolve
`19.2.3`. I deliberately did **not** edit those declarations — that would widen the diff past the plan's
stated change surface, and rewriting a resolution is exactly what `pnpm.overrides` is for. Both apps'
`next build` compiles cleanly under it (verified above). Next 16 peers `react ^19`, so this is in-range.

*Upside:* the plan reserved its residual 0.2 confidence for "Expo runtime under React 19.2.4, unverified
without a simulator." Aligning to 19.2.3 means rider/driver now resolve **exactly the version they already
declared and shipped** — that residual risk is gone rather than merely unmeasured.

**2. 19 tests, not the spike's 17.** Three additions, all within the plan's named scope: the `StatusScreen`
`lang`-attribute assertion (the plan's context notes call the attribute out), the `langFrom` edge case split
into two tests (unknown value / array value) for a clearer failure message, and the optional `generateMetadata`
test the plan offered.

**3. `page.tsx` retry `href` — a behavior change on a shipped page**, as the plan requires be called out
explicitly rather than buried. `<a href="">` renders its text but `queryAllByRole('link')` returns **0**: an
empty `href` maps to no role, so the only affordance on the API-down screen was invisible to VoiceOver/
TalkBack. Now `href={`/t/${token}?lang=${lang}`}` — same form as the language-switcher anchors in the same
file, and it preserves `?lang` so a retry does not silently drop the reader back to Latvian. A full navigation
*is* the retry (the file's own comment says so); no `onClick`, which would force `'use client'` on the page.

**4. Process deviation: built in a git worktree**, not the main tree — see "Where the work lives" above.

## Issues encountered

**`@taxi/api:test` failed on the Phase 1 gate run — shared-Postgres contention, not a regression.** The first
full-gate run showed 6 failed suites / 35 failed tests, all `duplicate key value violates unique constraint
"users_phone_unique"`. Attribution evidence, in order:

1. The `users` table was **empty** afterwards (`select … where phone like '+37121%'` → 0 rows), so this was not
   stale leftover data — it was a concurrent writer.
2. Four worktrees share the one `taxi-db-1` Postgres container, and the api suite inserts fixed phone numbers.
3. Re-run in isolation: **409/409 passed, exit 0**. The final full gate also passed 409/409.

Nothing in this ticket touches `services/api`. Worth a follow-up ticket: the api integration suite is not safe
to run from two worktrees at once (per-run schema or randomized phone fixtures would fix it).

**`docker compose` from a worktree derives a new project name** and would have started a second Postgres,
colliding on 5432. Ran the gate with `COMPOSE_PROJECT_NAME=taxi` so `pretest` reuses the existing healthy
containers. Worth knowing for any future worktree run; nothing was changed in the repo for it.

**No second a11y defect found.** The plan asked that a second one be reported rather than fixed — there wasn't
one in the tested surface.

## Follow-ups this surfaced (not done here, per Non-Goals)

- A lint rule for hardcoded user-facing strings (the plan explicitly deferred it).
- Isolate the api integration suite so concurrent worktrees cannot collide on the shared database.
- `expo@57.0.2` → `~57.0.12` and `react-native@0.86.0` → `0.86.2` drift exists on `main`, independent of this
  ticket.

## Ready for the next step

All validations pass. Next: `piv-commit`, then `piv-create-pr` (PR body should carry `Closes #88`, note that
#18 is unblocked, and surface Deviations 1 and 3), then `piv-review-pr`.
