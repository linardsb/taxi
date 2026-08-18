import type {
  DispatchBoardEvent,
  DispatchUnclaimedEvent,
} from '@taxi/shared';
import { describe, expect, it } from 'vitest';
import {
  acknowledgeAlert,
  ALERTS_CAP,
  applyDriverLocation,
  applyFrame,
  emptyBoard,
  isStale,
  OFFLINE_AFTER_FAILURES,
  pillFrom,
  pushOfflineAlert,
  pushSmsFailedAlert,
  pushUnclaimedAlert,
  STALE_MS,
} from './board-state';

const CITY = '00000000-0000-4000-8000-000000000001';
const RIDE = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const DRIVER = 'd0000000-0000-4000-8000-000000000001';
const AT = '2026-08-15T12:00:00.000Z';
const NOW = Date.parse(AT);

const frame = (over: Partial<DispatchBoardEvent> = {}): DispatchBoardEvent => ({
  cityId: CITY,
  at: AT,
  rides: [],
  zones: [],
  drivers: [
    {
      driverId: DRIVER,
      name: 'Jānis',
      phone: '+37129999001',
      location: { lat: 56.95, lng: 24.11 },
      lastSeenAt: AT,
      zoneName: 'Centrs',
      status: 'online',
    },
  ],
  ...over,
});

const unclaimed = (
  over: Partial<DispatchUnclaimedEvent> = {},
): DispatchUnclaimedEvent => ({
  rideId: RIDE,
  pickup: { location: { lat: 56.95, lng: 24.11 }, address: 'Brīvības 1' },
  requestedAt: AT,
  unclaimedSeconds: 90,
  offerAttempts: 2,
  ...over,
});

describe('applyFrame / applyDriverLocation', () => {
  it('replaces the frame wholesale and stamps receipt time (expected)', () => {
    const withOld = applyFrame(emptyBoard(), frame(), NOW - 10_000);
    const next = applyFrame(withOld, frame({ drivers: [] }), NOW);
    expect(next.frame?.drivers).toEqual([]); // nothing merged, nothing kept
    expect(next.lastFrameAtMs).toBe(NOW);
  });

  it('ignores a frame the server stamped BEFORE the one on screen (edge)', () => {
    // Reconnect: the socket cadence delivers t+2s while a REST snapshot built
    // at t+0 is still in flight on a cold api. Applying the late arrival would
    // put a 3-second-old ride set on screen and stamp it as received now —
    // silent staleness under a green «Tiešraide».
    const fresh = applyFrame(
      emptyBoard(),
      frame({ at: '2026-08-15T12:00:02.000Z', rides: [] }),
      NOW + 2_000,
    );
    const late = applyFrame(
      fresh,
      frame({ at: AT, drivers: [] }), // built at t+0, arrives at t+3
      NOW + 3_000,
    );
    expect(late).toBe(fresh); // untouched, and receipt time NOT re-stamped
    expect(late.lastFrameAtMs).toBe(NOW + 2_000);
  });

  it('still refreshes receipt time for a re-delivered identical frame (edge)', () => {
    // Strict `<`: an equal `at` is the same frame arriving twice, and the pill
    // must not go stale just because the server had nothing new to say.
    const first = applyFrame(emptyBoard(), frame(), NOW);
    const again = applyFrame(first, frame(), NOW + 1_500);
    expect(again.lastFrameAtMs).toBe(NOW + 1_500);
  });

  it('never lets a HYDRATED frame reject live frames (failure)', () => {
    // A stored frame's `at` can sit arbitrarily far in the future — a clock
    // step, a restored profile, the same origin pointed at another
    // environment. Treating it as an ordering baseline would reject every
    // subsequent frame forever and pin the pill at «Atjaunojas…», which,
    // unlike the bug above, does not self-heal.
    const hydrated = {
      ...emptyBoard(),
      frame: frame({ at: '2099-01-01T00:00:00.000Z' }),
    };
    expect(hydrated.lastFrameAtMs).toBe(null); // that's what marks it hydrated

    const live = applyFrame(hydrated, frame({ at: AT, drivers: [] }), NOW);

    expect(live.frame?.at).toBe(AT);
    expect(live.lastFrameAtMs).toBe(NOW);
  });

  it('patches a known driver position between frames (expected)', () => {
    const state = applyFrame(emptyBoard(), frame(), NOW);
    const next = applyDriverLocation(state, {
      driverId: DRIVER,
      location: { lat: 57.0, lng: 24.2 },
      at: '2026-08-15T12:00:01.000Z',
    });
    expect(next.frame?.drivers[0]?.location).toEqual({ lat: 57.0, lng: 24.2 });
    expect(next.frame?.drivers[0]?.lastSeenAt).toBe(
      '2026-08-15T12:00:01.000Z',
    );
  });

  it('ignores a location for a driver the frame does not carry (edge)', () => {
    const state = applyFrame(emptyBoard(), frame({ drivers: [] }), NOW);
    const next = applyDriverLocation(state, {
      driverId: DRIVER,
      location: { lat: 57.0, lng: 24.2 },
      at: AT,
    });
    expect(next).toBe(state); // untouched — next frame self-heals
  });
});

