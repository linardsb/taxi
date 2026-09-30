# PR #308 review, round 1: feat(skills): log-only Jev claim check for PR bodies (#302)

**Head** `acb3f63` · **Base** main @ `96053d0` · reviewed 2026-09-30 in a detached worktree · **Recommendation: request changes** (one High, a one-line fix)

## Summary

The script meets #302's acceptance, and its log-only promise holds on every path I ran: exit 0 each time. Every figure in the PR body re-derives. There are three problems:

- **H1.** A malformed API key is printed into the paste-ready block, and that block goes into a public PR body.
- **M1.** A run where the API answers but gives no verdicts is logged as a clean zero-flag result. That corrupts the 10-PR log the check exists to build.
- **M2.** This PR's own body renders with most of its content hidden inside a stray collapsed "Details" box.

## Issues

### High

**H1 · `claim-check.mjs:312,346,350,387` — the API key reaches the `<details>` block when it contains a newline.**

- **Mechanism:**
  - For errors that are not HTTP errors, the reason is `e.cause?.code ?? e.message` (line 312).
  - undici's header validation throws a `TypeError` with no `cause`. Its message contains the full header value.
  - That reason goes into `r.notes` and `r.unavailable`, which `formatReport` prints inside the block that Phase 2.5 says to paste into the PR body. The repo is public.
- **Repro** (`observed`, Node v20.20.2):
  ```
  CLAIM_CHECK_BASE_URL=http://127.0.0.1:9 TYPESAFE_API_KEY=$'SECRETKEY\nx' node claim-check.mjs b.md | grep -n SECRETKEY
  ```
  It prints four hits, lines 1, 4, 18 and 20. Lines 18 and 20 are inside the `<details>` block. The message is `Headers.append: "Bearer SECRETKEY↵x" is an invalid header value.`
- **Trigger:** a key with an embedded CR, LF or NUL, such as a two-line paste or `$(cat keyfile)` where the file has a second line. The trigger is narrow, but the outcome is a public secret disclosure and the fix is one line.
- **Fix:** in `main` (line 474), reject a key that fails `/^[\x21-\x7e]+$/` with a note that names no value. Also apply `reason.replaceAll(key, '[redacted]')` in `runAll`'s catch as a second guard. Pin the guard with a test that asserts the key string is absent from stdout.

### Medium

**M1 · `claim-check.mjs:288,343,349,373` — a run with no verdicts reports "No claim units to judge." and `0 flagged`.**

- **Mechanism:**
  - `r.failed` gets one entry per missing *answer* (line 343).
  - Line 349 compares that count, `lost`, with `requests.length`. One request carrying three questions gives `failed=3` and `requests=1`, so `r.unavailable` is never set. Line 373 then prints the no-units message.
  - Line 288's `.catch(() => ({}))` also turns an aborted body read into `{}`. A stalled body after the headers arrive therefore reads as "no answer", not as `timeout`/`budget`.
  - The totals field `failed N` adds a question count to a request count.
- **Repro** (`observed`): a stub answering `200 {}` to `Gate took 58 s (observed).` gives three `no answer for …` notes, then `No claim units to judge.`, then `0 flagged` and `failed 3` in both the summary and the block.
- **Why Medium:** the block is the 10-PR log entry. A total API-contract failure is logged as a clean body.
- **Fix:**
  - Count failures per request.
  - Set `unavailable` whenever `requests.length && !r.verdicts.length`.
  - Print the no-units message only when `!r.units.length`.
  - In `askJev`, rethrow when `signal.aborted`.

**M2 · PR #308 body (and the Phase 2.5 paste instruction) — the reviewer notes are hidden inside a stray collapsed `<details>`.**

