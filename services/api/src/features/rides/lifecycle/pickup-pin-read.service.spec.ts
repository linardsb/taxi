import {
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RideStatus } from '@taxi/shared';
import { PickupPinReadService } from './pickup-pin-read.service';
import type { RideLifecycleRepository } from './ride-lifecycle.repository';

const RIDE_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const ACTOR_ID = '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
// Every case uses the same PIN, so "the logs never carry it" means something
// in the refusals too.
const PIN = '0042';

function setup(target: { status: RideStatus; pin: string | null } | undefined) {
  const lifecycle = {
    findPickupPinTarget: jest.fn(() => Promise.resolve(target)),
  } as unknown as RideLifecycleRepository;
  return new PickupPinReadService(lifecycle);
}

async function rejection(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected a rejection');
}

describe('PickupPinReadService (#275)', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => {
    // The audit trail must never become a copy of the secret, on any path.
    // Read before restoring, assert after, so a red case cannot leak its spy
    // calls into the next one.
    const logged = JSON.stringify([log.mock.calls, warn.mock.calls]);
    jest.restoreAllMocks();
    expect(logged).not.toContain(PIN);
  });

  it('returns the PIN at arrived and logs the read with the actor (expected)', async () => {
    const service = setup({ status: 'arrived', pin: PIN });

    await expect(service.read(ACTOR_ID, RIDE_ID)).resolves.toEqual({
      pin: PIN,
    });

    expect(log).toHaveBeenCalledTimes(1);
    const [entry] = log.mock.calls[0] as [Record<string, unknown>];
    expect(entry.event).toBe('ride.pickup_pin.dispatcher_read');
    expect(entry.rideId).toBe(RIDE_ID);
    expect(entry.actorId).toBe(ACTOR_ID);
  });

  it('answers 404 for a ride that does not exist (failure)', async () => {
    const service = setup(undefined);

    const error = await rejection(service.read(ACTOR_ID, RIDE_ID));
    expect(error).toBeInstanceOf(NotFoundException);
    expect(error.message).toBe('ride_not_found');
    expect(log).not.toHaveBeenCalled();
  });

  it('answers 409 pickup_pin_not_set for a ride booked without a PIN (edge)', async () => {
    const service = setup({ status: 'arrived', pin: null });

    const error = await rejection(service.read(ACTOR_ID, RIDE_ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('pickup_pin_not_set');
  });

  it('answers 409 ride_not_arrived before the arrival SMS is sent (edge)', async () => {
    const service = setup({ status: 'arriving', pin: PIN });

    const error = await rejection(service.read(ACTOR_ID, RIDE_ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('ride_not_arrived');
    const [entry] = warn.mock.calls[0] as [Record<string, unknown>];
    expect(entry.event).toBe('ride.pickup_pin.dispatcher_read_rejected');
    expect(entry.cause).toBe('ride_not_arrived');
    expect(entry.actorId).toBe(ACTOR_ID);
    expect(log).not.toHaveBeenCalled();
  });
});
