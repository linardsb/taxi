# PR #251 review round 1 — fixes

**Review** `https://github.com/linardsb/taxi/pull/251#issuecomment-5766029638` · **Branch**
`fix/tracking-url-shape-and-noindex-246-247` · **Worktree** `wt-246-247` · **Base** `origin/main` @ `487570f`
(unmoved; re-checked with `git fetch --prune` at the start of this pass — the main checkout's `origin/main`
ref was stale before the fetch and read the same sha after, so the review's "base has not moved" holds).

The review was an **Approve** with no Critical and no High. Eight findings, all Medium or Low. Six fixed,
two deferred to #13.

| | Severity | Call | Where |
|---|---|---|---|
| F1 | Medium | **fixed** | `services/api/src/common/config/env.schema.ts` — whitespace, control characters and `\` survive all gates |
| F2 | Medium | **fixed** | `docs/runbooks/hetzner-deploy.md` — four sites describe the old gate |
| F3 | Low | **fixed** | PR #251 body — "the same 15 values" over a 13-row table |
| F4 | Low | **fixed** | `apps/dispatch/src/app/t/tracking-noindex.test.ts` — nothing pins `userAgent: '*'` |
| F5 | Low | **fixed** | same file — re-asserts a property `packages/shared` owns |
| F6 | Low | **fixed** | same file — three `as` casts over a real union |
| F7 | Low | **fixed** | `env.schema.ts` — indexed read types as `string \| undefined` |
| F8 | Low | **deferred → #13** | `env.schema.ts` — both new checks are production-only |
| — | Low | **deferred → #13** | `.claude/plans/deploy-hetzner-environment.md:271-273` — F2's plan-side twin |
| — | Low | **deferred → #13** | newly found: the zero-width gap F1's fix does not close (below) |

Triage of F2 and F8 was put to the owner rather than decided here, because both change the size of this PR.
F2 → fix now; F8 → defer. Recorded so round 2 does not re-raise either as an oversight.

## Fixed

### F1 — whitespace, control characters and `\` reach the rider SMS

**What was wrong.** `new URL()` strips leading/trailing whitespace and C0 controls from its *input* and
removes tab/CR/LF anywhere before parsing, so `z.string().url()` accepts them — and zod returns the
**original** string, which `trackingLinkHost` carries into the SMS intact. The breaker map listed only
characters illegal in a host, and these are not.

**`observed` before the fix**, through the compiled `services/api/dist/common/config/env.schema.js` at
`270bfe4`:

| configured | carried into the SMS | len | verdict at `270bfe4` |
|---|---|---|---|
| `https://sakta.lv␠` | `sakta.lv␠` | 9 | **boots** |
| `https://sakta.lv\tx` | `sakta.lv\tx` | 10 | **boots** |
| `https://sakta.lv\nx` | `sakta.lv\nx` | 10 | **boots** |
| `https://s.lv\x` | `s.lv\x` | 6 | **boots** |

**The fix**, two parts, because these are two classes with two reasons:

- `\` becomes a **fourth entry in `TRACKING_BASE_URL_BREAKERS`**, with its own reason — it is not
  whitespace, and what it does depends on the linkifier. This is the existing design used as designed,
  not a new mechanism.
- Whitespace and control characters become **one catch-all check** beside the map, because they share one
  reason and a per-character entry would repeat it four ways. The host is quoted `JSON.stringify`-escaped
  in this refusal and raw in the breaker refusal: a trailing space printed raw is invisible to the
  operator who typed it, which is the whole failure.

The review's suggested regex was not used: `/[\s\^@-\^_\u007f]/` contains the range `@-\^` (0x40–0x5E), so
it rejects every uppercase letter and would refuse `https://SAKTA.LV` — a value the PR's own test pins as
accepted. The shipped test is `/\s/.test(c) || c < ' ' || c === '\u007f'`, a per-character predicate rather
than a regex literal because `no-control-regex` (on in this repo, `observed`) refuses `\u0000-\u001f` in a
regex literal.

**Tests** — five new cases in `services/api/src/common/config/env.schema.spec.ts`, written **before** the
schema edit and `observed` failing against the unfixed tree:

```
Tests: 5 failed, 53 passed, 58 total
● refuses a trailing space … → https://sakta.lv  was accepted, not refused
● refuses a tab …           → https://sakta.lv<TAB>x was accepted, not refused
● refuses a newline …       → https://sakta.lv\nx was accepted, not refused
● refuses whitespace in the path prefix too → https://s.lv/a b was accepted, not refused
● refuses a backslash by name → https://s.lv\x was accepted, not refused
```

After the fix: `58 passed, 58 total` (`observed`, `npx jest src/common/config/env.schema.spec.ts`).

**What new failure mode does this fix's mechanism have?** It is a *deny*-list over characters, so it is
incomplete by construction — and it is: `\s` does not match the zero-width format characters. `observed`
2026-09-21: `https://sakta.lv<U+200B>x` parses to hostname `sakta.lvx`, boots at 10 characters, and texts a
link resolving to **a domain the operator does not own** — worse than the truncation this check covers,
because nothing looks wrong. `U+00AD` (soft hyphen) behaves identically; `U+200C` and `U+00A0` are rejected
by `new URL()` already.

Not fixed here, and the reason is stated rather than hidden: the one-line form `/[\s\p{Cf}]/u` takes
`env.schema.ts` from **495 to 499 of its 500-line cap** (`observed`, prettier wraps the condition across
three extra lines), which is not headroom. It is also not a failure mode this fix *introduced* — that value
booted before the fix and boots after it — so it is a newly found instance of the same class, deferred to
#13 with this evidence, exactly as the review itself handled F1. The spec docblock names the gap in place
so the heading above it is not read as a complete claim.

### F2 — the deploy runbook described the old gate at four sites

Fixed in this PR rather than deferred because **this commit is what falsified those lines**: at `487570f`
the runbook's `https://u@s.lv`-boots reading was true.

- **`:222`** (§3 env table row) — rewritten to name all four rules (localhost · lowercase scheme · no
  `@ ? # \` / whitespace / control · ≤10 characters of host). The "Scheme and any trailing slash do not
  count" clause is corrected: the scheme is still not *counted*, but its **spelling** is now itself a gate,
  and a path prefix is called out as supported and counted.
- **`:164-169`** (DNS section) — a paragraph added naming the #246 rules, and saying plainly that length
  never was a shape filter.
- **`:810-825`** (the **Break | Refusal** probe table) — three rows added, one per new refusal class
  (`@`, trailing space, uppercase scheme). Each refusal string is the exact text `envSchema` emits, read
  out of the compiled schema on 2026-09-21.
- **`:263`** — narrowed. It claimed "every one of these gates was exercised against the built image"; that
  subject silently widened when this PR added gates to the table's own variable.

**The provenance trap, handled explicitly.** The line above the probe table says its messages are "the
container's own text, copied from `docker logs`, not a prediction". My three rows are `derived` from the
schema — **no container was booted on them**. Adding them under that header without saying so would be
#87 and #107 repeated, in the one table whose header forbids it. So the three rows are each marked
**`derived`**, a note under the table states that no container was booted and says how to promote them,
and `:263`'s narrowing names **the same three rules** — the two edits agree rather than being fixed by
different sentences.

**Not covered by a test, and cannot be**: this is operator-facing prose. Its accuracy rests on the refusal
strings being copied from a run (they were) and on `env.schema.spec.ts` pinning the rules they describe.

### F3 — "the same 15 values" over a 13-row table

The table has 13 rows; all 13 reproduce. Fixed in the PR body, along with every other figure this pass
moved — see **Figures re-derived** below.

### F4 — nothing pinned `userAgent: '*'`

`observed` before the fix: changing `robots.ts:28` to `userAgent: 'Googlebot'` left **all 3 cases green**
while every crawler other than Google went unrestricted. After adding `expect(userAgent).toBe('*')` to the
expected case, the same mutation gives **1 failed | 2 passed** (`observed`, both runs; working tree
restored and `git status --porcelain` empty after each).

### F5 — re-asserted a property `packages/shared` owns

`/^\/[a-z]\/$/` narrowed to `/^\/.+\/$/`, so the case checks the `/…/` **wrapping** this file owns rather
than the one-character width asserted in `packages/shared/tests/tracking-link.test.ts`. The comment now
records the split, matching the sibling `tracking-rewrites.test.ts:97-100` decision from PR #245's review.
Line 53's `toContain(rule.slice(1, -1))` still carries this file's own concern.

### F6 — three `as` casts over a real `Rule | Rule[]` union

Replaced by one `rules()` helper that asserts the object form before narrowing — the house pattern from
`tracking-rewrites.test.ts:23-30`. **`observed`**: switching `robots.ts` to the array form now fails
**all 3 cases** loudly; before the fix that switch would have read `undefined` off every property, and the
`allow` assertion would have passed silently.

### F7 — the breaker lookup reached through the type system

`Object.keys(...).find()` → `Object.entries(...).find(([c]) => …)` with `const [character, reason] =`, so
the reason is read from the same tuple as the character and never types as `string | undefined` under
`noUncheckedIndexedAccess`. Style only, as the review said; no behaviour change, and the existing breaker
cases pin the messages.

### Not in the review: three stale counts my own fix created

Adding a fourth check to that block falsified three claims written around it — the repo's "a number in a
comment is a claim" rule applies to comments this pass made false, not only to ones it wrote.

- `env.schema.ts` — "The **two** checks below run first" → names the three (breaker, whitespace, scheme).
- `env.schema.ts` — "all **three** rules on this one variable read as one block" → "every rule", with a
  note that the count went stale the moment the whitespace check landed. Named rather than counted, so it
  cannot go stale again.
- `env.schema.spec.ts:224` — "**Neither** check early-returns" → "No shape check early-returns".

## Deferred → #13

Filed as checklist lines on #13 (Low/Medium → the next open epic ticket touching the same file, per the
`piv-fix-review-findings` §1 rule added in #250), not as new issues.

1. **F8 — hoist the two new checks above the `NODE_ENV !== 'production'` gate.** A malformed dev or CI
   value boots silently. The author's placement is a documented decision and the review recorded rather
   than disputed it. Deferred because hoisting makes a refusal active in every environment on a variable
   read across four packages — a gate-regression risk disproportionate to a Low, and past what #246 asked.
   `const smsHost` must move with them or it does not compile.
2. **F2's plan-side twin** — `.claude/plans/deploy-hetzner-environment.md:271-273`'s VALIDATE step lists
   the gates to break as (a) `JWT_SECRET`, (b) `ALLOW_STUB_MAPS_PROVIDER`, (c) localhost, (d) partial
   `TWILIO_*`, and does not include #246's three. That is #13's own artifact, not operator-facing.
3. **The zero-width gap** (newly found, F1's own blind spot) — `/[\s\p{Cf}]/u`, plus promoting the three
   `derived` probe-table rows to `observed` on the same image boot. Evidence in `env.schema.spec.ts`'s
   docblock and in F1 above.

## Needs a human look

**Nothing blocking.** One item for whoever boots the image next (already on #13, repeated here because it
is the only claim in this PR that a gate cannot check): the three new probe-table rows are `derived`. They
should be run against the built image and promoted, and `:263`'s exception sentence removed at the same
time. The two must move together — that is the failure this pass was guarding against.

## Figures re-derived

Every figure is re-derived at the fixed tree rather than copied from the review or the old PR body.

| figure | before | after | provenance |
|---|---|---|---|
| gate | 22/22 | **22 successful, 22 total**, exit 0 | `observed`, three consecutive green runs |
| gate wall time | 1m30.453s | 1m35.716s (final run; 1m35.074s and 1m26.768s on the two before it) | `observed`; machine load, not a change |
| `@taxi/api` | 794 passed / 81 suites | **799 passed / 81 suites**, 0 skipped | `observed`; +5 = the five new F1 cases |
| `@taxi/dispatch` | 272 passed / 30 files | 272 passed / 30 files | `observed`; F4–F6 changed cases, added none |
| `@taxi/shared` · `@taxi/rider` · `@taxi/driver` · `@taxi/db` | — | 255/27 · 145/30 · 250/44 · 17/3 | `observed` |
| `env.schema.ts` size | 477 / 500 | **496 / 500** | `observed`, `wc -l`; the cap is `max-lines` at `packages/config/eslint/base.mjs:36` |
| before/after table rows | 13, prose said 15 | 17 rows, prose says 17 | the 4 new rows are F1's refusals |
| verdicts that flip | 5 | 9 | 5 + the 4 new rows |

The gate command, run in `wt-246-247` from a cleared `apps/dispatch/.next`:

```
REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi \
  pnpm turbo run typecheck lint test build --force
```

**CI on the pushed commit `453e749`** — `observed` 2026-09-21, all five contexts green:
`check` pass 3m30s · `codeql` pass 1m18s · `CodeQL` pass · `audit-diff` pass 7s · `ready` pass 5s.
`gh pr view 251` then reads `state=OPEN merge=CLEAN draft=false`. The local gate and CI agree.

**`env.schema.ts` is now at 496 of 500.** It was already split once for this budget
(`sms-env.schema.ts`, #137). A split was considered and **rejected as out of scope**: no finding asked for
it, and it would mean moving the localhost and length checks this PR did not author, taking the diff
outside the PR's own boundary. Noted on #13 instead. The next edit to this file will need the split.

## Subject sweep

The skill's rule is that the sweep's output is a list, not a feeling. Each retired value **and its noun**,
the exact command, and its hits. Run at the fixed tree; `.claude/code-reviews/` excluded (it is the review
archive, which records what *was* true), `node_modules`/`dist`/`.next` excluded by path.

| retired value or noun | command | hits |
|---|---|---|
| "three rules" (the count I falsified) | `grep -rn 'three rules' --include='*.ts' --include='*.md' .` | **0** ✅ |
| "Neither check" | `grep -rn 'Neither check' --include='*.ts' --include='*.md' .` | **0** ✅ |
| "two checks below" | `grep -rn 'two checks below' --include='*.ts' --include='*.md' .` | **0** ✅ |
| "do not count" (the corrected scheme clause) | `grep -rn 'do not count' --include='*.ts' --include='*.md' .` | 1 — `short-tracking-links-sms-136.md:784`, about grep hits, unrelated ✅ |
| "over 10 characters" (the incomplete gate description) | `grep -rn 'over 10 characters' --include='*.ts' --include='*.md' .` | 2 — `short-tracking-links-sms-136.md:944` (#136's AC, **still true**: the length rule is unchanged) and `ride-notifications.service.spec.ts:356` (a driver *name*, unrelated) ✅ |
| `/^\/[a-z]\/$/` (F5's regex) | `grep -rn '\[a-z\]' --include='*.ts' --include='*.md' .` | 11, **none** in `tracking-noindex.test.ts` ✅ |
| "15 values" (F3) | `grep -n '15 values' <PR body>` | 1 → fixed in the PR body |
| "794" (the api count) | `grep -n '794' <PR body>` | 1 → fixed in the PR body |
| `Closes #246` / `Closes #247` | `grep -n 'Closes' <PR body>` | 2, **left byte-identical** — a reflow that backticks or rephrases them silently stops the close |

The PR body is the surface no working-tree grep reaches and the first thing the next reviewer reads, so it
is swept separately, above, and edited **after** the push so its figures describe the pushed tree.
