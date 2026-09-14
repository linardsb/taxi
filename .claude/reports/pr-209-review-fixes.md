# PR #209 — round 1 review fixes

**Review** `.claude/code-reviews/pr-209-review.md` (on branch `docs/pr-209-review`) · **Branch**
`fix/harness-teardown-windows-208` · **PR** #209, OPEN at fix time · 2026-09-14

Round 1 raised one Medium and six Lows, no Critical and no High. **All seven are addressed here**; nothing
was deferred as a finding. The one thing deliberately *not* fixed is the window behind M1, which the review
itself scoped to a separate ticket — filed as **#211**.

## Triage

| # | Sev | Call | Where |
|---|---|---|---|
| M1 | Medium | **Fix now** (the comment) + **file an issue** (the window) | `harness.ts`, `issue-208-fix.md`, #211 |
| L1 | Low | **Fix now** | `redis-io.adapter.spec.ts` |
| L2 | Low | **Fix now** | `issue-205-fix.md` |
| L3 | Low | **Fix now** | `test-harness.spec.ts` |
| L4 | Low | **Fix now** | `harness.ts` |
| L5 | Low | **Fix now** | `redis-io.adapter.spec.ts`, `issue-208-fix.md`, PR body |
| L6 | Low | **Fix now** | PR body |

The "Minor, not raised as findings" note (a repeated `adapter as unknown as {…}` cast) is **not** taken: it
is a readability point on a cast that fails loudly if its premise breaks, and the second site now carries
its own context through `breakingConfigure`'s docblock.

## What was fixed

### M1 — `configure` is outside the `try`, and the comment denied it

**Was wrong:** the comment above the `try` asserted *"EVERY step that can throw sits inside this `try`"*,
and `options.configure` — called on the line above it, and the callback #208 made the owner of "whatever it
opened" — is a step that can throw and is not inside it.

**Fixed:** the absolute is scoped to "Every step **AFTER `configure`**", with the exception named inline
rather than left to be discovered (`services/api/test/harness.ts:564-572`), and
`.claude/reports/issue-208-fix.md`'s *Not done* gains a bullet carrying the review's `observed` repro, the
real-machine reachability argument, and the reason a one-line move does not close it.

**Not fixed, by design:** the window itself. Moving the call inside the `try` is necessary but not
sufficient — `connectToRedis` pings before it assigns (`redis-io.adapter.ts:37-41`), so a rejection at `:39`
leaves `this.pubClient`/`this.subClient` undefined and `dispose()` reaches nothing even when called. That is
a change to shipped source. **Filed as #211**, with the repro, the AC list, and the scope line.

**Test:** none — this finding is a false claim in a comment, not behaviour. The claim is now checkable
against `harness.ts:562` (the `configure` call) and `:595` (the `try`), both `observed` in the tree.

### L1 — `ended()`'s budget spanned a whole boot, and its timer rejected a promise nobody held

**Was wrong:** `ended()` started a 2 s rejecting timer at the watch. At the new call site the watch starts
inside `configure`, *before* `app.init()`, so the budget had to cover a full `AppModule` boot + listen +
close + dispose + quit. If it fired, the case reddened with `client still ready 2 s after close()` —
claiming `close()` was reached when it may never have been. Second half: `Promise.all(ending)` is attached
only after the `rejects` assertion resolves, so a timer firing during the boot rejected an unheld promise.

