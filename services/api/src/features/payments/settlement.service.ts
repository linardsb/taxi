import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import {
  assertRideSplitConsistent,
  fareSplitSchema,
  type PaymentChargeResult,
  type PaymentMethodType,
  type PaymentsProvider,
  type Ride,
} from '@taxi/shared';
import { DRIZZLE } from '../../common/db/db.module';
import { LedgerService } from '../ledger';
import { RidesRepository, RideTransitionService } from '../rides';
import { PAYMENTS_PROVIDER } from './payments.tokens';
import { settlementIdempotencyKey } from './settlement.policy';
import {
  SettlementRepository,
  type SettlableRide,
} from './settlement.repository';

/** Who asked. `rider` is absent on purpose — a rider does not settle their own ride. */
export type SettlementActor = 'driver' | 'dispatcher' | 'admin';

export interface SettleInput {
  rideId: string;
  actor: SettlementActor;
  actorId: string;
}

/**
 * The two methods this ticket settles, narrowed ONCE and ABOVE THE CHARGE.
 *
 * Deliberately not a ternary at the ledger call: that one sits INSIDE the
 * transaction, after money has already moved, so failing closed there would
 * manufacture the exact hazard this slice is built around — charge succeeded,
 * database rolled back. Refusing here costs nothing, because nothing has
 * happened yet.
 *
 * The `never` arm is the point. A `balance` ride reaching the ledger as `card`
 * would post `card_settlement` entries asserting Stripe collected money it never
 * touched — and the set would still sum to zero, so every invariant test would
 * pass. Adding a value to `PAYMENT_METHOD_TYPES` now stops compiling until
 * someone decides how it settles.
 */
function settlementMethodOf(method: PaymentMethodType): 'cash' | 'card' {
  switch (method) {
    case 'cash':
    case 'card':
      return method;
    case 'balance':
    case 'corporate':
      // Both are post-MVP. The ledger SHAPE accommodates them (a rider account
      // already exists as an owner type, and both would simply omit the
      // collection pair) — the settlement flow does not.
      throw new ConflictException('payment_method_unsupported');
    default: {
      // Unreachable while the union is closed; fails closed anyway rather than
      // letting an unmapped method post entries.
      const unmapped: never = method;
      throw new ConflictException(
        `payment_method_unsupported: ${String(unmapped)}`,
      );
    }
  }
}

