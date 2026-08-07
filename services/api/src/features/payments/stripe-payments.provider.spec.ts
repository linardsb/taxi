import type { PaymentChargeRequest } from '@taxi/shared';
import type Stripe from 'stripe';
import {
  StripePaymentsProvider,
  type StripeClient,
} from './stripe-payments.provider';

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

interface CreateCall {
  params: Stripe.PaymentIntentCreateParams;
  options: Stripe.RequestOptions | undefined;
}

/**
 * A hand-rolled `StripeClient` — the whole reason `STRIPE_CLIENT` is its own
 * token. `outcome` is either the intent to return or the error to throw, so both
 * of Stripe's decline paths are expressible.
 */
const build = (outcome: { intent?: unknown; throws?: unknown }) => {
  const calls: CreateCall[] = [];
  const stripe = {
    paymentIntents: {
      create: (
        params: Stripe.PaymentIntentCreateParams,
        options?: Stripe.RequestOptions,
      ) => {
        calls.push({ params, options });
        // Rejecting with a NON-Error is deliberate and is half of what this
        // spec exists to prove: Stripe's own error objects are class instances
        // whose only reliable discriminator is a `type` string, and the
        // default-safety case throws `{}` / a bare string on purpose.
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        if (outcome.throws !== undefined) return Promise.reject(outcome.throws);
        return Promise.resolve(outcome.intent);
      },
    },
  } as unknown as StripeClient;

  return { calls, provider: new StripePaymentsProvider(stripe) };
};

