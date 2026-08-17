import { BadRequestException, Logger } from '@nestjs/common';
import type { Customer, RecentRide, SavedPlace } from '@taxi/shared';
import type { CustomersRepository } from './customers.repository';
import { CustomersService } from './customers.service';

const CUSTOMER: Customer = {
  id: '00000000-0000-4000-8000-00000000c001',
  userId: '00000000-0000-4000-8000-00000000u001',
  label: 'Hotel Roma',
  isVenue: true,
  notes: null,
};

const PLACE: SavedPlace = {
  id: '00000000-0000-4000-8000-00000000p001',
  customerId: CUSTOMER.id,
  kind: 'pickup',
  label: 'Ieeja',
  point: {
    location: { lat: 56.9496, lng: 24.1052 },
    address: 'Kaļķu iela 28, Rīga',
  },
  placeId: 'place-1',
};

const RECENT: RecentRide = {
  rideId: '00000000-0000-4000-8000-00000000r001',
  pickup: PLACE.point,
  destination: {
    location: { lat: 56.9236, lng: 23.9711 },
    address: 'Lidosta Rīga',
  },
  bookedAt: new Date('2026-08-01T10:00:00Z'),
};

function build() {
  // Typed as the mock, cast at the constructor — the other order gives every
  // method the repository's real signature and `mockResolvedValue` disappears.
  const repository = {
    findUserByPhone: jest.fn(),
    findOrCreateUser: jest.fn(),
    findOrCreateCustomer: jest.fn(),
    findCustomerByUserId: jest.fn(),
    updateCustomer: jest.fn(),
    listSavedPlaces: jest.fn().mockResolvedValue([PLACE]),
    listVenues: jest.fn(),
    findRecentRides: jest.fn().mockResolvedValue([RECENT]),
  };
  return {
    repository,
    service: new CustomersService(repository as unknown as CustomersRepository),
  };
}

describe('CustomersService', () => {
  describe('lookup', () => {
    it('returns the record, saved places and last jobs (expected)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue({
        id: CUSTOMER.userId,
        role: 'rider',
      });
      repository.findCustomerByUserId.mockResolvedValue(CUSTOMER);

      const result = await service.lookup('dispatcher-1', '+37129999000');

      expect(result).toEqual({
        userId: CUSTOMER.userId,
        customer: CUSTOMER,
        savedPlaces: [PLACE],
        recentRides: [RECENT],
      });
    });

    it('never puts the phone number in the log line (edge)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue(undefined);
      const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

      await service.lookup('dispatcher-1', '+37129999000');

      expect(JSON.stringify(log.mock.calls)).not.toContain('37129999000');
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'customers.lookup',
          dispatcherId: 'dispatcher-1',
          found: false,
        }),
      );
      log.mockRestore();
    });

    it('serves an app-only rider their history under a null record (edge)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue({
        id: CUSTOMER.userId,
        role: 'rider',
      });
      repository.findCustomerByUserId.mockResolvedValue(undefined);

      const result = await service.lookup('dispatcher-1', '+37129999000');

      expect(result).toEqual({
        userId: CUSTOMER.userId,
        customer: null,
        savedPlaces: [],
        recentRides: [RECENT],
      });
      expect(repository.listSavedPlaces).not.toHaveBeenCalled();
    });

    it('answers null for a number that has never rung (edge)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue(undefined);

      await expect(
        service.lookup('dispatcher-1', '+37120000000'),
      ).resolves.toBeNull();
      // A pure read: looking someone up must not file them.
      expect(repository.findOrCreateUser).not.toHaveBeenCalled();
    });
  });

  describe('upsert', () => {
    it('files a caller who has never rung (expected)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue(undefined);
      repository.findOrCreateUser.mockResolvedValue({
        id: CUSTOMER.userId,
        role: 'rider',
      });
      repository.findOrCreateCustomer.mockResolvedValue({
        ...CUSTOMER,
        label: null,
        isVenue: false,
      });
      repository.updateCustomer.mockResolvedValue(CUSTOMER);

      await expect(
        service.upsert({
          phone: '+37129999000',
          label: 'Hotel Roma',
          isVenue: true,
          notes: null,
        }),
      ).resolves.toEqual(CUSTOMER);
    });

    it('refuses a number that belongs to a driver (failure)', async () => {
      const { repository, service } = build();
      repository.findUserByPhone.mockResolvedValue({
        id: 'driver-user',
        role: 'driver',
      });

      await expect(
        service.upsert({
          phone: '+37129999000',
          label: 'Jānis',
          isVenue: false,
          notes: null,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(repository.findOrCreateCustomer).not.toHaveBeenCalled();
    });
  });
});
