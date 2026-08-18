import type { DispatchBoardEvent } from '@taxi/shared';
import type { CascadeOfferRow } from '../dispatch.repository';
import { buildCascades, type CascadeContact } from './cascade';

type BoardZone = DispatchBoardEvent['zones'][number];

const RIDE = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const ZONE_ID = 'e0000000-0000-4000-8000-000000000001';
/** A second zone that sorts BEFORE `Centrs` — `listForCity` orders by name. */
const ZONE_AIRPORT = 'e0000000-0000-4000-8000-000000000002';
const DRIVER_A = 'd0000000-0000-4000-8000-000000000001';
const DRIVER_B = 'd0000000-0000-4000-8000-000000000002';
const DRIVER_C = 'd0000000-0000-4000-8000-000000000003';
const DRIVER_D = 'd0000000-0000-4000-8000-000000000004';
const DRIVER_E = 'd0000000-0000-4000-8000-000000000005';
const DRIVER_F = 'd0000000-0000-4000-8000-000000000006';
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
  /** The zone the ride was dispatched from — `undefined` means "the default one". */
  rideGeozoneId?: string | null;
}) =>
  buildCascades({
    offers: over.offers ?? [offer()],
    zones: over.zones ?? [zone()],
    rideZones: new Map([
      [RIDE, over.rideGeozoneId === undefined ? ZONE_ID : over.rideGeozoneId],
    ]),
    contacts: new Map(
      (
        over.contacts ?? [
          contact(),
          contact({ driverId: DRIVER_B, name: 'Anna Bērziņa' }),
          contact({ driverId: DRIVER_C, name: 'Kārlis Liepa' }),
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

  it('projects a dispatcher override as a settled assignment, not an offer (edge)', () => {
    // The ONLY dispatcher-sourced row any writer produces: `force-assign`
    // inserts it already `accepted` (the other `insertOffer` call site only
    // ever writes `auto_match`/`geozone_queue`). A `(dispatcher, pending)`
    // row does not exist, so `explain.dispatcher` is unreachable from the
    // board — the key stays justified for #15's driver app, where the offer
    // card IS pending. If the board should explain an override, that is a
    // projection change, not a fixture change.
    const cascade = build({
      offers: [offer({ source: 'dispatcher', status: 'accepted' })],
    }).get(RIDE);

    expect(cascade).toEqual({
      offeredToDriverId: null,
      offeredToName: null,
      expiresAt: null,
      nextDriverName: null,
      attempts: 1,
      explanation: null,
    });
  });

  it('explains the zone the RIDE came from when the holder is in two ranks (edge)', () => {
    // Jānis is #1 in Centrs and has also picked up an airport job, so he sits
    // in Lidosta's rank too. Lidosta sorts first (`listForCity` orders by
    // name), so a scan for "the zone holding this driver" finds the wrong one.
    //
    // Positions are 1 and 2 because a rank is always 1..n — `snapshotFrom`
    // derives them as `index + 1` over the whole list, so a two-entry zone
    // cannot hold a #4. Nothing here reads Lidosta's positions; they are
    // producible so the fixture stays one the runtime could have emitted.
    const cascade = build({
      zones: [
        zone({
          geozoneId: ZONE_AIRPORT,
          slug: 'lidosta',
          name: 'Lidosta RIX',
          entries: [
            {
              driverId: DRIVER_A,
              name: 'Jānis Ozols',
              phone: '+37129999001',
              position: 1,
              secondsInZone: 180,
              status: 'online',
            },
            {
              driverId: DRIVER_C,
              name: 'Kārlis Liepa',
              phone: '+37129999003',
              position: 2,
              secondsInZone: 30,
              status: 'online',
            },
          ],
        }),
        zone(),
      ],
    }).get(RIDE);

    expect(cascade?.explanation).toEqual({
      key: 'explain.geozone_queue',
      params: { zone: 'Centrs', position: 1, minutes: 47, eta: 4 },
    });
    // And "who is next" walks Centrs' rank, not Lidosta's.
    expect(cascade?.nextDriverName).toBe('Anna Bērziņa');
  });

  it('claims no zone at all when the ride carries no stamped one (edge)', () => {
    // A pickup in no configured zone. Says only the part that is true rather
    // than borrowing a zone name off whichever rank the holder is in.
    const cascade = build({ rideGeozoneId: null }).get(RIDE);

    expect(cascade?.explanation).toEqual({
      key: 'explain.eta_only',
      params: { eta: 4 },
    });
    expect(cascade?.nextDriverName).toBeNull();
  });

  it('skips an offline driver when naming who is next (failure)', () => {
    // The queue snapshot keeps offline drivers on purpose — a driver who went
    // offline holding position 1 is precisely what Dina resolves. The ENGINE's
    // candidate set does not: `findNearest` returns only the online set, and
    // `toCandidates` requires `status === 'online'`. Naming Anna here would
    // point Dina at a driver the cascade can never reach.
    const cascade = build({
      zones: [
        zone({
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
              secondsInZone: 900,
              status: 'offline',
            },
            {
              driverId: DRIVER_C,
              name: 'Kārlis Liepa',
              phone: '+37129999003',
              position: 3,
              secondsInZone: 60,
              status: 'online',
            },
          ],
        }),
      ],
    }).get(RIDE);

    expect(cascade?.nextDriverName).toBe('Kārlis Liepa');
  });

  it('still names who is next at the attempt cap, because the board cannot see the engine budget (edge)', () => {
    // `MAX_OFFER_ATTEMPTS` is 5 and this ride has 5 rows — but the board does
    // NOT stop naming a next driver here, and that is the rule under test.
    //
    // The engine's budget is release-scoped: `offerNext` counts only rows
    // written after `findLastReleasedAt` (#120's H3). This function counts every
    // row since booking. After a dispatcher release the two diverge — the engine
    // restarts at 0 while these 5 rows stay on the ride forever — so a cap
    // comparison here would tell Dina the cascade is spent while the engine is
    // mid-cascade. The frame carries no release timestamp to tell the two cases
    // apart, so the board declines to guess.
    //
    // Five rows means five DISTINCT drivers, because that is the only shape a
    // cascade can write: `findTriedDriverIds` returns every driver already
    // offered this ride, any status, and `offerNext` filters on it — "a driver
    // gets one shot at a given ride".
    //
    // The sixth entry is online and untried ON PURPOSE, and now carries the
    // assertion rather than discriminating against a guard: without Fēlikss the
    // rank is exhausted and `nextInQueue` returns null via the `find`, so the
    // case would pass whether or not a cap guard existed.
    const cascade = build({
      offers: [
        offer({ status: 'expired', driverId: DRIVER_B }),
        offer({ status: 'declined', driverId: DRIVER_C }),
        offer({ status: 'expired', driverId: DRIVER_D }),
        offer({ status: 'declined', driverId: DRIVER_E }),
        offer(), // pending, DRIVER_A — the fifth and last attempt
      ],
      zones: [
        zone({
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
              secondsInZone: 900,
              status: 'online',
            },
            {
              driverId: DRIVER_C,
              name: 'Kārlis Liepa',
              phone: '+37129999003',
              position: 3,
              secondsInZone: 600,
              status: 'online',
            },
            {
              driverId: DRIVER_D,
              name: 'Dace Krūmiņa',
              phone: '+37129999004',
              position: 4,
              secondsInZone: 420,
              status: 'online',
            },
            {
              driverId: DRIVER_E,
              name: 'Edgars Zariņš',
              phone: '+37129999005',
              position: 5,
              secondsInZone: 300,
              status: 'online',
            },
            {
              driverId: DRIVER_F,
              name: 'Fēlikss Bērzkalns',
              phone: '+37129999006',
              position: 6,
              secondsInZone: 120,
              status: 'online',
            },
          ],
        }),
      ],
    }).get(RIDE);

    expect(cascade?.attempts).toBe(5);
    expect(cascade?.nextDriverName).toBe('Fēlikss Bērzkalns');
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
