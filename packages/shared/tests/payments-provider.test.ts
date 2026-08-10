import { describe, expect, it } from 'vitest';
import {
  PAYMENT_FAILURE_REASONS,
  type PaymentFailureReason,
} from '../src/seams/payments-provider';

describe('payment failure reason contract', () => {
  it('is exactly the two reasons a caller can act on (expected)', () => {
    // The settlement service maps these 1:1 onto 402/502 with a binary branch
    // on `reason === 'declined'` — a third value would silently inherit the
    // 502 arm there. This pin forces whoever adds one to visit that mapping
    // and earn the third caller behaviour deliberately.
    expect(PAYMENT_FAILURE_REASONS).toEqual(['declined', 'provider_error']);
  });

  it('splits by "must the rider act?", not by retry semantics (edge)', () => {
    // The Record is the real assertion: it goes red at COMPILE time the moment
    // a value joins PAYMENT_FAILURE_REASONS without a caller behaviour, and
    // its two entries encode the seam's bucketing rule — `declined` means the
    // rider must act; `provider_error` means a retry is safe.
    const callerBehaviour: Record<
      PaymentFailureReason,
      'rider-must-act' | 'retry-safe'
    > = {
      declined: 'rider-must-act',
      provider_error: 'retry-safe',
    };
    expect(callerBehaviour.declined).toBe('rider-must-act');
    expect(callerBehaviour.provider_error).toBe('retry-safe');
  });
});
