import { BadRequestException, Logger } from '@nestjs/common';
import type { DispatcherBookingBody } from '@taxi/shared';
import type { CustomersRepository } from '../../customers';
import type { RidesService } from '../../rides';
import type { DispatchRepository } from '../dispatch.repository';
import { BookingsService } from './bookings.service';

const DISPATCHER_ID = '00000000-0000-4000-8000-00000000d001';
const RIDER_ID = '00000000-0000-4000-8000-00000000u001';
const RIDE_ID = '00000000-0000-4000-8000-00000000r001';

const BODY = {
  callerPhone: '+37129999000',
  callerName: 'Anna',
  dispatcherNote: 'zvana no bāra',
  pickup: {
    location: { lat: 56.9496, lng: 24.1052 },
    address: 'Kaļķu iela 28, Rīga',
  },
  destination: {
    location: { lat: 56.9236, lng: 23.9711 },
    address: 'Lidosta Rīga',
  },
  stops: [],
  category: 'standard',
  options: { childSeat: false, femaleDriver: false },
  paymentMethod: 'cash',
  vehicleCount: 1,
} as unknown as DispatcherBookingBody;

function build() {
  // Typed as the mocks, cast at the constructor — the other order gives every
  // method its real signature and `mockResolvedValue` disappears.
  const rides = {
    request: jest.fn().mockResolvedValue({ ride: { id: RIDE_ID }, split: {} }),
  };
  const customers = {
    findUserByPhone: jest.fn().mockResolvedValue(undefined),
    findOrCreateUser: jest.fn().mockResolvedValue({
      id: RIDER_ID,
      role: 'rider',
    }),
    findOrCreateCustomer: jest.fn().mockResolvedValue({ id: 'c1' }),
  };
  const dispatch = {
    insertBookingAudit: jest.fn().mockResolvedValue(undefined),
  };
  return {
    rides,
    customers,
    dispatch,
    service: new BookingsService(
      rides as unknown as RidesService,
      customers as unknown as CustomersRepository,
      dispatch as unknown as DispatchRepository,
    ),
  };
}

describe('BookingsService', () => {
  it('books through RidesService as a phone order, keyed on the dispatcher (expected)', async () => {
    const { rides, customers, dispatch, service } = build();

    const created = await service.book(DISPATCHER_ID, 'idem-1', BODY);

    expect(created.ride.id).toBe(RIDE_ID);
    expect(customers.findOrCreateUser).toHaveBeenCalledWith(
      '+37129999000',
      'Anna',
    );

    const [riderId, key, rideBody, channel, rateSubject] = rides.request.mock
      .calls[0] as [string, string, Record<string, unknown>, string, string];
    expect(riderId).toBe(RIDER_ID);
    expect(key).toBe('idem-1');
    expect(channel).toBe('phone');
    // Q7: the cap counts against the dispatcher, or a venue's 25 bookings for 25
    // different riders would never meet a rider-keyed limit at all.
    expect(rateSubject).toBe(DISPATCHER_ID);
    // The caller fields are the identity step's input and must not reach the
    // ride request — `rideRequestSchema` would reject them anyway, and this is
    // where that stays true.
    expect(rideBody).not.toHaveProperty('callerPhone');
    expect(rideBody).not.toHaveProperty('callerName');
    expect(rideBody).not.toHaveProperty('dispatcherNote');

    expect(dispatch.insertBookingAudit).toHaveBeenCalledWith({
      rideId: RIDE_ID,
      dispatcherId: DISPATCHER_ID,
      payload: { note: 'zvana no bāra' },
    });
  });

  it('reuses an existing rider rather than creating a second identity (edge)', async () => {
    const { rides, customers, service } = build();
    customers.findUserByPhone.mockResolvedValue({
      id: RIDER_ID,
      role: 'rider',
    });

    await service.book(DISPATCHER_ID, 'idem-2', BODY);

    expect(customers.findOrCreateUser).not.toHaveBeenCalled();
    const [riderId] = rides.request.mock.calls[0] as [string];
    expect(riderId).toBe(RIDER_ID);
  });

  it('keeps the phone number out of the log line (edge)', async () => {
    const { service } = build();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();

    await service.book(DISPATCHER_ID, 'idem-3', BODY);

    expect(JSON.stringify(log.mock.calls)).not.toContain('37129999000');
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'dispatch.booking.created',
        rideId: RIDE_ID,
        newCaller: true,
      }),
    );
    log.mockRestore();
  });

  it('refuses a caller phone that belongs to a driver (failure)', async () => {
    const { rides, customers, service } = build();
    customers.findUserByPhone.mockResolvedValue({
      id: 'driver-user',
      role: 'driver',
    });

    await expect(
      service.book(DISPATCHER_ID, 'idem-4', BODY),
    ).rejects.toBeInstanceOf(BadRequestException);
    // Nothing was created: a booking that turned a driver into their own
    // passenger would corrupt every eligibility read on that user.
    expect(rides.request).not.toHaveBeenCalled();
    expect(customers.findOrCreateCustomer).not.toHaveBeenCalled();
  });

  it('does not fail a committed booking when the audit write fails (failure)', async () => {
    const { dispatch, service } = build();
    dispatch.insertBookingAudit.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const created = await service.book(DISPATCHER_ID, 'idem-5', BODY);

    // The car is already being dispatched; a 500 here would be retried into a
    // second ride. Loud, not fatal.
    expect(created.ride.id).toBe(RIDE_ID);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'dispatch.booking.audit_failed' }),
    );
    error.mockRestore();
  });
});
