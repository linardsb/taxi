# System Evolution Review — Rider comms: SMS ride statuses + no-login tracking page (#63)

## Meta Information

- Plan reviewed: `.claude/plans/rider-comms-sms-tracking-page.md`
- Execution report: `.claude/reports/rider-comms-sms-tracking-page-report.md`
- Additional inputs: `.claude/code-reviews/pr-83-review.md` (PR review found 1 undocumented deviation + 2 Mediums, both *planned-but-not-landed* items), the post-review fix loop (commit `27661ae`)
- Shipped: PR #83, merged `15b07d1` (2026-08-11)
- Date: 2026-08-11

## Overall Alignment Score: 8/10

One-pass COMPLETE on a High-complexity, three-workspace slice; the plan's 9.5/10 confidence essentially delivered. All 7 documented deviations were justified. Two deductions: one real deviation went **undocumented** (found only by the PR review), and two planned items (a hard-rule string sourcing, a named edge case) **silently didn't land** because nothing executable enforced them client-side.

## Divergence Analysis

```yaml
divergence: E.164 spec range +371280 instead of the plan's +371270
planned: claim +371270… per the registry comment in ride-lifecycle.integration.spec.ts
actual: +371280 (payments.integration.spec.ts already held +371270); registry comment fixed
reason: registry comment had drifted — did not list payments' claim
classification: good ✅
justified: yes
root_cause: plan trusted a registry COMMENT for a uniqueness claim instead of verifying by grep
```

```yaml
divergence: no seeded driver photo
planned: "one seeded driver gets a photo_url"
actual: column ships; integration spec sets photo on its own driver
reason: seed/riga.ts seeds no drivers at all — nothing to attach to
classification: good ✅
justified: yes
root_cause: plan assumption not verified against seed contents (plan cited the file for UUID style only)
```

```yaml
divergence: four extra catalog keys (page.assigned/arriving/arrived/in_progress)
planned: a prose-enumerated key list missing four page states
actual: full Record<TrackingPageState, MessageKey> pin — compiler forces copy per state
reason: hard rule (no hardcoded strings) + statusLine must render every state
classification: good ✅
justified: yes
root_cause: plan held two lists that must be 1:1 (TRACKING_PAGE_STATES, i18n keys) with no cross-check;
  the implementation's compile-time pin is the fix the plan should have specified
```

```yaml
divergence: lang attribute on <main>, not <html>
planned: "<html lang> per ?lang"
actual: lang on the page wrapper
reason: root layout owns <html>; a segment cannot re-render it; SRs honor lang on any element
classification: good ✅
justified: yes
root_cause: plan spec written without the segment/root-layout constraint in view (first-ever page, no in-repo pattern)
```

```yaml
divergence: maskPhone exported from the auth barrel
planned: only smsProviderFactory export
actual: both exported
reason: notifications logs need it; deep import would break the slice-boundary rule
classification: good ✅
justified: yes
root_cause: minor plan omission — masked-phone logging WAS specified, its import path wasn't
```

```yaml
divergence: slice-local haversine in notifications.policy.ts
planned: (implicit) reuse features/geo's
actual: own 10-line haversine with a docblock on why
reason: geo's is a stub internal documented to die with StubMapsProvider
classification: good ✅
justified: yes
root_cause: none — this is exactly the judgment call plans should leave to implementers
```

```yaml
divergence: "~? min" ETA fallback when no recorded position at accept-time SMS
planned: unspecified
actual: sends '?' rather than fabricating; unit spec pins it
classification: good ✅
justified: yes
root_cause: genuine plan gap, handled well (pinned by test, honest to the rider)
```

```yaml
divergence: positionOf contract case FLIPPED — markOffline drops the position
planned: "offline-but-recorded driver still readable (edge — tracking outlives presence)"
actual: positionOf → null after markOffline, "stale-but-recorded" case substituted
reason: consistent with markOffline's pre-existing three-key drop; mid-ride socket loss never
  calls markOffline (setOfflineIfOnline guards on status === 'online') — so tracking DOES survive it
classification: good content ✅ / bad process ❌ — it was UNDOCUMENTED; the PR review found it
justified: behavior yes; the silence no
root_cause: piv-implement's Deviations section is recall-based — nothing makes the implementer
  diff the plan's NAMED test cases against what shipped before writing "deviations: …"
```

### Review findings as divergence signal (planned-but-not-landed)

