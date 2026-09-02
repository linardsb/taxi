# Code review — PR #142, round 2

> **Landed after the fact, and one finding in it is wrong.** This file was written at `3fe9075` and is kept
> as the record of that review, unedited below. All seven findings were actioned in `3e8f6cc` (PR #142,
> merged as `269e8ec`). **R4's stated payoff is false**: it says the one-token fix makes
> `presence-state.test.ts:215` "pin the branch", but that case runs from `initialPresence`, whose
> `streaming` is already `false` — reverting the token leaves the suite green at 23 passed (`observed`). The
> fix carries an added assertion instead; see the R4 section of
> `.claude/reports/driver-toggle-off-mid-ride-held-report.md`. A review's stated payoff is an `expected`
> claim, not an `observed` one — it is written by reading, not by running.

**Head** `3fe9075` · **Base** `main` @ `660b833d1e12be751f3924d6344b82b9095d882c` · **Round-1 head** `b843671`
**Round 1**: `.claude/code-reviews/pr-142-review.md` — no Critical, no High, 3 Medium (F1–F3), 4 Low (F4–F7).
**Reviewed in**: worktree `../taxi-141`, clean at head. Deep pass by the `code-reviewer` agent (read-only);
the numbers pass, the gate and R2's trace were run with a shell and are marked `observed` below.

**Disclosure that changes how you should read this.** The round-1 fixes under review here were written by
the same assistant session that is now reviewing them. The deep pass was therefore handed to the
`code-reviewer` agent as the clean context, and every claim it made about reachability was re-run rather
than accepted — R2 in particular. Findings **R2** and **R7** are both against that session's own work, and
R7 was not visible to the agent at all.

## Summary

All six round-1 fixes land, each in the narrowest place it could, and none reaches for a new mechanism.
The delta touches no hard rule: no money, no `assertTransition` bypass, no contract duplicated outside
`@taxi/shared`, no seam bypass, no hardcoded user-facing string. Round 1's one dangling conditional — "the
generalised predicate does not over-stop… **conditional on F2**" — is discharged, and the plan's
blast-radius row was corrected to match.

No Critical, no High. **One Medium (R7), six Lows.** R7 is a false figure in the PR body. R2 is the only
Low with a behavioural trace behind it, and that trace **reproduces**.

**The honest headline: R2 shows the reachability argument behind the F2 fix is wrong.** The fix is still a
strict improvement on what preceded it, and the residual is nine steps deep and self-heals, so this is not
a merge blocker — but the argument written into the round-1 report and this PR does not hold as stated.

## Issues

### R7 — Medium · the PR body's diff decomposition is wrong by 55 insertions

`observed`. The body's decomposition table reads **1698** insertions against a true **1753**:

```
git diff --numstat 660b833..3fe9075 | awk '{a+=$1; d+=$2; n++} END {print n, a, d}'
→ 16 1753 151
```

GitHub's own PR header says `+1753 −151` — so the body contradicts the page it is printed on. The bad row
is `.claude/`: the body says `3 | 1167 | 1`, the true value is `3 | 1222 | 1`.

| Bucket | Body says | True | |
|---|---|---|---|
| `.claude/` | 1167 | **1222** | ✗ |
| `apps/driver/CLAUDE.md` | 1 | 1 | ✓ |
| `apps/driver/src` — tests | 379 | 379 | ✓ |
| `apps/driver/src` — shipped source | 145 | 145 | ✓ |
| `services/api` | 6 | 6 | ✓ |
| **Total** | **1698** | **1753** | ✗ |

**Cause, verified not guessed**: the `.claude/` bucket was measured *before* the implementation report
finished being edited. `.claude/reports/driver-toggle-off-mid-ride-held-report.md` is `255` insertions at
head; it was 200 lines when the bucket was sampled, and the round-1 fix section added the rest. So the
figure is a **stale observation printed under an explicit "re-derived at this HEAD" claim** — the exact
defect class `CLAUDE.md` names after #87 and #107, committed by the session that had just finished writing
the rule's own corrections into this PR.

