# Implementation Report — lint coverage for `@taxi/shared` and `@taxi/db`

**Plan**: `.claude/plans/lint-coverage-shared-db.md`
**Branch**: `chore/lint-coverage-shared-db`
**Status**: COMPLETE

## Summary

`turbo run lint` skipped — did not fail — any package without a `lint` script, so 3 of 8 packages
were linted while the task still reported green. This gives `@taxi/shared` (the contract seam every
app and `services/api` imports) and `db` (the whole persistence layer) a real type-aware lint task,
built from `services/api`'s existing flat eslint config.

`services/api/.prettierrc` was promoted to a repo-root `.prettierrc` first — prettier resolves config
by walking *up* from each file, so api's copy had never governed either package and both were
silently on prettier's defaults. That made one house style govern the monorepo, at the cost of a
52-file mechanical reformat landed as its own commit and recorded in `.git-blame-ignore-revs`.

Linting the two packages surfaced exactly one real violation, in `packages/shared/tests/`.

## Tasks completed

| Task | File | Action |
|---|---|---|
| Cut branch from an up-to-date `main` | — | `chore/lint-coverage-shared-db` |
| Root prettier config | `.prettierrc` | CREATE |
| Delete the redundant api copy | `services/api/.prettierrc` | DELETE |
| Reformat shared + db (isolated commit `ca4f698`) | 52 files | UPDATE |
| Record the reformat for `git blame` | `.git-blame-ignore-revs` | CREATE |
| Flat eslint config | `packages/shared/eslint.config.mjs` | CREATE |
| Flat eslint config (byte-identical) | `db/eslint.config.mjs` | CREATE |
| `lint` script + 7 devDeps | `packages/shared/package.json` | UPDATE |
| `lint` script + 7 devDeps | `db/package.json` | UPDATE |
| Mirror `no-unused-vars` rule so all three copies match | `services/api/eslint.config.mjs` | UPDATE |
| Regenerate for the new devDeps | `pnpm-lock.yaml` | UPDATE |
| `void` the bare member access holding a `@ts-expect-error` | `packages/shared/tests/realtime-events.test.ts` | UPDATE |

Three commits, in the order the plan requires:

- `21163e9` — `chore:` promote the api prettier config to the repo root
- `ca4f698` — `style:` the reformat, alone (52 files, +1448/-941)
- `a4401df` — `chore(shared,db):` the eslint wiring, the fix, and `.git-blame-ignore-revs`

## Tests added

No runtime code ships here, so the "tests" are the gate's own behavior, per the plan's testing strategy:

**Expected case — AC #1.** Asserted on turbo's `<NONEXISTENT>` sentinel rather than by grepping console
output (a package with no script is still a graph node, so a grep would pass before *and* after):

```
pnpm turbo run lint --dry=json | jq -r '.tasks[] | select(.taskId|endswith("#lint"))
  | select(.command=="<NONEXISTENT>") | .taskId' | sort
→ @taxi/config#lint   @taxi/driver#lint   @taxi/rider#lint
```

`@taxi/shared#lint` and `@taxi/db#lint` are gone; the three out-of-scope packages remain. **PASS**

**Edge case — AC #2, the violation round-trip**, `--force` on both legs:

- violation leg → `money.ts 43:7 error 'unusedProbe' is assigned a value but never used
  @typescript-eslint/no-unused-vars`, `Failed: @taxi/shared#lint` — **fails as required**
- revert leg → `Tasks: 7 successful, 7 total` — **passes as required**

**Failure case — AC #3, the cold-dist gate.** `git clean -xdf` on the three `dist/` dirs, then the full
gate. **PASS** (see below).

**Existing suites stay green.** `typecheck test --force` immediately after the reformat: 12/12 tasks,
251 api tests — proof the 52-file rewrite was purely cosmetic.

## Validation results

| Check | Result |
|---|---|
| `prettier --check` shared + db + `drizzle.config.ts` | **All matched files use Prettier code style** |
| `diff packages/shared/eslint.config.mjs db/eslint.config.mjs` | no output — byte-identical |
| `diff` vs api's config | only the documented DELTA 1 (jest globals) + its comment |
| `turbo run lint typecheck --filter=@taxi/shared --force` | 2/2 successful, **0 problems** |
| `turbo run lint --filter=@taxi/db --force` | 2/2 successful, **0 problems** |
| `turbo run lint --filter=@taxi/api --force` | 3/3 successful, 0 errors / 4 warnings (pre-existing) |
| `pnpm install --frozen-lockfile` | exit 0, no "lockfile is not up to date" |
| **Gate from a cleared `dist/`** | **`Tasks: 20 successful, 20 total`** in 31s |

