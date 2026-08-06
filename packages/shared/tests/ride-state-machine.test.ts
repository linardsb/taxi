import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TRANSITIONS,
  InvalidRideTransitionError,
  RIDE_STATUSES,
  assertTransition,
  canTransition,
  isCancelled,
  isPaymentMethodLocked,
  isTerminal,
} from '../src/ride-state-machine';

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

  it('every status has a transitions entry', () => {
    for (const status of RIDE_STATUSES) {
      expect(ALLOWED_TRANSITIONS[status]).toBeDefined();
    }
  });
});
