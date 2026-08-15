# Review — PR #116 · `docs: name the REDIS_PORT/REDIS_URL split and its NOAUTH symptom`

**Branch** `feature/dev-env-redis-doc` → `main` · 2 files, +16/−4 · **Recommendation: request changes**

| Severity | Count |
|---|---|
| Critical | 0 |
| **High** | **2** |
| Medium | 2 |
| Low | 1 |

This PR exists to make a config trap legible, and the *diagnosis* is right: the two settings really are
independent, and the confusing-failure premise is real on this machine. Two claims it makes about what that
failure looks like do not survive checking — and one of them is the sentence the PR is built around. Because
this is a documentation change, the prose **is** the deliverable: a wrong sentence here is the defect, not a
blemish on one.

Every claim below was re-derived against source or a run on this machine. Nothing is inherited from the PR
body or the plan.

---

## Validation

Gate run on this branch, from a cleared dist, with the Redis suites enabled:

```
REDIS_TEST_URL=redis://localhost:6381 COMPOSE_PROJECT_NAME=taxi \
  pnpm turbo run typecheck lint test build --force
```

| Task | Result |
|---|---|
| Full gate (typecheck · lint · test · build) | **21/21 tasks successful**, 58.6 s — `observed` |
| `@taxi/api` jest | **54 suites, 462 tests passed**, 35.3 s — `observed` |
| Redis-gated suites | **ran, not skipped** — `redis-kv.store`, `redis-driver-location.store`, `redis-dispatch-queue.store` all PASS — `observed` |
| PR body's `env.schema` figure | **re-derived: 1 suite, 21 tests, 0.336 s** vs the body's 0.342 s — accurate ✓ |

**Caveat on that green, stated rather than buried:** the first gate run **failed**, and I ran `pnpm install`
before the run above. The failure was `Cannot find package 'jsdom'` in `@taxi/dispatch:test` — `jsdom` is
declared at `apps/dispatch/package.json:31` but was absent from `node_modules`. **This is a pre-existing
stale-install condition in the local checkout, not a PR defect**: this PR touches neither `apps/dispatch` nor
`pnpm-lock.yaml`. Reported separately so it does not read as a PR failure — but it means my green came from a
tree the author's did not have.

The PR body says the full gate was not run and does not imply otherwise. That honesty is the right call and
is noted as a strength, not a finding.

---

## High

### H1 · `.env.example:16-17` — the boot-failure claim is contradicted by an observed run

```
# Authentication required`, and RedisIoAdapter.connectToRedis assigns its two
# clients only after both ping, so a boot hangs with the real error buried.
```

Neither half holds. **It does not hang, and the error is not buried — it is the crash reason.**

**Observed.** I replicated `connectToRedis`'s connection sequence — `new Redis(url)`, `.duplicate()`,
`await Promise.all([pub.ping(), sub.ping()])` — against `redis://localhost:6379`, i.e. the precise server the
comment describes (`vtv-redis-1`, which answers `-NOAUTH Authentication required.` to a raw PING; confirmed
separately by socket probe). One deliberate difference: my probe attaches two `error` listeners the adapter
does not, which makes the failure *more* visible than production, not less — so it can only understate the
"buried" claim's wrongness, never manufacture it:

```
[17ms] pub error: NOAUTH Authentication required.
RESULT: REJECTED at 18ms with: ReplyError: NOAUTH Authentication required.
error events emitted: 1
```

**Rejected at 18 ms. One error event.** Not a hang; not a scroll.

Downstream, `main.ts:15` awaits `adapter.connectToRedis(env.REDIS_URL)` inside `bootstrap()`, and `main.ts:23`
is `void bootstrap();` with no `.catch`. So the rejection becomes a fatal unhandled rejection **before**
`app.listen` (`main.ts:21`), with `NOAUTH Authentication required.` as the terminating error. That is the
opposite of buried — it is the single thing printed.

The credited mechanism is also causally inert. `redis-io.adapter.ts:39` is the awaited line; `:40-41` assign
the clients only after it settles. Reordering the assignment above the `await` could not change whether the
`await` settles, so assignment order cannot produce a hang. Per CLAUDE.md — *"when a figure credits a
mechanism, say what was held constant to isolate it"* — nothing here isolates assignment order, because it has
no effect to isolate.

**Provenance — this is the inherited-not-audited pattern, verbatim.** The sentence is a transplant of
`mint-tracked-ride.ts:409-412`:

> `RedisIoAdapter.connectToRedis` assigns its clients only after both ping, so a failure there **leaks two
> ioredis instances that retry forever and bury the real error under a scroll of `NOAUTH`**.

There the subject is a process that **catches and survives** (the script wraps `kv.ttl()` in `try/catch` at
`:414-416` and throws its own friendly error). Moving the sentence to `.env.example` silently swapped the
subject to `main.ts`, which has no catch — and mutated *"leaks two clients"* into *"a boot hangs"*. Same
shape as #87 and #107: a claim copied from a place where it was true into a place where it is not.