describe('alerts', () => {
  it('pushes newest-first and acknowledges by id (expected)', () => {
    let state = pushUnclaimedAlert(emptyBoard(), unclaimed());
    state = pushSmsFailedAlert(state, {
      rideId: RIDE,
      kind: 'booking_confirmed',
      at: '2026-08-15T12:01:00.000Z',
    });
    expect(state.alerts.map((a) => a.kind)).toEqual([
      'sms_failed',
      'unclaimed',
    ]);

    state = acknowledgeAlert(state, state.alerts[1]!.id);
    expect(state.alerts.map((a) => a.kind)).toEqual(['sms_failed']);
  });

  it('drops a duplicate delivery but accepts a post-window re-alert (edge)', () => {
    let state = pushUnclaimedAlert(emptyBoard(), unclaimed());
    state = pushUnclaimedAlert(state, unclaimed()); // same event twice
    expect(state.alerts).toHaveLength(1);

    // 300 s later the server legitimately re-alerts the same ride — new
    // unclaimedSeconds, new entry (the client must tolerate this).
    state = pushUnclaimedAlert(state, unclaimed({ unclaimedSeconds: 390 }));
    expect(state.alerts).toHaveLength(2);
  });

  it('caps the list at ALERTS_CAP, shedding the oldest (failure)', () => {
    let state = emptyBoard();
    for (let i = 0; i < ALERTS_CAP + 5; i += 1) {
      state = pushOfflineAlert(
        state,
        new Date(NOW + i * 1000).toISOString(),
      );
    }
    expect(state.alerts).toHaveLength(ALERTS_CAP);
    // Newest survived, oldest fell off.
    expect(state.alerts[0]?.at).toBe(
      new Date(NOW + (ALERTS_CAP + 4) * 1000).toISOString(),
    );
  });
});

describe('pillFrom — the one truth derivation', () => {
  const base = {
    connected: true,
    failedAttempts: 0,
    browserOnline: true,
    nowMs: NOW,
    lastFrameAtMs: NOW - 1_000,
  };

  it('claims live only for connected + fresh frame (expected)', () => {
    expect(pillFrom(base)).toBe('live');
  });

  it('withdraws live when the frames go silent, socket flags be damned (edge)', () => {
    // The TaxiCaller failure mode: a console that looks alive while stale.
    expect(
      pillFrom({ ...base, lastFrameAtMs: NOW - STALE_MS }),
    ).toBe('reconnecting');
    expect(pillFrom({ ...base, lastFrameAtMs: null })).toBe('reconnecting');
  });

  it('reads reconnecting while disconnected but not yet given up (edge)', () => {
    expect(
      pillFrom({
        ...base,
        connected: false,
        failedAttempts: OFFLINE_AFTER_FAILURES - 1,
      }),
    ).toBe('reconnecting');
  });

  it('goes offline after the failure budget, or the browser says so (failure)', () => {
    expect(
      pillFrom({
        ...base,
        connected: false,
        failedAttempts: OFFLINE_AFTER_FAILURES,
      }),
    ).toBe('offline');
    expect(pillFrom({ ...base, browserOnline: false })).toBe('offline');
  });

  it('isStale treats "no frame ever" as stale (edge)', () => {
    expect(isStale(NOW, null)).toBe(true);
    expect(isStale(NOW, NOW - STALE_MS + 1)).toBe(false);
  });
});
