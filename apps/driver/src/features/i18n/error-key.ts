import { isMessageKey, type MessageKey } from '@taxi/shared';

/**
 * The api's snake-case error code → catalog copy. A code the catalog has
 * never met renders `driver.error.generic`, never the raw code.
 */
export function errorMessageKey(code: string): MessageKey {
  const key = `driver.error.${code}`;
  return isMessageKey(key) ? key : 'driver.error.generic';
}