*Scope of my evidence:* my probe exits on rejection, so I did **not** observe whether leaked clients retry in a
surviving process. I am therefore not adjudicating the script's own wording, and **`mint-tracked-ride.ts`
should not be touched by this PR** — the noun is right in that file and wrong in this one.

**The subject appears on four surfaces** (CLAUDE.md: retire the subject, not the sentence — grep the noun,
not the word-form):

1. `.env.example:16-17` — fixable
2. **PR body, Summary ¶2** — *"the boot hangs with the real error buried"*, plus *"expensive to diagnose"*
   resting on it. The most-read surface and the only one not in the working tree.
3. **PR body, "Notes for the reviewer"** — *"`main.ts:15` awaits `connectToRedis` during bootstrap, so **a
   stall** there does block boot."* This is the stated *verification* for the retracted claim, phrased as
   "stall" rather than "hang" — so a body that fixes only ¶2 still argues for the deleted sentence. There is
   no stall: the await settles, by rejection, in 18 ms.
4. Commit `a1b9cf6` message body — *"so the boot hangs with the real error buried"*

**Minimal fix** for `.env.example` — this replacement **also carries M2's scoping**, so apply it instead of,
not alongside, a separate M2 edit:

```
# A mismatch usually is NOT ECONNREFUSED. If nothing holds the port you do get
# ECONNREFUSED; the confusing case is when something else answers on 6379. A
# password-protected server there rejects the ping with `NOAUTH Authentication
# required`, and main.ts:15 awaits connectToRedis, so boot dies there — before
# app.listen, with NOAUTH as the fatal error.
```

Fix the PR body and, if the Summary's framing ("expensive to diagnose") is to survive, restate what actually
makes it expensive: not a buried error, but a *successful* connection to the wrong server — which the PR's
own opening paragraph already says better.

### H2 · PR body, "Notes for the reviewer" — a verification claim the source contradicts

> the unit jest config (`services/api/package.json`) declares no `setupFiles`, `setupFilesAfterEnv` or
> `globalSetup`, so nothing loads `.env.example` for the specs

`services/api/package.json` declares **both** of the two it names:

```json
"setupFiles":  ["<rootDir>/../test/setup-env.ts"],
"globalSetup": "<rootDir>/../test/global-setup.ts",
```

Root `CLAUDE.md` states the same thing independently — *"global-setup drops the shared test DB"* — so this was
contradicted by the project's own rules file before any source was opened.

The **conclusion** survives (`.env.example` itself is never loaded), so no code is wrong because of it. What
makes this High rather than Low is *where* it sits: under the heading **"were verified against the source, not
inherited."** A false verification claim is worse than an unverified one — it spends the reviewer's trust to
skip the check, on the one surface CLAUDE.md singles out as most-read and not in the working tree.

**Minimal fix:** replace with what is actually true and load-bearing — see M1, which gives the correct reason.

---

## Medium

### M1 · `.env.example:18-19` — the stated reason is wrong once the file is copied

```
# REDIS_TEST_URL is deliberately absent: nothing loads this file for jest (the
# specs read process.env directly), so setting it here would be inert.
```

The **advice is correct** — `observed`: my gate run exported `REDIS_TEST_URL=redis://localhost:6381` in the
shell and all three Redis suites ran instead of skipping. The **reason** is not.

`app-config.module.ts:18` sets `envFilePath: ['../../.env', '.env']`, and its own comment at `:5-7` says the
cwd is `services/api` *"for both `pnpm --filter @taxi/api dev` **and jest**"*. `harness.ts:390` boots the real
`AppModule`. So `.env` **is** loaded under jest for every harness-based spec.

Strictly, "this file" means `.env.example`, which is never loaded — but CLAUDE.md's documented first step is
`cp .env.example .env`, which copies this exact sentence into the file that *is* loaded, where it reads as
self-refuting. A developer who generalises it to "nothing in `.env` reaches jest" has been misled.

The real reason it is inert is stronger and worth stating instead: the four gated specs latch the variable at
**module load**, before any Nest module boots inside a test body —

```
redis-dispatch-queue.store.spec.ts:19   const REDIS_TEST_URL = process.env.REDIS_TEST_URL;
redis-kv.store.spec.ts:11               (same)
redis-io.adapter.spec.ts:23             (same)
redis-driver-location.store.spec.ts     (same)
```

That latch runs when jest imports the spec file; any `ConfigModule.forRoot()` inside a `beforeAll` is strictly
later, so the skip decision is already made by the time `.env` is read at all.

**Minimal fix:** *"REDIS_TEST_URL is deliberately absent: the gated specs latch it at module load, before any
config module runs, so a value in this file — or in the .env you copy it to — never reaches them. Export it in
the shell…"*

*(A second candidate reason — that `envSchema` has no `REDIS_TEST_URL` key, so @nestjs/config's `validate`
strips it — is deliberately **not** asserted here. I did not verify either half of it, and this report cannot
recommend a replacement reason on the same terms it is criticising. The module-load latch is verified and
carries the finding on its own.)*

### M2 · `.env.example:14` — "NOT ECONNREFUSED" is stated as the general rule

```
# The symptom of a mismatch is NOT ECONNREFUSED — whatever holds 6379 usually
# answers.
```

