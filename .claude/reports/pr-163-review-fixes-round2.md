# PR #163 — round-2 review fixes

Input: `.claude/code-reviews/pr-163-review-round2.md` (head `800768f`, on
`docs/pr-163-review` / PR #164). Three Lows, no Critical, High or Medium.

Worked in a worktree off `fix/pr-154-deferred-lows` at `800768f` — the main
checkout is on `feature/no-model-pr-gate` (PR #167) and was not moved.

## Triage

| Finding | Call | Why |
|---|---|---|
| **L4** — the PR body's probe table mixes two trees and one row is wrong | **Fix now** | It is a PR-body edit, and the correct number makes the PR's own case stronger. |
| **L5** — the new `(edge)` case's routing assertion cannot fail | **Fix now** | One line, test-only, and it makes the case's name true. |
| **L6** — the `earnings` slice ships no `(edge)` case | **Deferred → #169** | Pre-existing; Linards's call. Widening this PR into a slice it only touched for #160/#161 is the wrong trade. |
| *Noted* — the rider's duplicated `formatEur` | **Deferred → #170** | Outside this diff. Should not be fixed on this branch. |
| N2 (a spec case for a throwing `emitStatus`), N3 (the live region inside a collapsed `Pressable`) | **Open by decision** | Round 1's won't-fix and the booked device day. Not re-opened. |

**A note on how L4 was fixed, because it is the point of the finding.** The
review's own corrected figures were **not** copied into the PR body. Every
digit below comes from a probe run in this worktree, on the tree that carries
L5's fix. Inheriting the reviewer's numbers would have reproduced L4 one level
down.

---

## L5 — `router.navigate.mockClear()` in `push-registrar.test.tsx`

**What was wrong.** `apps/driver/src/features/push/push-registrar.test.tsx`'s
new `(edge)` case asserted `expect(router.navigate).toHaveBeenCalledWith('/offer')`
after a tap — but `ctx!.receive(wire(), 'socket')` on the line above routes a
fresh card itself (`route_offer` → `router.navigate('/offer')`, with
`usePathname` mocked to `/home`). The expectation was satisfied by the setup.
The sibling case at `:176` clears between the `receive` and the tap for exactly
this reason; this one did not.

**The fix.** `router.navigate.mockClear();` after the `receive`, with a comment
saying why. No production change.

### Proof — the disproof run, before and after

The mutation is the review's: gate the tap hop out entirely at
`apps/driver/src/features/push/push-registrar.tsx:46`,
`if (hasCard()) router.navigate('/offer')` → `if (false && hasCard()) …`. The
tap path is then completely broken and the case must go red.

`observed` — **unfixed tree** (`800768f`), `pnpm --filter @taxi/driver test -- push-registrar`:

```
✓ a tap for an offer already answered does not move the driver (failure)
✕ an ids-only tap still opens the card the socket delivered (expected)
✓ a tap on any other notification goes to the gate (edge)
✓ the card the tap lands on draws through the real active-ride labels (edge)
Tests: 1 failed, 3 passed, 4 total
```

The new case stays **green** with the tap hop gone. That is the finding.

`observed` — **fixed tree**, same mutation, same command:

```
✓ a tap for an offer already answered does not move the driver (failure)
✕ an ids-only tap still opens the card the socket delivered (expected)
✓ a tap on any other notification goes to the gate (edge)
✕ the card the tap lands on draws through the real active-ride labels (edge)
Tests: 2 failed, 2 passed, 4 total
```

Mutation reverted both times; `git status --porcelain` showed only the intended
test-file edit after each.

`observed` — fixed tree, no mutation: `Tests: 4 passed, 4 total`.

### What the fix's mechanism newly permits

`mockClear()` erases the call record of `receive`'s own routing, so any future
assertion in this case about *receive-time* navigation would silently read
zero calls. There is none, and the case is named for the tap. `router.navigate`
is a bare `jest.fn()` from the `expo-router` mock with no implementation, so
`mockClear` (calls only, unlike `mockReset`) takes nothing else with it. The
`beforeEach` `jest.clearAllMocks()` is unaffected.

---

## L4 — the PR body's probe table

**What was wrong.** Five probe rows presented together with no tree named.
Three were correct at HEAD; two were carried over unaudited from round 1's tree
`1403135`, and `dispatch-notifier.spec.ts` grew from 8 tests to 9 when L2's
both-throw case landed. The `#158` row understated the fix it describes —
and its **sentence** was wrong as well as its digit, which is the half that
`CLAUDE.md`'s #120/#121 lesson is about.

**The fix.** All five probes re-run in this worktree, on the tree that carries
L5's fix, and the table rewritten with the tree stamped on it. `#158`'s clause
now names the third failing case.

### Every row, re-run

`observed` — each mutation applied, the filtered suite run, the mutation
reverted (`git status --porcelain` clean of it each time):

| Probe | Mutation | Command | Result |
|---|---|---|---|
| `#159` | `Buffer.byteLength(json, 'utf8')` → `json.length` at `dispatch-notifier.ts:75` | `pnpm --filter @taxi/api test -- dispatch-notifier.spec` | `1 failed, 8 passed, 9 total` |
| `#158` | main's shape restored — one shared `try` around `emitToRide` **and** the whole revoke loop, keeping L2's `revoke_failed` name so the run isolates #158 rather than the rename | same | `3 failed, 6 passed, 9 total` |
| `L2` | `dispatch.assign.revoke_failed` → `dispatch.assign.notify_failed` | same | `2 failed, 7 passed, 9 total` |
| `L1` | the `requireActual` spread dropped from this file's `@/features/active-ride` mock | `pnpm --filter @taxi/driver test -- push-registrar` | `1 failed, 3 passed, 4 total` |
| `#161` | the composed `accessibilityLabel` → main's static `accessibilityHint` at `home-screen.tsx` | `pnpm --filter @taxi/driver test -- home-screen` | `3 failed, 5 passed, 8 total` |

Two rows moved against the body:

- **`#158`: `2 failed` → `3 failed`.** The three that go red, by name:
  *"clears the LATER cards too when one revoke throws (failure)"*,
  *"still clears the cards when the ride-room emit is the thing that throws (edge)"*,
  and *"names the ride-room failure and a revoke failure apart in the log (edge)"* —
  the last being L2's both-throw case, which under a shared `try` sees
  `emitToRide` throw before the loop runs and emits one warn where the case
  asserts two. It is a second, independent pin on #158's per-driver `try`, and
  the body's "the failure and edge cases" hid it.
- **`#159`: `7 passed` → `8 passed`.** The failing case is still the UTF-8 one
  alone; only the suite total moved, 8 → 9.

Three rows reproduce the body exactly: `L1`, `L2`, `#161`. `#161`'s clause also
checks out — the third failure is `home-screen.test.tsx:185`, F4's name guard,
whose comment says outright that the amount stays inside the assertion.

### The sweep

`observed` — the retired **values**, over the tracked tree
(`git grep -n "<value>" -- .` from the worktree root):

| Retired value | Hits in the tree |
|---|---|
| `2 failed, 6 passed` | none |
| `1 failed, 7 passed` | none |

And the replacements, to confirm nothing else already carried them:

| New value | Hits in the tree |
|---|---|
| `3 failed, 6 passed` | none |
| `1 failed, 8 passed` | none |

The **subject**, not just the values — `git grep -n "probe\|#158\|#159" -- .claude docs`:
the only hits on this branch's own artifacts are in older review reports for
other PRs (`pr-107`, `pr-113`, `pr-116`, `pr-121`, `pr-34`, `pr-36`, `pr-142`,
`pr-147`), each anchored to its own tree. `.claude/reports/pr-163-review-fixes.md`
carries probe figures for **L1 and L2 only** (`:49` `1 failed, 3 passed, 4 total`,
`:84` `2 failed, 7 passed, 9 total`) — both re-observed above, both still true,
so the round-1 report needed no edit.

**The two stale figures existed only in the PR body**, which no working-tree
grep reaches. That is the finding's own point, and the reason this list exists.

---

## Validation

`observed` — full CI-parity gate in this worktree, from cleared `dist`, `.next`,
`.turbo` and `tsconfig.tsbuildinfo` (`fs.rmSync`; 2 paths existed in a fresh
worktree and were removed):

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 \
  pnpm turbo run typecheck lint test build --force
```

`22 successful, 22 total`, exit 0, 0 cached, 2m29.644s.

| Package | Result |
|---|---|
| `@taxi/api` test | 76 suites / **721** tests, 0 skipped (`REDIS_TEST_URL` set, so the 33 gated tests ran) |
| `@taxi/driver` test | 41 suites / **217** tests |
| `@taxi/shared` test | 24 files / 231 tests |
| `@taxi/rider` test | 30 suites / 143 tests |
| `@taxi/dispatch` test | 27 files / 224 tests |
| `@taxi/db` test | 3 files / 17 tests |
| `@taxi/api` lint | `✖ 12 problems (0 errors, 12 warnings)` |
| typecheck · lint · build | clean everywhere |

Every count is unchanged from round 1. **L5 adds no test** — it adds one line
inside an existing case — so `217` and `721` are the same figures the PR body
already carries, re-observed rather than inherited. Wall-clock differs
(2m29.644s here against the body's 1m30.096s) because this worktree built every
package from cold with no warm `dist` anywhere; that is machine state, not a
claim.

---

## Closing commands, run against the fixed tree

| Finding | Command | When | Output |
|---|---|---|---|
| L5 | `pnpm --filter @taxi/driver test -- push-registrar` | after the fix, no mutation | `Tests: 4 passed, 4 total` |
| L5 | same, with the tap hop gated out | after the fix | `Tests: 2 failed, 2 passed, 4 total` — the new case now red |
| L4 | the five probes in the table above | after L5's fix | as tabulated |
| L4 | `gh pr edit 163 --body-file …` then `gh pr view 163 --json closingIssuesReferences` | after the push | **5** — #157, #158, #159, #160, #161. Unchanged by the body rewrite, and the new `#169` / `#170` references were **not** picked up. |
| both | the full gate | after both fixes, before the commit | `22 successful, 22 total`, exit 0 |

The gate ran on the working tree a moment before `dab716e` was written. The
only thing the commit added on top of what was tested is this report, which no
task compiles, so the run describes `dab716e`'s tree.

## CI on the pushed head

`observed` — `gh pr checks 163` on `dab716e`:

| Check | Result |
|---|---|
| `check` (the CI-parity gate) | **pass** — https://github.com/linardsb/taxi/actions/runs/34480359594 |
| SonarCloud Code Analysis | **fail** — *Quality Gate failed: 3.2% Duplication on New Code (required ≤ 3%)* |

**SonarCloud is not this repo's gate and not this commit's failure.** #165 chose
CodeQL in Sonar's place: there is no `sonar` job in `ci.yml`, no
`sonar-project.properties`, and `git grep -il sonar` finds hits only in #165's
own plan and report. What runs is the SonarCloud **GitHub App**, auto-analysing
the repo since it was made public — outside `ci.yml` entirely, which
`.claude/reports/ci-no-model-pr-gate-report.md:104` already recorded as
Linards's to disable on the SonarCloud side.

`observed` — it never ran on this PR before:
`gh api repos/linardsb/taxi/commits/800768f/check-runs` returns **only**
`check`, and merged PRs #143, #156 and #162 have `check` alone as well. The
failing condition is a duplication threshold over the whole PR diff, not a
correctness finding, and this commit contributes six lines of test comment plus
one line of code.

## Deferred, with issue refs

- **L6** → **#169** — the `earnings` slice's missing `(edge)` case and the
  untested spinner branch, with the review's deletion probe recorded as the
  acceptance test.
- **The rider's duplicated `formatEur`** → **#170** — outside this diff; the
  one live copy round 1's `apps/driver`-scoped sweep could not reach.

## Needs a human

Unchanged from the review's routing — nothing here alters it:

- The device day already booked in `.claude/references/ui-decisions.md`: #161's
  two label states by ear, F4's offer-card label, and **N3** (whether
  `earnings-card.tsx:17`'s `polite` live region is still announced inside a
  collapsed `Pressable`).
- `dispatch-notifier.ts:130-183`, the assignment emit tail — the only
  dispatch-logic change in the PR, and the one place a wrong `try` boundary
  strands a driver's card.
