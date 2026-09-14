# PR #212 review fixes — round 1

**Review** `.claude/code-reviews/pr-212-review.md` (round 1, approve, 0 Critical / 0 High / 2 Medium / 5 Low),
landing in **PR #213** off `docs/pr-212-review` — it is not in this branch, so a reader of this PR alone
cannot see it.
**PR** #212, **OPEN**, base `main` @ `fcea364`, head at triage `c5cfee9` → **`8b9001a`** after this pass.
**Ground check**: `git status --porcelain` empty; no `MERGE_HEAD` / `REBASE_HEAD` / `CHERRY_PICK_HEAD` under
`git rev-parse --git-dir`; no other session's work in the index.

**Triage**: F1, F2, F3 **fixed**. F4 **deferred** → **#214**. F5, F6, F7 **no action** (F6 declined, with a
reason the review did not have). No finding required a shipped-source change; the fix commit `2e0c756`
is untouched.

Every finding was **re-probed before being acted on** rather than inherited — two came back stronger than
the review filed them (F2's mechanism is confirmed on the wire; F3's corollary is confirmed by exit code).

---

## F1 · Medium · fixed — `main.ts` is not a caller the leak strands

**What was wrong.** The report, the plan and the PR body all named `services/api/src/main.ts:15` as a
production caller left hanging by the leak, and made the `dist` probe's exit 124-vs-0 stand for it. It does
not: `main.ts:23` is `void bootstrap();` with no handler on the returned promise.

**Probe** — `scratchpad/p1-main-shape.js`, a replica of `main.ts`'s exact shape (`void main()`, no catch)
against the same fake `-NOAUTH` server the spec uses, unfixed and fixed arms run back to back,
`observed` 2026-09-14:

```
p1-unfixed real exit=1   [exit] code=1 at 0.014s
p1-fixed   real exit=1   [exit] code=1 at 0.014s
diff of the two logs (bar the exit line): IDENTICAL
```

Both arms die on `triggerUncaughtException` with `ReplyError: NOAUTH Authentication required.`,
`command: { name: 'info' }`. The fix makes no difference to this shape because the process is already gone.

**Corroboration**, since the conclusion rests on a runtime default:

| Check | Result |
|---|---|
| `node -v` | **v20.20.2** (default `--unhandled-rejections=throw`) |
| `grep -rn "unhandledRejection\|uncaughtException" services/api/src packages` | no hits |
| same grep over `@nestjs/core`, `@nestjs/common`, `@nestjs/platform-express` | no hits |
| `services/api/Dockerfile:86` | `CMD ["node", "dist/main.js"]`, no `NODE_OPTIONS` |
| `scripts/mint-tracked-ride.ts:414-424` | `kv.ttl` pre-probe throws before `connectToRedis` is reached |

**Fixed in** — the probe-table cell, a new *What this row stands for* block under *The shipped artifact*, the
*Why clean in place* bullet and the opening caller sentence in `.claude/reports/issue-211-fix.md`; the caller
table, the Task 10 instruction, the O1-vs-O2 options table and the revision log in
`.claude/plans/connect-to-redis-partial-state-cleanup.md`; the *Summary*, the probe table's `dist` row and
the paragraph under it in the PR body.

**The probe's evidence survives** — it still proves the fix works on the compiled adapter, which is
production bytes rather than the harness. Only what it stands for changed. **The ticket's motivation is
unaffected**: the harness caller is `observed`, and `createTestApp`'s `configure` is the caller that does
reach the leak.

---

## F2 · Medium · fixed — the fake server's rationale named a command that never reaches the wire

**What was wrong.** The spec comment and the report's *Mechanism, read rather than assumed* bullet said
ioredis "pipelines its ready-check `info` with whatever is in the offline queue … and leaves `ping` waiting
forever". The hang is real; the mechanism was not.

**Probe** — `scratchpad/p2-wire-log.js`, a reply-per-**chunk** fake server logging every `data` event, two
connects in one process because `getPackageMeta()` is memoised per process. `observed` 2026-09-14:

```
=== ARM 1 (cold process) === outcome: NOAUTH Authentication required.
  chunk 1: *4 $6 client $7 SETINFO $8 LIB-NAME $7 ioredis
  chunk 2: *4 $6 client $7 SETINFO $8 LIB-NAME $7 ioredis
  chunk 3: *4 $6 client $7 SETINFO $7 LIB-VER $6 5.11.1
  chunk 4: *4 $6 client $7 SETINFO $7 LIB-VER $6 5.11.1
  chunk 5: *1 $4 info
  chunk 6: *1 $4 info
  contains PING: false

=== ARM 2 (warm process) === outcome: HUNG (3s timeout)
  chunk 1: *4 $6 client $7 SETINFO $8 LIB-NAME $7 ioredis *4 $6 client $7 SETINFO $7 LIB-VER $6 5.11.1
  chunk 2: *4 $6 client $7 SETINFO $8 LIB-NAME $7 ioredis *4 $6 client $7 SETINFO $7 LIB-VER $6 5.11.1
  contains PING: false
```