- **Mechanism:**
  - Body line 123 starts with `` <details>` block below is log entry 1… ``, a fragment of the plain verdict list. GitHub reads the leading `<details>` as an HTML open tag with no summary.
  - In the rendered HTML, the stray `<details>` opens at offset 14887 and closes at 50174 of 50185.
  - Inside it: "My reading of the six flags" (42707), "Notes for the reviewer" with D1–D12, the CodeQL note and the stale-memory note (43807), and "Linked" (48837). All of it sits in a collapsed box labelled "Details" (`gh api …/pulls/308 -H "Accept: application/vnd.github.html+json"`, `observed`).
  - The verdict list also appears twice, and the outer copy has lost its first six FLAG lines.
- **Root cause** (`observed`):
  - `formatReport` prints the plain report and then the block. The plain half quotes sentences unchanged, and one of them contains `` `<details>` ``.
  - Running the script on this body with no key puts the first `<details>` at offset 277, inside the would-send list. The real `<details><summary>` line is at 8352.
  - The fragment on body line 123 begins at exactly that kind of first-occurrence cut.
  - The plan (`:478`) fixes the block's shape, not how to extract it.
- **Fix:**
  - Body now: replace lines 123–197 with the block from its `<details><summary>` line.
  - Script: print a unique delimiter line before the block, or write the block alone to a file named by a flag. Then change Phase 2.5 to "paste from the `<details><summary>` line". Either fix keeps the plan's output shape.

### Low

- **L1 · `claim-check.mjs:337` — a `200 null` response crashes the run.**
  - `o.body.model` on `null` gives `TypeError`. The crash handler still exits 0, but the report and its block are lost.
  - `observed`: `note: claim-check crashed, nothing judged: TypeError: Cannot read properties of null (reading 'model')`.
  - `evalSet:397` has the same shape for a `null` JSONL row.
  - **Fix:** in `askJev`, reject a body that isn't an object.
- **L2 · `claim-check.mjs:82,97` — a four-backtick fence is closed by an inner three-backtick line.**
  - `observed`: a `` ```` `` fence wrapping a ```` ``` ```` block that holds `Gate took 58 s.` sends that line as unit L3.
  - The check `startsWith(fence)` also lets ```` ```js ```` close a fence.
  - **Fix:** capture `` (`{3,}|~{3,}) `` and close only on a line of the same character, at least as long as the opener, with no info string.
- **L3 · `claim-check.mjs:290,312` — server strings enter the fenced block unsanitised.**
  - `detail.error_type`, `e.message` and `a.choice` are printed as-is. H1's repro shows the result: a newline inside the reason already breaks the line structure.
  - **Fix:** collapse whitespace and cap the length. The fix for H1 does most of this.
- **L4 · `.claude/skills/piv-create-pr/SKILL.md` Phase 2.5 — "always exits 0" contradicts the script.** The script exits 2 on usage (`claim-check.mjs:45`, test 11). Say "exits 0 except on usage (2)".
- **L5 · `claim-check.test.mjs` — test gaps:**
  - The crash handler (line 485) is never exercised.
  - Test 4 does not pin that an untracked or `../` citation is never read or sent. Replacing `readAtHead` with `readFileSync` would stay green.
  - Test 9's title ("403 on a missing key header") describes a case it does not construct. The client sends `dummy`, and the stub returns 403 regardless.
  - #302's acceptance edge case (a `derived` figure is not flagged) is covered only by live test L2, which always skips under the gate. That is not documented as a deviation.
- **L6 · `.claude/reports/jev-claim-check-pr-bodies-report.md` Level 3 cites `ad27eef`, which is not on the branch.**
  - `git merge-base --is-ancestor` fails. The report says it is a pre-commit sha.
  - The PR body correctly quotes the later run at `acb3f63`: `last-gate.json` in `wt-302` shows `head acb3f63`, `dirty false`, `1m46.511s` and `23 successful, 23 total`.
  - No action is needed beyond noting that the report's figure is not reachable from the PR.

## Constraint pass

I grepped the plan for `do not modify|frozen|read-only` and for `details|stdout`. No fix above breaks an AC. The block's summary format (`:478`) is kept by M2's fix, and the `c-harness-454` row freeze (`:689`) is untouched.

## Numbers pass

Every figure in the body re-derives or traces to a named run:

