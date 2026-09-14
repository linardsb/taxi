# PR #209 review — round 1

**Head** `ed3a0dd7cc8649cb5b0704ae19cae1991449627d` · **Base** `main` @ `1b0ea4a067790095db54d492fbf133191b2bcfff`
**Title** fix(api): close createTestApp's last two teardown windows (#208) · ticket #208
**Reviewer** piv-review-pr, fresh context · 2026-09-14

## Verdict

**Approve.** No Critical, no High. The change does what it claims: both windows close, and each is pinned by
a genuine attribution pair rather than by a green run. I re-ran probe B here and it reproduced to the digit
and to the failure text, every `node_modules/@nestjs/**` citation I spot-checked is exact to the line, and
the gate is green at the head.

One Medium and six Lows. Nothing changes runtime behaviour — this is all test infrastructure and the claims
written around it. The Medium is the one worth a commit before merge: the harness's new comment asserts
**"EVERY step that can throw sits inside this `try`"**, and one step that can throw does not —
`options.configure` itself, which this PR just made the sanctioned place to open resources. `observed` here:
a `configure` that opens the adapter's two ioredis clients and then throws leaks both, and jest does not exit.

That is structurally the same finding as PR #206's L2(a), the one that produced this ticket: a true absolute
replaced by a new absolute that is one step short.

## Issues

### M1 · Medium · `configure` is outside the `try`, and the new comment denies it

`services/api/test/harness.ts:545` (the call) · `:547-549` (the claim)

```ts
const teardownConfigured = await options?.configure?.(app);

// EVERY step that can throw sits inside this `try` — `init()`, both
// self-checks, the listen, and the `DRIZZLE` resolution in the returned
// object.
```

The call on the line above the comment is a step that can throw, and it is not inside the `try`. Nothing then
runs `app.close()` and nothing runs the teardown — including the teardown that same `configure` would have
returned, because it never got to return one.

Not a regression: `configure` sat outside the `try` before this PR too. What makes it a finding is that #209
changes what `configure` **is**. Before, it installed an adapter; now it is the documented owner of "whatever
it opened" and the source of the teardown that closes W2. The one callback the harness now depends on for
teardown is the one callback whose own failure the harness does not cover — while the comment says the
opposite.

**Failure scenario, `observed` 2026-09-14.** A throwaway spec whose `configure` runs
`adapter.connectToRedis(REDIS_TEST_URL)` — which opens `pubClient` and `subClient` — and then throws:

```
COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 timeout 60 npx jest src/f1-probe.spec.ts
  F1 PROBE STATUSES: ready ready          ← 1.5 s after createTestApp rejected
  Tests: 1 failed, 1 total
  Jest did not exit one second after the test run has completed.
  EXIT=124
```

Both clients still `ready`, and the exit-124 non-exit is this family's own defect signature — the one #199,
#205 and #208 each closed a span of. Probe file removed; `git status --porcelain` clean before and after.

Reachable on a real machine, not only under a mutation: `connectToRedis` ends in
`await Promise.all([pubClient.ping(), subClient.ping()])` (`redis-io.adapter.ts:39`), and a server that
accepts the TCP connection and then errors the PING — NOAUTH, a wrong-type server on the port — rejects there
with both clients already constructed and neither field assigned. (The *unreachable*-Redis case hangs inside
`configure` instead, per ioredis's infinite retry — a different shape, and the one already recorded against
this repo's worktree `.env` gap.)

Neither disclosure covers it. The PR body's "The teardown is a contract, not a guarantee" and the report's
*Not done* both describe only a `configure` that **returns nothing**, never one that **throws**.

**Fix** — two parts, and only the first belongs in this PR:

1. Make the comment true. Either scope the absolute ("Every step **after `configure`** that can throw…") or
   drop it and let the enumeration that follows stand on its own — it is accurate and complete for the
   statements it lists. Add one bullet to `issue-208-fix.md`'s *Not done* naming the residual window.
2. The window itself is a separate ticket. Moving the `configure` call inside the `try` is necessary but not
   sufficient: if `connectToRedis` rejects between `new Redis(url)` and the two field assignments
   (`redis-io.adapter.ts:37-41`), `this.pubClient`/`this.subClient` are still `undefined`, so `dispose()`
   reaches nothing even when it is called. Closing that half means `connectToRedis` assigning before it pings,
   or cleaning up its own partial state — a change to shipped source, not to the harness.

### L1 · Low · `ended()`'s budget and its message are both wrong at the new call site

`services/api/src/features/realtime/redis-io.adapter.spec.ts:232-243` (the helper) · `:314` (where the timers
now start) · `:332`, `:345` (where they are first awaited)

`ended()` was written for a call site that starts the timer immediately before `await app.close()`, and its
message says so: `client still ${client.status} 2 s after close()`. `breakingConfigure` starts both timers
inside `configure` (`:314`), which is **before** `app.init()` — and for `step: 'listen'` that is the real
`init()` over the whole `AppModule` (Drizzle pool, guards, routes), then `listen`, then `close()`, then
`dispose()`, then the quit round trip. The 2 s budget now has to cover all of it, and if it fires the case
reddens claiming `close()` was reached when it may never have been.

Second consequence: `Promise.all(ending)` is only attached *after* `await expect(createTestApp(…)).rejects…`
resolves, so a timer that fires during the boot rejects a promise nobody is holding.

**`observed` 2026-09-14** — same two cases with the helper's `2_000` replaced by `1` (one-token probe,
file restored and `cmp`-verified):

