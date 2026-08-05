import { StubMapsProvider } from './stub-maps.provider';

const CENTRE = { lat: 56.9496, lng: 24.1052 };
const RIX = { lat: 56.9236, lng: 23.9711 };

describe('StubMapsProvider', () => {
  const maps = new StubMapsProvider();

  it('routes Rīga centre → RIX to a plausible distance and duration (expected)', async () => {
    const route = await maps.route(CENTRE, RIX);

    // Straight-line ≈ 8 634 m; × 1.35 winding ≈ 11 655 m. Asserted as a band
    // rather than the exact integer so a float-precision difference on another
    // platform does not fail the suite.
    expect(route.distanceMeters).toBeGreaterThan(11_000);
    expect(route.distanceMeters).toBeLessThan(12_500);

    // The duration IS a pure function of the distance at a flat 40 km/h, so
    // this one is exact.
    expect(route.durationSeconds).toBe(
      Math.round((route.distanceMeters / 1000 / 40) * 3600),
    );
    expect(route.polyline).toBe('');
  });

  it('returns a zero-length leg as 0/0 without dividing by zero (edge)', async () => {
    const route = await maps.route(CENTRE, CENTRE);
    expect(route.distanceMeters).toBe(0);
    expect(route.durationSeconds).toBe(0);
  });

  it('routes through intermediate stops, strictly lengthening the trip (edge)', async () => {
    const direct = await maps.route(CENTRE, RIX);
    const viaStop = await maps.route(CENTRE, RIX, [{ lat: 56.97, lng: 24.18 }]);
    expect(viaStop.distanceMeters).toBeGreaterThan(direct.distanceMeters);
  });

  it('throws on geocode, naming the ticket that must bind a real provider (failure)', () => {
    expect(() => maps.geocode()).toThrow(/#16/);
    expect(() => maps.reverseGeocode()).toThrow(
      /StubMapsProvider has no geocoder/,
    );
  });
});
