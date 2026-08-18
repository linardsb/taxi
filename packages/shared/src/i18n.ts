import type { Language } from './enums';
import { en } from './i18n/en';
import { lv, type MessageKey } from './i18n/lv';
import { ru } from './i18n/ru';

export type { MessageKey } from './i18n/lv';

/**
 * The LV/RU/EN message catalog (root rule: nothing user-facing is hardcoded).
 * First consumers: the ride-status SMS (#63) and the no-login tracking page.
 *
 * ASSEMBLY ONLY. The three dictionaries live one per file under `i18n/`, and
 * `formatMessage` lives in `format-message.ts`. They were split out when #19's
 * phases pushed a single catalog past the 500-line cap from two branches at
 * once: the file grows ~3 lines per user-facing string, so one file was never
 * going to hold it, and trimming prose only bought a phase at a time.
 *
 * `lv` is the reference dictionary — `MessageKey` derives from it, and the
 * `satisfies` clause here is what forces `ru`/`en` to carry exactly the same
 * keys. Placeholder parity across languages is pinned by `tests/i18n.test.ts`.
 */
export const MESSAGES = {
  lv,
  ru,
  en,
} as const satisfies Record<Language, Record<MessageKey, string>>;

/**
 * Is this string a key the catalog actually has?
 *
 * For the ONE boundary where a key arrives over the wire rather than being
 * written in source: `dispatchExplanationSchema.key`, composed by the api and
 * rendered by the console and the driver app. An api deployed with a new
 * explanation key in front of a console still running the previous bundle
 * would otherwise reach `MESSAGES[lang][key]` as `undefined` and throw inside
 * `.replace`, taking down the whole ride queue over one missing sentence.
 *
 * Not a general escape hatch: everywhere else, a key is a literal and the type
 * checker is the check.
 *
 * `Object.hasOwn`, not `in`: `in` walks the prototype chain, so `'toString'`,
 * `'constructor'` and `'valueOf'` would all pass this guard and then reach
 * `.replace` on a FUNCTION — the same outage by a different input.
 */
export function isMessageKey(key: string): key is MessageKey {
  return Object.hasOwn(MESSAGES.lv, key);
}
