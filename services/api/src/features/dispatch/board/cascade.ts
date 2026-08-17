import { explainAssignment, type DispatchBoardEvent } from '@taxi/shared';
import { MAX_OFFER_ATTEMPTS } from '../dispatch.policy';
import type { CascadeOfferRow } from '../dispatch.repository';

type BoardRideCascade = DispatchBoardEvent['rides'][number]['cascade'];
type BoardZone = DispatchBoardEvent['zones'][number];

/** Just enough of a driver row to name them. Any wider row also fits. */
export interface CascadeContact {
  driverId: string;
  name: string | null;
  phone: string;
}

export interface BuildCascadesInput {
  /** EVERY offer row for the frame's rides, from one batched read. */
  offers: readonly CascadeOfferRow[];
  /** The frame's zone rows — already built, and the only source of queue tenure. */
  zones: readonly BoardZone[];
  /**
   * rideId → the zone the ride was DISPATCHED from (`rides.geozoneId`), which
   * is the only thing that says WHICH queue this ride's cascade is walking.
   * A ride absent from the map, or mapped to null, has no stamped zone.
   */
  rideZones: ReadonlyMap<string, string | null>;
  contacts: ReadonlyMap<string, CascadeContact>;
}

/**
 * Per-ride cascade state: who holds the offer, when it lapses, who is next,
 * and the one-line reason (evidence F3.3 — dispatchers override confidently
 * only when they can see the logic).
 *
 * PURE. Takes the already-built zone rows rather than a queue store — one read
 * of the queue per frame.
 *
 * The two numbers in the explanation come from DIFFERENT places, on purpose:
 *   · TENURE («zonā 47 min») is the grid's, read off the same zone rows the
 *     panel beside it renders, so those two cannot disagree.
 *   · RANK («rinda #1») is `queuePosition` off the OFFER ROW — the number the
 *     driver was actually shown when the offer was written, which is also what
 *     the driver app reads. A `sendToBack` between offer-write and frame-build
 *     moves the live grid rank while the offer row keeps the old number, so the
 *     grid can legitimately say #2 beside a sentence saying #3. That is the
 *     right way round: `zone-rows.ts` never re-ranks either, because a grid
 *     that renumbered drivers would have Dina arbitrating a queue nobody
 *     else can see.
 *
 * Returns a map keyed by rideId; a ride absent from it has never been offered
 * and the console draws nothing for it. "Never offered" and "offered and
 * lapsed" are different facts and must not render the same.
 */
export function buildCascades(
  input: BuildCascadesInput,
): Map<string, NonNullable<BoardRideCascade>> {
  const byRide = new Map<string, CascadeOfferRow[]>();
  for (const offer of input.offers) {
    byRide.set(offer.rideId, [...(byRide.get(offer.rideId) ?? []), offer]);
  }

  const cascades = new Map<string, NonNullable<BoardRideCascade>>();
  for (const [rideId, offers] of byRide) {
    cascades.set(
      rideId,
      cascadeFor(offers, input, input.rideZones.get(rideId) ?? null),
    );
  }
  return cascades;
}

function cascadeFor(
  offers: readonly CascadeOfferRow[],
  input: BuildCascadesInput,
  geozoneId: string | null,
): NonNullable<BoardRideCascade> {
  // A ride has at most one pending offer — `revokePendingForRide` runs before
  // every new one. `find` rather than a filter+assert: if that ever breaks,
  // the board showing the first of two is a cosmetic wrong, not an outage.
  const pending = offers.find((o) => o.status === 'pending');
  const tried = new Set(offers.map((o) => o.driverId));

  if (!pending) {
    // Tried and currently held by nobody — the ride is between offers, or the
    // cascade gave up and it is Dina's. The attempt count is the whole point
    // of still emitting this.
    return {
      offeredToDriverId: null,
      offeredToName: null,
      expiresAt: null,
      nextDriverName: null,
      attempts: offers.length,
      explanation: null,
    };
  }

  const holderZone = zoneHolding(input.zones, geozoneId, pending.driverId);
  const holderEntry = holderZone?.entries.find(
    (e) => e.driverId === pending.driverId,
  );

  return {
    offeredToDriverId: pending.driverId,
    offeredToName: nameOf(input.contacts, pending.driverId),
    expiresAt: pending.expiresAt.toISOString(),
    nextDriverName: nextInQueue(holderZone, tried, offers.length),
    attempts: offers.length,
    explanation: explainAssignment({
      strategy: pending.source,
      zoneName: holderZone?.name ?? null,
      queuePosition: pending.queuePosition,
      secondsInZone: holderEntry?.secondsInZone ?? null,
      etaSeconds: pending.etaSeconds,
    }),
  };
}

