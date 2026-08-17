import type { DispatchBoardEvent } from '@taxi/shared';
import type { CascadeOfferRow } from '../dispatch.repository';
import { buildCascades, type CascadeContact } from './cascade';

type BoardZone = DispatchBoardEvent['zones'][number];

const RIDE = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const ZONE_ID = 'e0000000-0000-4000-8000-000000000001';
const DRIVER_A = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_B = 'd0000000-0000-4000-8000-000000000002';
const EXPIRES = new Date('2026-08-15T12:00:12.000Z');

const offer = (over: Partial<CascadeOfferRow> = {}): CascadeOfferRow => ({
  rideId: RIDE,
  driverId: DRIVER_A,
  status: 'pending',
  source: 'geozone_queue',
  expiresAt: EXPIRES,
  etaSeconds: 240,
  queuePosition: 1,
  ...over,
});

const contact = (over: Partial<CascadeContact> = {}): CascadeContact => ({
  driverId: DRIVER_A,
  name: 'Jānis Ozols',
  phone: '+37129999001',
  ...over,
});

const zone = (over: Partial<BoardZone> = {}): BoardZone => ({
  geozoneId: ZONE_ID,
  slug: 'centrs',
  name: 'Centrs',
  queueModeEnabled: true,
  entries: [
    {
      driverId: DRIVER_A,
      name: 'Jānis Ozols',
      phone: '+37129999001',
      position: 1,
      secondsInZone: 2_820,
      status: 'online',
    },
    {
      driverId: DRIVER_B,
      name: 'Anna Bērziņa',
      phone: '+37129999002',
      position: 2,
      secondsInZone: 60,
      status: 'online',
    },
  ],
  ...over,
});

const build = (over: {
  offers?: CascadeOfferRow[];
  zones?: BoardZone[];
  contacts?: CascadeContact[];
}) =>
  buildCascades({
    offers: over.offers ?? [offer()],
    zones: over.zones ?? [zone()],
    contacts: new Map(
      (
        over.contacts ?? [
          contact(),
          contact({ driverId: DRIVER_B, name: 'Anna Bērziņa' }),
        ]
      ).map((c) => [c.driverId, c]),
    ),
  });

describe('buildCascades', () => {
  it('names the holder, the deadline, who is next and why (expected)', () => {
    const cascade = build({}).get(RIDE);

    expect(cascade).toEqual({
      offeredToDriverId: DRIVER_A,
      offeredToName: 'Jānis Ozols',
      expiresAt: EXPIRES.toISOString(),
      nextDriverName: 'Anna Bērziņa',
      attempts: 1,
      explanation: {
        key: 'explain.geozone_queue',
        // 47 min is the GRID's number, read off the zone rows rather than
        // recomputed — the two panels cannot disagree by construction.
        params: { zone: 'Centrs', position: 1, minutes: 47, eta: 4 },
      },
    });
  });

  it('skips a driver already tried when naming who is next (expected)', () => {
    const cascade = build({
      offers: [
        offer({ status: 'declined', driverId: DRIVER_B }),
        offer(), // pending, DRIVER_A
      ],
    }).get(RIDE);

    // B is next in the rank but has already refused this ride, and
    // `findTriedDriverIds`' rule is one shot per driver per ride.
    expect(cascade?.nextDriverName).toBeNull();
    expect(cascade?.attempts).toBe(2);
  });

  it('names nobody next outside queue mode rather than guessing (edge)', () => {
    const cascade = build({
      offers: [offer({ source: 'auto_match', queuePosition: null })],
      zones: [zone({ queueModeEnabled: false })],
    }).get(RIDE);

    expect(cascade?.nextDriverName).toBeNull();
    // Nor does it claim a queue rank the offer never had.
    expect(cascade?.explanation?.key).toBe('explain.auto_match');
  });

  it('explains a dispatcher override as a choice, not a ranking (edge)', () => {
    const cascade = build({
      offers: [offer({ source: 'dispatcher', queuePosition: null })],
    }).get(RIDE);

    expect(cascade?.explanation).toEqual({
      key: 'explain.dispatcher',
      params: {},
    });
  });

  it('keeps the attempt count when no offer is currently held (edge)', () => {
    const cascade = build({
      offers: [
        offer({ status: 'expired' }),
        offer({ status: 'declined', driverId: DRIVER_B }),
      ],
    }).get(RIDE);

    expect(cascade).toEqual({
      offeredToDriverId: null,
      offeredToName: null,
      expiresAt: null,
      nextDriverName: null,
      attempts: 2,
      explanation: null,
    });
  });

  it('omits a ride entirely when nothing was ever offered on it (failure)', () => {
    // Absent, not a zeroed object: "never offered" and "offered and lapsed"
    // are different facts and the console draws them differently.
    expect(build({ offers: [] }).has(RIDE)).toBe(false);
  });

  it('falls back to the phone when the holder has no display name (failure)', () => {
    const cascade = build({ contacts: [contact({ name: null })] }).get(RIDE);

    expect(cascade?.offeredToName).toBe('+37129999001');
  });
});
