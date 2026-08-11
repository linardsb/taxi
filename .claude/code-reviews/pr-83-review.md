# PR #83 Review — feat: SMS ride statuses + no-login live-tracking page (#63)

**Verdict: 🔧 Request changes (minor)** — fix the two Mediums (a few lines each), then merge. Posted as a comment — solo repo, self-review unavailable.

## Summary

A clean, well-defended implementation of #63: unguessable per-ride tracking tokens, the LV/RU/EN SMS policy through the `SmsProvider` seam, and the first real dispatch-app page. All four hard-rule hot spots check out — token entropy (`randomBytes(16)` → base64url, minted API-side), structurally never-throwing post-commit hooks, one-way slice dependencies, contracts in `@taxi/shared`. Migration 0007 follows the 0006 DEFAULT-then-DROP precedent with consistent snapshot/journal. The full validation gate is green. Two Medium client-side gaps keep this from a straight approve: a stale-GPS timestamp bug that defeats a deliberately-built port contract, and an unlabeled, uncatalogued retry control on the page built explicitly for screen-reader use.

## Issues

| Severity | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 5 |

### Medium

**M1 — "Location updated {time}" shows the poll time, not the position's recorded time** — `apps/dispatch/src/features/tracking/tracking-map.tsx:108-111` (used at `:239-242`). `updatedTime` is `lastSeenAt` (the fetch clock) falling back to `view.updatedAt` (the ride row); `view.position.at` is never read anywhere in `apps/dispatch`. The whole point of `positionOf`'s no-freshness-filter contract (`driver-location.store.ts:52-58` — "the caller gets `atMs` and decides") is that the page stamps stale positions honestly; as shipped, a driver whose GPS went silent 10 minutes ago reads "Atrašanās vieta atjaunota ⟨now⟩" on every poll. This is the plan's "stale GPS (page shows last-updated time)" edge case not landing as designed.
**Fix**: derive the `page.position_updated` caption from `new Date(view.position.at)`; keep `lastSeenAt` for the offline banner only.

**M2 — The API-down retry control is a bare "↻" with no accessible name and no catalog key** — `apps/dispatch/src/app/t/[token]/page.tsx:102-118`. VoiceOver announces a unicode-glyph description at best, on the one page built for "blind riders' sighted assistants"; it is also the only user-facing string on the page not sourced from the LV/RU/EN catalog (hard rule: nothing user-facing hardcoded).
**Fix**: add a `page.retry` key to `MESSAGES` in `packages/shared/src/i18n.ts` (all three languages — the parity test enforces it) and render it as the link text, or as `aria-label` with the glyph `aria-hidden`.

### Low

**L1 — A `completed`-but-never-settled ride's link never expires** — `services/api/src/features/notifications/tracking/tracking.service.ts:70-77` gates the 24 h grace on `isTerminal(ride.status)`, but `completed` is not machine-terminal (`completed → settled`). A ride whose settle call never happens shows "Brauciens ir pabeigts." forever. **Fix**: apply the grace on page-terminal states (`TRACKING_STATE_BY_STATUS[ride.status]` ∈ {`completed`, `cancelled`}).

**L2 — The polling proxy forwards unvalidated path segments and relays without cache headers** — `apps/dispatch/src/app/t/[token]/data/route.ts:29-38`. Not an open proxy (host fixed) and the API validates shape, but a raw `GET /t/%2E%2E/data` normalizes to `${API_URL}/`, and every junk token costs an API hop. **Fix**: `trackingTokenSchema.safeParse(token)` → local 404 before fetching; add `cache-control: no-store` on the relayed response.

**L3 — `PUBLIC_TRACKING_BASE_URL` accepts its localhost default in production** — `services/api/src/common/config/env.schema.ts:85`; the production `superRefine` checks only secrets. Unreachable today (stub SMS factory refuses production boot), but the moment a real provider lands, a deploy that forgets this var texts `http://localhost:3000/t/…` to real riders. **Fix**: refuse localhost under `NODE_ENV=production` in the same `superRefine` block.

