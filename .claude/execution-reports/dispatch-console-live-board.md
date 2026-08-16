# Execution Report — Dispatch console: live board, merged web app (#18)

## Meta Information

- **Plan**: `.claude/plans/dispatch-console-live-board.md`
- **Implementation report** (from `piv-implement`): `.claude/reports/dispatch-console-live-board-report.md`
- **Review**: `.claude/code-reviews/pr-117-review.md` (11 Medium, 9 Low — REQUEST CHANGES)
- **PR**: #117, merged `d82765a` 2026-08-16; issue #18 auto-closed
- **Date**: 2026-08-16

**Provenance of this report.** This session did NOT write the feature commit (`2859446`) — it ran the
review-fix round (`10f5dda`, `ccd5da5`). Everything about the original implementation's *reasoning*
is sourced from the implementation report and the review, and is marked `per report` where it
matters; everything about the fix round is first-hand. Flagged because this skill exists to capture
*why*, and a cold session can only inherit that half.

### Scope (`712ae76..d82765a`, `observed`)

| | Count |
|---|---|
| Files changed | 100 (38 added · 44 modified · 18 deleted) |
| Lines | +5,688 / −503 |
| Commits | 3 (feature +4,579/−489 · review fixes +1,211/−144 · follow-ups +55/−27) |

The 18 deletions are `apps/admin/**` — the workspace retirement (T12).

## Validation Results

Final gate (`COMPOSE_PROJECT_NAME=taxi`, `REDIS_TEST_URL=redis://127.0.0.1:6381`, `--force`):

| Check | Result |
|---|---|
| Syntax & Linting | ✓ clean across all packages |
| Type Checking | ✓ clean |
| Unit + Integration | ✓ **18/18 turbo tasks, exit 0, 0 cached** |
| shared | 157 passed / 18 files (was 152 pre-review) |
| db | 17 passed / 3 files |
| api | 488 passed / 55 suites, **0 skipped** (was 483) |
| dispatch | 94 passed / 15 files (was 71 / 14) |
| CI on the PR | pass, 3m21s |

Level 4 (live reliability drill) was run by the implementing session only — 75 frames/150 s, 31
`driver:location` patches, kill/restart resync, live 403. **Not re-run after the fix round**; the
fixes are covered by unit/integration cases instead. Stated because the review flagged those drill
figures as taken on the report's word, and that remains true.

## What Went Well

- **The reliability architecture held up under adversarial review.** The property the ticket exists
  for — the pill cannot claim «Tiešraide» without a fresh frame — survived a three-agent review with
  the core invariant intact. `applyFrame` being the sole writer of `lastFrameAtMs` is what made
  `driver:location` patches unable to forge freshness; the review called this out as correct. The two
  Mediums against it (M2, M7) were defects in what *feeds* the derivation, not the derivation.
- **`listOnline`'s contract fixture run against both the fake and real Redis** stopped the in-memory
  fake from inventing an ordering guarantee Redis does not give — the single highest-leverage test in
  the slice, and it was planned rather than discovered.
- **The catalog's type-level guarantee is real**: `MessageKey = keyof typeof lv` plus
  `as const satisfies Record<Language, Record<MessageKey, string>>` makes a missing *or* extra
  translation a build failure. When the fix round added two keys, all three locales were forced.
- **Narrowing `dispatch:board` to `BOARD_LIVE_RIDE_STATUSES` immediately paid out.** The moment it
  landed, typecheck failed at two real sites (`board.service.ts:95`, a `ride-queue` test asserting a
  `completed` ride). That is precisely the mechanism M8 asked for, demonstrated within minutes.
- **Mutation-testing the two subtle fixes** (zone index-pairing, frame ordering) converted "the test
  looks right" into `observed`: reverting each fix fails 1 and 2 cases respectively.

## Challenges Encountered

- **Slice-cycle risk in the obvious M4 fix.** The review's suggested shape — export the snapshot key
  from the board slice, import it into `clearSession()` — would have closed an auth↔board import
  cycle, since board already imports auth. Resolved by declaring the key in `session.ts`. The finding
  was right; its one-line fix was not.
- **The M2 guard had a worse failure mode than the bug, as suggested.** Ordering on `frame.at`
  unconditionally also orders against a *hydrated* frame, whose `at` can be arbitrarily far ahead
  (clock step, restored profile, same origin pointed at another environment) — which would reject
  every subsequent frame forever and pin the pill at «Atjaunojas…». The real bug was bounded and
  self-healing. Gating on `lastFrameAtMs !== null` was required to make the fix a net improvement.
- **The a11y fix needed a second pass its own test could not force.** Hoisting `role="alert"` off the
  `<li>`s onto a wrapper satisfied L3, but left the region mounting *with* its first content — a
  known announcement miss, and invisible to `getAllByRole('alert')).toHaveLength(1)`, which passes
  either way. Caught on re-reading, not by the suite.
- **Concurrent-session interference during the gate.** `payments.integration` failed once with
  `connection terminated mid-transaction`; passed 10/10 standalone. This is the documented
  shared-test-DB collision (CLAUDE.md: "one gate at a time") — six worktrees are live on this
  checkout. Cost one full gate re-run to distinguish from a real regression.
