import { describe, expect, it } from 'vitest';
import {
  PUSH_DELIVERY_FAILURES,
  type PushDeliveryFailure,
  type PushDeliveryResult,
  type PushProvider,
} from '../src/seams/push-provider';

describe('push delivery failure contract (#14)', () => {
  it('is exactly the two reasons a caller can act on (expected)', () => {
    // The drivers slice branches once: `device_not_registered` nulls the
    // token, anything else is logged. A third value would silently inherit
    // the log-only arm; this pin forces whoever adds one to visit it.
    expect(PUSH_DELIVERY_FAILURES).toEqual([
      'device_not_registered',
      'provider_error',
    ]);
  });

  it('splits by "forget the token?", not by retry semantics (edge)', () => {
    // The Record goes red at COMPILE time the moment a value joins
    // PUSH_DELIVERY_FAILURES without a caller behaviour.
    const callerBehaviour: Record<
      PushDeliveryFailure,
      'forget-token' | 'log-only'
    > = {
      device_not_registered: 'forget-token',
      provider_error: 'log-only',
    };
    expect(callerBehaviour.device_not_registered).toBe('forget-token');
    expect(callerBehaviour.provider_error).toBe('log-only');
  });

  it('a fake provider can return every variant without throwing (failure path is a value)', async () => {
    const results: PushDeliveryResult[] = [
      { ok: true },
      { ok: false, reason: 'device_not_registered' },
      { ok: false, reason: 'provider_error' },
    ];
    const fake: PushProvider = {
      send: () =>
        Promise.resolve(
          results.shift() ?? { ok: false, reason: 'provider_error' },
        ),
    };
    const message = { title: 'Sakta Cab', body: 'x' };
    await expect(fake.send('ExpoPushToken[a]', message)).resolves.toEqual({
      ok: true,
    });
    await expect(fake.send('ExpoPushToken[a]', message)).resolves.toEqual({
      ok: false,
      reason: 'device_not_registered',
    });
    await expect(fake.send('ExpoPushToken[a]', message)).resolves.toEqual({
      ok: false,
      reason: 'provider_error',
    });
  });
});
