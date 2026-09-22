import { describe, expect, it } from 'vitest';
import { pushTokenUpdateSchema } from '../src/schemas/push-token';

/**
 * Moved out of `driver.test.ts` at #17's rider arrival push, with the schema
 * it covers — both apps mint this shape and both register it.
 */
describe('pushTokenUpdateSchema (#14, #17)', () => {
  it('accepts the classic ExponentPushToken form (expected)', () => {
    expect(
      pushTokenUpdateSchema.parse({
        token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      }).token,
    ).toBe('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]');
  });

  it('accepts the newer ExpoPushToken form (edge)', () => {
    expect(
      pushTokenUpdateSchema.safeParse({ token: 'ExpoPushToken[abc-DEF_123]' })
        .success,
    ).toBe(true);
  });

  it('rejects a raw FCM/APNs handle and an empty bracket (failure)', () => {
    // The seam posts to Expo's push API, which only understands its own
    // tokens; a raw device token here would be a guaranteed provider error
    // on every send.
    expect(pushTokenUpdateSchema.safeParse({ token: 'fcm:abc' }).success).toBe(
      false,
    );
    expect(
      pushTokenUpdateSchema.safeParse({ token: 'ExpoPushToken[]' }).success,
    ).toBe(false);
  });
});