```
● … › quits the adapter when listen() rejects (edge)
    client still ready 2 s after close()      at Timeout.<anonymous>   (…:236:18)
● … › quits the adapter when listen() rejects (edge)
    client still ready 2 s after close()      at Timeout._onTimeout    (…:236:18)
Tests: 2 failed, 7 skipped, 9 total          EXIT=1
```

Two extra `●` entries beyond the assertion failure — the unattached rejections surfacing. The message also
prints "2 s" while the timer was 1 ms, because the number is hardcoded into the string rather than derived
from the timeout.

Latent rather than an observed flake — but the headroom is thinner than it looks. The 2 s now has to cover a
full `AppModule` boot, and the whole 13-case file (two such boots among them) runs in 2.461 s here. That is a
margin measured against a loaded dev box and CI, not a comfortable one.

**Fix.** Make the timer `resolve(client.status)` instead of rejecting. That closes the unattached-rejection
window entirely — moving the `Promise.all` earlier does not, since the aggregate has the same gap — makes a
real failure read `Received: ['ready', 'ready']`, and is safe for the one pre-existing call site at `:263`.
Derive the duration into the message while you are there.

### L2 · Low · `issue-205-fix.md`'s line numbers now resolve to the fix that refutes them

`.claude/reports/issue-205-fix.md:61-63` and `:68`

The banner added at `:49-51` retires the section's *conclusion* correctly and says the section is "no longer
a description of the harness". The section's live line references survive underneath it and now point at the
current tree:

> "The `try` body ends at `harness.ts:586`, so `await app.listen(0, '127.0.0.1')` (`:608`) and
> `db: app.get<Db>(DRIZZLE)` (`:619`) are outside it." … "the comment at `:599-607` no longer claims the
> `catch` covers it."

In the tree at this head the `try` spans **572-618**, the listen is **`:606`** and the `DRIZZLE` resolution
**`:617`** — both inside — and `:599-607` is now the comment that says the `catch` *does* cover them. A reader
following the digits lands on the fix and reads it as a contradiction. This is CLAUDE.md's "retire the
subject, not the digits" case, one layer in: the subject was retired, the digits were not.

**Fix.** One clause on the banner — line numbers in this section refer to #205's tree — or pin them to a sha.

### L3 · Low · the teardown-masking guarantee has no test

`services/api/test/harness.ts:569-571` (the guarantee) · `:633-640` (the inner `catch`)

> "anything thrown by the teardown path — `close()` or the `configure` teardown — is printed and the
> ORIGINAL is rethrown; neither is ever allowed to mask it."

No case makes either one throw. `grep` over `services/api/src/**/*.spec.ts` for a rejecting teardown returns
nothing, so the new `catch (teardownErr)` block is unexecuted by the suite. The same hole exists for the older
`close()` catch at `:620-627`, so this is the second uncovered masking guarantee rather than the first — which
is an argument for one case, not for leaving it.

The report does get close: `grep -c "app.close() after a failed boot threw"` = 0 across the probe logs proves
`close()` did not throw, which is what pins W2's mechanism. It does not exercise the masking path.

**Fix.** One gated case: `configure` returns `() => Promise.reject(new Error('teardown boom'))` with
`app.init` rejecting on `BOOM`; assert `rejects.toThrow(BOOM)`.

### L4 · Low · the `configure` JSDoc omits both constraints the implementation depends on

`services/api/test/harness.ts:493-501`

The JSDoc is the surface a future `configure` author reads. It explains *why* a teardown may be returned and
that nothing calls it on the success path. It does not say either of the things a caller has to honour:

