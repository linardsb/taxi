import type { Env } from '../../common/config/env.schema';
import { paymentsProviderFactory } from './payments.module';
import { StripePaymentsProvider } from './stripe-payments.provider';
import type { StripeClient } from './stripe-payments.provider';
import { StubPaymentsProvider } from './stub-payments.provider';

const env = (NODE_ENV: Env['NODE_ENV']): Env => ({ NODE_ENV }) as Env;

/** Only its identity matters here — the factory never calls it. */
const FAKE_STRIPE = { paymentIntents: {} } as unknown as StripeClient;

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

  it('refuses to boot in production with no provider bound (failure)', () => {
    // Structural, not conventional: the stub reports SUCCESS, so a production
    // deploy that reached it would mark rides settled and credit drivers for
    // money no rider was ever charged.
    expect(() => paymentsProviderFactory(env('production'), null)).toThrow(
      /No production PaymentsProvider is bound/,
    );
  });
});