**Fixed** (`redis-io.adapter.spec.ts:225-264`): the watch and the budget are split. `ended(client)` attaches
the `end` listener and returns a **getter**; the getter starts the budget, so `END_BUDGET_MS` is counted
from the await, not from the watch. The budget arm now **resolves** with the live status instead of
rejecting, and the race `.finally`-clears the timer on both arms (a live 2 s handle is the #200 shape).

**Deviation from the review's prescribed fix, stated:** the review prescribed the bare
`resolve(client.status)` swap. That closes the unattached-rejection half and leaves the budget half — and
under it a slow-boot timeout and a genuinely-unrun teardown both print `Received: ["ready", "ready"]`, so
the flake becomes indistinguishable from the regression the case exists to catch. Starting the budget at
the await is what separates them. The review's "derive the duration into the message" half is moot once
nothing rejects; the duration is a named constant (`END_BUDGET_MS`) instead, referenced by the docblock.

**Test:** the existing three cases, plus the probe below. The pre-existing call site at `:263` — the one
place the shape change could quietly alter behaviour — is green.

**Probe (probe B re-run under the new mechanism).** One hunk, `+0 −13`, the teardown `try` deleted:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout 90 npx jest \
  src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts
  EXIT=124 · Tests: 2 failed, 12 passed, 14 total · 1 "did not exit"
  ● … › quits the adapter when init() rejects before registerModules() (expected)
      - Expected  - 2        Array [
      + Received  + 2        -  "end", -  "end", +  "ready", +  "ready", ]
```

`observed` 2026-09-14. The new text is exactly what the review predicted, the exit-124 signature survives,
and both W1 cases stayed green. `harness.ts` restored from a saved copy and `cmp`-verified.

### L2 — `issue-205-fix.md`'s digits resolved to the fix that refutes them

**Was wrong:** the *Superseded by #208* banner retired the section's conclusion; its live `harness.ts` line
references underneath still resolved in the current tree, and to the opposite of what they say.

**Fixed** (`.claude/reports/issue-205-fix.md:53-56`): one clause on the banner pinning every line number in
the section to **`3d4046c`** — the commit that landed #205 — with the reader's command
(`git show 3d4046c:services/api/test/harness.ts`).

**The sha was re-derived, not inherited.** The review's L2 text quotes the *current* tree's numbers; the
banner needed the *old* tree's commit, which the review does not name. `observed` at `3d4046c`: `:586` ends
the `try` body (`} catch (err)` at `:587`), `:608` is the listen, `:619` the `DRIZZLE` resolution,
`:599-607` the comment — all four of the section's digits exact. The pin is deliberately a sha rather than a
restatement of today's line numbers: a restatement goes stale on the next edit, which is the same defect one
layer down.

**Test:** none applicable (prose in a report).

### L3 — the teardown-masking guarantee had no test

**Was wrong:** `harness.ts` guarantees *"anything thrown by the teardown path — `close()` or the `configure`
teardown — is printed and the ORIGINAL is rethrown; neither is ever allowed to mask it."* Neither `catch`
block was executed by any case in the suite.

**Fixed:** one new case, `rethrows the boot error when the teardown path throws too (failure)`
(`services/api/src/test-harness.spec.ts:142-188`). `app.init` rejects with the boot error; `app.close` is
**wrapped** so the real close still runs and *then* throws; the `configure` teardown rejects. The case
asserts `createTestApp` rejects with the **boot** error, and that both teardown errors were printed —
message and caught error, in order.

**Two deviations from the review's prescribed fix, both stated:**
1. **Ungated, in `test-harness.spec.ts`, not gated in the adapter spec.** A throwing teardown needs no Redis
   — no adapter, no clients. Gated, it would run only where `REDIS_TEST_URL` is set, which is the opposite
   of what L3 asks for: the point is that these lines execute on every suite run.
2. **It covers both masking `catch` blocks, not just the new one.** The review noted the `close()` catch has
   the same hole and that this argues for one case, not for leaving it. Wrapping rather than replacing
   `close` is what makes covering both safe — a stubbed-out close would test the guarantee by leaking the
   thing the guarantee exists to release.

**Probes, one hunk each** (the case run against the unfixed code, both reproduced):

| Probe | Hunk | Result |
|---|---|---|
| **C1** | the `configure` teardown's guard removed (`+1 −8`) | ❌ exit 1, `1 failed, 4 passed, 5 total` — `Expected substring: "probe: boot failed"` / `Received message: "probe: teardown boom"` |
| **C2** | `app.close()`'s guard removed (`+1 −8`) | ❌ exit 1, `1 failed, 4 passed, 5 total` — `Expected substring: "probe: boot failed"` / `Received message: "probe: close boom"` |
| **Green** | fixed | ✅ exit 0, `14 passed, 14 total` across both spec files, 2.355 s |

`observed` 2026-09-14, `COMPOSE_PROJECT_NAME=taxi timeout 120 npx jest src/test-harness.spec.ts`. The four
pre-existing cases in the file stayed green in both probes — the attribution. `harness.ts` restored from a
saved copy after each and `cmp`-verified.

### L4 — the `configure` JSDoc omitted both constraints the implementation depends on

**Was wrong:** the JSDoc explained why a teardown may be returned and that nothing calls it on the success
path. It said neither of the two things a caller has to honour.

**Fixed** (`services/api/test/harness.ts:503-518`): two bullets. **Idempotent**, because the teardown runs
after `app.close()` on every failure, with the `() => server.close()` / `() => pool.end()` counter-examples
named and `RedisIoAdapter.dispose()`'s ref-clearing given as what qualifies it. **Failure-path lifetime**,
because nothing calls it when the boot succeeds and `TestApp` exposes no hook to — so a resource `close()`
can never reach leaks on every green run.

**Test:** none — this is the JSDoc stating constraints the code already depends on. The idempotency
constraint is exercised by the existing `listen()` case (the teardown's second pass after a `close()` that
already disposed); the lifetime constraint is a contract on future callers, not behaviour.

### L5 — the `init()` case reproduces the window's state, not the span

**Was wrong:** `app[step] = () => Promise.reject(…)` replaces `NestApplication.init()` wholesale, so the
span the case is named for (`nest-application.js:99-102`) is never entered. Three surfaces overstated this
as reproducing each failure *exactly*.

**Fixed on all three:**
- `redis-io.adapter.spec.ts:306-312` — the `describe` docblock now says it reproduces the **state** each
  failure leaves the app in, "the state, not the span".
- `redis-io.adapter.spec.ts:349-358` — the `init()` case's comment says the replacement *stands in for* a
  rejection inside that span, names what makes them indistinguishable (`applicationConfig` unset, the only
  state `close()` reads at `socket-module.js:50`), and says what the case is therefore evidence **of**: that
  the teardown closes the window, not where the window is.
- `.claude/reports/issue-208-fix.md:47-52` — the same narrowing, as its own paragraph, pointing at
  *Mechanism* as where the "where" is actually established.
- **PR body** — "drives each failure exactly" → the state formulation (see *PR body* below).

**Test:** none — naming, not behaviour. The review reached the same conclusion ("the case is sound and the
fix it pins is real … naming, not evidence").

### L6 — a test-time comparison that isolated nothing

**Was wrong:** *"`@taxi/api` test time is 43.7 s here against ~50 s at #206, so the extra app the ungated
case builds costs nothing measurable"* — two figures from two gate runs on a box running other work, with
nothing held constant, and the sign the wrong way round for the claim.

**Fixed:** the attribution is dropped from the PR body and replaced with what the figures support — no
run-to-run regression visible at this resolution, with the spread stated and named as exceeding the effect.
See *PR body* below.

**Test:** none applicable.

## The value sweep

Every retired value and noun, the exact command, and its hits. Run from the repo root on the working tree
that became this report's own commit — the branch tip, one commit past `7dd7961`. `observed` 2026-09-14.

(A sha is not named here on purpose: a commit cannot cite its own hash, and the two attempts that tried
went stale on the next amend. The tip is `git log --oneline -1` on this branch; the PR body names it.)

**Exclusion is path-only — `--exclude-dir=node_modules`, never `| grep -v node_modules`.** The first pass
here used the pipe form and it silently ate a real hit: `pr-209-review-fixes.md:252` quotes a command
containing the string `node_modules`, so the filter dropped the content line and the sweep read "no hits"
on a value that was present. Every row below is the re-run under path-only exclusion.

| # | Command (all prefixed `grep -rn --exclude-dir=node_modules --exclude-dir=.git`) | Hits | Disposition |
|---|---|---|---|
| 1 | `"43\.7" --include='*.md' --include='*.ts' .` | 3, all in this file | the claim lived only in the PR body, and is retired there. These three are this report quoting the retired sentence in order to retire it, naming it in the sweep table, and stating the four-value spread in the gate stamp — none asserts it |
| 2 | `"costs nothing measurable" .` | 3, all in this file | same — the quoted claim, this table's own row, and the closing-commands row |
| 3 | `"s after close()" --include='*.md' --include='*.ts' .` | 8: `issue-208-fix.md:119,123,130`, `issue-205-fix.md:107`, `pr-206-review.md:106,155`, and 2 in this file. **`redis-io.adapter.spec.ts` is gone from the list** — the string no longer exists in source | `issue-208-fix.md:119,123` are quoted probe output from a run against a tree that no longer exists: **annotated, not edited** (the annotation sits directly under them), with the new failure text and a fresh `observed` re-run beside them. `issue-205-fix.md` and `pr-206-review.md` are #205's and #206's own records — out of this PR's scope, left alone. The two here are this report's own prose |
| 4 | `"EVERY step" --include='*.ts' --include='*.md' .` | 3, all in this file | **0 in shipped source and 0 in `issue-208-fix.md`** — the false universal is gone from everywhere that asserts it. The three are this report quoting it to retire it |
| 5 | `"exactly"` over the four touched files | 8, of which **0** are the retired claim | the three L5 surfaces are narrowed. The rest are different claims: `"Charged exactly once"`, `"exactly what the nine never-listening integration specs did"`, `"exactly the shape that holds jest open"`, `"exactly the cases that hunk is responsible for"`, `"the window is exactly init()'s :99-102"` — the last being the source read L5 explicitly leaves standing |
| 6 | `"three new cases\|one ungated case\|The third\|The fourth\|four new cases" .claude/reports/issue-208-fix.md` | 3 | heading re-counted to **four**; the *What changed* line re-counted to "two ungated cases" |
| 7 | `"13 passed, 13 total" .` | 3: `issue-208-fix.md:92,93`, plus this file's own sweep row | correct as written — those two are the A/B probe green runs at `ed3a0dd`, where the two spec files held 13 cases. A clause above that table now pins all four rows to that tree and points at the 14-case re-run |
| 8 | PR body | manual — **no working-tree grep reaches it** | four things re-derived at the branch tip rather than inherited: the `43.7 s` attribution (retired), "drives each failure exactly" (narrowed), `+327 −49` and the per-file counts (now `+773 −66`), and the gate stamp (`729` → `730`, `1m26.428s` → `1m18.751s`, `ed3a0dd` → `7dd7961`) |

## Validation

| Gate | Command | Result |
|---|---|---|
| Full CI-parity gate | `record-gate.sh --clean` (`pnpm turbo run typecheck lint test build --force` from cleared `dist`/`.next`), `COMPOSE_PROJECT_NAME=taxi`, Redis on 6381 | (stamped below) |
| The two touched specs, Redis-gated | `npx jest src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts` | ✅ exit 0 · `14 passed, 14 total` · 2.321 s |
| `@taxi/api` lint | `pnpm --filter @taxi/api lint` | ✅ exit 0 · `12 problems (0 errors, 12 warnings)` — all 12 pre-existing `no-unsafe-argument` warnings on `App` in integration specs, none in a file this pass touched |
| `@taxi/api` typecheck | `pnpm --filter @taxi/api exec tsc --noEmit -p tsconfig.json` | ✅ exit 0, no output |

`observed` — `record-gate.sh --clean` at `7dd7961` on a **clean** tree (it prints a `(dirty tree — …)` line
under the stamp whenever `git status --porcelain` is non-empty; this run printed none),
`COMPOSE_PROJECT_NAME=taxi`, Redis on 6381, exit 0:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m18.751s
```

    @taxi/api       Test Suites: 77 passed, 77 total · Tests: 730 passed, 730 total · 44.121 s
    @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
    @taxi/driver    Test Suites: 41 passed, 41 total · Tests: 218 passed, 218 total
    @taxi/rider     Test Suites: 29 passed, 29 total · Tests: 140 passed, 140 total
    @taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
    @taxi/shared    Test Files 24 passed (24) · Tests 231 passed (231)

