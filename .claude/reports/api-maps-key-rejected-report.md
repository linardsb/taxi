# api — maps key rejected vs Places outage (#125), dispatch debt limit (#126)

**PR:** #130, merged `ed90b865` (2026-08-18). **Closes:** #125, #126 (both `CLOSED` by the merge, `observed`).
**Branch:** `fix/review-followups-125-126`, two commits — `7be46c6` (#125), `3401c0e` (#126).

Written because #125's reasoning lived only as a comment on a now-closed issue. This is the repo-local copy.

## Why #125 did not get the fix it asked for

The ticket asked for `GOOGLE_MAPS_API_KEY` in `SECRET_KEYS` with "the same substitute check the Stripe and Twilio secrets have". Both halves are false, on three counts. All `observed` against merged `main`.

1. **`SECRET_KEYS` is not what Stripe and Twilio use.** It is `['JWT_SECRET', 'OTP_PEPPER']` and nothing else (`env.schema.ts:20`). It guards a 32-char minimum and reuse of a value in `PUBLISHED_SECRETS`. Stripe is *deliberately* excluded and the schema says so in words — it is refused on its `sk_test_` prefix instead via `.refine()`. The Twilio trio likewise: `AC` prefix, E.164, and an all-or-nothing `superRefine`. The ticket read the `.optional().transform()` shape note as a statement about `SECRET_KEYS` membership; it is not.
2. **Membership would buy nothing.** No committed placeholder to catch — the template commits the key empty — and no length rule to inherit. It would be a check that cannot fail.
3. **The refusal the ticket was racing is not going away.** `geo.module.ts` builds a two-clause production refusal whose own comment states the key clause "becomes the whole message when #13/#16 binds a real routes provider and deletes the first clause" (`geo.module.ts:30`). The absent-key gap is designed to *survive* #13/#16, so the urgency premise — "do it before #13/#16 removes what makes it latent" — does not hold.

Google documents no format for a Maps Platform key (no prefix, no length), so the Stripe/Twilio prefix analogue cannot be written without encoding a guess as a boot gate.

**Do not re-pin the issue comment's line numbers.** It cited `env.schema.ts:184-186` for the Stripe exclusion; that text is at `:195` on merged `main`, moved by this PR's own 11-line docblock addition. Cite the symbol, not the line.

## What was actually unguarded

`mapsProviderSourceFactory` tests for an **absent** key. A **wrong** key passes every check, and `GooglePlacesProvider.request()` folded 401/403 into `maps_places_unavailable` — so a misconfigured key was indistinguishable from Google being degraded, and reached an operator as a support call rather than a diagnosable log line. That is the failure the `GOOGLE_MAPS_API_KEY` docblock says the key exists to prevent, by a route it did not cover.

## What shipped

- `google-places.provider.ts`: 401/403 logs `geo.places.request_failed` with `reason=key_rejected` at `error` level and throws a new `maps_places_key_rejected`, kept separate from `PLACES_UNAVAILABLE` because the two need opposite responses — an outage is waited out, a rejected key fails every call until someone changes it. The new constant is added to the catch's re-throw allow-list so it is not reclassified on the way out.
- Nothing outside the provider consumes these strings (grep across `apps`/`packages`/`services`, `observed` in the commit's own run), so no caller changed.
- `env.schema.ts`: the `GOOGLE_MAPS_API_KEY` docblock now records why the two checks it does *not* have are absent, so this premise is not re-derived by the next reader.
- Three tests in `google-places.provider.spec.ts`: 403 with `PERMISSION_DENIED`, a bare 401, and a 429 that must still read as an outage.

**#126** is docblock-only, no behaviour change. `dispatch/index.ts` claimed balance eligibility is `>= 0` and deferred the real threshold to #12. #12 shipped and decided it differently: the threshold is `platform_config.driver_debt_limit_cents`, carried on `DispatchContext` and applied by `toCandidates` (`strategies/candidate-filter.ts`), the only balance predicate in the dispatch path. The old text was inverted for the case that matters — under `>= 0` a cash-only driver is blocked at the first cent of commission owed, which is exactly what the shipped rule exists to prevent. The pilot's 5000 is named as seed data with its file (`db/src/seed/riga.ts`), not as a constant.

## Test provenance

Two of the three new tests were red pre-fix, **not all three**. The 403 and 401 cases fail before the change and pass after (`observed`, one `pnpm --filter @taxi/api test -- google-places` run each side, from the commit's own run — *not* from the gate below). The 429 case passes on **both** sides by design: it is a guard against over-catching, not a regression case.

## Gate

`pnpm turbo run typecheck lint test build --force`, `dist/` cleared first (`db`, `services/api`, `packages/shared`), `COMPOSE_PROJECT_NAME=taxi` and `REDIS_TEST_URL=redis://localhost:6381` inline. All `observed`, one run at `7be46c6`:

- 18/18 turbo tasks successful, 0/18 cached, 1m9.264s wall.
- `@taxi/api`: 66 suites passed / 66 total, 618 tests passed / 618 total, 37.692s.
- **Nothing skipped in either column.** Without `REDIS_TEST_URL` the Redis-gated specs `describe.skip` and jest still exits 0, so a hollow run and a full one match on exit status alone — the skipped counts are the check, not the exit code.
- 9 lint warnings, 0 errors, `@taxi/api` only: all `@typescript-eslint/no-unsafe-argument` on the Nest `App` argument, one per file across 9 `*.integration.spec.ts` files, none touched by this branch. `@taxi/api`'s lint script omits `--max-warnings 0`, unlike `@taxi/shared` and `@taxi/db`.

## Residual, deliberately not built

A boot-time probe that calls Places once at startup to prove the key works. It would cost a billed call per boot, cannot run in dev or CI without a real key, and until #13/#16 lands production cannot boot at all — so there is nothing it would catch today that the first keystroke does not.
