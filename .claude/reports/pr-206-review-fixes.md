# PR #206 — round 1 review fixes

**Review** `.claude/code-reviews/pr-206-review.md` on branch `docs/pr-206-review` @ `2beaaa6` (PR #207),
not on this branch — also posted as PR #206's first comment. **Recommendation was approve**, three Lows,
no Critical, no High. **All three fixed; nothing deferred.** · 2026-09-14

Every fix is wording: a comment, a report paragraph and a PR-body paragraph. No source behaviour changed,
which is why the gate's per-package counts are identical before and after (api `77 / 726` both times).

| # | Review ID | Verdict | Where |
|---|---|---|---|
| F1 | L1 | fixed | `services/api/src/features/realtime/redis-io.adapter.spec.ts:263-269` |
| F2 | L2(a) | fixed — claim corrected, window enumerated (Linards' call) | `services/api/test/harness.ts:599-607`, report, PR body |
| F3 | L2(b) | fixed | `harness.ts:551-556`, report, PR body |
| F4 | L3 | fixed — stamp retired whole, not by the digit | `.claude/reports/issue-205-fix.md` gate section, PR body |
| — | N1, N2, N3 | no change, as the review rated them | see *Notes left standing* |

## F1 · the edge case's comment described a double close that does not happen

**Wrong:** the comment justified the test with "The harness closes the app itself when `init()` or a
self-check throws, and the spec's `afterAll` then closes it again." The second half is false, and
`harness.ts:543` four lines of the same diff away said the opposite ("`afterAll`'s `ctx.app.close()`
throws on top of it").

**Verified before rewriting** — the review's prescribed replacement is itself a claim, so the repo-wide
absolute it asks for ("nothing closes an app twice today") was enumerated rather than inherited:

```
$ grep -rn "\.close()" services/api --include='*.ts' | grep -v node_modules \
    | grep -E "app\.close\(\)" | grep -vE ":\s*(\*|//)"
28 hits; 2 are a log string (`harness.ts:591`) and a docblock (`harness.ts:673`) → 26 real call sites
```

Of the 26: 22 are `ctx.app.close()` / `nodeA|nodeB.app.close()` inside an `afterAll`, over a `let ctx`
assigned in `beforeAll`; one is the harness's own `catch`; one is `scripts/mint-tracked-ride.ts:1409`;
the remaining three are this spec's `:257`, `:267` and `:269`. None is optional-chained or guarded —
`grep -rn "ctx?\.\|if (ctx)\|ctx &&" services/api/src services/api/test` returns nothing — so a throwing
`createTestApp` leaves `ctx` undefined and the `afterAll` throws a `TypeError` instead of closing again.
**The only double close in the repo is the edge case itself.**

**Fix:** the comment now states that, and names the property the case actually guards — the idempotency
that the move from `close(server)` to `dispose()` would otherwise have dropped, since
`SocketModule.close()` ends by clearing `socketsContainer` while `dispose()` runs on every close.

**No test, and none is possible:** the test already exists and passes on both trees (the review says so,
and that is why it is an *edge* case rather than a regression pin). What changed is prose. The proof is
the enumeration above plus the gate — the sentence has no runtime.

**Closing command**, run 2026-09-14 15:24 local at `12d106d`:

```
$ grep -rn "harness closes the app itself" .claude/ services/ docs/
(no hits)
```

## F2 · "the `catch` above closes the app either way" was false for two statements

**Wrong:** `harness.ts`'s `try` body ends at `:586`. `await app.listen(0, '127.0.0.1')` (`:608`) and
`db: app.get<Db>(DRIZZLE)` (`:619`) sit outside it, and `NestApplication.listen()` rejects on a bind
error — verified at `node_modules/@nestjs/core/nest-application.js:181-185` (`errorHandler` :181,
`reject(e)` :183, `httpServer.once('error', errorHandler)` :185). A rejection there leaves `ctx`
unassigned with the app open: #199/#205's shape, one statement past the guard this PR adds.

**Scope call (Linards, this session): correct the claim, do not move the code.** The defect the review
names is the word *either way*. Moving the two statements inside the `try` would be an unprobed
behavioural change to a harness every integration spec shares, in a PR whose merit is that each
behavioural claim carries a mutation pair (B/C, E/F) — and a rejecting port-0 `listen()` is not readily
constructible, so no pair could be built for it here. The window is enumerated instead, in all three
places that state the residual windows: the comment, `issue-205-fix.md`, and the PR body.

**Kept deliberately:** the clause "this order keeps the socket out of the failure path entirely" stays —
it is true, and it is the reason the listen is last.

**Closing command**, run 2026-09-14 15:24 local at `12d106d`:

```
$ grep -rn "closes the app either way" services/api .claude/ docs/
(no hits)
```

## F3 · the pre-`registerModules()` span is three calls, not two

**Wrong:** the report, the PR body and the harness comment all said "`applyOptions()` plus the parser
middleware". **Verified at source** — `nest-application.js` `init()`: `this.applyOptions()` **:99**,
`await this.httpAdapter?.init?.()` **:100**, `useBodyParser && this.registerParserMiddleware()` **:102**,
`await this.registerModules()` **:103**. Three calls precede `registerModules()`, and the line reference
in the report was `95–103` (the whole method, including `registerModules` and everything after it).

**Fix:** all three surfaces now say three calls and cite `nest-application.js:99-102`. The conclusion is
unchanged — the http-adapter init is a no-op for Express and touches no overridden provider — so this
corrects the enumeration, not the finding it supports.

**Closing commands**, run 2026-09-14 15:24 local at `12d106d`:

```
$ grep -rn "plus the parser middleware" .claude/ services/ docs/
(no hits)
$ grep -rn "95–103\|95-103" .claude/reports/issue-205-fix.md
(no hits)
```

## F4 · the gate's provenance sha resolved nowhere, and its paragraph was false twice

**Verified independently before fixing** (the review's own claims are inherited otherwise):

```
$ gh api repos/linardsb/taxi/commits/274dc0c        → 422 "No commit found for SHA: 274dc0c"
$ git branch -r --contains 274dc0c                  → (empty)
$ git rev-parse 274dc0c^                            → 8e56fe6…   ← same as the then-head's parent:
$ git rev-parse 0763bc0^                            → 8e56fe6…      an AMEND, not a commit on top
$ git ls-tree -r --name-only 274dc0c -- .claude/reports/issue-205-fix.md
                                                    → .claude/reports/issue-205-fix.md
$ git diff --stat 274dc0c..0763bc0                  → 1 file, 13 insertions(+), 5 deletions(-)
```

So all three of L3's sub-claims hold: the sha was amended away before the push and resolves in no clone
but the authoring checkout; "one commit past `274dc0c`" described an amend; and "a report cannot stamp
the commit that contains it" was refuted by `274dc0c`, which contains it.

**Fix — the stamp was retired whole rather than patched.** Re-running the gate and swapping one sha would
have left the two false sentences standing, which is the failure mode CLAUDE.md names ("retiring a bad
claim means retiring its **subject**, not its digits"). The gate section of `issue-205-fix.md` and the
Validation section of the PR body now carry a fresh run, and a paragraph that says what the old stamp
claimed and why it was wrong.

**The new stamp is on a clean tree at a pushed commit.** `.claude/last-gate.json` records
`"head_short": "12d106d"`, `"dirty": false`, `"exit_code": 0`:

```
observed — record-gate.sh --clean (pnpm turbo run typecheck lint test build --force,
dist/.next cleared), COMPOSE_PROJECT_NAME=taxi, REDIS_TEST_URL=redis://localhost:6381,
clean tree at 12d106d, 15:22:15–15:23:47 local, exit 0

Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m31.367s

  @taxi/api       Test Suites: 77 passed, 77 total · Tests: 726 passed, 726 total
  @taxi/dispatch  Test Files 27 passed (27) · Tests 224 passed (224)
  @taxi/driver    Test Suites: 41 passed, 41 total · Tests: 218 passed, 218 total
  @taxi/rider     Test Suites: 29 passed, 29 total · Tests: 140 passed, 140 total
  @taxi/db        Test Files 3 passed (3) · Tests 17 passed (17)
  @taxi/shared    Test Files 24 passed (24) · Tests 231 passed (231)

Not in the graph: @taxi/config#{build,lint,test,typecheck}, @taxi/driver#build,
@taxi/rider#build — the same six as #199's, #203's and #206's stamps.
```

Counts are identical to the pre-fix run, as comment-only edits should leave them.

**One earlier run of this pass is NOT the stamp, deliberately.** A gate on the fixed tree before it was
committed came back green (`22/22`, `1m33.89s`) — but one source edit (`harness.ts`, `:99-103` → `:99-102`
inside a comment) landed after that run started, so the run does not provably cover the tree it appears to
describe. It was discarded and the gate re-run against the commit. That is the same defect as L3 in a
smaller form, and re-running costs 1m31s.

**Closing commands**, run 2026-09-14 15:24 local, after the push:

```
$ gh api repos/linardsb/taxi/commits/12d106d --jq .sha
12d106d403f8dee544157f632215ccfcbc8a0a6a
$ git branch -r --contains 12d106d
  origin/fix/adapter-dispose-205
```

`12d106d` resolves on the remote, which is the property `274dc0c` lacked.

## Retired-claim sweep

Each retired value and noun, the exact command, and its hits — in the tree, and separately in the **live
PR body**, which no working-tree grep reaches. Tree greps at `12d106d`; PR-body greps against the body
re-fetched with `gh pr view 206 --json body` *after* the edit.

| Retired | Command | Tree | Live PR body |
|---|---|---|---|
| the L1 comment's premise | `grep -rn "harness closes the app itself" .claude/ services/ docs/` | no hits | n/a (never in the body) |
| "either way" (the false absolute) | `grep -rn "closes the app either way" services/api .claude/ docs/` | no hits | no hits |
| the two-call span | `grep -rn "plus the parser middleware" .claude/ services/ docs/` | no hits | no hits |
| the `95–103` line range | `grep -rn "95–103\|95-103" .claude/reports/issue-205-fix.md` | no hits | n/a |
| the stamp's sha | `grep -rn "274dc0c" .claude/ docs/ services/` | hits in two files only — `issue-205-fix.md` ×6, all inside the retirement paragraph that names it as wrong, and this report ×10; **nothing else in the tree** | 1 hit, the same retirement paragraph |
| the stamp's false sentence | `grep -n "one commit on top of" <body>` / `grep -n 'at \`274dc0c\`, exit 0' <body>` | — | no hits, both |
| the superseded numstats | `grep -n "+271 −17\|(+21 −14)\|(+68)\|(+163)" <body>` | — | no hits |

The numstats were re-derived rather than carried: `git diff --numstat origin/main..12d106d` is
`4 files, +290 −18` (report +173, spec +72, adapter +19 −3, harness +26 −15), against the
`+271 −17 / +163 / +68 / +21 −14` the body carried before. They moved because this round's own edits are
in them — which is exactly why a figure gets re-derived at the sha it names.

## Notes left standing

- **N1** — "SIGTERM reaches `app.close()`" is shorthand; the signal path inlines `callDestroyHook` →
  `dispose()` instead. The substantive claim (the quits run on shutdown) holds. No change, per the review.
- **N2** — "`end` within 100 ms (`observed`)" names a throwaway run with no surviving artifact. Left as
  written: the review rated it load-bearing for nothing (the code's own bound is 2 s, and only probe E's
  failure message reads the timing). Flagged here so the next round does not rediscover it as new.
- **N3** — the retired `close(server)` mechanism was already swept correctly in the PR under review; this
  round's sweep above did not disturb it.

## Nothing deferred, nothing needing a manual look

No issue was logged, because none of the three was a "real but later" call: all three are wording on
surfaces this PR already owns, and F2's one scope question was decided in-session rather than deferred.
No manual test is owed — there is no behaviour change in this round to test.

## Commits

- `12d106d` — `fix(api): correct two comments the #206 review refuted (#205)` — F1, F2, F3 in the spec,
  the harness and the report. Pushed; gated clean.
- the docs commit on top — this report and the rewritten gate paragraph (F4). `.claude/` only, and no
  task in the gate's graph reads `.claude/`.
