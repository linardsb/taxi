import type { LatLng } from '@taxi/shared';
import type { DriverLocationStore } from '../src/features/drivers';

/**
 * ONE fixture, run against BOTH implementations of `DriverLocationStore` — the
 * in-memory fake the whole suite depends on, and (opt-in, `REDIS_TEST_URL`) the
 * real ioredis GEO store. That is what keeps the fake honest: an ordering
 * guarantee the fake invents but Redis does not have would be invisible
 * otherwise.
 *
 * ASSERT ORDER AND MEMBERSHIP, NEVER ABSOLUTE DISTANCES. The fake's haversine
 * and Redis's geohash distance disagree by a few metres by construction.
 */

/** Brīvības piemineklis. */
export const CONTRACT_CENTRE: LatLng = { lat: 56.9512, lng: 24.1136 };
export const CONTRACT_RADIUS_METERS = 5_000;

/**
 * Chosen so a lat/lng transposition ANYWHERE in the stack inverts the answer.
 * At this latitude a degree of longitude is ~60,714 m against ~111,132 m for
 * latitude, so:
 *
 *   driver  | offset       | true distance      | if lat/lng were swapped
 *   east    | lng +0.0100  | ~607 m   (1st)     | ~1,111 m (2nd)
 *   north   | lat +0.0080  | ~889 m   (2nd)     | ~813 m   (1st)
 *   far     | lat +0.0350  | ~3,890 m (3rd)     | ~3,556 m (3rd)
 *   outside | lat +0.1000  | ~11,113 m excluded | ~10,160 m still excluded
 *
 * The 282 m gap between the first two is an order of magnitude wider than the
 * two implementations' disagreement, so the assertion is stable across both.
 * Do NOT "simplify" these offsets — the fixture IS the transposition detector.
 */
export const CONTRACT_DRIVERS = {
  east: {
    id: 'c0000000-0000-4000-8000-0000000000e1',
    location: { lat: CONTRACT_CENTRE.lat, lng: CONTRACT_CENTRE.lng + 0.01 },
  },
  north: {
    id: 'c0000000-0000-4000-8000-0000000000a1',
    location: { lat: CONTRACT_CENTRE.lat + 0.008, lng: CONTRACT_CENTRE.lng },
  },
  far: {
    id: 'c0000000-0000-4000-8000-0000000000f1',
    location: { lat: CONTRACT_CENTRE.lat + 0.035, lng: CONTRACT_CENTRE.lng },
  },
  outside: {
    id: 'c0000000-0000-4000-8000-0000000000d1',
    location: { lat: CONTRACT_CENTRE.lat + 0.1, lng: CONTRACT_CENTRE.lng },
  },
  centre: {
    id: 'c0000000-0000-4000-8000-0000000000c1',
    location: CONTRACT_CENTRE,
  },
} as const;

/** Every id the fixture touches — a real-Redis run cleans exactly these. */
export const CONTRACT_DRIVER_IDS = Object.values(CONTRACT_DRIVERS).map(
  (d) => d.id,
);

/** Fixed: the store holds no clock, so the caller supplies every timestamp. */
const NOW = 1_800_000_000_000;

/**
 * @param makeStore runs before EVERY case and must hand back an empty store.
 * @param opts.cityId namespace for the keys — a real-Redis run passes a
 *   per-worker value, because jest workers share the one server.
 * @param opts.cleanup runs once at the end (close connections, drop keys).
 */
