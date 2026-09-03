import type { PaymentChargeRequest } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import { CardPaymentsDisabledProvider } from './card-payments-disabled.provider';
import { paymentsProviderFactory } from './payments.module';
import { StripePaymentsProvider } from './stripe-payments.provider';
import type { StripeClient } from './stripe-payments.provider';
import { StubPaymentsProvider } from './stub-payments.provider';

const env = (NODE_ENV: Env['NODE_ENV']): Env => ({ NODE_ENV }) as Env;

/** Only its identity matters here — the factory never calls it. */
const FAKE_STRIPE = { paymentIntents: {} } as unknown as StripeClient;

const CARD_CHARGE: PaymentChargeRequest = {
  idempotencyKey: 'settle:r0000000-0000-4000-8000-000000000001',
  amountCents: 1_000,
  currency: 'EUR',
  customerRef: 'cus_test_123',
  instrumentRef: 'pm_test_456',
  rideId: 'r0000000-0000-4000-8000-000000000001',
};

describe('paymentsProviderFactory', () => {
  it('binds the Stripe provider whenever a client was constructed (expected)', () => {
    // The client is only non-null when STRIPE_SECRET_KEY passed the schema's
    // `sk_test_` check, so "a client exists" already means "test mode".
    expect(
      paymentsProviderFactory(env('production'), FAKE_STRIPE),
    ).toBeInstanceOf(StripePaymentsProvider);
  });

  it('binds the stub in development when no key is set (edge)', () => {
    expect(paymentsProviderFactory(env('development'), null)).toBeInstanceOf(
      StubPaymentsProvider,
    );
    expect(paymentsProviderFactory(env('test'), null)).toBeInstanceOf(
      StubPaymentsProvider,
    );
  });

  it('binds the refusing provider in production with no key, and does not throw (expected — #13)', () => {
    // The cash-only pilot: no SIA, no Stripe key, and cash never reaches the
    // seam. Refusing card charges is the correct production posture; throwing
    // at boot blocked every deploy for a rail the pilot does not use.
    const provider = paymentsProviderFactory(env('production'), null);

    expect(provider).toBeInstanceOf(CardPaymentsDisabledProvider);
  });

  it('production with no key refuses a card charge rather than settling it (failure)', async () => {
    // The property the old throw protected, kept: the stub reports SUCCESS, so
    // a production deploy that reached it would mark rides settled and credit
    // drivers for money no rider was ever charged. Asserted on the behaviour,
    // not the class — `not.toBeInstanceOf(StubPaymentsProvider)` is implied by
    // the case above and could never fail on its own.
    const provider = paymentsProviderFactory(env('production'), null);

    const result = await provider.charge(CARD_CHARGE);

    expect(result.ok).toBe(false);
  });
});
