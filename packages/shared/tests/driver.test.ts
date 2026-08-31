import { describe, expect, it } from 'vitest';
import {
  driverEarningsTodaySchema,
  driverMeSchema,
  driverProfileSchema,
  driverProfileUpdateSchema,
  driverStatusUpdateSchema,
  pushTokenUpdateSchema,
} from '../src/schemas/driver';
import {
  vehicleCreateSchema,
  vehicleUpdateSchema,
} from '../src/schemas/vehicle';
import { resolveCommissionPct } from '../src/commission';
import { platformConfigSchema } from '../src/schemas/platform-config';

const uuid = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const config15 = platformConfigSchema.parse({
  id: uuid,
  cityId: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  commissionPct: 15,
  driverDebtLimitCents: 5000,
  dispatchPhone: '+37160000000',
  updatedAt: '2026-08-03T09:00:00.000Z',
});

describe('driverProfileSchema', () => {
  it('parses a minimal profile with its defaults (expected)', () => {
    const parsed = driverProfileSchema.parse({ userId: uuid });
    expect(parsed.status).toBe('offline');
    expect(parsed.spokenLanguages).toEqual(['lv']);
    expect(parsed.balanceCents).toBe(0);
    expect(parsed.commissionPctOverride).toBeNull();
    expect(parsed.fleetId).toBeNull();
  });

  it('allows a negative balance — it is a signed ledger, not a counter (edge)', () => {
    // Guards the money-primitive choice: `balanceCents` is `centsSchema`
    // (signed), NOT `nonNegativeCentsSchema`. A swap would silently break the
    // documented "negative blocks new rides" behaviour, since the state could
    // never be reached. Same failure class as the `discountCents` sign guard.
    const parsed = driverProfileSchema.parse({
      userId: uuid,
      balanceCents: -1250,
    });
    expect(parsed.balanceCents).toBe(-1250);
  });

  it("carries a 0% override into the resolver (edge — S6-7, Atis's pilot)", () => {
    // 0 must survive both the schema default (`.default(null)` must not swallow
    // it) and the resolver's `!= null` check.
    const parsed = driverProfileSchema.parse({
      userId: uuid,
      commissionPctOverride: 0,
    });
    expect(parsed.commissionPctOverride).toBe(0);
    expect(resolveCommissionPct(parsed, config15)).toEqual({
      pct: 0,
      source: 'driver_override',
    });
  });

  it('satisfies CommissionDriverInput structurally (edge — the #27 seam)', () => {
    const parsed = driverProfileSchema.parse({
      userId: uuid,
      commissionPctOverride: 10,
    });
    expect(resolveCommissionPct(parsed, config15).source).toBe(
      'driver_override',
    );
  });

  it('rejects a float balance and an out-of-range override (failure)', () => {
    expect(
      driverProfileSchema.safeParse({ userId: uuid, balanceCents: 12.5 })
        .success,
    ).toBe(false);
    expect(
      driverProfileSchema.safeParse({
        userId: uuid,
        commissionPctOverride: 150,
      }).success,
    ).toBe(false);
    expect(
      driverProfileSchema.safeParse({ userId: uuid, rating: 6 }).success,
    ).toBe(false);
  });
});

describe('driverProfileUpdateSchema', () => {
  it('strips every field a driver may not write (edge — the privilege boundary at the contract)', () => {
    // The first half of the escalation defence: an allowlist, not a
    // `.partial()` of the profile. A driver who could PATCH their own
    // `commissionPctOverride` would set their commission to 0; `balanceCents`
    // would be free money; `status` would bypass the ride lifecycle.
    const parsed = driverProfileUpdateSchema.parse({
      isFemale: true,
      commissionPctOverride: 0,
      balanceCents: 999999,
      rating: 5,
      fleetId: uuid,
      status: 'online',
    });
    expect(parsed).toEqual({ isFemale: true });
  });

  it('rejects an empty patch and an empty language list (failure)', () => {
    // `{}` would reach Drizzle's `.set({})`, which throws — a 500 where the
    // client sent nonsense. `[]` would erase every language the driver speaks.
    expect(driverProfileUpdateSchema.safeParse({}).success).toBe(false);
    expect(
      driverProfileUpdateSchema.safeParse({ spokenLanguages: [] }).success,
    ).toBe(false);
  });

  it('parses a language change on its own (expected)', () => {
    const parsed = driverProfileUpdateSchema.parse({
      spokenLanguages: ['lv', 'ru'],
    });
    expect(parsed.spokenLanguages).toEqual(['lv', 'ru']);
  });
});

describe('driverStatusUpdateSchema', () => {
  it('accepts the two presences a driver owns (expected)', () => {
    expect(driverStatusUpdateSchema.parse({ status: 'online' }).status).toBe(
      'online',
    );
    expect(driverStatusUpdateSchema.parse({ status: 'offline' }).status).toBe(
      'offline',
    );
  });

  it('rejects on_ride (failure — #11 owns that transition)', () => {
    // A driver who could set `on_ride` by hand would hide from dispatch while
    // idle, or clear it mid-ride and take a second offer.
    expect(
      driverStatusUpdateSchema.safeParse({ status: 'on_ride' }).success,
    ).toBe(false);
  });
});

