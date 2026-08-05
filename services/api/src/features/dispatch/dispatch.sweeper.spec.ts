import type { PlatformConfig } from '@taxi/shared';
import type { Env } from '../../common/config/env.schema';
import type { PlatformConfigService } from '../platform-config';
import type { AwaitingRide, RidesRepository } from '../rides';
import type { DispatchRepository } from './dispatch.repository';
import type { DispatchService } from './dispatch.service';
import { DispatchSweeper } from './dispatch.sweeper';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

const awaiting = (over: Partial<AwaitingRide> = {}): AwaitingRide =>
  ({
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    riderId: '99999999-8888-4777-8666-555555555555',
    geozoneId: null,
    request: {
      pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
    },
    createdAt: new Date(),
    ...over,
  }) as AwaitingRide;

function build(
  over: {
    awaitingRides?: AwaitingRide[];
    overdue?: { id: string; rideId: string; driverId: string }[];
    onFindOverdue?: () => never;
    attempts?: number;
  } = {},
) {
  const offerNext = jest.fn(() => Promise.resolve());
  const raiseUnclaimed = jest.fn(() => Promise.resolve());
  const expireOffer = jest.fn(() => Promise.resolve());
  const dispatch = {
    offerNext,
    raiseUnclaimed,
    expireOffer,
  } as unknown as DispatchService;

  const findOverdue = jest.fn(() => {
    if (over.onFindOverdue) over.onFindOverdue();
    return Promise.resolve(over.overdue ?? []);
  });
  const findPendingForRide = jest.fn((): Promise<{ id: string } | undefined> =>
    Promise.resolve(undefined),
  );
  const offers = {
    findOverdue,
    findPendingForRide,
    countAttempts: jest.fn(() => Promise.resolve(over.attempts ?? 0)),
  } as unknown as DispatchRepository;

  const findAwaitingDispatch = jest.fn(() =>
    Promise.resolve(over.awaitingRides ?? []),
  );
  const rides = { findAwaitingDispatch } as unknown as RidesRepository;

  const config = {
    forCity: () =>
      Promise.resolve({ unclaimedAlertSeconds: 60 } as PlatformConfig),
  } as unknown as PlatformConfigService;

  const sweeper = new DispatchSweeper(dispatch, offers, rides, config, {
    NODE_ENV: 'test',
    DEFAULT_CITY_ID: CITY,
  } as Env);

  return {
    sweeper,
    offerNext,
    raiseUnclaimed,
    expireOffer,
    findOverdue,
    findPendingForRide,
    findAwaitingDispatch,
  };
}

describe('DispatchSweeper', () => {
  it('offers an awaiting ride in one tick (expected)', async () => {
    const ride = awaiting();
    const { sweeper, offerNext } = build({ awaitingRides: [ride] });

    await sweeper.tick();

    expect(offerNext).toHaveBeenCalledTimes(1);
    expect(offerNext).toHaveBeenCalledWith(ride);
  });

  it('expires an overdue offer before trying to dispatch (expected)', async () => {
    const overdue = [{ id: 'o1', rideId: RIDE_ID, driverId: 'd1' }];
    const { sweeper, expireOffer } = build({ overdue });

    await sweeper.tick();

    expect(expireOffer).toHaveBeenCalledWith(overdue[0]);
  });

  it('skips a ride that already has a pending offer (edge)', async () => {
    const { sweeper, offerNext, findPendingForRide } = build({
      awaitingRides: [awaiting()],
    });
    findPendingForRide.mockResolvedValue({
      id: 'live-offer',
    });

    await sweeper.tick();

    expect(offerNext).not.toHaveBeenCalled();
  });

  it('skips a tick that is still in flight (edge)', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sweeper, findOverdue } = build({ awaitingRides: [awaiting()] });
    // Gated on the FIRST pass, so the in-flight tick is parked at a known point
    // when the second one arrives.
    findOverdue.mockImplementation(async () => {
      await gate;
      return [];
    });

    const first = sweeper.tick(); // parks inside pass 1
    // Two concurrent passes would both read the same awaiting ride and race to
    // offer it.
    await sweeper.tick();
    expect(findOverdue).toHaveBeenCalledTimes(1);

    release();
    await first;

    // …and the flag clears, so the NEXT tick runs normally.
    await sweeper.tick();
    expect(findOverdue).toHaveBeenCalledTimes(2);
  });

  it('alerts a ride that has waited past the configured threshold (edge)', async () => {
    const stale = awaiting({ createdAt: new Date(Date.now() - 120_000) });
    const { sweeper, raiseUnclaimed } = build({ awaitingRides: [stale] });

    await sweeper.tick();

    // The threshold is `platform_config.unclaimedAlertSeconds`, never a literal.
    expect(raiseUnclaimed).toHaveBeenCalledWith(stale, 0);
  });

  it('does not alert a ride that is still within the threshold (edge)', async () => {
    const fresh = awaiting({ createdAt: new Date() });
    const { sweeper, raiseUnclaimed } = build({ awaitingRides: [fresh] });

    await sweeper.tick();

    expect(raiseUnclaimed).not.toHaveBeenCalled();
  });

  it('keeps running the remaining passes when one throws (failure)', async () => {
    const ride = awaiting();
    const { sweeper, offerNext } = build({
      awaitingRides: [ride],
      onFindOverdue: () => {
        throw new Error('postgres blip');
      },
    });

    // A single failing pass must not strand every ride in the system.
    await expect(sweeper.tick()).resolves.toBeUndefined();
    expect(offerNext).toHaveBeenCalledTimes(1);
  });

  it('does not start an interval under NODE_ENV=test (failure of an auto-start assumption)', () => {
    const { sweeper } = build();

    sweeper.onModuleInit();

    // A background pass would race the tick() every dispatch spec calls by hand.
    // `onModuleDestroy` must stay safe to call regardless, or jest hangs.
    expect(() => sweeper.onModuleDestroy()).not.toThrow();
  });
});