`ping` never appears on the wire in either arm. What coalesces is the two `CLIENT SETINFO` writes once
`getPackageMeta()` is warm; one reply per chunk leaves the second unanswered, and `info` is never sent in
arm 2 — so the warm arm hangs and the cold arm rejects. That is exactly the 1-of-4 / 3-of-4 split the
original comment recorded having observed, under a different name.

> ⚠️ The probe also prints `contains INFO: true` in arm 2. **That line is a false positive and is not
> quoted as evidence** — the substring `INFO` is inside `SETINFO` and `LIB-NAME`'s reply framing. The chunk
> dump is the evidence: arm 2 carries no `*1 $4 info`.

**Source read, confirming the probe** (`ioredis@5.11.1`):

- `built/redis/event_handler.js:75-101` — `Promise.all(clientCommandPromises).catch(noop).finally(…)` is
  what gates `_readyCheck`, so an unanswered SETINFO stalls the handshake before `INFO` is written.
- `built/redis/event_handler.js:296-308` — the offline queue is written **only** in `readyHandler`, which a
  failing ready check never reaches. That is why `ping` never leaves the client.

**Fixed in** — the comment at `redis-io.adapter.spec.ts:445-451`, the report's *Mechanism* bullet and its
*Both fake-server traps* sentence, and four copies in the plan (the Task 4 code block, the Task 10
instruction, the risk-table row and design trap 1).

**The `?? 1` implementation at `:452-453` is unchanged** — only the explanation. The rewrite is held to
**exactly 7 lines, replacing 7** (`git diff --numstat` → `7 7`), so probe A's code frames at `:506`, `:507`
and `:556` still read verbatim and the PR body's probe head-independence argument survives. Verified after
the edit: `:508` and `:558` are still the two `expect(fake.accepted()).toBe(2);` assertions.

---

## F3 · Low · fixed — an unreachable Redis rejects, and the fix covers it

**What was wrong.** The report's *Not done* and three places in the plan filed an unreachable Redis as an
infinite hang outside the fix's reach.

**Probe** — `scratchpad/p3b-unreachable-arms.js`, the two-client shape against a closed `127.0.0.1:6398`,
both arms under `timeout 30`, `observed` 2026-09-14:

```
==== unfixed ====  real exit=124  (killed by timeout 30)
rejected at 10.5s: MaxRetriesPerRequestError
t+500ms (11.0s): pub=reconnecting sub=reconnecting
t+4500ms (15.0s): pub=reconnecting sub=reconnecting

==== fixed ====    real exit=0
rejected at 10.5s: MaxRetriesPerRequestError
t+500ms (11.0s): pub=end sub=reconnecting
[exit] code=0 at 12.5s
```

It rejects, it does not hang: `maxRetriesPerRequest` defaults to 20 (`RedisOptions.js:52`) and
`closeHandler` flushes the offline queue with `MaxRetriesPerRequestError` on the 21st close
(`event_handler.js:198-210`).

**The review's positive corollary is confirmed, not inherited.** The exit codes are the discriminator:
unfixed never leaves, fixed leaves at 12.5 s. The 2.0 s between the catch and the exit is `derived` —
ioredis's `disconnectTimeout` default is 2000 ms and nothing else is pending; the arithmetic
(`10.5 + 2.0 = 12.5`) fits, and the mechanism is not isolated by this probe. `sub=reconnecting` still
reading at t+0.5 s is a status-field lag, not a live retry: the process exits regardless.

**Fixed in** — the report's *Not done* bullet (reframed: the connect timeout is what is not done), and the
plan's *Out of Scope* bullet and risk-table row.

---

## F4 · Low · deferred → **#214**

`CLAUDE.md`'s Redis-gated line (`33 skipped, 582 passed, 615 total`, stamped at `feed712`) is stale for the
fourth time. **Not fixed here**, for three reasons:

1. `CLAUDE.md` is outside this PR's diff, and the drift is overwhelmingly pre-existing — the review measured
   `+112 passed`, of which this PR contributes `+3`.
2. Fixing it would **falsify three statements this PR currently gets right** — the report's *Not done*
   bullet, the PR body's *Notes* bullet, and the PR body's inherited-figures sentence, all of which say the
   line is deliberately not re-measured.
3. That paragraph's own standing instruction is to re-observe the **whole claim**, not the digits: the
   "4 gated spec files, 2 of which report as skipped suites" structure and the `feed712` stamp are separate
   measurements the review did not take either.

