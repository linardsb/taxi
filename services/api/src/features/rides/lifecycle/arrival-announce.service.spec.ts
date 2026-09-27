import {
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PushMessage, RideStatus } from '@taxi/shared';
import { InMemoryKeyValueStore } from '../../../../test/harness';
import type { DriversService } from '../../drivers';
import type { RealtimeService } from '../../realtime';
import { ArrivalAnnounceService } from './arrival-announce.service';
import type { RideLifecycleRepository } from './ride-lifecycle.repository';

const RIDE_ID = '2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e';
const ORDER_ID = '3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f';
const RIDER_ID = '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f';
const DRIVER_ID = '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d';

type Target = {
  id: string;
  orderId: string;
  status: RideStatus;
  riderId: string;
  driverId: string | null;
  announceArrival: boolean;
};

const storedRequest = (announceArrival: boolean) => ({
  riderId: RIDER_ID,
  pickup: {
    location: { lat: 56.9496, lng: 24.1052 },
    address: 'Brīvības iela 1, Rīga',
  },
  destination: {
    location: { lat: 56.9236, lng: 23.9711 },
    address: 'Lidosta RIX',
  },
  paymentMethod: 'cash',
  options: { announceArrival },
});

function setup(over: Partial<Target> = {}) {
  let target: Target | undefined = {
    id: RIDE_ID,
    orderId: ORDER_ID,
    status: 'arrived',
    riderId: RIDER_ID,
    driverId: DRIVER_ID,
    announceArrival: true,
    ...over,
  };
  // The repository hands `request` back raw (PR #293 F5); the flag rides in
  // it, in the stored shape the service parses.
  const lifecycle = {
    findAnnounceTarget: jest.fn(() => {
      if (!target) return Promise.resolve(undefined);
      const { announceArrival, ...rest } = target;
      return Promise.resolve({
        ...rest,
        request: storedRequest(announceArrival),
      });
    }),
  } as unknown as RideLifecycleRepository;
  const kv = new InMemoryKeyValueStore();
  const emitToDriver = jest.fn();
  const realtime = { emitToDriver } as unknown as RealtimeService;
  const pushes: { driverId: string; message: PushMessage; event: string }[] =
    [];
  const sendPush = jest.fn(
    (
      driverId: string,
      build: (language: 'lv' | 'ru' | 'en') => PushMessage,
      event: string,
    ) => {
      pushes.push({ driverId, message: build('lv'), event });
      return Promise.resolve();
    },
  );
  const drivers = { sendPush } as unknown as DriversService;
  const service = new ArrivalAnnounceService(lifecycle, kv, realtime, drivers);
  return {
    service,
    kv,
    emitToDriver,
    pushes,
    setTarget: (next: Partial<Target> | undefined) => {
      target = next === undefined ? undefined : { ...target!, ...next };
    },
  };
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

describe('ArrivalAnnounceService (#259)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });
  afterEach(() => jest.restoreAllMocks());

  it('emits to the driver, pushes the same `at`, and records it for the replay (expected)', async () => {
    const { service, emitToDriver, pushes } = setup();

    await expect(service.request(RIDER_ID, RIDE_ID)).resolves.toEqual({
      ok: true,
    });

    expect(emitToDriver).toHaveBeenCalledTimes(1);
    const [driverId, event, payload] = emitToDriver.mock.calls[0] as [
      string,
      string,
      { rideId: string; at: string },
    ];
    expect(driverId).toBe(DRIVER_ID);
    expect(event).toBe('ride:announce_requested');
    expect(payload.rideId).toBe(RIDE_ID);
    expect(new Date(payload.at).toISOString()).toBe(payload.at);

    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.driverId).toBe(DRIVER_ID);
    expect(pushes[0]!.event).toBe('ride.arrival_announce.push');
    expect(pushes[0]!.message.data).toEqual({
      kind: 'announce_requested',
      rideId: RIDE_ID,
      at: payload.at,
    });
    await expect(service.lastRequestedAt(RIDE_ID)).resolves.toBe(payload.at);
  });

  it('a second request inside the window is 429 with no second emit, push or replay write (edge)', async () => {
    const { service, emitToDriver, pushes } = setup();
    await service.request(RIDER_ID, RIDE_ID);
    const first = await service.lastRequestedAt(RIDE_ID);

    const error = await rejection(service.request(RIDER_ID, RIDE_ID));

    expect(error.getStatus()).toBe(429);
    const body = error.getResponse() as {
      message: string;
      retryAfterSeconds: number;
    };
    expect(body.message).toBe('too_many_requests');
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(emitToDriver).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveLength(1);
    await expect(service.lastRequestedAt(RIDE_ID)).resolves.toBe(first);
  });

  it('accepts again once the window has passed (edge)', async () => {
    const { service, kv, emitToDriver } = setup();
    await service.request(RIDER_ID, RIDE_ID);
    kv.advance(20);

    await expect(service.request(RIDER_ID, RIDE_ID)).resolves.toEqual({
      ok: true,
    });
    expect(emitToDriver).toHaveBeenCalledTimes(2);
  });

  it('a legacy or un-flagged ride is 409 announce_not_requested (edge)', async () => {
    const { service, emitToDriver } = setup({ announceArrival: false });

    const error = await rejection(service.request(RIDER_ID, RIDE_ID));

    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('announce_not_requested');
    expect(emitToDriver).not.toHaveBeenCalled();
  });

  it('another rider`s ride, or none, is the same 404 (failure)', async () => {
    const { service, setTarget } = setup();
    const stranger = await rejection(
      service.request('9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0', RIDE_ID),
    );
    setTarget(undefined);
    const missing = await rejection(service.request(RIDER_ID, RIDE_ID));

    for (const error of [stranger, missing]) {
      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.message).toBe('ride_not_found');
    }
  });

  it('off `arrived` is 409 ride_not_arrived and leaves the window unspent (failure)', async () => {
    const { service, setTarget, emitToDriver } = setup({ status: 'accepted' });

    const error = await rejection(service.request(RIDER_ID, RIDE_ID));
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('ride_not_arrived');

    setTarget({ status: 'arrived' });
    await expect(service.request(RIDER_ID, RIDE_ID)).resolves.toEqual({
      ok: true,
    });
    expect(emitToDriver).toHaveBeenCalledTimes(1);
  });

  it('a ride at arrived with no driver is 409 ride_not_arrived (failure)', async () => {
    const { service } = setup({ driverId: null });
    const error = await rejection(service.request(RIDER_ID, RIDE_ID));
    expect(error.message).toBe('ride_not_arrived');
  });

  it('an emit that throws still answers ok and still pushes (failure)', async () => {
    const { service, emitToDriver, pushes } = setup();
    emitToDriver.mockImplementation(() => {
      throw new Error('adapter down');
    });

    await expect(service.request(RIDER_ID, RIDE_ID)).resolves.toEqual({
      ok: true,
    });
    expect(pushes).toHaveLength(1);
  });

  it('a replay write that throws still reaches the driver live (failure — PR #293 F4)', async () => {
    const { service, kv, emitToDriver, pushes } = setup();
    jest.spyOn(kv, 'setWithTtl').mockRejectedValueOnce(new Error('redis down'));

    await expect(service.request(RIDER_ID, RIDE_ID)).resolves.toEqual({
      ok: true,
    });
    expect(emitToDriver).toHaveBeenCalledTimes(1);
    expect(pushes).toHaveLength(1);
  });

  it('never logs a phone or a name (D1)', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const { service } = setup();
    await service.request(RIDER_ID, RIDE_ID);

    const line = JSON.stringify(log.mock.calls);
    expect(line).toContain('ride.arrival_announce.requested');
    expect(line).not.toMatch(/phone|displayName|blind/i);
  });
});
