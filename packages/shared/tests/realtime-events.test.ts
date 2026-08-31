import { describe, expect, it } from 'vitest';
import {
  type ClientToServerEmitEvents,
  type ClientToServerEvents,
  RT,
  RT_EVENT_SCHEMAS,
  type ServerToClientEvents,
  dispatchBoardEventSchema,
  dispatchRoom,
  dispatchSmsFailedEventSchema,
  dispatchUnclaimedEventSchema,
  driverLocationAckSchema,
  driverLocationEventSchema,
  driverLocationPingSchema,
  driverQueueEventSchema,
  driverRoom,
  rideAssignedEventSchema,
  rideOfferEventSchema,
  rideOfferRevokedEventSchema,
  rideRoom,
  rideStatusEventSchema,
  userRoom,
} from '../src/realtime-events';
import { SMS_KINDS } from '../src/enums';
import { rideOfferSchema } from '../src/schemas/ride';
import { splitFare } from '../src/commission';

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const at = '2026-08-03T10:00:00.000Z';
const pickup = { location: riga, address: 'Brīvības iela 1, Rīga' };

describe('socket payloads', () => {
  it('parses a driver location event and a ride status event (expected)', () => {
    const location = driverLocationEventSchema.parse({
      driverId: uuid,
      location: riga,
      at,
    });
    expect(location.driverId).toBe(uuid);

    const status = rideStatusEventSchema.parse({
      rideId: uuid,
      orderId: uuid,
      status: 'accepted',
      previousStatus: 'offered',
      at,
    });
    expect(status.previousStatus).toBe('offered');
    expect(status.reason).toBeNull();
  });

  it('drops a client-supplied driverId from an inbound ping (edge — spoofing guard)', () => {
    const parsed = driverLocationPingSchema.parse({
      driverId: 'someone-else',
      location: riga,
      at,
    });
    expect(parsed).not.toHaveProperty('driverId');
  });

  it('builds room names through the helpers (edge)', () => {
    expect(rideRoom(uuid)).toBe(`ride:${uuid}`);
    expect(driverRoom(uuid)).toBe(`driver:${uuid}`);
    expect(dispatchRoom(uuid)).toBe(`dispatch:${uuid}`);
    expect(userRoom(uuid)).toBe(`user:${uuid}`);
  });

  it('rejects a bad latitude and a non-ISO timestamp (failure)', () => {
    expect(
      driverLocationPingSchema.safeParse({
        location: { lat: 91, lng: 0 },
        at: 'not-a-date',
      }).success,
    ).toBe(false);
  });
});

describe('driverQueueEventSchema', () => {
  const base = {
    driverId: uuid,
    geozoneId: otherUuid,
    geozoneSlug: 'rix',
    position: 1,
    size: 4,
    at,
  };

  it("parses a driver's live queue place (expected)", () => {
    const parsed = driverQueueEventSchema.parse(base);
    expect(parsed.position).toBe(1);
    expect(parsed.size).toBe(4);
  });

  it('allows an empty queue behind the last driver (edge)', () => {
    expect(driverQueueEventSchema.parse({ ...base, size: 0 }).size).toBe(0);
  });

  it('rejects a position of 0 — positions are 1-based (failure)', () => {
    expect(
      driverQueueEventSchema.safeParse({ ...base, position: 0 }).success,
    ).toBe(false);
  });
});

describe('rideOfferRevokedEventSchema', () => {
  const base = { offerId: uuid, rideId: otherUuid, reason: 'expired', at };

  it('clears the offer card on expiry (expected)', () => {
    expect(rideOfferRevokedEventSchema.parse(base).reason).toBe('expired');
  });

  it('carries the other two revoke reasons (edge)', () => {
    expect(
      rideOfferRevokedEventSchema.parse({ ...base, reason: 'taken' }).reason,
    ).toBe('taken');
    expect(
      rideOfferRevokedEventSchema.parse({ ...base, reason: 'cancelled' })
        .reason,
    ).toBe('cancelled');
  });

  it('rejects an unknown revoke reason (failure)', () => {
    expect(
      rideOfferRevokedEventSchema.safeParse({ ...base, reason: 'declined' })
        .success,
    ).toBe(false);
  });
});

