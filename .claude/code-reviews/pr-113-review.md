# PR #113 review — `chore: scope the 500-line rule to shipped source and enforce it (#112)`

**Branch** `feature/file-length-rule-shipped-source` → `main` · base `085ef88` · 10 files, +1076/−4 · **zero source files touched**
**Reviewed in** worktree `taxi-filelen` (the shared checkout was left on `feature/dev-env-redis-doc`, untouched)

## Summary

This does what it says. The mechanism is correct, it is proven to fire, and it is proven to stay silent on the
right set — I re-ran the probes myself rather than inheriting the PR body's account of them, and they reproduce
exactly. The rule text resists drift: no file name, no line count, no package enumeration in `CLAUDE.md:61`.

**Nothing structural is wrong.** Every finding below is a prose or provenance edit; no eslint behaviour needs to
change and no source file needs to move. Two are worth fixing before merge, for the same reason this ticket
exists: both are cases where a number or a sentence in the artifacts does not match what the tree actually does.

## Validation

Gate re-run from scratch in the worktree:
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force`

| check | result | provenance |
|---|---|---|
| turbo tasks | **21/21 successful, 0 cached**, 55.2 s | `observed` — this review's run |
| `@taxi/api` tests | **54 suites / 462 tests passed, 0 skipped** | `observed` — same run |
| lint | 0 errors (7 pre-existing `no-unsafe-argument` warnings on integration specs) | `observed` — same run |

Matches the PR body's figures exactly. **Independently reproduced the enforcement probes** (tree reverted clean after):

| probe | lines | result | provenance |
|---|---|---|---|
| `ride-lifecycle.service.ts` padded | **501** | `File has too many lines (501). Maximum allowed is 500  max-lines` | `observed` |
| same file, one line fewer | **500** | silent — 0 errors | `observed` |
| `apps/dispatch/…/tracking-map.tsx` padded | **501** | same error | `observed` |
| all 9 exempt over-500 files, same runs | 502–1414 | silent | `observed` |

The boundary is genuinely 500, not 501. The exemption is non-vacuous in the same run that proves the cap.

Also re-derived independently, all confirmed: largest shipped source **447** (`ride-lifecycle.service.ts`), so
headroom **53** (`derived` — `500 − 447`); exactly **10** tracked `.ts`/`.tsx` files exceed 500, all behind exempt
globs; exactly **5** `eslint.config.*` outside `node_modules`; `services/api`/`db`/`packages/shared` all spread
`...base`, so the exempt block genuinely reaches them; `apps/rider`/`apps/driver` have no lint script.

## Issues

### Medium

**M1 · The archive-sweep count is 25, not 23 — and it is wrong in the PR body too.**
`.claude/plans/file-length-rule-shipped-source.md:101,108,496`, and the PR body's "Two things this deliberately
does not do" section.

The plan prints its own command and labels the result `observed` **at base `085ef88`**. Re-run at that base it
returns **25** (`observed` — this review's run, both at `085ef88` and at branch `HEAD`; both give 25). The two
extra files arrived with the #110 merge: `.claude/reports/mint-ride-sub-cell-jitter-report.md` and
`.claude/code-reviews/pr-110-review.md`. The digits are right for the pre-merge tree the plan was written in and
wrong for the base they are labelled with.

The barb: `pr-110-review.md` is the one archive file this ticket *does* touch (Task 9), and it is not in the 23
the plan claims to have counted.

This is the defect CLAUDE.md names in its own words — a figure flowed plan → PR body and was inherited rather than
re-derived, and the PR body is "the most-read surface and the only one not in the working tree." Nothing
downstream depends on the value, which is exactly why it survived.

The pre-merge tree the plan's own header says it was written in — `bea4222`, "two merges behind" — returns exactly
**23** (`observed` — this review's run). So the figure is not wrong, it is *mislabelled*: right tree, wrong base.

*Fix:* `23` → `25` at `plan:101`, `plan:108` and `plan:496`, and in the PR body, with the provenance clause:
`**25** files (`observed` at `085ef88`; the earlier 23 was measured in the pre-merge `bea4222` tree)`. Those four
sites are the complete set — the report carries no copy of this figure (`observed` — `grep -rn "\b23\b"` over both
live artifacts returns only the three plan lines).

**M2 · The gate exempts a category none of the four prose surfaces names.**
`CLAUDE.md:61` · `.claude/agents/code-reviewer.md:46` · `.claude/skills/vertical-slice-audit/SKILL.md:151` ·
`docs/build-playbook.md:156`

The override globs include `**/*.test.ts` and `**/*.test.tsx`. All four prose surfaces say only
"Specs, `test/`/`tests/` and `scripts/`". Four real files are exempt by filename glob alone — neither named
`.spec.` nor under a `test/` directory (`observed`):

```
apps/dispatch/src/features/tracking/states.test.tsx
apps/dispatch/src/features/tracking/tracking-data-route.test.ts
apps/dispatch/src/features/tracking/tracking-live.test.tsx
apps/dispatch/src/features/tracking/tracking-page.test.tsx
```

This repo runs two conventions side by side — `.spec.ts` in `services/api`, `.test.tsx` in `apps/dispatch` — so
"Specs" is genuinely ambiguous here rather than pedantically so. A reviewer following `code-reviewer.md:46`
literally would flag a 600-line `tracking-page.test.tsx` for length while the gate stays silent: the prose and the
mechanism disagreeing, with a human adjudicating. That is problem #2 from the plan's own Problem Statement,
reproduced in miniature by the fix for it.

The plan had this in hand and lost it — line 438 enumerates *both* conventions when justifying the globs, then the
Task 1–4 wording drops the distinction.

Second instance, same species, same fix pass: `docs/build-playbook.md:156` writes "(specs, test/, scripts/ exempt)"
and omits **`tests/`** (plural) — the directory holding every test in `db` and `packages/shared`, two of the five
linted packages.

*Fix:* one phrase in each of the four surfaces — "`.spec`/`.test` files (`.ts`/`.tsx`), `test/`/`tests/` and
`scripts/` are outside the rule and uncapped" — and restore `tests/` in the playbook clause. Note the globs cover
those four extensions only, so a wildcard phrasing like `*.spec.*` would overstate in the other direction.

### Low

**L1 · Provenance overstated: `107` and `300` are `derived`, not `observed`.**
`.claude/reports/…-report.md:59-62`, mirrored at `.claude/code-reviews/pr-110-review.md:123-125`.
What `grep -n "^// ─"` produced is the banner map (`102 · 209 · 243 · 348 · 969 · 1047 · 1347`); 107 and 300 are
subtractions over it. Per `CLAUDE.md:64` a figure under an Observed label that no run produced is the defect *even
when the arithmetic is correct* — and here it is: `208 − 102 + 1 = 107`, `1346 − 1047 + 1 = 300`,
`1414 − 107 − 300 = 1007`, `1007 / 500 = 2.0×`. All re-derived and confirmed, as are `+516` / `+57.5%`,
`888 / 500 = 1.8×`, and headroom `53`. *Fix:* relabel `derived — 208 − 102 + 1, boundaries observed from grep`.

**L2 · The comment-ratio table's arithmetic does not reproduce from its own columns.**
`.claude/plans/…:708-718`. Row reads `total 1414 | code 888 | comment 433 | share 32.8%`, but `433 / 1414 = 30.6%`.
The printed 32.8% is `433 / 1321`, i.e. `888 + 433` — the 93 blank lines are silently excluded from the denominator
and never listed. The comparison row uses the same undisclosed denominator (`126 / 412 = 30.6%`, not
`126 / 447 = 28.2%`), so the *conclusion* survives; the presentation is what fails the show-the-arithmetic bar.
*Fix:* rename the column "share of non-blank lines", or add a `blank` column.

**L3 · "~31% repo norm" is n = 1.** `.claude/plans/…:148,717`. The norm is a single comparison file
(`ride-lifecycle.service.ts`, 30.6%), while the stated provenance is a classifier over "both files". *Fix:* call it
what it was measured on — "against the largest shipped file's 30.6%" — or run the classifier over `src/**` and keep
the word "norm".

**L4 · "The complete diff is 8 files" contradicts "10 files" three pages later.**
`.claude/reports/…:160` vs `:226`. Both are presumably true of different scopes (`1072 − 79 = 993`, consistent with
plan + report), but neither names its case and "complete" asserts the opposite. *Fix:* "8 files excluding the two
PIV artifacts committed alongside (10 total)".

**L5 · The base.mjs comment overstates the gate/build agreement.** `packages/config/eslint/base.mjs:40-44` claims
the override "mirrors what each package's build already excludes … so the gate and the build draw the same
shipped/dev line". Exact for `services/api`. Not exact for `db` and `packages/shared`, whose builds are
`include: ["src"]` while their lint scripts explicitly name `drizzle.config.ts` / `vitest.config.ts` — capped by
`max-lines`, compiled by neither build (`observed`). The gate is *stricter* than the prose there. Harmless today
(all are tiny), but the plan's Assumption #2 calls it "exact for three packages", which overstates by two.
*Fix:* one clause in the comment and the same correction in Assumption #2.

**L6 · The `eslint-disable` guard misses its cheapest evasion.** `.claude/agents/code-reviewer.md:47`. The
instruction is well-formed and actionable, and there is no existing `max-lines` disable in the repo (`observed` —
the only two inline disables are `stripe-payments.provider.spec.ts:45` and `tracking-map.tsx:244`, both
`-next-line` and both naming a specific rule). But a bare `/* eslint-disable */` at the top of a file switches off
`max-lines` along with everything else and matches no grep for "max-lines". *Fix:* append ", including a bare
`/* eslint-disable */`, which switches off every rule".

## What's good

- **The flat-config wiring is correct, and I checked it rather than assuming it.** In all three configs the
  `max-lines` object is a universal (no `files`) entry and the exempt-glob override is the last element touching
  the rule; nothing re-enables it downstream. `globalIgnores` in the two Next apps is order-independent, so its
  placement before the new entries is harmless — the one shape where a rule can sit in the file and be inert, and
  it isn't. `apps/admin/eslint.config.mjs` is byte-identical to `apps/dispatch`'s and both lint scripts are the
  bare `eslint`, so the dispatch probe transfers; an admin probe was run anyway.
- **The induced-failure control is the right instinct, executed better than the plan asked for.** Run in both
  directions, boundary *measured* at 500 and 501 rather than assumed at ~507, error message quoted verbatim,
  positive control in the same run. A rule added but never seen firing would have been an unverified claim.
- **Restating the rule in the two Next apps was necessary, not belt-and-braces.** Without it `CLAUDE.md`'s
  enforcement claim would have been false for two of four web surfaces — the same species of untrue claim the
  ticket fixes.
- **Amending `code-reviewer.md` is the load-bearing edit.** Per `taxi-piv-remedies-need-an-executable-step`, a
  CLAUDE.md-only amendment whose review agent still carried the old sentence is #87's failure reproduced.
- **The nested-`scripts/` disclosure is accurate and complete** — independently verified: only the four
  package-root directories exist, and nothing compiled by the `db`/`shared` builds is exempt.
- **The residual risk is stated at its true temperature.** "Outside the rule and uncapped", plus "realistically
  nobody will, not 'a reviewer will'", names no mechanism that does not exist. The `expected (vacuous)` labels on
  the three globs with no over-500 file behind them are the honesty the numbers rule asks for, volunteered.
- **The propagation sweep of *live* surfaces is complete** — no sub-package `CLAUDE.md`, skill, or hook still
  carries the unconditional rule. The unswept hits are all dated archive, deliberately and defensibly so.
- **One argument was checked and discarded rather than used** ("the file is long because the numbers rule mandates
  provenance prose" — false, 888 code lines alone is 1.8× the cap). Discarding a convenient argument and saying so
  is the part that usually goes missing.

## Recommendation

**Request changes — narrowly.** 0 Critical, 0 High, 2 Medium, 6 Low. Validation is green and the mechanism is
sound; do not read this as doubt about the config wiring.

Blocking is **M2** alone: it re-creates the reviewer/gate disagreement this ticket exists to eliminate, and it is a
four-file one-phrase edit. **M1** is a one-character fix plus a provenance clause, and it needs to land in the PR
body as well as the plan — the surface CLAUDE.md singles out as most-read and least-checked. The six Lows can ride
in the same pass; L1 and L2 are the two that the repo's own numbers rule would catch on the next read.

---
*Reviewed with fresh eyes in a clean context; deep pass dispatched to the `code-reviewer` agent. All figures in
this review are `observed` from runs in `taxi-filelen` at branch `HEAD` (`0097876`), base `085ef88`, or `derived`
with the arithmetic shown.*