**L4 — Client-side `TERMINAL` set is an unpinned `Set<string>`** — `apps/dispatch/src/features/tracking/tracking-map.tsx:15`. A typo or future terminal page state silently keeps polling; `states.tsx` pins its mapping with `Record<TrackingPageState, MessageKey>` and this deserves the same. **Fix**: `new Set<TrackingPageState>([...])`.

**L5 (informational) — `trackingToken` travels on driver-facing `Ride` responses** — `rideSchema` carries the token, so e.g. `POST /rides/:rideId/complete` (`ride-lifecycle.controller.ts:73`) hands the driver the rider's tracking link. Everything behind it is driver-own data today, so impact is negligible — but driver-facing exposure was never explicitly decided. Make the call when #17 formalizes token exposure (e.g. `.omit({ trackingToken })` on driver-facing responses); no change required now.

## Validation

| Check | Result |
|---|---|
| `pnpm turbo run typecheck lint test build --force` (`REDIS_TEST_URL` set) | ✅ 20/20 tasks, 0 cached |
| `@taxi/api` tests | ✅ 405/405 across 50 suites (Redis contract halves included) |
| `@taxi/shared` / `db` / `dispatch` | ✅ green within the 20/20 gate |
| Hard rules (status writes, contract duplication, seams, money, PII in logs) | ✅ no violations — phones masked, token logged 4-chars-only |

## Plan conformance

The implementation report documents 7 deviations; all check out as intentional and sound. One **undocumented** divergence found: the plan's `positionOf` contract case was "offline-but-recorded driver still readable (tracking outlives presence)", but the implementation ships the opposite — `markOffline` drops the position and a test pins `positionOf → null` after it, with a "stale-but-recorded" case substituted. The shipped behavior is the defensible one (consistent with `markOffline`'s pre-existing three-key drop; a mid-ride socket loss never calls `markOffline` because `setOfflineIfOnline` guards on `status === 'online'`), but it belonged in the deviation list. Noting it here closes that gap — no code change needed.

## What's good

- **Public-endpoint security is genuinely careful**: server-minted `randomBytes(16)` tokens, shape validation before the SQL lookup, malformed and unknown tokens deliberately indistinguishable (404), token logged 4-chars-only, and the outbound view re-parsed through `trackingViewSchema` so neither a `Date` nor rider PII can structurally leak.
- **The never-throws guarantee is structural, not conventional**: both hooks wrap their entire bodies; unit specs pin resolution + the `sms_send_failed` ERROR alarm; dedupe holds because `accepted`/`arrived` are each reachable exactly once and `emitStatus` fires only on applied transitions.
- **SMS budget asserted, not asserted-about**: the integration spec proves exactly 3 phone-channel / 2 app-channel SMS, with post-lifecycle sleeps to catch extras.
- **Migration quality**: DEFAULT-then-DROP with the 0006 rationale inline, correct nullable-unique semantics, and the seed keeps `dispatchPhone` out of the conflict set so #20's future edit survives a re-seed — reasoning written down.
- **Contract discipline**: `positionOf` on the port with 4 new cases against both fake and real Redis; i18n key- and placeholder-parity property tests; `Record<TrackingPageState, MessageKey>` makes new page states fail the compile until they get copy.
- **a11y on the happy path is strong**: `aria-live="polite"` status with the 5 s position churn deliberately excluded, `aria-hidden` map with a text ETA alternative, ≥44 px targets, visible focus styles.

## Recommendation

Fix **M1 + M2** (both a few lines: one timestamp source swap, one catalog key), re-run the gate, then merge — no re-review needed at this size. L1–L4 can ride along if convenient or become follow-up tickets; L5 is a note for #17. Natural next step: `piv-fix-review-findings` on this report.

---
*Agentic review (piv-review-pr): fresh-context code-reviewer agent + full validation gate. A human makes the final call.*
