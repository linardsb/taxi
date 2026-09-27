# PR #296 review fixes, round 1

Review: `pull/296#issuecomment-5859288346` (head `6bf8133`). The PR is docs only; every fix is an edit to `.claude/code-reviews/pr-295-review.md`.

## Triage

| Finding | Call | Why |
|---|---|---|
| F1 (High) `PR_READY_TOKEN` 401 | **Needs a human** | Rotating a PAT and setting a repo secret is Linards's. `gh secret list` still shows `2026-09-10T12:21:21Z` (checked 2026-09-27, after the review) |
| F2 (High) report's F2 names two stacking routes | Fix now | |
| F3 (Low) `EarningsCard` has no `announce` prop | Fix now | |
| F4 (Low) F4 scope is client-side validation | Fix now | |
| F5 (Low) the reopen already happened | Fix now | |

## Fixes

**F2.** The report said both routes back to home call `router.replace('/home')` and prescribed `dismissTo` at those two call sites. Re-checked before amending:
- `grep -rn 'router\.\(replace\|push\|navigate\|dismissTo\|back\)\|<Redirect\|href=' apps/driver/src --include='*.tsx' --include='*.ts' | grep -v '\.test\.'` on the worktree at `6bf8133` (tree of `f02d255` for `apps/driver`): hits match the review's table exactly, plus `verify-screen.tsx:60` (sign-in, which lands one home over `login`, the review's control row). No further route to home.
- Reducer probe, the review's four sequences verbatim, against `StackRouter.js` from the npm tarball of expo-router 57.0.17 (`nanoid/non-secure` stubbed; the key generator only), run 2026-09-27:
  ```
  onboarding      REPLACE: home(orig) | home(new)    POP_TO: home(orig)
  push tap        REPLACE: home(orig) | home(new)    POP_TO: home(orig)
  offer redirect  REPLACE: home(orig) | home(new)    POP_TO: home(orig)
  control         REPLACE: login(orig) | home(new)   POP_TO: login(orig) | home(new)
  ```
  Identical to the review's table.
- `build/link/Redirect.js:34-37` in the same tarball: `useFocusEffect` → `router.replace(href, …)`. Confirmed.

Amended: the Summary bullet, F2's route paragraph (now a six-row table with the reducer table), F2's Fix (the focus gate and `dismissTo` presented as two options, with what each has to reach; the test must pin the stack or focus, not call sites; `dismissTo` to be added to `mockRouter` at `jest.setup.ts:128-133`), and Recommendation 2's F2 bullet. The prose "exactly one home remains" was retired.

**F3.** F3's Fix now names the new `announce` prop (the signature at `earnings-card.tsx:20` is `({ body }: { body: string | null })`, checked) and the comment at `earnings-screen.test.tsx:117`. The "safe once F2's fix leaves one home" clause is gone; the card takes whichever gate F2's fix settles on.

**F4.** F4's title and body now say its scope is client-side validation, citing `vehicle-screen.tsx:76` `setErrors({})` before the `await`s at `:97` and `:100` (checked). Recommendation 2's F4/F5 bullet says the same.

**F5.** F1 and Recommendation 1 record the reopen. Timeline (`gh api repos/linardsb/taxi/issues/279/timeline`, run 2026-09-27): `commented 2026-09-27T19:44:22Z …#issuecomment-5859223173`, `reopened 2026-09-27T19:44:23Z`.

No new test: the change is prose in a review report, and no gate task reads `.claude/code-reviews/`.

## Sweep of retired claims

`grep -n -i "both\|exactly one\|dismissTo\|one home\|safe once\|call site" .claude/code-reviews/pr-295-review.md` after the edits: remaining hits are the new F2 text, "both redirects are conditional", F4's "covers both findings", F5's "both platforms" and F6's "repeats both claims" — none states the two-route claim. The PR #296 body (`gh pr view 296 --json body`) has no hit for `both|dismissTo|exactly`.

The posted copy of the report (`pull/295#issuecomment-5859111564`) was byte-identical to the file before the edit (`diff` showed only a trailing blank line); it is updated to the amended file.

## Validation

Local gate not run: the diff is two Markdown files under `.claude/`, which no typecheck, lint, test or build task reads. CI's `check` on the pushed head is the gate.
