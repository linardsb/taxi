# Backlog drift: why tickets pile up while the epic stalls, and the two-part fix

Written 2026-09-21 from the ux-factory investigation. Same skill set, same loop, same drift here.

## The finding (ux-factory, observed)

- Epic #295 had moved: 7 of 26 tickets merged in the prescribed order in 14 days. It did not feel like it.
- Every open non-epic ticket was a review byproduct: five "deferred from PR #N's round-2 review (F4)" tickets, three
  from an audit doc. None came from the product or from the owner.
- 59 non-merge commits on main in 14 days: 18 review-fix rounds, 24 docs-only.
- A full week (10-14 Sep, five PRs, ~7,000 lines, 135 of them code) built a merge gate that cannot block a merge,
  because branch protection is off. No epic ticket behind any of it.

Root cause, one sentence: the review step is allowed to create tickets, and every ticket it creates is smaller
than the next epic slice, so the loop picks it first and the queue refills faster than the epic drains.

The rule that causes it is written down. `.claude/skills/piv-fix-review-findings/SKILL.md` says, in three places,
that a deferred finding is "logged as an issue". Here those are lines 48, 138 and 142 (observed 2026-09-21).

## The same drift in taxi (observed 2026-09-21)

- Labels over all 24 open tickets: `review-residue` 3, `plan-follow-up` 3, `post-demo` 2, `epic` 1 — 8 tickets
  carry any label at all, and #137 carries two of these four. Closed with
  `closed:>=2026-09-07`: 37, of which `review-residue` 5 and `plan-follow-up` 3. The label names admit the
  origin. `observed` 2026-09-21 (`gh issue list --state open`; `gh issue list --state closed --search
  "closed:>=2026-09-07" --limit 100`).
