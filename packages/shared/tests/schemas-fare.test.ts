import { describe, expect, it } from 'vitest';
import { splitFare } from '../src/commission';
import {
  assertFareQuoteConsistent,
  assertOfferSplitConsistent,
  fareQuoteSchema,
  isFareQuoteConsistent,
  isOfferSplitConsistent,
  rideOfferSchema,
} from '../src/schemas/ride';

const riga = { lat: 56.9496, lng: 24.1052 };
const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const otherUuid = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

/**
 * #29, settled: the breakdown must reconcile for the models where the total is
 * derived from it, and is free not to for `rider_bid`, where the total is the
 * rider's own offer. Encoded as a predicate rather than a `.refine()` so
 * `fareQuoteSchema` stays a plain ZodObject for #6's Drizzle insert shapes.
 */
describe('isFareQuoteConsistent', () => {
  const quote = (over: Record<string, unknown> = {}) => ({
    model: 'upfront_fixed',
    currency: 'EUR',
    totalCents: 2000,
    breakdown: {
      baseCents: 300,
      distanceCents: 1400,
      timeCents: 300,
      discountCents: 0,
    },
    ...over,
  });

  it('accepts a breakdown that sums to the total (expected)', () => {
    expect(isFareQuoteConsistent(fareQuoteSchema.parse(quote()))).toBe(true);
  });

  it('counts a discount toward the total (edge — the one negative term)', () => {
    const parsed = fareQuoteSchema.parse(
      quote({
        totalCents: 1800,
        breakdown: {
          baseCents: 300,
          distanceCents: 1400,
          timeCents: 300,
          discountCents: -200,
        },
      }),
    );
    expect(isFareQuoteConsistent(parsed)).toBe(true);
  });

  it('catches the breakdown that parses clean but does not reconcile (failure)', () => {
    // The exact shape from #29: schema-valid, and €20.00 of nothing.
    const parsed = fareQuoteSchema.parse(
      quote({
        breakdown: {
          baseCents: 1,
          distanceCents: 1,
          timeCents: 1,
          discountCents: -9000,
        },
      }),
    );

    // It still PARSES — that is the decision, not an oversight. The schema
    // cannot enforce this without becoming a ZodEffects, so the predicate is
    // what the write and emit boundaries call.
    expect(parsed.totalCents).toBe(2000);
    expect(isFareQuoteConsistent(parsed)).toBe(false);
    expect(() => assertFareQuoteConsistent(parsed)).toThrow(
      /does not sum to totalCents/,
    );
  });

  it('renders every breakdown term as its own addend (#55)', () => {
    // The message is what a fare mismatch is debugged from, so assert the
    // whole string: a missing separator ran `timeCents` and `discountCents`
    // together into one number that was never in the breakdown.
    const parsed = fareQuoteSchema.parse(
      quote({
        breakdown: {
          baseCents: 200,
          distanceCents: 80,
          timeCents: 150,
          discountCents: 0,
        },
      }),
    );

    expect(() => assertFareQuoteConsistent(parsed)).toThrow(
      'Quote breakdown 200+80+150+0 does not sum to totalCents 2000',
    );
  });

  it('leaves a rider_bid quote free not to reconcile (edge — why this is not a refine)', () => {
    // The total is the rider's own offer; the breakdown is an estimate of what
    // the ride is worth. A `.refine()` on the schema would make this
    // unrepresentable rather than merely inconsistent.
    const bid = fareQuoteSchema.parse(
      quote({ model: 'rider_bid', totalCents: 2500 }),
    );

    expect(bid.model).toBe('rider_bid');
    expect(isFareQuoteConsistent(bid)).toBe(false); // and that is allowed
  });
});

const quote = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 2000,
  breakdown: { baseCents: 300, distanceCents: 1400, timeCents: 300 },
};

describe('rideOfferSchema', () => {
  const base = {
    id: uuid,
    rideId: otherUuid,
    driverId: uuid,
    status: 'pending',
    source: 'auto_match',
    sentAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-03T10:00:20.000Z',
    etaSeconds: 240,
    pickup: { location: riga, address: 'Brīvības iela 1, Rīga' },
    destination: {
      location: { lat: 56.9236, lng: 23.9711 },
      address: 'Lidosta RIX',
    },
    quote,
    split: splitFare(2000, { pct: 15, source: 'platform_base' }),
  };

  it('parses a full offer carrying both the fare and the split (expected)', () => {
    const parsed = rideOfferSchema.parse(base);
    // The transparency wedge: the driver sees what the rider pays AND the cut.
    expect(parsed.quote.totalCents).toBe(2000);
    expect(parsed.split.commissionCents + parsed.split.driverNetCents).toBe(
      2000,
    );
    expect(parsed.split.driverNetCents).toBe(1700);
    expect(parsed.quote.breakdown.discountCents).toBe(0);
    expect(parsed.expiresAt).toBeInstanceOf(Date);
  });

  it('keeps the discount line non-positive after the money-primitive swap (failure)', () => {
    // Guards the fareQuoteSchema substitutions: `discountCents` must stay
    // nonpositive. A sign flip here would make a discount ADD to the fare.
    expect(
      rideOfferSchema.safeParse({
        ...base,
        quote: {
          ...quote,
          breakdown: { ...quote.breakdown, discountCents: 250 },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts a queue-sourced offer at the head of the queue (edge)', () => {
    const parsed = rideOfferSchema.parse({
      ...base,
      source: 'geozone_queue',
      queuePosition: 1,
    });
    expect(parsed.queuePosition).toBe(1);
  });

  it('rejects a queue position of 0 (failure)', () => {
    expect(
      rideOfferSchema.safeParse({ ...base, queuePosition: 0 }).success,
    ).toBe(false);
  });

  it('ties the split to the quote it splits (edge — the two halves of S2-5)', () => {
    expect(isOfferSplitConsistent(rideOfferSchema.parse(base))).toBe(true);
    // Same reason rideSchema stays plain: #6 needs .omit() for a ride_offers insert shape.
    expect(() => rideOfferSchema.omit({ id: true })).not.toThrow();
  });

  it('throws when split.totalCents drifts from quote.totalCents (failure)', () => {
    // Parses clean — fareSplitSchema only proves the split sums to ITS OWN
    // total. Unguarded, the driver's card reads "€20.00 fare · you keep €4.25".
    const drifted = rideOfferSchema.parse({
      ...base,
      split: splitFare(500, { pct: 15, source: 'platform_base' }),
    });
    expect(isOfferSplitConsistent(drifted)).toBe(false);
    expect(() => assertOfferSplitConsistent(drifted)).toThrow(
      /does not match quote.totalCents/,
    );
  });
});
