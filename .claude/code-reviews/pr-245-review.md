# PR #245 review — round 1

**Head** `b430dca` · **Base** `main` @ `246ae4b0` · **Reviewed** 2026-09-21 · `feature/short-tracking-links-sms-136`

Base has not moved: `git rev-parse origin/main` = `246ae4b0`, the same sha the PR records. Guarantees pass
not applicable; no prior round, so no fix-mechanism pass.

## Verdict

**Request changes** — one High, and it is why the PR cannot merge today rather than a judgement about the
code. `mergeStateStatus: BLOCKED`, `codeql` red, `ready` red.

**No correctness defect in the shipped behaviour.** The one-segment property holds, and I re-derived every
number behind it independently. What needs fixing is one blocking check, one guard that can stay green
while the thing it guards breaks, and three claims about the token and the budget that are not true.

| | Severity | Where |
|---|---|---|
| F1 | High | `packages/shared/src/tracking-link.ts:88` — `codeql` red, merge blocked |
| F2 | Medium | `packages/shared/tests/sms-budget.test.ts:32-33` — the proof's fourth bound is a literal; it stays green while the bill doubles |
| F3 | Medium | `…/schemas/tracking.ts:12-14`, `…/tracking/tracking.service.ts:51-52` — credits a control the same diff contradicts |
| F4 | Medium | `…/tracking/tracking.controller.ts:9` — "128 random bits" survived the change to 96 |
| F5 | Medium | `…/ride-notifications.service.ts:178-183` + `.spec.ts:373` — unconditional guarantee, sampled test |
| F6–F10 | Low | below |

Findings marked **`reproduced`** were run, not reasoned about. One agent finding is **refuted** and is
recorded as such at F7 so it is not re-raised next round.

## Validation

`observed` — `COMPOSE_PROJECT_NAME=taxi pnpm turbo run typecheck lint test build --force` in the worktree
at `b430dca`, `dist` and `.next` cleared first, **exit 0**:

```
Tasks:    22 successful, 22 total
Cached:   0 cached, 22 total
Time:     1m36.328s
```

| Package | This review's run | PR body claims | |
|---|---|---|---|
| `@taxi/api` | `2 skipped, 79 passed, 79 of 81` · `39 skipped, 746 passed, 785 total` | identical | ✅ |
| `@taxi/shared` | 251 passed | 251 passed | ✅ |
| `@taxi/dispatch` | 268 passed | 268 passed | ✅ |
| `@taxi/driver` | 44 suites, 250 passed | 44 suites, 250 passed | ✅ |
| `@taxi/rider` | 30 suites, 145 passed | 30 suites, 145 passed | ✅ |
| `@taxi/db` | 17 passed | 17 passed | ✅ |
| Gate wall time | 1m36.328s | 1m36.095s | ✅ |

The three per-file claims also reproduced exactly: shared `19 passed (19)`, dispatch `4 passed (4)`, api
`6 passed, 6 total` — 19 + 4 + 6 = 29.

The 12 `@taxi/api` lint warnings are pre-existing `no-unsafe-argument` on `App` in six `.integration.spec.ts`
files; none is in this diff, and the package does not run `--max-warnings 0`.

CI at this head: `check` **pass**, `audit-diff` **pass**, `codeql` **fail**, `CodeQL` **fail**, `ready` **fail**.

## Findings

### F1 — High · `codeql` is red and blocks the merge · `packages/shared/src/tracking-link.ts:88`

Code-scanning alert **#1** on `refs/pull/245/merge`: `js/polynomial-redos`, security severity **high**.
`.replace(/\/+$/, '')` backtracks quadratically on trailing slashes.

`reproduced` (node 20, `'https://a' + '/'.repeat(n) + 'x'` through the current function):

| slashes | time |
|---|---|
| 10,000 | 180 ms |
| 40,000 | 2.78 s |
| 80,000 | 7.88 s |

**Not exploitable in this tree, and say so plainly.** Both call sites pass `env.PUBLIC_TRACKING_BASE_URL`
— operator-set, `z.string().url()`-validated, never rider input. CodeQL flags it because D2 made
`trackingLinkHost` a *public export* of `@taxi/shared`, which turns its parameter into a library-input
taint source. The cost is procedural, not a vulnerability: `codeql-gate.sh` fails on any open alert at
`security_severity ∈ {high, critical}` the base does not carry, `ready.needs` it, and the draft will not flip.

**Fix — must be output-identical**, because the production boot gate measures with this exact function and
the host term feeds the 70-character derivation:

