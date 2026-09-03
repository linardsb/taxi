import { Module } from '@nestjs/common';
import type { PaymentsProvider } from '@taxi/shared';
import Stripe from 'stripe';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { LedgerModule } from '../ledger';
import { RidesModule } from '../rides';
import { CardPaymentsDisabledProvider } from './card-payments-disabled.provider';
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
 * In order: Stripe when a client exists; the REFUSING provider in production;
 * the stub everywhere else.
 *
 * Production without Stripe used to throw here, like `smsProviderFactory`. The
 * danger that throw guarded against was never the absence of Stripe — it was
 * the STUB, which reports SUCCESS: a ride marked `settled`, its ledger entries
 * written and a driver credited, while the rider was never charged a cent —
 * money the platform would then owe out of its own pocket, discovered at
 * reconciliation rather than at the failure. That stays true, and the stub
 * still never binds in production.
 *
 * What changed (#13): the pilot is cash-only — no SIA, so no Stripe key can
 * exist — and cash rides never reach this seam, so "no card rail" is a
 * legitimate production posture where "pretend to charge" is not.
 * `CardPaymentsDisabledProvider` answers `ok: false` to every card charge and
 * moves nothing, so a card settlement fails closed instead of the deploy
 * failing at boot. When the SIA exists, setting `STRIPE_SECRET_KEY` binds
 * `StripePaymentsProvider` with no code change — the client check comes first.
 */
export function paymentsProviderFactory(
  env: Env,
  stripe: StripeClient | null,
): PaymentsProvider {
  if (stripe) return new StripePaymentsProvider(stripe);
  if (env.NODE_ENV === 'production') return new CardPaymentsDisabledProvider();
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
