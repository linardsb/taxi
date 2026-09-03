import { Injectable, Logger } from '@nestjs/common';
import type {
  PaymentChargeRequest,
  PaymentChargeResult,
  PaymentsProvider,
} from '@taxi/shared';

/**
 * Dev/test implementation of the PaymentsProvider seam (@taxi/shared). Moves no
 * money and always succeeds. `paymentsProviderFactory` never binds it under
 * `NODE_ENV=production` — it binds `CardPaymentsDisabledProvider` there, which
 * moves no money and always REFUSES (#13).
 *
 * NO MAGIC-AMOUNT FAILURE TRIGGERS. The integration suite overrides
 * `PAYMENTS_PROVIDER` with a controllable recording fake, which is clearer than
 * a stub that behaves differently for amounts nobody documents.
 */
@Injectable()
export class StubPaymentsProvider implements PaymentsProvider {
  private readonly logger = new Logger(StubPaymentsProvider.name);

  charge(request: PaymentChargeRequest): Promise<PaymentChargeResult> {
    this.logger.log({
      event: 'payment.stub.charge_succeeded',
      rideId: request.rideId,
      amountCents: request.amountCents,
      at: new Date().toISOString(),
    });
    // DERIVED FROM THE IDEMPOTENCY KEY, so a stubbed retry returns the same ref.
    // The stub demonstrates the property the real provider must have instead of
    // quietly not having it.
    return Promise.resolve({
      ok: true,
      providerRef: `stub_pi_${request.idempotencyKey}`,
    });
  }
}
