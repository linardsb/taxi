# Implementation Report — Real SMS provider behind the seam (Twilio)

**Plan**: `.claude/plans/real-sms-provider-twilio.md`   **Branch**: `feature/real-sms-provider-twilio`   **Status**: COMPLETE (one manual step left for Linards, see below)

## Summary

`TwilioSmsProvider` now implements the `SmsProvider` seam with plain injectable `fetch` (no SDK), bound by `smsProviderFactory` whenever the `TWILIO_*` trio is present — in every environment, including production, which otherwise still refuses to boot on the stub. `env.schema.ts` learned the trio (`AC` prefix-refine on the SID, E.164-or-alphanumeric refine on the sender, all-or-nothing superRefine running in every environment), closing the `.env.example` drift. OTP copy lives in the shared LV/RU/EN catalog as `sms.otp_code`; the success log carries `segments` for the €/week ledger row. Both consumers (auth OTP, ride notifications) are untouched — the existing 420-test API suite green is the proof.

## Tasks completed

- `sms.otp_code` in all three catalogs (LV kept GSM-7/diacritic-free deliberately) → `packages/shared/src/i18n.ts` (UPDATE)
- `TWILIO_*` trio + all-or-nothing superRefine + stale-comment rewrites → `services/api/src/common/config/env.schema.ts` (UPDATE)
- TWILIO describe block, 5 cases → `services/api/src/common/config/env.schema.spec.ts` (UPDATE)
- The provider: injectable fetch, 10s timeout, leak-safe `twilio_error_<code>` throws, `auth.sms.twilio_sent` log with `segments` → `services/api/src/features/auth/sms/twilio-sms.provider.ts` (CREATE)
- Provider spec, 5 cases with captured fake fetch → `services/api/src/features/auth/sms/twilio-sms.provider.spec.ts` (CREATE)
- Factory real-branch + docblock rewrite; `#13` docblocks corrected → `services/api/src/features/auth/auth.module.ts`, `.../sms/stub-sms.provider.ts` (UPDATE)
- "two stub instances" → "two provider instances" → `services/api/src/features/notifications/notifications.module.ts` (UPDATE)
- Trio-present factory case (all three NODE_ENVs), widened `env()` helper → `services/api/src/features/auth/auth.module.spec.ts` (UPDATE)
- Twilio block comment: all-or-nothing, alphanumeric sender rules, stub fallback → `.env.example` (UPDATE)

## Tests added

- `twilio-sms.provider.spec.ts` — 5: request shape/Basic auth/form fields (expected), lv OTP body via `formatMessage` (expected), alphanumeric sender + timeout signal (edge), leak-free 4xx with phone-bearing Twilio message (failure), non-JSON error body → HTTP status fallback (failure). All pass.
- `env.schema.spec.ts` +5: trio retained in dev+prod (expected), `.env.example` empty strings → `undefined` (edge), non-`AC` SID refused (failure), partial trio refused naming each missing key in dev AND prod (failure), `SaktaCab` accepted / 12-char alpha and digit-only refused (edge). All pass (suite 19 total).
- `auth.module.spec.ts` +1: `TwilioSmsProvider` bound whenever the trio is present, including production (suite 4 total). Passes.

## Validation results

- **Full gate** `pnpm turbo run typecheck lint test build --force` with `REDIS_TEST_URL=redis://localhost:6381`: **20/20 tasks green** (Redis suites live, not skipped).
- Shared: 145 tests pass, typecheck clean. API jest: **51 suites / 420 tests pass** — includes the untouched auth OTP + notifications integration suites (AC #4 evidence).
- API lint: 0 errors (7 pre-existing warnings in untouched integration specs).
- Dev boot smoke: `pnpm --filter @taxi/api dev` with empty trio → "Nest application successfully started" (stub path).
- **Level 4 manual E2E: NOT run — needs Linards.** With a Twilio trial account (verify your +371 number, enable Latvia under Messaging → Geo permissions, trial number as `TWILIO_FROM_NUMBER`): set the trio in `.env`, boot, `POST /auth/request-otp` → a real SMS should arrive; blank the trio → stub logs return. Upgrade the account before pilot (trials can't use the `SaktaCab` alpha sender).

## Deviations from the plan

- `errorCode()` is a module-level helper rather than a private method — matches the pattern file's style (`stripe-payments.provider.ts` keeps `isCardError`/`describe` module-level). No behavior difference.
- Spec uses the house `calls[0]!` idiom (from `stripe-payments.provider.spec.ts`) for `noUncheckedIndexedAccess` — the plan's sketch didn't account for it.
- Otherwise none — including the starred assumptions (Twilio, `SaktaCab`, fixed-lv OTP, no SDK, every-env trio check), all implemented as planned.

## Issues encountered

- **Concurrent session interleave**: while this ticket was mid-flight, another session implemented #86 (vehicle stamp) in the same checkout, transiently breaking `tsc` with its half-edited files and briefly flipping the checkout across its branches. It committed cleanly to `feature/api-ride-vehicle-stamp` (`81d81b9`, none of this ticket's files) and returned the checkout to this branch; the definitive gate run above happened after that settled, on exactly main + this ticket's changes. **Before `piv-commit`: re-check `git status` — its "Tests and docs follow in the next commit" note means it may dirty the tree again, and a commit-all would sweep its files in.**
- API jest resolves `@taxi/shared` from `dist`, so the new i18n key needed `pnpm --filter @taxi/shared build` before the provider spec could pass (the known warm-dist gotcha).
