import {
  assertOfferSplitConsistent,
  resolveCommissionPct,
  rideOfferSchema,
  splitFare,
  type AssignmentSource,
  type DriverCandidate,
  type FareQuote,
  type OfferStatus,
  type PlatformConfig,
  type RideRequest,
  type RideOffer,
} from '@taxi/shared';
import { randomUUID } from 'node:crypto';
import type { DriverMatchAttributes } from '../drivers';

export interface BuildOfferInput {
  rideId: string;
  request: RideRequest;
  quote: FareQuote;
  candidate: DriverCandidate;
  driverAttrs: DriverMatchAttributes;
  config: PlatformConfig;
  source: AssignmentSource;
  /** `pending` for a cascade offer; `accepted` for a dispatcher force-assign. */
  status: OfferStatus;
  /** Injected so the caller's clock is the one the expiry is measured against. */
  now?: Date;
}

/**
 * Builds the S2-5 transparency card.
 *
 * `quote.totalCents` is what the RIDER pays and the driver sees it IN FULL —
 * never the net. That asymmetry is the entire wedge: a driver cannot see what
 * Bolt's passenger paid, and here they can.
 *
 * The commission is re-resolved PER DRIVER rather than reusing #9's
 * platform-base preview, because a `commissionPctOverride` changes it and
 * reusing the preview "would show the wrong number on the card the whole pitch
 * rests on" (`rideCreatedSchema`).
 *
 * The quote comes from the ride's PERSISTED `total_cents` + `ride_fare_lines`
 * (`RidesRepository.findWithQuote`), never a fresh `PricingService.quote()`:
 * re-quoting mid-cascade would spend a paid Routes call per offer per round and
 * could change the price after the rider already agreed to it.
 *
 * The id is generated here rather than left to the column default: the offer is
 * parsed, split-checked and emitted before the row exists, and the emitted
 * `ride:offer` must carry the same id that `/offers/:offerId/accept` resolves.
 */
export function buildOffer(input: BuildOfferInput): RideOffer {
  const resolution = resolveCommissionPct(
    { commissionPctOverride: input.driverAttrs.commissionPctOverride },
    input.config,
  );
  const split = splitFare(input.quote.totalCents, resolution);

  const sentAt = input.now ?? new Date();
  const expiresAt = new Date(
    sentAt.getTime() + input.config.offerTimeoutSeconds * 1000,
  );

  const offer = rideOfferSchema.parse({
    id: randomUUID(),
    rideId: input.rideId,
    driverId: input.candidate.driverId,
    status: input.status,
    source: input.source,
    sentAt,
    expiresAt,
    etaSeconds: input.candidate.etaSeconds,
    pickup: input.request.pickup,
    destination: input.request.destination,
    quote: input.quote,
    split,
    ...(input.candidate.queuePosition === undefined
      ? {}
      : { queuePosition: input.candidate.queuePosition }),
  });

  // Per its own docblock: "Call at the write and emit boundaries (#10/#11)".
  // `fareSplitSchema` proves the split is internally consistent but cannot see
  // the quote beside it — without this, an offer built from a stale quote parses
  // clean and the card reads "€20.00 fare · you keep €4.25".
  assertOfferSplitConsistent(offer);

  return offer;
}
