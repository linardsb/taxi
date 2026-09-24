import { randomInt } from 'node:crypto';
import type { PickupPin } from '@taxi/shared';

/**
 * Mints a ride's pickup PIN (#258), called once at creation when the booking
 * opted in.
 *
 * `randomInt`, never `Math.random`, as with the OTP. The max is exclusive, so
 * the range is `0000`–`9999`. Leading zeros are kept on purpose: a `number`
 * would lose them, and the rider would say "42" to a field expecting 4 digits.
 */
export function mintPickupPin(): PickupPin {
  return String(randomInt(0, 10_000)).padStart(4, '0');
}
