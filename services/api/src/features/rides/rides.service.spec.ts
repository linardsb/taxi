import { BadRequestException, Logger } from '@nestjs/common';
import {
  RT,
  type FareQuote,
  type FareSplit,
  type Ride,
  type RideRequestBody,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import { InMemoryKeyValueStore } from '../../../test/harness';
import type { PricingService } from '../pricing';
import type { RealtimeService } from '../realtime';
import {
  RIDE_IDEMPOTENCY_TTL_SECONDS,
  RIDE_REQUEST_MAX_PER_WINDOW,
  RIDE_REQUEST_WINDOW_SECONDS,
  rideIdempotencyKey,
} from './rides.policy';
import { RidesService } from './rides.service';
import type { RidesRepository } from './rides.repository';

const RIDER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
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

function build(
  options: {
    realtimeThrows?: boolean;
    pricingThrows?: boolean;
    /** Parks `pricing.quote` until `releaseQuote()` — a request left in flight. */
    deferQuote?: boolean;
    /** Share a store across two services, so a KEY outlives the service. */
    kv?: InMemoryKeyValueStore;
  } = {},
) {
  /** One shared log, so ORDER is assertable and not just occurrence. */
  const calls: string[] = [];
  const emitted: { event: string; payload: Record<string, unknown> }[] = [];
  let created: { status: string } | undefined;

  /** What the fake repository has "committed", by id — what a replay reads. */
  const committed = new Map<string, { ride: Ride; quote: FareQuote }>();

  let releaseQuote!: () => void;
  const quoteGate = new Promise<void>((resolve) => {
    releaseQuote = resolve;
  });

  const pricing = {
    quote: async () => {
      calls.push('pricing.quote');
      if (options.pricingThrows) throw new Error('maps provider is down');
      if (options.deferQuote) await quoteGate;
      return { quote, split };
    },
    previewSplit: () => {
      calls.push('pricing.previewSplit');
      return Promise.resolve(split);
    },
  } as unknown as PricingService;

  const rides = {
    create: (input: { status: string }) => {
      calls.push('rides.create');
      created = input;
      // A FRESH id per call, deliberately: with a constant, "the repeat
      // returned the same ride id" would hold whether or not the replay path
      // ever ran, and every idempotency test below would pass on the bug.
      const ride = {
        id: randomUUID(),
        orderId: randomUUID(),
        status: input.status,
        createdAt: CREATED_AT,
      } as unknown as Ride;
      committed.set(ride.id, { ride, quote });
      return Promise.resolve(ride);
    },
    findWithQuote: (rideId: string) => {
      calls.push('rides.findWithQuote');
      return Promise.resolve(committed.get(rideId));
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

  const kv = options.kv ?? new InMemoryKeyValueStore();

  return {
    service: new RidesService(pricing, rides, realtime, kv),
    calls,
    emitted,
    kv,
    releaseQuote: () => releaseQuote(),
    createdStatus: () => created?.status,
    countOf: (call: string) => calls.filter((c) => c === call).length,
  };
}

/**
 * One `request`, with a FRESH idempotency key unless the test pins one.
 *
 * The default MUST be fresh. Share one across the throttle loops below and
 * their 20 calls become 1 create + 19 replays — the counter charged once, the
 * 21st call served instead of throttled, and the assertion inverting for a
 * reason that has nothing to do with the rate limit.
 */
const req = (
  service: RidesService,
  requestBody: RideRequestBody = body,
  key: string = randomUUID(),
) => service.request(RIDER_ID, key, requestBody);

describe('RidesService', () => {
  it('joins the ride room before emitting, with an ISO timestamp (expected)', async () => {
    const { service, calls, emitted } = build();

    const result = await req(service);

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

    await req(service, {
      ...body,
      scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000),
    });

    expect(createdStatus()).toBe('scheduled');
  });

  it('rejects a multi-taxi order before spending a maps call (failure)', async () => {
    const { service, calls } = build();

    await expect(req(service, { ...body, vehicleCount: 3 })).rejects.toThrow(
      BadRequestException,
    );

    // An unsupported request must not burn a (paid) route lookup or write a row.
    expect(calls).toEqual([]);
  });

  it('rejects a scheduled pickup in the past (failure)', async () => {
    const { service, calls } = build();

    await expect(
      req(service, { ...body, scheduledFor: new Date(Date.now() - 60_000) }),
    ).rejects.toThrow(/scheduled_in_past/);

    expect(calls).toEqual([]);
  });

  it('throttles a rider past the window cap without spending a maps call (failure)', async () => {
    // The <€100/mo guardrail: the route cache does NOT save you here, because a
    // caller varying coordinates by >~11 m gets a fresh paid call every time.
    const { service, calls } = build();

    for (let i = 0; i < RIDE_REQUEST_MAX_PER_WINDOW; i += 1) {
      await req(service);
    }
    const spentWhileAllowed = calls.length;

    await expect(req(service)).rejects.toThrow(/too_many_requests/);

    // The rejected request cost nothing — no quote, no row.
    expect(calls.length).toBe(spentWhileAllowed);
  });

  it('lets the same rider through once the window rolls over (edge)', async () => {
    const { service, kv } = build();

    for (let i = 0; i < RIDE_REQUEST_MAX_PER_WINDOW; i += 1) {
      await req(service);
    }
    await expect(req(service)).rejects.toThrow(/too_many_requests/);

    // 601s reopens the rate window and does NOT expire an 86400s idempotency
    // key — which is why the call below needs the fresh key `req()` mints.
    kv.advance(RIDE_REQUEST_WINDOW_SECONDS + 1);

    await expect(req(service)).resolves.toBeDefined();
  });

  it('does not charge quota for a request rejected at the boundary (edge)', async () => {
    // The cap bounds paid Routes calls, and a rejected request never reaches
    // one. Charging it quota would lock out a rider whose app sends a bad body
    // while buying nothing against an attacker — whose invalid requests already
    // cost nothing. Pins the ordering: with the cap at the top of `request`,
    // the valid request below is throttled instead of served.
    const { service, calls } = build();

    for (let i = 0; i <= RIDE_REQUEST_MAX_PER_WINDOW; i += 1) {
      await expect(req(service, { ...body, vehicleCount: 3 })).rejects.toThrow(
        BadRequestException,
      );
    }

    expect(calls).toEqual([]);
    await expect(req(service)).resolves.toBeDefined();
  });

  it('logs ride.request.failed when the spending path throws (failure)', async () => {
    // Without this the only trace of a 500 on POST /rides is Nest's default
    // exception log — no riderId, no category, nothing to tell "one rider, one
    // corridor" from "maps is down".
    const { service } = build({ pricingThrows: true });
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    await expect(req(service)).rejects.toThrow(/maps provider is down/);

    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ride.request.failed',
        riderId: RIDER_ID,
        reason: 'maps provider is down',
      }),
    );
    logged.mockRestore();
  });

  it('returns the committed ride even when the socket emit fails (failure)', async () => {
    // The ride is already committed. A 500 here would send the rider back to
    // tap Book again — which books a second car to the same kerb.
    const { service, calls } = build({ realtimeThrows: true });

    const result = await req(service);

    expect(result.ride.id).toBeDefined();
    expect(calls).toContain('rides.create');
  });

  describe('idempotency', () => {
    it('replays the same ride for a repeated key, spending no maps call (expected, AC#1)', async () => {
      const { service, countOf } = build();
      const key = randomUUID();

      const first = await req(service, body, key);
      const second = await req(service, body, key);

      expect(second.ride.id).toBe(first.ride.id);
      expect(second.split).toEqual(first.split);
      // THE assertion. One row is what the rider sees; one quote is what proves
      // the replay never reached the paid Routes call.
      expect(countOf('rides.create')).toBe(1);
      expect(countOf('pricing.quote')).toBe(1);
    });

    it('creates a second ride for a genuinely different request (edge, AC#2)', async () => {
      const { service, countOf } = build();

      const first = await req(service);
      const second = await req(service);

      expect(second.ride.id).not.toBe(first.ride.id);
      expect(countOf('rides.create')).toBe(2);
    });

    it('creates a new ride when the key comes back outside the window (edge, AC#3)', async () => {
      const { service, kv, countOf } = build();
      const key = randomUUID();

      const first = await req(service, body, key);
      kv.advance(RIDE_IDEMPOTENCY_TTL_SECONDS + 1);
      const second = await req(service, body, key);

      // An expired reservation must be reservable again — otherwise a rider's
      // key is theirs for life.
      expect(second.ride.id).not.toBe(first.ride.id);
      expect(countOf('rides.create')).toBe(2);
    });

    it('409s a repeat that lands while the first is still in flight (failure)', async () => {
      // A genuine double-tap is ~200 ms apart, and the first request holds the
      // reservation across a config read, a route call and a transaction — so
      // the second one lands mid-flight. Waiting for it would tie up a
      // connection; the client retries the 409 and gets the ride.
      const { service, releaseQuote, countOf } = build({ deferQuote: true });
      const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const key = randomUUID();

      // Deliberately not awaited: this one is parked inside `pricing.quote`.
      const inFlight = req(service, body, key);

      await expect(req(service, body, key)).rejects.toThrow(
        /idempotent_request_in_progress/,
      );

      releaseQuote();
      await expect(inFlight).resolves.toBeDefined();
      // The harm the ticket names — two cars to one kerb — is prevented either
      // way; only the response shape differs.
      expect(countOf('rides.create')).toBe(1);
      warned.mockRestore();
    });

    it('releases the key when the first attempt fails, so a retry still books (failure)', async () => {
      // A maps outage — or a single 429 — must not burn the rider's key for the
      // next 24 h. Without the release, every honest retry below 409s forever.
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const failing = build({ pricingThrows: true });
      const key = randomUUID();

      await expect(req(failing.service, body, key)).rejects.toThrow(
        /maps provider is down/,
      );
      logged.mockRestore();

      expect(
        await failing.kv.get(rideIdempotencyKey(RIDER_ID, key)),
      ).toBeNull();

      // A new service over the SAME store: the point under test is the key's
      // lifetime, not the instance's.
      const healthy = build({ kv: failing.kv });
      await expect(req(healthy.service, body, key)).resolves.toBeDefined();
      expect(healthy.countOf('rides.create')).toBe(1);
    });

    it('does not charge rate-limit quota for a replay (edge)', async () => {
      // Pins the ordering decision: the reservation sits ABOVE the rate limit,
      // because the cap bounds paid Routes calls and a replay reaches none.
      // Charging it would throttle exactly the rider this feature protects.
      const { service, countOf } = build();
      const key = randomUUID();

      await req(service, body, key);
      for (let i = 0; i < RIDE_REQUEST_MAX_PER_WINDOW + 5; i += 1) {
        await req(service, body, key);
      }

      expect(countOf('pricing.quote')).toBe(1);
      // One booking has been charged, not twenty-six — so a NEW booking is
      // still served.
      await expect(req(service)).resolves.toBeDefined();
    });
  });
});
