import { dispatchBoardEventSchema, type LatLng } from '@taxi/shared';
import type { Env } from '../../../common/config/env.schema';
import { InMemoryDriverLocationStore } from '../../../../test/harness';
import type { DriversService, DriverBoardContact } from '../../drivers';
import type { GeozonesService } from '../../geozones';
import type { RealtimeService } from '../../realtime';
import type { BoardRide, RidesRepository } from '../../rides';
import { BoardService } from './board.service';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER_A = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_B = 'd0000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-08-15T12:00:00.000Z');

const boardRide = (over: Partial<BoardRide> = {}): BoardRide => ({
  id: RIDE_ID,
  status: 'requested',
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
  driverId: null,
  driverName: null,
  bookingChannel: 'phone',
  createdAt: new Date(NOW.getTime() - 90_000),
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
  } = {},
) {
  const locations = new InMemoryDriverLocationStore();

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

  const geozones = {
    resolveForPoint: jest.fn((_cityId: string, point: LatLng) => {
      const name = zoneNameFor(point);
      return Promise.resolve(
        name === undefined
          ? undefined
          : { id: CITY, slug: 'centre', name, queueModeEnabled: false },
      );
    }),
  } as unknown as GeozonesService;

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
    env,
  );
  return { service, locations, emitToDispatch, findBoardRides, geozones };
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
