# Code Review — PR #89: real Twilio SMS provider behind the seam (#85)

**Reviewer**: `code-reviewer` agent (fresh context) + validation gate · **Recommendation: APPROVE** (one Medium test-gap worth closing before merge)

0 Critical · 0 High · 1 Medium · 0 Low. Documented deviations from `.claude/reports/real-sms-provider-twilio-report.md` were treated as intentional and not flagged.

## Validation

| Check | Result |
|---|---|
| CI on the PR head (isolated, authoritative) | ✅ pass (3m22s) |
| Local full gate `turbo typecheck lint test build --force` (pre-commit, ×2) | ✅ 20/20 tasks |
| Local full gate (post-commit run) | ⚠️ dispatch+payments integration failed with `terminating connection due to administrator command` — the documented concurrent-session test-DB clobber, **not this diff**; both suites pass 26/26 in isolation re-run |
| `@taxi/shared` | ✅ 145 tests, typecheck clean |
| `@taxi/api` jest (full, Redis suites live) | ✅ 51 suites / 420 tests |
| Lint | ✅ 0 errors (7 pre-existing warnings in untouched files) |

## Issues by severity

### Medium

1. **Missing success-log assertion** — `services/api/src/features/auth/sms/twilio-sms.provider.spec.ts:27-48`. The success-path spec never asserts the `auth.sms.twilio_sent` log, so the `segments` mapping (`Number(json.num_segments) || 1` — the string→number conversion feeding the "SMS spend €/week" ledger row, AC #3), the masked phone, and the no-Body-in-log leak-pin are unverified; the plan's spec task promised "logs `segments` from `num_segments`". **Fix** (~10 lines, test-only): `jest.spyOn(Logger.prototype, 'log').mockImplementation()` (house idiom, cf. `ride-lifecycle.service.spec.ts:575`), assert a call matching `{ event: 'auth.sms.twilio_sent', segments: 2, phone: '+371*****001' }` and that the payload contains neither the SMS body nor the raw phone.

## Routing

- **AGENT FIXES**: none (the one finding is auth-slice-adjacent, so it routes to a human call per the review rubric).
- **HUMAN DECIDES**: the Medium above — approve the ~10-line spec addition before merge (then `piv-fix-review-findings` applies it), or accept as-is since it is a test gap, not a behavior defect.
- **HUMAN READS** (load-bearing for this diff):
  - `services/api/src/features/auth/sms/twilio-sms.provider.ts:63-69` — the leak rule: non-2xx throws a locally composed `twilio_error_<code>` because `auth.service.ts:195` logs `err.message` verbatim and Twilio's text can echo the raw phone.
  - `services/api/src/common/config/env.schema.ts` superRefine — the all-or-nothing trio check deliberately sits ABOVE the production gate (every-env), a documented deviation from the house pattern.
  - `services/api/src/features/auth/auth.module.ts` factory — trio-presence-as-client-construction; production boot-refusal preserved when unset.
- **HUMAN TESTS**: the manual E2E only you can run — Twilio trial account (verify your +371 number, enable Latvia in Messaging → Geo permissions, trial number as `TWILIO_FROM_NUMBER`), one real OTP SMS, then blank the trio and confirm the stub returns.
- **FYI**: production still refuses to boot after merge (maps + unset-Stripe stubs — this PR clears the SMS gate only). `GOOGLE_MAPS_API_KEY` example↔schema drift deliberately left for the maps ticket.

## Verified clean

- **Seam discipline**: repo-wide grep — `twilio` appears only in the auth slice, the env schema pair, and the pre-existing seam docblock; no SDK dependency; notifications imports only via auth's public index.
- **Leak safety**: thrown messages locally composed; success log masks the phone and never carries the body; token appears only in the Basic auth header; timeout/network rejections carry no PII. The 4xx leak-pin test targets the exact failure mode the design exists to prevent.
- **Ride-path contract**: `send()` rejects on non-2xx/timeout; both consumers confirmed unchanged and catching.
- **Env schema**: transform-before-refine order preserved (fresh-checkout empty strings boot), E.164 regex spec-correct, stale comments truthfully rewritten.
- **i18n**: `sms.otp_code` in all three catalogs; `satisfies` + the key-iterating parity test enforce it structurally.
- **Hard rules**: no money, ride-status, or payment-lock surfaces touched; `@taxi/shared` gained no workspace imports.

## Strengths

- The leak-pin failure test asserts what must NOT be in the thrown message, not just the happy shape.
- Trio-presence-as-client-construction keeps the factory signature and both module bindings untouched — minimal diff for a production-gate feature.
- superRefine messages explain the consequence ("silently binds the stub"), pinned in both dev and prod.
- Every stale `#13` docblock and the "Unreachable while…" comment were corrected — comments still tell the truth post-merge.

---
🤖 Agentic review gate (`piv-review-pr`) — a human makes the final call.
