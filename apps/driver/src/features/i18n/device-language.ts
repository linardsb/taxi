import { LANGUAGES, type Language } from '@taxi/shared';
import { getLocales } from 'expo-localization';

/** The shape `expo-localization` returns, narrowed to what this reads. */
export interface DeviceLocale {
  languageCode: string | null;
}

const KNOWN: readonly string[] = LANGUAGES;

/**
 * The first device locale the catalog speaks, else Latvian — the pilot's
 * language. Second-choice locales count: a `de-DE, en-GB` phone reads
 * English, not Latvian.
 */
export function deviceLanguage(
  locales: readonly DeviceLocale[] = getLocales(),
): Language {
  for (const locale of locales) {
    const code = locale.languageCode;
    if (code !== null && KNOWN.includes(code)) return code as Language;
  }
  return 'lv';
}