```ts
export function trackingLinkHost(baseUrl: string): string {
  const stripped = baseUrl.replace(/^https?:\/\//, '');
  let end = stripped.length;
  while (end > 0 && stripped.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return stripped.slice(0, end);
}
```

**This closes on CI, not on a local gate.** Line 88 carries both regexes, so which construct CodeQL
objects to is inferred from its message (*"many repetitions of '/'"*) rather than observed, and the gate
compares open alerts against the base — a replacement that trips a different ReDoS rule leaves it red.
The acceptance is the `codeql` job going green. The alternative is a human dismissal in the GitHub UI with
a reason (`codeql-gate.sh` honours it; the hook refuses it from a Claude session) — Linards' call, but the
fix above is three lines.

### F2 — Medium · the budget proof's fourth bound is the one constant not imported · `packages/shared/tests/sms-budget.test.ts:32-33`

```ts
/** `src/schemas/vehicle.ts:7` — `plate: z.string().min(2).max(10)`. */
const PLATE_MAX_CHARS = 10;
```

Three of the four bounds are imported (`:6-10`). The plate is a literal with a line reference, and the
file's own thesis (`:23-29`) is that changing a constant must redden it.

`reproduced` — widened `vehicleSchema.plate` to `.max(12)` in the worktree and ran the whole shared package:

```
Test Files  27 passed (27)
     Tests  251 passed (251)
```

Green, including the budget proof — while the binding RU row rendered at the new bound goes **70 → 72
characters, 1 → 2 billed segments**. `.max(12)` is not a contrived mutation: LV plates are 7 and the first
foreign plate registered is the obvious occasion. The only thing that would notice is the
`sms_multi_segment` warn, in production, after the bill. (Worktree restored; `git status` clean.)

**Fix** — derive the fourth bound like the other three:

```ts
import { vehicleSchema } from '../src/schemas/vehicle';

const PLATE_MAX_CHARS = vehicleSchema.shape.plate.maxLength;
// zod 3 returns `number | null`; assert it so REMOVING `.max()` reddens here
// rather than silently rendering NaN characters of plate.
expect(PLATE_MAX_CHARS).not.toBeNull();
```

### F3 — Medium · the contract seam credits a control this PR's own diff says does not exist · `packages/shared/src/schemas/tracking.ts:12-14` and `services/api/src/features/notifications/tracking/tracking.service.ts:51-52`

Two new docblocks justifying 22 → 16 chars:

> "…96 bits of entropy, and `TRACKING_VIEW_MAX_PER_WINDOW` rate-limits guessing on top."
> "Guessing is rate-limited by `TRACKING_VIEW_MAX_PER_WINDOW`, not by the entropy alone."

It does not rate-limit guessing. `notifications.policy.ts:90-92`, **edited in this same diff**, says so:

> An attacker can mint unlimited shape-valid 16-char tokens, each costing one `rideByToken`. This bounds
> polling of a **KNOWN** token, which is the spend path.

The chain: `trackingViewRateKey = (token) => \`tracking:rate:${token}\`` (`notifications.policy.ts:113`)
is keyed per token; `tracking.service.ts:224-248` INCRs that key and nothing else;
`tracking.controller.ts:12-21` is `@Public()` with no guard, and `app.module.ts:54-55` registers only
`JwtAuthGuard` and `RolesGuard` — no `ThrottlerGuard`. So every guess at an *unknown* token gets its own
fresh window. Enumeration is unbounded and the entropy is the sole defence.

**Security impact today is nil** — 96 bits is ~7.9 × 10²⁸ and every shape-valid string is reachable, so
the regex wastes no entropy. It matters because this PR *reduced* the entropy partly on this reasoning,
and `tracking.service.ts:51-52` is the sentence that would license 8 bytes next time. This is the #87
pattern: work de-scoped on a claim the code contradicts.

**Fix** — replace both with the true statement, citing the file that already holds it: 96 bits is the
whole defence against guessing; `TRACKING_VIEW_MAX_PER_WINDOW` is keyed per token and bounds polling of a
known one. The research doc's wording ("rate-limiting **views**") is accurate and can stay.

### F4 — Medium · "128 random bits" survived the change that retired it · `services/api/src/features/notifications/tracking/tracking.controller.ts:9`

> the token in the path IS the whole authorization, which is why it is **128 random bits**

