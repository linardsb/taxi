# Implementation Report — scope the ~500-line rule to shipped source, and make it executable

**Plan**: `.claude/plans/file-length-rule-shipped-source.md`
**Branch**: `feature/file-length-rule-shipped-source` (worktree `/Users/Berzins/Desktop/taxi-filelen`, base `085ef88`)
**Status**: COMPLETE

## Summary

CLAUDE.md's `Max ~500 lines per file` now binds **shipped source** — what each package's build compiles —
with specs, `test/`/`tests/` and `scripts/` explicitly outside the rule and uncapped (#112, option B-broad).
The amendment was propagated to the three live surfaces that restate it, and then made executable: `max-lines`
at 500 with a dev-instrument override is written into **three** config files and is thereby effective in
**all five** packages that run eslint — via the shared base for `services/api`/`db`/`packages/shared`, and
restated in `apps/dispatch`/`apps/admin`, which do not consume the base. The rule is now a gate failure rather
than a reviewer's judgement. No source file was edited — the ten over-length files become compliant by
amendment, not by edit.

Every figure below carries provenance. Figures inherited from the plan were **re-derived**, not copied; two
came out different and the re-derived value is what is reported.

## Tasks completed

| # | Task | File | Action |
|---|---|---|---|
| 0 | Audit the seam arithmetic + file survey | — | VERIFY (see below) |
| 1 | Amend the rule | `CLAUDE.md:61` | UPDATE |
| 2 | Propagate + escape-hatch guard | `.claude/agents/code-reviewer.md:46-47` | UPDATE |
| 3 | Propagate | `.claude/skills/vertical-slice-audit/SKILL.md:151` | UPDATE |
| 4 | Propagate | `docs/build-playbook.md:156` | UPDATE |
| 5 | Rule + override in the shared base | `packages/config/eslint/base.mjs` | UPDATE |
| 6 | Rule + override (does not consume base) | `apps/dispatch/eslint.config.mjs` | UPDATE |
| 7 | Rule + override (does not consume base) | `apps/admin/eslint.config.mjs` | UPDATE |
| 8 | Prove the gate fires | — | VERIFY (see below) |
| 9 | Close the loop on D1 | `.claude/code-reviews/pr-110-review.md` | UPDATE |
| 10 | Run the validation gate | — | VERIFY (green) |

## Task 0 — the audit (AC #1)

All at base `origin/main` `085ef88`, which is where the plan measured; `origin/main` had not moved.

**1. `mint-tracked-ride.ts` = 1414 lines.** `observed` — `wc -l services/api/scripts/mint-tracked-ride.ts`.

**2. Exactly ten `.ts`/`.tsx` files over 500.** `observed` — the plan's survey command over every tracked
`.ts`/`.tsx` on `origin/main`. Reproduced the plan's table line-for-line: 1414 / 857 / 789 / 676 / 668 / 614 /
608 / 539 / 508 / 502. All ten sit inside `services/api/tsconfig.build.json`'s exclude set
(`["node_modules", "test", "dist", "scripts", "**/*spec.ts"]`) — nine are specs or `test/harness.ts`, the tenth
is the script.

**Largest shipped source = 447** (`services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts`).
`observed` — same survey with specs, `test/`, `tests/`, `scripts/` and `*.test.*` filtered out. Next four:
439, 413, 399, 343. **Headroom = 53 lines** (`derived`, `500 − 447`; both terms `observed`, and the 500 term
confirmed by the boundary probe below rather than assumed).

**3. The review's "three clean seams" leave 1007 lines in one file — not compliance.**
The seams are real: they land on the file's own section banners. `observed` — `grep -n "^// ─"` gives the
banner map `102 · 209 · 243 · 348 · 969 · 1047 · 1347`. From it:

| seam | range | lines | provenance |
|---|---|---|---|
| jitter geometry + guards | 102–208 | **107** | `derived` — `208 − 102 + 1`, boundaries `observed` from grep |
| report + assertions | 1047–1346 | **300** | `derived` — `1346 − 1047 + 1`, boundaries `observed` from grep |
| *"the run"* (remainder) | — | **1007** | `derived` — `1414 − 107 − 300` |

**Deviation from the plan's figure**: the plan carried `~297` and `~1010` from ranges read off a symbol
outline (`[104-210]`, `[1049-1345]`). Measured to the banner lines the second seam is 300, not 297, so the
remainder is **1007**, not 1010 — a 3-line difference from where the boundary is drawn. The conclusion is
unchanged and the plan's stop-and-re-scope condition is not triggered: 1007 is **2.0×** the cap (`derived`,
`1007 / 500`), so option A as the review scoped it never reached compliance. Reported at 1007 because
CLAUDE.md requires re-derivation rather than inheritance.