/**
 * THE RIDE'S zone, and only if the holder is actually queued in it.
 *
 * By id, never by scanning for the driver: multi-zone membership is the steady
 * state, not an edge case. `GeozoneQueueStrategy` lazy-enrolls every eligible
 * candidate into whatever zone the RIDE'S pickup falls in, and nothing in
 * production calls `DispatchQueueStore.leave()` — so a driver working near a
 * boundary accumulates memberships across a shift. A scan returns whichever of
 * them the catalog happens to sort first (`listForCity` orders by name), which
 * is a zone name, a tenure and a "who is next" all belonging to some other ride.
 *
 * Undefined rather than a scan when the ride carries no stamped zone: the
 * explanation then falls to `explain.eta_only`, which says only the part that
 * is true.
 */
function zoneHolding(
  zones: readonly BoardZone[],
  geozoneId: string | null,
  driverId: string,
): BoardZone | undefined {
  if (geozoneId === null) return undefined;
  const zone = zones.find((z) => z.geozoneId === geozoneId);
  return zone?.entries.some((e) => e.driverId === driverId) ? zone : undefined;
}

/**
 * The next driver the queue would probably reach: the highest-ranked ONLINE
 * driver in this ride's rank who has not already been tried for it.
 *
 * A HEURISTIC OVER THE RANK, NOT A REPLAY OF `findCandidates`. The engine
 * starts from `findNearest` (the Redis online set with a live position) and
 * then filters by category, child seat, female-driver preference, debt limit
 * and the one-live-card-per-driver rule. None of that is modelled here, so
 * this can still name someone the engine will skip. What it no longer does is
 * name someone the engine CANNOT reach at all: `zone.entries` deliberately
 * keeps offline drivers — that is the thing Dina resolves — and an offline
 * driver is never a candidate.
 *
 * Null outside queue mode, and that is honest rather than lazy — under
 * auto-match "who is next" depends on where every candidate is when the offer
 * lapses, so any name here would be a guess dressed as the engine's intent.
 * Re-running the strategy per ride per 2 s frame to find out is not a trade
 * the board is worth.
 *
 * Null too once the ride has burned `MAX_OFFER_ATTEMPTS`: `offerNext` gives up
 * and raises it as unclaimed instead of offering again, so there is no next
 * driver to name — the strip must not point Dina at one while the engine is
 * handing the ride to her.
 *
 * `attempts` here is `offers.length` — the ROW COUNT for the ride, which is
 * what the board already reports as `attempts`. `offerNext` compares
 * `countAttempts` against the same cap but reads it BEFORE writing the new row,
 * so 5 rows with one pending means the engine gives up on the next tick rather
 * than this one. #120's H3 redefines what `countAttempts` counts; if it stops
 * meaning "rows for this ride", this comparison needs re-deriving with it.
 */
function nextInQueue(
  zone: BoardZone | undefined,
  tried: ReadonlySet<string>,
  attempts: number,
): string | null {
  if (!zone?.queueModeEnabled) return null;
  if (attempts >= MAX_OFFER_ATTEMPTS) return null;
  return (
    zone.entries.find((e) => e.status === 'online' && !tried.has(e.driverId))
      ?.name ?? null
  );
}

function nameOf(
  contacts: ReadonlyMap<string, CascadeContact>,
  driverId: string,
): string | null {
  const contact = contacts.get(driverId);
  if (!contact) return null;
  return contact.name ?? contact.phone;
}
