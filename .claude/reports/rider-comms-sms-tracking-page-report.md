# Implementation Report — Rider comms: SMS ride statuses + no-login live-tracking page

**Plan**: `.claude/plans/rider-comms-sms-tracking-page.md`   **Branch**: `feature/rider-comms-sms-tracking-page`   **Status**: COMPLETE

## Summary

Every ride now mints an unguessable 22-char tracking token at creation and carries a `bookingChannel` (`app`|`phone`). A new `features/notifications` slice in the API sends templated LV/RU/EN SMS from two post-commit hooks (booking-confirmed at creation — with the tracking link on the phone channel; driver-assigned at `accepted` for phone bookings; driver-arrived for all channels) and serves a `@Public()` `GET /track/:token` read model. The first real page in `apps/dispatch` (`/t/[token]`) server-renders the ride status and driver card, and a Leaflet client island polls a same-origin proxy every 5 s for live position/ETA. SMS failure never fails a booking (fire-and-forget + `ride.notifications.sms_send_failed` ERROR log).

## Tasks completed

- Shared contracts → `packages/shared/src/enums.ts` (+`BOOKING_CHANNELS`), `schemas/tracking.ts` (CREATE), `i18n.ts` (CREATE — first LV/RU/EN catalog), `schemas/ride.ts` (+`bookingChannel`, +`trackingToken`), `schemas/platform-config.ts` (+`dispatchPhone`), `seams/sms-provider.ts` (+`send()`), `index.ts` barrel
- DB → migration `0007_uneven_mulholland_black.sql` (booking_channel enum + column, `rides.tracking_token` + UNIQUE index, `drivers.photo_url`, `platform_config.dispatch_phone` via DEFAULT-then-DROP per the 0006 precedent), schema files, `seed/riga.ts` (dispatch phone placeholder, deliberately NOT in the conflict set so #20's edit survives a re-seed)
- Location port → `positionOf(cityId, driverId)` on `DriverLocationStore` + Redis GEOPOS+ZSCORE impl (validated replies) + fake promoted to the port + 4 new contract cases (both impls)
- Notifications slice → `services/api/src/features/notifications/` (module, `RideNotificationsService`, repository, `sms-templates.ts`, `notifications.policy.ts`, `tracking/tracking.{controller,service}.ts` — token minting lives in `tracking.service.ts`, `node:crypto` stays out of shared)
- Hooks → `rides.service.ts` post-commit (+`onRideCreated`, +token mint, +`bookingChannel` param defaulting `'app'`), `ride-transition.service.ts` `emitStatus` (+`onStatus`), `rides.repository.ts` (insert + `toRide` mapping), `app.module.ts` (NotificationsModule before RidesModule), `env.schema.ts` + `.env.example` (`PUBLIC_TRACKING_BASE_URL`, dispatch `API_URL`), `auth/index.ts` (exports `smsProviderFactory` + `maskPhone`), `stub-sms.provider.ts` (+`send()` logging body + masked phone), harness `RecordingSmsProvider` (+`send()`/`sentMessages`/`messagesFor`)
- Web page → `apps/dispatch/src/app/t/[token]/{layout,page}.tsx`, `t/[token]/data/route.ts` (same-origin proxy), `src/features/tracking/{tracking-map,states}.tsx`, +`leaflet`/`@types/leaflet`

## Tests added

- `packages/shared/tests/tracking.test.ts` — token shape (expected/edge/failure incl. base64-alphabet leak), view-schema Date rejection, page-state pin — 8 cases
- `packages/shared/tests/i18n.test.ts` — key/placeholder parity across languages, interpolation, unsupplied-placeholder-stays-visible — 6 cases
- `driver-location-store.contract.ts` — 4 new `positionOf` cases, run against fake AND real Redis
- `ride-notifications.service.spec.ts` — 10 cases: link policy per channel/language, first-name-only, '?' ETA fallback, no-op transitions read nothing, never-throws + alarm log (AC #3 failure case)
- `tracking/tracking.integration.spec.ts` — 5 cases on the real AppModule: phone booking full lifecycle (3 SMS with link, page states searching→…→completed, position/ETA live, position null after completion), app booking (2 SMS, no link, no driver_assigned — SMS budget), 410 after backdating past the 24 h grace (trigger disabled around the UPDATE, re-enabled in finally), fresh terminal ride still 200, unknown/malformed tokens 404

Results: shared 145/145 (vitest), api 405/405 in 50 suites (jest, serial, with `REDIS_TEST_URL` so the Redis contract half ran).

## Validation results

- `pnpm turbo run typecheck lint test build --force` with `REDIS_TEST_URL=redis://localhost:6381`: **20/20 tasks green** (CI parity, from --force so nothing rode a warm cache)
- Manual E2E: booted `api dev` + `dispatch dev`; OTP sign-in → `POST /rides` → read confirm SMS from the stub log → `curl /track/:token` 200 (searching view with seeded dispatch phone), 404 unknown, 404 malformed; page SSR verified (`/t/:token` renders LV status line + tel: call button + theme vars; `?lang=ru` renders RU; unknown token renders the not-found state; `/t/:token/data` proxy 200 + 404 passthrough)
- Migration applied + re-seeded against the local docker Postgres; `db-schema` smoke test green

## Deviations from the plan

1. **E.164 range is `+371280`, not the plan's `+371270`** — `payments.integration.spec.ts` already holds `+371270`; the registry comment in the lifecycle spec had drifted and did not list it (exactly the doc-drift class the plan warned about). Symptom before the fix: my spec's "driver" reused payments' user and answered with plate `PY0001`. The registry comment now lists both ranges.
2. **No seeded driver photo** — the plan's "one seeded driver gets a `photo_url`" has nothing to attach to: `seed/riga.ts` seeds no drivers at all. The integration spec sets `photo_url` on its own driver and asserts it round-trips to the page; the column ships as planned.
3. **Four extra catalog keys** (`page.assigned`, `page.arriving`, `page.arrived`, `page.in_progress`) beyond the plan's key list — the status line must render every `TRACKING_PAGE_STATES` member from the catalog (hard rule: no hardcoded strings); `states.tsx` pins the mapping with a `Record<TrackingPageState, MessageKey>` so a new state fails the compile until it gets copy.
4. **`lang` attribute on `<main>`, not `<html>`** — the root layout owns `<html>` and serves the whole dispatch app; a segment cannot re-render it. Screen readers honor `lang` on any element, so the page sets it on its wrapper.
5. **`maskPhone` exported from the auth barrel** (alongside the planned `smsProviderFactory`) — the notifications logs need it, and a deep import past `auth/index.ts` would break the slice-boundary rule.
6. **Slice-local haversine** in `notifications.policy.ts` rather than importing `features/geo`'s — geo's is documented as a stub internal that "dies with StubMapsProvider" and is deliberately not exported; the ETA policy here is a permanent documented estimate, not a road-distance stand-in.
7. **Driver-assigned SMS with no recorded position sends `~? min`** rather than fabricating a number — unspecified in the plan; the unit spec pins it.

## Issues encountered

- Stale build artifacts twice: drizzle-kit and the api test harness consume `packages/shared/dist` / `db/dist`, so both needed a rebuild before the new enum/seed were visible (known CI-parity trap from memory — resolved by building, no code change).
- Three shared test files and the platform-config unit spec parse `platformConfigSchema` from fixtures; the new required `dispatchPhone` broke them exactly as their "keep this row complete" comments predict. Added the field — the intended consumer-check, not collateral.
- The Next 16 `RouteContext` global type helper only exists after typegen; the proxy route types its context inline (`{ params: Promise<{ token: string }> }`) so `tsc --noEmit` passes without a prior build.

## Ready for the next step

All validations pass. Next: `piv-commit`, then `piv-create-pr` (body: `Closes #63`; this report fills it), then `piv-review-pr`.