## Task 8 — the induced-failure control (AC #7)

Padding used `// pad` comment lines rather than blank lines: `skipBlankLines: false` counts blanks, but
prettier collapses consecutive blanks and strips trailing ones, which would have added `prettier/prettier`
errors to the run being read. Consecutive comment lines are prettier-clean and counted (`skipComments: false`).

**The boundary, measured rather than assumed** — on `ride-lifecycle.service.ts` (447 → padded):

| `wc -l` | result | provenance |
|---|---|---|
| 447 (base) | silent | `observed` |
| **500** | **silent** | `observed` |
| **501** | **error** | `observed` |

Exact message at 501:

```
/Users/Berzins/.../services/api/src/features/rides/lifecycle/ride-lifecycle.service.ts
  501:1  error  File has too many lines (501). Maximum allowed is 500  max-lines
```

**Assumption #1 is confirmed, not inferred**: `max-lines` counts physical lines exactly as `wc -l` does, and
`max: 500` means 500 passes / 501 errors. The 53-line headroom figure stands as stated. After
`git checkout --`, `@taxi/api` lint returned to `0 errors, 7 warnings` (the 7 are pre-existing
`no-unsafe-argument` warnings on integration specs, present at base).

**The exempt set stays silent, non-vacuously.** Four of the six override globs have a real over-500 file
behind them, so lint staying green is a genuine test rather than a tautology:

| glob | file that exercises it | lines | result | provenance |
|---|---|---|---|---|
| `**/scripts/**` | `services/api/scripts/mint-tracked-ride.ts` | 1414 | silent | `observed` |
| `**/*.spec.ts` | `dispatch.integration.spec.ts` (+7 more) | 857 | silent | `observed` |
| `**/test/**` | `services/api/test/harness.ts` | 508 | silent | `observed` |
| `**/*.test.tsx` | `apps/dispatch/.../tracking-page.test.tsx`, padded | 576 | silent | `observed` |
| `**/*.spec.tsx` | — none over 500 | — | silent | `expected` (vacuous) |
| `**/*.test.ts` | — none over 500 | — | silent | `expected` (vacuous) |
| `**/tests/**` | — none over 500 | — | silent | `expected` (vacuous) |

The last three are stated as `expected`: those files would be silent with no override at all, so their
silence is not evidence the glob spelling is right. `**/scripts/**` is the load-bearing one and is genuinely
tested — `services/api`'s lint glob is `"{src,test,scripts}/**/*.ts"`, so `scripts/` **is** linted.

**The `apps/dispatch` / `apps/admin` risk is settled.** The plan's residual 0.5/10 was that
`eslint-config-next`'s `defineConfig` + spread + trailing `globalIgnores` shape could leave the rule present
in the file yet inert. Probed in both apps, `observed`:

- `apps/dispatch/.../tracking-map.tsx` 338 → 501 → `File has too many lines (501). Maximum allowed is 500`.
  In the **same run**, `tracking-page.test.tsx` at 576 was silent. One run, both controls: the rule fires and
  the override holds.
- `apps/admin/src/app/page.tsx` 65 → 501 → same error. Reverted; lint clean.