describe('StripePaymentsProvider.charge', () => {
  it('creates an off-session confirmed intent and returns its id (expected)', async () => {
    const { provider, calls } = build({
      intent: { id: 'pi_test_success', status: 'succeeded' },
    });

    const result = await provider.charge(request());

    expect(result).toEqual({ ok: true, providerRef: 'pi_test_success' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params).toMatchObject({
      amount: 1_000,
      currency: 'eur', // lowercase for Stripe; 'EUR' everywhere in our own code
      customer: 'cus_test_123',
      payment_method: 'pm_test_456',
      off_session: true,
      confirm: true,
      metadata: { rideId: RIDE_ID },
    });
    // THE SECOND ARGUMENT. In the params object it is silently ignored and
    // every retry mints a new PaymentIntent.
    expect(calls[0]!.options).toEqual({ idempotencyKey: `settle:${RIDE_ID}` });
  });

  it('passes the same idempotency key on a repeated request (edge)', async () => {
    // The retry-safety property, asserted at the boundary we control: the key
    // comes from the ride, so two attempts are one charge at Stripe.
    const { provider, calls } = build({
      intent: { id: 'pi_test_success', status: 'succeeded' },
    });

    await provider.charge(request());
    await provider.charge(request());

    expect(calls).toHaveLength(2);
    expect(calls[0]!.options).toEqual(calls[1]!.options);
  });

  it('treats a returned requires_payment_method intent as declined, keeping its id (edge)', async () => {
    const { provider } = build({
      intent: { id: 'pi_test_rpm', status: 'requires_payment_method' },
    });

    await expect(provider.charge(request())).resolves.toEqual({
      ok: false,
      reason: 'declined',
      providerRef: 'pi_test_rpm',
      message: 'payment_intent_requires_payment_method',
    });
  });

  it('treats requires_action (SCA) as declined, not as a retryable fault (edge)', async () => {
    // SCA means the rider must be brought back on-session — #17's problem. A
    // retry from here re-fails identically.
    const { provider } = build({
      intent: { id: 'pi_test_sca', status: 'requires_action' },
    });

    await expect(provider.charge(request())).resolves.toEqual({
      ok: false,
      reason: 'declined',
      providerRef: 'pi_test_sca',
      message: 'payment_intent_requires_action',
    });
  });

  it.each(['processing', 'requires_capture', 'requires_confirmation'] as const)(
    'routes a non-terminal %s intent to provider_error, not declined (edge)',
    async (status) => {
      // THE DOCTRINE AT THE TOP OF THE FILE, applied to the non-throw path —
      // which used to contradict it by falling through to `declined` for
      // everything not `succeeded`. `processing` is the case that matters: the
      // money may yet move, so a 402 would tell a driver the rider's card failed
      // while a charge is still in flight.
      //
      // WHAT THIS BUYS IS DIAGNOSIS, NOT RECOVERY. A `processing` intent strands
      // the ride under EITHER bucketing: the key is ride-derived, so Stripe
      // replays the same cached answer to every retry, and with no webhooks (see
      // the payments barrel) nothing else advances the ride. What changes is
      // that the log carries an honest reason and the caller gets the retry-SAFE
      // class rather than a 402 that blames the rider's card. The caveat of
      // being retry-safe: a retry landing after Stripe's key window expires
      // would mint a SECOND PaymentIntent, which is what #67's runbook checks
      // for before anyone settles a stuck ride by hand.
      const { provider } = build({ intent: { id: `pi_${status}`, status } });

      await expect(provider.charge(request())).resolves.toEqual({
        ok: false,
        reason: 'provider_error',
        providerRef: `pi_${status}`,
        message: `payment_intent_${status}`,
      });
    },
  );

  it('classifies a thrown StripeCardError as declined with its decline code (failure)', async () => {
    const { provider } = build({
      throws: {
        type: 'StripeCardError',
        code: 'card_declined',
        decline_code: 'insufficient_funds',
        payment_intent: { id: 'pi_test_declined' },
      },
    });

    await expect(provider.charge(request())).resolves.toEqual({
      ok: false,
      reason: 'declined',
      providerRef: 'pi_test_declined',
      message: 'insufficient_funds',
    });
  });

  it.each([
    'StripeRateLimitError',
    'StripeIdempotencyError',
    'StripeConnectionError',
  ])(
    'classifies %s as provider_error and keeps the type in the message (failure)',
    async (type) => {
      const { provider } = build({
        throws: { type, message: 'upstream said no' },
      });

      const result = await provider.charge(request());

      expect(result).toMatchObject({
        ok: false,
        reason: 'provider_error',
        providerRef: null,
      });
      // Flattening these into "provider error" would hide StripeIdempotencyError,
      // which can only mean the amount for a ride changed between attempts — a
      // real bug the frozen settled split is supposed to make impossible.
      if (!result.ok) expect(result.message).toContain(type);
    },
  );

  it('keeps the PaymentIntent id on a NON-card error too (edge)', async () => {
    // `provider_error` MEANS "we don't know whether the money moved", so it is
    // exactly where the reconciliation handle is worth most. Discarding it here
    // while keeping it on the decline branch had the asymmetry backwards.
    //
    // `StripeAPIError` AND NOT `StripeConnectionError`, which is the shape this
    // fixture had first and cannot occur: `payment_intent` is assigned on the
    // BASE `StripeError` from an HTTP response body (`cjs/Error.js:97`), while
    // `StripeConnectionError` is built locally from `{ message, detail }` with
    // no response to read (`cjs/RequestSender.js:419-424`) — so it can never
    // carry one. Read with the `it.each` above, which asserts exactly that:
    // connection error → `providerRef: null`, API error → the intent survives.
    const { provider } = build({
      throws: {
        type: 'StripeAPIError',
        message: 'network went away mid-confirm',
        payment_intent: { id: 'pi_test_inflight' },
      },
    });

    const result = await provider.charge(request());

    expect(result).toMatchObject({
      ok: false,
      reason: 'provider_error',
      providerRef: 'pi_test_inflight',
    });
  });

  it('classifies a plain Error as provider_error (failure)', async () => {
    const { provider } = build({ throws: new Error('connection reset') });

    await expect(provider.charge(request())).resolves.toEqual({
      ok: false,
      reason: 'provider_error',
      providerRef: null,
      message: 'connection reset',
    });
  });

  it.each([[{}], ['a bare string'], [null], [undefined]])(
    'defaults an unrecognisable throw (%p) to provider_error without crashing (failure)',
    async (thrown) => {
      // THE ASYMMETRIC DEFAULT, pinned. Anything we cannot classify lands in the
      // retry-SAFE bucket, because misfiling a transient fault as `declined`
      // tells a driver the rider's card failed when it did not.
      const { provider } = build({ throws: thrown ?? new Error('nullish') });

      const result = await provider.charge(request());

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe('provider_error');
        expect(result.providerRef).toBeNull();
      }
    },
  );
});