- Of the twelve PRs merged #227-#245, **seven changed more non-code lines than code lines** (#231, #233,
  #235, #236, #241, #243, #245), and three of those are docs-only close-the-loop PRs with **zero** code lines
  (#231, #235, #243 - #235 is `docs(runbooks)`, not `docs(ai-layer)`). `observed` 2026-09-21, `gh pr list
  --state merged --limit 14 --json number,files`; code = lines changed in `.ts .tsx .js .jsx .mjs .sql .sh
  .py .json .yml .yaml` files, paper = every other file. **The window is named because it moves:** #248 and
  #249 merged later the same day, both zero-code, taking the same measure to **nine of twelve** over
  #231-#249.
- Epic #1 has four UNBLOCKED rows right now: #4, #13, #16, #20. Nine loose tickets sit beside them. Two of
  those four rows are stale - see F3.

## F1: change where a deferral goes (one skill edit)

In `.claude/skills/piv-fix-review-findings/SKILL.md`, replace the §1 triage bullet

    - **Defer / log as an issue** — real but later; don't bloat this PR. **Create a tracker issue** (or note it) instead
      of fixing it here.

with

    - **Defer** — real but later; don't bloat this PR. **Where a deferral goes is decided by severity, not by habit:**
      - **Low or Medium** → append it as one checklist line to the body of the **next open epic ticket that touches the
        same file or module** (`gh issue edit <n> --body-file`). Name the PR, the finding code and the file. Do **not**
        open a new issue. If no such epic ticket exists, note it in the report and drop it — it will be re-found by the
        review of whichever PR next touches that file, which is the only time it can be verified anyway.
      - **High** with no epic ticket to carry it → **create a tracker issue**, with the PR and finding code in the body.
      - Why: a review deferral that becomes a standalone ticket competes with epic slices for the same queue and is worked
        first because it is smaller. A deferral is a note for the next slice, not a slice.

Then in §4 replace "just make sure the deferred items are logged as issues" with "just make sure every deferred item
is filed where §1 says it goes (an epic ticket's checklist, or a High-only issue)", and in Output replace
"**deferred/logged** (with issue refs)" with "**deferred** (with the epic ticket it was appended to, or the
High-only issue ref)".

Applied in ux-factory. Applied here too - see **Applied here** below.

## F2: read the epic back (one new read-only skill)

`piv-slice-epic` writes the epic task list. Nothing read it back, so the loop picked whatever was open. The new
skill `piv-next` is one bash 3 script over `gh` + `jq`, no writes:

- per open epic, each `- [ ] #N … (depends on #a, #b)` row printed as UNBLOCKED or blocked-on-what;
- every open ticket with no epic row, with the open epic ticket its own body names as the fold target;
- one line: `== next: #N`.

`.claude/skills/piv-next/` (SKILL.md + next.sh) is copied from ux-factory byte-for-byte - it needed no edit, because
nothing in it names a repo. `observed` 2026-09-21: `grep -rn '295|ux-factory|ux_factory'` over the copy is empty.

Its read of taxi right now:

    UNBLOCKED  #4   Spike: Expo background GPS field test (gates the driver app)
    UNBLOCKED  #13  Deploy: Hetzner environment
    UNBLOCKED  #16  Rider app: auth shell + booking flow
    UNBLOCKED  #20  Admin routes (merged web app)
    loose: #246 → #13 · #137 → #13 · #135 → #13 #17 · #134 → #13 #16 · #64 → #20
    loose, no target named: #247 #124 #123 #68
    next: #4

## What the owner still decides

- Which loose tickets fold (append as a checklist line, close with a comment) and which are reader-visible bugs
  to work as-is. The script names targets from each body's own references; it never moves anything.
- Whether a ticket with no fold target is a bug (work it) or process upkeep (park until the epic has no
  UNBLOCKED row).
- One review round per PR unless round 1 found a High. Not enforced by any skill; a habit.

## Applied here (2026-09-21)

- **F1** - three edits to `.claude/skills/piv-fix-review-findings/SKILL.md`: the §1 triage bullet, the §4
  "nothing was fixed" sentence, and the Output line. Text taken from this plan, not from ux-factory's applied copy
  (that one names its own epic, #295).
- **F2** - `.claude/skills/piv-next/` copied in. `observed` 2026-09-21: `bash .claude/skills/piv-next/next.sh`
  run from this repo's own path exits 0 and reproduces the read printed above, unchanged.
- Neither touches compiled source, so the gate has nothing to compile; CI runs it on the PR regardless.
- `/piv-next` will not register as a slash command until a session starts after this lands. `bash
  .claude/skills/piv-next/next.sh` works now. There is no `~/.claude/skills/piv-next` to shadow it
  (`observed` 2026-09-21, `comm -12` over both skill directories is empty).

## F3: epic #1's rows are stale, and piv-next inherits that

The script is right; the body it reads is out of date. Three rows, `observed` 2026-09-21 from `gh issue view 1`:

    - [ ] #4  - Spike: Expo background GPS field test (no deps; gates #14)
    - [ ] #13 - Deploy: Railway environment (depends on #7)
    - [ ] #14 - Driver app: auth, online toggle, location streaming (depends on #4, #8)

- **#4 was deferred by the owner on 2026-08-26** (no Android phone, no paid Apple account until the app exists),
  and #14 was unblocked then on the mounted-phone superset design. The epic body never recorded either. So
  `next: #4` names the ticket that was shelved a month ago, and #14 prints as blocked when it is not.
- **#13 is Hetzner, not Railway** - the row's title is from a superseded decision (`docs/runbooks/hetzner-deploy.md`).
  It prints UNBLOCKED, which is correct, under the wrong name.

The fix is one `gh issue edit 1 --body-file`; it is a write to the backlog, so it is the owner's, not made here.
Until it lands, read `next:` as *the first row the epic body calls unblocked*, not *the next thing to do*.

## Q1: F1's Low/Medium branch would drop two reader-visible bugs

F1 is applied verbatim, including "if no such epic ticket exists, note it in the report and drop it". Against
today's loose set that rule discards #124 (`fix(dispatch): cascade's two halves disagree about whether queue mode
is on`) and #123 (`fix(customers): mark phone-booked users provisional so an OTP signup can claim them`) - both
`review-residue`, both with no fold target named in their own body, and both describing behaviour a rider or
dispatcher would see. The carve-out to decide on, one clause: "...and drop it **unless it is a reader-visible
bug**, which is an issue whatever found it." Not added without the owner's word, because it is the exact hole the
rule exists to close.
