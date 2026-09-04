import { rideRequestSchema, type RideRequest } from '@taxi/shared';
import type {
  DriversService,
  DriverLocationService,
  DriverMatchAttributes,
  NearbyDriver,
} from '../../drivers';
import { InMemoryDispatchQueueStore } from '../queue/in-memory-dispatch-queue.store';
import type { QueueNotifier } from '../queue/queue-notifier';
import { GeozoneQueueStrategy } from './geozone-queue.strategy';

const RIDER_ID = '5a5a5a5a-1111-4222-8333-444444444444';
const ZONE = '00000000-0000-4000-8000-000000000102'; // RIX
const CITY = '00000000-0000-4000-8000-000000000001';
/** The seeded pilot value; the boundary cases live in `candidate-filter.spec.ts`. */
const DEBT_LIMIT = 5000;
const id = (n: number) => `d0000000-0000-4000-8000-00000000000${n}`;

const request = (over: Partial<RideRequest> = {}): RideRequest =>
  rideRequestSchema.parse({
    riderId: RIDER_ID,
    pickup: {
      location: { lat: 56.9236, lng: 23.9711 },
      address: 'Lidosta RIX',
    },
    destination: {
      location: { lat: 56.9512, lng: 24.1136 },
      address: 'Centrs',
    },
    paymentMethod: 'cash',
    ...over,
  });

const attrs = (
  n: number,
  over: Partial<DriverMatchAttributes> = {},
): DriverMatchAttributes => ({
  driverId: id(n),
  status: 'online',
  isFemale: null,
  balanceCents: 0,
  commissionPctOverride: null,
  categories: ['standard'],
  hasChildSeat: false,
  maxPassengerSeats: 4,
  ...over,
});

function build(nearby: NearbyDriver[], matchAttrs: DriverMatchAttributes[]) {
  const queue = new InMemoryDispatchQueueStore();
  const broadcast = jest.fn(() => Promise.resolve());
  const strategy = new GeozoneQueueStrategy(
    {
      findNearest: () => Promise.resolve(nearby),
    } as unknown as DriverLocationService,
    {
      findMatchAttributes: () => Promise.resolve(matchAttrs),
    } as unknown as DriversService,
    queue,
    { broadcast } as unknown as QueueNotifier,
  );
  return { strategy, queue, broadcast };
}

describe('GeozoneQueueStrategy — driver:queue after enrolment (#15)', () => {
  const ctx = {
    geozoneId: ZONE,
    cityId: CITY,
    driverDebtLimitCents: DEBT_LIMIT,
  } as const;
  const at = { lat: 56.92, lng: 23.97 };

  it('broadcasts the zone once when newcomers were enrolled (expected)', async () => {
    const { strategy, broadcast } = build(
      [
        { driverId: id(1), location: at, distanceMeters: 100 },
        { driverId: id(2), location: at, distanceMeters: 200 },
      ],
      [attrs(1), attrs(2)],
    );

    await strategy.findCandidates(request(), ctx);

    // Two newcomers, ONE broadcast: the whole zone hears its ranks after the
    // batch, not one emit per driver enrolled.
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(ZONE);
  });

  it('stays silent when every candidate was already ranked (edge)', async () => {
    const { strategy, queue, broadcast } = build(
      [{ driverId: id(1), location: at, distanceMeters: 100 }],
      [attrs(1)],
    );
    await queue.joinBack(ZONE, id(1));

    await strategy.findCandidates(request(), ctx);

    // Nothing moved, so nothing to announce — a stale re-emit is noise.
    expect(broadcast).not.toHaveBeenCalled();
  });
});

/** Driver 1 is NEARER; driver 2 is AHEAD in the rank. */
const NEAR_FIRST: NearbyDriver[] = [
  {
    driverId: id(1),
    location: { lat: 56.92, lng: 23.97 },
    distanceMeters: 200,
  },
  {
    driverId: id(2),
    location: { lat: 56.93, lng: 23.98 },
    distanceMeters: 1_500,
  },
];

describe('GeozoneQueueStrategy', () => {
  it('declares the geozone_queue mode', () => {
    expect(build([], []).strategy.mode).toBe('geozone_queue');
  });

  /**
   * THE ACCEPTANCE EDGE CASE, at unit level. The queue-ranked driver must beat
   * the nearer one — that is the entire point of "izsaukumi rindas kārtībā",
   * and a distance tiebreak anywhere in the sort would silently undo it.
   */
  it('ranks a queued driver ahead of a NEARER out-of-turn driver (expected)', async () => {
    const { strategy, queue } = build(NEAR_FIRST, [attrs(1), attrs(2)]);
    await queue.joinBack(ZONE, id(2)); // driver 2 waited for their turn
    await queue.joinBack(ZONE, id(1));

    const found = await strategy.findCandidates(request(), {
      geozoneId: ZONE,
      cityId: CITY,
      driverDebtLimitCents: DEBT_LIMIT,
    });

    expect(found.map((c) => c.driverId)).toEqual([id(2), id(1)]);
    expect(found[0]!.queuePosition).toBe(1);
    expect(found[1]!.queuePosition).toBe(2);
    // The nearer driver really was nearer — otherwise this proves nothing.
    expect(found[1]!.etaSeconds).toBeLessThan(found[0]!.etaSeconds);
  });

  it('lazily enrolls drivers the queue has never seen, in proximity order (edge)', async () => {
    const { strategy, queue } = build(NEAR_FIRST, [attrs(1), attrs(2)]);

    const found = await strategy.findCandidates(request(), {
      geozoneId: ZONE,
      cityId: CITY,
      driverDebtLimitCents: DEBT_LIMIT,
    });

    // Nobody was in the rank, so there was no order to honour — proximity
    // order becomes the enrollment order, and it is stable.
    expect(found.map((c) => c.driverId)).toEqual([id(1), id(2)]);
    expect(found.map((c) => c.queuePosition)).toEqual([1, 2]);
    // Enrollment persisted, so the next round honours what was just earned.
    await expect(queue.positions(ZONE, [id(1), id(2)])).resolves.toEqual(
      new Map([
        [id(1), 1],
        [id(2), 2],
      ]),
    );
  });

  it('keeps an already-queued driver’s earned position when a newcomer appears (edge)', async () => {
    const { strategy, queue } = build(NEAR_FIRST, [attrs(1), attrs(2)]);
    await queue.joinBack(ZONE, id(2)); // driver 2 was already waiting

    const found = await strategy.findCandidates(request(), {
      geozoneId: ZONE,
      cityId: CITY,
      driverDebtLimitCents: DEBT_LIMIT,
    });

    expect(found.map((c) => c.driverId)).toEqual([id(2), id(1)]);
    expect(found[0]!.queuePosition).toBe(1);
  });

  it('falls through to proximity order when the pickup is in no zone (failure)', async () => {
    const { strategy } = build(NEAR_FIRST, [attrs(1), attrs(2)]);

    const found = await strategy.findCandidates(request(), {
      geozoneId: null,
      cityId: CITY,
      driverDebtLimitCents: DEBT_LIMIT,
    });

    expect(found.map((c) => c.driverId)).toEqual([id(1), id(2)]);
    // No zone means no rank to report; the field must stay absent rather than
    // carry an invented number onto the offer card.
    expect(found.every((c) => c.queuePosition === undefined)).toBe(true);
  });
});
