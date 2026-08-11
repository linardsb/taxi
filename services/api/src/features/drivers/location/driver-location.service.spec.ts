import { Test } from '@nestjs/testing';
import { RT, type DriverLocationEvent } from '@taxi/shared';
import {
  CONTRACT_CENTRE,
  CONTRACT_DRIVERS,
} from '../../../../test/driver-location-store.contract';
import { InMemoryDriverLocationStore } from '../../../../test/harness';
import { APP_ENV } from '../../../common/config/env.schema';
import { DRIZZLE } from '../../../common/db/db.module';
import { RealtimeService } from '../../realtime';
import { DRIVER_LOCATION_TTL_SECONDS } from './driver-location.policy';
import { DriverLocationService } from './driver-location.service';
import { DRIVER_LOCATION_STORE } from './driver-location.store';

const CITY = '00000000-0000-4000-8000-0000000000c1';
const DRIVER_ID = 'aa1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e21';

/** AC 2, enforced: any Postgres access anywhere on the ingest path explodes here. */
const throwingDb = new Proxy(
  {},
  {
    get() {
      throw new Error('the location hot path must not touch Postgres');
    },
  },
);

describe('DriverLocationService', () => {
  let service: DriverLocationService;
  let store: InMemoryDriverLocationStore;
  let emitToDispatch: jest.Mock;

  beforeEach(async () => {
    store = new InMemoryDriverLocationStore();
    emitToDispatch = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DriverLocationService,
        { provide: DRIVER_LOCATION_STORE, useValue: store },
        // A hand-rolled spy, not the real service: instantiating that one drags
        // in RealtimeGateway and a live server. The RT_EVENT_SCHEMAS parse is
        // covered by driver-location.gateway.spec.ts, which uses the real one.
        { provide: RealtimeService, useValue: { emitToDispatch } },
        { provide: APP_ENV, useValue: { DEFAULT_CITY_ID: CITY } },
        { provide: DRIZZLE, useValue: throwingDb },
      ],
    }).compile();

    service = moduleRef.get(DriverLocationService);
  });

  const ping = (at = new Date().toISOString()) => ({
    location: CONTRACT_CENTRE,
    at,
  });

  it('records the position and fans it out to the dispatch room (expected)', async () => {
    await store.markOnline(CITY, DRIVER_ID);

    await service.ingest(DRIVER_ID, ping());

    expect((await store.positionOf(CITY, DRIVER_ID))?.location).toEqual(
      CONTRACT_CENTRE,
    );
    expect(emitToDispatch).toHaveBeenCalledTimes(1);
    const [cityId, event, payload] = emitToDispatch.mock.calls[0] as [
      string,
      string,
      DriverLocationEvent,
    ];
    expect(cityId).toBe(CITY);
    expect(event).toBe(RT.driverLocation);
    expect(payload.driverId).toBe(DRIVER_ID);
    // ISO string on the wire, never a Date — RT_EVENT_SCHEMAS would throw.
    expect(typeof payload.at).toBe('string');
    expect(new Date(payload.at).toISOString()).toBe(payload.at);
  });

  it('never touches Postgres on the ping path (expected — AC 2)', async () => {
    // The DRIZZLE provider above throws on ANY property access. This test
    // fails the day someone adds a database read or write to the hot path.
    await store.markOnline(CITY, DRIVER_ID);

    await expect(service.ingest(DRIVER_ID, ping())).resolves.toBeUndefined();
    expect(store.recorded).toHaveLength(1);
  });

  it('ignores a ping from a driver who is not online (edge)', async () => {
    await service.ingest(DRIVER_ID, ping());

    expect(store.recorded).toHaveLength(0);
    expect(emitToDispatch).not.toHaveBeenCalled();
  });

  it("stamps the server's clock, not the ping's (edge)", async () => {
    // A client clock deciding freshness means a skewed or hostile phone stays
    // dispatchable forever, or evaporates instantly.
    await store.markOnline(CITY, DRIVER_ID);
    const clientAt = '2020-01-01T00:00:00.000Z';

    await service.ingest(DRIVER_ID, ping(clientAt));

    const [, , payload] = emitToDispatch.mock.calls[0] as [
      string,
      string,
      DriverLocationEvent,
    ];
    expect(payload.at).not.toBe(clientAt);
    expect((await store.positionOf(CITY, DRIVER_ID))!.atMs).toBeGreaterThan(
      Date.parse(clientAt),
    );
  });

  describe('findNearest', () => {
    const online = async (
      driver: { id: string; location: { lat: number; lng: number } },
      atMs = Date.now(),
    ) => {
      await store.markOnline(CITY, driver.id);
      await store.record(CITY, driver.id, driver.location, atMs);
    };

    it('returns candidates nearest first (expected)', async () => {
      const { east, north, far, outside } = CONTRACT_DRIVERS;
      await online(outside);
      await online(far);
      await online(north);
      await online(east);

      const found = await service.findNearest(CONTRACT_CENTRE);

      expect(found.map((d) => d.driverId)).toEqual([east.id, north.id, far.id]);
    });

    it('excludes a driver who went offline (edge)', async () => {
      const { east, north } = CONTRACT_DRIVERS;
      await online(east);
      await online(north);

      await store.markOffline(CITY, east.id);

      const found = await service.findNearest(CONTRACT_CENTRE);
      expect(found.map((d) => d.driverId)).toEqual([north.id]);
    });

    it('excludes a position older than the freshness window (edge)', async () => {
      const { east, north } = CONTRACT_DRIVERS;
      await online(east, Date.now() - (DRIVER_LOCATION_TTL_SECONDS + 5) * 1000);
      await online(north);

      const found = await service.findNearest(CONTRACT_CENTRE);
      expect(found.map((d) => d.driverId)).toEqual([north.id]);
    });
  });
});