`mintTrackingToken()` is now `randomBytes(12)` — 96 bits. **The file is not in the PR's changed list, and
that is the point**: the PR retired the subject and left the claim standing on the slice's own
authorization docblock. Exactly the "grep the noun, not the sentence form" case in CLAUDE.md.

`reproduced` — grepped the noun tree-wide. This is the only live one: `env.schema.ts:46`'s "128 bits" is
about `openssl rand -hex 32` and is correct, the architecture doc is clean, and the `22`s in the research
doc are deliberately historical.

**Fix** — `96 random bits`. One word.

### F5 — Medium · "the assertion cannot fire" holds only in production, and the test named for it asserts at a sample · `services/api/src/features/notifications/ride-notifications.service.ts:178-183`, `…/ride-notifications.service.spec.ts:373`

The PR body: *"with every term bounded it cannot fire."* The docblock: *"no input can push a linked
template past one segment."* Both unconditional. The host bound is enforced **only** under
`NODE_ENV === 'production'`; dev and CI default to `http://localhost:3000`, a 14-character host — 4 over
the ceiling the proof assumes.

`reproduced`, rendered through the built `dist` at that host with every other term at its bound:

| | chars | segments |
|---|---|---|
| LV `driver_assigned` | 73 | **2** |
| RU `driver_assigned` | 74 | **2** |
| EN `driver_assigned` | 72 | 1 (GSM-7, 160-septet limit) |

No pathology needed: at `localhost:3000` the RU row tips once `name + plate + eta` exceeds 18 characters —
*Aleksandrs* (10) with plate `LV-12345` (8) is already over.

The spec case `'a budgeted body emits no multi-segment warn (expected — the assertion holds)'` passes only
because its fixture is a sample: `Jānis` (5), `AB-1234` (7), ETA 1, rendering **65 characters**
(`reproduced`). It is named for the bound and tested nine characters inside it — the distinction
`sms-budget.test.ts`'s own docblock spends a paragraph arguing for. The gap is *recorded* elsewhere
(`env.schema.spec.ts:106-107` names the 14-character host outright), so this is a claim that drifted from
what the author knew, not a blind spot.

**Fix** — add one `it()` with the env overridden to `https://xxxxxxxxxx` and the other terms at their
bounds, rather than moving the file's `BASE_URL`/`SMS_HOST`: moving the default would make every other
case stop representing the dev origin `env.schema.spec.ts:106` deliberately documents. Rename the existing
case to "a normal body…". Then qualify the two claims — the docblock's second sentence already says *"this
firing **in production** means…"*, so it is the first sentence and the PR body that need the condition.

### F6 — Low · the hard cut-over breaks reads of pre-existing rows, not only links · `packages/shared/src/schemas/tracking.ts:19-22`

The safety argument is "no deploy has ever run, so no 22-char link exists". True for production links, and
I re-verified its premise. But `schemas/ride.ts:269` wires `trackingTokenSchema` into `rideSchema`, and
`services/api/src/features/rides/rides.repository.ts:101` runs **every row** through `rideSchema.parse`.

`reproduced` against `rideSchema.shape.trackingToken`:

