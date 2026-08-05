import { RIGA_CITY_ID } from '@taxi/db';
import { createTestApp, type TestApp } from '../../../test/harness';
import { GeozonesService } from './geozones.service';

/**
 * Integration, not unit: `ST_Contains` and `ST_Area` cannot be faked usefully —
 * a fake would only re-state the rule this spec exists to check.
 *
 * Every coordinate below was VERIFIED against the seeded polygons before being
 * asserted (a `ST_Contains` sweep over all four zones), not derived by reading
 * the rings. `autoosta` is the smallest zone of the four and overlaps old_town
 * east of lng 24.108, so the overlap point deliberately sits west of that — a
 * point at {56.946, 24.112} correctly resolves to autoosta, and picking it here
 * would have looked like a precedence bug.
 */
const CITY = RIGA_CITY_ID;

/** Inside RIX only — RIX overlaps no other zone. */
const IN_RIX = { lat: 56.9236, lng: 23.9711 };
/** Inside centre AND old_town, clear of autoosta. Smallest (old_town) must win. */
const IN_OVERLAP = { lat: 56.948, lng: 24.1 };
/** Inside centre only — clear of old_town and autoosta. */
const IN_CENTRE_ONLY = { lat: 56.96, lng: 24.085 };
/** Vidzeme countryside — inside no zone. */
const NOWHERE = { lat: 57.5, lng: 25.5 };

describe('GeozonesService (integration)', () => {
  let ctx: TestApp;
  let service: GeozonesService;

  beforeAll(async () => {
    ctx = await createTestApp();
    service = ctx.app.get(GeozonesService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('resolves a point in RIX to the queue-mode zone (expected)', async () => {
    const zone = await service.resolveForPoint(CITY, IN_RIX);

    expect(zone?.slug).toBe('rix');
    // Seeded true — this is AC #2's fixture, asserted rather than assumed.
    expect(zone?.queueModeEnabled).toBe(true);
  });

  it('resolves an overlap to the SMALLEST containing zone (edge)', async () => {
    const zone = await service.resolveForPoint(CITY, IN_OVERLAP);

    // Vecrīga is deliberately drawn inside centre; the more specific zone is
    // the more useful answer for queue mode and district stats alike.
    expect(zone?.slug).toBe('old_town');
    expect(zone?.queueModeEnabled).toBe(false);

    // The paired half: a centre point clear of every nested zone still resolves
    // to centre, so the case above is precedence and not "old_town always wins".
    const centre = await service.resolveForPoint(CITY, IN_CENTRE_ONLY);
    expect(centre?.slug).toBe('centre');
  });

  it('returns undefined for a point in no zone (failure)', async () => {
    // Legal, not an error: it means "use the city default dispatch mode".
    await expect(
      service.resolveForPoint(CITY, NOWHERE),
    ).resolves.toBeUndefined();
  });

  /**
   * ANTI-TRANSPOSITION. `ST_MakePoint(lng, lat)` takes longitude first and
   * `ST_Contains(polygon, point)` takes the polygon first; either reversed
   * returns false for every zone, every ride gets `geozoneId: null`, and queue
   * mode is silently disabled platform-wide.
   *
   * Rīga sits at lat ≈56.9 / lng ≈24.1, so a swapped pair is a valid Earth
   * coordinate in the Arabian Sea — inside no polygon. That is what makes the
   * swap detectable here; a same-hemisphere city would not expose it, and a
   * round-trip test cannot see a CONSISTENT swap at all.
   *
   * VERIFIED BY MUTATION: with the `ST_MakePoint` arguments swapped in
   * `geozones.repository.ts`, the two cases above go red (every lookup returns
   * undefined). Reverted and re-run green. Checked, not assumed.
   */
  it('finds no zone when lat and lng are transposed (failure)', async () => {
    const swapped = { lat: IN_RIX.lng, lng: IN_RIX.lat };

    await expect(
      service.resolveForPoint(CITY, swapped),
    ).resolves.toBeUndefined();
  });
});