describe('rideAssignedEventSchema', () => {
  const base = { rideId: uuid, driverId: otherUuid, at };

  it('parses an auto-matched assignment with no dispatcher (expected)', () => {
    const parsed = rideAssignedEventSchema.parse({
      ...base,
      source: 'auto_match',
    });
    expect(parsed.dispatcherId).toBeNull();
  });

  it('parses a dispatcher override carrying its actor (edge)', () => {
    const parsed = rideAssignedEventSchema.parse({
      ...base,
      source: 'dispatcher',
      dispatcherId: uuid,
    });
    expect(parsed.dispatcherId).toBe(uuid);
  });

  it('rejects a dispatcher assignment without dispatcherId (failure — the audit rule)', () => {
    // The rule `rideAssignmentSchema` enforces on the record must hold on the
    // wire too: an override with no actor is unauditable wherever it appears.
    expect(
      rideAssignedEventSchema.safeParse({ ...base, source: 'dispatcher' })
        .success,
    ).toBe(false);
    expect(
      rideAssignedEventSchema.safeParse({
        ...base,
        source: 'dispatcher',
        dispatcherId: null,
      }).success,
    ).toBe(false);
  });
});

describe('dispatchBoardEventSchema', () => {
  const driver = {
    driverId: otherUuid,
    name: 'Jānis Ozols',
    phone: '+37129999001',
    location: riga,
    lastSeenAt: at,
    zoneName: 'Centrs',
    status: 'online',
  };
  const zone = {
    geozoneId: uuid,
    slug: 'centrs',
    name: 'Centrs',
    queueModeEnabled: true,
    entries: [
      {
        driverId: otherUuid,
        name: 'Jānis Ozols',
        phone: '+37129999001',
        position: 1,
        secondsInZone: 2_820,
        status: 'online',
      },
    ],
  };
  const base = {
    cityId: uuid,
    at,
    rides: [
      {
        rideId: uuid,
        status: 'requested',
        pickup,
        driverId: null,
        driverName: null,
        bookingChannel: 'phone',
        requestedAt: at,
        unclaimedSeconds: 42,
        cascade: null,
      },
    ],
    zones: [zone],
    drivers: [driver],
  };

  it('parses a board with one ride and one driver (expected)', () => {
    const parsed = dispatchBoardEventSchema.parse(base);
    expect(parsed.rides[0]!.unclaimedSeconds).toBe(42);
    expect(parsed.drivers[0]!.status).toBe('online');
    expect(parsed.drivers[0]!.phone).toBe('+37129999001');
  });

  it('survives the JSON round-trip a socket actually performs (expected)', () => {
    const emitted = dispatchBoardEventSchema.parse(base);
    const overWire: unknown = JSON.parse(JSON.stringify(emitted));
    expect(dispatchBoardEventSchema.parse(overWire)).toEqual(emitted);
  });

  it('parses an empty board before any orders land (edge)', () => {
    const parsed = dispatchBoardEventSchema.parse({
      ...base,
      rides: [],
      drivers: [],
    });
    expect(parsed.rides).toEqual([]);
  });

  it('carries an online driver with no recorded position as nulls (edge)', () => {
    const parsed = dispatchBoardEventSchema.parse({
      ...base,
      drivers: [
        { ...driver, location: null, lastSeenAt: null, zoneName: null },
      ],
    });
    expect(parsed.drivers[0]!.location).toBeNull();
    expect(parsed.drivers[0]!.name).toBe('Jānis Ozols');
  });

  it('carries a configured zone with nobody queued in it (expected)', () => {
    // The thing `zones-panel.tsx` could not draw: an empty rank is where Dina
    // sends the next free car, so it has to survive the wire as a zone with
    // no entries — not be dropped for having none.
    const parsed = dispatchBoardEventSchema.parse({
      ...base,
      drivers: [],
      zones: [{ ...zone, entries: [] }],
    });
    expect(parsed.zones).toHaveLength(1);
    expect(parsed.zones[0]!.entries).toEqual([]);
  });

  it('carries a queued driver who has gone offline (edge)', () => {
    const parsed = dispatchBoardEventSchema.parse({
      ...base,
      zones: [
        { ...zone, entries: [{ ...zone.entries[0]!, status: 'offline' }] },
      ],
    });
    // Holding position 1 while offline is exactly what Dina must see.
    expect(parsed.zones[0]!.entries[0]!.status).toBe('offline');
    expect(parsed.zones[0]!.entries[0]!.position).toBe(1);
  });

  it('carries a live cascade with its explanation (expected)', () => {
    const parsed = dispatchBoardEventSchema.parse({
      ...base,
      rides: [
        {
          ...base.rides[0]!,
          status: 'offered',
          cascade: {
            offeredToDriverId: otherUuid,
            offeredToName: 'Jānis Ozols',
            expiresAt: at,
            nextDriverName: 'Māra Liepa',
            attempts: 2,
            explanation: {
              key: 'explain.geozone_queue',
              params: { zone: 'Centrs', position: 1, minutes: 47, eta: 4 },
            },
          },
        },
      ],
    });
    expect(parsed.rides[0]!.cascade?.attempts).toBe(2);
    expect(parsed.rides[0]!.cascade?.explanation?.key).toBe(
      'explain.geozone_queue',
    );
  });

  it('rejects a zone position of 0 — the port is 1-based (failure)', () => {
    expect(
      dispatchBoardEventSchema.safeParse({
        ...base,
        zones: [{ ...zone, entries: [{ ...zone.entries[0]!, position: 0 }] }],
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown driver status (failure)', () => {
    expect(
      dispatchBoardEventSchema.safeParse({
        ...base,
        drivers: [{ ...driver, status: 'napping' }],
      }).success,
    ).toBe(false);
  });
});

describe('dispatchSmsFailedEventSchema', () => {
  const base = { rideId: uuid, kind: 'booking_confirmed', at };

  it("raises Dina's alert for an undelivered rider SMS (expected)", () => {
    expect(dispatchSmsFailedEventSchema.parse(base).kind).toBe(
      'booking_confirmed',
    );
  });

  it('carries the other two SMS kinds (edge)', () => {
    expect(
      dispatchSmsFailedEventSchema.parse({ ...base, kind: 'driver_assigned' })
        .kind,
    ).toBe('driver_assigned');
    expect(
      dispatchSmsFailedEventSchema.parse({ ...base, kind: 'driver_arrived' })
        .kind,
    ).toBe('driver_arrived');
  });

  it('accepts exactly SMS_KINDS — the api derives its union from the same tuple', () => {
    for (const kind of SMS_KINDS) {
      expect(
        dispatchSmsFailedEventSchema.safeParse({ ...base, kind }).success,
      ).toBe(true);
    }
    expect(dispatchSmsFailedEventSchema.shape.kind.options).toEqual([
      ...SMS_KINDS,
    ]);
  });

  it('rejects an unknown SMS kind (failure)', () => {
    expect(
      dispatchSmsFailedEventSchema.safeParse({ ...base, kind: 'otp_code' })
        .success,
    ).toBe(false);
  });
});

describe('dispatchUnclaimedEventSchema', () => {
  const base = {
    rideId: uuid,
    pickup,
    requestedAt: at,
    unclaimedSeconds: 90,
    offerAttempts: 3,
  };

  it("raises Dina's flash alert for an untaken order (expected)", () => {
    expect(dispatchUnclaimedEventSchema.parse(base).offerAttempts).toBe(3);
  });

  it('allows zero offer attempts — nobody was even in range (edge)', () => {
    expect(
      dispatchUnclaimedEventSchema.parse({ ...base, offerAttempts: 0 })
        .offerAttempts,
    ).toBe(0);
  });

  it('rejects a negative unclaimed duration (failure)', () => {
    expect(
      dispatchUnclaimedEventSchema.safeParse({ ...base, unclaimedSeconds: -1 })
        .success,
    ).toBe(false);
  });
});

describe('rideOfferEventSchema — the wire projection', () => {
  const wire = {
    id: uuid,
    rideId: otherUuid,
    driverId: uuid,
    status: 'pending',
    source: 'auto_match',
    sentAt: at,
    expiresAt: '2026-08-03T10:00:20.000Z',
    etaSeconds: 240,
    pickup,
    destination: {
      location: { lat: 56.9236, lng: 23.9711 },
      address: 'Lidosta RIX',
    },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 2000,
      breakdown: { baseCents: 300, distanceCents: 1400, timeCents: 300 },
    },
    split: splitFare(2000, { pct: 15, source: 'platform_base' }),
  };

  it('keeps both timestamps as ISO strings, like the other 8 events (expected)', () => {
    const parsed = rideOfferEventSchema.parse(wire);
    expect(typeof parsed.expiresAt).toBe('string');
    expect(typeof parsed.sentAt).toBe('string');
    expect(parsed.expiresAt).toBe('2026-08-03T10:00:20.000Z');
  });

  it('survives the JSON round-trip a socket actually performs (edge)', () => {
    // The regression this guards: the event used to BE `rideOfferSchema`, whose
    // `z.coerce.date()` made `z.infer` say `Date`. A #15 handler reading
    // `payload.expiresAt.getTime()` typechecked and threw on the first offer,
    // and `Date.now() < payload.expiresAt` typechecked, coerced to NaN and
    // silently rendered every offer as already-expired.
    const emitted = rideOfferEventSchema.parse(wire);
    const overWire: unknown = JSON.parse(JSON.stringify(emitted));
    const reparsed = rideOfferEventSchema.parse(overWire);
    expect(reparsed).toEqual(emitted); // nothing is lost or coerced in transit
    expect(typeof reparsed.expiresAt).toBe('string');

    // ...and the domain schema still re-hydrates the same payload to Dates.
    const domain = rideOfferSchema.parse(overWire);
    expect(domain.expiresAt).toBeInstanceOf(Date);
    expect(domain.expiresAt.getTime()).toBe(
      Date.parse('2026-08-03T10:00:20.000Z'),
    );
  });

  it('rejects a Date where the wire promises a string (failure)', () => {
    expect(
      rideOfferEventSchema.safeParse({
        ...wire,
        expiresAt: new Date(wire.expiresAt),
      }).success,
    ).toBe(false);
  });
});

describe('event typing', () => {
  it('declares every outbound timestamp as a string, never a Date (type-level)', () => {
    // Compile-time assertions: these fail `pnpm typecheck`, not vitest. If any
    // event's `at`/timestamp regresses to `Date`, the assignment stops compiling.
    type OfferPayload = Parameters<
      ServerToClientEvents[typeof RT.rideOffer]
    >[0];
    const _expiresAt: string = {} as OfferPayload['expiresAt'];
    const _sentAt: string = {} as OfferPayload['sentAt'];
    type StatusPayload = Parameters<
      ServerToClientEvents[typeof RT.rideStatus]
    >[0];
    const _statusAt: string = {} as StatusPayload['at'];
    expect([typeof _expiresAt, typeof _sentAt, typeof _statusAt]).toBeDefined();
  });

  it('keeps the untrusted inbound payload unreadable without a parse (type-level)', () => {
    // The security boundary in the type system: reading a field off the raw
    // client payload must not compile. If someone re-types this map with
    // `DriverLocationPing`, the @ts-expect-error below becomes unused and
    // typecheck fails — which is the alarm.
    const handler: ClientToServerEvents[typeof RT.driverLocation] = (
      payload,
    ) => {
      // @ts-expect-error — untrusted: parse with driverLocationPingSchema first
      void payload.location;
      expect(driverLocationPingSchema.parse(payload).location).toEqual(riga);
    };
    handler({ location: riga, at });
  });

  it('hands the driver app an ack callback on driver:location (type-level, #14)', () => {
    // The emit map is what the app's `Socket<…, ClientToServerEmitEvents>`
    // compiles against. If the ack parameter is dropped, `socket.emit(RT.driverLocation,
    // ping, cb)` stops compiling in apps/driver — that is the alarm.
    const emit: ClientToServerEmitEvents[typeof RT.driverLocation] = (
      _payload,
      ack,
    ) => ack({ accepted: true });
    let received: unknown;
    emit({ location: riga, at }, (response) => {
      received = response;
    });
    expect(received).toEqual({ accepted: true });
  });
});

describe('driverLocationAckSchema (#14)', () => {
  it('accepts a bare acceptance (expected)', () => {
    expect(driverLocationAckSchema.parse({ accepted: true })).toEqual({
      accepted: true,
    });
  });

  it('accepts a refusal with a catalogued reason (edge)', () => {
    expect(
      driverLocationAckSchema.parse({ accepted: false, reason: 'not_online' }),
    ).toEqual({ accepted: false, reason: 'not_online' });
  });

  it('rejects an unknown reason and an empty object (failure)', () => {
    // The app branches on `reason` (drop / retry / re-assert); a free-form
    // string would reach that switch as "retry forever".
    expect(
      driverLocationAckSchema.safeParse({ accepted: false, reason: 'because' })
        .success,
    ).toBe(false);
    expect(driverLocationAckSchema.safeParse({}).success).toBe(false);
  });
});

describe('RT catalog', () => {
  it('carries exactly the 9 wired events, each domain:action (completeness)', () => {
    // Hand-listed on purpose: adding a 10th event without wiring it into the
    // direction maps and .claude/references/realtime-events.md must fail here.
    const wired = [
      'driver:location',
      'driver:queue',
      'ride:status',
      'ride:offer',
      'ride:offer_revoked',
      'ride:assigned',
      'dispatch:board',
      'dispatch:unclaimed',
      'dispatch:sms_failed',
    ];
    const names: string[] = Object.values(RT);
    expect(names).toHaveLength(9);
    expect([...names].sort()).toEqual([...wired].sort());
    for (const name of names) expect(name).toMatch(/^[a-z]+:[a-z_]+$/);
  });

  it('backs every server→client event with a payload schema (completeness)', () => {
    // The `satisfies` on RT_EVENT_SCHEMAS enforces this at compile time; this
    // pins it at runtime too, so a plain-JS consumer sees the same guarantee.
    expect(Object.keys(RT_EVENT_SCHEMAS).sort()).toEqual(
      [...Object.values(RT)].sort(),
    );
  });
});
