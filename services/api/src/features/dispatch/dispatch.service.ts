import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Db } from '@taxi/db';
import { RT, type RideStatus } from '@taxi/shared';
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
import { DispatchNotifier } from './dispatch-notifier';
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
    private readonly notifier: DispatchNotifier,
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
    const pooledSince = await this.offers.findLastReleasedAt(ride.id);
    const attempts = await this.offers.countAttempts(ride.id, pooledSince);

    // Bounds a ride that would otherwise cycle candidates forever while the
    // rider watches nothing happen. Counted since the ride last entered the
    // pool, so a dispatcher release hands the cascade a fresh budget.
    if (attempts >= MAX_OFFER_ATTEMPTS) {
      await this.raiseUnclaimed(ride, attempts, pooledSince);
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
    // One LIVE card per driver across all rides (#61 chain B) — a driver already
    // deciding on one offer must not be holding a second. A skip is a wait, not
    // a ban: the card resolves within `offerTimeoutSeconds` and the next tick
    // re-reads the world.
    const busy = new Set(await this.offers.findDriverIdsWithLiveOffers());
    const candidate = candidates.find(
      (c) => !tried.has(c.driverId) && !busy.has(c.driverId),
    );

    if (!candidate) {
      await this.raiseUnclaimed(ride, attempts, pooledSince);
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
    this.notifier.emitOffer(offer);

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
    this.notifier.emitAssigned(
      ride,
      driverId,
      source,
      null,
      revoked,
      'offered',
    );
    // The claim is conditional on `status = 'online'`, so a driver who dropped
    // offline mid-offer accepts without ever being marked `on_ride` — ordinary
    // since #61: `setOnlineIfEligible` reads the rides table, so they stay
    // offline until the ride ends. What this warn still catches is the ms seam
    // where a force-assign lands between `offerNext`'s busy-set read and its
    // insert; see the dispatch KNOWN GAPS. `driverStatus` is what tells the two
    // apart in the log: `offline` is the benign disconnect, `on_ride` is the
    // seam.
    if (!claimed) {
      const [driver] = await this.drivers.findMatchAttributes([driverId]);
      this.logger.warn({
        event: 'dispatch.assign.driver_not_claimed',
        rideId: ride.id,
        driverId,
        driverStatus: driver?.status ?? null,
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
   * Dina's flash alert for an order nobody has taken (S9-4).
   *
   * DEDUPED FIRST. At one tick per second an un-deduped alert would flash her
   * board 60 times a minute for a single stale order — the opposite of the
   * signal it exists to be. `incrWithTtl` is the same atomic-first-writer trick
   * the auth and rides rate limits use; a GET-then-SET would let two ticks both
   * alert. Both callers route through here, so the dedupe covers both.
   *
   * `pooledSince` is when the ride last entered the pool. It is the ride's
   * `created_at` for an ordinary booking and the release timestamp for one Dina
   * has taken a car off (#19) — the number Dina reads is "how long has this
   * ride had no car", and after a release the booking time answers a different
   * question and always a larger one (#120 review M3).
   */
  async raiseUnclaimed(
    ride: AwaitingRide,
    attempts: number,
    pooledSince: Date | null = null,
  ): Promise<void> {
    const first = await this.kv.incrWithTtl(
      unclaimedAlertKey(ride.id),
      UNCLAIMED_ALERT_DEDUPE_SECONDS,
    );
    if (first !== 1) return;

    const unclaimedSeconds = Math.max(
      0,
      Math.round(
        (Date.now() - (pooledSince ?? ride.createdAt).getTime()) / 1000,
      ),
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
