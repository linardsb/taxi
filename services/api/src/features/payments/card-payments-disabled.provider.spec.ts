import type { PaymentChargeRequest } from '@taxi/shared';
import { CardPaymentsDisabledProvider } from './card-payments-disabled.provider';

const RIDE_ID = 'r0000000-0000-4000-8000-000000000001';

const request = (
  over: Partial<PaymentChargeRequest> = {},
): PaymentChargeRequest => ({
  idempotencyKey: `settle:${RIDE_ID}`,
  amountCents: 1_000,
  currency: 'EUR',
  customerRef: 'cus_test_123',
  instrumentRef: 'pm_test_456',
  rideId: RIDE_ID,
  ...over,
});

describe('CardPaymentsDisabledProvider.charge', () => {
  it('refuses a card charge as a retry-safe provider error naming the cause (expected)', async () => {
    // `provider_error`, not `declined`: the rider's card was never seen, so a
    // 402 blaming it would be a lie to the driver. `message` is what the
    // settlement log carries, and what the runbook tells an operator to read.
    const provider = new CardPaymentsDisabledProvider();

    await expect(provider.charge(request())).resolves.toEqual({
      ok: false,
      reason: 'provider_error',
      providerRef: null,
      message: 'card_payments_disabled',
    });
  });

  it('refuses a repeated request with the same key identically (edge)', async () => {
    // A retry inside the seam's replay window must reach the same answer as
    // the first attempt. Here that is trivially true — nothing is remembered
    // and nothing moves — but the property is what a caller leans on.
    const provider = new CardPaymentsDisabledProvider();

    const first = await provider.charge(request());
    const second = await provider.charge(request());

    expect(second).toEqual(first);
  });

  it.each([
    ['a zero amount', { amountCents: 0 }],
    ['a large amount', { amountCents: 99_999_999 }],
    ['a different idempotency key', { idempotencyKey: 'settle:other' }],
    [
      'a different rider',
      { customerRef: 'cus_other', instrumentRef: 'pm_other' },
    ],
  ])(
    'never returns a success-shaped result for %s (failure)',
    async (_label, over) => {
      // THE PROPERTY THIS CLASS EXISTS FOR. `StubPaymentsProvider` answers
      // `ok: true` to all of these; a production deploy that reached it would
      // settle rides for money nobody collected.
      const provider = new CardPaymentsDisabledProvider();

      const result = await provider.charge(request(over));

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.providerRef).toBeNull();
    },
  );
});