- **It must be idempotent.** It runs *after* `app.close()` (`:621`, then `:634`), which on most failure paths
  has already torn down the same resource. The safety argument lives only in the inline `catch` comment at
  `:628-632` and is grounded in `RedisIoAdapter.dispose()`'s specific ref-clearing. A teardown such as
  `() => server.close()` (`ERR_SERVER_NOT_RUNNING` on a second call) or `() => pool.end()` ("called end on
  pool more than once") lands in the inner `catch` and prints a confusing error on every failed boot.
- **Its lifetime is failure-path-only.** A `configure` that opens something `app.close()` genuinely cannot
  reach — the exact premise that makes W2 a real span — leaks on the **success** path, with no hook on
  `TestApp` to call. The report's *Not done* names the mirror gap (a `configure` that forgets to return a
  teardown) but not this one.

**Fix.** One clause in the JSDoc: the teardown must be idempotent, because it runs after `app.close()` may
already have torn the same thing down, and it must cover something `app.close()` handles on the success path.

### L5 · Low · the `init()` case reproduces the window's state, not the window

`services/api/src/features/realtime/redis-io.adapter.spec.ts:315` (the mechanism) · `:322` (the case name) ·
`.claude/reports/issue-208-fix.md:41`

```ts
app[step] = () => Promise.reject(new Error(BOOM));
```

For `step === 'init'` this replaces `NestApplication.init()` wholesale, so its body never executes and the
span the case is named for — `applyOptions()` → `httpAdapter.init()` → the parser middleware,
`nest-application.js:99-102` — is never entered. The case is named "when init() rejects **before
registerModules()**"; what it drives is "when `init()` never runs at all". The report's "reproduce each
failure **exactly**" (`:41`) inherits the same overstatement.

The two are observationally identical for the assertion made — `applicationConfig` is unset either way, so
`SocketModule.close()` early-returns at `socket-module.js:50` either way — so the case is sound and the fix it
pins is real. The defect is that the case cannot *distinguish* them, which means it is not evidence about
**where** the window is, only that the teardown closes it. The where is established independently, by the
source read in the report's *Mechanism* section, and every line of that read checks out (table below). So:
naming, not evidence.

**Fix.** A clause in the case's comment — the replacement stands in for a rejection inside that span and
produces the same `applicationConfig`-unset state — and narrow "exactly" at `issue-208-fix.md:41` to the
state it does reproduce exactly.

### L6 · Low · the test-time comparison attributes a cost to a mechanism nothing isolated

PR body, *Validation*:

> `@taxi/api` test time is **43.7 s** here against ~50 s at #206, so the extra app the ungated case builds
> costs nothing measurable.

Two figures from two different gate runs, on a box running other work, with nothing held constant. The
comparison cannot separate "the extra app is free" from ordinary run-to-run variance, and the sign is the
wrong way round for the claim (the run *with* the extra app is faster), which is itself the tell that variance
dominates. `observed` here: **45.666 s** at the same head — a third value in the same spread.

The #107 shape: a favourable direction read as evidence for a credited mechanism. Low rather than higher
because nothing downstream de-scopes work on it.

