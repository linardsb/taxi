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
 *     driver was actually shown when the offer was written, and the one the
 *     driver app is MEANT to read once it exists (`apps/driver` has no `src/`
 *     yet; `schemas/ride.ts:160` already carries `queuePosition` on the offer,
 *     so that is design intent, not current behaviour). A `sendToBack` between
 *     offer-write and frame-build moves the live grid rank while the offer row
 *     keeps the old number, so the grid can legitimately say #2 beside a
 *     sentence saying #3. That is the
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
 * this can still name someone the engine will skip.
 *
 * The `status === 'online'` filter NARROWS that class, it does not close it.
 * `zone.entries` deliberately keeps offline drivers — that is the thing Dina
 * resolves — and `drivers.status` is the column `toCandidates` rejects on, so
 * an offline driver is never a candidate. But the engine's universe is
 * narrower still: `findNearest` also drops positions older than
 * `DRIVER_LOCATION_TTL_SECONDS` (60 s, `driver-location.policy.ts:15`), and
 * `drivers.status` is not tied to that window. An app that stopped pinging
 * while still marked online — backgrounded, permission revoked, a swallowed
 * `ingest` — is unreachable outright and can still be named here.
 *
 * Null outside queue mode, and that is honest rather than lazy — under
 * auto-match "who is next" depends on where every candidate is when the offer
 * lapses, so any name here would be a guess dressed as the engine's intent.
 * Re-running the strategy per ride per 2 s frame to find out is not a trade
 * the board is worth.
 *
 * NO `MAX_OFFER_ATTEMPTS` GUARD, and that is a stated limitation rather than an
 * oversight. The engine's remaining budget is RELEASE-SCOPED: both call sites
 * read `findLastReleasedAt` and pass it to `countAttempts`, which then counts
 * only rows with `sentAt` after that instant (`dispatch.repository.ts:205-215`,
 * #120's H3). The board's `attempts` is deliberately CUMULATIVE SINCE BOOKING —
 * `findOffersForRides` selects every row for the ride, any status, and no
 * `sentAt` — because "how many drivers has this ride been through" is what Dina
 * is asking. The two counts agree only while the ride has never been released,
 * and the frame cannot reconcile them: the release instant lives in
 * `dispatch_audit_log`, and a per-ride read per frame is exactly the cost
 * `board.service.ts:170-175` already declines to pay for `unclaimedSeconds`.
 *
 * So a cap comparison here would name nobody next for a released ride whose
 * cascade the engine has just restarted with a full budget — the strip reading
 * «the cascade is spent, this one is mine» while the engine is mid-cascade.
 * Naming a driver the engine may not reach is the imprecision this heuristic
 * already accepts; telling Dina the cascade is over when it is not inverts the
 * strip's whole point. Do not reinstate the guard without a release-scoped
 * count in the frame.
 */
function nextInQueue(
  zone: BoardZone | undefined,
  tried: ReadonlySet<string>,
): string | null {
  if (!zone?.queueModeEnabled) return null;
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
