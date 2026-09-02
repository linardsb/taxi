import {
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  trackingTokenSchema,
  trackingViewSchema,
  type ApiErrorBody,
  type LatLng,
  type MapsProvider,
  type RideStatus,
  type TrackingView,
} from '@taxi/shared';
import { randomBytes } from 'node:crypto';
import { APP_ENV, type Env } from '../../../common/config/env.schema';
import { KV_STORE, type KeyValueStore } from '../../../common/kv/kv.store';
import { DRIVER_LOCATION_STORE, type DriverLocationStore } from '../../drivers';
import { MAPS_PROVIDER_ETA } from '../../geo';
import { PlatformConfigService } from '../../platform-config';
import {
  TRACKING_STATE_BY_STATUS,
  TRACKING_TERMINAL_GRACE_SECONDS,
  TRACKING_VIEW_MAX_PER_WINDOW,
  TRACKING_VIEW_WINDOW_SECONDS,
  estimateEtaMinutes,
  etaMinutesFromRoute,
  quantizeForEtaCache,
  trackingViewRateKey,
} from '../notifications.policy';
import {
  NotificationsRepository,
  type NotifiableRide,
} from '../notifications.repository';
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
    @Inject(MAPS_PROVIDER_ETA) private readonly maps: MapsProvider,
    @Inject(KV_STORE) private readonly kv: KeyValueStore,
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

    // Between the shape check and the read, deliberately. Shape-first means
    // arbitrary junk cannot mint unbounded Redis keys; before-the-read means a
    // throttled request costs no database round trip and no paid route call.
    await this.assertWithinRateLimit(token);

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
          etaMinutes = await this.roadEta(ride, recorded.location, target);
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

  /**
   * Road ETA through the maps seam. The ORIGIN is quantized to the ~100 m grid
   * (policy) so the page's 5 s poll lands on the route cache: a paid call
   * happens when the driver crosses a cell, not once per poll.
   *
   * Quantization alone never bounded hostile polling, and #94 split that job
   * three ways: the SEAM owns the timeout and the negative cache (which is on
   * for this `eta` caller and deliberately off for pricing), and the PAGE owns
   * the token-scoped throttle in `view()`. IN-FLIGHT COALESCING REMAINS OPEN —
   * requests arriving before the first `setWithTtl` lands all miss and all
   * reach the source. The throttle BOUNDS that path; nothing here closes it.
   * Deferred to #134.
   *
   * The displayed position stays raw; only the route origin is snapped.
   *
   * A maps outage degrades to the straight-line estimate rather than costing
   * the rider their page — an ETA that is 30% off beats a 500 at the kerb.
   *
   * The provider's error DETAIL deliberately does not appear here.
   * `geo.maps.route_failed` owns it, keyed by `cell` and correlated by time,
   * because a provider message could echo coordinates into a line
   * `logging-standard.md:14` forbids — and no key-set assertion can catch a
   * coordinate hiding inside a free-text field.
   */
  private async roadEta(
    ride: NotifiableRide,
    from: LatLng,
    target: LatLng,
  ): Promise<number> {
    try {
      const route = await this.maps.route(quantizeForEtaCache(from), target);
      return etaMinutesFromRoute(route);
    } catch {
      // No coordinates in the payload, and no FREE TEXT either: the logging
      // standard forbids anything finer than a geozone name, this page is the
      // no-login one, and a provider message is the one field a coordinate
      // could ride in on unnoticed.
      this.logger.warn({
        event: 'ride.notifications.track_eta_failed',
        rideId: ride.id,
        driverId: ride.driverId,
        at: new Date().toISOString(),
      });
      // Raw, not quantized: there is no cache in this path, so the accuracy
      // costs nothing.
      return estimateEtaMinutes(from, target);
    }
  }

  /**
   * Spent before the database read, so a throttled request costs neither a
   * query nor a paid Routes call. INCR-then-check like the rides slice: a
   * GET-then-INCR would let a burst all read the same count and every one of
   * them through.
   */
  private async assertWithinRateLimit(token: string): Promise<void> {
    const key = trackingViewRateKey(token);
    const attempts = await this.kv.incrWithTtl(
      key,
      TRACKING_VIEW_WINDOW_SECONDS,
    );
    if (attempts <= TRACKING_VIEW_MAX_PER_WINDOW) return;

    // The key can expire between the INCR and this read, and a
    // retryAfterSeconds of 0 would read as "retry now" on a rejection.
    const retryAfterSeconds = Math.max(1, await this.kv.ttl(key));
    this.logger.warn({
      event: 'ride.notifications.track_view_throttled',
      tokenPrefix: token.slice(0, 4),
      attempts,
      at: new Date().toISOString(),
    });
    throw new HttpException(
      {
        message: 'too_many_requests',
        retryAfterSeconds,
      } satisfies ApiErrorBody,
      HttpStatus.TOO_MANY_REQUESTS,
    );
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