It propagated nowhere else: `grep -n "1698\|1167\|1535"` across the report and the plan is empty. It lives
**only in the PR body** — the surface no working-tree grep reaches, which is precisely why `CLAUDE.md`
singles it out.

Medium, not Low: it is a false number under a truth claim, on the most-read surface. Not High — nothing
downstream can de-scope work on a diff decomposition.

**Fix**: `1167 → 1222`, `1698 → 1753`, and correct the arithmetic line to
`1222 + 1 + 379 + 145 + 6 = 1753`.

### R2 — Low · `presence-state.ts:246-254` · F2's reachability argument does not hold; the `!serverOnline` path clears `streaming` with no `stop_stream`

Found by the `code-reviewer` agent by reading. **I then reproduced the whole trace** against head in a
throwaway spec (`__r2-probe.test.ts`, run green, deleted; `git status` clean after) — so this is `observed`,
not argued.

The round-1 report and this PR body both claim: *"every route to `intent: 'offline'` with `streaming` set
has already run a teardown."* **That is false**, and `toggle_pressed` OFF is itself the counterexample —
its teardown is queued behind the put in `drained`, and the generalised predicate at `use-presence.tsx:144`
skips it when the answer lands after intent has flipped back to `online`. Round 1 called that skip an
improvement, which it is; it also creates a route to `intent: 'offline'` whose teardown never ran.

Nine steps, every one asserted in the probe:

| # | Event | State after |
|---|---|---|
| 1 | `ack_not_online` | re-assert P1, `busy: true` |
| 2 | P1 fails → `error/offline` | `intent: online`, **`server: offline`**, `streaming: true`, `busy: false` |
| 3 | `socket_connect` → P2 | **`busy` stays false** — `presence-state.ts:445-452` writes only `socketConnected` |
| 4 | tap OFF | `intent: offline`, `drain_then_clear` |
| 5 | P2 fails → `error/offline` | `busy: false` |
| 6 | `drained` → P3 + `stop_uploader` + `TEAR_DOWN` | **`busy` stays false** — `:333-334` returns `state` unchanged |
| 7 | tap ON inside P3's ≤8 s window | `intent: online`, `streaming: true`, task alive |
| 8 | P3 answers | predicate `intent !== 'offline'` → **`'stop'`**; `stop_uploader` and `TEAR_DOWN` never run |
| 9 | deny foreground | `serverOnline` **false** → `{intent: offline, streaming: false}`, effects `[persist_intent]` — **no `stop_stream`** |

End state: «Bezsaistē» on screen, `streaming: false` in state, OS task still emitting, socket up, keep-awake
held. The two load-bearing steps (3 and 6 — the puts that leave `busy` clear) were confirmed in source, not
only in the probe.

**Weigh it before acting.** Nine steps, two network timeouts, a socket reconnect and a mid-window
double-tap; and step 9's last link — a foreground-permission denial concurrent with a live background task
— is device behaviour neither this review nor the automated cover can settle. It is also **strictly better
than pre-F2**, where the branch left a stale `true` that the held-branch guard could fire on. And it
self-heals on the next cold launch, through F3's own new `stop_stream`. Monotone improvement, not a
regression.

**Fix (recommended, line-neutral)** — make the flag true by construction instead of by argument:

```ts
effects: serverOnline
  ? [{ type: 'put_status', status: 'offline' } as const, ...TEAR_DOWN]
  : [{ type: 'stop_stream' } as const],
```

Free on two counts already verified: `permissions.ts:38-42` guards `stopStreaming()` on
`hasStartedLocationUpdatesAsync`, so it no-ops when nothing runs, and `use-presence.tsx:153-155` swallows
the rejection. It **replaces** the `: []` line, so it costs no lines — which matters at 4 of headroom (R6).
Three assertions go red and must gain `'stop_stream'` (`presence-state.test.ts:58`, `:293`, `:431`); three
reds are the evidence it is wired.

### R1 — Low · `presence-state.ts:242` · an inline guarantee false on one of the two paths it annotates

