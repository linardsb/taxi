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
  options: {
    childSeat: false,
    femaleDriver: false,
    pickupPin: false,
    announceArrival: false,
  },
  paymentMethod: 'cash',
  vehicleCount: 1,
} as unknown as DispatcherBookingBody;

/** The fifth `RidesService.requestForCaller` argument: the note (#303). */
function noteArg(rides: { requestForCaller: jest.Mock }): unknown {
  return (rides.requestForCaller.mock.calls[0] as unknown[])[4];
}

type Caller = { phone: string; resolveRiderId: () => Promise<string> };

function build() {
  // Typed as the mocks, cast at the constructor — the other order gives every
  // method its real signature and `mockResolvedValue` disappears.
  // Runs the resolver the way `RidesService` does — after its own guards — so
  // the identity step is exercised; a test that refuses the booking replaces
  // this with a rejection that never calls it.
  const rides = {
    requestForCaller: jest.fn(async (caller: Caller) => ({
      ride: { id: RIDE_ID, riderId: await caller.resolveRiderId() },
      split: {},
    })),
  };
  const customers = {
    findUserByPhone: jest.fn().mockResolvedValue(undefined),
    findOrCreateUser: jest.fn().mockResolvedValue({
      id: RIDER_ID,
      role: 'rider',
    }),
    findOrCreateCustomer: jest.fn().mockResolvedValue({ id: 'c1' }),
    fillEmptyDisplayName: jest.fn().mockResolvedValue(undefined),
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
    // No name: the fill is the one name writer on this path (#269). The
    // dispatcher IS the marker: a row minted here is provisional (#123).
    expect(customers.findOrCreateUser).toHaveBeenCalledWith(
      '+37129999000',
      DISPATCHER_ID,
    );
    expect(customers.fillEmptyDisplayName).toHaveBeenCalledWith(
      RIDER_ID,
      'Anna',
    );

    const [caller, key, rideBody, rateSubject, note] = rides.requestForCaller
      .mock.calls[0] as unknown as [
      Caller,
      string,
      Record<string, unknown>,
      string,
      string | null,
    ];
    expect(created.ride.riderId).toBe(RIDER_ID);
    // #123: the reservation is keyed on the phone, so it can be taken before
    // any identity exists.
    expect(caller.phone).toBe('+37129999000');
    expect(key).toBe('idem-1');
    // Q7: the cap counts against the dispatcher, or a venue's 25 bookings for 25
    // different riders would never meet a rider-keyed limit at all.
    expect(rateSubject).toBe(DISPATCHER_ID);
    // The caller fields are the identity step's input and must not reach the
    // ride request — `rideRequestSchema` would reject them anyway, and this is
    // where that stays true.
    expect(rideBody).not.toHaveProperty('callerPhone');
    expect(rideBody).not.toHaveProperty('callerName');
    expect(rideBody).not.toHaveProperty('dispatcherNote');
    // #303: the note goes to the ride's own insert, beside the body.
    expect(note).toBe('zvana no bāra');

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

    const created = await service.book(DISPATCHER_ID, 'idem-2', BODY);

    // The upsert's conflict branch returns the existing row and writes neither
    // `role` nor the marker — the integration spec pins the SQL side.
    expect(rides.requestForCaller).toHaveBeenCalledTimes(1);
    expect(created.ride.riderId).toBe(RIDER_ID);
    // An existing rider's EMPTY name is filled too (#269 D2); the repository's
    // WHERE clause is what keeps a set name.
    expect(customers.fillEmptyDisplayName).toHaveBeenCalledWith(
      RIDER_ID,
      'Anna',
    );
  });

  it('books without a name when callerName is blank, never a 400 (edge)', async () => {
    const { rides, customers, service } = build();

    await service.book(DISPATCHER_ID, 'idem-5b', {
      ...BODY,
      callerName: '   ',
    });

    expect(customers.fillEmptyDisplayName).not.toHaveBeenCalled();
    expect(rides.requestForCaller).toHaveBeenCalledTimes(1);
  });

  it('trims the note, and a blank one becomes no note (edge, #303 D4)', async () => {
    const padded = build();
    await padded.service.book(DISPATCHER_ID, 'idem-6', {
      ...BODY,
      dispatcherNote: '  Ratiņkrēsls  ',
    });
    expect(noteArg(padded.rides)).toBe('Ratiņkrēsls');
    expect(padded.dispatch.insertBookingAudit).toHaveBeenCalledWith(
      expect.objectContaining({ payload: { note: 'Ratiņkrēsls' } }),
    );

    // The console sends whitespace as typed; the driver must not get an
    // empty box.
    const blank = build();
    await blank.service.book(DISPATCHER_ID, 'idem-7', {
      ...BODY,
      dispatcherNote: '   ',
    });
    expect(noteArg(blank.rides)).toBeNull();
    expect(blank.dispatch.insertBookingAudit).toHaveBeenCalledWith(
      expect.objectContaining({ payload: {} }),
    );
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
    expect(rides.requestForCaller).not.toHaveBeenCalled();
    expect(customers.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(customers.fillEmptyDisplayName).not.toHaveBeenCalled();
  });

  it('re-checks the role on the row it resolves, after the guards (failure, #123)', async () => {
    // The early read saw no user; by the time the booking cleared the cap and
    // the quote, an OTP signup had adopted the number as a driver's.
    const { customers, service } = build();
    customers.findOrCreateUser.mockResolvedValue({
      id: 'driver-user',
      role: 'driver',
    });

    await expect(
      service.book(DISPATCHER_ID, 'idem-8', BODY),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(customers.findOrCreateCustomer).not.toHaveBeenCalled();
    expect(customers.fillEmptyDisplayName).not.toHaveBeenCalled();
  });

  it('mints nothing when the booking is refused before identity (failure, #123)', async () => {
    const { rides, customers, service } = build();
    // A 429 from the cap: `RidesService` throws before it calls the resolver.
    rides.requestForCaller.mockRejectedValue(new Error('too_many_requests'));

    await expect(service.book(DISPATCHER_ID, 'idem-9', BODY)).rejects.toThrow(
      'too_many_requests',
    );
    expect(customers.findOrCreateUser).not.toHaveBeenCalled();
    expect(customers.findOrCreateCustomer).not.toHaveBeenCalled();
  });

  it('does not fail a committed booking when the audit write fails (failure)', async () => {
    const { rides, dispatch, service } = build();
    dispatch.insertBookingAudit.mockRejectedValue(new Error('db down'));
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();

    const created = await service.book(DISPATCHER_ID, 'idem-5', BODY);

    // The car is already being dispatched; a 500 here would be retried into a
    // second ride. Loud, not fatal.
    expect(created.ride.id).toBe(RIDE_ID);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'dispatch.booking.audit_failed' }),
    );
    // #303: the note already went into the ride's insert BEFORE the audit
    // rejected, so the driver still gets it.
    expect(noteArg(rides)).toBe('zvana no bāra');
    const [requested] = rides.requestForCaller.mock.invocationCallOrder;
    const [audited] = dispatch.insertBookingAudit.mock.invocationCallOrder;
    // `?? 0` fails closed: no audit call at all cannot pass as "after".
    expect(requested).toBeLessThan(audited ?? 0);
    error.mockRestore();
  });
});
