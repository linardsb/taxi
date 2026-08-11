import {
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  trackingTokenSchema,
  trackingViewSchema,
  type RideStatus,
  type TrackingView,
} from '@taxi/shared';
import { randomBytes } from 'node:crypto';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { DRIVER_LOCATION_STORE, type DriverLocationStore } from '../../drivers';
import { PlatformConfigService } from '../../platform-config';
import {
  TRACKING_STATE_BY_STATUS,
  TRACKING_TERMINAL_GRACE_SECONDS,
  estimateEtaMinutes,
} from '../notifications.policy';
import { NotificationsRepository } from '../notifications.repository';
import { driverFirstName } from '../sms-templates';

/**
 * Minted at ride creation, one per ride, share-trip (#17) reuses it.
 * 16 random bytes → 22 base64url chars — unguessable, and shape-pinned by
 * `trackingTokenSchema`. Lives HERE and not in @taxi/shared because shared is
 * isomorphic and must not touch `node:crypto`.
 */
export function mintTrackingToken(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * The `GET /track/:token` read model: everything the no-login page shows,
 * nothing else — no rider PII by construction (`trackingViewSchema` has no
 * field to leak it through).
 */
@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly platformConfig: PlatformConfigService,
    @Inject(DRIVER_LOCATION_STORE)
    private readonly locations: DriverLocationStore,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  async view(token: string): Promise<TrackingView> {
    // A malformed token is indistinguishable from an unknown one on purpose —
    // the page shows "not found" either way, and the shape check keeps
    // arbitrary strings out of the SQL below.
    if (!trackingTokenSchema.safeParse(token).success) {
      this.denied(token, 'unknown');
      throw new NotFoundException('tracking_token_unknown');
    }

    const ride = await this.repository.rideByToken(token);
    if (!ride) {
      this.denied(token, 'unknown');
      throw new NotFoundException('tracking_token_unknown');
    }

    // PAGE-terminal, not machine-terminal: `completed` still has `→ settled`
    // ahead of it, but the page is done either way — gating on isTerminal()
    // kept a completed-but-never-settled ride's link alive forever.
    const state = TRACKING_STATE_BY_STATUS[ride.status];
    if (
      (state === 'completed' || state === 'cancelled') &&
      Date.now() - ride.updatedAt.getTime() >
        TRACKING_TERMINAL_GRACE_SECONDS * 1000
    ) {
      this.denied(token, 'expired');
      throw new GoneException('tracking_link_expired');
    }

    let driverName: string | null = null;
    let driverPhotoUrl: string | null = null;
    let vehiclePlate: string | null = null;
    let position: { lat: number; lng: number; at: string } | null = null;
    let etaMinutes: number | null = null;

    if (ride.driverId) {
      const card = await this.repository.driverCard(
        ride.driverId,
        ride.vehicleId,
      );
      driverName = card.name === null ? null : driverFirstName(card.name);
      driverPhotoUrl = card.photoUrl;
      vehiclePlate = card.plate;

      // Position and ETA only while a driver is actively committed — a
      // completed ride's page is a receipt, not a surveillance feed.
      if (
        (ACTIVE_DRIVER_RIDE_STATUSES as readonly RideStatus[]).includes(
          ride.status,
        )
      ) {
        const recorded = await this.locations.positionOf(
          this.env.DEFAULT_CITY_ID,
          ride.driverId,
        );
        if (recorded) {
          position = {
            lat: recorded.location.lat,
            lng: recorded.location.lng,
            at: new Date(recorded.atMs).toISOString(),
          };
          // To the pickup until the ride starts, to the destination after —
          // the passenger is IN the car by then, watching the remaining leg.
          const target =
            ride.status === 'in_progress'
              ? ride.request.destination.location
              : ride.request.pickup.location;
          etaMinutes = estimateEtaMinutes(recorded.location, target);
        }
      }
    }

    const config = await this.platformConfig.forCity(this.env.DEFAULT_CITY_ID);

    // Parsed through the wire schema so a `Date` can never leak onto the
    // wire — the same discipline as RT_EVENT_SCHEMAS.
    return trackingViewSchema.parse({
      state,
      driverName,
      driverPhotoUrl,
      vehiclePlate,
      position,
      etaMinutes,
      dispatchPhone: config.dispatchPhone,
      updatedAt: ride.updatedAt.toISOString(),
    });
  }

  private denied(token: string, reason: 'unknown' | 'expired'): void {
    // First 4 chars only: enough to correlate with a complaint, useless to
    // open the page.
    this.logger.warn({
      event: 'ride.notifications.track_view_denied',
      tokenPrefix: token.slice(0, 4),
      reason,
      at: new Date().toISOString(),
    });
  }
}