export function runDriverLocationStoreContract(
  name: string,
  makeStore: () => Promise<DriverLocationStore> | DriverLocationStore,
  opts?: { cityId?: string; cleanup?: () => Promise<void> },
): void {
  describe(`${name} (DriverLocationStore contract)`, () => {
    const cityId = opts?.cityId ?? 'contract-city';
    let store: DriverLocationStore;

    const query = (freshSinceMs = NOW - 60_000) =>
      store.findNearby(cityId, CONTRACT_CENTRE, {
        radiusMeters: CONTRACT_RADIUS_METERS,
        limit: 10,
        freshSinceMs,
      });

    /** Online, then one accepted position each. */
    async function seed(
      drivers: readonly { id: string; location: LatLng }[],
      atMs = NOW,
    ): Promise<void> {
      for (const d of drivers) {
        await store.markOnline(cityId, d.id);
        await store.record(cityId, d.id, d.location, atMs);
      }
    }

    beforeEach(async () => {
      store = await makeStore();
    });

    if (opts?.cleanup) afterAll(opts.cleanup);

    it('returns the in-radius drivers nearest first (expected — and detects a lat/lng transposition)', async () => {
      // A swap on BOTH the write and the read path is invisible to a
      // round-trip test; it is visible here, because `east` and `north` change
      // places when the axes are transposed.
      const { east, north, far, outside } = CONTRACT_DRIVERS;
      await seed([outside, far, north, east]); // insertion order deliberately wrong

      const found = await query();
      expect(found.map((d) => d.driverId)).toEqual([east.id, north.id, far.id]);
    });

    it('round-trips a position written at the centre (expected — a write-path-only swap)', async () => {
      await seed([CONTRACT_DRIVERS.centre]);

      const [found] = await query();
      expect(found?.driverId).toBe(CONTRACT_DRIVERS.centre.id);
      expect(found?.distanceMeters).toBeLessThan(5);
      expect(found?.location.lat).toBeCloseTo(CONTRACT_CENTRE.lat, 3);
      expect(found?.location.lng).toBeCloseTo(CONTRACT_CENTRE.lng, 3);
    });

    it('drops a driver who went offline (edge)', async () => {
      const { east, north } = CONTRACT_DRIVERS;
      await seed([east, north]);

      await store.markOffline(cityId, east.id);

      expect((await query()).map((d) => d.driverId)).toEqual([north.id]);
    });

    it('drops a position older than the freshness window (edge)', async () => {
      const { east, north } = CONTRACT_DRIVERS;
      await seed([east], NOW - 120_000); // two minutes ago — still online, still a GEO member
      await seed([north], NOW);

      expect((await query()).map((d) => d.driverId)).toEqual([north.id]);
    });

    it('omits a driver marked online who has never pinged (edge)', async () => {
      // Presence is not a position. A candidate with no location is one
      // dispatch cannot route to.
      await store.markOnline(cityId, CONTRACT_DRIVERS.east.id);

      expect(await query()).toEqual([]);
    });

    it('refuses to record for a driver never marked online (failure)', async () => {
      const { east } = CONTRACT_DRIVERS;

      expect(await store.record(cityId, east.id, east.location, NOW)).toBe(
        false,
      );
      expect(await query()).toEqual([]);
    });

    it('positionOf round-trips the recorded position with its timestamp (expected)', async () => {
      const { east } = CONTRACT_DRIVERS;
      await seed([east]);

      const pos = await store.positionOf(cityId, east.id);
      expect(pos?.atMs).toBe(NOW);
      expect(pos?.location.lat).toBeCloseTo(east.location.lat, 3);
      expect(pos?.location.lng).toBeCloseTo(east.location.lng, 3);
    });

    it('positionOf returns null for a driver never seen (edge)', async () => {
      expect(
        await store.positionOf(cityId, CONTRACT_DRIVERS.east.id),
      ).toBeNull();
    });

    it('positionOf still reads a position too stale for findNearby (edge — tracking outlives dispatchability)', async () => {
      // The tracking page shows a stale position with its timestamp; dispatch
      // must not offer to it. Same store, two deliberate answers.
      const { east } = CONTRACT_DRIVERS;
      await seed([east], NOW - 120_000);

      expect(await query()).toEqual([]);
      expect((await store.positionOf(cityId, east.id))?.atMs).toBe(
        NOW - 120_000,
      );
    });

    it('positionOf reads nothing after markOffline (failure)', async () => {
      const { east } = CONTRACT_DRIVERS;
      await seed([east]);

      await store.markOffline(cityId, east.id);

      expect(await store.positionOf(cityId, east.id)).toBeNull();
    });

    it('listOnline returns every online driver with position and timestamp (expected)', async () => {
      const { east, north } = CONTRACT_DRIVERS;
      await seed([east, north]);

      const online = await store.listOnline(cityId);
      // SMEMBERS gives no order guarantee — assert membership, not sequence.
      expect(online.map((d) => d.driverId).sort()).toEqual(
        [east.id, north.id].sort(),
      );
      const foundEast = online.find((d) => d.driverId === east.id);
      expect(foundEast?.lastSeenMs).toBe(NOW);
      expect(foundEast?.location?.lat).toBeCloseTo(east.location.lat, 3);
      expect(foundEast?.location?.lng).toBeCloseTo(east.location.lng, 3);
    });

    it('listOnline carries a never-pinged driver as nulls, not an omission (edge)', async () => {
      // Presence without a position is still a person Dina can phone — the
      // opposite answer to findNearby's, on purpose.
      await store.markOnline(cityId, CONTRACT_DRIVERS.east.id);

      expect(await store.listOnline(cityId)).toEqual([
        {
          driverId: CONTRACT_DRIVERS.east.id,
          location: null,
          lastSeenMs: null,
        },
      ]);
    });

    it('listOnline still lists a driver too stale for findNearby (edge)', async () => {
      const { east } = CONTRACT_DRIVERS;
      await seed([east], NOW - 120_000);

      expect(await query()).toEqual([]);
      const online = await store.listOnline(cityId);
      expect(online.map((d) => d.driverId)).toEqual([east.id]);
      expect(online[0]?.lastSeenMs).toBe(NOW - 120_000);
    });

    it('listOnline drops a driver after markOffline and reads an empty city as [] (failure)', async () => {
      const { east } = CONTRACT_DRIVERS;
      await seed([east]);
      await store.markOffline(cityId, east.id);

      expect(await store.listOnline(cityId)).toEqual([]);
    });
  });
}
