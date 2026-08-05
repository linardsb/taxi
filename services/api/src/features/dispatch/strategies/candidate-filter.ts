import type { DriverCandidate, RideRequest } from '@taxi/shared';
import type { DriverMatchAttributes, NearbyDriver } from '../../drivers';
import { etaSecondsFor } from '../dispatch.policy';

/**
 * The eligibility filter both strategies share: a proximity list in, the
 * drivers who may actually be offered THIS ride out, nearest-first order
 * preserved.
 *
 * A pure function — no DI, no I/O — so it unit-tests directly and neither
 * strategy can drift from the other on who is eligible.
 */
export function toCandidates(
  nearby: NearbyDriver[],
  attrs: DriverMatchAttributes[],
  request: RideRequest,
): DriverCandidate[] {
  const byDriver = new Map(attrs.map((a) => [a.driverId, a]));
  const candidates: DriverCandidate[] = [];

  for (const driver of nearby) {
    const a = byDriver.get(driver.driverId);
    // A position in Redis with no Postgres row: presence and the durable record
    // disagree, and the durable one decides.
    if (!a) continue;

    // Checked against Postgres even though Redis already excludes offline
    // drivers: these are two stores, and `drivers.status` is the durable truth.
    if (a.status !== 'online') continue;

    if (!a.categories.includes(request.category)) continue;
    if (request.options.childSeat && !a.hasChildSeat) continue;

    // `=== true`, never truthiness: `isFemale` is `boolean | null` and `null`
    // means "not stated". A rider who asked for a female driver must not be
    // matched to an unknown.
    if (request.options.femaleDriver && a.isFemale !== true) continue;

    // `>= 0` rather than `> 0`: until #12's ledger exists every driver sits at
    // 0, and a strict check would match nobody. The negative-balance threshold
    // is a product question for that ticket.
    if (a.balanceCents < 0) continue;

    candidates.push({
      driverId: driver.driverId,
      location: driver.location,
      status: a.status,
      etaSeconds: etaSecondsFor(driver.distanceMeters),
    });
  }

  return candidates;
}
