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
 * EXACTLY TWO, split by the one question every implementation must ask of a
 * failure — MUST THE RIDER ACT before anything can change?
 *
 * - `declined` — YES: the instrument said no, or the rider has to
 *   re-authenticate (SCA). The caller's move is "talk to your rider".
 * - `provider_error` — NO: everything transient (rate limits, connection
 *   resets) and EVERYTHING UNRECOGNISED. The caller's move is "retry" — safe
 *   specifically *because* `idempotencyKey` below makes a retry reach the same
 *   charge, inside the implementation's replay window, rather than create a
 *   second one.
 *
 * THE TEST IS NEVER "CAN A BARE RETRY SUCCEED?" — that question does not
 * discriminate: inside the replay window a provider replays the same cached
 * answer to every retry, so a bare retry changes nothing in EITHER bucket.
 * The default is deliberately asymmetric: a transient error misfiled as
 * `declined` strands a settleable ride behind an answer that blames the
 * rider's instrument, while a decline misfiled as `provider_error` costs one
 * wasted retry. When in doubt, `provider_error`.
 *
 * A third value would have to earn a third caller behaviour, and there is no
 * third thing a caller can do — the settlement service maps these 1:1 onto
 * 402/502, and `tests/payments-provider.test.ts` pins the set so a new value
 * has to visit that mapping deliberately.
 */
export const PAYMENT_FAILURE_REASONS = ['declined', 'provider_error'] as const;
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASONS)[number];

export interface PaymentChargeRequest {
  /**
   * DERIVED FROM THE RIDE, NEVER GENERATED PER ATTEMPT. This single property is
   * what makes "charge succeeded, database rolled back" survivable: the retry
   * presents the same key, the provider replays the original charge, and the
   * rider is charged once. An implementation that generates a key per call
   * double-charges on every retry, silently.
   *
   * THE REPLAY IS TIME-BOUNDED, AND THE BOUND IS THE IMPLEMENTATION'S TO
   * DECLARE. How long a key replays is a provider fact, not a seam fact, so no
   * figure lives here — but every implementation MUST state its own bound
   * where it derives its keys, because past that bound the SAME key produces a
   * NEW charge. A recovery flow that leans on the replay reads the
   * implementation's bound first (the Stripe declaration:
   * `settlement.policy.ts` in services/api).
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
