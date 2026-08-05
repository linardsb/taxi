/**
 * The rides slice's public API — nothing outside imports past this file.
 *
 * KNOWN GAPS — seen and accepted for the pilot, not overlooked:
 *
 * - A created ride is NEVER DISPATCHED. There is no offer, no matching, no
 *   driver selection (#10). A ride sits at `requested` indefinitely; that is
 *   the correct end state for this slice, not an oversight.
 * - A created ride NEVER TRANSITIONS. No accept/arrive/start/complete, no
 *   cancellation route — #11 owns every transition after entry.
 * - A `scheduled` ride is INERT. Nothing promotes it to `requested`; the timer
 *   is #21's. A past `scheduledFor` is rejected at the boundary precisely
 *   because nothing would ever pick it up.
 * - `geozoneId` is always null. Zone-resolution precedence (Vecrīga
 *   deliberately overlaps centre) is #10's problem, and inventing a rule here
 *   would mean #10 has to trust or re-derive it.
 * - `vehicleCount > 1` is rejected. #22 deletes that guard and fans one order
 *   into N rides sharing an `orderId`.
 * - `rideOptions` (`childSeat`, `femaleDriver`) are parsed, defaulted and
 *   persisted into the `request` jsonb, but NOTHING READS THEM. They are the
 *   filter inputs #10 matches on; carrying them now means #10 does not have to
 *   migrate rows that predate it.
 * - Pickup and destination are UNBOUNDED. `latLngSchema` only checks the
 *   coordinates are valid on Earth, so a Rīga rider can book Sydney →
 *   Reykjavík and the stub will happily quote it. A service-area rejection is
 *   cheaper than, and separate from, #10's zone resolution — it just isn't
 *   this slice's.
 * - The request is NOT IDEMPOTENT. A double-tapped "Book" creates two rides
 *   (#46); the rate limit bounds the cost but does not deduplicate.
 */
export { RidesModule } from './rides.module';
export { RidesService } from './rides.service';