```ts
streaming: false, // the teardown below really stops it (review F2)
```

`TEAR_DOWN` is emitted **only** when `serverOnline` (`:248-253`). On the `!serverOnline` path the effect
list is `[persist_intent]` alone (`:247`, pinned by `presence-state.test.ts:431`) — there is no teardown
below. Same class the round has been chasing: a comment stating as fact something true on one branch.

**Fix**: take R2 (which makes it true on both), or narrow it to name the `serverOnline` path.

### R3 — Low · `presence-state.ts:365-366` · "any new emitter inherits that" is a guarantee about code that does not exist

The **literal claim holds** — the agent checked all three `put_status offline` emitters exhaustively and I
concur: `permission/foreground_denied` clears the flag in the same decision (`:242`), `error/effect_failed`
does too (`:419`), and `drained` inherits a `streaming` that was re-synchronised on the only route into
`intent: 'online'` (`toggle_pressed` → `request_permissions` → `permission`, which either starts the task
or clears the flag).

What does not hold is the second clause. "Any new emitter inherits that" is enforced by nothing — no type,
no test, no lint rule. Nothing goes red if a fourth emitter lands without clearing the flag.

**Fix**: make it an instruction, not a guarantee — *"a new emitter of `put_status offline` must clear
`streaming` or prove a live stream; nothing enforces this."* If R2 lands, delete the paragraph instead.

### R4 — Low · `presence-state.ts:165, 170-172` · `cold_launch`'s `base` inherits `streaming` rather than asserting it

The F3 branch returns `{ state: base, effects: [{ type: 'stop_stream' }] }` and relies on `state.streaming`
already being `false`. It is — `cold_launch` always runs from `initialPresence` (`use-presence.tsx:257-279`;
`onBeforeSignOut` resets at `:324`) — but **by circumstance, not construction**. So
`presence-state.test.ts:215`'s `expect(live.state.streaming).toBe(false)` passes for an incidental reason:
it asserts that `initialPresence.streaming` propagated, not that the branch cleared anything.

**Fix**, one token: `{ state: { ...base, streaming: false }, effects: [...] }`. Then the assertion pins the
branch.

### R5 — Low · test precision in two of the five new cases

- `presence-state.test.ts:371-374` hand-builds `{ ...armed.state, busy: false }`. The plan's own style rule
  (`driver-toggle-off-mid-ride-held.md:567-568`) is *"drive `decide` through real event sequences, not
  hand-built states, wherever a sequence exists"* — and one exists (`server_online` clears `busy`, as
  `:98-101` already does). The case does pin F4; this is about documenting a reachable route.
- `home-screen.test.tsx:113-115` asserts "no dismiss affordance" via
  `queryByRole('button', { name: t('driver.action.skip') })`, which rules out the `secondary` slot only. An
  `action` would render a button under a different label and slip through.
  `within(screen.getByTestId('banner')).queryAllByRole('button')` → `toHaveLength(0)` is exact.

### R6 — Low (informational) · `presence-state.ts` is at 496 of 500

`observed`. No `eslint-disable` of `max-lines` anywhere in the delta — the agent grepped and read the file
end to end. The cap is respected and the report flags the consequence as deviation 1. Recorded here so it
is not lost between rounds: R2 is line-neutral, R1/R3/R4 are comment/token edits, so **none of the
recommended fixes forces the split**.

## The seven adversarial checks

| # | Check | Result |
|---|---|---|
| 1 | F2's asymmetry — is `intent: offline` + `streaming: true` + `server ≠ online` + a live task reachable? | **Reachable — R2, reproduced** |
| 2 | F1's blast radius — can `server_offline` clear the banner mid-ride? | **PASS** |
| 3 | F3's new effect — truthful `base`, safe handler, no downstream assumption | **PASS**, R4 residual |
| 4 | F4's disarm — cannot spend or mask a legitimate re-assert | **PASS** |
| 5 | The rewritten held-branch comment, exhaustively | **PASS on the literal claim**; R3 on the second clause |
| 6 | File length ≤ 500 | **PASS — 496**, 4 of headroom |
| 7 | Test quality — do the cases pin their fixes; any `not.toContain`; is the UI case meaningful | **PASS on substance**, R5 on precision |