**Fix.** Drop the sentence, or state it as what it is: "no run-to-run regression visible at this resolution
(43.7 s / 45.666 s against ~50 s at #206; the spread exceeds the effect being looked for)."

### Minor, not raised as findings

`adapter as unknown as { pubClient: Redis; subClient: Redis }` now appears twice (`:257`, `:310-313`), with
the justifying comment only at the first site. A local `clientsOf()` would keep the comment in one place. It
fails loudly rather than silently if the premise ever breaks, so it is a readability point.

## What I verified, and how

### Validation

| Gate | Command | Result |
|---|---|---|
| Full CI-parity gate | `COMPOSE_PROJECT_NAME=taxi REDIS_TEST_URL=redis://localhost:6381 pnpm turbo run typecheck lint test build --force` | ✅ exit 0 · `22 successful, 22 total` · 1m18.607s |
| `@taxi/api` within it | — | ✅ `Test Suites: 77 passed, 77 total` · `Tests: 729 passed, 729 total` · 45.666 s |
| The two touched specs, Redis-gated | `npx jest src/features/realtime/redis-io.adapter.spec.ts src/test-harness.spec.ts` | ✅ exit 0 · `13 passed, 13 total` · 2.461 s |
| CI on the PR | `gh pr view 209` | ✅ 5/5 — `check`, `audit-diff`, `codeql`, `CodeQL`, `ready` · `mergeStateStatus: CLEAN`, not draft |

All `observed`, 2026-09-14, at `ed3a0dd` on a clean tree. The gate's 22 tasks and the `@taxi/api` counts match
the PR's stamp exactly.

### Probe B, re-run rather than inherited

The claim everything else rests on is that the teardown hunk — and only the teardown hunk — is what quits the
clients in the W2 case. I deleted the 13-line teardown `try` from the `catch` (`harness.ts:628-640`) and
re-ran the two spec files:

```
Tests:       1 failed, 12 passed, 13 total
● RedisIoAdapter teardown › createTestApp boot failures (#208) › quits the adapter when init() rejects
  before registerModules() (expected)
    Received promise rejected instead of resolved
    Rejected to value: [Error: client still ready 2 s after close()]
Jest did not exit one second after the test run has completed.
EXIT=124
```

Identical to the report's probe B row, down to the failure text and the exit code, and **only** the W2 case
flipped — both W1 cases stayed green, which is what makes it an attribution rather than "something broke".
Probe size re-derived with the report's own command: **1 hunk, +0 −13** ✓. `harness.ts` restored and
`cmp`-verified; tree clean before the gate.

Probe A not re-run (a 19-line move, lower value than B). Its size claim *is* re-derived: the block that moves
is 7 comment lines + `await app.listen(…)` + the 11-line `return {…}` = **19** ✓, which is why `+19 −19` has
matching counts.

The report's `grep -c "app.close() after a failed boot threw"` = 0 across its logs is corroborated
independently by my probe B run: `close()` ran, returned normally, and both clients were still `ready` 2 s
later — which only the `socket-module.js:50` early return explains. That rules out the #206 L1 shape (a
justifying scenario the run refutes) rather than inheriting it.

### Every `node_modules` citation, spot-checked

| Cited | Claim | Actual |
|---|---|---|
| `socket-module.js:49-52` | `close()` returns at its first line without `applicationConfig` | ✅ exact — `async close()` at 49, `if (!this.applicationConfig) { return; }` at 50-52 |
| `socket-module.js:54-56` | returns again without an adapter | ✅ exact |
| `socket-module.js:23-24` | `applicationConfig` assigned only by `register()` | ✅ exact |
| `socket-module.js:49-63` | the whole `close()` | ✅ exact (`socketsContainer.clear()` at 62) |
| `nest-application.js:99-102` | the uncovered span: `applyOptions`, `httpAdapter.init`, parser middleware | ✅ exact — and `registerModules()` is at **103**, correctly outside the range |
| `nest-application.js:88-93` / `:80` | `registerWsModule()`, called from `registerModules()` | ✅ exact |
| `nest-application.js:181-185` | `listen()` rejects via its `errorHandler` | ✅ exact |
| `nest-application.js:48-51` | `dispose()` runs `socketModule.close()` then `httpAdapter.close()` | ✅ exact |
| `nest-application-context.js:108` | only the *context*'s `init()` assigns `initializationPromise` | ✅ exact — `grep -n initializationPromise` over `nest-application.js` returns nothing |

The #121 shape — a real failure plus an inferred cause — does not apply here: the cause is read, not inferred,
and the lines are right.

### The numbers pass

