import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Db } from '@taxi/db';
import type { RideStatus } from '@taxi/shared';
import { APP_ENV, type Env } from '../../common/config/env.schema';
import { DRIZZLE } from '../../common/db/db.module';
import { DriversService } from '../drivers';
import { PlatformConfigService } from '../platform-config';
import {
  RideLifecycleService,
  RidesRepository,
  RideTransitionService,
} from '../rides';
import { DispatchNotifier } from './dispatch-notifier';
import { DispatchRepository } from './dispatch.repository';
import { buildOffer } from './offer-builder';

/**
 * Dina's override (S9-2) — a privileged dispatcher command, not a strategy,
 * which is why it lives beside the cascade rather than inside it.
 */
@Injectable()
export class ForceAssignService {
  private readonly logger = new Logger(ForceAssignService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly offers: DispatchRepository,
    private readonly rides: RidesRepository,
    private readonly transitions: RideTransitionService,
    private readonly lifecycle: RideLifecycleService,
    private readonly config: PlatformConfigService,
    private readonly drivers: DriversService,
    private readonly notifier: DispatchNotifier,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

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
    this.notifier.emitAssigned(
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
}
