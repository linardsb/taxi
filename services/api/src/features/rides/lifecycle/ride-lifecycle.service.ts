import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import {
  assertRideSplitConsistent,
  canTransition,
  isPaymentMethodLocked,
  RT,
  type PaymentMethodType,
  type Ride,
  type RideStatus,
} from '@taxi/shared';
import { DRIZZLE, type DbTx } from '../../../common/db/db.module';
import { DriversService } from '../../drivers';
import { RealtimeService } from '../../realtime';
import { RideTransitionService } from '../ride-transition.service';
import { RidesRepository } from '../rides.repository';
import {
  RideLifecycleRepository,
  type LifecycleRide,
} from './ride-lifecycle.repository';
import {
  cancelledStatusFor,
  DRIVER_STEPS,
  type DriverStep,
  type LifecycleActor,
} from './ride-lifecycle.policy';

/** What a revoked offer needs for its `ride:offer_revoked`. */
type RevokedRef = { offerId: string; driverId: string };

/** Anything this slice logs about. Both ride shapes satisfy it structurally. */
type LoggableRide = { id: string; orderId: string; driverId: string | null };

/**
 * The ride from `accepted` onward: the driver's four steps, all four
 * cancellation branches, the payment-method lock, and the settled fare split.
 *
 * Every status write goes through `RideTransitionService` — this slice adds no
 * transition machinery of its own and is not a second caller of
 * `assertTransition`. Client-visible illegality (cancelling a completed ride)
 * is caught FIRST with `canTransition` and answered with a typed 409;
 * `assertTransition` keeps its role as the 500-worthy programming-error guard.
 */
@Injectable()
export class RideLifecycleService {
  private readonly logger = new Logger(RideLifecycleService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly lifecycle: RideLifecycleRepository,
    private readonly rides: RidesRepository,
    private readonly transitions: RideTransitionService,
    private readonly drivers: DriversService,
    private readonly realtime: RealtimeService,
  ) {}

  /**
   * `drivers.status = 'on_ride'`, claimed by the LIFECYCLE and nothing else
   * (`services/api/CLAUDE.md`). Dispatch composes this into its accept and
   * force-assign transactions rather than reaching into the drivers slice, so
   * the status keeps exactly one owner.
   *
   * `false` must NEVER throw. A force-assigned OFFLINE driver is the ordinary
   * case — the override "deliberately is NOT filtered through the eligibility
   * rules" — and refusing it would break S9-2.
   */
  claimDriver(tx: DbTx, driverId: string): Promise<boolean> {
    return this.drivers.claimForRide(driverId, tx);
  }

  /**
   * `accepted → arriving → arrived → in_progress`.
   *
   * The fourth step is `complete()`: it settles money and returns the ride, so
   * it does not fit this method's shape. `Exclude` is what makes that a
   * compiler error rather than a runtime surprise.
   */
  async driverStep(
    step: Exclude<DriverStep, 'complete'>,
    driverId: string,
    rideId: string,
  ): Promise<void> {
    const { from, to } = await this.guardDriverStep(step, driverId, rideId);

    // The convenience form is safe here: genuinely one statement, nothing else
    // in flight. `complete` composes `transitionInTx` instead, because it also
    // writes the split and releases the driver.
    const moved = await this.transitions.transition(rideId, from, to);
    if (!moved) throw new ConflictException('ride_transition_conflict');

    this.logApplied(moved, 'driver', from, to);
  }

