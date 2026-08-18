import { describe, expect, it } from 'vitest';
import {
  addressSearchQuerySchema,
  addressSuggestionSchema,
  callerLookupSchema,
  dispatcherBookingBodySchema,
  resolvePlaceBodySchema,
} from '../src';

const PICKUP = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Kaļķu iela 28, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta Rīga',
};

const booking = (over: Record<string, unknown> = {}) => ({
  callerPhone: '+37129999000',
  pickup: PICKUP,
  destination: DESTINATION,
  paymentMethod: 'cash',
  ...over,
});

describe('dispatcherBookingBodySchema', () => {
  it('accepts a minimal phone order and fills the ride defaults (expected)', () => {
    const parsed = dispatcherBookingBodySchema.parse(booking());

    // Inherited from `rideRequestBodySchema` — the dispatcher body is that
    // body plus caller fields, so every ride default must survive `.extend()`.
    expect(parsed.stops).toEqual([]);
    expect(parsed.category).toBe('standard');
    expect(parsed.vehicleCount).toBe(1);
    expect(parsed.options).toEqual({ childSeat: false, femaleDriver: false });
    expect(parsed.dispatcherNote).toBeNull();
  });

  it('strips a riderId smuggled into the body (failure)', () => {
    const parsed = dispatcherBookingBodySchema.parse(
      booking({ riderId: '00000000-0000-4000-8000-000000000001' }),
    );

    // The dispatcher names the phone that rang; the server resolves who that
    // is. A body-supplied rider id would make the audit row a fiction.
    expect(parsed).not.toHaveProperty('riderId');
  });

  it('rejects a caller phone that is not E.164 (failure)', () => {
    expect(
      dispatcherBookingBodySchema.safeParse(
        booking({ callerPhone: '29999000' }),
      ).success,
    ).toBe(false);
  });

  it('rejects a dispatcher note over 280 characters (edge)', () => {
    expect(
      dispatcherBookingBodySchema.safeParse(
        booking({ dispatcherNote: 'x'.repeat(281) }),
      ).success,
    ).toBe(false);
  });

  it('rejects a payment method settlement cannot finish (edge)', () => {
    expect(
      dispatcherBookingBodySchema.safeParse(
        booking({ paymentMethod: 'balance' }),
      ).success,
    ).toBe(false);
  });
});

describe('callerLookupSchema', () => {
  it('accepts a known caller with places and jobs (expected)', () => {
    const parsed = callerLookupSchema.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      customer: {
        id: '00000000-0000-4000-8000-000000000002',
        userId: '00000000-0000-4000-8000-000000000001',
        label: 'Hotel Roma',
        isVenue: true,
      },
      savedPlaces: [],
      recentRides: [
        {
          rideId: '00000000-0000-4000-8000-000000000003',
          pickup: PICKUP,
          destination: DESTINATION,
          bookedAt: '2026-08-01T10:00:00Z',
        },
      ],
    });

    expect(parsed.customer?.notes).toBeNull();
    expect(parsed.recentRides[0]?.bookedAt).toBeInstanceOf(Date);
  });

  it('accepts an app-only rider with no customer record (edge)', () => {
    const parsed = callerLookupSchema.parse({
      userId: '00000000-0000-4000-8000-000000000001',
      customer: null,
    });

    expect(parsed.customer).toBeNull();
    expect(parsed.savedPlaces).toEqual([]);
  });

  it('rejects more than three recent jobs (failure)', () => {
    const ride = {
      rideId: '00000000-0000-4000-8000-000000000003',
      pickup: PICKUP,
      destination: DESTINATION,
      bookedAt: '2026-08-01T10:00:00Z',
    };

    expect(
      callerLookupSchema.safeParse({
        userId: '00000000-0000-4000-8000-000000000001',
        customer: null,
        recentRides: [ride, ride, ride, ride],
      }).success,
    ).toBe(false);
  });
});

describe('address search contracts', () => {
  it('accepts a suggestion with an empty disambiguator (edge)', () => {
    const parsed = addressSuggestionSchema.parse({
      placeId: 'place-1',
      primaryText: 'Brīvības iela 45',
      secondaryText: '',
    });

    expect(parsed.placeId).toBe('place-1');
  });

  it('requires a uuid session token on both routes (failure)', () => {
    // The token is interpolated into the provider's URL on a route that spends
    // money — a free-form string there is a forgery surface.
    expect(
      addressSearchQuerySchema.safeParse({ q: 'briv', session: 'abc' }).success,
    ).toBe(false);
    expect(resolvePlaceBodySchema.safeParse({ session: 'abc' }).success).toBe(
      false,
    );
    expect(
      addressSearchQuerySchema.safeParse({
        q: 'briv',
        session: '00000000-0000-4000-8000-000000000abc',
      }).success,
    ).toBe(true);
  });

  it('rejects a query long enough to be an attack rather than an address (edge)', () => {
    expect(
      addressSearchQuerySchema.safeParse({
        q: 'x'.repeat(201),
        session: '00000000-0000-4000-8000-000000000abc',
      }).success,
    ).toBe(false);
  });
});