In the ordinary case — nothing on the port — ECONNREFUSED is *precisely* the symptom. The comment's genuine
insight is the **confusing** case, where something else answers; stating it as the universal rule will read as
false to the first developer who hits the plain empty-port failure and undercut the rest of the block.

The "usually" is doing real work on this machine (6379 and 6380 are both occupied — see Strengths), so this is
scoping, not a reversal.

**Minimal fix: none of its own — folded into H1's replacement block above**, which already opens with the
scoped form. H1 and M2 edit the same four lines; treating them as two independent edits would either
reintroduce this defect or produce a contradiction. Listed separately only so the defect is named.

*(I did not measure the empty-port failure timing and deliberately quote no figure for it.)*

---

## Low

### L1 · `env.schema.spec.ts:38-39` — `.min(16)` is described as "old", but it is live

> `// … 18 chars, so the old .min(16) accepted it and a copied example file booted a real host.`

`env.schema.ts:29` still reads `JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters')`
— it is the current base rule and still governs dev/test. What is new is the production-only
`PUBLISHED_SECRETS` check (`env.schema.ts:11`, enforced at `:220`) layered on top. A reader who greps
`.min(16)` finds it present and is briefly misled.

The rest of the comment checks out: `.env.example:27` still commits `JWT_SECRET=dev-only-change-me`, that is
18 characters, and the assertion at `:42` pins the literal value.

**One-word fix:** "so `.min(16)` **alone** accepted it".

---

## What's good

- **The core insight is correct, and it is the valuable part.** Verified independently:
  `docker-compose.yml:28` publishes `"${REDIS_PORT:-6379}:6379"`; `env.schema.ts` has no `REDIS_PORT` key at
  all; `main.ts:15` dials `env.REDIS_URL`. Genuinely independent, and "change BOTH" is the right instruction.
- **The reorder is a real footgun fix, not cosmetics — and it fixes both halves.** Moving the active
  `REDIS_PORT=6379` *above* the commented `#   REDIS_PORT=6381` matters because last-key-wins. Verified in
  both parsers that read this file:
  - dotenv (JS, the API side): `parse("REDIS_PORT=6379\nREDIS_PORT=6381")` → `{"REDIS_PORT":"6381"}`
  - compose (Go, the container side): `docker compose config` with the same duplicate → `published: "6381"`

  Under the old order, a developer uncommenting the documented example would have been **silently overridden**
  by the active line below it — the worst possible outcome for a note whose entire subject is port confusion.
  This is the best thing in the PR and the PR body undersells it by not mentioning it at all.
- **The documented procedure works exactly as written — I dogfooded it.** `COMPOSE_PROJECT_NAME=taxi docker
  compose ps` on this machine printed `0.0.0.0:6381->6379/tcp`, so "the host side of `->6379/tcp`" resolves to
  6381, correctly. The `COMPOSE_PROJECT_NAME=taxi` prefix is right per CLAUDE.md's worktree rule.
- **The premise is real, not hypothetical.** `docker ps` on this machine: `vtv-redis-1` holds
  `0.0.0.0:6379->6379/tcp` and `merkle-email-hub-redis-1` holds `6380`. That matches what
  `redis-dispatch-queue.store.spec.ts:8-9` already documents. This comment is worth writing.
- **De-pinning the spec comment is the correct direction, and this PR proves its own point.** `JWT_SECRET` was
  at `.env.example:16` before this change (verified at `HEAD~2`) and is at `:27` after — commit 1 falsified
  commit 2's comment, exactly as predicted. Naming the key instead is right.
- **The PR body's one measured figure is accurate.** Re-derived: 1 suite / 21 tests / 0.336 s against the
  claimed 0.342 s.
- **The body states plainly that the full gate was not run** rather than implying it had been, and justifies
  the scope. That is the standard CLAUDE.md asks for.
- No hard-rule surface is touched: no money, no status transitions, no cross-surface contracts, no seams, no
  i18n. `max-lines` does not apply (`.env.example` is data; the `.spec.ts` is uncapped).

---

## Recommendation

**Request changes** — H1 and H2.

Neither is a code defect, and the gate is green; but this is a *documentation* PR whose entire value is the
accuracy of four sentences, and the headline sentence describes a failure mode that an observed run
contradicts. Shipping it would put a wrong diagnosis in the first place a developer looks when they hit this
trap — and would leave a false "verified against the source" claim in the PR body, which is the pattern
CLAUDE.md was amended twice (#87, #107) to stop.

The fix is small: rewrite two sentences in `.env.example`, correct the PR body's Summary and its
"Notes for the reviewer", and take M1/M2/L1 while in there. The diagnosis, the reorder and the
`docker compose ps` recipe all survive unchanged — the PR is one honest paragraph away from being good.

Suggested next step: `piv-fix-review-findings` on this report, then re-run the gate.

---

*Reviewed against `CLAUDE.md` + `services/api/CLAUDE.md`. Deep pass dispatched to the `code-reviewer` agent;
its H1 finding was independently confirmed by an observed run before being carried here, and its `.min(16)`
line-cite was re-checked rather than inherited. H2 is this review's own.*
