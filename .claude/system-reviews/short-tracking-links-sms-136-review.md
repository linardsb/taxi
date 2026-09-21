# System Review — Shorter tracking links + trimmed LV/RU SMS templates (#136)

## Meta information

| | |
|---|---|
| Plan reviewed | `.claude/plans/short-tracking-links-sms-136.md` |
| Execution report | `.claude/execution-reports/short-tracking-links-sms-136.md` |
| Also read | `.claude/reports/short-tracking-links-sms-136-report.md`, `.claude/code-reviews/pr-245-review.md`, `.claude/reports/pr-245-review-fixes.md`, `REMEDY-LEDGER.md` |
| PR | [#245](https://github.com/linardsb/taxi/pull/245), merged `5e45d49` |
| Date | 2026-09-21 |

**Ledger read first, as the skill requires.** Open before this loop: **L17, L20, L21**, with L20 ranked
first for the next apply slot. **L20's class recurred in this loop** — see D1-b. That recurrence, plus the
ledger's own ranking, is why L20 takes one of the two apply slots rather than anything newly discovered.

## Overall alignment score: 9/10

Nine divergences, all logged by the implementing session before any reviewer asked, eight of them the
implementer being right about something the plan had wrong. The one that costs a point is D1: the plan's
own ordering constraint — *"Write the result into this plan's AMENDMENTS **before** starting Phase 2"* —
was not met, and the completion checklist says so in the plan itself rather than quietly ticking.

**Plan correctness: 6/10.** Four defects entered in the plan and were reproduced faithfully. Faithful
reproduction is not a divergence, which is why they do not move the 9.

- `plan_defect:` AC #0 written as handset-only, with no substitute oracle named.
  `entered_at:` plan `:359-389` (SPIKE Phase 0) and `:839`.
  `reproduced_at:` the build proceeded under stated assumption A2 for its whole length; the spike then ran
  in about an hour on an Android emulator and `NSDataDetector`, both available the entire time.
- `plan_defect:` the `dist` verification recipe reads an `export *` barrel and returns 0 regardless of
  whether the exports resolve. `entered_at:` the plan's Level 4/5 grep recipe. `reproduced_at:` D5 — the
  implementer ran it, got 0, and had to substitute a runtime resolve check.
- `plan_defect:` `env.schema.spec.ts`'s `prod()` fixture host `https://track.example.com` is 17 characters
  and cannot boot under the gate the same plan specifies. `entered_at:` the boot-gate task.
  `reproduced_at:` D3, a file-wide fixture change the plan had not scoped.
- `plan_defect:` the "rate-limited by `TRACKING_VIEW_MAX_PER_WINDOW`" wording that became the docblock
  review finding F3. `entered_at:` plan `:492`, the `schemas/tracking.ts` task's own instruction.
  `reproduced_at:` two shipped docblocks, caught in review, and the plan's copy corrected by the fix pass's
  sweep rather than by the review. **This is the sharpest one**: the plan told the implementer to write a
  false justification, the implementer wrote it, and the false justification is what licensed cutting the
  token from 128 bits to 96. Exactly the #87 shape — work de-scoped on a claim the code contradicts.

## Divergence analysis

```yaml
divergence: Phase 0 ran last, on substitute oracles, not first on a handset
planned: spike before any code; handset via Twilio; result in AMENDMENTS before Phase 2
actual: code shipped on the assumed branch; spike ran same-day on an Android 16 emulator
        (Google Messages, adb emu sms send, tapped → VIEW intent into Chrome) and on
        NSDataDetector(.link) on macOS Foundation; leg (a) closed, no shipped line changed
reason: "the spike needs a verified handset and a person looking at it; neither is available
        to an agent session" (plan AMENDMENTS, 2026-09-21)
classification: bad ❌ on ordering, good ✅ on the substitution itself
justified: partly — the substitution was right and should have happened at Phase 0
root_cause: unclear plan — AC #0 named the hardware, not the property, so "no handset" read
            as "cannot run" for the length of the build
```

```yaml
divergence: F1's first regression fixture did not reproduce the failure the finding named
planned: piv-fix-review-findings §2.3 — "run the new test against the unfixed code and watch it fail"
actual: first fixture was 'https://a' + '/'.repeat(100_000); it PASSED on the vulnerable body
        in 8 ms, because a slash run reaching the end of the string matches on the regex
        engine's first attempt. The review's own input had a trailing 'x'. Second attempt with
        the 'x' took 8892.7 ms against a 250 ms bound
reason: the skill requires a red probe but not that the probe use the reviewer's input
classification: bad ❌ — caught by the implementer, not by the process
justified: no
root_cause: missing validation — this is ledger row L20, RECURRING
```

```yaml
divergence: D2 — trackingLinkHost() exported rather than the boot gate re-implementing the strip
planned: the gate re-does the scheme/slash strip with its own .replace pair
actual: one exported function, called by both
reason: two regexes that must agree is an off-by-one waiting to happen
classification: good ✅
justified: yes
root_cause: better approach found
note: second-order cost — exporting it made the parameter a library-input taint source, which is
      why CodeQL raised js/polynomial-redos on a regex that had sat in the api unflagged
```

```yaml
divergence: D4 — sms-segments.test.ts ships 6 cases, not the planned 7
planned: seven cases including "'€' alone → 2 septets"
actual: that case became a boundary PAIR (158 ASCII + € = 1 segment, 159 + € = 2)
reason: septet cost is not assertable through a function that returns segments
classification: good ✅
justified: yes
root_cause: plan specified an assertion the chosen API cannot express
```

```yaml
divergence: D6 — Level 5's noun-grep was triaged hit by hit, not driven to empty
planned: the plan already said not to drive it to empty
actual: every hit outside .claude/ read and triaged; four deliberately-historical statements kept
classification: good ✅ (plan followed, and the temptation named and resisted)
justified: yes
root_cause: none — this is the rule working
```

```yaml
divergence: D8 — Level 4 manual steps 1-2 not run
planned: boot the API, mint a phone-channel RU ride to accepted, read the logged body
actual: not run; recorded as not-run rather than implied. Step 3 performed by curl against next dev
reason: what they add over ride-notifications.service.spec.ts is the repository-row wiring;
        the measurement half is covered by four bodies rendered through the built dist
classification: bad ❌ — but honestly declared and correctly costed
justified: partly
root_cause: unchanged from #87/#94 — Level 4 steps that need a booted stack are the ones that
            get skipped. The plan DID ship the means (mint-tracked-ride.ts exists, L4 closed)
```

D3, D5, D7 and D9 are the plan-defect rows above and in the execution report; they are listed there
rather than duplicated here.

## Pattern compliance

- [x] **Followed codebase architecture** — vertical slices intact; `packages/shared` still imports nothing
      from the workspace; the contract moved *into* shared, which is the direction the rules want.
- [x] **Used documented patterns** — integer cents untouched, no direct status writes, provider seams
      untouched, all strings from the LV/RU/EN catalogs, `max-lines` respected (largest changed file
      `env.schema.ts` at 407).
- [x] **Applied testing patterns correctly** — expected + edge + failure per slice; and beyond the rule,
      the budget test is a *total* proof rather than a sample, with both bites recorded.
- [x] **Met validation requirements** — full parity gate green at the final code head, exit 0, 22/22,
      CI green including `codeql`, draft flipped itself.
- [x] **Figures carry provenance** — and the fix pass's value-sweep found five stale copies the review had
      not. This is the one repo rule that is now visibly *working* rather than being enforced by reviewers.

One compliance gap, and it is procedural rather than technical: the plan's own **completion checklist has
three unticked boxes** (Phase 0 ordering, manual testing, "acceptance criteria all met — 9 of 10") and the
PR merged anyway. That is the correct honest record and the correct human call; it is worth noting only
because nothing in the loop *stops* on an unticked checklist, and nothing should pretend otherwise.

## System improvement actions

**Applied this loop (2 of 2 slots, per CLAUDE.md's "act on 1–2"):**

- [x] **L20 — `piv-fix-review-findings` §2 step 3: the red probe must use the input the finding names.**
      Ledger-ranked first, and its class recurred here. Edit applied at `:91`; the row's own absence
      locator now reproduces, which is how the ledger closes it.
- [x] **L26 (new, applied same loop) — `piv-plan-implementation` ACCEPTANCE CRITERIA: before an AC is declared unperformable,
      name the cheapest substitute oracle for the *property* and say why it does not answer it.**
      The existing rule at `:449` already handles hardware-absent ACs by spinning them out to an owed
      issue. It asks whether *this machine* can perform the verification. It does not ask whether the
      hardware is the only oracle for the property — which is the question #136 never put, and which had
      a cheap, in-tree answer the whole time. Edit applied; see the ledger.

**Recommended, not applied — logged as ledger rows L23 and L24. Open is now 5 (L17, L21, L23, L24, L25),
and L25 is ranked first for the next apply slot:**

- [ ] **`piv-review-pr`: separate "blocks the merge" from severity.** F1 is High because `codeql-gate.sh`
      fails on an open high-severity alert and `ready` needs it — the review's own prose says the finding
      is *not exploitable in this tree*. The severity column is the surface people read, and it said
      "High security finding in `packages/shared`" where the true statement is "the merge is blocked by a
      gate". A separate `Blocks merge` marker, or a kind word beside the severity, costs one table column.
- [ ] **`piv-review-pr`: run the claims-outlived-their-subject sweep as a review step, not a fix step.**
      Four of ten findings (F3, F4, F5, F10) were claims that had outlived what they described, and the
      *fix* pass's value-sweep then found five more the review had missed. The sweep works and runs one
      step too late.

**Not recommended — CLAUDE.md prose.** Rejected for the fifth time, on the ledger's own evidence: prose
remedies do not fire here, skill edits do. Both applied remedies above are skill edits by construction.

## Key learnings

**What worked well**

- **The budget as an executable derivation** rather than a number in a comment, pinned at exact length as
  well as segment count. At host 11, five of six bodies still bill one segment — a segment-only test would
  have caught one row in six.
- **Moving a contract to where it can be tested.** `trackingLink` in `@taxi/shared` is what let the api's
  minted link and the dispatch rewrite table be pinned to each other in one test.
- **Declaring the skip.** D8 and the three unticked checklist boxes are the loop's most valuable output
  after the code: they are what makes the 9/10 mean something.

**What needs improvement**

- **A plan can specify a false justification, and faithful execution then ships it.** F3's wording came
  from plan `:492`. The plan skill's Fact Verification block (L1/L13) checks plan *claims about the
  codebase* against real artifacts; it does not check a plan's *security or rationale claims* against the
  code that would have to be true for them. **Action:** not applied this loop and not left as a
  prediction — appended as ledger row **L25**, class C1, with the note that it is the #87 mechanism
  recurring one layer earlier than #87 found it.
- **An acceptance criterion written in terms of an instrument is a criterion about the instrument.**
  AC #0 said "handset". The property was "does a bare `host.tld/path` linkify". Those are not the same
  claim, and only the second one had to be true. **Action:** applied this loop as the
  `piv-plan-implementation` edit above.
- **The red-probe rule is satisfiable by a probe that proves nothing.** **Action:** applied as L20.

**Accepted risk — not worth a control**

- **The gate does not stop on an unticked completion checklist, and should not.** A control here would
  either block merges on honest records or push implementers to tick boxes they should not. The record
  being honest is the control; the human reading it is the gate. The cost of being wrong is one merge with
  a known-open AC, which is what happened, deliberately, with the AC named in the PR body.
- **Leg (c) — an independent oracle on `smsSegments()` — stays unanswered.** It needs a funded SMS
  account. #137's bake-off day needs one regardless. Carrying it is cheaper than blocking on it, and the
  in-tree counts stand on `sms-segments.test.ts` plus the review's independent re-derivation.

**For next implementation**

- When a plan phase gates on a resource the session lacks, the first move is to ask what else measures the
  same property — not to write a stated assumption and proceed. #136 got the right answer by luck; the
  cost of the other branch was one line of code and a halved saving, both already costed in the plan.
- When applying a reviewer's finding, copy the reviewer's input verbatim into the probe before writing a
  cleaner one. A same-shaped substitute is how F1's first attempt went green on vulnerable code.