/**
 * The money movement of a ride, in one call.
 *
 * The skeleton is deliberately identical to `RideLifecycleService.complete()`:
 * validate before, transact, emit and log after.
 *
 * THE CHARGE HAPPENS BEFORE AND OUTSIDE THE TRANSACTION. A Stripe call inside a
 * transaction holds a database connection across a network round trip and —
 * worse — cannot be rolled back. Same rule as "no socket emit inside a
 * transaction", for the same reason.
 *
 * `transitionInTx(completed → settled)` IS THE IDEMPOTENCY LOCK. There is no
 * second guard, no `settled_at` column, no advisory lock: exactly one caller
 * wins the edge and everyone else gets `undefined` and an already-settled read,
 * the same pattern `DispatchService.offerNext` uses for the cascade.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger(SettlementService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly settlements: SettlementRepository,
    private readonly ledger: LedgerService,
    private readonly transitions: RideTransitionService,
    private readonly rides: RidesRepository,
    @Inject(PAYMENTS_PROVIDER) private readonly payments: PaymentsProvider,
  ) {}

  async settle(input: SettleInput): Promise<{ ride: Ride }> {
    const ride = await this.settlements.findSettlable(input.rideId);
    if (!ride) throw new NotFoundException('ride_not_found');

    // A dispatcher (and an admin acting as one) overrides ownership — the same
    // override reasoning as `RideLifecycleService.cancel`, and what makes a
    // stuck ride recoverable by the person on the phone with the driver.
    if (input.actor === 'driver' && ride.driverId !== input.actorId) {
      throw new ForbiddenException('ride_not_yours');
    }

    // IDEMPOTENT, and answered BEFORE the status check: a retrying client must
    // not have to distinguish "I settled it" from "it was already settled", so
    // this is an ordinary success carrying the settled ride, never a 409.
    if (ride.status === 'settled') {
      this.logRejected(ride, input, 'already_settled');
      return { ride: await this.readRide(input.rideId) };
    }
    if (ride.status !== 'completed') {
      throw new ConflictException('ride_not_completed');
    }

    const { driverId, split } = this.assertSettlable(ride);

    // Narrowed ABOVE the charge and reused below it, never re-derived inside the
    // transaction — see `settlementMethodOf`.
    const method = settlementMethodOf(ride.paymentMethod);

    const charge = await this.chargeIfNeeded(
      ride,
      method,
      driverId,
      split.totalCents,
    );

    const result = await this.db
      .transaction(async (tx) => {
        // FIRST STATEMENT IN THE TRANSACTION. `return undefined` then commits an
        // empty transaction (the dispatch pattern); anything written before it
        // would commit unpaired.
        const moved = await this.transitions.transitionInTx(
          tx,
          input.rideId,
          'completed',
          'settled',
        );
        if (!moved) return undefined; // someone else settled this ride

        const posted = await this.ledger.postRideSettlement(tx, {
          rideId: input.rideId,
          riderId: ride.riderId,
          driverId,
          paymentMethod: method,
          split,
        });

        if (charge) {
          await this.settlements.writePaymentRef(
            tx,
            input.rideId,
            charge.providerRef,
          );
        }

        return { moved, posted };
      })
      .catch((error: unknown) => {
        // THE ONLY PATH THAT CAN LOSE MONEY, and until now the only one that
        // logged nothing: the charge succeeded and the write did not, so the
        // rollback puts `payment_provider_ref` back to NULL and leaves the ride
        // `completed` as if nothing happened — while the rider's money sits at
        // Stripe. Rethrown unchanged; this only makes the loss visible.
        this.logWriteFailed(ride, driverId, split.totalCents, charge, error);
        throw error;
      });

    if (!result) {
      // NOT A 409. Because the idempotency key is derived from the ride, the
      // loser's charge and the winner's charge are the SAME PaymentIntent — so
      // answering with the settled ride is both true and the only answer a
      // retrying driver app can use. (The route's success status is `@Post`'s
      // default 201, matching its sibling `complete`.)
      this.logRejected(ride, input, 'lost_race');
      return { ride: await this.readRide(input.rideId) };
    }

    // ── committed ──
    this.transitions.emitStatus(result.moved, 'completed');
    this.logger.log({
      event: 'payment.settlement.settled',
      rideId: ride.id,
      orderId: ride.orderId,
      driverId,
      riderId: ride.riderId,
      actor: input.actor,
      actorId: input.actorId,
      paymentMethod: ride.paymentMethod,
      totalCents: split.totalCents,
      commissionCents: split.commissionCents,
      driverNetCents: split.driverNetCents,
      balanceDeltaCents: result.posted.balanceDeltaCents,
      transactionId: result.posted.transactionId,
      providerRef: charge?.providerRef ?? null,
      at: new Date().toISOString(),
    });

    return { ride: await this.readRide(input.rideId) };
  }

  /**
   * The settled split is READ, never recomputed — #11 wrote these five columns
   * at completion from the offer card the driver actually accepted. Re-parsing
   * through `fareSplitSchema` runs the no-cent-leak refinement one more time, at
   * the last boundary before money moves. Mirrors `toRide`'s reassembly
   * (`rides.repository.ts`).
   */
  private assertSettlable(ride: SettlableRide): {
    driverId: string;
    split: ReturnType<typeof fareSplitSchema.parse>;
  } {
    if (
      ride.driverId === null ||
      ride.totalCents === null ||
      ride.commissionPct === null ||
      ride.commissionSource === null ||
      ride.commissionCents === null ||
      ride.driverNetCents === null
    ) {
      // A data bug, not a case to handle: #11 writes all five in the same
      // transaction as `in_progress → completed` and refuses to complete
      // without an accepted offer split.
      throw new Error(
        `Ride ${ride.id} is completed but is missing a driver or part of the settled split #11 writes. Settling without one would invent a number nobody was shown.`,
      );
    }

    return {
      driverId: ride.driverId,
      split: fareSplitSchema.parse({
        currency: 'EUR',
        totalCents: ride.totalCents,
        commissionPct: ride.commissionPct,
        commissionSource: ride.commissionSource,
        commissionCents: ride.commissionCents,
        driverNetCents: ride.driverNetCents,
      }),
    };
  }

  /**
   * Card rides charge; cash rides do not — the whole reason the branch lives
   * ABOVE the seam. Returns the successful charge, or `null` when none was
   * needed. Every failure throws, so nothing is written.
   */
  private async chargeIfNeeded(
    ride: SettlableRide,
    method: 'cash' | 'card',
    driverId: string,
    totalCents: number,
  ): Promise<{ providerRef: string } | null> {
    if (method === 'cash') return null;

    // Stripe rejects zero-amount intents, and there is nothing to collect.
    if (totalCents === 0) return null;

    if (ride.riderCustomerRef === null || ride.riderInstrumentRef === null) {
      // Honest, and exactly what an unenrolled rider deserves — #17 fills these.
      throw new ConflictException('payment_instrument_missing');
    }

    const charge = await this.payments.charge({
      idempotencyKey: settlementIdempotencyKey(ride.id),
      amountCents: totalCents,
      currency: 'EUR',
      customerRef: ride.riderCustomerRef,
      instrumentRef: ride.riderInstrumentRef,
      rideId: ride.id,
    });

    if (charge.ok) return { providerRef: charge.providerRef };

    this.logChargeFailed(ride, driverId, totalCents, charge);
    // Coarse on purpose — a client can only retry or not. The LOG is where the
    // difference survives; see `logChargeFailed`.
    throw charge.reason === 'declined'
      ? new HttpException('payment_declined', HttpStatus.PAYMENT_REQUIRED)
      : new HttpException('payment_provider_error', HttpStatus.BAD_GATEWAY);
  }

  /**
   * CARRIES `message` AND `providerRef` VERBATIM, not just `reason`.
   *
   * The HTTP code is deliberately coarse — two values — so this log is the ONLY
   * place the difference between "the issuer declined this card" and
   * "`requires_action`: the rider must re-authenticate in-app (#17)" survives.
   * Both answer 402, and a dispatcher on the phone to a driver needs to tell
   * them apart. The rider's `customerRef`/`instrumentRef` are never logged.
   */
  private logChargeFailed(
    ride: SettlableRide,
    driverId: string,
    amountCents: number,
    charge: Extract<PaymentChargeResult, { ok: false }>,
  ): void {
    this.logger.warn({
      event: 'payment.settlement.charge_failed',
      rideId: ride.id,
      driverId,
      riderId: ride.riderId,
      paymentMethod: ride.paymentMethod,
      amountCents,
      reason: charge.reason,
      message: charge.message,
      providerRef: charge.providerRef,
      at: new Date().toISOString(),
    });
  }

  /**
   * THE ONE LOG LINE THAT NAMES A RIDE AND ITS PAYMENTINTENT TOGETHER.
   *
   * `charge_failed` cannot cover this case — the charge SUCCEEDED — and
   * `settled` never runs, so before this existed the money-losing path was the
   * only one in the slice that emitted no `payment.settlement.*` event at all.
   * The barrel's reconciliation query surfaces the stuck ride either way, but
   * without `providerRef` here it cannot tell "never charged" from "charged,
   * then rolled back" without opening the Stripe dashboard.
   *
   * `providerRef` is null on a cash ride, where the same rollback costs nothing.
   * The line still fires: a settlement that failed to write is worth seeing
   * either way, and a null ref is itself the signal that no money is stranded.
   */
  private logWriteFailed(
    ride: SettlableRide,
    driverId: string,
    totalCents: number,
    charge: { providerRef: string } | null,
    error: unknown,
  ): void {
    this.logger.error({
      event: 'payment.settlement.write_failed',
      rideId: ride.id,
      orderId: ride.orderId,
      driverId,
      riderId: ride.riderId,
      paymentMethod: ride.paymentMethod,
      totalCents,
      providerRef: charge?.providerRef ?? null,
      message: error instanceof Error ? error.message : String(error),
      at: new Date().toISOString(),
    });
  }

  private logRejected(
    ride: SettlableRide,
    input: SettleInput,
    cause: 'already_settled' | 'lost_race',
  ): void {
    this.logger.debug({
      event: 'payment.settlement.rejected',
      rideId: ride.id,
      orderId: ride.orderId,
      driverId: ride.driverId,
      actor: input.actor,
      actorId: input.actorId,
      cause,
      at: new Date().toISOString(),
    });
  }

  /** Mirrors `RideLifecycleService.readRide`, including its loud missing-quote `Error`. */
  private async readRide(rideId: string): Promise<Ride> {
    const found = await this.rides.findWithQuote(rideId);
    if (!found) {
      throw new Error(
        `Ride ${rideId} has no persisted quote. Every ride is quoted before it is inserted, so this is a data bug, not a missing ride.`,
      );
    }
    assertRideSplitConsistent(found.ride);
    return found.ride;
  }
}
