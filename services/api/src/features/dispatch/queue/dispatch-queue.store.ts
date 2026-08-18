export const DISPATCH_QUEUE_STORE = 'DISPATCH_QUEUE_STORE';

/** One driver's place in a zone queue, as the zone grid reads it (#19). */
export interface QueueSnapshotEntry {
  driverId: string;
  /** 1-based, and the SAME number `positions()` reports for this driver. */
  position: number;
  /**
   * ISO instant the driver took this place, or `null` when the store has no
   * record of one.
   *
   * Null is a real case, not defensive padding: drivers already queued when
   * this shipped have a list entry and no timestamp, and `joinBack` cannot
   * back-fill them — stamping an already-queued driver with `now` would report
   * a 40-minute wait as having just started, which is worse than admitting the
   * gap. The projection renders it as zero seconds and the next `sendToBack`
   * or re-join gives them a real one.
   *
   * The Redis store writes the entry and its stamp in one `MULTI` precisely so
   * that it never MANUFACTURES this case: a null here means legacy state, not
   * a torn write.
   */
  joinedAt: string | null;
}

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
 * Five methods. The fifth, `snapshot()`, was withheld until a reader existed —
 * #19 is that reader: the zone grid arbitrates S7-2 fairness, and it cannot
 * show a rank Dina can defend without reading the whole queue rather than
 * asking about ids it already knows. The prohibition is lifted for that reason
 * and no other: `size()` still has no caller and should still not be added.
 */
export interface DispatchQueueStore {
  /**
   * Appends a driver to the back of a zone's queue.
   *
   * IDEMPOTENT: a driver already in the queue keeps their earned position AND
   * their `joinedAt`. That is the whole fairness property — a re-join that
   * reset either would punish a driver for being offered a ride.
   */
  joinBack(geozoneId: string, driverId: string): Promise<void>;

  /**
   * Moves a driver to the back — what a decline costs them.
   *
   * Rewrites `joinedAt`, unlike `joinBack`: going to the back forfeits the
   * time you earned, which is the whole content of the penalty. A driver who
   * kept a 40-minute clock while sitting last would read as the zone's most
   * patient driver on Dina's grid.
   */
  sendToBack(geozoneId: string, driverId: string): Promise<void>;

  /** Removes a driver entirely, timestamp included. A driver who never joined is a no-op, not a throw. */
  leave(geozoneId: string, driverId: string): Promise<void>;

  /** 1-based positions for the ids asked about; absent from the map = not queued. */
  positions(
    geozoneId: string,
    driverIds: string[],
  ): Promise<Map<string, number>>;

  /**
   * The WHOLE queue, head first — what `positions()` cannot answer, because it
   * only reports on ids the caller already has. The zone grid has none: it
   * draws the rank itself.
   *
   * A driver appearing twice (the documented double-append race) is reported
   * ONCE, at their first occurrence, and the positions of everyone behind them
   * still count the duplicate — so the number here is byte-for-byte the one
   * `positions()` gives the same driver, and the one their app shows. Dina
   * arbitrating a queue with a different rank than the driver is reading is
   * the failure this identity exists to prevent; a transient gap in the
   * sequence is the smaller and self-correcting price.
   */
  snapshot(geozoneId: string): Promise<QueueSnapshotEntry[]>;
}

/**
 * The list → entries rule, shared by BOTH implementations.
 *
 * Here rather than duplicated because the port already owns the 0-based →
 * 1-based conversion (see above), and because the fake drifting from Redis on
 * exactly this rule is what `dispatch-queue-store.contract.ts` exists to catch
 * — a rule written twice can pass a contract that compares each impl only
 * against the fixture, never against the other.
 */
export function snapshotFrom(
  queue: readonly string[],
  joinedAt: (driverId: string) => string | null,
): QueueSnapshotEntry[] {
  const seen = new Set<string>();
  const entries: QueueSnapshotEntry[] = [];
  queue.forEach((driverId, index) => {
    if (seen.has(driverId)) return;
    seen.add(driverId);
    entries.push({
      driverId,
      position: index + 1, // Redis is 0-based; this port is 1-based
      joinedAt: joinedAt(driverId),
    });
  });
  return entries;
}
