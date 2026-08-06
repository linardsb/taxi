import type { LatLng, RideCategory, RigaPilotDistrict } from '@taxi/shared';
import { RIDE_CATEGORIES, RIGA_PILOT_DISTRICTS } from '@taxi/shared';
import type { Db } from '../client';
import { polygonToEwkt } from '../postgis';
import { cities, geozones, platformConfig, rideTariffs } from '../schema';

/** Fixed UUIDs — deterministic, so the seed is re-runnable and referenceable in tests. */
export const RIGA_CITY_ID = '00000000-0000-4000-8000-000000000001';
export const RIGA_CONFIG_ID = '00000000-0000-4000-8000-000000000002';

export const RIGA_TARIFF_IDS: Record<RideCategory, string> = {
  standard: '00000000-0000-4000-8000-000000000201',
  fastest: '00000000-0000-4000-8000-000000000202',
  limo: '00000000-0000-4000-8000-000000000203',
  vip: '00000000-0000-4000-8000-000000000204',
};

export const RIGA_ZONE_IDS: Record<RigaPilotDistrict, string> = {
  centre: '00000000-0000-4000-8000-000000000101',
  rix: '00000000-0000-4000-8000-000000000102',
  autoosta: '00000000-0000-4000-8000-000000000103',
  old_town: '00000000-0000-4000-8000-000000000104',
};

/**
 * Approximate hand-drawn rectangles — sanctioned by the ticket ("they're
 * config, editable later via #20"). Vecrīga deliberately overlaps centre;
 * zone-resolution precedence is #10's problem. Queue mode true only where the
 * anketa evidenced rank/queue culture (S7-2: RIX rank, Dina's autoosta queue).
 */
const ZONES: Record<
  RigaPilotDistrict,
  { name: string; ring: LatLng[]; queueModeEnabled: boolean }
> = {
  centre: {
    name: 'Rīgas centrs',
    ring: [
      { lat: 56.936, lng: 24.075 },
      { lat: 56.936, lng: 24.135 },
      { lat: 56.966, lng: 24.135 },
      { lat: 56.966, lng: 24.075 },
    ],
    queueModeEnabled: false,
  },
  rix: {
    name: 'Lidosta RIX',
    ring: [
      { lat: 56.908, lng: 23.95 },
      { lat: 56.908, lng: 23.995 },
      { lat: 56.935, lng: 23.995 },
      { lat: 56.935, lng: 23.95 },
    ],
    queueModeEnabled: true,
  },
  autoosta: {
    name: 'Rīgas autoosta',
    ring: [
      { lat: 56.941, lng: 24.108 },
      { lat: 56.941, lng: 24.122 },
      { lat: 56.949, lng: 24.122 },
      { lat: 56.949, lng: 24.108 },
    ],
    queueModeEnabled: true,
  },
  old_town: {
    name: 'Vecrīga',
    ring: [
      { lat: 56.943, lng: 24.095 },
      { lat: 56.943, lng: 24.115 },
      { lat: 56.953, lng: 24.115 },
      { lat: 56.953, lng: 24.095 },
    ],
    queueModeEnabled: false,
  },
};

/**
 * PLACEHOLDER RATES, fitted — not researched. The only real fare data that
 * exists is S5-1 (`centre → RIX €13`, `RIX → Teika €22`): €2.00 + €0.80/km +
 * €0.15/min reproduces the €13 centre→RIX trip at ~10.5 km / ~18 min. Only
 * `standard` has any evidence behind it; the other three are proportional
 * placeholders awaiting Atis's real numbers before any pilot.
 *
 * They live here, as rows, so #20 edits them without a deploy — nothing in
 * code may hardcode a rate. Same treatment as `commissionPct` below.
 */
const TARIFFS: Record<
  RideCategory,
  {
    baseCents: number;
    perKmCents: number;
    perMinuteCents: number;
    minimumFareCents: number;
  }
> = {
  standard: {
    baseCents: 200,
    perKmCents: 80,
    perMinuteCents: 15,
    minimumFareCents: 350,
  },
  fastest: {
    baseCents: 250,
    perKmCents: 95,
    perMinuteCents: 18,
    minimumFareCents: 400,
  },
  limo: {
    baseCents: 400,
    perKmCents: 140,
    perMinuteCents: 25,
    minimumFareCents: 700,
  },
  vip: {
    baseCents: 500,
    perKmCents: 175,
    perMinuteCents: 30,
    minimumFareCents: 900,
  },
};

/**
 * Idempotent: upserts keyed on the natural uniques, so re-runs converge instead
 * of duplicating. Caveat: only for seed-owned rows — if a same-name city or
 * same-slug zone pre-exists under a different id (e.g. created via the admin
 * panel, #20), the fixed-UUID exports above diverge from the actual rows.
 */
export async function seedRiga(db: Db): Promise<void> {
  await db
    .insert(cities)
    .values({ id: RIGA_CITY_ID, name: 'Rīga' })
    .onConflictDoUpdate({
      target: cities.name,
      set: { countryCode: 'LV', timezone: 'Europe/Riga' },
    });

  for (const slug of RIGA_PILOT_DISTRICTS) {
    const zone = ZONES[slug];
    const polygon = polygonToEwkt(zone.ring);
    await db
      .insert(geozones)
      .values({
        id: RIGA_ZONE_IDS[slug],
        cityId: RIGA_CITY_ID,
        slug,
        name: zone.name,
        polygon,
        queueModeEnabled: zone.queueModeEnabled,
      })
      .onConflictDoUpdate({
        target: [geozones.cityId, geozones.slug],
        set: {
          name: zone.name,
          polygon,
          queueModeEnabled: zone.queueModeEnabled,
        },
      });
  }

  // commissionPct 15 lives HERE, not as a column default — config, not constant
  // (launch decision 2026-08-03). Guarantees stay NULL until a pilot needs them.
  await db
    .insert(platformConfig)
    .values({ id: RIGA_CONFIG_ID, cityId: RIGA_CITY_ID, commissionPct: 15 })
    .onConflictDoUpdate({
      target: platformConfig.cityId,
      set: { commissionPct: 15 },
    });

  // Iterating RIDE_CATEGORIES (the shared const array) rather than the keys of
  // TARIFFS: adding a category to the enum without adding a rate card then
  // fails to TYPECHECK, instead of silently seeding one city three tariffs.
  for (const category of RIDE_CATEGORIES) {
    const tariff = TARIFFS[category];
    await db
      .insert(rideTariffs)
      .values({
        id: RIGA_TARIFF_IDS[category],
        cityId: RIGA_CITY_ID,
        category,
        ...tariff,
      })
      .onConflictDoUpdate({
        target: [rideTariffs.cityId, rideTariffs.category],
        set: tariff,
      });
  }
}
