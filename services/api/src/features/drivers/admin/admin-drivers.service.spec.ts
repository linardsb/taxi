import { ConflictException } from '@nestjs/common';
import type { DriverProfile } from '@taxi/shared';
import type { Env } from '../../../common/config/env.schema';
import type { DriversRepository } from '../drivers.repository';
import type { DriverLocationStore } from '../location/driver-location.store';
import type { VehiclesRepository } from '../vehicles.repository';
import type { VehiclesService } from '../vehicles.service';
import type {
  AdminDriversRepository,
  SetApprovalResult,
} from './admin-drivers.repository';
import { AdminDriversService } from './admin-drivers.service';

const CITY = 'riga';
const DRIVER_ID = '1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
const ADMIN_ID = '9a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

function build(result: SetApprovalResult) {
  const markOffline = jest.fn(() => Promise.resolve());
  const profile: DriverProfile = {
    userId: DRIVER_ID,
    status: 'offline',
    approvalStatus: 'rejected',
    spokenLanguages: ['lv'],
    fleetId: null,
    balanceCents: 0,
    commissionPctOverride: null,
  };
  const service = new AdminDriversService(
    {
      setApproval: jest.fn(() => Promise.resolve(result)),
      userFields: () =>
        Promise.resolve({
          displayName: null,
          phone: '+37120000001',
          createdAt: new Date(),
        }),
    } as unknown as AdminDriversRepository,
    { find: () => Promise.resolve(profile) } as unknown as DriversRepository,
    {
      listForDriver: () => Promise.resolve([]),
    } as unknown as VehiclesRepository,
    {} as VehiclesService,
    { markOffline } as unknown as DriverLocationStore,
    { DEFAULT_CITY_ID: CITY } as Env,
  );
  return { service, markOffline };
}

describe('AdminDriversService.setApproval (#20)', () => {
  it('rejecting an online driver clears their Redis presence once (expected)', async () => {
    const { service, markOffline } = build({
      outcome: 'ok',
      previousStatus: 'online',
      previousApproval: 'approved',
    });

    await service.setApproval(ADMIN_ID, DRIVER_ID, 'rejected');

    expect(markOffline).toHaveBeenCalledTimes(1);
    expect(markOffline).toHaveBeenCalledWith(CITY, DRIVER_ID);
  });

  it('approving touches no presence (edge)', async () => {
    const { service, markOffline } = build({
      outcome: 'ok',
      previousStatus: 'offline',
      previousApproval: 'pending',
    });

    await service.setApproval(ADMIN_ID, DRIVER_ID, 'approved');

    expect(markOffline).not.toHaveBeenCalled();
  });

  it('refuses revoking an on-ride driver and leaves Redis alone (failure)', async () => {
    const { service, markOffline } = build({ outcome: 'on_ride' });

    const attempt = service.setApproval(ADMIN_ID, DRIVER_ID, 'rejected');
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow('driver_on_ride');
    // Postgres decides first: clearing Redis for an on-ride driver would
    // strand the ride's position feed.
    expect(markOffline).not.toHaveBeenCalled();
  });
});