```yaml
divergence: M1 — planned edge case "stale GPS (page shows last-updated time)" did not land
planned: TESTING STRATEGY edge list names it; positionOf's no-freshness-filter contract was BUILT for it
actual: page stamped the poll clock; view.position.at was never read; fixed post-review (27661ae)
classification: bad ❌ (caught by the PR review layer, so the system held — but late)
root_cause: apps/dispatch has NO test runner; Phase 4's VALIDATE is typecheck/lint/build only, and the
  manual E2E can't stage a silent GPS. A plan edge case with no named verification step silently evaporates.
```

```yaml
divergence: M2 — retry control shipped as a hardcoded "↻" with no accessible name
planned: UX section lists the "API-down generic retry" state; hard rule: all strings from the catalog
actual: the one string not in the plan's key list was the one that shipped hardcoded; fixed post-review
root_cause: same two causes compounding — key list not derived from the UX states/affordances list,
  and no client-side check (lint or test) that can see a hardcoded string
```

## Pattern Compliance

- [x] Followed codebase architecture — VSA slice, one-way deps, seams, module-order comment; review: "all four hard-rule hot spots check out"
- [x] Used documented patterns — post-commit never-throws (structural), DEFAULT-then-DROP migration, wire-schema re-parse, config-not-constant
- [x] Applied testing patterns — (expected)/(edge)/(failure) titles, contract file both impls, E.164 registry (fixed), budget assertions
- [x] Met validation requirements — full `--force` gate with `REDIS_TEST_URL`, CI parity, manual E2E performed and reported honestly
- [ ] One gap: client-side hard rules (catalog strings, a11y names) had **no executable check** — both Mediums lived exactly there

## System Improvement Actions

**Applied now (the "act on 1–2" of this loop):**

1. **Update `piv-implement` SKILL.md** — before writing the Deviations section, diff the plan's named
   behaviors/test cases against what shipped; an unnoticed divergence is still a deviation. (Prevents the
   positionOf class: the review treats undocumented divergence as unintentional.)
2. **Update `piv-plan-implementation` SKILL.md** — every listed edge case must name where it is verified
   (a test file, or a numbered Level-4 manual step); call out surfaces with no test framework explicitly.
   (Prevents the M1 class: "stale GPS" was named, owned by nobody, verified by nothing.)

**Recommended, not applied (log as tickets / fold into the next loop):**

- **Test runner for `apps/dispatch` before #18.** Both Mediums were client-side and invisible to
  typecheck/lint/build. #63's page is 2 components; #18's live board (sockets, alerts, queue state) is an
  order of magnitude more stateful. Decide vitest+RTL (or Playwright CT) as a pre-#18 task — this is the
  highest-leverage single change this review found.
- **Prefer compile-pinned maps over prose lists in plans.** The `Record<TrackingPageState, MessageKey>` pin
  caught 4 missing keys at compile time; the prose key list missed `page.retry`. When a plan enumerates a
  set that must stay 1:1 with an enum, specify the pinned-map form, not the list.
- **`.claude/references/ride-state-machine.md`**: add one line — `completed` is NOT machine-terminal
  (`completed → settled`); any "ride is over" logic must say page-terminal or machine-terminal. (L1's root
  cause: the plan's "terminal ride older than grace" was ambiguous and `isTerminal()` was the wrong pick.)
- **Uniqueness claims verified by grep, not comments** (E.164 collision class) — candidate future
  plan-skill line if it recurs; once is not a pattern yet.

## Key Learnings

**What worked well:**

- The concurrency note's bet (hook `emitStatus`, not the #69-churning dispatch slice) held exactly as
  written — pre-verifying integration points against the code the implementer will inherit is the single
  biggest reason this was one-pass.
- The layered gate worked: what implement+validate missed (client-side Mediums), the fresh-context PR
  review caught; the fix loop closed same-day with tests.
- Structural guarantees beat conventions everywhere they were used: never-throws by construction,
  `satisfies` catalogs, `Record` pins, wire-schema re-parse. Every miss happened where a rule was
  convention-only.

**What needs improvement:**

- Client surfaces have zero executable enforcement — the only part of the stack where hard rules rely
  entirely on human/review attention.
- Deviation reporting relies on the implementer noticing divergence in the moment.

**For next implementation (#16 or #18):**

- If #18: settle the dispatch-app test-runner question BEFORE planning it.
- Carry the two skill edits; watch whether the Deviations-diff step actually surfaces anything.
