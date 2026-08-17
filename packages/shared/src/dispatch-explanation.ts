import { z } from 'zod';
import type { AssignmentSource } from './enums';
import type { MessageKey } from './i18n';

/**
 * THE one-line answer to "why this driver" (evidence F3.3). Composed HERE, in
 * shared, because Dina and the driver must read the IDENTICAL sentence — that
 * identity is what closes the fairness loop (S7-2). Two composers would drift
 * and the console would explain a different reason than the driver saw.
 *
 * Returns a `MessageKey` + params, NOT a formatted string: the console renders
 * LV and the driver app renders whatever the driver picked, and a string
 * composed server-side would pin both to one language. The caller passes the
 * result to `formatMessage(lang, key, params)`.
 */

/**
 * The wire shape of a composed explanation — what the board frame carries and
 * `#15`'s offer card will carry.
 *
 * `key` is a plain string here rather than a `z.enum` of `MessageKey`: the
 * catalog is a TypeScript type, and restating its 200-odd keys as a runtime
 * enum would put a second copy of the catalog on the wire schema, to be kept
 * in sync by hand. The producer is `explainAssignment` and nothing else, so
 * the type-level guarantee is where it belongs.
 */
export const dispatchExplanationSchema = z.object({
  key: z.string().min(1),
  params: z.record(z.union([z.string(), z.number()])),
});
export type DispatchExplanation = z.infer<typeof dispatchExplanationSchema>;

export interface ExplainAssignmentInput {
  /**
   * `AssignmentSource`, not a parallel tuple: the thing being explained is
   * exactly what `ride_offers.source` recorded, and a second enum here would
   * be one more list to keep in step with the strategies (#10).
   */
  strategy: AssignmentSource;
  /** Human zone name, or null when the pickup falls in no configured zone. */
  zoneName: string | null;
  /** 1-based, as `DispatchQueueStore` reports it. */
  queuePosition: number | null;
  /**
   * Time in the QUEUE — how long the driver has held their place, from the
   * store's join timestamp.
   *
   * NOT Autocab's time-since-last-job, which is a different number living in
   * Postgres and answering a different question ("who is idle?" rather than
   * "whose turn is it?"). The LV string says «zonā» for exactly this reason;
   * do not relabel it without changing what is measured.
   *
   * Null when the store has no join timestamp for the driver — see
   * `QueueSnapshotEntry.joinedAt`.
   */
  secondsInZone: number | null;
  etaSeconds: number;
}

/**
 * Never 0 minutes: mirrors `etaMinutesFromRoute`, so every surface that quotes
 * an ETA in this platform rounds it the same way. A 40-second drive that reads
 * "0 min away" is a promise nobody can keep.
 */
const etaMinutes = (seconds: number): number =>
  Math.max(1, Math.ceil(seconds / 60));

/**
 * Whole minutes elapsed, floored — 0 is a real and useful answer here ("just
 * pulled in"), which is why this does not share the ETA's never-0 rule.
 */
const zoneMinutes = (seconds: number | null): number =>
  seconds === null ? 0 : Math.floor(Math.max(0, seconds) / 60);

export function explainAssignment(input: ExplainAssignmentInput): {
  key: MessageKey;
  params: Record<string, string | number>;
} {
  if (input.strategy === 'dispatcher') {
    // No ETA: an override is not a claim about who was nearest, and printing
    // one beside «Dispečera izvēle» would read as the engine's justification
    // for a decision the engine did not make.
    return { key: 'explain.dispatcher', params: {} };
  }

  const eta = etaMinutes(input.etaSeconds);

  if (
    input.strategy === 'geozone_queue' &&
    input.zoneName !== null &&
    input.queuePosition !== null
  ) {
    return {
      key: 'explain.geozone_queue',
      params: {
        zone: input.zoneName,
        position: input.queuePosition,
        minutes: zoneMinutes(input.secondsInZone),
        eta,
      },
    };
  }

  if (input.strategy === 'geozone_queue') {
    // Queue mode ran but the rank is not knowable — an offer row whose
    // `queuePosition` is null, or a zone the catalog no longer has. It does
    // NOT fall through to «Tuvākais»: that would assert a distance ranking
    // that never ran. Say only the part that is true.
    return { key: 'explain.eta_only', params: { eta } };
  }

  return { key: 'explain.auto_match', params: { eta } };
}