**Check 2 in full**, because it is the one that could have gone wrong quietly: the banner cannot be cleared
mid-ride, and the verifiable half is api-side. While `profile.status === 'on_ride'`, an `offline` put throws
409 (`drivers.service.ts:115`) and an `online` put returns the `on_ride` profile (`:126`) — the row is never
written to `offline`. `serverStatusEvent` maps `on_ride` → `server_online`, so neither the put's answer path
nor the foreground refetch can produce a `server_offline` during the ride. And the held branch sets
`intent: 'online'`, so even a hypothetical one would take the `intent === 'online'` path, not the
banner-clearing one. `intent !== 'online'` is the right gate — the narrowing is already
`state.banner?.kind === 'driver_on_ride'`, and `presence-state.test.ts:360-364` pins that guidance in the
same slot is not collateral damage.

## Validation

`observed` in `../taxi-141` at `3fe9075`, `COMPOSE_PROJECT_NAME=taxi`.

| Check | Command | Result |
|---|---|---|
| Full gate (CI parity) | `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` | **exit 0**, 20/20 tasks, 1m4.329s |
| Driver suite | inside the gate | **109 passed, 27 suites** |
| api suite | inside the gate | 626 passed, 35 skipped, 70 of 72 (Redis-gated) |
| R2's nine-step trace | throwaway spec at head, deleted | **reproduces**, `git status` clean after |

**Guarantees pass — not triggered, and that is observable.** `baseRefOid` is
`660b833d1e12be751f3924d6344b82b9095d882c`, byte-identical to the base recorded in round 1's header. The
base did not move, so no rebase swept a guarantee. Round 1 left no rebase notes to discharge.

### The numbers pass

Every figure in the PR body and the implementation report re-derived at head.

| Claim | Verdict |
|---|---|
| Gate exit 0, 20/20 tasks | reproduced |
| Driver 109 passed / 27 suites; api 626 / 35 skipped / 70 of 72 | reproduced exactly |
| `presence-state.ts` 480 → 485 → **496**; `use-presence.tsx` 362 → 371 → 371; the two new modules at 26 | `wc -l` at all three revisions — all correct |
| "4 lines of headroom (`derived`: 500 − 496)" | correct, and the subject checks out: `apps/driver/eslint.config.mjs:17` sets `max-lines` with `skipBlankLines: false, skipComments: false`, so `wc -l` is the unit the cap reads |
| Driver test count 98 → 98 → 104 → **109** | 109 `observed`. The `98` is correctly labelled `derived`; structural cross-check holds — `it(` across `apps/driver/src` goes 96 → 96 → 102 → **107**, the last delta +5, exactly the five claimed new cases |
| "Test suites went 25 → 27" | unlabelled but sound — `git ls-tree` counts 25 driver spec files at `660b833`, 27 from the split onwards |
| `services/api` comment-only → 0 non-comment changed lines | re-run at head after F5, still **0** |
| F3's "≤13 s" window | `derived` and correct: `DRAIN_GRACE_MS = 5_000` (`use-presence.tsx:48`) + `timeoutMs ?? 8_000` (`api-client.ts:62`), both re-read at head |
| Diff decomposition, 16 files / 1698 / 149→151 | **FAILS — see R7.** True: 16 / **1753** / 151 |

**One provenance note, not a finding.** The plan's manual step 5 says 90 s is "chosen to clear the 60 s
`findNearby` freshness window". The claim is **correct** — `DRIVER_LOCATION_TTL_SECONDS = 60`
(`driver-location.policy.ts:15`), whose own docblock says `findNearby` drops anything older. But round 1
confirmed it against `RECONNECTING_WINDOW_MS = 60_000` (`presence-pill.ts:9`), which is the driver app's
*pill* threshold, not the api's dispatch gate. Two unrelated 60s; the digit survived a check of the wrong
mechanism. Nothing to fix here — noted so the next round does not re-confirm against the pill.

