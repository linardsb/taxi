import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import {
  RT,
  type AssignmentSource,
  type RideOffer,
  type RideStatus,
} from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DRIZZLE } from '../../common/db/db.module';
import { KV_STORE, type KeyValueStore } from '../../common/kv/kv.store';
import { DriversService } from '../drivers';
import { GeozonesService } from '../geozones';
import { PlatformConfigService } from '../platform-config';
import { RealtimeService } from '../realtime';
import {
  RideLifecycleService,
  RidesRepository,
  RideTransitionService,
  type AwaitingRide,
  type TransitionedRide,
} from '../rides';
import { DispatchRepository } from './dispatch.repository';
import {
  MAX_OFFER_ATTEMPTS,
  UNCLAIMED_ALERT_DEDUPE_SECONDS,
  unclaimedAlertKey,
} from './dispatch.policy';
import { buildOffer } from './offer-builder';
import {
  DISPATCH_QUEUE_STORE,
  type DispatchQueueStore,
} from './queue/dispatch-queue.store';
import { DispatchStrategyResolver } from './strategies/dispatch-strategy.resolver';

/** What a revoked sibling offer needs for its `ride:offer_revoked`. */
type RevokedRef = { offerId: string; driverId: string };

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly offers: DispatchRepository,
    private readonly rides: RidesRepository,
    private readonly transitions: RideTransitionService,
    private readonly lifecycle: RideLifecycleService,
    private readonly geozones: GeozonesService,
    private readonly config: PlatformConfigService,
    private readonly resolver: DispatchStrategyResolver,
    private readonly drivers: DriversService,
    private readonly realtime: RealtimeService,
    @Inject(DISPATCH_QUEUE_STORE) private readonly queue: DispatchQueueStore,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /**
   * Offers a ride to the best candidate who has not been tried yet.
   *
   * Leaves the ride at `requested` when there is nobody to offer it to — that
   * is what makes the next tick retry, and what hands it to Dina.
   */
  async offerNext(ride: AwaitingRide): Promise<void> {
    const cityId = this.env.DEFAULT_CITY_ID;
    const attempts = await this.offers.countAttempts(ride.id);

    // Bounds a ride that would otherwise cycle candidates forever while the
    // rider watches nothing happen.
    if (attempts >= MAX_OFFER_ATTEMPTS) {
      await this.raiseUnclaimed(ride, attempts);
      return;
    }

    const found = await this.rides.findWithQuote(ride.id);
    if (!found) {
      // Not dispatchable: a ride with no quote has no fare to put on a card.
      this.logger.warn({
        event: 'dispatch.offer.skipped_unquoted',
        rideId: ride.id,
        at: new Date().toISOString(),
      });
      return;
    }

    const zone = await this.geozones.resolveForPoint(
      cityId,
      ride.request.pickup.location,
    );
    // Stamped once, from null — it drives queue mode and Dina's district stats.
    if (zone && ride.geozoneId === null) {
      await this.rides.setGeozone(ride.id, zone.id);
    }

    const config = await this.config.forCity(cityId);
    const strategy = this.resolver.forZone(zone, config);

    const candidates = await strategy.findCandidates(found.ride.request, {
      geozoneId: zone?.id ?? null,
      cityId,
      driverDebtLimitCents: config.driverDebtLimitCents,
    });

    // One shot per driver per ride, or the cascade would re-offer to whoever
    // just declined.
    const tried = new Set(await this.offers.findTriedDriverIds(ride.id));
    const candidate = candidates.find((c) => !tried.has(c.driverId));

    if (!candidate) {
      await this.raiseUnclaimed(ride, attempts);
      return;
    }

    const [driverAttrs] = await this.drivers.findMatchAttributes([
      candidate.driverId,
    ]);
    if (!driverAttrs) return; // vanished between the strategy's read and here

    const offer = buildOffer({
      rideId: ride.id,
      request: found.ride.request,
      quote: found.quote,
      candidate,
      driverAttrs,
      config,
      source: strategy.mode,
      status: 'pending',
    });

    // The offer row and the status change commit together: a `pending` offer on
    // a ride still at `requested` would be re-offered by the very next tick.
    const transitioned = await this.db.transaction(async (tx) => {
      const steps: RideStatus[] =
        strategy.mode === 'geozone_queue'
          ? ['queued', 'offered'] // `requested → accepted` is illegal; so is `requested → offered` skipping the rank
          : ['offered'];

      let from: RideStatus = 'requested';
      let moved: TransitionedRide | undefined;
      for (const to of steps) {
        moved = await this.transitions.transitionInTx(tx, ride.id, from, to);
        if (!moved) return undefined; // someone else moved this ride
        from = to;
      }

      await this.offers.insertOffer(offer, tx);
      return moved;
    });

    if (!transitioned) return; // lost the race; the next tick re-reads the world

    // ── committed ──
    this.transitions.emitStatus(transitioned, 'requested');
    this.emitOffer(offer);

    this.logger.log({
      event: 'dispatch.offer.sent',
      rideId: ride.id,
      driverId: offer.driverId,
      offerId: offer.id,
      mode: strategy.mode,
      geozone: zone?.slug ?? null, // slug, never coordinates
      etaSeconds: offer.etaSeconds,
      queuePosition: offer.queuePosition ?? null,
      attempt: attempts + 1,
      at: new Date().toISOString(),
    });
  }

  /**
   * A driver takes the ride. ONE transaction, then the emits.
   *
   * Every conditional write lives inside the callback and every emit after the
   * commit: Socket.IO has no rollback, so a `ride:assigned` that reaches the
   * driver's phone and is then rolled back is strictly worse than the 409 it
   * replaced.
   */
  async accept(driverId: string, offerId: string): Promise<{ rideId: string }> {
    const { ride, revoked, source, claimed } = await this.db.transaction(
      async (tx) => {
        const offer = await this.offers.acceptOffer(offerId, driverId, tx);
        if (!offer) throw new ConflictException('offer_not_pending');

        // From the ROW, never the request: the route is /offers/:offerId/accept
        // and carries no ride id — taking it from anywhere else would let a
        // driver accept one offer onto a different ride.
        const rideId = offer.rideId;

        const moved = await this.transitions.transitionInTx(
          tx,
          rideId,
          'offered',
          'accepted',
        );
        if (!moved) throw new ConflictException('ride_not_offered');

        if (!(await this.rides.assignDriver(rideId, driverId, tx))) {
          throw new ConflictException('ride_already_assigned');
        }

        // `online → on_ride`, or `candidate-filter.ts` keeps this driver in the
        // pool and the next tick offers them a SECOND car. `false` is still not
        // an error — see `RideLifecycleService.claimDriver` — but unlike
        // force-assign, nobody chose it here, so it is worth a line in the log.
        const claimed = await this.lifecycle.claimDriver(tx, driverId);

        await this.offers.insertAudit(
          { rideId, driverId, source: offer.source },
          tx,
        );

        const revoked = await this.offers.revokePendingForRide(
          rideId,
          offerId,
          tx,
        );

        return { ride: moved, revoked, source: offer.source, claimed };
      },
    );

    // ── committed ──
    this.emitAssigned(ride, driverId, source, null, revoked, 'offered');
    // The claim is conditional on `status = 'online'`, so a driver who dropped
    // offline mid-offer accepts without ever being marked `on_ride` — and the
    // `driver_on_ride` presence guard then cannot stop them going `online`
    // again. Narrowed by this PR, not closed; see the dispatch KNOWN GAPS.
    if (!claimed) {
      this.logger.warn({
        event: 'dispatch.assign.driver_not_claimed',
        rideId: ride.id,
        driverId,
        offerId,
        at: new Date().toISOString(),
      });
    }
    return { rideId: ride.id };
  }

  /**
   * A driver passes. The ride goes back to `requested` and the next tick offers
   * it to somebody else.
   *
   * NO `ride:offer_revoked` to the decliner: the event's three reasons are
   * `expired | taken | cancelled` and none of them describes "you declined this
   * yourself" — `cancelled` would read on #15 and Dina's board as the RIDER
   * cancelling. The event exists to clear a card the driver did not act on; a
   * decliner's card clears from their own HTTP response.
   */
  async decline(driverId: string, offerId: string): Promise<void> {
    const offer = await this.offers.declineOffer(offerId, driverId);
    if (!offer) throw new ConflictException('offer_not_pending');

    // RETURN THE RIDE TO THE POOL FIRST. Everything after this is bookkeeping,
    // and anything that throws between the offer flip and this transition would
    // strand the ride at `offered` with no pending offer — invisible to
    // `dispatchAwaitingRides`, which filters on `requested`, so the cascade
    // would die silently and the rider would wait forever.
    // Single statement, nothing else in flight — the convenience form is safe.
    await this.transitions.transition(offer.rideId, 'offered', 'requested');

    // A decline costs the driver their place in the rank — but only in the zone
    // this ride was actually dispatched from. Guarded: losing a queue demotion
    // is a fairness blemish, while letting it fail the request would re-offer
    // the ride to the driver who just declined it.
    if (offer.source === 'geozone_queue') {
      try {
        const geozoneId = await this.rides.findGeozoneId(offer.rideId);
        if (geozoneId) await this.queue.sendToBack(geozoneId, driverId);
      } catch (error) {
        this.logger.warn({
          event: 'dispatch.queue.demote_failed',
          rideId: offer.rideId,
          driverId,
          reason: error instanceof Error ? error.message : 'unknown',
          at: new Date().toISOString(),
        });
      }
    }

    this.logger.log({
      event: 'dispatch.offer.declined',
      rideId: offer.rideId,
      driverId,
      offerId: offer.id,
      at: new Date().toISOString(),
    });
  }

  /**
   * Dina puts a specific car on a specific ride (S9-2).
   *
   * `requested → accepted` is not a legal transition, so the override writes an
   * already-accepted offer row and walks the ride `requested → offered →
   * accepted`. Two upsides fall out for free: the audit trail records what the
   * dispatcher put in front of the driver, and #15's driver app receives the
   * same `ride:assigned` it would from a normal accept — no client special case.
   */
  async forceAssign(input: {
    dispatcherId: string;
    rideId: string;
    driverId: string;
    reason?: string | null;
  }): Promise<{ rideId: string }> {
    const found = await this.rides.findWithQuote(input.rideId);
    if (!found) throw new NotFoundException('ride_not_found');

    const cityId = this.env.DEFAULT_CITY_ID;
    const config = await this.config.forCity(cityId);

    const [driverAttrs] = await this.drivers.findMatchAttributes([
      input.driverId,
    ]);
    if (!driverAttrs) throw new NotFoundException('driver_not_found');

    // Deliberately NOT filtered through the eligibility rules: overriding the
    // algorithm — including onto an offline or otherwise ineligible driver — is
    // the feature, not a hole in it. The audit row is what makes that safe.
    const offer = buildOffer({
      rideId: input.rideId,
      request: found.ride.request,
      quote: found.quote,
      candidate: {
        driverId: input.driverId,
        // `DriverCandidate.location` is not carried onto the offer; the pickup
        // stands in for a proximity read this path deliberately does not make.
        location: found.ride.request.pickup.location,
        status: driverAttrs.status,
        etaSeconds: 0, // a dispatcher already decided; there is no ETA to rank
      },
      driverAttrs,
      config,
      source: 'dispatcher',
      status: 'accepted',
    });

    const { ride, revoked, from } = await this.db.transaction(async (tx) => {
      // `requested → accepted` is not a legal transition, so a ride still in
      // the pool has to be walked through `offered` first. MID-CASCADE it is
      // already there — a driver is holding a live offer — and that first hop
      // correctly matches nothing. Both are ordinary states for an override, so
      // an unmatched hop here is not yet a conflict.
      const hopped = await this.transitions.transitionInTx(
        tx,
        input.rideId,
        'requested',
        'offered',
      );
      const from: RideStatus = hopped ? 'requested' : 'offered';

      // THIS is the guard. Conditional on `status = 'offered'`, so a ride that
      // was never assignable — already accepted, cancelled, or gone — fails
      // here rather than being forced.
      const accepted = await this.transitions.transitionInTx(
        tx,
        input.rideId,
        'offered',
        'accepted',
      );
      if (!accepted) throw new ConflictException('ride_not_assignable');

      await this.offers.insertOffer(offer, tx);

      if (!(await this.rides.assignDriver(input.rideId, input.driverId, tx))) {
        throw new ConflictException('ride_already_assigned');
      }

      // `false` here is the ORDINARY outcome for a driver Dina overrode onto
      // the ride while offline — the override is "deliberately NOT filtered
      // through the eligibility rules", so throwing would break S9-2. They stay
      // offline for the whole ride and the release correctly does nothing.
      await this.lifecycle.claimDriver(tx, input.driverId);

      await this.offers.insertAudit(
        {
          rideId: input.rideId,
          driverId: input.driverId,
          source: 'dispatcher',
          dispatcherId: input.dispatcherId,
          reason: input.reason ?? null,
        },
        tx,
      );

      const revoked = await this.offers.revokePendingForRide(
        input.rideId,
        offer.id,
        tx,
      );

      return { ride: accepted, revoked, from };
    });

    // ── committed ──
    this.emitAssigned(
      ride,
      input.driverId,
      'dispatcher',
      input.dispatcherId,
      revoked,
      from,
    );

    this.logger.log({
      event: 'dispatch.assign.forced',
      rideId: input.rideId,
      driverId: input.driverId,
      dispatcherId: input.dispatcherId,
      revokedOffers: revoked.length,
      at: new Date().toISOString(),
    });

    return { rideId: ride.id };
  }

  /**
   * Dina's flash alert for an order nobody has taken (S9-4).
   *
   * DEDUPED FIRST. At one tick per second an un-deduped alert would flash her
   * board 60 times a minute for a single stale order — the opposite of the
   * signal it exists to be. `incrWithTtl` is the same atomic-first-writer trick
   * the auth and rides rate limits use; a GET-then-SET would let two ticks both
   * alert. Both callers route through here, so the dedupe covers both.
   */
  async raiseUnclaimed(ride: AwaitingRide, attempts: number): Promise<void> {
    const first = await this.kv.incrWithTtl(
      unclaimedAlertKey(ride.id),
      UNCLAIMED_ALERT_DEDUPE_SECONDS,
    );
    if (first !== 1) return;

    const unclaimedSeconds = Math.max(
      0,
      Math.round((Date.now() - ride.createdAt.getTime()) / 1000),
    );

    try {
      this.realtime.emitToDispatch(
        this.env.DEFAULT_CITY_ID,
        RT.dispatchUnclaimed,
        {
          rideId: ride.id,
          // The pickup POINT legitimately travels to Dina's board — the
          // no-coordinates rule is about logs, not about the console that
          // exists to show her where the car is needed.
          pickup: ride.request.pickup,
          requestedAt: ride.createdAt.toISOString(),
          unclaimedSeconds,
          offerAttempts: attempts,
        },
      );
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.unclaimed.notify_failed',
        rideId: ride.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }

    this.logger.warn({
      event: 'dispatch.ride.unclaimed',
      rideId: ride.id,
      offerAttempts: attempts,
      unclaimedSeconds,
      at: new Date().toISOString(),
    });
  }

  /** `rideOfferEventSchema` wants ISO strings where the domain holds `Date`s. */
  private emitOffer(offer: RideOffer): void {
    try {
      this.realtime.emitToDriver(offer.driverId, RT.rideOffer, {
        ...offer,
        sentAt: offer.sentAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
      });
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.offer.notify_failed',
        rideId: offer.rideId,
        offerId: offer.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * The shared post-commit emit tail for both assignment paths. Never throws:
   * the ride is already committed, and a lost event costs the live update.
   */
  private emitAssigned(
    ride: TransitionedRide,
    driverId: string,
    source: AssignmentSource,
    dispatcherId: string | null,
    revoked: RevokedRef[],
    previousStatus: RideStatus,
  ): void {
    const at = new Date().toISOString();
    try {
      // JOIN BEFORE ANY EMIT, or the newly assigned driver's own sockets miss
      // the first event — they are not in the ride room until this runs, and
      // `ride:status` goes to that room. Same rule as `RidesService.notifyRider`
      // ("Join BEFORE emitting"). Ordering this after `emitStatus` cost the
      // driver their `accepted` status event, which a test caught.
      this.realtime.joinRideRoom(driverId, ride.id);
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.assign.join_failed',
        rideId: ride.id,
        driverId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }

    this.transitions.emitStatus(ride, previousStatus);

    try {
      this.realtime.emitToRide(ride.id, RT.rideAssigned, {
        rideId: ride.id,
        driverId,
        source,
        dispatcherId,
        at,
      });

      // The only consumer of `revokePendingForRide`'s returned pairs: a driver
      // holding a live offer that someone else took — or that Dina overrode —
      // must see their card clear.
      for (const other of revoked) {
        this.realtime.emitToDriver(other.driverId, RT.rideOfferRevoked, {
          offerId: other.offerId,
          rideId: ride.id,
          reason: 'taken',
          at,
        });
      }
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.assign.notify_failed',
        rideId: ride.id,
        driverId,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }
  }

  /**
   * Expires one overdue offer and hands the ride back to the cascade. Called by
   * the sweeper, which owns the batching.
   */
  async expireOffer(offer: {
    id: string;
    rideId: string;
    driverId: string;
  }): Promise<void> {
    const expired = await this.offers.expireOffer(offer.id);
    if (!expired) return; // accepted or declined between the read and here

    const at = new Date().toISOString();
    try {
      this.realtime.emitToDriver(offer.driverId, RT.rideOfferRevoked, {
        offerId: offer.id,
        rideId: offer.rideId,
        reason: 'expired',
        at,
      });
    } catch (error) {
      this.logger.warn({
        event: 'dispatch.offer.notify_failed',
        rideId: offer.rideId,
        offerId: offer.id,
        reason: error instanceof Error ? error.message : 'unknown',
        at,
      });
    }

    await this.transitions.transition(offer.rideId, 'offered', 'requested');

    this.logger.log({
      event: 'dispatch.offer.expired',
      rideId: offer.rideId,
      driverId: offer.driverId,
      offerId: offer.id,
      at,
    });
  }
}
