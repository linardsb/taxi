import type { LatLng } from '@taxi/shared';

export const DRIVER_LOCATION_STORE = 'DRIVER_LOCATION_STORE';

/** One driver's live position as dispatch sees it. `distanceMeters` is from the query centre. */
export interface NearbyDriver {
  driverId: string;
  location: LatLng;
  distanceMeters: number;
}

/**
 * The narrow slice of Redis the driver hot path uses. A port, not an
 * abstraction layer — same rationale as common/kv/kv.store.ts: it exists so the
 * suite runs without a Redis server, and so the "location writes never touch
 * Postgres" rule is provable rather than documented. There is exactly one
 * production implementation and nothing here is pluggable.
 *
 * Timestamps are milliseconds, not `Date`: Redis ZSET scores are numbers, and
 * keeping the port in the same unit removes a conversion at every call site and
 * makes the in-memory fake exact. The store holds no clock — every caller
 * supplies the time, which is what lets the fake test staleness without
 * sleeping (same trick as `InMemoryKeyValueStore.advance()`).
 */
export interface DriverLocationStore {
  /** Makes the driver eligible to have a position recorded. Idempotent. */
  markOnline(cityId: string, driverId: string): Promise<void>;

  /** Drops presence AND any recorded position — this is what "excludes offline drivers" means. */
  markOffline(cityId: string, driverId: string): Promise<void>;

  /**
   * Writes a position, but ONLY for a driver in the online set, and atomically
   * so — a read-then-write leaves a window in which a driver who just went
   * offline is re-added by their own straggler ping and gets offered a ride.
   * Returns false when the ping was ignored.
   */
  record(
    cityId: string,
    driverId: string,
    location: LatLng,
    atMs: number,
  ): Promise<boolean>;

  /** Nearest first. `freshSinceMs` drops positions from sockets that vanished without going offline. */
  findNearby(
    cityId: string,
    centre: LatLng,
    opts: { radiusMeters: number; limit: number; freshSinceMs: number },
  ): Promise<NearbyDriver[]>;

  /**
   * One driver's last recorded position, or null when none is recorded.
   * NO freshness filter, deliberately — the tracking page (#63) shows a stale
   * position with its timestamp rather than nothing, so the caller gets `atMs`
   * and decides. An explicit `markOffline` still drops the position, so an
   * offline driver reads null.
   */
  positionOf(
    cityId: string,
    driverId: string,
  ): Promise<{ location: LatLng; atMs: number } | null>;
}
