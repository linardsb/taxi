import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentsProvider,
} from '@taxi/shared';

/**
 * The cash-only pilot's card provider (#13): refuses every charge, moves no
 * money, and NEVER reports success.
 *
 * WHY IT EXISTS. There is no SIA, so there is no Stripe key — `STRIPE_SECRET_KEY`
 * is test-mode-only by schema and stays absent in production until the legal
 * entity does. `paymentsProviderFactory` used to throw at boot without one,
 * which blocked every deploy, including a cash-only one that never needs a
 * card charge. Cash rides never reach this seam at all (`chargeIfNeeded`
 * returns above it), so binding a refusing provider costs the pilot nothing.
 *
 * STRICTLY SAFER THAN `StubPaymentsProvider`, which is what the old throw
 * guarded against: the stub reports SUCCESS, so a card ride would be marked
 * `settled`, its ledger posted and a driver credited while the rider was never
 * charged — money the platform then owes from its own pocket. This provider
 * answers `ok: false` to every call, so a card settlement fails closed in
 * `chargeIfNeeded` and nothing is written.
 *
 * `provider_error`, NOT `declined`. The seam's one question is "must the rider
 * act?", and here nothing the rider does can change the answer: the platform
 * has no card rail. `declined` would surface as 402 `payment_declined`, telling
 * the driver the rider's card failed when the rider's card was never seen. 502
 * `payment_provider_error` is the honest shape — the provider is the problem —
 * and it is the retry-SAFE bucket, which is also true: a retry costs no network
 * call and refuses identically, and nothing can be stranded because nothing
 * ever moved. `message` names the real cause for the
 * `payment.settlement.charge_failed` line the runbook reads.
 *
 * A future SIA + `STRIPE_SECRET_KEY` binds `StripePaymentsProvider` instead with
 * no code change — the factory checks the client first.
 */
@Injectable()
export class CardPaymentsDisabledProvider implements PaymentsProvider {
  private readonly logger = new Logger(CardPaymentsDisabledProvider.name);

  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    this.logger.warn({
      event: 'payment.card_disabled.charge_refused',
      rideId: request.rideId,
      amountCents: request.amountCents,
      at: new Date().toISOString(),
    });
    return Promise.resolve({
      ok: false,
      reason: 'provider_error',
      providerRef: null,
      message: 'card_payments_disabled',
    });
  }
}