  /**
   * `in_progress → completed`, with the SETTLED split written in the same
   * transaction.
   *
   * The split is COPIED from the accepted offer row, never recomputed.
   * `buildOffer` resolves the commission per driver
   * (`driverAttrs.commissionPctOverride`), so an admin edit to that override or
   * to `platform_config.commission_pct` between acceptance and completion would
   * silently change what the driver is paid relative to the card they said yes
   * to — and `assertRideSplitConsistent` could not catch it, because
   * `totalCents` is identical either way. That is the €200→€130 grievance
   * (PRD §1, S2-4/S2-5) reproduced in our own codebase.
   */
  async complete(driverId: string, rideId: string): Promise<{ ride: Ride }> {
    const { ride, from, to } = await this.guardDriverStep(
      'complete',
      driverId,
      rideId,
    );

    // BOTH checks run BEFORE the transaction, so a bad split writes nothing.
    const split = await this.lifecycle.findAcceptedOfferSplit(rideId);
    if (!split) {
      throw new Error(
        `Ride ${rideId} reached completion with no accepted ride_offers row. Both assignment paths write exactly one; inventing a split here would pay a driver a number nobody ever showed them.`,
      );
    }
    if (split.totalCents !== ride.totalCents) {
      throw new Error(
        `Ride ${rideId}: the accepted offer's split.totalCents ${split.totalCents} does not match the ride's totalCents ${String(ride.totalCents)}`,
      );
    }

    const moved = await this.db.transaction(async (tx) => {
      const moved = await this.transitions.transitionInTx(tx, rideId, from, to);
      if (!moved) throw new ConflictException('ride_transition_conflict');

      await this.lifecycle.writeSettledSplit(tx, rideId, split);
      await this.drivers.releaseFromRide(driverId, tx);
      return moved;
    });

    // ── committed ──
    this.transitions.emitStatus(moved, from);
    this.logApplied(moved, 'driver', from, to);
    this.logger.log({
      event: 'ride.lifecycle.settlement_written',
      rideId,
      orderId: moved.orderId,
      driverId,
      totalCents: split.totalCents,
      commissionPct: split.commissionPct,
      commissionSource: split.commissionSource,
      commissionCents: split.commissionCents,
      driverNetCents: split.driverNetCents,
      at: new Date().toISOString(),
    });

    // The driver gets the full fare and the commission line in the response to
    // the tap that ended the ride — the S2-5 wedge as a persisted record.
    return { ride: await this.readRide(rideId) };
  }

  /**
   * All four cancellation branches. The actor decides the terminal status and
   * comes from the JWT role, never a body field.
   */
  async cancel(input: {
    rideId: string;
    actor: LifecycleActor;
    actorId: string;
    reason: string | null;
  }): Promise<void> {
    const ride = await this.lifecycle.findForAction(input.rideId);
    if (!ride) throw new NotFoundException('ride_not_found');

    // A dispatcher (and the system) overrides ownership — that IS the override
    // (S9-2). Rider and driver may only cancel their own ride.
    if (input.actor === 'rider' && ride.riderId !== input.actorId) {
      throw new ForbiddenException('ride_not_yours');
    }
    if (input.actor === 'driver' && ride.driverId !== input.actorId) {
      throw new ForbiddenException('ride_not_yours');
    }

    const from = ride.status;
    const to = cancelledStatusFor(input.actor);
    // Load-bearing here in a way it is not in `driverStep`: `to` varies by
    // actor, so the machine — not a fixed step table — decides legality.
    if (!canTransition(from, to)) {
      this.logRejected(ride, input.actor, to);
      throw new ConflictException('ride_not_cancellable');
    }

    const { moved, revoked } = await this.db.transaction(async (tx) => {
      const moved = await this.transitions.transitionInTx(
        tx,
        input.rideId,
        from,
        to,
      );
      if (!moved) throw new ConflictException('ride_transition_conflict');

      const revoked = await this.lifecycle.revokePendingOffers(
        tx,
        input.rideId,
      );

      // ONE line, five release sites (complete, and a cancel from each of
      // accepted/arriving/arrived/in_progress). `releaseFromRide` is itself
      // conditional on `on_ride`, so a pre-acceptance cancel and a
      // force-assigned offline driver both no-op correctly.
      if (ride.driverId !== null) {
        await this.drivers.releaseFromRide(ride.driverId, tx);
      }

      return { moved, revoked };
    });

    // ── committed ──
    this.transitions.emitStatus(moved, from, input.reason);
    this.emitRevoked(input.rideId, revoked);
    this.logApplied(moved, input.actor, from, to, input.reason);
  }

  /**
   * Atis's hard rule, enforced.
   *
   * WRITE FIRST, then disambiguate. A read-then-write would let a driver's
   * accept land between the two and change the payment method on an accepted
   * ride — the exact violation this route exists to prevent. The single
   * conditional UPDATE is the lock; the second read only produces a good error
   * message, and racing THAT costs a wrong message, never a wrong write.
   */
  async changePaymentMethod(
    rideId: string,
    riderId: string,
    paymentMethod: PaymentMethodType,
  ): Promise<{ ride: Ride }> {
    const at = new Date().toISOString();

    if (
      await this.lifecycle.updatePaymentMethod(rideId, riderId, paymentMethod)
    ) {
      this.logger.log({
        event: 'ride.lifecycle.payment_method_changed',
        rideId,
        riderId,
        paymentMethod,
        at,
      });
      return { ride: await this.readRide(rideId) };
    }

    const ride = await this.lifecycle.findForAction(rideId);
    // Someone else's ride is indistinguishable from no ride, deliberately: a
    // 403 here would confirm the id exists to whoever guessed it.
    const status = ride && ride.riderId === riderId ? ride.status : undefined;

    this.logger.warn({
      event: 'ride.lifecycle.payment_method_rejected',
      rideId,
      riderId,
      from: status ?? null,
      paymentMethod,
      at,
    });

    if (status === undefined) throw new NotFoundException('ride_not_found');
    if (isPaymentMethodLocked(status)) {
      throw new ConflictException('payment_method_locked');
    }
    // A cancelled ride is not LOCKED — it is over, which is a truer 409.
    throw new ConflictException('ride_not_editable');
  }

