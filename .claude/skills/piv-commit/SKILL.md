---
name: piv-commit
description: Creates a new git commit for all uncommitted changes with an atomic, conventionally-tagged message. Use when work is complete and ready to be committed.
---

# Commit: Create a New Commit

Create a new commit for all of our uncommitted changes.

## Process

0. **Read this project's conventions.** If `.claude/references/conventions.md` exists, read its `## commit`
   section and follow it — those rules win over the defaults below. That file is where a project's specifics
   live; this skill stays general.
1. Run `git status && git diff HEAD && git status --porcelain` to see what files are uncommitted.
   Then run `git log -1 --format=%s`; if the subject starts with `wip:`, run `git reset --soft HEAD~1`
   before staging — that is a `piv-implement` end-of-day snapshot, not a real commit, and after one the
   other three commands print nothing at all.
2. **Plan-staleness check**, then add the untracked and changed files. Run `ls .claude/reports/`; if this
   branch's plan has a report there, read both its `## Deviations from the plan` **and** its
   `## Tasks completed`, and edit every divergence — including a task whose shipped files or queries
   differ from the plan's IMPLEMENT line (#19's C4: the report named `findOffersForRides`, the plan
   still names `countAttempts`) — into the plan's `## STEP-BY-STEP TASKS`, or date it under
   `## AMENDMENTS` as superseded. Staged here, not later. #120 lost 2 adherence points to this, #121 lost 1; Task C4 named a retired coupling on `main` days after the ticket shipped.
3. Write an atomic commit message with an appropriate, descriptive summary.
4. Add a tag such as `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, etc. that reflects our work.

## Output

A single commit containing all uncommitted changes, with a conventional-commit-style message
(`<tag>: <atomic description>`) that accurately reflects the work done.

After the commit succeeds, print two clearly labelled summaries:

### What Changed
One short paragraph (3–6 sentences) describing the feature/fix/refactor that was committed — what problem it solves and what files were the key touch points. Write for a developer skimming the git log.

### AI Layer Changes
Only include this section if any files under `.claude/` were modified or added (CLAUDE.md, `.claude/references/`, `.claude/skills/`, `.claude/agents/`, etc.).

List each changed AI-layer file with a one-line note on what evolved and why. If nothing in `.claude/` changed, omit this section entirely.
