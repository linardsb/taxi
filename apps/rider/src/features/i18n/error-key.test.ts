import { errorMessageKey } from './error-key';

describe('errorMessageKey', () => {
  it("maps the api's own codes to rider catalog keys (expected)", () => {
    expect(errorMessageKey('place_not_found')).toBe(
      'rider.error.place_not_found',
    );
    expect(errorMessageKey('idempotent_request_in_progress')).toBe(
      'rider.error.idempotent_request_in_progress',
    );
  });

  it('falls back to generic for a code the catalog has never met (edge)', () => {
    // The fallback hides the real cause, which is why the catalog enumerates
    // every code this app can actually receive rather than discovering them.
    expect(errorMessageKey('something_new')).toBe('rider.error.generic');
  });

  it('refuses a prototype name rather than treating it as a key (failure)', () => {
    // `isMessageKey` uses `Object.hasOwn` for exactly this: `in` walks the
    // prototype chain, and `'toString'` would then reach `.replace` on a
    // FUNCTION.
    for (const inherited of ['toString', 'constructor', 'valueOf']) {
      expect(errorMessageKey(inherited)).toBe('rider.error.generic');
    }
  });

  it("does not leak the DRIVER app's keys through a shared code (edge)", () => {
    // `driver.error.vehicle_required` exists in the catalog; the rider prefix
    // means this app renders `generic` for it rather than a driver's copy.
    expect(errorMessageKey('vehicle_required')).toBe('rider.error.generic');
  });
});