  /**
   * find → authorize → guard, shared by all four driver steps.
   *
   * The status check is `ride.status !== from` and nothing else: every
   * `DRIVER_STEPS` pair is an edge of `ALLOWED_TRANSITIONS`, so for a FIXED
   * step table a `from` mismatch IS the illegality and a `canTransition` call
   * beside it would be dead logic.
   */
  private async guardDriverStep(
    step: DriverStep,
    driverId: string,
    rideId: string,
  ): Promise<{ ride: LifecycleRide; from: RideStatus; to: RideStatus }> {
    const ride = await this.lifecycle.findForAction(rideId);
    if (!ride) throw new NotFoundException('ride_not_found');
    if (ride.driverId !== driverId) {
      throw new ForbiddenException('ride_not_yours');
    }

    const { from, to } = DRIVER_STEPS[step];
    if (ride.status !== from) {
      this.logRejected(ride, 'driver', to);
      throw new ConflictException(`ride_not_${from}`);
    }

    return { ride, from, to };
  }

  /**
   * The ride with its quote and — after settlement — its split.
   *
   * `findWithQuote` returns `undefined` only for a ride that was never quoted,
   * which cannot happen: a ride is quoted before it is inserted. A loud `Error`
   * naming the invariant beats a `!` or an optional chain that would hand a
   * caller a half-built ride.
   */
  private async readRide(rideId: string): Promise<Ride> {
    const found = await this.rides.findWithQuote(rideId);
    if (!found) {
      throw new Error(
        `Ride ${rideId} has no persisted quote. Every ride is quoted before it is inserted, so this is a data bug, not a missing ride.`,
      );
    }
    // "Call this at write boundaries (#11)" — its own docblock. The parse in
    // `toRide` proves the split sums; only this proves it is a cut of the fare
    // the rider was actually quoted.
    assertRideSplitConsistent(found.ride);
    return found.ride;
  }

  /**
   * Clears the offer card of a driver holding a live offer on a ride that was
   * just cancelled. `reason: 'cancelled'` has existed in the catalog since #2
   * with no producer; this is it — and unlike a decline, here it is accurate.
   *
   * Never throws: the cancellation is already committed and a lost event costs
   * the card, not the ride.
   */
  private emitRevoked(rideId: string, revoked: RevokedRef[]): void {
    const at = new Date().toISOString();
    for (const offer of revoked) {
      try {
        this.realtime.emitToDriver(offer.driverId, RT.rideOfferRevoked, {
          offerId: offer.offerId,
          rideId,
          reason: 'cancelled',
          at,
        });
      } catch (error) {
        this.logger.warn({
          event: 'ride.lifecycle.notify_failed',
          rideId,
          offerId: offer.offerId,
          driverId: offer.driverId,
          reason: error instanceof Error ? error.message : 'unknown',
          at,
        });
      }
    }
  }

  private logApplied(
    ride: LoggableRide,
    actor: LifecycleActor,
    from: RideStatus,
    to: RideStatus,
    reason: string | null = null,
  ): void {
    this.logger.log({
      event: 'ride.lifecycle.transition_applied',
      rideId: ride.id,
      orderId: ride.orderId,
      driverId: ride.driverId,
      actor,
      from,
      to,
      reason,
      at: new Date().toISOString(),
    });
  }

  /**
   * `from` is the ride's ACTUAL status, never the one the step expected —
   * logging the expected one would claim the ride was in the state we wanted it
   * to be in, which is the opposite of useful at 02:00.
   */
  private logRejected(
    ride: LifecycleRide,
    actor: LifecycleActor,
    to: RideStatus,
  ): void {
    this.logger.warn({
      event: 'ride.lifecycle.transition_rejected',
      rideId: ride.id,
      orderId: ride.orderId,
      driverId: ride.driverId,
      actor,
      from: ride.status,
      to,
      at: new Date().toISOString(),
    });
  }
}
