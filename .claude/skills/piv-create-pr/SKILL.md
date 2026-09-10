---
name: piv-create-pr
description: Push the current feature branch and open a pull request as a draft; CI's `ready` job flips it to ready for review when the gate is green (#165). Use after a ticket's implementation is committed on its own branch — it detects the base branch, pushes, opens the PR with a clear body (summary · what changed · validation status), and returns the URL to hand to a reviewer.
argument-hint: "[--base <branch>] (default: auto-detected)"
---

# Create PR: Open the Pull Request, Hand Off for Review

This is the **ship** step of the PIV loop: the implementation is committed on a feature branch; now open the PR
so it can be reviewed (by the `piv-review-pr` agentic gate, then a human).

## Phase 0 — Detect the base branch

Don't hardcode `main`. Resolve it:
1. If `$ARGUMENTS` contains `--base <branch>`, use that.
2. Else: `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'`
3. Fallback: `git remote show origin 2>/dev/null | grep 'HEAD branch' | awk '{print $NF}'`
4. Last resort: `main`. Store as `{base}`.

## Phase 1 — Validate git state

```bash
git branch --show-current
git status --short
git log origin/{base}..HEAD --oneline
```

| State | Action |
|-------|--------|
| On `{base}` | STOP: "Create a feature branch first (the ticket should be on its own branch)." |
| Uncommitted changes | STOP: "Commit (or stash) before opening the PR." |
| No commits ahead of `{base}` | STOP: "Nothing to PR." |
| Existing PR for this branch (`gh pr list --head $(git branch --show-current) --json url`) | STOP and print the URL. |
| Clean, commits ahead, no PR | PROCEED |

## Phase 2 — Gather context for the body

- **Project conventions:** if `.claude/references/conventions.md` exists, read its `## pr` section — its rules
  win over the default template below (sections, tone, what must be stated). That file is where a project's
  specifics live; this skill stays general.
- Commits: `git log origin/{base}..HEAD --pretty=format:"- %s"`
- Files: `git diff --stat origin/{base}..HEAD`
- **Every size, count or per-path figure in the body must be produced by a command you run NOW, against the
  final commit, with the command shown beside the figure.** Never transcribe one from the plan, the
  implementation report, a review, or an earlier draft of this body — those are the four places it has been
  wrong before. If a figure is a decomposition, print every bucket and its sum so the arithmetic is checkable
  (`477 + 62 + 94 + 485 = 1,118`), and make sure each bucket's label matches what it actually contains.
  A tag like `observed` says where a number came from; it does **not** say the number is right — #87, #107 and
  #117 were all correctly tagged and wrong, and #117's *correction* was wrong twice more before it was right.
- **Implementation report** (if `piv-implement` wrote one — `.claude/reports/<…>-report.md`): pull the summary,
  validation results, and **documented deviations** (these belong in the PR body — they tell the reviewer what
  was intentional).
- Linked issue: look for `#123`, `Fixes #…` in the commits/branch name.
- PR template: if `.github/PULL_REQUEST_TEMPLATE.md` exists, fill it; else use the default below.

## Phase 2.5 — Generate the validation block, then find the inherited figures (blocking)

Two scripts live beside this skill. **They are referenced here so that deleting them shows up in a
diff** — the previous copies lived only under `~/.claude/skills/`. Ten lines across five `.claude/`
reports and reviews named them (`git grep -n record-gate c70572b`), but nothing on an executable path
did, so the #129 cleanup destroyed the files and left only the prose about them (ledger L2).

```bash
.claude/skills/piv-create-pr/scripts/record-gate.sh --clean
.claude/skills/piv-create-pr/scripts/inherited-figures.sh <draft-body.md> <report.md> [--pr {N}]
```

**`record-gate.sh` runs the gate and prints the Validation block. Paste it; do not retype it.** It
exits with the gate's own code, so a red gate cannot produce a green-looking record. **STOP and fix
before opening the PR if** `.claude/last-gate.json` is missing, its `head` is not the current `HEAD`
(the record describes a different tree — most often after a rebase), `exit_code` is non-zero, or
`short_gate` is true. Read `tasks_not_in_graph` too: a package that defines no `test` or `lint` script
is not checked by a green gate, which is how two apps went unchecked at "18 successful, 18 total".

**`inherited-figures.sh` prints every measurement it can bind to a unit word or a duration that this
body shares with the implementation report or with the PR's own previous body** — not every shared
figure: its duration matcher drops a minute prefix, so `1m22.325s` and a bare `22.325s` reduce to one
key. Each hit is *unaudited*, not necessarily wrong: re-derive it at this
head, or say why it is head-independent. Pass `--pr {N}` when updating an existing PR — the published
body is the most-read surface and the only one no working-tree grep can reach. No implementation report
(a docs-only PR) is an ordinary case: it prints a note and exits 0, which is not a pass.

**What neither script can catch — these stay by-eye checks:**

- **A right number under a wrong label.** #87's figure was correct; the label was the defect.
- **A claim with no numeral at all.** #121 shipped "GitHub retargets the base branch automatically"
  — no digit for a numeric check to bind to, and false.
- **Retire the claim's subject, not its digits.** A retired claim survives as a verb ("the cache this
  script *measures*") long after its number is gone. Grep the noun — `quantiz`, `grid`, the issue
  number — and read every hit, including the PR body.

## Phase 3 — Push and open the PR

```bash
git push -u origin HEAD
```

```bash
gh pr create --draft --base "{base}" --title "{type}: {concise description}" --body "$(cat <<'EOF'
## Summary
{1-2 sentences: what this ticket delivers}

## What changed
{commit summaries}

## Validation
- Tests / type-check / lint: {pass/fail from the implementation report or a fresh run}
- Manual check: {what was exercised, or "pending review"}

## Notes for the reviewer
{documented deviations from the plan — intentional decisions — or "none"}

## Linked
{ticket / issue refs, or "none"}

_Opened as a draft; CI's `ready` job flips it when `check`, `audit-diff` and `codeql` are green (#165). A red job leaves it here with the failing check on the PR._
EOF
)"
```

(`{type}` = feat/fix/refactor/… from the work.) Never run `gh pr ready`; the hook refuses it and CI owns the
flip. If the PR stays a draft, the failing check is the next finding.

## Output

```bash
gh pr view --json number,url,title,baseRefName,headRefName
```

Report the PR number + URL, the base ← head branches, and **"Draft. CI flips it ready in about 3.5 minutes when
green (`check` `observed` 195–206 s over PR #167's four runs, 2026-09-10; `ready` starts after it); then run
`piv-review-pr <number>`, then a human approves."** This is the handoff point: the agent's loop ends at an open PR;
review and merge are the gates.

## Notes

- Tool-agnostic in spirit: this skill uses GitHub (`gh`); the same motion is "open a merge request" on GitLab,
  or "mark ready for review" wherever your team works. Solo with no remote? Skip the PR — commit on `{base}` and
  review your own diff before moving on.
- Sets up parallel work: one branch per ticket → one PR per ticket is exactly what makes worktree parallelism
  (running independent tickets at once) clean.
