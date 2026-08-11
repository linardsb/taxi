/**
 * The notifications slice's public API — nothing outside imports past this
 * file.
 *
 * WHO MAY CROSS, AND WHY (the rides-barrel convention):
 *
 * - `RideNotificationsService` — injected by the rides slice ONLY, at its two
 *   post-commit hook points (`RidesService.createRide`,
 *   `RideTransitionService.emitStatus`). The dependency runs
 *   `RidesModule → NotificationsModule`, one way: this slice reads ride rows
 *   through its own repository and must never import the rides slice at
 *   runtime (the `TransitionedRide` import is type-only).
 * - `mintTrackingToken` — called by the rides slice at creation, so every
 *   ride is born trackable (#17's share-trip reuses the token). It lives here
 *   rather than in @taxi/shared because shared is isomorphic and must not
 *   touch `node:crypto`; it is a pure function rather than a service method
 *   so minting a token cannot require this module's providers.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - No real SMS provider: the stub logs instead of delivering, and production
 *   boot refuses it (auth's `smsProviderFactory`, reused here). A paid
 *   provider swaps inside that factory only.
 * - `sms_send_failed` is an ERROR log and nothing more — the Dina-console
 *   alert rides #18.
 * - No cancellation SMS, by scope (#63 non-goals).
 */
export { NotificationsModule } from './notifications.module';
export { RideNotificationsService } from './ride-notifications.service';
export { mintTrackingToken } from './tracking/tracking.service';
