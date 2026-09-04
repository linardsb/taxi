import {
  rideSchema,
  splitFare,
  type Ride,
  type RideAssignedEvent,
  type RideStatus,
  type RideStatusEvent,
} from '@taxi/shared';
import {
  decide,
  initialActiveRide,
  stepFor,
  type ActiveRideEffect,
  type ActiveRideState,
} from './active-ride-state';

const types = (effects: ActiveRideEffect[]) => effects.map((e) => e.type);

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OTHER_RIDE = '8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f';
const ME = 'd0000000-0000-4000-8000-000000000001';
const OTHER_DRIVER = 'd0000000-0000-4000-8000-000000000002';
const AT = '2026-09-04T10:00:00.000Z';

const ride = (over: Partial<Ride> = {}): Ride =>
  rideSchema.parse({
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    status: 'accepted',
    riderId: '99999999-8888-4777-8666-555555555555',
    driverId: ME,
    paymentMethod: 'cash',
    request: {
      riderId: '99999999-8888-4777-8666-555555555555',
      pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
      destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
      paymentMethod: 'cash',
    },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
    },
    createdAt: AT,
    updatedAt: AT,
    ...over,
  });

const status = (
  s: RideStatus,
  previousStatus: RideStatus | null,
  over: Partial<RideStatusEvent> = {},
): RideStatusEvent => ({
  rideId: RIDE_ID,
  orderId: '11111111-2222-4333-8444-555555555555',
  status: s,
  previousStatus,
  reason: null,
  at: AT,
  ...over,
});

/** Opened and loaded at `s` — the screen the driver is looking at. */
const showing = (s: RideStatus = 'accepted'): ActiveRideState => {
  const openedState = decide(initialActiveRide, {
    type: 'open',
    rideId: RIDE_ID,
  }).state;
  return decide(openedState, { type: 'loaded', ride: ride({ status: s }) })
    .state;
};

describe('stepFor', () => {
  it('maps each active status to its one step and nothing else (expected)', () => {
    expect(stepFor('accepted')).toBe('arriving');
    expect(stepFor('arriving')).toBe('arrived');
    expect(stepFor('arrived')).toBe('start');
    expect(stepFor('in_progress')).toBe('complete');
    expect(stepFor('completed')).toBeNull();
    expect(stepFor('requested')).toBeNull();
  });
});

describe('decide — open and load', () => {
  it('open fetches the ride and shows a spinner; loaded shows it (expected)', () => {
    const opened = decide(initialActiveRide, { type: 'open', rideId: RIDE_ID });
    expect(opened.state).toMatchObject({ rideId: RIDE_ID, loading: true });
    expect(opened.effects).toEqual([{ type: 'fetch_ride', rideId: RIDE_ID }]);

    const loaded = decide(opened.state, { type: 'loaded', ride: ride() });
    expect(loaded.state.loading).toBe(false);
    expect(loaded.state.ride?.status).toBe('accepted');
    expect(loaded.state.notice).toBeNull();
    expect(loaded.effects).toEqual([]);
  });

  it('announces a payment method that changed between the card and acceptance — once (edge, R2)', () => {
    const opened = decide(initialActiveRide, {
      type: 'open',
      rideId: RIDE_ID,
      expectedPaymentMethod: 'cash',
    }).state;

    const first = decide(opened, {
      type: 'loaded',
      ride: ride({ paymentMethod: 'card' }),
    });
    expect(first.state.notice).toBe('payment_changed');
    expect(first.state.expectedPaymentMethod).toBeNull();
    expect(first.effects).toEqual([
      { type: 'announce', key: 'driver.ride.payment_changed' },
    ]);

    // A reconnect re-reads the same ride: no second notice.
    const second = decide(
      { ...first.state, notice: null },
      { type: 'loaded', ride: ride({ paymentMethod: 'card' }) },
    );
    expect(second.state.notice).toBeNull();
    expect(second.effects).toEqual([]);
  });

  it('a matching method, or no expectation at all, raises no notice (expected)', () => {
    const withExpectation = decide(initialActiveRide, {
      type: 'open',
      rideId: RIDE_ID,
      expectedPaymentMethod: 'cash',
    }).state;
    expect(
      decide(withExpectation, { type: 'loaded', ride: ride() }).state.notice,
    ).toBeNull();
    expect(showing().notice).toBeNull();
  });

  it('ignores a stale answer for another ride id (edge)', () => {
    const s = showing();
    const stale = decide(s, { type: 'loaded', ride: ride({ id: OTHER_RIDE }) });
    expect(stale.state).toBe(s);
  });

  it('a 404 on load is the release: the ride is no longer this driver`s (edge)', () => {
    const opened = decide(initialActiveRide, {
      type: 'open',
      rideId: RIDE_ID,
    }).state;
    const gone = decide(opened, {
      type: 'load_failed',
      code: 'ride_not_found',
    });
    expect(gone.state.ended).toEqual({ kind: 'released', reason: null });
    expect(gone.state.loading).toBe(false);
  });

  it('a network failure on load keeps a reload path, never a dead end (failure)', () => {
    const opened = decide(initialActiveRide, {
      type: 'open',
      rideId: RIDE_ID,
    }).state;
    const failed = decide(opened, { type: 'load_failed', code: 'offline' });
    expect(failed.state.errorCode).toBe('offline');
    expect(failed.state.ended).toBeNull();
    const retry = decide(failed.state, { type: 'reload_pressed' });
    expect(retry.effects).toEqual([{ type: 'fetch_ride', rideId: RIDE_ID }]);
  });
});

