# Code Review — PR #51 · `chore(shared,db): give the contract seam and db layer a real lint task`

**Branch:** `chore/lint-coverage-shared-db` → `main` · **61 files, +1747/−950** · **State:** OPEN
**Reviewed at:** `f57cc79` · **Recommendation: Approve**, with M1 and M2 as required follow-ups

---

## Summary

The premise checks out. `.github/workflows/ci.yml:43` runs `pnpm turbo run typecheck lint test build`, and before
this branch `@taxi/shared` and `@taxi/db` had no `lint` task at all — turbo skipped them silently and the gate
still read green. The contract seam every app imports and the entire persistence layer were unlinted. This PR
fixes that, and the commit split (rename → mechanical reformat alone → wiring → report) is what made a 61-file
diff reviewable.

**The 52-file reformat is provably behaviour-preserving** (mechanical proof below — not a spot-check), the
validation gate is green from a cleared `dist/`, and no hard rule from `CLAUDE.md` is violated: money stayed
integer cents, `assertTransition()`'s table is unchanged, `isPaymentMethodLocked()` is intact, no contract left
`packages/shared`, and `packages/shared` still imports nothing from the workspace.

Zero Critical, zero High. Four Medium and five Low, every one of them a policy or hygiene gap rather than a
defect — there is no code path here that produces a wrong result. M1 and M2 are one-line changes that should
land before the next lint-touching ticket, because each currently leaves a check that reports success without
running: the same failure mode this PR exists to fix, at smaller scale, inside the fix.

### Stated limitation of this review

**The plan could not be consulted.** `.claude/plans/lint-coverage-shared-db.md`, linked from the PR body, is not
on this branch and not on `main` — it is stranded on the unmerged local branch `feature/api-dispatch-engine`
(commit `d9224b7`, verified via `git branch -a --contains`). The review process calls for separating *documented*
deviations (intentional decisions, not findings) from *undocumented* ones; without the plan, that discrimination
was made against the implementation report alone. The report's five listed deviations were taken as intentional.
If the plan contains constraints the report does not restate, this review could not have checked against them.

---

## The 52-file reformat: mechanically proven clean

The commit's stated purpose is "adopt the root prettier config," which makes *pure prettier output* a falsifiable
claim. It was tested directly rather than spot-checked — for all 52 files, the **pre**-reformat version was piped
through prettier and byte-compared against the **post**-reformat version:

```bash
for f in $(git show --name-only ca4f698 --format=""); do
  git show "ca4f698^:$f" | npx prettier --stdin-filepath "$f" > norm.txt
  git show "ca4f698:$f" > post.txt
  diff -q norm.txt post.txt >/dev/null || echo "DIFFERS: $f"
done
→ === checked 52 files, 0 differ ===
```

**Every one of the 52 files is exactly what `prettier --write` produces from its predecessor.** No hand edit hid
inside the reformat — not a dropped `.notNull()`, not a changed default, not an altered column type, not an added
state-machine edge. This is strictly stronger than comparing schema against DDL (which would pass a *changed
default value*) or `diff -w` (which would pass a changed string).

Corroborating, independently: `git show --name-only ca4f698` touches nothing outside `db/` and
`packages/shared/`; the `db` schema still matches the pre-existing drizzle-kit DDL in `db/migrations/*.sql`
column-for-column including every index, unique and FK; `ride-state-machine.ts`'s 14-state table matches
`.claude/references/ride-state-machine.md` row for row; and `enums.ts` matches the `CREATE TYPE` value lists
element-for-element and in order.

---

## Validation

Run from a cleared `dist/` (the mode CI hits; a warm local run hides it), with the Redis-backed suites opted in:

```
git clean -xdf -- packages/shared/dist db/dist services/api/dist
DATABASE_URL=… REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force
```