| row value | result |
|---|---|
| 22-char (pre-#136) | **REJECTED** — `expected 16-char base64url tracking token` |
| 16-char (post-#136) | OK |
| `null` (legacy) | OK |

So a ride row minted locally before this change throws on **read**, not just on the link. Anyone with a
persistent local DB is affected, and `services/api/scripts/mint-tracked-ride.ts` (which #141's device-day
work uses) creates exactly such rows. **Fix** — one line in that same comment naming the remedy:
`UPDATE rides SET tracking_token = NULL`, or re-seed.

### F7 — Low · the `lv` rewrite assertion is self-referential — but the consequence first claimed for it is **refuted** · `apps/dispatch/src/app/t/tracking-rewrites.test.ts:52-64`

The second case's stated job is "what makes the absence of a rewrite correct rather than an omission", and
its assertion is `existsSync(join(__dirname, '[token]', 'page.tsx'))`. `__dirname` is already
`apps/dispatch/src/app/t`, so `t` is hardcoded on both sides and the check cannot fail. That much is real.

**The claim that this leaves `lv` unguarded is false, and I am recording the refutation so it is not
re-raised.** `reproduced` — changed `TRACKING_PATH_BY_LANGUAGE.lv` from `'t'` to `'q'`:

- `tracking-rewrites.test.ts` — `4 passed`, green as predicted.
- `packages/shared/tests/tracking-link.test.ts` — **2 failed**: `expected 'sakta.lv/q/…' to be
  'sakta.lv/t/…'` at both `:9-11` and `:21-23`.

The gate goes red. The guard exists, it just lives in `packages/shared` rather than the app. **Fix** is
therefore cosmetic, not structural: `join(__dirname, '..', TRACKING_PATH_BY_LANGUAGE.lv, '[token]', 'page.tsx')`
so the assertion means what its comment says.

### F8 — Low · `trackingLinkHost` strips only a lowercase scheme, and one malformed form passes the gate · `packages/shared/src/tracking-link.ts:87-89`

`/^https?:\/\//` is case-sensitive, and nothing strips userinfo, query or fragment — all accepted by
`z.string().url()`. `reproduced`:

| `PUBLIC_TRACKING_BASE_URL` | stripped | len | production gate |
|---|---|---|---|
| `HTTPS://SAKTA.LV` | `HTTPS://SAKTA.LV` | 16 | refused |
| `https://u:p@sakta.lv` | `u:p@sakta.lv` | 12 | refused |
| `https://sakta.lv/app` | `sakta.lv/app` | 12 | refused |
| `https://sakta.lv#f` | `sakta.lv#f` | 10 | **accepted** |

Most malformed forms are caught, but by *length* rather than validation — and the fragment form is exactly
10, so it passes and then texts riders `sakta.lv#f/r/<token>`, where the fragment swallows the path. It
takes a malformed operator config, hence Low. An `i` flag plus rejecting `@#?` in the stripped host closes it.

### F9 — Low · the budget proof has no shipped negative · `packages/shared/tests/sms-budget.test.ts`

Every assertion in the file is positive. Its central claim — that widening a constant reddens it on an
exact length — is verified only by a manual bite recorded in the plan. A shipped negative (an
over-ceiling host asserted at 71 chars / 2 segments) makes the guard self-verifying, and pairs naturally
with F2 while that file is open.

### F10 — Low · a bill figure with no provenance of its own · `.claude/reports/short-tracking-links-sms-136-report.md:134`

*"the saving halves to 129 segments/mo."* The arithmetic is sound — 258 → 129: two linked messages ×
1 segment saved × 129 phone rides/mo from research §4.3's model — but none of it is shown, 258 never
appears, the `derived` label earlier in that sentence attaches to the character counts rather than this,
and it inherits the phone-booked share the PR body itself calls evidence-free two paragraphs earlier. It
also happens to equal the ride count it derives from, which is what a transcription error looks like.

### Minor, batch or defer

- `tracking-rewrites.test.ts:88-90` re-asserts what `tracking-link.test.ts:44-46` owns (every path value is
  one character). The dispatch-side assertion at `:86` is the part that belongs there; drop the trailing three.
- `sms-segments.ts:16-20` documents the unmodelled UCS-2 surrogate-pair boundary but not its GSM-7 mirror
  (TS 23.038 forbids splitting `ESC`+char, so a concatenated segment holds 152, not 153). Unreachable in
  this tree — see below — but `~` is in all three `driver_assigned` templates, so it is the likelier of the
  two to bite if the bounds move. One sentence.
- `apps/dispatch/src/app/t/[token]/page.tsx:35-42` returns no `robots: { index: false }`, on a no-login
  page showing driver first name, plate and live position. Pre-existing, but this PR takes the public URL
  surface from one shape to three. Its own ticket.

### Not a finding — the human's to rule on

**AC #0 is open (D1).** The handset spike — does a bare `sakta.lv/r/…` linkify in a real SMS client? — did
not run, and change 3 shipped under that stated assumption. Documented, so not a defect, but it is an
unmet acceptance criterion on the PR's own list and the one that changes what ships. The fallback is costed
in the report and the revert is one line. **Linards owns this before merge.** D2–D9 read as reasonable.

## Checks that came back clean

Run, not reasoned about:

- **Every "observed" figure in the PR body reproduced**, including the gate table and both "proved to
  bite" claims. At host 11, independently re-rendered: LV 70/1 seg, RU 71/**2 seg**, EN 69/1, and the
  three `booking_confirmed_phone` rows 60/56/51 — 5 of 6 still one segment, only RU tips, exactly as
  claimed. All 7 `sms-budget.test.ts` assertions would fail on length first.
- **The budget arithmetic**, re-derived from the catalog strings rather than copied: fixed text LV 18 /
  RU 19 / EN 17; `19+10+10+2+29 = 70` with zero spare at the ceiling; `70 − 60 = 10`; `12 ÷ 3 × 4 = 16`
  with no padding, so the `{16}` regex can never reject a minted token. The report's four `dist`-rendered
  bodies (64/63/53/57) all check out.
- **The `{22}` → `{16}` cut-over premise**, re-verified this session (`observed` 2026-09-21):
  `gh run list --workflow=deploy.yml` empty, `gh issue view 13` `OPEN`. No 22-char token survives in
  shipped source; the four remaining `{22}` hits are all in `.claude/plans/`. (The premise holds for
  links; F6 is the part it does not cover.)
- **`tracking.integration.spec.ts` really ran** the `{16}` assertion (`:282`) against Postgres inside the
  gate: `grep -cE 'REDIS_TEST_URL|describe\.skip'` = 0, and it is not among the 2 skipped suites.
- **No route collision, and the rewrite cannot be overridden.** No `/r` or `/e` route exists to shadow,
  no `basePath`, no `middleware.ts`. Next 16.3.4 spreads the destination query **last**
  (`prepare-destination.js:278-285`), so a hand-typed `/r/<token>?lang=en` still resolves to `lang=ru`.
  Every URL the page emits is root-relative (`tracking-map.tsx:99`, `page.tsx:116,167`), so nothing
  breaks under a `/r/` browser URL.
- **Neither edited test file quietly retired a guarantee**, which `+1/−3` and `+14/−5` both invite.
  `i18n.test.ts` is the same assertion reflowed with the new copy. `tracking.test.ts` adds a 22-char
  rejection case and — the careful part — re-cuts the classic-base64 fixture from 22 chars to 16 so that
  case still fails for the alphabet reason rather than silently starting to fail on length.
- **The GSM-7 ESC-split is unreachable** — no body in the tree reaches GSM-7 multi-segment; EN
  `driver_assigned` peaks at 73 septets against 160. A non-BMP driver name stays inside the bound:
  `smsDriverName` measures `.length` and the budget counts `.length`.
- **Token entropy** is fine at 96 bits regardless of what the rate limit bounds. What the *docblocks* say
  about it is F3 and F4.
- **Every changed source file is inside `max-lines`** — largest `env.schema.ts` at 407. No
  `eslint-disable` anywhere in the diff.
- **`PUBLIC_TRACKING_BASE_URL` has exactly two code readers** — the boot gate and the link builder. No
  script, app or seam assumes a short host.

## What is good

- **The budget is a derivation, not a number.** `tracking-link.ts`'s header states the equation, names
  which bound enforces each term and where, and `sms-budget.test.ts` is that equation executable. Pinning
  the exact rendered length rather than only the segment count is the right call, and the reasoning for it
  is correct — widening the ceiling reddens 7 assertions instead of silently passing. F2 is that idea
  applied to the one bound it missed, not a disagreement with it.
- **`smsSegments` is right where it is hard to be right.** The basic table is the real GSM-7 set with ESC
  excluded (31+32+32+32 = 127), the extension table has all ten members, and the tests probe the two traps
  a naive ASCII check fails: `ä` is one septet and the ASCII backtick is not in the table. Asserting each
  cost as a *pair* (158+`€` = 1 segment, 159+`€` = 2) means a wrong cost cannot pass.
- **Moving `trackingLink` into `@taxi/shared` is the real structural win**, and the stated reason is the
  true one: an app cannot import `services/api`, so the two halves of the round trip previously agreed
  only by inspection. `shared` still imports nothing from the workspace.
- **The boot gate measures what the SMS carries.** Reusing `trackingLinkHost` rather than a second regex
  is exactly the off-by-one this kind of gate usually ships with, avoided deliberately, and the error
  message names the value, the limit, the cost and the remedy.
- **The docs corrections are honest in the hard direction.** The research doc keeps its wrong pre-#136 RU
  count visible and names the `?lang=ru` omission that caused it. The runbook now says outright that this
  constrains #13's domain purchase.
- **`smsDriverName` abbreviates rather than truncates**, with the surrogate-pair case handled whole.
- Logging is clean throughout — `domain.component.action_state` names, tokens truncated, no body, no
  phone, no coordinates.

## Recommendation

**Request changes.** F1 is the blocker. F2 and F5 are the two worth not merging without beyond it — both
are guards that pass while what they guard is broken. F3 and F4 are edits to false claims, one of which is
this PR's own rationale for cutting entropy. F6–F10 batch.

Then re-run the gate and `piv-fix-review-findings`. The behaviour this PR ships is sound; the human
decision that remains is AC #0, not the code.