- **Per report**: the PreToolUse hook blocks creating a worktree `.env`, so the drill's dev servers
  needed a scratchpad export script; and drill take 1 missed the unclaimed alert because the observer
  subscribed after the no-candidate branch had already fired inside the 300 s dedupe window.

## Divergences from Plan

The implementation report lists ten, all accepted at review. They are not repeated here. Two of them
interact with the review's findings and are worth restating:

**Deviation 3 — flash driven by active alerts only**

- Planned: `unclaimedSeconds > 0 ∨ active alert`
- Actual: alert-driven only
- Reason: every fresh request has `unclaimedSeconds > 0`; flashing all would bury the S9-4 signal
- Type: Better approach found — and it is the same ISA-18.2 alarm-budget reasoning that M3 (the
  spurious ack beep) turned out to violate elsewhere in the same panel. The principle was understood
  and applied in one place while being broken in another.

**Deviation 9 — write-through frame persistence**

- Planned: throttling left open
- Actual: every frame, unthrottled
- Reason: a few-KB write at 0.5 Hz needs no optimization at pilot scale
- Type: Justified — but this is the write that made M4 (driver PII surviving logout) a *retention*
  issue rather than a stale-cache curiosity. The performance judgement was right; the lifecycle
  question it raised went unasked.

### The one divergence the report did NOT record

**The plan's board Error state was never built** (plan `:199`, UX → States: *"Error: snapshot fetch
fails while socket up → inline retry row"*). The login half shipped; the board half did not, and the
Deviations list does not mention it. Found by the review as M7 and fixed in the review round —
banner + retry now gate on `isStale()` rather than `pill === 'offline'`, with a new
`console.stale_banner_silent` key because «Bezsaistē» is a lie when the socket is up and merely
silent.

**This is the report defect worth carrying forward.** An undocumented omission is strictly worse
than a documented deferral: the review explicitly said deferring M7 to #19 was a legitimate call
*if it were written down*. The Deviations section captured ten things that were changed and missed
the one thing that was dropped.

## Skipped Items

- **Per-empty-zone `(tukšs)` cards** — needs a zone catalog the frame does not carry → #19. Recorded.
- **The board Error state** — not skipped by decision; omitted silently. Now implemented (above).
- **L9 (zone-lookup fan-out)** — the review's own call was "no action now, worth a note". A note in
  `board.service.ts` now states the fan-out is bounded by fleet size (200 concurrent `ST_Contains`
  per frame at 200 online drivers, against the pool ride booking uses) and names the batched-query
  fix for whoever raises the pilot's 10-driver cap.

## Recommendations

### CLAUDE.md — extend the numbers rule to name the review as a link (highest value)

The hard rule currently reads *"Numbers flow plan → implementation → report → PR body, and are
inherited, not audited."* Three data points now say the chain is longer and loops:

1. The PR body's size note was wrong (M1) — third occurrence of the class after #87 and #107.
2. **The review's own correction was also wrong.** M1 gave the api split as `+593 shipped source /
   +334 tests-and-scripts`; that decomposes as non-spec/specs, and the +593 *contains* the +94
   provisioning script and +62 `test/` fixtures which the same sentence assigns to the other bucket.
3. **The first rewrite of the note reproduced the same error one level down**, folding the +94 script
   into a bucket labelled "`test/` fixtures (+62)" — inside the paragraph retiring the original.

Suggested addition:

> A **review is a link in that chain, not an audit of it.** A finding's own arithmetic is inherited
> too — re-derive it before copying it into a fix, a commit message or a PR body, and re-derive it
> *again* after the last commit, because the figures move. The correction is the highest-risk place
> for the defect to recur: #117 shipped a wrong api split in the review finding about wrong splits,
> and the first rewrite reproduced it one level down. When a decomposition is the claim, print every
> bucket and its sum.

### `system-execution-report` skill — require a dropped-scope check

The skill asks "what diverged" and "what was skipped", and got ten honest answers to the first and
nothing for M7. A divergence is visible in the diff you just wrote; an omission is not — you have to
go looking. Suggested addition to the Divergences section:

> Before writing this section, re-read the plan's **UX → States** list and its acceptance criteria
> and tick each one against the diff. A state you did not build is a divergence even though nothing
> in the diff shows it; that asymmetry is why omissions get reported at zero and changes at ten.

### `piv-plan-implementation` skill — make plan states traceable

The plan listed loading/empty/error/offline states (per the CLAUDE.md UX rule) but nothing in the
completion checklist bound them to tasks, so the Error state fell between Task 10 and Task 11 with no
owner. Suggested: the COMPLETION CHECKLIST should carry one line per declared UX state.

### Not recommended

No new skill. The gaps here are two prose additions and one checklist line, not a missing automation
— and `taxi-piv-remedies-need-an-executable-step` is the standing warning that CLAUDE.md prose
remedies fire less reliably than skill edits. That argues for putting the dropped-scope check in the
**skill** (executable at run time) and only the numbers rule in CLAUDE.md, which is what the split
above does.
