import { dispatchBoardEventSchema, type LatLng } from '@taxi/shared';
import type { Env } from '../../../common/config/env.schema';
import { InMemoryDriverLocationStore } from '../../../../test/harness';
import type { DriversService, DriverBoardContact } from '../../drivers';
import type { GeozonesService, ResolvedGeozone } from '../../geozones';
import type { RealtimeService } from '../../realtime';
import type { BoardRide, RidesRepository } from '../../rides';
import type {
  CascadeOfferRow,
  DispatchRepository,
} from '../dispatch.repository';
import { InMemoryDispatchQueueStore } from '../queue/in-memory-dispatch-queue.store';
import { BoardService } from './board.service';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER_A = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_B = 'd0000000-0000-4000-8000-000000000002';
const ZONE_ID = 'e0000000-0000-4000-8000-000000000001';
/** A second zone that sorts BEFORE `Centrs` — `listForCity` orders by name. */
const ZONE_AIRPORT = 'e0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-15T12:00:00.000Z');

const zone = (over: Partial<ResolvedGeozone> = {}): ResolvedGeozone => ({
  id: ZONE_ID,
  slug: 'centrs',
  name: 'Centrs',
  queueModeEnabled: true,
  ...over,
});

const offer = (over: Partial<CascadeOfferRow> = {}): CascadeOfferRow => ({
  rideId: RIDE_ID,
  driverId: DRIVER_A,
  status: 'pending',
  source: 'geozone_queue',
  expiresAt: new Date(NOW.getTime() + 12_000),
  etaSeconds: 240,
  queuePosition: 1,
  ...over,
});

const boardRide = (over: Partial<BoardRide> = {}): BoardRide => ({
  id: RIDE_ID,
  status: 'requested',
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
  driverId: null,
  driverName: null,
  bookingChannel: 'phone',
  createdAt: new Date(NOW.getTime() - 90_000),
  // Stamped by `setGeozone` at first dispatch — the zone the cascade explains.
  geozoneId: ZONE_ID,
  ...over,
});

const contact = (
  over: Partial<DriverBoardContact> = {},
): DriverBoardContact => ({
  driverId: DRIVER_A,
  name: 'Jānis Ozols',
  phone: '+37129999001',
  status: 'online',
  ...over,
});

function build(
  over: {
    rides?: BoardRide[];
    contacts?: DriverBoardContact[];
    zoneName?: string | null;
    /**
     * Zone name per `${lat},${lng}`. The frame pairs drivers with zones BY
     * ARRAY INDEX, so a mock that ignores its `point` cannot tell a correct
     * pairing from a swapped one — see the two-positioned-drivers case.
     */
    zonesByPoint?: Record<string, string>;
    roomSize?: number;
    buildThrows?: boolean;
    /** The city's zone CATALOG — what the grid draws, empty ranks included. */
    catalog?: ResolvedGeozone[];
    offers?: CascadeOfferRow[];
  } = {},
) {
  const locations = new InMemoryDriverLocationStore();
  const queue = new InMemoryDispatchQueueStore();

  const findBoardRides = over.buildThrows
    ? jest.fn(() => Promise.reject(new Error('postgres blinked')))
    : jest.fn(() => Promise.resolve(over.rides ?? []));
  const rides = { findBoardRides } as unknown as RidesRepository;

  const drivers = {
    findBoardContacts: jest.fn(() => Promise.resolve(over.contacts ?? [])),
  } as unknown as DriversService;

  const zoneNameFor = (point: LatLng): string | undefined =>
    over.zonesByPoint
      ? over.zonesByPoint[`${point.lat},${point.lng}`]
      : (over.zoneName ?? undefined);

  const listForCity = jest.fn(() => Promise.resolve(over.catalog ?? []));
  const geozones = {
    resolveForPoint: jest.fn((_cityId: string, point: LatLng) => {
      const name = zoneNameFor(point);
      return Promise.resolve(
        name === undefined
          ? undefined
          : { id: CITY, slug: 'centre', name, queueModeEnabled: false },
      );
    }),
    listForCity,
  } as unknown as GeozonesService;

  const findOffersForRides = jest.fn(() => Promise.resolve(over.offers ?? []));
  const dispatch = { findOffersForRides } as unknown as DispatchRepository;

  const emitToDispatch = jest.fn();
  const realtime = {
    emitToDispatch,
    dispatchRoomSize: jest.fn(() => over.roomSize ?? 1),
  } as unknown as RealtimeService;

  const env = { NODE_ENV: 'test', DEFAULT_CITY_ID: CITY } as Env;

  const service = new BoardService(
    rides,
    drivers,
    locations,
    geozones,
    realtime,
    dispatch,
    queue,
    env,
  );
  return {
    service,
    locations,
    queue,
    emitToDispatch,
    findBoardRides,
    findOffersForRides,
    geozones,
  };
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});
afterEach(() => {
  jest.useRealTimers();
});

