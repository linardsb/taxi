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
    // THE DISPATCHER RELEASE (#19). The only path back into the cascade after
    // a driver has taken the ride, and it exists so a reassignment is not a
    // cancellation: Dina puts a different car on the job while the ride keeps
    // its id, its tracking token and the rider's SMS thread.
    //
    // Only a dispatcher may walk it. That is enforced at the SERVICE layer
    // (`ReassignService`), not here and not in the DDL — the same split as
    // `rideAssignmentSchema`'s dispatcher refine, because this table answers
    // "is the hop legal", never "who is allowed to make it".
    //
    // Deliberately absent from `arrived` and `in_progress`: a driver standing
    // at the pickup, or carrying the passenger, is not reassignable. That is a
    // cancellation, and pretending otherwise would strand a rider mid-ride.
    'requested',
    'cancelled_by_rider',
    'cancelled_by_driver',
    'cancelled_by_dispatcher',
  ],
  arriving: [
    'arrived',
    /** The dispatcher release again — see the `accepted` row. */
    'requested',
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

/**
 * The driver's four steps, in order. Every pair is an edge of
 * `ALLOWED_TRANSITIONS`, which is what lets the api check `ride.status ===
 * from` and be done: for a FIXED step table a `from` mismatch IS the
 * illegality, so a separate `canTransition` call would be dead logic. (Cancel
 * is different — there `to` varies by actor, so it checks `canTransition`.)
 *
 * `from` doubles as the api's 409 error code: `ride_not_arrived` for a
 * `start` on a ride that never arrived.
 *
 * Shared since #15: the driver app renders one primary button per status and
 * needs the same status → step table the api guards with. One definition, so
 * the button the app shows is always the step the api will accept.
 */
export const DRIVER_STEPS = {
  arriving: { from: 'accepted', to: 'arriving' },
  arrived: { from: 'arriving', to: 'arrived' },
  start: { from: 'arrived', to: 'in_progress' },
  complete: { from: 'in_progress', to: 'completed' },
} as const satisfies Record<string, { from: RideStatus; to: RideStatus }>;

export type DriverStep = keyof typeof DRIVER_STEPS;
