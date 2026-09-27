import {
  driverRideSchema,
  formatMessage,
  type DriverRide,
  type RideStatus,
  type RideStatusEvent,
} from '@taxi/shared';
import {
  decide,
  initialActiveRide,
  type ActiveRideState,
} from './active-ride-state';
import { announcePrompt } from './arrival-announce';

const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OTHER_RIDE = '8d7c6b5a-4938-4271-8615-4a3b2c1d0e9f';
const AT = '2026-09-27T10:00:00.000Z';
const LATER = '2026-09-27T10:00:30.000Z';
const EARLIER = '2026-09-27T09:59:30.000Z';

const ride = (
  over: Partial<DriverRide> & { announceArrival?: boolean } = {},
): DriverRide => {
  const { announceArrival = true, ...rest } = over;
  return driverRideSchema.parse({
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    status: 'arrived',
    riderId: '99999999-8888-4777-8666-555555555555',
    driverId: 'd0000000-0000-4000-8000-000000000001',
    paymentMethod: 'cash',
    request: {
      riderId: '99999999-8888-4777-8666-555555555555',
      pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
      destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
      paymentMethod: 'cash',
      options: { announceArrival },
    },
    quote: null,
    createdAt: AT,
    updatedAt: AT,
    rider: { displayName: 'Anna', phone: '+37120000003' },
    ...rest,
  });
};

/** Opened and loaded — the screen the driver is looking at. */
const showing = (r: DriverRide = ride()): ActiveRideState => {
  const opened = decide(initialActiveRide, {
    type: 'open',
    rideId: r.id,
  }).state;
  return decide(opened, { type: 'loaded', ride: r }).state;
};

const request = (at: string, rideId = RIDE_ID) =>
  ({ type: 'announce_requested', rideId, at }) as const;

const NOTICE_EFFECTS = [
  { type: 'haptic' },
  { type: 'announce', key: 'driver.ride.announce_requested' },
];

const status = (
  s: RideStatus,
  previousStatus: RideStatus,
): RideStatusEvent => ({
  rideId: RIDE_ID,
  orderId: '11111111-2222-4333-8444-555555555555',
  status: s,
  previousStatus,
  reason: null,
  at: AT,
});

describe('announcePrompt (#259)', () => {
  const t = (p: ReturnType<typeof announcePrompt>) =>
    p === null ? null : formatMessage('lv', p.key, p.params);

  it.each([
    ['accepted', 'Anna', 'driver.ride.announce_note', {}],
    ['arriving', null, 'driver.ride.announce_note', {}],
    ['arrived', 'Anna', 'driver.ride.announce_prompt_name', { name: 'Anna' }],
    [
      'arrived',
      null,
      'driver.ride.announce_prompt_destination',
      { address: 'Teika' },
    ],
  ] as const)(
    'a flagged ride at %s with name %s → %s (expected)',
    (s, displayName, key, params) => {
      expect(
        announcePrompt(
          ride({ status: s, rider: { displayName, phone: null } }),
        ),
      ).toEqual({ key, params });
    },
  );

  it('says «Sakta, Anna!» with a name and «Sakta, uz Teika!» without (expected — D4)', () => {
    expect(t(announcePrompt(ride()))).toContain('„Sakta, Anna!”');
    expect(
      t(announcePrompt(ride({ rider: { displayName: null, phone: null } }))),
    ).toContain('„Sakta, uz Teika!”');
  });

  it.each(['in_progress', 'completed', 'requested'] as const)(
    'nothing at %s (edge)',
    (s) => {
      expect(announcePrompt(ride({ status: s }))).toBeNull();
    },
  );

  it('nothing on an un-flagged ride, at any status (edge)', () => {
    for (const s of ['accepted', 'arriving', 'arrived'] as const) {
      expect(
        announcePrompt(ride({ status: s, announceArrival: false })),
      ).toBeNull();
    }
  });
});