describe('BoardService.buildBoardState', () => {
  it('builds a frame that parses against the wire schema — the anti-silent-drift assertion (expected)', async () => {
    // RealtimeService.emit throws on schema mismatch and every caller swallows
    // that into a log, so a drifted payload would vanish silently in
    // production. This parse is the tripwire.
    const { service, locations } = build({
      rides: [boardRide()],
      contacts: [contact()],
      zoneName: 'Centrs',
    });
    await locations.markOnline(CITY, DRIVER_A);
    await locations.record(
      CITY,
      DRIVER_A,
      { lat: 56.95, lng: 24.11 },
      NOW.getTime() - 5_000,
    );

    const frame = dispatchBoardEventSchema.parse(
      await service.buildBoardState(CITY),
    );
    expect(frame.rides).toHaveLength(1);
    expect(frame.drivers).toEqual([
      {
        driverId: DRIVER_A,
        name: 'Jānis Ozols',
        phone: '+37129999001',
        location: { lat: 56.95, lng: 24.11 },
        lastSeenAt: new Date(NOW.getTime() - 5_000).toISOString(),
        zoneName: 'Centrs',
        status: 'online',
      },
    ]);
  });

  it('counts unclaimedSeconds only for requested rides — an assigned ride reads 0 (expected)', async () => {
    const { service } = build({
      rides: [
        boardRide(), // requested, created 90 s ago
        boardRide({
          id: '4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
          status: 'accepted',
          driverId: DRIVER_A,
          driverName: 'Jānis Ozols',
        }),
      ],
    });

    const frame = await service.buildBoardState(CITY);
    expect(frame.rides[0]!.unclaimedSeconds).toBe(90);
    expect(frame.rides[1]!.unclaimedSeconds).toBe(0);
    expect(frame.rides[1]!.driverName).toBe('Jānis Ozols');
  });

  it('carries a never-pinged online driver with nulls and falls back name→phone (edge)', async () => {
    const { service, locations } = build({
      contacts: [contact({ name: null })],
    });
    await locations.markOnline(CITY, DRIVER_A);

    const frame = dispatchBoardEventSchema.parse(
      await service.buildBoardState(CITY),
    );
    expect(frame.drivers).toEqual([
      {
        driverId: DRIVER_A,
        name: '+37129999001', // schema promises non-null; the phone always exists
        phone: '+37129999001',
        location: null,
        lastSeenAt: null,
        zoneName: null,
        status: 'online',
      },
    ]);
  });

  it('tags each positioned driver with the zone of ITS OWN point (expected)', async () => {
    // `drivers` is built by index off the same `online` array `zones` was
    // built from. Indices align today; anything that shortens or reorders one
    // side — e.g. moving the ghost-drop ahead of the zone lookup, a natural
    // optimisation that saves PostGIS queries — silently swaps the labels.
    // Nothing throws and nothing logs; Dina just voice-dispatches the wrong
    // driver. Two POSITIONED drivers at distinct points is the only shape
    // that can catch it.
    const A_POINT = { lat: 56.95, lng: 24.11 }; // centre
    const B_POINT = { lat: 56.9236, lng: 23.9711 }; // airport
    const { service, locations } = build({
      contacts: [
        contact({ driverId: DRIVER_A, name: 'Jānis Ozols' }),
        contact({
          driverId: DRIVER_B,
          name: 'Anna Bērziņa',
          phone: '+37129999002',
        }),
      ],
      zonesByPoint: {
        [`${A_POINT.lat},${A_POINT.lng}`]: 'Centrs',
        [`${B_POINT.lat},${B_POINT.lng}`]: 'Lidosta',
      },
    });
    await locations.markOnline(CITY, DRIVER_A);
    await locations.record(CITY, DRIVER_A, A_POINT, NOW.getTime() - 5_000);
    await locations.markOnline(CITY, DRIVER_B);
    await locations.record(CITY, DRIVER_B, B_POINT, NOW.getTime() - 5_000);

    const frame = await service.buildBoardState(CITY);

    // Asserted by driverId, not by position — a reordering of `online` must
    // not make this pass or fail for the wrong reason.
    const byId = new Map(frame.drivers.map((d) => [d.driverId, d]));
    expect(byId.get(DRIVER_A)?.zoneName).toBe('Centrs');
    expect(byId.get(DRIVER_B)?.zoneName).toBe('Lidosta');
    expect(byId.get(DRIVER_A)?.location).toEqual(A_POINT);
    expect(byId.get(DRIVER_B)?.location).toEqual(B_POINT);
  });

  it('keeps the pairing when an unpositioned driver sits between two positioned ones (edge)', async () => {
    // The `Promise.resolve(undefined)` branch still occupies an index. If it
    // ever stopped doing so, every driver after it would inherit the next
    // driver's zone.
    const A_POINT = { lat: 56.95, lng: 24.11 }; // centre
    const C_POINT = { lat: 56.9236, lng: 23.9711 }; // airport
    const C = 'd0000000-0000-4000-8000-000000000003';
    const { service, locations } = build({
      contacts: [
        contact({ driverId: DRIVER_A }),
        contact({ driverId: DRIVER_B, phone: '+37129999002' }),
        contact({ driverId: C, phone: '+37129999003' }),
      ],
      zonesByPoint: {
        [`${A_POINT.lat},${A_POINT.lng}`]: 'Centrs',
        [`${C_POINT.lat},${C_POINT.lng}`]: 'Lidosta',
      },
    });
    await locations.markOnline(CITY, DRIVER_A);
    await locations.record(CITY, DRIVER_A, A_POINT, NOW.getTime() - 5_000);
    await locations.markOnline(CITY, DRIVER_B); // online, never pinged
    await locations.markOnline(CITY, C);
    await locations.record(CITY, C, C_POINT, NOW.getTime() - 5_000);

    const frame = await service.buildBoardState(CITY);

    const byId = new Map(frame.drivers.map((d) => [d.driverId, d]));
    expect(byId.get(DRIVER_A)?.zoneName).toBe('Centrs');
    expect(byId.get(DRIVER_B)?.zoneName).toBe(null); // no position at all
    expect(byId.get(C)?.zoneName).toBe('Lidosta'); // NOT shifted up to Centrs
  });

  it('drops an online-set member with no drivers/users row instead of rendering a ghost (edge)', async () => {
    const { service, locations } = build({ contacts: [contact()] });
    await locations.markOnline(CITY, DRIVER_A);
    await locations.markOnline(CITY, DRIVER_B); // no contact row

    const frame = await service.buildBoardState(CITY);
    expect(frame.drivers.map((d) => d.driverId)).toEqual([DRIVER_A]);
  });

  it('carries a configured zone that nobody is queued in (expected)', async () => {
    // The exact thing `zones-panel.tsx` documented it could not do. An empty
    // rank is where Dina sends the next free car; a grid that only draws
    // occupied zones hides the answer to the question she is asking.
    const { service } = build({
      catalog: [zone(), zone({ id: CITY, slug: 'lidosta', name: 'Lidosta' })],
    });

    const frame = dispatchBoardEventSchema.parse(
      await service.buildBoardState(CITY),
    );
    expect(frame.zones.map((z) => z.slug)).toEqual(['centrs', 'lidosta']);
    expect(frame.zones.every((z) => z.entries.length === 0)).toBe(true);
  });

  it('reports queue rank and time-in-queue for each queued driver (expected)', async () => {
    const { service, queue } = build({
      catalog: [zone()],
      contacts: [
        contact({ driverId: DRIVER_A, name: 'Jānis Ozols' }),
        contact({
          driverId: DRIVER_B,
          name: 'Anna Bērziņa',
          phone: '+37129999002',
        }),
      ],
    });
    // A joined 47 minutes before B, on the frame's own clock.
    jest.setSystemTime(new Date(NOW.getTime() - 2_820_000));
    await queue.joinBack(ZONE_ID, DRIVER_A);
    jest.setSystemTime(NOW);
    await queue.joinBack(ZONE_ID, DRIVER_B);

    const frame = dispatchBoardEventSchema.parse(
      await service.buildBoardState(CITY),
    );
    expect(frame.zones[0]!.entries).toEqual([
      {
        driverId: DRIVER_A,
        name: 'Jānis Ozols',
        phone: '+37129999001',
        position: 1,
        secondsInZone: 2_820,
        status: 'online',
      },
      {
        driverId: DRIVER_B,
        name: 'Anna Bērziņa',
        phone: '+37129999002',
        position: 2,
        secondsInZone: 0,
        status: 'online',
      },
    ]);
  });

  it('keeps a queued driver who has gone offline in the rank (edge)', async () => {
    // They are NOT in the online set, so their name can only come from the
    // union contacts read — and someone holding position 1 while offline is
    // the single most useful thing the grid can tell Dina.
    const { service, queue } = build({
      catalog: [zone()],
      contacts: [contact({ status: 'offline' })],
    });
    await queue.joinBack(ZONE_ID, DRIVER_A);

    const frame = await service.buildBoardState(CITY);
    expect(frame.drivers).toEqual([]); // not online
    expect(frame.zones[0]!.entries[0]).toMatchObject({
      driverId: DRIVER_A,
      position: 1,
      status: 'offline',
    });
  });

  it('explains a live offer with the rank the grid shows beside it (expected)', async () => {
    const { service, queue } = build({
      rides: [boardRide({ status: 'offered' })],
      catalog: [zone()],
      contacts: [
        contact({ driverId: DRIVER_A, name: 'Jānis Ozols' }),
        contact({
          driverId: DRIVER_B,
          name: 'Anna Bērziņa',
          phone: '+37129999002',
        }),
      ],
      offers: [offer()],
    });
    jest.setSystemTime(new Date(NOW.getTime() - 2_820_000));
    await queue.joinBack(ZONE_ID, DRIVER_A);
    jest.setSystemTime(NOW);
    await queue.joinBack(ZONE_ID, DRIVER_B);

    const frame = dispatchBoardEventSchema.parse(
      await service.buildBoardState(CITY),
    );
    const cascade = frame.rides[0]!.cascade;
    expect(cascade).toMatchObject({
      offeredToDriverId: DRIVER_A,
      offeredToName: 'Jānis Ozols',
      nextDriverName: 'Anna Bērziņa',
      attempts: 1,
    });
    expect(cascade!.expiresAt).toBe(
      new Date(NOW.getTime() + 12_000).toISOString(),
    );
    // The explanation's minutes are the grid's secondsInZone, not a second
    // reading of the clock — that identity is the whole point of composing it
    // from the already-built zone rows.
    expect(cascade!.explanation).toEqual({
      key: 'explain.geozone_queue',
      params: { zone: 'Centrs', position: 1, minutes: 47, eta: 4 },
    });
  });

  it('explains the ride’s own zone when the holder holds two ranks (edge)', async () => {
    // Jānis worked the airport earlier in the shift, so he is still in
    // Lidosta's rank — nothing calls `leave()`. Lidosta sorts first, so a
    // catalog scan for "the zone holding this driver" finds Lidosta and
    // explains a queue that has nothing to do with this ride. The ride's
    // stamped `geozoneId` is the only thing that says Centrs.
    const { service, queue } = build({
      rides: [boardRide({ status: 'offered' })],
      catalog: [
        zone({ id: ZONE_AIRPORT, slug: 'lidosta', name: 'Lidosta RIX' }),
        zone(),
      ],
      contacts: [
        contact({ driverId: DRIVER_A, name: 'Jānis Ozols' }),
        contact({
          driverId: DRIVER_B,
          name: 'Anna Bērziņa',
          phone: '+37129999002',
        }),
      ],
      offers: [offer()],
    });
    jest.setSystemTime(new Date(NOW.getTime() - 2_820_000));
    await queue.joinBack(ZONE_ID, DRIVER_A);
    jest.setSystemTime(new Date(NOW.getTime() - 180_000));
    await queue.joinBack(ZONE_AIRPORT, DRIVER_A);
    jest.setSystemTime(NOW);
    await queue.joinBack(ZONE_ID, DRIVER_B);

    const frame = await service.buildBoardState(CITY);
    const cascade = frame.rides[0]!.cascade;

    expect(cascade!.explanation).toEqual({
      key: 'explain.geozone_queue',
      // Centrs and 47 min — not «Lidosta RIX … 3 min».
      params: { zone: 'Centrs', position: 1, minutes: 47, eta: 4 },
    });
    expect(cascade!.nextDriverName).toBe('Anna Bērziņa');
  });

  it('reads every ride’s offers in ONE query, not one per ride (expected)', async () => {
    // This runs 30 times a minute forever. A per-ride read would make the
    // board's cost scale with the queue depth it exists to display.
    const { service, findOffersForRides } = build({
      rides: [
        boardRide(),
        boardRide({ id: '4f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c' }),
        boardRide({ id: '5f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c' }),
      ],
    });

    await service.buildBoardState(CITY);
    expect(findOffersForRides).toHaveBeenCalledTimes(1);
  });

  it('carries a tried-and-unheld ride as a cascade with no holder (edge)', async () => {
    const { service } = build({
      rides: [boardRide()], // back to `requested` between offers
      offers: [
        offer({ status: 'expired' }),
        offer({ status: 'declined', driverId: DRIVER_B }),
      ],
    });

    const frame = await service.buildBoardState(CITY);
    // Two attempts and nobody holding it is a different fact from never having
    // been offered, and Dina acts on the difference.
    expect(frame.rides[0]!.cascade).toEqual({
      offeredToDriverId: null,
      offeredToName: null,
      expiresAt: null,
      nextDriverName: null,
      attempts: 2,
      explanation: null,
    });
  });

  it('carries no cascade at all for a ride nothing has been offered on (failure)', async () => {
    const { service } = build({ rides: [boardRide()] });

    const frame = await service.buildBoardState(CITY);
    expect(frame.rides[0]!.cascade).toBeNull();
  });
});

describe('BoardService.emitFrame', () => {
  it('emits the built frame to the dispatch room (expected)', async () => {
    const { service, emitToDispatch } = build({ rides: [boardRide()] });

    await service.emitFrame();

    expect(emitToDispatch).toHaveBeenCalledWith(
      CITY,
      'dispatch:board',
      expect.objectContaining({ cityId: CITY }),
    );
  });

  it('skips the build entirely while the local dispatch room is empty (edge)', async () => {
    const { service, emitToDispatch, findBoardRides } = build({ roomSize: 0 });

    await service.emitFrame();

    expect(findBoardRides).not.toHaveBeenCalled();
    expect(emitToDispatch).not.toHaveBeenCalled();
  });

  it('logs a failed build instead of throwing — the next beat retries (failure)', async () => {
    const { service, emitToDispatch } = build({ buildThrows: true });

    await expect(service.emitFrame()).resolves.toBeUndefined();
    expect(emitToDispatch).not.toHaveBeenCalled();
    // The guard must reset, or one bad frame would silence the board forever.
    await expect(service.emitFrame()).resolves.toBeUndefined();
  });
});