| Figure | Check | Result |
|---|---|---|
| 13 files, +1897 −6, per-file split | `gh pr view --json files` | matches; the sum is 1897 |
| Gate 23/23, 0 cached, 1m46.511s at `acb3f63` | `wt-302/.claude/last-gate.json` (head `acb3f63`, clean) + CI run 36676311030 (head `acb3f63`, `Tasks: 23 successful, 23 total`) | observed |
| `# pass 12`, `# skipped 3` | local `node --test` at head | observed: 12/0/3 |
| Eval table, all-rows and in-path columns | recomputed P/R; in-path via `findClaims` + `questionsFor` per row | matches: provenance 6+/5− asked, not_measured 4+/4−, worst_case 7+/2−, so 10 negatives off-path |
| Labelled-set blob `a55775ce` | `git hash-object` at head | matches |
| `harness.ts:534,546` | `grep -n` at head | matches |
| `inherited-figures.sh` 12 hits | re-run, body vs report | consistent; all accounted for as the body says |

### Claim-check comparison

- **Flags confirmed: 0 of 6.** **Flags rejected: 6 of 6.** **Figure findings it missed: 0.**
- L3 `provenance` and `not_measured` name defect classes and carry no figure.
- L37 `:454` `contradicts` is accurate about the line (`push: RecordingPushProvider;`). The sentence already calls the citation stale, so there is no defect.
- L37 `:541` `not_established` is the same case.
- L110 `worst_case`: 0.50–0.86 is a range of probabilities, not a case-dependent figure.
- L137: `pr-107-review.md:75` is the row's `basis` line, and the sentence claims only that the label rests on it.
- The check also missed M2, which corrupts its own log entry. M2 is a formatting defect, not a figure.

## Validation

| Check | Result |
|---|---|
| CI `check` (full gate, parity) at `acb3f63` | pass, 23/23, 0 cached (run 36676311030) |
| `audit-diff`, `codeql`, CodeQL, `ready` | pass |
| `@taxi/pr-scripts` offline suite, local | `# pass 12`, `# fail 0`, `# skipped 3` |
| `turbo --dry=json` task count | 23 |
| Local full gate | not run: 25 live claude processes share the test DB, and the hook blocks copying the env file into the worktree |

## What is done well

- The log-only guarantee has two layers: every failure becomes a note in `runAll`, and a last-resort handler keeps exit 0. No path I ran exited non-zero outside usage.
- Citation resolution fails closed. It accepts only an exact `git ls-files` entry or a unique basename, reads through `git show HEAD:`, caps a citation at 60 lines, and reports anything else as `unresolved` without sending it.
- The provenance discipline is strong. Every mutation run is dated. The in-path recount is labelled `derived` and re-derives exactly. The body states that test 10b does not pin D1, and that the eval is not held out.

## Recommendation

**Request changes.** Fix H1 and M1 in the script, repaste the body's block (M2), and pick up L1–L4 in the same pass. The Low test gaps are optional.

---

**Posted on the PR. A human now reviews the code and this review, and merges.**

---

## Addendum, 2026-09-30: base moved, head unchanged

**Head** `acb3f63` (unchanged) · **Base** main @ `025c31f` (was `96053d0`; #306 and #307 merged since round 1). Round 1's findings and verdict still apply unchanged: **request changes** on H1, M1 and M2. There is no round 2, because no fix pass has run.

Guarantees pass (`observed`):

- The PR's 13 files and the 45 files #306/#307 changed have no path in common (`comm -12` of the two `git diff --name-only` lists prints nothing).
- `git merge-tree --write-tree origin/main acb3f63` merges cleanly.
- The CLAUDE.md citation `test/harness.ts:534,546` still holds on `origin/main` (`grep -n` prints 534 and 546).
- The delta changes no `package.json`, `turbo.json` or `pnpm-workspace.yaml`, so piv-validate's count of 23 tasks is unaffected.

Gate not re-run: the head is unchanged, the file sets do not overlap, and the shared test DB is at risk while other sessions are live. CI gates the merged tree on the fix pass's next push.

### Low

**L-new · PR body, "Size" bullet: the reproduction command stops reproducing once main moves.** `git diff --shortstat origin/main..HEAD` is a two-dot tree diff, so it also counts #306/#307 in reverse. `observed` at base `025c31f`: two-dot prints `58 files changed, 2342 insertions(+), 3501 deletions(-)`, and three-dot (`origin/main...acb3f63`) prints `13 files changed, 1897 insertions(+), 6 deletions(-)`. The figure is still correct for the base it was taken at. **Fix:** use `origin/main...HEAD`, or pin the base sha in the command.
