import { explainAssignment, type DispatchBoardEvent } from '@taxi/shared';
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
  /** The frame's zone rows — already built, and the only source of queue rank. */
  zones: readonly BoardZone[];
  contacts: ReadonlyMap<string, CascadeContact>;
}

/**
 * Per-ride cascade state: who holds the offer, when it lapses, who is next,
 * and the one-line reason (evidence F3.3 — dispatchers override confidently
 * only when they can see the logic).
 *
 * PURE. Takes the already-built zone rows rather than a queue store, so the
 * rank in the explanation is byte-identical to the rank in the grid beside it
 * — one read of the queue per frame, and no way for the two panels to
 * disagree about who is where.
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
    cascades.set(rideId, cascadeFor(offers, input));
  }
  return cascades;
}

function cascadeFor(
  offers: readonly CascadeOfferRow[],
  input: BuildCascadesInput,
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

  const holderZone = zoneHolding(input.zones, pending.driverId);
  const holderEntry = holderZone?.entries.find(
    (e) => e.driverId === pending.driverId,
  );

  return {
    offeredToDriverId: pending.driverId,
    offeredToName: nameOf(input.contacts, pending.driverId),
    expiresAt: pending.expiresAt.toISOString(),
    nextDriverName: nextInQueue(holderZone, tried),
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

/** The zone whose QUEUE the holder is in — not the polygon they are standing in. */
function zoneHolding(
  zones: readonly BoardZone[],
  driverId: string,
): BoardZone | undefined {
  return zones.find((z) => z.entries.some((e) => e.driverId === driverId));
}

/**
 * The next driver the queue would reach: the highest-ranked one in the same
 * rank who has not already been tried for this ride.
 *
 * Null outside queue mode, and that is honest rather than lazy — under
 * auto-match "who is next" depends on where every candidate is when the offer
 * lapses, so any name here would be a guess dressed as the engine's intent.
 * Re-running the strategy per ride per 2 s frame to find out is not a trade
 * the board is worth.
 */
function nextInQueue(
  zone: BoardZone | undefined,
  tried: ReadonlySet<string>,
): string | null {
  if (!zone?.queueModeEnabled) return null;
  return zone.entries.find((e) => !tried.has(e.driverId))?.name ?? null;
}

function nameOf(
  contacts: ReadonlyMap<string, CascadeContact>,
  driverId: string,
): string | null {
  const contact = contacts.get(driverId);
  if (!contact) return null;
  return contact.name ?? contact.phone;
}
