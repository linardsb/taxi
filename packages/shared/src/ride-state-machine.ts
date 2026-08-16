export const RIDE_STATUSES = [
  'scheduled',
  'requested',
  'offered',
  'queued',
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
  'settled',
  'cancelled_by_rider',
  'cancelled_by_driver',
  'cancelled_by_dispatcher',
  'cancelled_by_system',
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

export const CANCELLED_STATUSES = [
  'cancelled_by_rider',
  'cancelled_by_driver',
  'cancelled_by_dispatcher',
  'cancelled_by_system',
] as const satisfies readonly RideStatus[];

/**
 * Statuses in which a ride has a driver actively committed to it — from
 * acceptance until the physical end of the ride. `completed` is NOT here:
 * the driver is released inside `complete()` (#11), so a completed-but-
 * unsettled ride must not pin them offline. #61 gates going online on this
 * set, read from the rides table — `drivers.status` is a derived cache and
 * chain A is exactly the case where the cache lies.
 */
export const ACTIVE_DRIVER_RIDE_STATUSES = [
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
] as const satisfies readonly RideStatus[];

/**
 * What Dina's live board carries (#18): everything between creation and a
 * terminal state. `scheduled` is deliberately absent — a scheduled ride is
 * not yet live work — and so are `completed`/`settled`/cancellations.
 *
 * A cross-surface contract, not a query detail: the api builds the board
 * query's `inArray` from it and the console buckets rides by it. Adding a
 * status here must fail the build wherever it isn't rendered, which is why
 * the console types its status→label map as a total `Record<BoardRideStatus,
 * …>` rather than a `Partial`.
 */
export const BOARD_LIVE_RIDE_STATUSES = [
  'requested',
  'offered',
  'queued',
  ...ACTIVE_DRIVER_RIDE_STATUSES,
] as const satisfies readonly RideStatus[];

export type BoardRideStatus = (typeof BOARD_LIVE_RIDE_STATUSES)[number];

/**
 * The single source of truth for the ride lifecycle, consumed by all five
 * surfaces. "offered → requested" is the re-offer loop after a driver
 * declines or times out; "queued" is the geozone-queue dispatch mode.
 */
export const ALLOWED_TRANSITIONS: Readonly<
  Record<RideStatus, readonly RideStatus[]>
> = {
  scheduled: [
    'requested',
    'cancelled_by_rider',
    'cancelled_by_dispatcher',
    'cancelled_by_system',
  ],
  requested: [
    'offered',
    'queued',
    'cancelled_by_rider',
    'cancelled_by_dispatcher',
    'cancelled_by_system',
  ],
  offered: [
    'accepted',
    'requested',
    'cancelled_by_rider',
    'cancelled_by_dispatcher',
    'cancelled_by_system',
  ],
  queued: [
    'offered',
    'cancelled_by_rider',
    'cancelled_by_dispatcher',
    'cancelled_by_system',
  ],
  accepted: [
    'arriving',
    'cancelled_by_rider',
    'cancelled_by_driver',
    'cancelled_by_dispatcher',
  ],
  arriving: [
    'arrived',
    'cancelled_by_rider',
    'cancelled_by_driver',
    'cancelled_by_dispatcher',
  ],
  arrived: [
    'in_progress',
    'cancelled_by_rider',
    'cancelled_by_driver',
    'cancelled_by_dispatcher',
  ],
  in_progress: ['completed', 'cancelled_by_dispatcher'],
  completed: ['settled'],
  settled: [],
  cancelled_by_rider: [],
  cancelled_by_driver: [],
  cancelled_by_dispatcher: [],
  cancelled_by_system: [],
};

export function canTransition(from: RideStatus, to: RideStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export class InvalidRideTransitionError extends Error {
  constructor(
    public readonly from: RideStatus,
    public readonly to: RideStatus,
  ) {
    super(`Invalid ride transition: ${from} -> ${to}`);
    this.name = 'InvalidRideTransitionError';
  }
}

export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) throw new InvalidRideTransitionError(from, to);
}

export function isTerminal(status: RideStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

export function isCancelled(status: RideStatus): boolean {
  return (CANCELLED_STATUSES as readonly RideStatus[]).includes(status);
}

/**
 * Hard product rule from Atis's outline ("Kl.atverot app" §4): the payment
 * method may NOT be changed once a driver has accepted the ride.
 */
export function isPaymentMethodLocked(status: RideStatus): boolean {
  const lockedFrom: readonly RideStatus[] = [
    'accepted',
    'arriving',
    'arrived',
    'in_progress',
    'completed',
    'settled',
  ];
  return lockedFrom.includes(status);
}
