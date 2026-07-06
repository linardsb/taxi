export const RIDE_STATUSES = [
  "scheduled",
  "requested",
  "offered",
  "queued",
  "accepted",
  "arriving",
  "arrived",
  "in_progress",
  "completed",
  "settled",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "cancelled_by_dispatcher",
  "cancelled_by_system",
] as const;

export type RideStatus = (typeof RIDE_STATUSES)[number];

export const CANCELLED_STATUSES = [
  "cancelled_by_rider",
  "cancelled_by_driver",
  "cancelled_by_dispatcher",
  "cancelled_by_system",
] as const satisfies readonly RideStatus[];

/**
 * The single source of truth for the ride lifecycle, consumed by all five
 * surfaces. "offered → requested" is the re-offer loop after a driver
 * declines or times out; "queued" is the geozone-queue dispatch mode.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<RideStatus, readonly RideStatus[]>> = {
  scheduled: ["requested", "cancelled_by_rider", "cancelled_by_dispatcher", "cancelled_by_system"],
  requested: ["offered", "queued", "cancelled_by_rider", "cancelled_by_dispatcher", "cancelled_by_system"],
  offered: ["accepted", "requested", "cancelled_by_rider", "cancelled_by_dispatcher", "cancelled_by_system"],
  queued: ["offered", "cancelled_by_rider", "cancelled_by_dispatcher", "cancelled_by_system"],
  accepted: ["arriving", "cancelled_by_rider", "cancelled_by_driver", "cancelled_by_dispatcher"],
  arriving: ["arrived", "cancelled_by_rider", "cancelled_by_driver", "cancelled_by_dispatcher"],
  arrived: ["in_progress", "cancelled_by_rider", "cancelled_by_driver", "cancelled_by_dispatcher"],
  in_progress: ["completed", "cancelled_by_dispatcher"],
  completed: ["settled"],
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
    this.name = "InvalidRideTransitionError";
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
    "accepted",
    "arriving",
    "arrived",
    "in_progress",
    "completed",
    "settled",
  ];
  return lockedFrom.includes(status);
}
