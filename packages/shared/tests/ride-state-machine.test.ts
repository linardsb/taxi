import { describe, expect, it } from 'vitest';
import {
  ACTIVE_DRIVER_RIDE_STATUSES,
  ALLOWED_TRANSITIONS,
  BOARD_LIVE_RIDE_STATUSES,
  DRIVER_STEPS,
  InvalidRideTransitionError,
  RIDE_STATUSES,
  assertTransition,
  canTransition,
  isCancelled,
  isPaymentMethodLocked,
  isTerminal,
} from '../src/ride-state-machine';

describe('DRIVER_STEPS (#15)', () => {
  it('every step is an edge of ALLOWED_TRANSITIONS (expected)', () => {
    // The api guards a step with `ride.status === from` and nothing else; that
    // is only sound while every pair here is a legal hop.
    for (const step of Object.values(DRIVER_STEPS)) {
      expect(canTransition(step.from, step.to), `${step.from}→${step.to}`).toBe(
        true,
      );
    }
  });

  it('the four `from` statuses are exactly the active-driver set, in order (edge)', () => {
    // The app renders one primary button per active status by looking up the
    // step whose `from` matches — a status with no step would be a dead end.
    expect(Object.values(DRIVER_STEPS).map((s) => s.from)).toEqual([
      ...ACTIVE_DRIVER_RIDE_STATUSES,
    ]);
  });

  it('the steps chain: each `to` is the next step`s `from`, ending at completed (edge)', () => {
    const steps = Object.values(DRIVER_STEPS);
    for (let i = 0; i < steps.length - 1; i++) {
      expect(steps[i]!.to).toBe(steps[i + 1]!.from);
    }
    expect(steps[steps.length - 1]!.to).toBe('completed');
  });
});

describe('ride state machine', () => {
  it('allows the full happy path', () => {
    const happyPath = [
      'requested',
      'offered',
      'accepted',
      'arriving',
      'arrived',
      'in_progress',
      'completed',
      'settled',
    ] as const;
    for (let i = 0; i < happyPath.length - 1; i++) {
      expect(canTransition(happyPath[i]!, happyPath[i + 1]!)).toBe(true);
    }
  });

  it('supports the scheduled entry path and the re-offer loop (edge)', () => {
    expect(canTransition('scheduled', 'requested')).toBe(true);
    expect(canTransition('offered', 'requested')).toBe(true); // driver declined → re-offer
    expect(canTransition('queued', 'offered')).toBe(true); // geozone queue front
  });

  it('allows the dispatcher release back into the cascade (#19, edge)', () => {
    // Reassignment is a release, not a cancellation — the ride keeps its id,
    // its tracking token and the rider's SMS thread.
    expect(canTransition('accepted', 'requested')).toBe(true);
    expect(canTransition('arriving', 'requested')).toBe(true);
  });

  it('refuses to release a ride the driver has physically reached (#19, failure)', () => {
    // A driver at the pickup, or carrying the passenger, is not reassignable.
    expect(canTransition('arrived', 'requested')).toBe(false);
    expect(canTransition('in_progress', 'requested')).toBe(false);
  });

  it('rejects impossible transitions (failure)', () => {
    expect(canTransition('requested', 'in_progress')).toBe(false);
    expect(canTransition('settled', 'requested')).toBe(false);
    expect(canTransition('in_progress', 'cancelled_by_rider')).toBe(false);
    expect(() => assertTransition('completed', 'accepted')).toThrow(
      InvalidRideTransitionError,
    );
  });

  it('terminal and cancelled states are consistent', () => {
    for (const status of RIDE_STATUSES) {
      if (isCancelled(status)) expect(isTerminal(status)).toBe(true);
    }
    expect(isTerminal('settled')).toBe(true);
    expect(isTerminal('in_progress')).toBe(false);
  });

  it("locks the payment method exactly from driver acceptance onward (Atis's rule)", () => {
    expect(isPaymentMethodLocked('requested')).toBe(false);
    expect(isPaymentMethodLocked('offered')).toBe(false);
    expect(isPaymentMethodLocked('accepted')).toBe(true);
    expect(isPaymentMethodLocked('in_progress')).toBe(true);
    expect(isPaymentMethodLocked('settled')).toBe(true);
  });

  it('active-driver statuses are the non-terminal payment-locked ones minus completed (#61)', () => {
    // Payment lock starts at acceptance (Atis's rule) and `completed` is
    // excluded because `releaseFromRide` runs inside `complete()` — the
    // derivation IS the semantic claim, so a new status added to the machine
    // forces a conscious decision here.
    expect(ACTIVE_DRIVER_RIDE_STATUSES).toEqual(
      RIDE_STATUSES.filter(
        (s) => isPaymentMethodLocked(s) && !isTerminal(s) && s !== 'completed',
      ),
    );
  });

  it('every status has a transitions entry', () => {
    for (const status of RIDE_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });
});

describe('BOARD_LIVE_RIDE_STATUSES', () => {
  it('is creation-to-handover, in lifecycle order', () => {
    expect([...BOARD_LIVE_RIDE_STATUSES]).toEqual([
      'requested',
      'offered',
      'queued',
      'accepted',
      'arriving',
      'arrived',
      'in_progress',
    ]);
  });

  it('omits the statuses that are not live work', () => {
    // `scheduled` is not yet live; `completed` is done driving and only
    // awaits settlement — neither belongs on Dina's queue.
    for (const status of ['scheduled', 'completed', 'settled'] as const) {
      expect(BOARD_LIVE_RIDE_STATUSES).not.toContain(status);
    }
  });

  it('carries every status a driver is actively committed to', () => {
    for (const status of ACTIVE_DRIVER_RIDE_STATUSES) {
      expect(BOARD_LIVE_RIDE_STATUSES).toContain(status);
    }
  });

  it('never carries a terminal status — the board would strand the card', () => {
    for (const status of BOARD_LIVE_RIDE_STATUSES) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});