| Check | Result |
|---|---|
| Full gate, cleared `dist/`, `--force` | **20/20 tasks successful** (35.7s) |
| api test suites | 39 passed / 39 · **251 tests passed, 0 skipped** |
| api lint | 0 errors, **4 warnings** (`no-unsafe-argument`, pre-existing on `main`) |
| `@taxi/shared` lint | 0 problems |
| `@taxi/db` lint | 0 problems |
| Reformat = pure prettier output | **52/52 files identical** |
| Reformat scope (`ca4f698`) | confined to `db/` + `packages/shared/` |
| `prettier --check` on the two `vitest.config.ts` | **fails — see M1** |

The gate reproduces the PR's claim exactly. Note the api lint line: **4 warnings, and turbo still reported
20/20 successful.** That is the direct empirical proof behind M2.

---

## Issues

### Medium

#### M1 · `packages/shared/vitest.config.ts:1`, `db/vitest.config.ts:1` — two TS files no check can see

Both files still open with `import { defineConfig } from "vitest/config";` — double quotes, contradicting the new
root `.prettierrc` `singleQuote: true`. Confirmed failing:

```
$ npx prettier --check packages/shared/vitest.config.ts db/vitest.config.ts
[warn] packages/shared/vitest.config.ts
[warn] db/vitest.config.ts
```

They sit outside **every** glob in the PR: not in either `lint` script, and not in either `tsconfig.json`
`include` (`packages/shared/tsconfig.json:7` = `["src","tests"]`, `db/tsconfig.json:7` =
`["src","tests","drizzle.config.ts"]`). So they are neither linted, typechecked, nor format-checked — inside the
very two packages this PR is about.

To be fair to the report's wording: AC "One prettier config governs the monorepo" is *true* — the root config
does govern these files, they simply aren't formatted yet — and "All matched files use Prettier code style" is
prettier's own output string, not an author claim. This is imprecision in what the check demonstrates, not a
false AC.

**Fix — do both halves, in this order:** add `vitest.config.ts` to each package's `tsconfig.json` `include`,
*then* to the lint script (`eslint "{src,tests}/**/*.ts" vitest.config.ts`; db likewise alongside
`drizzle.config.ts`). Adding it to the glob alone is a hard failure — verified:

```
$ cd packages/shared && npx eslint vitest.config.ts
0:0  error  Parsing error: …/vitest.config.ts was not found by the project service.
            Consider either including it in the tsconfig.json or including it in allowDefaultProject
```

Minimum acceptable alternative: reformat both files to single quotes and leave the globs alone.

#### M2 · `packages/shared/eslint.config.mjs:31-32`, `db/eslint.config.mjs:31-32` — `'warn'` is indistinguishable from `'off'` in this gate

`'@typescript-eslint/no-floating-promises': 'warn'` and `'@typescript-eslint/no-unsafe-argument': 'warn'`.
Neither `lint` script passes `--max-warnings`, so eslint exits 0 and turbo reports success. The gate run above
proves it: api emitted `✖ 4 problems (0 errors, 4 warnings)` and the gate was still 20/20.

For `db` that means **an unawaited DB write — a lost migration step, a lost seed upsert — would ship green.**
The leniency was inherited from `services/api`, which has 4 pre-existing warnings and genuinely needs the escape
hatch. Both new packages lint at **0 problems**, so neither has earned it, and promoting costs nothing today.

Not escalated to High because it is a **policy** gap, not a defect: there are zero floating promises in either
package right now. It is a fence in the wrong position.

**Fix — your call between two:** set both rules to `'error'` in the two new configs; **or** add
`--max-warnings 0` to the two new `lint` scripts, which also covers every future `'warn'` and leaves api's four
warnings alone.

#### M3 · Three hand-maintained near-identical eslint configs — follow-up ticket, not a blocker

`packages/shared/eslint.config.mjs` and `db/eslint.config.mjs` are byte-identical to each other and differ from
`services/api/eslint.config.mjs` only by `...globals.jest`. The PR body itself records the sync cost: the
`no-unused-vars` option was **hand-mirrored into api** "so the three hand-maintained copies stay identical."
That is the drift mechanism, described in advance. `packages/config` already exists in this monorepo for exactly
this kind of preset.