describe('decide — the announce request (#259)', () => {
  it('a socket request at arrived shows the notice, buzzes and speaks (expected)', () => {
    const d = decide(showing(), request(AT));
    expect(d.state.notice).toBe('announce_requested');
    expect(d.state.lastAnnounceAt).toBe(AT);
    expect(d.effects).toEqual(NOTICE_EFFECTS);
  });

  it('the same `at` a second time is a noop — the three legs dedupe (edge)', () => {
    const once = decide(showing(), request(AT)).state;
    const again = decide({ ...once, notice: null }, request(AT));
    expect(again.state.notice).toBeNull();
    expect(again.effects).toEqual([]);
  });

  it('a newer `at` while the notice is still up speaks and buzzes again (edge — H3)', () => {
    const once = decide(showing(), request(AT)).state;
    const again = decide(once, request(LATER));
    expect(again.state.lastAnnounceAt).toBe(LATER);
    expect(again.effects).toEqual(NOTICE_EFFECTS);
  });

  it('an OLDER `at` after a newer one is a noop (edge — L5)', () => {
    const newer = decide(showing(), request(LATER)).state;
    const older = decide({ ...newer, notice: null }, request(EARLIER));
    expect(older.state.notice).toBeNull();
    expect(older.state.lastAnnounceAt).toBe(LATER);
    expect(older.effects).toEqual([]);
  });

  it('is a noop before arrival, and for another ride (failure)', () => {
    const arriving = showing(ride({ status: 'arriving' }));
    expect(decide(arriving, request(AT)).effects).toEqual([]);
    expect(decide(arriving, request(AT)).state.notice).toBeNull();
    expect(decide(showing(), request(AT, OTHER_RIDE)).effects).toEqual([]);
  });

  it('a re-read with a newer announceRequestedAt replays the notice; equal or older does not (expected — the replay leg)', () => {
    const s = showing();
    const replay = decide(s, {
      type: 'loaded',
      ride: ride({ announceRequestedAt: AT }),
    });
    expect(replay.state.notice).toBe('announce_requested');
    expect(replay.effects).toEqual(NOTICE_EFFECTS);

    const dismissed = decide(replay.state, { type: 'notice_dismissed' }).state;
    for (const at of [AT, EARLIER]) {
      const stale = decide(dismissed, {
        type: 'loaded',
        ride: ride({ announceRequestedAt: at }),
      });
      expect(stale.state.notice).toBeNull();
      expect(stale.effects).toEqual([]);
    }
  });

  it('re-opening the same ride keeps lastAnnounceAt; opening another resets it (edge)', () => {
    const heard = decide(showing(), request(AT)).state;
    const same = decide(heard, { type: 'open', rideId: RIDE_ID }).state;
    expect(same.lastAnnounceAt).toBe(AT);
    const other = decide(heard, { type: 'open', rideId: OTHER_RIDE }).state;
    expect(other.lastAnnounceAt).toBeNull();
  });

  it('«Sākt braucienu» clears the notice as the ride leaves arrived (edge — M2)', () => {
    const heard = decide(showing(), request(AT)).state;
    const started = decide(
      { ...heard, busy: true },
      { type: 'step_done', step: 'start' },
    );
    expect(started.state.ride?.status).toBe('in_progress');
    expect(started.state.notice).toBeNull();
  });

  it('a status event leaving arrived clears the notice (edge — M2)', () => {
    const heard = decide(showing(), request(AT)).state;
    const moved = decide(heard, {
      type: 'status',
      event: status('in_progress', 'arrived'),
    });
    expect(moved.state.notice).toBeNull();
  });

  it('a payment_changed notice survives a status event leaving arrived (edge — the clear is conditional)', () => {
    const s = { ...showing(), notice: 'payment_changed' as const };
    const moved = decide(s, {
      type: 'status',
      event: status('in_progress', 'arrived'),
    });
    expect(moved.state.notice).toBe('payment_changed');
  });

  it('a request replaces an undismissed payment_changed notice, and leaving arrived clears it (edge — PR #293 F7)', () => {
    const s = { ...showing(), notice: 'payment_changed' as const };
    const heard = decide(s, request(AT));
    expect(heard.state.notice).toBe('announce_requested');
    expect(heard.effects).toEqual(NOTICE_EFFECTS);

    const moved = decide(heard.state, {
      type: 'status',
      event: status('in_progress', 'arrived'),
    });
    // Replaced, not restored: the pill carries the operative method.
    expect(moved.state.notice).toBeNull();
  });
});
