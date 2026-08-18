import { HttpException, HttpStatus } from '@nestjs/common';
import type { MapsProvider, RideRequest } from '@taxi/shared';
import type { Env } from '../../../common/config/env.schema';
import { InMemoryKeyValueStore } from '../../../../test/harness';
import type { DriverLocationStore } from '../../drivers';
import type { PlatformConfigService } from '../../platform-config';
import {
  TRACKING_VIEW_MAX_PER_WINDOW,
  TRACKING_VIEW_WINDOW_SECONDS,
  trackingViewRateKey,
} from '../notifications.policy';
import type {
  NotifiableRide,
  NotificationsRepository,
} from '../notifications.repository';
import { TrackingService } from './tracking.service';

/** 22 base64url chars — what `trackingTokenSchema` accepts. */
const TOKEN = 'aaaaaaaaaaaaaaaaaaaaaa';

const CENTRE = { lat: 56.9496, lng: 24.1052 };

/**
 * `driverId: null` on purpose, and it is the whole trick that keeps these
 * fakes small: it skips `driverCard`, `positionOf` and `maps.route` entirely
 * while still traversing every line of the throttle. What it does NOT get to
 * skip is the WIRE SCHEMA — `view()` ends in `trackingViewSchema.parse`, so
 * `updatedAt` has to be a real `Date` and `dispatchPhone` a real E.164 number.
 */
const ride = (): NotifiableRide => ({
  id: '11111111-1111-4111-8111-111111111111',
  status: 'accepted',
  riderId: '22222222-2222-4222-8222-222222222222',
  driverId: null,
  vehicleId: null,
  bookingChannel: 'app',
  trackingToken: TOKEN,
  request: {
    pickup: { label: 'Centrs', location: CENTRE },
    destination: { label: 'Lidosta', location: { lat: 56.9236, lng: 23.9711 } },
    stops: [],
  } as unknown as RideRequest,
  updatedAt: new Date(),
});

describe('TrackingService — the tracking page throttle', () => {
  const build = () => {
    const kv = new InMemoryKeyValueStore();
    const rideByToken = jest.fn().mockResolvedValue(ride());
    const route = jest.fn();
    const repository = { rideByToken } as unknown as NotificationsRepository;
    const platformConfig = {
      forCity: jest.fn().mockResolvedValue({ dispatchPhone: '+37167000000' }),
    } as unknown as PlatformConfigService;
    const locations = {
      positionOf: jest.fn(),
    } as unknown as DriverLocationStore;
    const maps = {
      route,
      geocode: jest.fn(),
      reverseGeocode: jest.fn(),
      searchAddress: jest.fn(),
      resolvePlace: jest.fn(),
    } as MapsProvider;
    const env = { DEFAULT_CITY_ID: 'city' } as Env;

    return {
      kv,
      rideByToken,
      route,
      service: new TrackingService(
        repository,
        platformConfig,
        locations,
        maps,
        kv,
        env,
      ),
    };
  };

  it('a normal poll sequence is never throttled (expected — AC #1)', async () => {
    // Exactly at the limit, not one below: this is the off-by-one that would
    // 429 the live page for a viewer doing nothing wrong.
    const { rideByToken, service } = build();

    for (let i = 0; i < TRACKING_VIEW_MAX_PER_WINDOW; i += 1) {
      const page = await service.view(TOKEN);
      expect(page.state).toBe('assigned');
    }

    expect(rideByToken).toHaveBeenCalledTimes(TRACKING_VIEW_MAX_PER_WINDOW);
  });

  it('the request past the limit answers 429 with a positive retryAfterSeconds (failure — AC #1)', async () => {
    const { service } = build();
    for (let i = 0; i < TRACKING_VIEW_MAX_PER_WINDOW; i += 1) {
      await service.view(TOKEN);
    }

    const error: unknown = await service.view(TOKEN).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    const rejection = error as HttpException;
    expect(rejection.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    const body = rejection.getResponse() as {
      message: string;
      retryAfterSeconds: number;
    };
    expect(body.message).toBe('too_many_requests');
    // Never 0: the key can expire between the INCR and the TTL read, and
    // "retry in 0 seconds" reads as "retry now" on a rejection.
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('the throttle spends no database read and no paid route call (edge — AC #1)', async () => {
    // THE assertion that makes this a spend control rather than a politeness
    // feature. The throttle sits after the shape check and before the read.
    const { rideByToken, route, service } = build();
    for (let i = 0; i < TRACKING_VIEW_MAX_PER_WINDOW; i += 1) {
      await service.view(TOKEN);
    }
    const reads = rideByToken.mock.calls.length;

    await expect(service.view(TOKEN)).rejects.toThrow(HttpException);

    expect(rideByToken.mock.calls.length).toBe(reads);
    expect(route).not.toHaveBeenCalled();
  });

  it('the window expires and the token is served again (edge)', async () => {
    const { kv, service } = build();
    for (let i = 0; i < TRACKING_VIEW_MAX_PER_WINDOW; i += 1) {
      await service.view(TOKEN);
    }
    await expect(service.view(TOKEN)).rejects.toThrow(HttpException);

    kv.advance(TRACKING_VIEW_WINDOW_SECONDS + 1);

    const page = await service.view(TOKEN);
    expect(page.state).toBe('assigned');
  });

  it('a malformed token is rejected before it can mint a rate key (edge)', async () => {
    // Shape-first ordering, pinned: throttling before validating would let
    // arbitrary junk mint unbounded Redis keys, one per string tried.
    const { kv, rideByToken, service } = build();

    await expect(service.view('not-a-token')).rejects.toThrow(
      'tracking_token_unknown',
    );

    expect(await kv.get(trackingViewRateKey('not-a-token'))).toBeNull();
    expect(rideByToken).not.toHaveBeenCalled();
  });
});