**Fix (follow-up):** `packages/config/eslint/base.mjs` exporting the shared array; each package becomes
`tseslint.config(...base, { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } }, …)`.
`tsconfigRootDir` must stay per-package. **Gotcha:** `packages/config/package.json` has no `main`/`exports` —
`tsconfig/base.json` resolves today only because TS reads the path directly; a Node-loaded eslint preset needs
an `exports` map added first. Worth its own ticket, since this PR is what created the third copy.

#### M4 · `packages/shared/eslint.config.mjs:19` — `globals.node` on the isomorphic contract seam

`packages/shared` is imported by `apps/rider` and `apps/driver` (React Native) and by `apps/dispatch`/`apps/admin`
browser code. The new config now positively declares Node globals in scope for its `src/`. Two things verified
rather than assumed:

- It is **inert as a lint control** — typescript-eslint's `eslint-recommended` sets `no-undef: 'off'`, so
  `globals` cannot fire anything.
- It is **not backstopped by TypeScript** — `@types/node` sits at the repo root and TS's automatic `@types`
  lookup walks up to it; `packages/config/tsconfig/base.json` does not set `"types": []`. So `process.env.X`,
  `Buffer` or `__dirname` in `packages/shared/src` would compile cleanly.

Confirmed by grep that `packages/shared/src` and `tests` use **zero** Node globals today — an existing fence in
the wrong position, not a breach.

**Fix:** replace `...globals.node` with `...globals.es2022` in `packages/shared/eslint.config.mjs` (or drop the
`globals` import and devDep entirely — nothing there needs it). Optionally add `"types": []` to
`packages/shared/tsconfig.json` so TS enforces it too. **Keep `globals.node` in `db`** — it is correct there:
`db/src/migrate.ts:11` uses `__dirname`, `db/src/seed/run.ts:7,21` uses `process`.

### Low

#### L1 · `packages/shared/eslint.config.mjs:30`, `db/eslint.config.mjs:30` — `no-explicit-any: 'off'` on the contract seam

An explicit downgrade (the rule is `'error'` in `recommended`), inherited from api where Nest's decorator/DI code
needs it. `packages/shared/CLAUDE.md` says types derive from zod via `z.infer`, never a hand-written twin. Grep
confirms **zero** `any` types in `packages/shared/src` or `db/src` today, so enabling it costs nothing now and
stops the seam acquiring one silently.
**Fix:** delete the `'off'` line from both new configs.

#### L2 · `packages/shared/eslint.config.mjs:37`, `db/eslint.config.mjs:37`, `services/api/eslint.config.mjs:36`

`"prettier/prettier": ["error", { endOfLine: "auto" }],` — a double-quoted key in an otherwise single-quoted
file, in a repo that just adopted `singleQuote: true`, on the one line that enforces prettier. Line 9
(`ignores: ['eslint.config.mjs']`) guarantees nothing will ever catch it, in any of the three copies. Exactly
the drift M3 invites.
**Fix:** single-quote the key. Consolidating per M3 fixes it once.

#### L3 · Root `.prettierrc` now resolves for the four apps, which were not reformatted

This is about formatting *state*, not lint — and is distinct from the verified fact that `apps/dispatch` and
`apps/admin` do not use `eslint-plugin-prettier`, so their lint cannot break. Nothing fails today. But
`apps/dispatch/src/app/layout.tsx`, `apps/admin/src/app/page.tsx`, `apps/*/next.config.ts` and the two Expo
skeletons all use double-quoted imports and are now governed by the root config. One contributor with
format-on-save, or one `prettier --write .`, reproduces exactly the large mechanical diff this PR took care to
quarantine into a blame-ignored commit.
**Fix:** either extend the reformat to the apps in a second blame-ignored commit, or add a `.prettierignore`
covering `apps/**` plus a follow-up ticket.

#### L4 · The plan artifact linked from the PR body is unreachable

`.claude/plans/lint-coverage-shared-db.md` is not on this branch and not on `main`. It was committed as
`d9224b7` on `feature/api-dispatch-engine` *after* that branch merged as PR #49, so it sits on a stale local
branch that has not been pushed:

