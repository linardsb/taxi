# Execution Report — Shorter tracking links + trimmed LV/RU SMS templates, 1 segment (#136)

**Written** 2026-09-21, after PR [#245](https://github.com/linardsb/taxi/pull/245) merged (`5e45d49` on
`main`, merged 2026-09-21T14:42:38Z). This is the outer-loop reflection: what the process did, not what the
code does. The code is described in the implementation report, the review and the fixes report below.

**Not written by the implementing session.** Every divergence below is taken from an artifact that session
left — the implementation report's D1–D9, the plan's AMENDMENTS, and the fixes report's triage table — and
is attributed to it. Nothing here is a reconstruction from the diff.

## Meta information

| | |
|---|---|
| Plan | `.claude/plans/short-tracking-links-sms-136.md` (1198 lines) |
| Implementation report | `.claude/reports/short-tracking-links-sms-136-report.md` |
| Review round 1 | `.claude/code-reviews/pr-245-review.md` — landing via PR #248 |
| Fixes report | `.claude/reports/pr-245-review-fixes.md` |
| PR | #245, merged; 9 commits (1 feature, 2 fix/test, 6 docs) |
| Spun-out issues | [#246](https://github.com/linardsb/taxi/issues/246) (host shape validation), [#247](https://github.com/linardsb/taxi/issues/247) (`robots: noindex` on the tracking page) |

`observed` — `git diff --shortstat 246ae4b 5e45d49`: **33 files changed, 2944 insertions(+), 108
deletions(-)**. `git diff --name-status` splits that **10 added / 23 modified**.

**Files added (10)**

- `packages/shared/src/sms-segments.ts`, `packages/shared/src/tracking-link.ts`
- `packages/shared/tests/sms-segments.test.ts`, `tracking-link.test.ts`, `sms-budget.test.ts`
- `services/api/src/features/notifications/sms-templates.spec.ts`
- `apps/dispatch/src/app/t/tracking-rewrites.test.ts`
- `.claude/plans/short-tracking-links-sms-136.md`, `.claude/reports/short-tracking-links-sms-136-report.md`,
  `.claude/reports/pr-245-review-fixes.md`

**Files modified (23)** — `packages/shared`: the three i18n catalogs, `index.ts`, `schemas/tracking.ts`,
`tests/i18n.test.ts`, `tests/tracking.test.ts`. `services/api`: `env.schema.ts` + spec,
`notifications.policy.ts`, `ride-notifications.service.ts` + spec, `sms-templates.ts`,
`tracking.controller.ts`, `tracking.service.ts` + spec, `tracking.integration.spec.ts`.
`apps/dispatch`: `next.config.ts` and three tracking test fixtures. Docs:
`docs/research/hosting-sms-cost-research.md`, `docs/runbooks/hetzner-deploy.md`.

**Of the 2944 insertions, 1776 are `.claude/` artifacts** (1198 + 250 + 328) — `derived`, summing the three
added `.claude/` paths from `gh pr view 245 --json files`. Shipped source and tests are the remaining **1168**.
Worth stating because the headline size is 2.5x the code it describes (`derived`: 2944 / 1168 = 2.52).

## Validation results

All from the fixes report's run at `5e515a1`, the final **code** head — re-read there, not re-run here:

| | |
|---|---|
| Syntax & linting | ✅ inside the gate |
| Type checking | ✅ inside the gate |
| Unit + integration tests | ✅ `@taxi/api` 786/786 (81 suites, nothing skipped) · `shared` 255 · `dispatch` 268 · `driver` 250 · `rider` 145 · `db` 17 |
| Gate | ✅ `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://127.0.0.1:6381 pnpm turbo run typecheck lint test build --force`, `dist`/`.next` cleared, exit 0, 22 successful / 22 total, 0 cached, 1m31.041s |
| CI | ✅ at `ae997aa`: `check` 3m32s, `audit-diff`, `codeql` 1m25s, `CodeQL`, `ready` — the draft flipped itself |

Two things about that run are worth carrying forward rather than restating:

- **It sets `REDIS_TEST_URL`, so nothing is skipped.** The 39-skipped shape CLAUDE.md documents is a
  *method* difference, not a suite difference. The implementation report reconciles the two runs exactly
  (746 + 39 gated + 1 case added by review round 1 = 786), which is the right way to publish a figure that
  changed for a reason other than the code.
- **The gate was deliberately run at the last code head, and the six docs commits came after.** The fixes
  report says so in one sentence and names why: a report that quotes figures its own commit then moves is
  stale by construction. That is the #212 lesson applied prospectively for the
  first time, rather than discovered in review.

## What went well

**W1 — the budget is executable, not a number in a comment.** `tracking-link.ts` states the 70-character
equation and names which bound enforces each term; `sms-budget.test.ts` is that equation running. The
choice to pin the exact rendered length as well as the segment count is what made it bite: at host 11, five
of six bodies still bill one segment, so a segment-only test would have caught one row in six and let the
budget widen on the other five (`observed`, recorded in both the report and the review).

**W2 — the ticket moved a contract to where it could be tested.** `trackingLink` went from `services/api`
to `@taxi/shared` for a stated structural reason: an app cannot import the api, so the minted link and the
dispatch rewrite table previously agreed only by inspection. `apps/dispatch/src/app/t/tracking-rewrites.test.ts`
is the test that became possible. `shared` still imports nothing from the workspace.

**W3 — the corrections were made in the honest direction.** The research doc keeps its wrong pre-#136 RU
count visible and names the `?lang=ru` omission that caused it, rather than overwriting. The runbook now
states the consequence #13 has to act on (the 10-character gate constrains the dispatch app's own domain).

**W4 — the fix pass falsified its own fixes.** Every fix in `pr-245-review-fixes.md` was watched failing
against the unfixed tree before being called fixed, and one fixture was wrong on the first attempt in a way
that mattered: a 100k-slash ReDoS input with no trailing non-slash character **passes on the vulnerable
code in 8 ms**. A review's prescribed fix is itself
a claim — and it was caught by running rather than by reading.

**W5 — the retired-value sweep found five stale figures the review did not.** Grepping the *value* rather
than the sentence turned up the report's shared count, the report's and plan's api counts, "7 assertions",
and the plan's copy of F10's figure. CLAUDE.md's "grep the noun, not the sentence form" rule paid out.

## Challenges encountered

**C1 — the one step that needed hardware was the one step with no in-repo substitute, and it was at the
front of the plan.** Phase 0 gates the only branch point in the ticket. An agent session cannot hold a
phone. The plan's own fallback text assumed a person would run it "in ten minutes with hardware", so there
was no third option written down, and the build proceeded under stated assumption A2. See D1.

**C2 — `packages/shared` is consumed from `dist`.** The plan carried a rebuild-before-downstream warning
and it was needed; the plan's own verification recipe for it was wrong (D5).

**C3 — jest and vitest diverge on `expect` labels.** `packages/shared` is vitest, `services/api` is jest,
and the bound assertion written for one had to be rewritten for the other.

**C4 — `next dev` dirties `apps/dispatch/AGENTS.md` on every run.** Unrelated to the ticket, reverted, and
it will recur for any session that starts the dispatch dev server.

**C5 — `eslint .` in `packages/shared` reports 78 errors out of `dist/`.** The package's own `lint` script
scopes to `{src,tests}` and is green; a bare `eslint .` is not the gate and looks like a failure.

## Divergences from plan

Nine were logged by the implementing session (D1–D9 in the implementation report). D1 is the one with
process consequences; D2–D9 are ordinary engineering judgement and are summarised rather than restated.

### D1 — Phase 0 ran last instead of first, and on substitute oracles instead of a handset

- **Planned:** a spike before any code — send the two bodies to a verified handset via Twilio, check
  (a) tappable link, (b) glyphs, (c) the vendor's `num_segments`, write the result into AMENDMENTS, then
  take the branch it dictates.
- **Actual:** the code shipped first on the assumed branch (scheme dropped) under a stated assumption. The
  spike then ran the same day on **Google Messages on an Android 16 emulator** (`adb emu sms send`, then
  tapped: all three languages produced `ActivityTaskManager: START … VIEW dat=https://sakta.lv/…` into
  Chrome) and on **`NSDataDetector(.link)` on macOS Foundation**, the class iOS's link detection is built
  on (exactly one link match in each of the six shipped bodies). Leg (a) closed; the branch already taken
  was the one the evidence dictates, so **no shipped line changed**.
- **Reason:** the plan wrote AC #0 as handset-only and named no substitute, so "no handset" read as "cannot
  run" for the length of the build. The plan's own assumption entry says it plainly: *"neither is available
  to an agent session."*
- **Type:** Plan assumption wrong — specifically, an assumption about *what can be measured*, not about the
  system under test.
- **What it cost:** nothing shipped, because the guess was right. What it risked is written down: fallback
  C, one line in `trackingLink` plus two rows out of `sms-budget.test.ts`, and the saving dropping from 258
  to 129 segments/mo worst case.
- **What is still open:** leg (b) glyph fidelity is weak evidence (the emulator console builds its own
  PDU), and leg (c) — a vendor's `num_segments` as an independent oracle on `smsSegments()` — is not
  answered at all. Both are cheaper on #137's bake-off day, which needs a funded account and LV SIMs
  regardless.
- **One finding fell out of the spike that belongs to #13:** the two clients infer different schemes.
  Google Messages navigates to `https://`, Foundation resolves to `http://`. Whatever serves `sakta.lv` must
  answer port 80 with a redirect or an iOS-side tap lands on a dead port.

### D2–D9 — summary

| | What diverged | Type |
|---|---|---|
| D2 | `trackingLinkHost()` exported rather than the boot gate re-implementing the strip with its own regex pair | Better approach — two regexes that must agree is an off-by-one waiting to happen |
| D3 | `env.schema.spec.ts`'s `prod()` fixture host changed file-wide (`track.example.com` is 17 chars and now refuses to boot) | Plan assumption wrong |
| D4 | `sms-segments.test.ts` ships 6 cases, not the planned 7 — the `€`-alone case became a sharper boundary **pair** | Better approach |
| D5 | The plan's `dist` verification grep returns 0 for a reason that has nothing to do with the exports: `index.d.ts` is an `export *` barrel | Plan assumption wrong |
| D6 | Level 5's noun-grep is **not** empty and was triaged hit by hit rather than driven to empty | Plan was right; worth noting it survived the temptation |
| D7 | The research doc keeps its old figures in past tense under a CORRECTION block | Better approach |
| D8 | Level 4 steps 1–2 not run — see Skipped | Other |
| D9 | One extra runbook edit beyond the planned two (the dotenv template pointed SMS links at a domain the dispatch app is not served from) | Better approach |

**D2 is the one with a second-order cost.** Exporting `trackingLinkHost` from `@taxi/shared` turned its
parameter into a library-input taint source, which is why CodeQL raised `js/polynomial-redos` on a
`.replace(/\/+$/, '')` that had been sitting in the api unflagged. The divergence was right and the alert
was real; the two are unrelated in merit and connected in fact.

## Skipped items

- **Level 4 manual steps 1–2** (boot the API, mint a phone-channel RU ride to `accepted`, read the stub
  provider's logged body). Not run — D8. What they add over `ride-notifications.service.spec.ts`, which
  already runs the real service through the real `formatMessage` and the real `trackingLink`, is the
  repository-row wiring. The measurement half is covered by four bodies rendered through the built `dist`.
  Recorded as not-run rather than implied. **Step 3 was performed**, by `curl` against `next dev` rather
  than a browser.
- **AC #0 legs (b) and (c)** — see D1. Carried to #137's bake-off day.
- **F8 → #246, minor → #247.** Both deferred with a written reason, not by omission. F8's reason is a
  design call, not typing: rejecting a malformed host inside `trackingLinkHost` would make a pure string
  function throw on the rider SMS send path, so its home is a `.refine()` in `env.schema.ts`; and adding the
  `i` flag is not output-preserving (it flips `HTTPS://SAKTA.LV` from refused to accepted).

## Review outcome

Ten findings, one High, four Medium, five Low, plus three batched minor items. **Eight fixed, two
deferred to issues, one left to Linards.**

Two things about the shape of that review matter more than the count:

**The High was a CI block, not a code defect.** F1 is `codeql` red on `js/polynomial-redos`, and the review
said in the same breath that it is *not exploitable in this tree* — both call sites pass an operator-set,
`z.string().url()`-validated env value, never rider input. It was High because `codeql-gate.sh` fails on any
open high-severity alert the base does not carry, `ready` needs it, and the draft would not flip. So the
severity is accurate about consequence and misleading about kind: a reader scanning severities sees "High
security finding in `packages/shared`" where the true statement is "the merge is blocked by a gate". The
review itself drew the distinction in prose; the table did not.

**The rest of the findings cluster on one theme, and it is not correctness.** F3, F4, F5 and F10 are all
*claims that outlived what they described* — a docblock crediting a rate limit that does not rate-limit
guessing, "128 random bits" surviving the cut to 96, an unconditional guarantee that only holds under
`NODE_ENV=production`, a bill figure with no provenance. F2 and F9 are guards that stay green while the
thing they guard breaks. The review found **no correctness defect in the shipped behaviour** and said so
up front. This is the #87/#107 pattern still being the repo's dominant finding class, three tickets on.

## Recommendations

**R1 — `piv-plan-implementation` should refuse to write a hardware-only acceptance criterion without
first asking what would substitute for the hardware.** This is the single highest-value change this loop
suggests. AC #0 was written handset-only; the emulator and `NSDataDetector` were both available the whole
time, cost about an hour, and closed leg (a) — the only leg the branch point turns on. The plan gated its
own first phase on a resource it had already decided the session did not have, and then ran the phase
anyway at the end. A plan-time prompt ("what is the cheapest oracle that answers the branch point, and is
it in this tree?") would have moved Phase 0 back to Phase 0. Skill edit, so it fires (see R4).

**R2 — `piv-review-pr` should separate a gate blocker from a code defect in the severity table.** F1's
severity is right about what it blocks and wrong about what it is, and the table is the surface people
read. A `Blocks merge` marker distinct from the severity column, or a one-word kind alongside it, would
let a reader tell "this will hurt someone" from "this will stop the draft flipping" at a glance. Skill edit.

**R3 (smaller) — the "claims that outlived their subject" class deserves its own review sweep step rather
than being found finding-by-finding.** Four of ten findings were this. The fix pass already ran a
value-grep sweep and found five more the review missed, which says the sweep works and is running one step
too late. Candidate for `piv-review-pr` rather than `piv-fix-review-findings`.

**R4 — do not add prose to CLAUDE.md for any of the above.** Observed across #87 and #225: CLAUDE.md prose
remedies do not fire; skill edits do. R1 and R2 are both skill edits by construction.

**Not recommended:** nothing about the gate, the test strategy, or the plan's structure. The plan was
1198 lines and the implementation followed it with nine logged divergences, eight of which were the
implementer being right about something the plan got wrong. That is the loop working.
