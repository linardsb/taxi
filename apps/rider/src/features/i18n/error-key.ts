import { isMessageKey, type MessageKey } from '@taxi/shared';

/**
 * The api's snake-case error code → catalog copy. A code the catalog has
 * never met renders `rider.error.generic`, never the raw code.
 */
export function errorMessageKey(code: string): MessageKey {
  const key = `rider.error.${code}`;
  return isMessageKey(key) ? key : 'rider.error.generic';
}