```
$ git branch -a --contains d9224b7
  feature/api-dispatch-engine
```

`CLAUDE.md` requires PIV artifacts to live under `.claude/`. As it stands the plan is one `git branch -D` from
being lost, the implementation report cites deviations from a document no reviewer can open, and this review had
to proceed without it (see *Stated limitation*, above). **For the author to resolve** — recovering `d9224b7` is a
call about what belongs in this PR, not the reviewer's to make.

#### L5 · `packages/shared/src/schemas/ride.ts:66` — pre-existing, out of scope

Missing `+` in the error template: `…${b.timeCents}${b.discountCents}…` renders `200+80+1500` instead of
`200+80+150+0`. Verified byte-identical on `main`, and the reformat is proven pure prettier output, so this is
**not** reformat damage. Worth a one-line follow-up, not this PR's to fix.

---

## What's genuinely good

- **The commit split is exemplary** and is the only reason a 61-file PR was reviewable: pure rename → mechanical
  reformat *alone* → wiring, with the reformat SHA in `.git-blame-ignore-revs`. Deviation #2 (keeping the
  `.prettierrc` promotion out of the reformat commit) is the right call for the right reason — and it is
  precisely what made the 52-file prettier-idempotence proof above possible in one loop.
- **AC #1 is a genuinely well-designed test.** Asserting on turbo's `<NONEXISTENT>` sentinel rather than grepping
  console output correctly distinguishes "no task" from "task that does nothing" — a grep would have passed
  before *and* after. Most people get this one wrong.
- **The AC #2 round-trip** (inject `unusedProbe` → gate fails → revert → gate passes, `--force` on both legs) is
  real proof the task is wired, not merely present.
- **`void payload.location;` is the correct fix**, and the reasoning holds under checking. The rule that fired
  was `no-unused-expressions`, which explicitly exempts `void`/`delete` unary expressions — the canonical escape,
  not a trick. `void` still type-checks its operand, so the `@ts-expect-error` above it stays **consumed**: if
  `ClientToServerEvents` ever widens, the directive goes unused and `tsc --noEmit` fails, which is the alarm the
  test exists to arm. Deleting the member access — the other obvious "fix" — would have silently disarmed it.
  **Do not tidy this.**
- **`turbo.json` left untouched is right.** `lint.dependsOn: ["^build"]` is load-bearing for type-aware linting
  across a workspace, and the comment explains the cold-dist failure mode instead of just asserting it.
- **The report is unusually honest** — it volunteers the Redis port deviation, the incidental lockfile churn, and
  that `ignoreRestSiblings` was not re-measured from scratch. That candour is what let this review target
  verification instead of re-deriving everything from zero.
- `ignoreRestSiblings: true` is load-bearing and the config comment describing it is accurate.
- `sourceType: 'commonjs'` is inherited from api and is **inert** here — `@typescript-eslint/parser` handles the
  ESM syntax regardless and `no-undef` is off, so no rule behaves differently. `'module'` would be more truthful
  but buys nothing. Not filed as a finding.

---

## Recommendation

**Approve.**

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 (M1–M4) |
| Low | 5 (L4 is metadata; L5 pre-existing, out of scope) |

Zero Critical, zero High; the gate is 20/20 green from a cleared `dist/`; the reformat is mechanically proven to
be nothing but prettier output; the PR does what it says. Every finding is a policy or hygiene gap, not a defect
— none of them makes any code path produce a wrong result today.

**Required before the next lint-touching ticket** (one line each — worth doing now while the files are open):
**M1** and **M2**. Each leaves a check that reports success without running, which is the failure mode this PR
exists to eliminate.
**Worth taking in the same pass:** **M4** and **L1**, one line each.
**For the author:** **L4** — the linked plan is unreachable and currently at risk of being lost.
**Follow-up tickets, explicitly not blockers:** **M3** (shared preset in `packages/config`) and **L3**
(`.prettierignore` or reformat the apps).

The underlying work is solid and the verification discipline behind it is above the bar.
