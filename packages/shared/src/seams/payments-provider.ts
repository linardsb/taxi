/**
 * Seam over Stripe (decided 2026-08-07) so the pilot can settle card rides in
 * test mode while spike #5's payout rails (SEPA batch now, Connect post-SIA)
 * stay free to arrive behind a different implementation.
 *
 * CASH NEEDS NO PROVIDER CALL AT ALL — the driver already took the passenger's
 * money at the kerb. That is why the cash/card branch lives ABOVE this seam, in
 * the settlement service, rather than inside an implementation that would have
 * to model "do nothing" as a charge.
 */

/**
 * EXACTLY TWO, and the split is the retry decision rather than a taxonomy of
 * what went wrong:
 *
 * - `declined` — the RIDER'S INSTRUMENT said no. A retry re-declines and costs
 *   a second provider call for the same answer.
 * - `provider_error` — everything transient (rate limits, connection resets, an
 *   unrecognised failure). A retry is SAFE, and safe specifically *because*
 *   `idempotencyKey` is derived from the ride: the retry reaches the same
 *   charge rather than creating a second one.
 *
 * A third value would have to earn a third caller behaviour, and there is no
 * third thing a caller can do.
 */
export const PAYMENT_FAILURE_REASONS = ['declined', 'provider_error'] as const;
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

export interface PaymentChargeRequest {
  /**
   * DERIVED FROM THE RIDE, NEVER GENERATED PER ATTEMPT. This single property is
   * what makes "charge succeeded, database rolled back" survivable: the retry
   * presents the same key, the provider returns the original charge, and the
   * rider is charged once. An implementation that generates a key per call
   * double-charges on every retry, silently.
   */
  idempotencyKey: string;
  amountCents: number;
  /**
   * A literal, not `string`. All money in Sakta Cab is EUR integer cents (root
   * CLAUDE.md); the field exists so a money-moving call site can never be read
   * as currency-agnostic.
   */
  currency: 'EUR';
  /**
   * PROVIDER-OPAQUE handles, deliberately not named `stripeCustomerId` /
   * `stripePaymentMethodId`. Spike #5 requires this seam to abstract over
   * destinations it has not met yet, and a name that says Stripe is a name a
   * second implementation has to lie about.
   */
  customerRef: string;
  instrumentRef: string;
  /** Carried for provider-side metadata and reconciliation, never for pricing. */
  rideId: string;
}

/**
 * A RESULT UNION, NOT A THROWN ERROR, on purpose: a declined card is the
 * expected outcome of a perfectly correct call, and routing it through an
 * exception would make the settlement service catch-and-classify provider
 * internals it must not know about. Provider *bugs* — a malformed request, a
 * missing credential — still throw.
 */
export type PaymentChargeResult =
  | { ok: true; providerRef: string }
  | {
      ok: false;
      reason: PaymentFailureReason;
      /** The charge handle when the provider got far enough to mint one. */
      providerRef: string | null;
      /** Provider-side detail for the log — never shown to a rider. */
      message: string;
    };

export interface PaymentsProvider {
  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult>;
}
