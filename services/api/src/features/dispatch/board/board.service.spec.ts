import { dispatchBoardEventSchema } from '@taxi/shared';
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

  const geozones = {
    resolveForPoint: jest.fn(() =>
      Promise.resolve(
        over.zoneName === null || over.zoneName === undefined
          ? undefined
          : {
              id: CITY,
              slug: 'centre',
              name: over.zoneName,
              queueModeEnabled: false,
            },
      ),
    ),
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
