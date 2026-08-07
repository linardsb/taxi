import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentsProvider,
} from '@taxi/shared';
import type Stripe from 'stripe';
import { STRIPE_CLIENT } from './payments.tokens';

/**
 * The narrow slice of the SDK this provider uses — and therefore everything a
 * fake has to implement. Deliberately not widened to `Stripe`: the whole point
 * of the token is that this class is testable without a network.
 */
export type StripeClient = Pick<Stripe, 'paymentIntents'>;

/**
 * `declined` means THE RIDER'S INSTRUMENT SAID NO. Everything else — including
 * anything we fail to recognise — is `provider_error`, the retry-SAFE bucket.
 *
 * That default is deliberate and asymmetric: a transient error misfiled as
 * `declined` strands a settleable ride behind a 402 that says the rider's card
 * failed when it did not, while a decline misfiled as `provider_error` costs one
 * retry that re-declines against the SAME idempotency key. One is a lie to a
 * driver; the other is a wasted API call.
 *
 * Verified in `stripe@22.4.0`'s own `cjs/Error.js`: every subclass passes its
 * class name as `type` (`super(raw, 'StripeCardError')`), and `generateV1Error`
 * picks `StripeCardError` from **HTTP 402** — not from `rawType === 'card_error'`.
 * So `type` is the one field to switch on. A string check rather than
 * `instanceof Stripe.errors.StripeCardError` because the injected fake is the
 * only way this file is tested.
 */
function isCardError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { type?: unknown }).type === 'StripeCardError'
  );
}

/** Best-effort provider detail for the log. Never a card number — we never see one. */
function describe(error: unknown): {
  message: string;
  providerRef: string | null;
} {
  const e = error as {
    type?: unknown;
    code?: unknown;
    decline_code?: unknown;
    message?: unknown;
    payment_intent?: { id?: unknown };
  } | null;

  const intentId =
    typeof e?.payment_intent?.id === 'string' ? e.payment_intent.id : null;

  if (isCardError(error)) {
    const detail =
      (typeof e?.decline_code === 'string' && e.decline_code) ||
      (typeof e?.code === 'string' && e.code) ||
      'card_error';
    return { message: detail, providerRef: intentId };
  }

  // The `type` verbatim, not flattened into "provider error". A
  // `StripeIdempotencyError` here is a real bug worth seeing — the frozen
  // settled split means the amount for a ride cannot change between attempts.
  const type = typeof e?.type === 'string' ? e.type : null;
  const message =
    error instanceof Error
      ? error.message
      : typeof e?.message === 'string'
        ? e.message
        : 'unknown';
  // `intentId` ON BOTH BRANCHES, not just the card-error one. This is the
  // `provider_error` bucket, which MEANS "we don't know whether the money
  // moved" — so it is precisely where the reconciliation handle is worth most.
  // Dropping it here while keeping it on the decline branch had the asymmetry
  // exactly backwards. Still null whenever the error carries no intent.
  return {
    message: type ? `${type}: ${message}` : message,
    providerRef: intentId,
  };
}

/**
 * A non-succeeded intent that did NOT throw, bucketed by the same asymmetric
 * doctrine as `isCardError` above — and, until this map existed, the one path in
 * this file that contradicted it, because everything not `succeeded` fell
 * through to `declined`.
 *
 * `declined` is only for the two statuses that mean THE RIDER MUST DO
 * SOMETHING: the instrument was refused (`requires_payment_method`) or SCA is
 * required (`requires_action` — #17's problem, and a retry from here re-fails
 * identically). A 402 is honest for both.
 *
 * Everything else is retry-SAFE. `processing` is the one that matters: the money
 * may yet move, so answering 402 tells a driver the rider's card failed while a
 * charge is still in flight. `requires_capture` means funds ARE authorized and
 * uncaptured (we never send `capture_method: 'manual'`, so it would be a config
 * bug); `canceled` and `requires_confirmation` are unreachable on a
 * `confirm: true` off-session create.
 *
 * A `Record` over the closed union rather than a switch: adding a status in an
 * SDK bump then fails to compile until someone buckets it deliberately, instead
 * of silently inheriting one in the money path.
 */
const STATUS_REASON: Record<
  Exclude<Stripe.PaymentIntent.Status, 'succeeded'>,
  'declined' | 'provider_error'
> = {
  requires_payment_method: 'declined',
  requires_action: 'declined',
  processing: 'provider_error',
  requires_capture: 'provider_error',
  requires_confirmation: 'provider_error',
  canceled: 'provider_error',
};

/**
 * The Stripe test-mode implementation of the PaymentsProvider seam. This file
 * and `payments.module.ts` are the ONLY two in the repo allowed to name `stripe`
 * (root CLAUDE.md: provider SDKs live inside the slice implementing the seam).
 */
@Injectable()
export class StripePaymentsProvider implements PaymentsProvider {
  private readonly logger = new Logger(StripePaymentsProvider.name);

  constructor(@Inject(STRIPE_CLIENT) private readonly stripe: StripeClient) {}

  async charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    try {
      const intent = await this.stripe.paymentIntents.create(
        {
          amount: request.amountCents,
          currency: request.currency.toLowerCase(), // Stripe wants 'eur'
          customer: request.customerRef,
          // Passed EXPLICITLY: relying on a customer default is not the
          // documented off-session path, which is why the seam carries two refs.
          payment_method: request.instrumentRef,
          off_session: true,
          confirm: true,
          metadata: { rideId: request.rideId },
        },
        // THE SECOND ARGUMENT, not a params field. Getting this wrong is
        // silent: every retry would create a new PaymentIntent and double-charge.
        { idempotencyKey: request.idempotencyKey },
      );

      if (intent.status === 'succeeded') {
        return { ok: true, providerRef: intent.id };
      }

      // A non-succeeded intent that did NOT throw. The status rides along in
      // `message` so the log says which one; `?? 'provider_error'` is the
      // runtime half of `STATUS_REASON`'s pin — a status the installed SDK
      // types do not know must land in the retry-SAFE bucket, never crash a
      // settlement.
      return this.failed(request, {
        reason: STATUS_REASON[intent.status] ?? 'provider_error',
        providerRef: intent.id,
        message: `payment_intent_${intent.status}`,
      });
    } catch (error) {
      const { message, providerRef } = describe(error);
      return this.failed(request, {
        reason: isCardError(error) ? 'declined' : 'provider_error',
        providerRef,
        message,
      });
    }
  }

  /**
   * One log site for every failure shape. `providerRef` (a `pi_…` id) is the
   * reconciliation handle and is safe; `customerRef` / `instrumentRef` are never
   * logged.
   */
  private failed(
    request: PaymentChargeRequest,
    failure: {
      reason: 'declined' | 'provider_error';
      providerRef: string | null;
      message: string;
    },
  ): PaymentChargeResult {
    this.logger.warn({
      event: 'payment.stripe.charge_failed',
      rideId: request.rideId,
      amountCents: request.amountCents,
      reason: failure.reason,
      message: failure.message,
      providerRef: failure.providerRef,
      at: new Date().toISOString(),
    });
    return { ok: false, ...failure };
  }
}
