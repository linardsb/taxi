# PR #223 — round-1 review fixes

**PR**: [#223](https://github.com/linardsb/taxi/pull/223) · `docs/pr-222-review` → `main`
**Review**: [round 1](https://github.com/linardsb/taxi/pull/223#issuecomment-5720792215) —
**approve**, one Medium (F2), five Lows (F1, F3–F6). Supersedes an earlier request-changes comment.
**Scope taken**: all six fixed. None deferred, none left for a manual look.
**File touched**: `.claude/code-reviews/pr-222-review.md` — one markdown document, no source.

Every finding is a provenance or wording defect in a review document. There is no test to write for
prose, so each fix closes on a `grep -n` run **against the fixed tree** — the retired string absent,
the replacement present. The full sweep is the table at the end; the reviewer diffs a list, not a
sentence.

---

## F1 · Low — the eas-cli citations named no revision

**What was wrong.** The document carried twelve eas-cli citation sites into
`eas-json/src/build/{schema,types,resolver}.ts` with no package version, no sha and no URL. That
package is not a dependency of this repo, and `@expo/eas-json`'s published tarball ships `build/`
only — so the `src/` paths resolved against nothing a reader of this tree has. It is the document's
decisive evidence (the whole basis of its only High), and the PR body sells it as *"established from
eas-cli's own source"* — a provenance claim with no provenance attached.

**The fix.** One paragraph after the first citation (`:26-33`), naming the revision once and worded to
govern every eas-cli reference in the document — prose and prescribed docblocks, bare `resolver.ts:…`
forms included. No line numbers changed; all of them are correct at that sha.

**No count is written into the document.** The review's finding said "seven"; the document's own
citation sites number twelve across seven distinct `(file, range)` pairs. Writing either number would
have reproduced F3 one finding later, so the clause names the revision and not a tally.

**`observed`, 7 of 7 distinct pairs re-read at the pinned sha.** `npm view @expo/eas-json@24.5.0
gitHead` → `43068db22a079c67198fc7f7ccb5e85286ba3207`; each file fetched from
`raw.githubusercontent.com/expo/eas-cli/43068db…/packages/eas-json/src/build/` and the line read:

| Citation | Line at `43068db` | ✅ |
|---|---|---|
| `schema.ts:49` | `distribution: Joi.string().valid('store', 'internal').default('store'),` | ✅ |
| `schema.ts:154` | `android: AndroidBuildProfileSchema,` | ✅ |
| `types.ts:49` | `distribution: DistributionType;` | ✅ |
| `types.ts:125-129` | `EasJsonBuildProfile` … `[Platform.ANDROID]?: Partial<AndroidBuildProfile>;` | ✅ |
| `resolver.ts:19-28` | `resolveProfile` → destructure → two `mergeProfiles` | ✅ |
| `resolver.ts:23-27` | `const { android, ios, ...base }` + `mergeProfiles(base, …[platform] ?? {})` | ✅ |
| `resolver.ts:40-44` | `if (depth >= 5) { throw new Error('Too long chain of profile extensions…') }` | ✅ |

The review reported the same result; this pass re-ran it rather than inheriting it
(memory `taxi-review-payoffs-are-claims`).

**Copy chased: the PR body.** `#223`'s body carried the same unpinned claim at its `:21`. Updated
after the push — see *PR body* below. No working-tree grep reaches it, which is why it is called out
separately.

## F2 · Medium — the `EAS-effective Android distribution` column was `derived` under an `observed` heading

**What was wrong.** The mutation table at `:73-79` is introduced *"**`observed`** — three mutations at
`e029183`"*. Three of its four columns are: the mutation, the jest result, the verdict. The fourth —
`EAS-effective Android distribution`, the column the whole finding rests on, since a jest **PASS** is a
false negative only if EAS really resolves that profile to `store` — is derived from the schema and
resolver reading in the bullets above it. No EAS build ran. That is `CLAUDE.md`'s named defect class,
*"even when its arithmetic is correct"* — and the document cites that precedent two paragraphs
earlier.

**The fix.** A paragraph after the table splitting the label: jest column `observed`, the
EAS-effective column `derived`, with the derivation's four load-bearing line refs named.

**`observed`, the derivation re-traced by hand at `43068db` before writing it** — not copied from the
review:

- `resolver.ts:63-73` — `const { extends: baseProfileName, ...rest } = profile` then
  `return mergeProfiles(baseProfile, rest)`. The child is the *update* side, so the `extends` chain
  resolves child-over-parent **first**.
- `resolver.ts:90-95` — `if (base.android && update.android) result.android = mergeProfiles(…)`. The
  `android` block deep-merges across that chain, which is what makes row 2 (`preview` extends a `base`
  whose `android.distribution` is `store`) land on `store`.
- `resolver.ts:23-27` — `const { android, ios, ...base } = easJsonProfile` then
  `mergeProfiles(base, easJsonProfile[platform] ?? {})`. The platform block is the update side, so it
  beats the root. Rows 1 and 2 → `store`.
- `schema.ts:49` — `.default('store')`, which is what row 3 does *not* reach, because its
  `android.distribution` is `internal`. Row 3 → `internal`.

All three rows land where the column says. This was a labelling fix, not a re-run.

## F3 · Low — *"the five mutations"* about a three-row table

**What was wrong.** `:64` introduced the table as **three** mutations; the table had **three** rows;
`:79` then said *"that is what the five mutations show"* while enumerating rows 1–3 of that same
table. No five-row mutation table exists in the document. Introduced by `884627a`, the commit whose
message is *"two unverified clauses"* — a pass written to remove unverified clauses inserted a wrong
count.

**The fix.** Closed by F4's rewrite, which deletes the sentence containing it. The remaining count in
the document is `three`, at the table's own introduction.

## F4 · Low — `:78-80` restated `:75-76` almost verbatim

**What was wrong.** `:75-76` closed the table with *"A guard that fails both ways is a correctness
defect, not missing hardening."* `:78-80` opened the next paragraph with *"A guard that is wrong in
**both** directions is a correctness defect rather than missing hardening, and that is what the five
mutations show: rows 1–2 …, row 3 …"* — same proposition, same evidence, same enumeration, twenty
lines apart. The paragraph's actual job is the ergonomics argument that follows, which is good and is
not duplicated.

**The fix.** Deleted the duplicated clause; the paragraph now opens at the ergonomics point. **The
dangling `also` went with it** — *"The shape is **also** not an exotic one"* referred back to the
deleted clause, so it reads *"The shape is not an exotic one"*. That is the fix-mechanism check
applied to prose: the edit's own new failure mode was a back-reference to nothing, and it is closed.

## F5 · Low — *"verbatim"* decorated a paraphrase

**What was wrong.** `:350` claimed the docblock's *"plain HTTP to the origin was rejected for #13
because OTP codes and JWTs would cross in the clear"* is **verbatim** at
`docs/epics/sakta-cab.architecture.md:90`. It is not: the real line is reordered relative to the quote
and carries `Cloudflare → Hetzner`, which the quote drops. The substance was exactly right; only the
absolute word was wrong — in a sentence whose subject is how carefully a claim was checked.

**`observed`** — `sed -n '90p' docs/epics/sakta-cab.architecture.md` reads
*"#13 — plain HTTP to the origin was rejected because OTP codes and JWTs would cross Cloudflare →
Hetzner in the clear"*.

**The fix.** `verbatim` → *"a faithful paraphrase of …, reasoning included"*, with `:90` quoted as it
stands so a reader can compare the two without leaving the document.

## F6 · Low — `apps/driver/CLAUDE.md:23` did not state the mechanism it was cited for

**What was wrong.** `:312` cited `apps/driver/CLAUDE.md:23` for *"expo-router's `require.context` is
scoped to `src/app/**`"*. **`observed`** — that line reads, in full, *"Route files under `src/app/**`
are thin `export { X as default }` re-exports of feature screens."* — a file-layout convention.
`grep -c 'require.context\|Metro\|bundle' apps/driver/CLAUDE.md` → **0**. This is the one place the
document substitutes a mechanism argument for a re-run and calls it *"stronger than reproducing a
count"*; three of its four links were sourced exactly and the fourth was mis-sourced.

**The fix.** Cite the file that does state it, and keep `CLAUDE.md:23` for what it does say. The
conclusion is untouched — the mechanism was true all along.

**`observed`** — `node_modules/expo-router/_ctx.android.js:1-6` (expo-router **57.0.17**, read from
the main checkout at `~/Desktop/taxi`; this worktree has no `node_modules`) is `export const ctx = require.context(<router app-root env var>, true, /…\.[tj]sx?$/,
…)`. The context is rooted at the router's app root, not the package root, which is the part that
makes `src/build-config.test.ts` unreachable from it.

---

## Validation

**The gate was not run, and this says so rather than implying otherwise.** This change is one markdown
file under `.claude/`. Here is the discharge instead:

| Check | Method | Result |
|---|---|---|
| No gate task can read the changed file | `cat turbo.json`, `cat pnpm-workspace.yaml` | **`observed`** — `turbo.json` declares no `inputs` and no `globalDependencies` (`grep -n 'inputs\|globalDependencies\|\.claude' turbo.json` → 0 hits); `pnpm-workspace.yaml` is `apps/*`, `services/*`, `packages/*`, `db`. **`derived`** — `.claude/` is inside no workspace package, so no `typecheck`/`lint`/`test`/`build` task takes it as an input. **Condition**: holds only while `turbo.json` adds no root-level `inputs`/`globalDependencies` and no package reaches into `.claude/` |
| Worktree ownership | `git status --porcelain` clean at `884627a` before editing; `ls "$(git rev-parse --git-dir)"/{MERGE,REBASE,CHERRY_PICK}_HEAD` → none | **`observed`** — `wt-review222` was mine for this pass, no other session's index rode in |
| Edits applied exactly once each | each replacement asserted `count(old) == 1` before substitution | **`observed`** — 5 edit blocks, 6 findings, all asserted |

Running the full gate on a markdown diff buys no signal and spends a real risk of the known api-suite
flake (memory `taxi-gate-hangs-on-red-api-suite`). Say the word if you want it run anyway.

## The sweep

Every retired value and subject, the exact `grep -n` run **against the fixed tree**, and its hits.
Repo-wide greps are `grep -rn … --exclude-dir=node_modules --exclude-dir=.git .` from the worktree
root — path-only exclusion, so no content line is eaten (memory `taxi-review-payoffs-are-claims`).

| # | Retired / expected | Command | Hits |
|---|---|---|---|
| S1 | `five mutations` — **retired** | `grep -rn "five mutations" …` | **0**, repo-wide ✅ |
| S1b | `three mutations` — survives, correct | `grep -n "three mutations" <doc>` | 1 · `:73`, the table's own introduction ✅ |
| S2 | `is verbatim at` — **retired** | `grep -rn "is verbatim at" …` | **0**, repo-wide ✅ |
| S2b | the paraphrase wording — present | `grep -n "faithful paraphrase of \`docs/epics/sakta-cab.architecture.md:90\`" <doc>` | 1 · `:367` ✅ |
| S3 | ``scoped to `src/app/**` `` — **retired** | `grep -rn 'scoped to \`src/app/\*\*\`' …` | **0**, repo-wide ✅ |
| S3b | the `_ctx` citation — present | `grep -n "_ctx.android.js:1-6" <doc>` | 1 · `:327` ✅ |
| S4 | `A guard that is wrong in` (F4's duplicate) — **retired** | `grep -rn "A guard that is wrong in" …` | **0**, repo-wide ✅ |
| S4b | the surviving single statement | `grep -n "A guard that fails both ways" <doc>` | 1 · `:91` ✅ |
| S5 | the revision pin — present | `grep -n "43068db22a079c67198fc7f7ccb5e85286ba3207" <doc>` | 1 · `:29` ✅ |
| S5b | **subject sweep** — every eas-cli path still in the document | `grep -on 'eas-json/src/build/[a-z]*\.ts:[0-9-]*\|\`\(schema\|types\|resolver\)\.ts:[0-9-]*\`' <doc>` | 12 sites · `:24 :60 :64 :67 :84 :85 :86 :87 :132 :143 :362 :378` — **all fall after the pin at `:26-33`**, which is worded to cover bare `resolver.ts:…` forms and the prescribed docblocks ✅ |
| S6 | the `derived` label — present | ``grep -n 'EAS-effective Android distribution` is \*\*`derived`\*\*' <doc>`` | 1 · `:83` ✅ |
| S7 | **subject sweep** — `apps/driver/CLAUDE.md:23` sites | `grep -rn 'apps/driver/CLAUDE.md:23' …` | 1 · `:329`, cited now only for the file-layout convention it states ✅ |

`<doc>` is `.claude/code-reviews/pr-222-review.md`. Line numbers are the fixed tree's, so they shift
if the document is edited again — the strings do not.

## What needs a human look

Nothing blocking. Two things worth a glance rather than a re-run:

1. **The F1 clause's scope wording.** It governs by sentence, not by syntax — *"every `schema.ts`,
   `types.ts` and `resolver.ts` reference below"*. A future eas-cli citation added to this document
   inherits the pin silently, which is right while the document stays a dated record of round 1, and
   wrong the moment anyone cites a different eas-cli version in it. It is a review document, so that
   moment should not come.
2. **`884627a` remains in the branch's history** as the commit that introduced F3's wrong count. The
   count is gone from the tree; the commit message is not rewritten, because it accurately describes
   what that commit set out to do.

## PR body

`#223`'s body carried F1's copy at its `:21` — *"Established from eas-cli's own source rather than
from docs prose: `schema.ts:154` wires …"* with no revision. Updated to name
`@expo/eas-json@24.5.0` (`gitHead 43068db`) in the same clause, after the fix commit was pushed.

**`observed`** — the body's `:24` already read *"three mutations of the tree at `e029183`"*, so F3's
wrong count had no copy there; and the body's `expo export` line discharges by *"zero importers,
`testMatch`-only reachability"* without citing `apps/driver/CLAUDE.md`, so F6 had no copy either.
`grep -n "five mutations\|verbatim\|CLAUDE.md:23"` over the fetched body → **0 hits** for all three.

**A second copy, made stale by this pass itself.** The body's Validation read *"this branch adds one
markdown file under `.claude/code-reviews/`"* — true until the commit that carried this report added a
second, under `.claude/reports/`. Corrected in the same body edit to *"two markdown files under
`.claude/`"*, with the no-gate-task-reads-it derivation and its condition stated there too. This is
the `taxi-report-restating-pr-body-figures` shape: the fix commit moves the number the body quotes, so
the body is re-derived after the push, never before it.

A round-1 fixes section was added to the body at the same time, naming all six and pointing here.
