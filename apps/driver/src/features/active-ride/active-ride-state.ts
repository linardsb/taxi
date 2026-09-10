import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  DRIVER_STEPS,
  isCancelled,
  type DriverStep,
  type MessageKey,
  type PaymentMethodType,
  type Ride,
  type RideAssignedEvent,
  type RideStatus,
  type RideStatusEvent,
} from '@taxi/shared';

export type Ended =
  | { kind: 'released' | 'cancelled'; reason: string | null }
  | { kind: 'completed'; ride: Ride };

export interface ActiveRideState {
  rideId: string | null;
  /**
   * The card's payment-method snapshot, carried in from the offer. Compared
   * ONCE with the first loaded ride (the lock at `accepted` makes that value
   * final) and then cleared, so a change between the card and acceptance is
   * announced exactly once (R2/Q8).
   */
  expectedPaymentMethod: PaymentMethodType | null;
  ride: Ride | null;
  loading: boolean;
  /** A step is in flight — the primary button spins and ignores taps. */
  busy: boolean;
  notice: 'payment_changed' | null;
  ended: Ended | null;
  errorCode: string | null;
  /** The socket said `completed` before the REST answer; a re-read owes the receipt. */
  awaitingReceipt: boolean;
}

export const initialActiveRide: ActiveRideState = {
  rideId: null,
  expectedPaymentMethod: null,
  ride: null,
  loading: false,
  busy: false,
  notice: null,
  ended: null,
  errorCode: null,
  awaitingReceipt: false,
};

export type ActiveRideEvent =
  | {
      type: 'open';
      rideId: string;
      expectedPaymentMethod?: PaymentMethodType;
    }
  | { type: 'loaded'; ride: Ride }
  | { type: 'load_failed'; code: string }
  | { type: 'step_pressed' }
  | { type: 'step_done'; step: DriverStep }
  | { type: 'step_failed'; code: string }
  | { type: 'completed'; ride: Ride }
  | { type: 'status'; event: RideStatusEvent }
  | { type: 'assigned'; event: RideAssignedEvent; myDriverId: string }
  | { type: 'socket_connected' }
  | { type: 'foreground' }
  | { type: 'reload_pressed' }
  | { type: 'notice_dismissed' }
  | { type: 'dismissed' };

export type ActiveRideEffect =
  | { type: 'fetch_ride'; rideId: string }
  | { type: 'post_step'; step: Exclude<DriverStep, 'complete'>; rideId: string }
  | { type: 'post_complete'; rideId: string }
  | { type: 'route_ride' }
  | { type: 'route_home' }
  | { type: 'announce'; key: MessageKey };

export interface ActiveRideDecision {
  state: ActiveRideState;
  effects: ActiveRideEffect[];
}

const noop = (state: ActiveRideState): ActiveRideDecision => ({
  state,
  effects: [],
});

/** The one step legal from `status` — the api's table, by import. */
export function stepFor(status: RideStatus): DriverStep | null {
  for (const [step, edge] of Object.entries(DRIVER_STEPS) as [
    DriverStep,
    { from: RideStatus; to: RideStatus },
  ][]) {
    if (edge.from === status) return step;
  }
  return null;
}

/**
 * The heading for an active status. Exported for the screen, which renders it
 * as the title while the reducer announces it after a step — one table, so a
 * new status cannot get a heading on one of the two and not the other. Stays
 * off `index.ts`: nothing outside the slice reads it.
 */
export const TITLE_KEY: Partial<Record<RideStatus, MessageKey>> = {
  accepted: 'driver.ride.title_accepted',
  arriving: 'driver.ride.title_arriving',
  arrived: 'driver.ride.title_arrived',
  in_progress: 'driver.ride.title_in_progress',
};

const isActive = (status: RideStatus) =>
  (ACTIVE_DRIVER_RIDE_STATUSES as readonly RideStatus[]).includes(status);

/** Back in the pool: the dispatcher release (`accepted|arriving → requested`) and its cascade successors. */
const isPooled = (status: RideStatus) =>
  status === 'requested' || status === 'offered' || status === 'queued';