**#214** carries the reviewer's measurement, attributed to that review rather than re-run, with the
re-observation scoped as a checklist. The report's *Not done* bullet and the PR body's *Notes* bullet now
name the issue; the inherited-figures sentence stays true unedited.

---

## F5 · Low · no action — the `?? 1` fallback

The review's own verdict is **leave it**, and its reasoning holds: the handshake is a few hundred bytes of
small loopback writes, far under the MSS, and the boundary case did not fire across two full gate runs plus
the author's three probe runs. The remedy if it ever flakes (accumulate per socket, count only complete
headers, drop the `?? 1`) is recorded in the review, which is where the next reader will look.

## F6 · Low · declined — the 132-char comment line

`services/api/test/harness.ts:585` is 132 chars in a block wrapping at ~80, added by this PR
(`observed`: the line carries a `+` in `git diff main...HEAD`). Rewrapping it is cosmetic and free —
**but editing `harness.ts` at all invalidates the PR body's byte-identity claim**, which is the argument
that probe A's and probe B's figures still apply to this head (`cmp`-verified against the copies saved
before the reverts). Trading a verified attribution argument for comment wrapping is a bad exchange. Worth
doing in the next PR that touches the file for a real reason.

## F7 · Low · no action — `new Redis(url)` / `.duplicate()` outside the `try`

The review audited the throw path and found none, and says so. Recorded in the review; nothing to change.

---

## Retired-claim sweep — the exact greps and their hits

**Three sweeps**, all `observed`, at different points in the pass — which is why the "caught stale" column
below names its sweep rather than a single "before". `$P` = the plan, `$R` = `issue-211-fix.md`,
`$S` = `services/api/src services/api/test`.

- **S1, pre-edit** — ran before any file was touched. Source of G3's and G4's stale sites.
- **S2, mid-edit** — ran after the report, spec and plan `main.ts` edits. Source of G1's and G2's, all of
  which S1's nouns did not reach.
- **S3, final** — the finished tree. Source of every "Now" cell.

**The review named 10 sites** across F1-F3 (F1 seven, F2 two, F3 one; two of the seven are in the PR body).
**The sweep found 11 more** — ten in the working tree, marked ✚ below, plus the PR body's byte-identity
sentence, which no working-tree grep reaches and which only the 7-for-7 line-count check surfaced. Without
the sweep, every one of the eleven would have shipped stating a claim this pass retired.

| # | Command | Caught stale | Now |
|---|---|---|---|
| G1 | `grep -rn "pipelin" $P $R $S` | **S2**: report `:64` ✚, plan `:314` ✚, `:566` ✚, `:629` ✚, `:847` ✚ | **2**, both explicit *"said X until PR #212 review F2"* retirement notes (plan `:633`, `:856`). The other hits are unrelated `redis.pipeline()` calls in the drivers/dispatch slices |
| G2 | `grep -rn "waiting forever\|infinite retry" $P $R $S` | **S2**: plan `:79` ✚, `:316`, `:849` | **1** — plan `:80`, the retirement note quoting the retired claim |
| G3 | `grep -rn "cannot exit\|does not exit" $P $R $S` | **S1**: plan `:50` | **0** (re-run widened to `\|can exit`, which is how plan `:829` would have been caught by noun rather than by G4) |
| G4 | `grep -rn "main\.ts" $P $R` | **S1**: report `:10` ✚, `:79`, `:127`, `:157`; plan `:50`, `:274` ✚, `:574`, `:576`, `:829` ✚, `:929` ✚ | **13**, all either corrected sites or two that need no change: plan `:24` (a user-story persona naming no consequence) and report `:236` (the caller **set**, unchanged and true) |
| G5 | `grep -rn "redis-io.adapter.spec.ts:[0-9]" $P $R .claude/reports/issue-208-fix.md` | **S1**: nothing stale — run as a knock-on check on the comment rewrite | 3 citations, **all still pointing at the same spec lines** (`:406`, `:38`, `:246-261`). The rewrite was 7-for-7, so no spec line moved; the citations' own line numbers shifted (`$R:41`→`:42`, `$P:166`→`:168`, `$P:787`→`:793`) because the report and plan grew |
| G6 | `grep -n "main\.ts\|pipelin\|waiting forever\|infinite retry\|does not exit\|cannot exit\|can exit" .claude/reports/issue-208-fix.md` | — | **0**. This file is in the PR's diff (`+13 −17`) and in **none** of `$P $R $S`, so G1-G4 never reached it. Swept separately and clean: its edit widens a *Not done* bullet and touches none of the retired claims. The gap in the sweep paths was real; the defect it could have hidden was not there |

One site was fixed from the review's list before S1 could record it stale: the spec comment at `:445-451`,
edited during F2's probe work. It is covered by G1's and G2's "Now" cells.

