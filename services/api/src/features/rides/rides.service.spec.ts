import { BadRequestException } from '@nestjs/common';
import {
  RT,
  type FareQuote,
  type FareSplit,
  type Ride,
  type RideRequestBody,
} from '@taxi/shared';
import { InMemoryKeyValueStore } from '../../../test/harness';
import type { PricingService } from '../pricing';
import type { RealtimeService } from '../realtime';
import {
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
} from './rides.policy';
import { RidesService } from './rides.service';
import type { RidesRepository } from './rides.repository';

const RIDER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const RIDE_ID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const CREATED_AT = new Date('2026-08-05T10:00:00.000Z');

const body = {
  pickup: {
    location: { lat: 56.9496, lng: 24.1052 },
    address: 'Brīvības iela 1, Rīga',
  },
  destination: {
    location: { lat: 56.9236, lng: 23.9711 },
    address: 'Lidosta RIX',
  },
  paymentMethod: 'cash',
} as unknown as RideRequestBody;

const quote: FareQuote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 1_300,
  breakdown: {
    baseCents: 200,
    distanceCents: 800,
    timeCents: 300,
    discountCents: 0,
  },
};

const split = {
  currency: 'EUR',
  totalCents: 1_300,
  commissionPct: 15,
  commissionSource: 'platform_base',
  commissionCents: 195,
  driverNetCents: 1_105,
} as FareSplit;

function build(options: { realtimeThrows?: boolean } = {}) {
  /** One shared log, so ORDER is assertable and not just occurrence. */
  const calls: string[] = [];
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];
  let created: { status: string } | undefined;

  const pricing = {
    quote: () => {
      calls.push('pricing.quote');
      return Promise.resolve({ quote, split });
    },
  } as unknown as PricingService;

  const rides = {
    create: (input: { status: string }) => {
      calls.push('rides.create');
      created = input;
      return Promise.resolve({
        id: RIDE_ID,
        orderId: '2b3c4d5e-6f7a-8b9c-0d1e-2f3a4b5c6d7e',
        status: input.status,
        createdAt: CREATED_AT,
      } as unknown as Ride);
    },
  } as unknown as RidesRepository;

  const realtime = {
    joinRideRoom: () => {
      calls.push('joinRideRoom');
      if (options.realtimeThrows) throw new Error('socket server is gone');
    },
    emitToRide: (
      _rideId: string,
      event: string,
      payload: Record<string, unknown>,
    ) => {
      calls.push('emitToRide');
      emitted.push({ event, payload });
    },
  } as unknown as RealtimeService;

  const kv = new InMemoryKeyValueStore();

  return {
    service: new RidesService(pricing, rides, realtime, kv),
    calls,
    emitted,
    kv,
    createdStatus: () => created?.status,
  };
}

describe('RidesService', () => {
  it('joins the ride room before emitting, with an ISO timestamp (expected)', async () => {
    const { service, calls, emitted } = build();

    const result = await service.request(RIDER_ID, body);

    // The ordering IS the bug this test exists to catch: emit first and the
    // rider's own sockets miss the first event.
    expect(calls.indexOf('joinRideRoom')).toBeLessThan(
      calls.indexOf('emitToRide'),
    );

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.event).toBe(RT.rideStatus);
    // A `Date` here would throw inside RealtimeService.emit's parse — the wire
    // carries ISO strings.
    expect(emitted[0]!.payload.at).toBe(CREATED_AT.toISOString());
    expect(emitted[0]!.payload.previousStatus).toBeNull();
    expect(emitted[0]!.payload.status).toBe('requested');

    expect(result.split.commissionSource).toBe('platform_base');
  });

  it('creates a future-dated request at status scheduled (edge)', async () => {
    const { service, createdStatus } = build();

    await service.request(RIDER_ID, {
      ...body,
      scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    expect(createdStatus()).toBe('scheduled');
  });

  it('rejects a multi-taxi order before spending a maps call (failure)', async () => {
    const { service, calls } = build();

    await expect(
      service.request(RIDER_ID, {
        ...body,
        vehicleCount: 3,
      }),
    ).rejects.toThrow(BadRequestException);

    // An unsupported request must not burn a (paid) route lookup or write a row.
    expect(calls).toEqual([]);
  });

  it('rejects a scheduled pickup in the past (failure)', async () => {
    const { service, calls } = build();

    await expect(
      service.request(RIDER_ID, {
        ...body,
        scheduledFor: new Date(Date.now() - 60_000),
      }),
    ).rejects.toThrow(/scheduled_in_past/);

    expect(calls).toEqual([]);
  });

  it('throttles a rider past the window cap without spending a maps call (failure)', async () => {
    // The <€100/mo guardrail: the route cache does NOT save you here, because a
    // caller varying coordinates by >~11 m gets a fresh paid call every time.
    const { service, calls } = build();

    for (let i = 0; i < RIDE_REQUEST_MAX_PER_WINDOW; i += 1) {
      await service.request(RIDER_ID, body);
    }
    const spentWhileAllowed = calls.length;

    await expect(service.request(RIDER_ID, body)).rejects.toThrow(
      /too_many_requests/,
    );

    // The rejected request cost nothing — no quote, no row.
    expect(calls.length).toBe(spentWhileAllowed);
  });

  it('lets the same rider through once the window rolls over (edge)', async () => {
    const { service, kv } = build();

    for (let i = 0; i < RIDE_REQUEST_MAX_PER_WINDOW; i += 1) {
      await service.request(RIDER_ID, body);
    }
    await expect(service.request(RIDER_ID, body)).rejects.toThrow(
      /too_many_requests/,
    );

    kv.advance(RIDE_REQUEST_WINDOW_SECONDS + 1);

    await expect(service.request(RIDER_ID, body)).resolves.toBeDefined();
  });

  it('returns the committed ride even when the socket emit fails (failure)', async () => {
    // The ride is already committed. A 500 here would send the rider back to
    // tap Book again — which books a second car to the same kerb.
    const { service, calls } = build({ realtimeThrows: true });

    const result = await service.request(RIDER_ID, body);

    expect(result.ride.id).toBe(RIDE_ID);
    expect(calls).toContain('rides.create');
  });
});
