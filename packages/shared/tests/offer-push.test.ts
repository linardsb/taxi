import { describe, expect, it } from 'vitest';
import {
  offerPushDataSchema,
  OFFER_PUSH_PAYLOAD_MAX_BYTES,
} from '../src/schemas/offer-push';

const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

/**
 * The seam this schema exists to hold: `dispatch-notifier.ts` builds the
 * envelope, `route-notification.ts` reads it back, and before #15's F7 both
 * sides were bare string literals with nothing spanning them. The consumer
 * suites on either side only ever feed it VALID input, so rejection — the
 * whole reason it became a schema — is tested here or nowhere.
 */
describe('offerPushDataSchema (#15)', () => {
  it('parses the full envelope the api builds when the offer fitted (expected)', () => {
    const offer = JSON.stringify({ id: OFFER_ID });
    expect(
      offerPushDataSchema.parse({
        kind: 'offer',
        offerId: OFFER_ID,
        rideId: RIDE_ID,
        offer,
      }),
    ).toEqual({ kind: 'offer', offerId: OFFER_ID, rideId: RIDE_ID, offer });
  });

  it('parses an ids-only envelope — `offer` is optional by contract (edge)', () => {
    // The size-dropped push: two unbounded addresses pushed the JSON past
    // OFFER_PUSH_PAYLOAD_MAX_BYTES, so the tap routes by the ids alone.
    expect(
      offerPushDataSchema.parse({
        kind: 'offer',
        offerId: OFFER_ID,
        rideId: RIDE_ID,
      }),
    ).toEqual({ kind: 'offer', offerId: OFFER_ID, rideId: RIDE_ID });
  });

  it('rejects another notification kind, so the nudge can never be read as an offer (failure)', () => {
    const result = offerPushDataSchema.safeParse({
      kind: 'nudge',
      offerId: OFFER_ID,
      rideId: RIDE_ID,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-uuid id rather than routing a tap at nothing (failure)', () => {
    expect(
      offerPushDataSchema.safeParse({
        kind: 'offer',
        offerId: 'not-a-uuid',
        rideId: RIDE_ID,
      }).success,
    ).toBe(false);
    expect(
      offerPushDataSchema.safeParse({
        kind: 'offer',
        offerId: OFFER_ID,
        rideId: RIDE_ID,
        // Expo forwards `data` verbatim and does not preserve types: a nested
        // object never survives the wire, which is why `offer` is JSON.
        offer: { id: OFFER_ID },
      }).success,
    ).toBe(false);
  });

  it('names the literal the app gates on before parsing (expected)', () => {
    // `route-notification.ts:28` reads this rather than repeating 'offer', so
    // changing the literal here cannot leave the app's gate behind.
    expect(offerPushDataSchema.shape.kind.value).toBe('offer');
    expect(OFFER_PUSH_PAYLOAD_MAX_BYTES).toBe(2_048);
  });
});
