import type { Language } from './enums';
import { MESSAGES, type MessageKey } from './i18n';

/**
 * Catalog LOOKUP, split out of `i18n.ts` so that file holds nothing but the
 * three dictionaries.
 *
 * The split is a line-budget one and deliberately shallow: `max-lines` caps
 * shipped source at 500, the catalog grows by ~3 lines per user-facing string
 * (LV/RU/EN), and #19's phases were adding keys from two branches at once. What
 * moved is the code; the `lv`/`ru`/`en` objects stayed exactly where they were,
 * because sibling branches append keys INSIDE them and restructuring those
 * regions turns every future auto-merge into a conflict.
 */

/**
 * `{placeholder}` interpolation. Unknown placeholders are left verbatim rather
 * than swallowed — a visible `{eta}` in a message is a bug you can see and
 * report; an empty gap is one you can't.
 */
export function formatMessage(
  lang: Language,
  key: MessageKey,
  params: Readonly<Record<string, string | number>> = {},
): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