**Where enforcement is `observed` and where it is `derived`.** The rule was induced to fail in three of the
five packages — `services/api`, `apps/dispatch`, `apps/admin` (`observed`, messages quoted above). For `db`
and `packages/shared` it is `derived`: both spread the identical `base.mjs` array, neither sets `max-lines`
in its own config so nothing re-enables or overrides it, and neither has a file near 500 to induce a failure
on without inventing one. The condition that derivation assumes is exactly that no package config sets
`max-lines` — checked, `observed`: `grep -rn "max-lines" --include="eslint.config.*"` hits only the three
files this ticket edited.

**The exempt globs do not reach into shipped source.** `**/test/**`, `**/tests/**` and `**/scripts/**` are
path-segment globs and match at any depth, whereas `services/api/tsconfig.build.json`'s `exclude` entries are
bare names resolved relative to the tsconfig directory. A nested `src/features/foo/scripts/helper.ts` would
therefore be compiled by the build *and* exempted by the gate, which would make CLAUDE.md's "what each
package's build compiles" false. Checked and empty (`observed`): no tracked `.ts`/`.tsx` on `origin/main`
sits under a `test/`, `tests/` or `scripts/` segment other than the four package-root directories
`services/api/test/`, `services/api/scripts/`, `db/tests/`, `packages/shared/tests/`. The two sets agree
today. This closes the direction the plan's Assumption #2 left unchecked — it verified the converse
(`.test.ts` under `services/api`: zero) but not nesting. If a nested `scripts/` is ever added under a `src/`
tree, the glob is the source of truth and it will silently exempt shipped source.

## Tests added

None, and none were called for — no product code changed and no slice was touched. The gate itself plus the
induced-failure controls above are the test, per the plan's testing strategy.

## Validation results

| Level | Command | Result |
|---|---|---|
| 1 | `pnpm turbo run lint --force` | **green** — 7/7 tasks, 0 errors, 7 pre-existing warnings |
| 5 (gate) | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | **green** — 21/21 tasks, 0 cached |

`@taxi/api`: 54 suites / 462 tests passed, 0 skipped — `REDIS_TEST_URL` was set, so the opt-in Redis suites
(`redis-kv.store`, `redis-driver-location.store`, `redis-dispatch-queue.store`) ran rather than
`describe.skip`-ing. Docker `taxi-db-1` (5432) and `taxi-redis-1` (6381) were already healthy.

**AC #9 — nothing was edited to make it green.** `git diff --name-only origin/main` over all ten
over-length paths returns empty; they are byte-identical to base. As of commit `efefcd8`, the diff is
8 files excluding the two PIV artifacts committed alongside (10 total), **81** insertions / 4 deletions
— `observed`, `git show --numstat efefcd8` less the plan's 768 and the report's 223 — all rules, docs or
eslint config, **zero source files**. Later commits on the branch, including this review pass, add to
those counts without touching source.

## Deviations from the plan

1. **Task 5's validation command gives a false red in a fresh worktree.** The plan specifies
   `pnpm --filter @taxi/api lint && ... @taxi/db lint && ... @taxi/shared lint`. Run directly, api produced
   **3686 errors** and db 14 — all `no-unsafe-*` / "type that cannot be resolved". Confirmed pre-existing and
   unrelated to this change by re-running on a stashed tree: identical failure. Cause is documented in
   `turbo.json` itself — `lint` `dependsOn: ["^build"]`, because type-aware rules need the workspace deps'
   `.d.ts`. **Used `pnpm turbo run lint --force` instead**, which builds deps first. Zero `max-lines` hits
   either way. Worth folding back into the plan template: per-package `pnpm --filter … lint` is not a valid
   validation step in this repo on a cold dist.
2. **Task 8 padded to exactly 500 then 501, not to ~507 as written.** AC #7 demands "the observed 500/501
   boundary"; a single 507-line probe cannot distinguish a 500 threshold from a 501 one, nor ESLint's
   line-counting from `wc -l`'s, and would have left Assumption #1 inferred rather than observed. Two probes
   on the same file settle it. This is the plan's own "measure the boundary, do not confirm it" GOTCHA taken
   literally.
3. **Task 8's `apps/dispatch` probe was run as a dual probe** — a component padded past the cap *and* a
   `.test.tsx` padded past the cap, in one run. The plan asked only for an induced failure there. The second
   half converts `**/*.test.tsx` from a vacuous claim into an observed one at no extra cost.