| Figure | Label | Verdict |
|---|---|---|
| `+327 −49`, five files, per-file counts | observed | ✅ match `gh pr view --json additions,deletions,files` |
| Probe B `1 failed, 12 passed, 13 total`, exit 124, 1 "did not exit" | observed | ✅ re-run, exact |
| Probe B size `1 hunk, +0 −13` | observed | ✅ re-derived, exact |
| Probe A size `3 hunks, +19 −19` | observed | ✅ the 19 re-derived from the moved block; the run itself not repeated |
| Green runs `13 passed, 13 total` | observed | ✅ re-run — `13 passed`, 2.461 s |
| Gate `22 successful, 22 total`, exit 0 | observed | ✅ re-run, exact |
| `@taxi/api` `729 passed`, `77` suites | observed | ✅ re-run, exact |
| `729 = 726 + 3` | derived, condition stated | ✅ condition holds — `git diff --stat 12d106d..main -- services packages apps db` is empty |
| Six tasks "not in the graph" | observed | ✅ arithmetic consistent (4 × `@taxi/config` + 2 app builds = 6; 22 is this repo's gate task count) |
| `43.7 s` vs `~50 s` ⇒ "costs nothing measurable" | observed figures, **unsupported attribution** | ❌ L6 |
| `CLAUDE.md`'s stale Redis-gated line | disclosed, not re-measured | — pre-existing, correctly left to its own ticket |

### Issue #208's acceptance criteria

| AC | Status |
|---|---|
| A rejection from `listen()` or the statement after closes the app; a bound socket is released | ✅ `test-harness.spec.ts:105-140` asserts `listening` true at the throw, false after, `address()` null |
| A rejecting `init()` before `registerModules()` disposes whatever `configure` opened | ✅ `redis-io.adapter.spec.ts:322-333`, both clients reach `end` (see L5 on the naming) |
| Each new case run against the **unfixed** harness, its output recorded | ✅ probes A and B, one hunk each, cross-checked so neither reddens the other's case |
| The three surfaces describing these windows as open are retired | ⚠️ conclusions yes — `harness.ts` carries no "residual"/"stays open"/"unreachable in practice" prose, and `issue-205-fix.md` gains a *Superseded* banner plus two *Retired/Closed by #208* markers — but the digits underneath survive (L2) |

No implementation plan exists for #208 (`.claude/plans/` has no match), so the constraint pass is correctly
skipped — nothing to grep for a frozen-file GOTCHA. The guarantees pass does not fire either: this is round 1,
and `origin/main`'s live tip is `1b0ea4a`, identical to the recorded base.

Also checked and clean: `max-lines` — `harness.ts` (702), `redis-io.adapter.spec.ts` (348) and
`test-harness.spec.ts` (141) are all matched by the `**/test/**` / `**/*.spec.ts` exemption in
`packages/config/eslint/base.mjs`, with no `eslint-disable` anywhere in `services/api`. No hard rule is
touched: no money, no ride-status write, no payment-method path, nothing duplicated out of `packages/shared`,
no user-facing strings, and `ioredis` stays inside the slice that implements the adapter.

## What's good

- **The probe pairs are real attributions.** One hunk each, and the cross-check that neither reddens the
  other's case is the part most reviews skip. B reproduced here to the digit.
- **The `app.close()` did not throw check.** It converts W2's mechanism from assumed to observed and
  explicitly names and rules out the #206 L1 shape it would otherwise have inherited. That is previous-round
  review feedback being applied, not just acknowledged.
- **The mechanism is read, not inferred**, and every line reference survives a check. Contrast #121.
- **`configure` as the injection point is the right call.** #205 needed an on-disk python mutator to drive
  these failures; this PR drives both from shippable specs with no harness surgery, using a hook that already
  existed for its own reason. That is the difference between a probe and a regression test.
- **The derived figure states its condition, and the condition is checkable** — `729 = 726 + 3` given no
  source movement since `12d106d`, verifiable in one command and true.
- **The `dispose()` idempotency argument is grounded in the source**, not asserted: `redis-io.adapter.ts:69-75`
  clears both fields before quitting, so the unconditional second pass really is a no-op. Ordering is the safe
  one too — after `app.close()`, not before, so the clients are not quit while `SocketModule.close()` may still
  need them. The report's claim that the CORS block's `configure` "holds nothing and returns nothing" is also
  true as written (`redis-io.adapter.spec.ts:159-162` installs an adapter that never calls `connectToRedis`).
- **The test triangle is satisfied and the split across two files is forced, not sloppy.** Neither gated case
  ever binds a socket — their `listen` rejects — so the socket half has to be its own ungated case, and the PR
  names that rather than papering over it.
- **`test-harness.spec.ts:134-139` records `listening` at the throw instead of asserting inside the callback**,
  because an `expect()` there is swallowed by the harness's own `catch` and re-emerges as the boot error. A
  genuinely subtle trap, spotted and documented.
- **The discarded gate run is disclosed.** A run that could not provably cover the tree it described was
  thrown away and re-run against the commit, and the PR body says so.

## Recommendation

**Approve.** Validation is green at the head (gate re-run here, exit 0), CI is 5/5, the change matches its
stated intent, and every mechanism claim survives a read of the Nest source. Three of #208's four acceptance
criteria are met outright; the fourth — retiring the surfaces that describe these windows as open — is met in
substance and not in digits (L2).

M1 is a comment fix plus one *Not done* bullet and should land before merge — this project treats a guarantee
in a comment as a claim, and this one is false in the exact way #206's L2(a) was. The window behind it is a
separate ticket (it needs a change to `connectToRedis`, not to the harness), and the PR title's "last two"
should be read as scoped to #208's two, not as a completeness claim about `createTestApp`.

Of the Lows, **L1** is the only one with a runtime consequence (a latent flake and unattached rejections) and
is a two-line change; **L2** and **L5** are wording; **L3** is one cheap test; **L4** is one JSDoc clause;
**L6** is one sentence in the PR body. Fold what you want into a single commit and defer the rest.

---

*Round 1. Posted on PR #209 via `gh pr comment`.*