### What this round could NOT verify

Stated rather than left to inheritance, per `CLAUDE.md`'s own rule:

- **The four-row mutation table in the report was not independently reproduced.** Round 1's reviewer
  re-ran its two mutations and matched the failure text. This round's four were run by the session that
  wrote the fixes, and the review agent had no shell. The claim "each mutation kills exactly one case"
  therefore rests on the author's own run. It is cheap to re-run if you want it independent.
- The device proof, as always — see below.

## Round 1's dangling conditional, discharged

Round 1 ended: *"the generalised predicate does not over-stop… Sound — **conditional on F2**."* The
condition was the `permission/foreground_denied + serverOnline` route, where a stale `streaming: true` could
land the held branch and stop a chain that should have torn down. F2's fix clears the flag before the put on
exactly that route, so the predicate's soundness is now unconditional on the two offline-put sites, and the
plan's blast-radius row reads **enforced**, not assumed. R2 does not reopen this: it is about the *other*
path of the same branch, where no put is emitted at all.

**F5 and F6 pass.** `drivers.service.ts:109-114` now carries its condition explicitly and names the
no-stream fold as deliberate; comment-only, and the 0-non-comment-lines check re-run confirms it.
`driver-app-auth-online-location.md:837` leads with **SUPERSEDED**, and "expected to FAIL" survives only
inside an explicit *"Historical, for the record only"* frame — the framing round 1 accepted for the report
file. AC7's unmet half is met; a tree-wide sweep for `tear/tore/torn the stream down` leaves only the
past-tense api comments round 1 cleared and the plan/report titles.

**F7** correctly deferred to #14's owed TalkBack pass (plan §C.12); `Banner.tsx:36-40` still carries its own
`expected, NOT observed` label, so the deferral absorbs no claim.

## What's good

- **Every fix is in the narrowest place it could be**, and none introduces a mechanism. F1 mirrors how
  `server_online` drops `marked_offline` instead of inventing a banner lifecycle; F4 is one property argued
  as symmetry; F5 is one clause.
- **F3 was fixed rather than split off**, in the smaller of the two shapes round 1 offered — and it turns out
  to be what bounds R2's residual, since the app self-heals on the next cold launch. That was not the stated
  reason for taking it, but it is the payoff.
- **The report does not overclaim the home-screen case.** It says outright that it is a *premise* test, goes
  red under none of the four mutations, and "is not claimed to". Volunteering that a new test proves nothing
  regression-wise is the discipline this repo has been pushing for.
- **F2's claim was corrected on all three surfaces, not just at the fix** — comment, plan row, PR body.
  Round 1 named "grep the subject, not the sentence form" as the failure mode; this round did it. R7 is the
  irony: the session that executed that rule correctly for F2 then shipped a stale figure two sections away.
- **The line-count table re-observes rather than inherits**, states the derived headroom with its arithmetic,
  marks `use-presence.tsx`'s post-split count as `derived, not observed`, and flags the consequence as a
  deviation rather than burying it.

## Recommendation

**Comment, not block.** No Critical, no High. R7 is a one-line PR-body correction and should be made before
merge — it is a false figure under a truth claim, and it contradicts GitHub's own header. R2 is a judgment
call on a nine-step trace, not a merge blocker; the recommended fix is line-neutral and turns an argument
into a construction, which is worth doing while the context is loaded.

Suggested order if taken: **R7** (body only), then **R2 + R1 + R3 together** — the `stop_stream` line makes
both comments true and lets the reachability paragraph shrink, buying back headroom — then **R4**, then
**R5**. R6 needs no action.

**The device proof stays owed**, per the PR's own framing: run-sheet steps 4, 5, 7 and 8
(`driver-toggle-off-mid-ride-held.md:737-746`). Step 8 is the one F1 makes passable. Merging #142 as it
stands retires #141, whose own acceptance says not to close it on the automated cover alone — decide that
deliberately rather than by merge.