4. **Task 0's seam remainder is reported as 1007, not the plan's ~1010** — see Task 0 above. Re-derived from
   banner-exact boundaries. Conclusion unchanged.
5. **AC #3's grep was scoped to line 61.** As written,
   `grep -nE "trajectory check|review call|1414|447|apps/rider" CLAUDE.md` runs over the whole file and hits
   `apps/rider` twice — in the pre-existing monorepo map table (line 9) and the architecture diagram (line 22),
   neither of which this ticket touches. The AC's intent is that the *amended bullet* contains no census;
   `sed -n '61p' CLAUDE.md | grep -oE …` returns nothing, which is the check that means what the AC means.
6. **No `.env` was needed in the worktree.** The plan's concurrent-session note implies one; the gate ran
   green without it because the shared `taxi-db-1` / `taxi-redis-1` containers were already up on the default
   ports. Copying `.env` is blocked by this repo's `pre_tool_use.py` secrets hook, so this is worth knowing:
   the known worktree false-red did not occur here.

## Issues encountered

- **`git worktree add` with a relative path resolves against `-C`, not the shell cwd.**
  `git -C taxi worktree add … taxi-filelen` created the worktree *inside* the main checkout at
  `taxi/taxi-filelen`. Fixed with `git worktree move`; use absolute paths.
- **Open Question #2 in the plan is stale and needs no follow-up.** It flags
  `.claude/plans/mint-ride-sub-cell-jitter.md` as untracked with #110 merged. At base `085ef88` the file
  **is** tracked (`git ls-tree origin/main .claude/plans/` lists it) — it was untracked only in the
  `bea4222` tree the plan was written in, two merges behind. `pr-110-review.md`'s line pins into it resolve.
- **Open Question #1 stands, unchanged and real.** `apps/rider` and `apps/driver` have no eslint config and
  no `lint` script — confirmed, `observed`. The enumeration is complete: exactly five `eslint.config.*` files
  exist outside `node_modules`, three consume `@taxi/config/eslint/base.mjs` (`services/api`, `db`,
  `packages/shared`) and two do not (`apps/dispatch`, `apps/admin`). Tasks 5–7 therefore cover **all five**,
  which is what makes CLAUDE.md's "every package that runs eslint" true today. It is not self-maintaining: a
  future `apps/rider` lint script would falsify it on the day it lands. Candidate follow-up ticket.
- **The residual risk B-broad accepts is unchanged and should be stated in the PR body.** Nothing now bounds
  `mint-tracked-ride.ts`'s growth — `scripts/` is uncapped by decision, and after Task 2 the review agent is
  explicitly told not to flag it for length. The trajectory concern #112 closes on (`898 → 1414` = **+516**,
  **+57.5%**, `derived`, across the two tickets that touched the file) is **not** solved. That is a recorded,
  deliberate call, not an oversight.

## Ready for the next step

All ten tasks complete and all validations green. **AC #1–#9 met** at implementation time.

**AC #10 met on PR open** — https://github.com/linardsb/taxi/pull/113 (`chore: scope the 500-line rule to
shipped source and enforce it (#112)`, `main` ← `feature/file-length-rule-shipped-source`). It could not be
asserted before the body existed, so it was carried as `expected` until then. Every figure in that body
carries `observed` / `derived` / `expected` with its arithmetic, and the seam numbers are this report's
re-derived `300`/`1007` rather than the plan's inherited `~297`/`~1010`. One further figure was re-derived
while writing it and is `observed` at first hand rather than inherited: the pre-#108 line count is **898**
(`git show 00e5699:services/api/scripts/mint-tracked-ride.ts | wc -l`), so the growth figure is `+516`
lines / **+57.5%** (`derived` — `516 / 898`). `pr-110-review.md` says "~899"; 898 is the measured value.

Shipped in commit `efefcd8` — 10 files, 1072 insertions / 4 deletions, zero source files. Next:
`piv-review-pr 113`, then a human approves.
