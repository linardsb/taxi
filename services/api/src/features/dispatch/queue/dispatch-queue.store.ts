export const DISPATCH_QUEUE_STORE = 'DISPATCH_QUEUE_STORE';

/**
 * The narrow slice of Redis the geozone queue uses — "izsaukumi rindas kārtībā"
 * (S7-2), a driver's earned place in an airport or coach-station rank.
 *
 * A port, not an abstraction layer — same rationale as
 * `driver-location.store.ts` and `common/kv/kv.store.ts`: it exists so the suite
 * can run the queue-fairness contract WITHOUT a Redis server, which is the only
 * reason AC #2's edge case executes on a machine with no `REDIS_TEST_URL`.
 * There is exactly one production implementation and nothing here is pluggable.
 *
 * The in-memory implementation is TEST-ONLY. It must never become an
 * env-conditional production fallback: an in-memory queue silently forgets
 * every driver's earned position on restart, and that is a fairness bug which
 * would never surface as an error.
 *
 * Positions are 1-BASED at this boundary. Redis lists are 0-based and the
 * conversion is owned here, because `queueEntrySchema.position` is 1-based and
 * its docblock assigns that conversion to this code.
 *
 * Four methods, deliberately. Resist adding `size()`/`snapshot()` — nothing
 * reads them until #19 draws a zone view.
 */
export interface DispatchQueueStore {
  /**
   * Appends a driver to the back of a zone's queue.
   *
   * IDEMPOTENT: a driver already in the queue keeps their earned position. That
   * is the whole fairness property — a re-join that reset it to last place
   * would punish a driver for being offered a ride.
   */
  joinBack(geozoneId: string, driverId: string): Promise<void>;

  /** Moves a driver to the back — what a decline costs them. */
  sendToBack(geozoneId: string, driverId: string): Promise<void>;

  /** Removes a driver entirely. A driver who never joined is a no-op, not a throw. */
  leave(geozoneId: string, driverId: string): Promise<void>;

  /** 1-based positions for the ids asked about; absent from the map = not queued. */
  positions(
    geozoneId: string,
    driverIds: string[],
  ): Promise<Map<string, number>>;
}
