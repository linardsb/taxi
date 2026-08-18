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