describe('decide — the four steps', () => {
  it.each([
    ['accepted', 'post_step', 'arriving', 'arriving'],
    ['arriving', 'post_step', 'arrived', 'arrived'],
    ['arrived', 'post_step', 'start', 'in_progress'],
    ['in_progress', 'post_complete', 'complete', 'completed'],
  ] as const)(
    'from %s the button posts %s and the answer advances to %s (expected)',
    (from, effectType, step, to) => {
      const pressed = decide(showing(from), { type: 'step_pressed' });
      expect(pressed.state.busy).toBe(true);
      expect(pressed.effects).toHaveLength(1);
      expect(pressed.effects[0]!.type).toBe(effectType);
      if (pressed.effects[0]!.type === 'post_step') {
        expect(pressed.effects[0]!.step).toBe(step);
      }
      // A double tap while in flight posts nothing.
      expect(decide(pressed.state, { type: 'step_pressed' }).effects).toEqual(
        [],
      );

      if (step === 'complete') {
        const done = decide(pressed.state, {
          type: 'completed',
          ride: ride({
            status: 'completed',
            split: splitFare(1240, { pct: 15, source: 'platform_base' }),
          }),
        });
        expect(done.state.busy).toBe(false);
        expect(done.state.ended?.kind).toBe('completed');
        if (done.state.ended?.kind === 'completed') {
          expect(done.state.ended.ride.split?.driverNetCents).toBe(1054);
        }
      } else {
        const done = decide(pressed.state, { type: 'step_done', step });
        expect(done.state.busy).toBe(false);
        expect(done.state.ride?.status).toBe(to);
        expect(types(done.effects)).toEqual(['announce']);
      }
    },
  );

  it('a 409 leaves the ride intact, shows the code, and re-reads to reconcile (failure)', () => {
    const pressed = decide(showing('arrived'), { type: 'step_pressed' }).state;
    const failed = decide(pressed, {
      type: 'step_failed',
      code: 'ride_not_arrived',
    });
    expect(failed.state.busy).toBe(false);
    expect(failed.state.errorCode).toBe('ride_not_arrived');
    expect(failed.state.ride?.status).toBe('arrived');
    expect(failed.state.ended).toBeNull();
    expect(failed.effects).toEqual([{ type: 'fetch_ride', rideId: RIDE_ID }]);

    // The reconcile read must NOT wipe the banner: the driver still needs to
    // read why the button did nothing. The next tap clears it.
    const reconciled = decide(failed.state, {
      type: 'loaded',
      ride: ride({ status: 'arrived' }),
    });
    expect(reconciled.state.errorCode).toBe('ride_not_arrived');
    expect(
      decide(reconciled.state, { type: 'step_pressed' }).state.errorCode,
    ).toBeNull();
  });

  it('a 403 ride_not_yours mid-step is the release (edge)', () => {
    const pressed = decide(showing('arriving'), { type: 'step_pressed' }).state;
    const failed = decide(pressed, {
      type: 'step_failed',
      code: 'ride_not_yours',
    });
    expect(failed.state.ended).toEqual({ kind: 'released', reason: null });
  });
});