**The PR body is swept separately**, since no working-tree grep reaches it: re-fetched with
`gh pr view 212 --json body`, and every F1, F2 and F4 site in it is edited in this pass (see *PR body*
below).

---

## Validation

`observed` — `record-gate.sh --clean` at **`8b9001a`** on a clean tree, with
`COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381`, exit **0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m21.576s

@taxi/api        Test Suites: 77 passed, 77 total   Tests: 733 passed, 733 total
@taxi/shared     Test Files 24 passed (24)          Tests 231 passed (231)
@taxi/dispatch   Test Files 27 passed (27)          Tests 224 passed (224)
@taxi/driver     Test Suites: 41 passed, 41 total   Tests: 218 passed, 218 total
@taxi/rider      Test Suites: 29 passed, 29 total   Tests: 140 passed, 140 total
@taxi/db         Test Files 3 passed (3)            Tests 17 passed (17)
```

Every package total is **unchanged** from the run at `2e0c756` — expected, since the only non-markdown edit
is a 7-line comment. A plain (non-`--clean`) run on the **same tree content**, immediately before that
content was committed as `8b9001a`, also exited 0 in 1m21.603s. The known api-suite flake did not appear in
either.

No new test was added: all three fixes are prose, and a comment has no observable to assert on. The three
probes above are the evidence, and each was **run against the unfixed claim first** — which is what
separates them from decoration.

---

## Pushed

- **`8b9001a`** — `docs(reports): PR #212 review F1-F3 — three claims retired (#211)`. The three fixes.
  The gate above ran at this head.
- **`4bef54c`** — `docs(reports): stamp the PR #212 fix-pass gate at 8b9001a (#211)`. The gate stamp in
  `issue-211-fix.md` and the first version of this report.
- **`cabd2d9`** — `docs(reports): quote the PR #212 body sweep instead of promising it (#211)`. Corrected
  the plain gate run's provenance (same tree *content*, not a head that existed yet) and replaced the
  promised PR-body sweep with the quoted one.
- **this commit** — four more corrections, all found by a second read of this report rather than by the
  review: item 6's size figures were stale the moment the body was re-derived after `cabd2d9` (so they are
  now head-independent instead of restated); the sweep table conflated three separate sweeps into "two
  passes" and mislabelled which caught what; `8 sites` and `6 more` were bare digits in a table about bare
  digits, re-derived to **10** and **11**; and `issue-208-fix.md`, in this PR's diff but in none of the
  sweep paths, is now swept as G6.

**PR body edits in this pass** (no working-tree grep reaches it, so they are listed rather than asserted):

1. *Summary* — "through `main.ts:15` it is a `bootstrap()` that rejects and cannot exit" retired (F1).
2. Probe table, *Shipped `dist`* row — now stands for the compiled adapter, not a caller (F1).
3. The paragraph under that table — "`main.ts:15` is reached by no test" replaced with what the row
   actually establishes, plus why neither production caller reaches the path (F1).
4. **Probe attribution** — the "all three files a probe run executes are byte-identical to this head's"
   sentence, which this pass's 7-for-7 comment rewrite makes false. Now: comment-only since the probe runs,
   no executable line moved, with `:506`/`:507`/`:556` still verbatim (F2 knock-on — the review did not
   name this site, and nothing in the working tree would have caught it).
5. *Notes for the reviewer*, the `CLAUDE.md` bullet — now names **#214** (F4).
6. *Size* table and the gate block — **re-derived at the head the body's own *Size* line names**, which is
   the last write of this pass; the body carries the current figures and this report deliberately does not
   restate them. (Restating them here is unfixable by construction: any commit correcting the digits moves
   the numstat and re-stales the body. The one figure worth recording is the one that did *not* move —
   the spec's `+183 −1`, because the F2 rewrite replaced 7 of its own added lines with 7 others and nets
   to zero against `main`.) The inherited-figures accounting is rewritten from **27** measurements to
   **33**, each assigned to a group.

**Applied and verified**: `gh pr edit 212 --body-file …`, then re-fetched with `gh pr view 212 --json body`
and diffed against the source — identical bar a trailing newline GitHub adds. Sweep of the **live** body,
`observed` after the edit:

| Grep on the live body | Result |
|---|---|
| `grep -n "cannot exit\|does not exit"` | **0 hits** |
| `grep -n "main\.ts"` | 3 hits, all the corrected form (`main.ts:23` is `void bootstrap()`) |
| `grep -n "pipelin"` | 1 hit — the F2 bullet naming the retired claim as retired |
| `grep -n "byte-identical"` | 3 hits: two stating what *is* byte-identical, one describing probe output |
| `grep -nEi "(close[sd]?\|fix(e[sd])?\|resolve[sd]?) *:? *#[0-9]+"` | 1 hit — `Closes #211`, intended. No keyword sits next to `#214`, so the deferred issue is referenced without being closed |
