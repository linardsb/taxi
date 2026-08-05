import type { DriverProfile, DriverStatus } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { DriversRepository } from './drivers.repository';
import type { DriverLocationStore } from './location/driver-location.store';
import { VehiclesService } from './vehicles.service';
import type { VehiclesRepository } from './vehicles.repository';

const USER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const VEHICLE_ID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';
const CITY_ID = '00000000-0000-4000-8000-000000000001';

const profileWith = (status: DriverStatus): DriverProfile =>
  ({ userId: USER_ID, status }) as DriverProfile;

/**
 * L8's race, CONSTRUCTED rather than raced for. The window is a single round
 * trip, so a concurrency test would be flaky; `onCount` fires at exactly the
 * point where a concurrent `PUT /drivers/me/status` would have landed — after
 * `remove()` has read the profile, before it decides whether to force offline.
 */
function build(
  options: { onCount?: (setStatus: (s: DriverStatus) => void) => void } = {},
) {
  /** The authoritative status, standing in for the Postgres row. */
  let status: DriverStatus = 'offline';
  const setStatus = (s: DriverStatus) => {
    status = s;
  };

  // Models the conditional UPDATE: it acts on the status NOW, and reports
  // whether it actually changed anything.
  const setOfflineIfOnline = jest.fn(() => {
    if (status !== 'online') return Promise.resolve(undefined);
    status = 'offline';
    return Promise.resolve(profileWith('offline'));
  });

  const drivers = {
    findOrCreate: () => Promise.resolve(profileWith(status)),
    setOfflineIfOnline,
  } as unknown as DriversRepository;

  const vehicles = {
    remove: () => Promise.resolve(true),
    countForDriver: () => {
      options.onCount?.(setStatus);
      return Promise.resolve(0); // that was the driver's last car
    },
  } as unknown as VehiclesRepository;

  const markOffline = jest.fn(() => Promise.resolve());
  const locations = { markOffline } as unknown as DriverLocationStore;

  const service = new VehiclesService(vehicles, drivers, locations, {
    DEFAULT_CITY_ID: CITY_ID,
  } as Env);

  return {
    service,
    markOffline,
    setOfflineIfOnline,
    statusNow: () => status,
    setStatus,
  };
}

describe('VehiclesService.remove — the delete/online TOCTOU', () => {
  it('forces an already-online driver offline when their last vehicle goes (expected)', async () => {
    const ctx = build();
    ctx.setStatus('online');

    await ctx.service.remove(USER_ID, VEHICLE_ID);

    expect(ctx.statusNow()).toBe('offline');
    expect(ctx.markOffline).toHaveBeenCalledWith(CITY_ID, USER_ID);
  });

  it('still forces offline when the driver went online DURING the delete (failure — L8)', async () => {
    const ctx = build({ onCount: (setStatus) => setStatus('online') });

    await ctx.service.remove(USER_ID, VEHICLE_ID);

    // Deciding from the status read BEFORE the delete returns early here, and
    // leaves a driver online with zero vehicles: online, and a candidate #10
    // can only ever discard — the exact disagreement between "you are online"
    // and "you can be offered a ride" that `vehicle_required` exists to stop.
    expect(ctx.statusNow()).toBe('offline');
  });

  it('changes nothing for a driver who was never online (edge)', async () => {
    const ctx = build();

    await ctx.service.remove(USER_ID, VEHICLE_ID);

    // The conditional UPDATE reports "nothing happened", which is what keeps
    // the forced_offline log honest.
    expect(ctx.statusNow()).toBe('offline');
    expect(ctx.setOfflineIfOnline).toHaveBeenCalledWith(USER_ID);
    await expect(
      ctx.setOfflineIfOnline.mock.results[0]?.value,
    ).resolves.toBeUndefined();
  });
});