describe('vehicleCreateSchema', () => {
  const body = {
    plate: 'AB1234',
    make: 'Skoda',
    model: 'Octavia',
    year: 2019,
    passengerSeats: 4,
  };

  it('parses a body without id/driverId and applies both defaults (expected)', () => {
    const parsed = vehicleCreateSchema.parse(body);
    expect(parsed.category).toBe('standard');
    expect(parsed.hasChildSeat).toBe(false);
  });

  it('drops a client-supplied driverId (edge — ownership comes from the JWT)', () => {
    // Same boundary as the inbound location ping carrying no `driverId`: a body
    // that could name its owner would let a driver register a car on someone
    // else's account.
    const parsed = vehicleCreateSchema.parse({
      ...body,
      id: uuid,
      driverId: uuid,
    });
    expect(parsed).not.toHaveProperty('driverId');
    expect(parsed).not.toHaveProperty('id');
  });

  it("rejects a year before the schema's floor (failure)", () => {
    expect(vehicleCreateSchema.safeParse({ ...body, year: 1980 }).success).toBe(
      false,
    );
  });
});

describe('vehicleUpdateSchema', () => {
  it('leaves an absent defaulted key undefined rather than materializing the default (edge)', () => {
    // `.partial()` over `.default()` yields ZodOptional<ZodDefault<…>>. If this
    // ever flipped, a PATCH of the plate alone would silently reset `category`
    // to "standard" and `hasChildSeat` to false — a rider filter changing
    // itself behind the driver's back.
    const parsed = vehicleUpdateSchema.parse({ plate: 'XY9999' });
    expect(parsed.category).toBeUndefined();
    expect(parsed.hasChildSeat).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(['plate']);
  });

  it('rejects an empty patch (failure)', () => {
    expect(vehicleUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe('driverMeSchema', () => {
  it('round-trips a profile plus two vehicles (expected)', () => {
    const vehicle = (id: string, category: 'standard' | 'vip') => ({
      id,
      driverId: uuid,
      plate: 'AB1234',
      make: 'Skoda',
      model: 'Octavia',
      year: 2019,
      category,
      passengerSeats: 4,
      hasChildSeat: true,
    });

    const parsed = driverMeSchema.parse({
      profile: { userId: uuid },
      vehicles: [
        vehicle('1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', 'standard'),
        vehicle('2a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d', 'vip'),
      ],
    });

    expect(parsed.profile.status).toBe('offline');
    expect(parsed.vehicles).toHaveLength(2);
    expect(parsed.vehicles[1]!.category).toBe('vip');
  });
});

describe('pushTokenUpdateSchema (#14)', () => {
  it('accepts the classic ExponentPushToken form (expected)', () => {
    expect(
      pushTokenUpdateSchema.parse({
        token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      }).token,
    ).toBe('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]');
  });

  it('accepts the newer ExpoPushToken form (edge)', () => {
    expect(
      pushTokenUpdateSchema.safeParse({ token: 'ExpoPushToken[abc-DEF_123]' })
        .success,
    ).toBe(true);
  });

  it('rejects a raw FCM/APNs handle and an empty bracket (failure)', () => {
    // The seam posts to Expo's push API, which only understands its own
    // tokens; a raw device token here would be a guaranteed provider error
    // on every nudge.
    expect(pushTokenUpdateSchema.safeParse({ token: 'fcm:abc' }).success).toBe(
      false,
    );
    expect(
      pushTokenUpdateSchema.safeParse({ token: 'ExpoPushToken[]' }).success,
    ).toBe(false);
  });
});

describe('driverEarningsTodaySchema (#14)', () => {
  it('parses the home-card payload (expected)', () => {
    const parsed = driverEarningsTodaySchema.parse({
      day: '2026-08-31',
      timezone: 'Europe/Riga',
      earnedCents: 1734,
      rideCount: 2,
    });
    expect(parsed.earnedCents).toBe(1734);
  });

  it('accepts a zero day (edge)', () => {
    expect(
      driverEarningsTodaySchema.safeParse({
        day: '2026-08-31',
        timezone: 'Europe/Riga',
        earnedCents: 0,
        rideCount: 0,
      }).success,
    ).toBe(true);
  });

  it('rejects float cents, a negative total and a non-ISO day (failure)', () => {
    const ok = { day: '2026-08-31', timezone: 'Europe/Riga', rideCount: 1 };
    expect(
      driverEarningsTodaySchema.safeParse({ ...ok, earnedCents: 17.34 })
        .success,
    ).toBe(false);
    expect(
      driverEarningsTodaySchema.safeParse({ ...ok, earnedCents: -1 }).success,
    ).toBe(false);
    expect(
      driverEarningsTodaySchema.safeParse({
        ...ok,
        earnedCents: 1,
        day: '31.08.2026',
      }).success,
    ).toBe(false);
  });
});
