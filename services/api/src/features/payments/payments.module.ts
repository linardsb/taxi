import { Module } from '@nestjs/common';
import type { PaymentsProvider } from '@taxi/shared';
import Stripe from 'stripe';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { LedgerModule } from '../ledger';
import { RidesModule } from '../rides';
import { PAYMENTS_PROVIDER, STRIPE_CLIENT } from './payments.tokens';
import { SettlementController } from './settlement.controller';
import { SettlementRepository } from './settlement.repository';
import { SettlementService } from './settlement.service';
import { StubPaymentsProvider } from './stub-payments.provider';
import {
  StripePaymentsProvider,
  type StripeClient,
} from './stripe-payments.provider';

/**
 * The SDK handle, or `null` when no key is configured. `new Stripe(key)` is
 * constructed exactly once, here — this file and `stripe-payments.provider.ts`
 * are the only two in the repo allowed to name `stripe`.
 */
export function stripeClientFactory(env: Env): StripeClient | null {
  return env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null;
}

/**
 * Refuses to boot in production while the stub is the only bound provider —
 * structurally, exactly like `smsProviderFactory` and `mapsProviderSourceFactory`.
 *
 * The stub is worse here than either of those: it reports SUCCESS. A ride would
 * be marked `settled`, its ledger entries written and a driver credited, while
 * the rider was never charged a cent — money the platform would then owe out of
 * its own pocket, discovered at reconciliation rather than at the failure.
 */
export function paymentsProviderFactory(
  env: Env,
  stripe: StripeClient | null,
): PaymentsProvider {
  if (stripe) return new StripePaymentsProvider(stripe);

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'No production PaymentsProvider is bound: StubPaymentsProvider settles card rides without moving any money, so a ride would be marked settled and paid while the rider was never charged. Set STRIPE_SECRET_KEY (test mode until the SIA exists) before running with NODE_ENV=production.',
    );
  }
  return new StubPaymentsProvider();
}

/**
 * `PaymentsModule` IMPORTS `RidesModule`, NEVER THE REVERSE. `RidesModule`
 * already imports `PricingModule`, `RealtimeModule` and `DriversModule` and must
 * not learn about payments — that is the cycle. The rides barrel exports
 * `RideTransitionService` + `RidesRepository` precisely so a consumer like this
 * one can compose them.
 *
 * `PAYMENTS_PROVIDER` is exported so the test harness can override it by token
 * across the compiled graph — the same sanction `geo.module.ts` records for
 * `MAPS_PROVIDER_SOURCE`. Without that override the integration suite binds the
 * stub, every charge silently succeeds, and the decline test passes for the
 * wrong reason.
 */
@Module({
  imports: [RidesModule, LedgerModule],
  controllers: [SettlementController],
  providers: [
    SettlementService,
    SettlementRepository,
    {
      provide: STRIPE_CLIENT,
      useFactory: stripeClientFactory,
      inject: [APP_ENV],
    },
    {
      provide: PAYMENTS_PROVIDER,
      useFactory: paymentsProviderFactory,
      inject: [APP_ENV, STRIPE_CLIENT],
    },
  ],
  exports: [PAYMENTS_PROVIDER],
})
export class PaymentsModule {}
