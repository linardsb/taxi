import type { Env } from '../../common/config/env.schema';
import type {
  DriverLocationStore,
  DriverRosterContact,
  DriversService,
  OnlineDriver,
} from '../drivers';
import type { GeozonesService } from '../geozones';
import type { RidesRepository } from '../rides';
import { RosterService } from './roster.service';

const CITY = '00000000-0000-4000-8000-000000000001';
const ONLINE_DRIVER = 'd0000000-0000-4000-8000-000000000001';
const OFFLINE_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const BUSY_DRIVER = 'd0000000-0000-4000-8000-000000000003';
const RIDE_ID = 'ad000000-0000-4000-8000-000000000001';

const contact = (over: Partial<DriverRosterContact>): DriverRosterContact => ({
  driverId: ONLINE_DRIVER,
  name: 'Jānis Ozols',
  phone: '+37129999001',
  status: 'online',
  vehiclePlate: 'AB-1234',
  ...over,
});

function build(
  over: {
    contacts?: DriverRosterContact[];
    online?: OnlineDriver[];
    activeRides?: Array<{ driverId: string; rideId: string }>;
    zoneName?: string;
  } = {},
) {
  const resolveForPoint = jest.fn(() =>
    Promise.resolve(
      over.zoneName === undefined ? undefined : { name: over.zoneName },
    ),
  );

  const service = new RosterService(
    {
      findRosterContacts: jest.fn(() =>
        Promise.resolve(over.contacts ?? [contact({})]),
      ),
    } as unknown as DriversService,
    {
      listOnline: jest.fn(() => Promise.resolve(over.online ?? [])),
    } as unknown as DriverLocationStore,
    { resolveForPoint } as unknown as GeozonesService,
    {
      findActiveRideIdsByDriver: jest.fn(() =>
        Promise.resolve(over.activeRides ?? []),
      ),
    } as unknown as RidesRepository,
    { DEFAULT_CITY_ID: CITY } as Env,
  );

  return { service, resolveForPoint };
}

describe('RosterService', () => {
  it('returns every driver, not just the online set (expected)', async () => {
    const { service } = build({
      contacts: [
        contact({}),
        contact({
          driverId: OFFLINE_DRIVER,
          name: 'Māra Liepa',
          phone: '+37129999002',
          status: 'offline',
          vehiclePlate: null,
        }),
      ],
      // Only one of them is in Redis — the other must still appear, because
      // force-assign onto an offline driver is the feature (S9-2).
      online: [
        {
          driverId: ONLINE_DRIVER,
          location: { lat: 56.95, lng: 24.11 },
          lastSeenMs: 1,
        },
      ],
    });

    const roster = await service.listRoster(CITY);

    expect(roster.drivers).toHaveLength(2);
    expect(roster.drivers.map((d) => d.status)).toContain('offline');
  });

  it('sorts by name in `lv` so Ā lands where a Latvian reader expects (expected)', async () => {
    const { service } = build({
      contacts: [
        contact({ driverId: OFFLINE_DRIVER, name: 'Zane', status: 'offline' }),
        contact({ driverId: ONLINE_DRIVER, name: 'Āris' }),
      ],
    });

    const roster = await service.listRoster(CITY);

    expect(roster.drivers.map((d) => d.name)).toEqual(['Āris', 'Zane']);
  });

  it('falls back to the phone when the driver has no display name (edge)', async () => {
    const { service } = build({ contacts: [contact({ name: null })] });

    // The wire schema promises a non-null name, and the phone is the one
    // identifier every driver has — the same rule the board applies.
    const roster = await service.listRoster(CITY);
    expect(roster.drivers[0]?.name).toBe('+37129999001');
  });

  it('attaches the ride pinning a busy driver (edge)', async () => {
    const { service } = build({
      contacts: [contact({ driverId: BUSY_DRIVER, status: 'on_ride' })],
      activeRides: [{ driverId: BUSY_DRIVER, rideId: RIDE_ID }],
    });

    const roster = await service.listRoster(CITY);
    expect(roster.drivers[0]?.activeRideId).toBe(RIDE_ID);
  });

  it('resolves zones ONLY for positioned drivers (edge)', async () => {
    const { service, resolveForPoint } = build({
      contacts: [
        contact({}),
        contact({ driverId: OFFLINE_DRIVER, status: 'offline' }),
      ],
      online: [
        {
          driverId: ONLINE_DRIVER,
          location: { lat: 56.95, lng: 24.11 },
          lastSeenMs: 1,
        },
        // In the online set but with no position recorded yet — no zone read.
        { driverId: BUSY_DRIVER, location: null, lastSeenMs: null },
      ],
      zoneName: 'Centrs',
    });

    const roster = await service.listRoster(CITY);

    // One point-in-polygon query, not one per roster row: this fan-out is
    // bounded by the online set, and widening it would put a per-driver
    // ST_Contains behind a request that competes with the booking path.
    expect(resolveForPoint).toHaveBeenCalledTimes(1);
    expect(
      roster.drivers.find((d) => d.driverId === ONLINE_DRIVER)?.zoneName,
    ).toBe('Centrs');
  });

  it('leaves the zone null when the position matches no geozone (failure)', async () => {
    const { service } = build({
      online: [
        {
          driverId: ONLINE_DRIVER,
          location: { lat: 0, lng: 0 },
          lastSeenMs: 1,
        },
      ],
      zoneName: undefined,
    });

    const roster = await service.listRoster(CITY);
    expect(roster.drivers[0]?.zoneName).toBeNull();
  });

  it('returns an empty roster rather than throwing when no drivers exist (failure)', async () => {
    const { service } = build({ contacts: [] });

    const roster = await service.listRoster(CITY);
    expect(roster.drivers).toEqual([]);
    expect(roster.at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