describe('decide — ride:status reconciliation', () => {
  it('mirrors an active status, forward or backward, never ratcheting (expected)', () => {
    const s = showing('arrived');
    const back = decide(s, {
      type: 'status',
      event: status('arriving', 'arrived'),
    });
    expect(back.state.ride?.status).toBe('arriving');
    expect(back.effects).toEqual([]);
  });

  it('the dispatcher release (accepted → requested) ends the ride as released (edge)', () => {
    const released = decide(showing('accepted'), {
      type: 'status',
      event: status('requested', 'accepted'),
    });
    expect(released.state.ended).toEqual({ kind: 'released', reason: null });
    expect(released.effects).toEqual([
      { type: 'announce', key: 'driver.ride.released' },
    ]);
    // Over is over: a later event for the same ride changes nothing.
    const after = decide(released.state, {
      type: 'status',
      event: status('offered', 'requested'),
    });
    expect(after.state).toBe(released.state);
  });

  it('a cancellation carries its reason to the screen (edge)', () => {
    const cancelled = decide(showing('arriving'), {
      type: 'status',
      event: status('cancelled_by_rider', 'arriving', {
        reason: 'changed plans',
      }),
    });
    expect(cancelled.state.ended).toEqual({
      kind: 'cancelled',
      reason: 'changed plans',
    });
  });

  it('ignores a status for another ride (edge)', () => {
    const s = showing();
    const foreign = decide(s, {
      type: 'status',
      event: status('cancelled_by_rider', 'accepted', { rideId: OTHER_RIDE }),
    });
    expect(foreign.state).toBe(s);
  });

  it('a socket `completed` while the REST answer is lost recovers the receipt by re-reading (edge, Q5)', () => {
    const pressed = decide(showing('in_progress'), {
      type: 'step_pressed',
    }).state;
    // The server committed and emitted; the answer is still in flight.
    const socketFirst = decide(pressed, {
      type: 'status',
      event: status('completed', 'in_progress'),
    });
    expect(socketFirst.state.awaitingReceipt).toBe(true);
    expect(socketFirst.effects).toEqual([]); // the in-flight complete will answer

    // ...then the answer times out.
    const timedOut = decide(socketFirst.state, {
      type: 'step_failed',
      code: 'offline',
    });
    expect(timedOut.effects).toEqual([{ type: 'fetch_ride', rideId: RIDE_ID }]);

    // The re-read carries the split written at completion.
    const settled = ride({
      status: 'completed',
      split: splitFare(1240, { pct: 15, source: 'platform_base' }),
    });
    const recovered = decide(timedOut.state, { type: 'loaded', ride: settled });
    expect(recovered.state.ended).toEqual({ kind: 'completed', ride: settled });
    expect(recovered.state.awaitingReceipt).toBe(false);
  });

  it('a socket `completed` with no step in flight re-reads at once (edge)', () => {
    const idle = decide(showing('in_progress'), {
      type: 'status',
      event: status('completed', 'in_progress'),
    });
    expect(idle.effects).toEqual([{ type: 'fetch_ride', rideId: RIDE_ID }]);
  });
});

describe('decide — force-assign, reconnect, foreground', () => {
  const assigned = (rideId: string, driverId: string): RideAssignedEvent => ({
    rideId,
    driverId,
    source: 'dispatcher',
    dispatcherId: 'a1111111-2222-4333-8444-555555555555',
    at: AT,
  });

  it('Dina`s force-assign opens the ride with no offer shown first (edge)', () => {
    const forced = decide(initialActiveRide, {
      type: 'assigned',
      event: assigned(RIDE_ID, ME),
      myDriverId: ME,
    });
    expect(forced.state).toMatchObject({ rideId: RIDE_ID, loading: true });
    expect(types(forced.effects)).toEqual(['fetch_ride', 'route_ride']);
  });

  it('an assignment of my current ride to someone else, or of any ride to someone else, is not mine to open (edge)', () => {
    const s = showing();
    expect(
      decide(s, {
        type: 'assigned',
        event: assigned(RIDE_ID, OTHER_DRIVER),
        myDriverId: ME,
      }).state,
    ).toBe(s);
    expect(
      decide(s, {
        type: 'assigned',
        event: assigned(RIDE_ID, ME),
        myDriverId: ME,
      }).state,
    ).toBe(s);
  });

  it('every socket connect and every foreground re-reads the ride — the room re-join (expected)', () => {
    const s = showing('arriving');
    expect(decide(s, { type: 'socket_connected' }).effects).toEqual([
      { type: 'fetch_ride', rideId: RIDE_ID },
    ]);
    expect(decide(s, { type: 'foreground' }).effects).toEqual([
      { type: 'fetch_ride', rideId: RIDE_ID },
    ]);
    // Nothing to re-join once the ride is over, or with no ride at all.
    const ended = decide(s, {
      type: 'status',
      event: status('requested', 'arriving'),
    }).state;
    expect(decide(ended, { type: 'socket_connected' }).effects).toEqual([]);
    expect(
      decide(initialActiveRide, { type: 'socket_connected' }).effects,
    ).toEqual([]);
  });

  it('dismissing an ended ride resets everything and routes home (expected)', () => {
    const ended = decide(showing(), {
      type: 'status',
      event: status('cancelled_by_dispatcher', 'accepted'),
    }).state;
    const done = decide(ended, { type: 'dismissed' });
    expect(done.state).toEqual(initialActiveRide);
    expect(done.effects).toEqual([{ type: 'route_home' }]);
  });
});