const opened = (
  rideId: string,
  expectedPaymentMethod: PaymentMethodType | null,
): ActiveRideState => ({
  ...initialActiveRide,
  rideId,
  expectedPaymentMethod,
  loading: true,
});

/**
 * The active-ride policy as a pure reducer. INTENT vs FACT: the app never
 * assumes a transition. The REST answer is authoritative for the step just
 * taken; `ride:status` reconciles everything else, backward edges included
 * (the dispatcher release), and every socket connect re-reads the ride —
 * which is also what puts the socket back in the ride room.
 */
export function decide(
  state: ActiveRideState,
  event: ActiveRideEvent,
): ActiveRideDecision {
  switch (event.type) {
    case 'open': {
      const expected = event.expectedPaymentMethod ?? null;
      if (state.rideId === event.rideId && state.ride && !state.ended) {
        // Re-opened from a duplicate signal: keep what is shown, reconcile.
        return {
          state: { ...state, expectedPaymentMethod: expected },
          effects: [{ type: 'fetch_ride', rideId: event.rideId }],
        };
      }
      return {
        state: opened(event.rideId, expected),
        effects: [{ type: 'fetch_ride', rideId: event.rideId }],
      };
    }

    case 'loaded': {
      const ride = event.ride;
      if (ride.id !== state.rideId) return noop(state); // a stale answer
      const base: ActiveRideState = {
        ...state,
        ride,
        loading: false,
        // A load that was failing has now succeeded; a STEP's 409 stays on
        // screen through the reconcile read, or the driver never sees why the
        // button did nothing. `step_pressed`/`reload_pressed` clear it.
        errorCode: state.loading ? null : state.errorCode,
        awaitingReceipt: false,
      };
      if (ride.status === 'completed' || ride.status === 'settled') {
        return {
          state: { ...base, ended: { kind: 'completed', ride } },
          effects:
            state.ended?.kind === 'completed'
              ? []
              : [{ type: 'announce', key: 'driver.ride.completed_title' }],
        };
      }
      // A ride re-accepted by ANOTHER driver never reaches here: the api's
      // ownership check answers it with `ride_not_found` (→ `load_failed`).
      if (isPooled(ride.status)) {
        return {
          state: { ...base, ended: { kind: 'released', reason: null } },
          effects: [{ type: 'announce', key: 'driver.ride.released' }],
        };
      }
      if (isCancelled(ride.status)) {
        return {
          state: { ...base, ended: { kind: 'cancelled', reason: null } },
          effects: [{ type: 'announce', key: 'driver.ride.cancelled' }],
        };
      }
      // Active. The one-time payment-method comparison (R2).
      if (
        state.expectedPaymentMethod !== null &&
        ride.paymentMethod !== state.expectedPaymentMethod
      ) {
        return {
          state: {
            ...base,
            expectedPaymentMethod: null,
            notice: 'payment_changed',
          },
          effects: [{ type: 'announce', key: 'driver.ride.payment_changed' }],
        };
      }
      return noop({ ...base, expectedPaymentMethod: null });
    }

    case 'load_failed':
      // The api answers a ride that is no longer this driver's with the same
      // 404 as a missing one — for the driver mid-ride that IS the release.
      if (event.code === 'ride_not_found' || event.code === 'ride_not_yours') {
        return {
          state: {
            ...state,
            loading: false,
            ended: { kind: 'released', reason: null },
          },
          effects: [{ type: 'announce', key: 'driver.ride.released' }],
        };
      }
      return noop({ ...state, loading: false, errorCode: event.code });

    case 'step_pressed': {
      if (state.busy || !state.ride || state.ended) return noop(state);
      const step = stepFor(state.ride.status);
      if (!step) return noop(state);
      const busy = { ...state, busy: true, errorCode: null };
      return {
        state: busy,
        effects: [
          step === 'complete'
            ? { type: 'post_complete', rideId: state.ride.id }
            : { type: 'post_step', step, rideId: state.ride.id },
        ],
      };
    }

    case 'step_done': {
      // REST is authoritative for the step just taken; `ride:status` will
      // say the same thing a moment later and be a no-op.
      const to = DRIVER_STEPS[event.step].to;
      const ride = state.ride ? { ...state.ride, status: to } : null;
      const key = TITLE_KEY[to];
      return {
        state: { ...state, busy: false, ride },
        effects: key ? [{ type: 'announce', key }] : [],
      };
    }

    case 'step_failed': {
      const failed = { ...state, busy: false, errorCode: event.code };
      if (event.code === 'ride_not_yours' || event.code === 'ride_not_found') {
        return {
          state: { ...failed, ended: { kind: 'released', reason: null } },
          effects: [{ type: 'announce', key: 'driver.ride.released' }],
        };
      }
      // A 409 means the server's status is not the one on screen — or, after
      // a socket `completed`, that the complete landed and only the answer
      // was lost (Q5). Either way the truth is one read away.
      const reconcile =
        state.awaitingReceipt ||
        event.code === 'ride_transition_conflict' ||
        event.code.startsWith('ride_not_');
      return {
        state: failed,
        effects:
          reconcile && state.rideId
            ? [{ type: 'fetch_ride', rideId: state.rideId }]
            : [],
      };
    }

    case 'completed':
      if (event.ride.id !== state.rideId) return noop(state);
      return {
        state: {
          ...state,
          busy: false,
          loading: false,
          errorCode: null,
          awaitingReceipt: false,
          ride: event.ride,
          ended: { kind: 'completed', ride: event.ride },
        },
        effects: [{ type: 'announce', key: 'driver.ride.completed_title' }],
      };

    case 'status': {
      const e = event.event;
      if (e.rideId !== state.rideId || !state.ride) return noop(state);
      if (state.ended) return noop(state); // over is over; a late event changes nothing
      const s = e.status;
      if (isActive(s)) {
        // Never ratcheted: `previousStatus` may be "higher" than `status`.
        return noop({ ...state, ride: { ...state.ride, status: s } });
      }
      if (isPooled(s)) {
        return {
          state: {
            ...state,
            ride: { ...state.ride, status: s },
            ended: { kind: 'released', reason: e.reason },
          },
          effects: [{ type: 'announce', key: 'driver.ride.released' }],
        };
      }
      if (isCancelled(s)) {
        return {
          state: {
            ...state,
            ride: { ...state.ride, status: s },
            ended: { kind: 'cancelled', reason: e.reason },
          },
          effects: [{ type: 'announce', key: 'driver.ride.cancelled' }],
        };
      }
      if (s === 'completed' || s === 'settled') {
        // The receipt comes from the REST answer to `complete`, or — if that
        // answer was lost — from a re-read whose `split` is set at completion.
        const next: ActiveRideState = {
          ...state,
          ride: { ...state.ride, status: s },
          awaitingReceipt: true,
        };
        return {
          state: next,
          effects: state.busy
            ? [] // the in-flight complete will answer
            : [{ type: 'fetch_ride', rideId: e.rideId }],
        };
      }
      return noop(state); // `scheduled` cannot follow an active status
    }

    case 'assigned': {
      const e = event.event;
      if (e.driverId !== event.myDriverId) return noop(state);
      if (e.rideId === state.rideId && !state.ended) return noop(state);
      // Dina's force-assign arrives with no offer at all: open the ride.
      return {
        state: opened(e.rideId, null),
        effects: [
          { type: 'fetch_ride', rideId: e.rideId },
          { type: 'route_ride' },
        ],
      };
    }

    case 'socket_connected':
    case 'foreground':
      // Re-join the ride room (server-side, via the read) and reconcile what
      // was missed while disconnected or backgrounded.
      if (!state.rideId || state.ended) return noop(state);
      return {
        state,
        effects: [{ type: 'fetch_ride', rideId: state.rideId }],
      };

    case 'reload_pressed':
      if (!state.rideId) return noop(state);
      return {
        state: { ...state, loading: state.ride === null, errorCode: null },
        effects: [{ type: 'fetch_ride', rideId: state.rideId }],
      };

    case 'notice_dismissed':
      return noop({ ...state, notice: null });

    case 'dismissed':
      return { state: initialActiveRide, effects: [{ type: 'route_home' }] };
  }
}
