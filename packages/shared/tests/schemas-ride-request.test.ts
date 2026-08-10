import { describe, expect, it } from 'vitest';
import {
  rideCancelSchema,
  ridePaymentMethodUpdateSchema,
  rideRequestBodySchema,
  rideRequestSchema,
} from '../src/schemas/ride';

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

describe('rideRequestSchema', () => {
  const base = {
    riderId: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    pickup: { location: riga, address: 'Brīvības iela 1, Rīga' },
    destination: {
      location: { lat: 56.9236, lng: 23.9711 },
      address: 'Lidosta RIX',
    },
    paymentMethod: 'cash',
  };

  it('parses a minimal request with defaults (expected)', () => {
    const parsed = rideRequestSchema.parse(base);
    expect(parsed.category).toBe('standard');
    expect(parsed.vehicleCount).toBe(1);
    expect(parsed.stops).toEqual([]);
    expect(parsed.options.childSeat).toBe(false);
  });

  it('accepts a scheduled multi-taxi order with stops (edge — the differentiators)', () => {
    const parsed = rideRequestSchema.parse({
      ...base,
      stops: [{ location: riga, address: 'Autoosta, Rīga' }],
      scheduledFor: '2026-08-01T06:30:00.000Z',
      vehicleCount: 3,
    });
    expect(parsed.vehicleCount).toBe(3);
    expect(parsed.scheduledFor).toBeInstanceOf(Date);
  });

  it('rejects an unknown payment method (failure)', () => {
    expect(
      rideRequestSchema.safeParse({ ...base, paymentMethod: 'crypto' }).success,
    ).toBe(false);
  });

  it("takes a rider's bid through the cents primitive, zero included (failure — #30)", () => {
    expect(
      rideRequestSchema.parse({ ...base, offeredPriceCents: 1500 })
        .offeredPriceCents,
    ).toBe(1500);

    // A €0 bid is not a cheap ride, it is a missing one — which is why this
    // uses `positiveCentsSchema` and not `nonNegativeCentsSchema`. Zero is the
    // single value the two disagree on, so it is the one worth pinning.
    expect(
      rideRequestSchema.safeParse({ ...base, offeredPriceCents: 0 }).success,
    ).toBe(false);
    expect(
      rideRequestSchema.safeParse({ ...base, offeredPriceCents: -100 }).success,
    ).toBe(false);
    // The whole point of the money primitives: no float reaches an amount.
    expect(
      rideRequestSchema.safeParse({ ...base, offeredPriceCents: 15.5 }).success,
    ).toBe(false);
  });
});

describe('rideRequestBodySchema', () => {
  const body = {
    pickup: { location: riga, address: 'Brīvības iela 1, Rīga' },
    destination: {
      location: { lat: 56.9236, lng: 23.9711 },
      address: 'Lidosta RIX',
    },
    paymentMethod: 'cash',
  };

  it('applies every default without a riderId (expected)', () => {
    const parsed = rideRequestBodySchema.parse(body);
    expect(parsed.stops).toEqual([]);
    expect(parsed.category).toBe('standard');
    expect(parsed.options).toEqual({ childSeat: false, femaleDriver: false });
    expect(parsed.vehicleCount).toBe(1);
  });

  it('re-parses into a full RideRequest once the server adds its own riderId (edge)', () => {
    const parsed = rideRequestSchema.parse({
      ...rideRequestBodySchema.parse(body),
      riderId: uuid,
    });
    expect(parsed.riderId).toBe(uuid);
    expect(parsed.vehicleCount).toBe(1);
  });

  it('strips a smuggled riderId rather than trusting it (failure)', () => {
    // The identity comes from the JWT. zod strips unknown keys silently under
    // its default `strip` mode, so this does NOT throw — it drops the key, and
    // the server's own riderId is the only one that ever reaches the request.
    const parsed = rideRequestBodySchema.parse({ ...body, riderId: otherUuid });
    expect('riderId' in parsed).toBe(false);
  });

  it.each(['balance', 'corporate'])(
    'refuses %s — bookable methods are the settleable ones (failure — #70)',
    (paymentMethod) => {
      expect(
        rideRequestBodySchema.safeParse({ ...body, paymentMethod }).success,
      ).toBe(false);
    },
  );

  it('full rideRequestSchema still accepts balance — the persisted-snapshot property (edge — #70)', () => {
    // The narrowing is wire-only: `rideRequestSchema` is also the shape a
    // stored request snapshot re-parses through on DB reads, so a historical
    // `balance` snapshot must keep parsing.
    expect(
      rideRequestSchema.safeParse({
        ...body,
        paymentMethod: 'balance',
        riderId: uuid,
      }).success,
    ).toBe(true);
  });
});

describe('ridePaymentMethodUpdateSchema', () => {
  it('accepts a switch to card (expected)', () => {
    expect(
      ridePaymentMethodUpdateSchema.parse({ paymentMethod: 'card' })
        .paymentMethod,
    ).toBe('card');
  });

  it('rejects a method the platform does not take (failure)', () => {
    expect(
      ridePaymentMethodUpdateSchema.safeParse({ paymentMethod: 'crypto' })
        .success,
    ).toBe(false);
  });

  it('refuses a switch to balance — the booking restriction has no side door (failure — #70)', () => {
    expect(
      ridePaymentMethodUpdateSchema.safeParse({ paymentMethod: 'balance' })
        .success,
    ).toBe(false);
  });
});

describe('rideCancelSchema', () => {
  it('defaults reason to null — a cancel need not explain itself (edge)', () => {
    expect(rideCancelSchema.parse({}).reason).toBeNull();
  });
});
