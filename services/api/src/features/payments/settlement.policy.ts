/**
 * The provider idempotency key for a ride's settlement charge.
 *
 * DERIVED FROM THE RIDE, NEVER GENERATED PER ATTEMPT. This one naming decision
 * is what makes "charge succeeded, database rolled back" survivable: the retry
 * presents the same key, Stripe returns the original PaymentIntent instead of
 * creating a second one, and the rider is charged once. It is also what lets two
 * racing settles be one charge.
 *
 * THAT REPLAY IS BOUNDED AT 24 HOURS, and the bound lives here — the rest of
 * this slice defers to this file rather than restating it. Stripe: *"Clients can
 * safely retry requests that include an idempotency key as long as the second
 * request occurs within 24 hours from when you first receive the key (keys
 * expire out of the system after 24 hours)"*, and *"We generate a new request
 * if a key is reused after the original is pruned"*
 * (https://docs.stripe.com/error-low-level#idempotency ·
 * https://docs.stripe.com/api/idempotent_requests). So a settle re-POSTed the
 * NEXT DAY is not free: the same key mints a SECOND PaymentIntent and the rider
 * pays twice for one ride. By-hand recovery is same-day; past that it is a
 * dashboard reconciliation against `metadata.rideId`, never a blind retry
 * (#67's runbook).
 *
 * THE `@taxi/shared` PAYMENTS SEAM STATES THE OBLIGATION; THIS FILE IS
 * STRIPE'S DECLARATION OF IT (#73). The seam's `idempotencyKey` contract
 * requires every implementation to bound its replay and name the bound where
 * it derives its keys — carrying no figure itself, because 24h is a STRIPE
 * fact and the seam is provider-agnostic. The paragraph above is that
 * declaration.
 *
 * A function in its own file so the specs can assert on it BY NAME rather than
 * by re-typing the format — a test that hardcoded `settle:<id>` would keep
 * passing if the producer changed.
 */
export function settlementIdempotencyKey(rideId: string): string {
  return `settle:${rideId}`;
}