The gate run: 39 api suites / 251 tests passed, 0 skipped; shared and db suites green; 4 pre-existing
`no-unsafe-argument` **warnings** in api integration specs (0 errors) — those are on `main` today and
are not this ticket's to fix.

The reformat diffstat came back as **`52 files changed, 1448 insertions(+), 941 deletions(-)`** — the
literal figure the plan measured during planning, which confirms the root `.prettierrc` resolved and
the globs were unaltered.

Post-reformat lint counts matched the plan's measurements exactly: shared **1 real error, 0 prettier
problems**; db **0 problems**.

## Deviations from the plan

1. **Redis was opted *in*, not skipped.** The plan prescribes omitting `REDIS_TEST_URL` because the
   compose Redis published no host port. `docker compose up -d` then failed to start Redis at all —
   6379 is held by an ssh tunnel on this machine, and the container refuses to start when the bind
   fails. I restarted it via the compose file's own `REDIS_PORT` override on **6381**, verified it
   answers, and ran every suite with `REDIS_TEST_URL=redis://127.0.0.1:6381`. This is *stronger* than
   the plan's posture: the gate ran the Redis-backed suites rather than `describe.skip`-ping them
   (251 api tests, 0 skipped). No repo file changed — `REDIS_PORT` was passed as an environment
   variable, and no root `.env` was created.
2. **Phase 1 is its own commit**, rather than folded into the reformat commit. The plan names a commit
   only for Phase 2. Keeping the `.prettierrc` promotion separate leaves the blame-ignored commit
   purely mechanical, which is the point of ignoring it.
3. **The eslint config's comments drop the plan's `DELTA 1:` / `DELTA 2:` labels**, keeping the
   explanatory prose. The labels reference the plan's own numbering, which reads as a dangling
   pointer to anyone opening the file later. Rule content is verbatim.
4. **The lockfile carries incidental churn beyond the new devDeps.** pnpm re-normalized the circular
   peer-dependency keys for `eslint-import-resolver-typescript` / `eslint-plugin-import` (pulled in by
   `eslint-config-next` in the two Next apps) to a shorter hash notation. Versions are unchanged
   (3.10.1 / 2.32.0), and `@taxi/dispatch#lint` and `@taxi/admin#lint` both pass in the 7/7 and 20/20
   runs — the "no regressions" acceptance criterion holds.
5. **Committed during implementation rather than leaving everything for `piv-commit`.** Forced by the
   plan itself: `.git-blame-ignore-revs` needs the reformat commit's SHA, and AC #2's revert leg only
   works once the reformat is in `HEAD`. Nothing is left uncommitted.

## Issues encountered

- **The `realtime-events.test.ts` violation moved as predicted**, from `:252` to `:319`, because the
  reformat splits the enclosing arrow's parameter list across three lines. Located it by searching for
  `@ts-expect-error — untrusted`, per the plan, not by line number.
- **`void` keeps the type alarm armed.** The fix had to leave the `@ts-expect-error` *consumed* —
  deleting the bare member access would silently disarm the test's whole point. Confirmed both
  directions: lint reports 0 problems **and** `tsc --noEmit` exits 0, which it would not if the
  directive had gone unused.
- **The Redis bind conflict** described under deviations. Pre-existing environment condition
  (ssh tunnel on 6379), unrelated to this ticket. Left the container running on 6381.
- `ignoreRestSiblings: true` was not re-measured from scratch — the plan verified by removing it and
  watching `tariff.test.ts:38` fire. Its effect is confirmed indirectly here: shared lints clean while
  that file still contains the `const { baseCents: _omitted, ...withoutBase }` idiom.

## Acceptance criteria

- [x] AC #1 — `turbo run lint` executes a real lint task for `@taxi/shared` and `@taxi/db`
- [x] AC #2 — an intentional violation fails the gate, then passes reverted, `--force` on both legs
- [x] AC #3 — the gate is green from a cleared `dist/` (20/20)
- [x] One prettier config governs the monorepo; `services/api/.prettierrc` is gone
- [x] The two new eslint configs are byte-identical, and differ from api's only in DELTA 1
- [x] `pnpm-lock.yaml` committed; `pnpm install --frozen-lockfile` succeeds
- [x] The reformat is an isolated commit (`ca4f698`), recorded in `.git-blame-ignore-revs`
- [x] `turbo run typecheck test --force` green after the reformat — no behavior change
- [x] No regressions: `services/api`, `apps/dispatch`, `apps/admin` lint exactly as before