Not in the graph: `@taxi/config#{build,lint,test,typecheck}`, `@taxi/driver#build`, `@taxi/rider#build` —
the same six as #199's, #203's, #206's and #208's stamps.

`730 = 729 + 1`, `derived`, on the condition that #208's 729 still holds at `ed3a0dd` — it does, that being
this PR's own re-run stamp, re-observed by the round-1 review at the same head. The one addition is L3's
masking case. Suite count unchanged at 77 because it went into an existing file.

**No test-time comparison is drawn.** `@taxi/api` ran 44.121 s here against 43.7 s at `ed3a0dd` and 45.666 s
in the round-1 review's re-run of that same commit — three values in one spread, on a box running other
work, with nothing held constant. That is the resolution available, not evidence about any mechanism (#209
review L6).

The stamp names `7dd7961`, the commit carrying every source change in this pass. The only commit after it is
this report's own gate stamp — `.claude/reports/pr-209-review-fixes.md` alone, which no gate task reads.

## Closing commands, run against the fixed tree

Each finding's closing line, with the command and when it ran. Nothing here is quoted from a run that
predates its own fix.

| # | Closing command | When | Result |
|---|---|---|---|
| M1 | `grep -n "EVERY step" services/api/test/harness.ts` · `gh issue view 211` | after the fix | no hits · #211 OPEN |
| L1 | probe B re-run (`+0 −13`), two spec files | after the fix | `EXIT=124`, `Received: ["ready","ready"]`, W1 pair green |
| L2 | `git show 3d4046c:services/api/test/harness.ts \| sed -n '586p;599,608p;619p'` | after the fix | all four digits exact at that sha |
| L3 | probes C1 and C2, one hunk each | after the fix | both reproduced; see the table above |
| L4 | — | — | JSDoc prose; no command |
| L5 | `grep -rn --exclude-dir=node_modules "exactly" <the four files>` | after the fix | 8 hits, 0 the retired claim |
| L6 | `grep -rn --exclude-dir=node_modules "43\.7\|costs nothing measurable" .` | after the fix, after this report was written | 4 hits, all this file quoting the retired claim or stating the spread; none asserts it. PR body re-checked by hand and re-derived at the branch tip |

## Not fixed, and why

- **The window behind M1** — its own ticket, **#211**, because closing it needs `connectToRedis` to assign
  before it pings (shipped source), not a change to `harness.ts`. The review scoped it that way too.
- **The "Minor" cast note** — a readability point on a cast that fails loudly rather than silently.
- **`CLAUDE.md`'s stale Redis-gated line** — pre-existing, disclosed in #208's report, and its own ticket.
  Untouched here.
