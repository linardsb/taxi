/**
 * The provider idempotency key for a ride's settlement charge.
 *
 * DERIVED FROM THE RIDE, NEVER GENERATED PER ATTEMPT. This one naming decision
 * is what makes "charge succeeded, database rolled back" survivable: the retry
 * presents the same key, Stripe returns the original PaymentIntent instead of
 * creating a second one, and the rider is charged once. It is also what lets two
 * racing settles be one charge.
 *
 * A function in its own file so the specs can assert on it BY NAME rather than
 * by re-typing the format — a test that hardcoded `settle:<id>` would keep
 * passing if the producer changed.
 */
export function settlementIdempotencyKey(rideId: string): string {
  return `settle:${rideId}`;
}
