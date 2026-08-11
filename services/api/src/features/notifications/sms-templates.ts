import type { Language } from '@taxi/shared';

/**
 * Pure helpers between the catalog (`formatMessage`, @taxi/shared) and the
 * send path. No Nest, no I/O — the unit spec exercises these directly.
 */

/**
 * The page defaults to LV; `?lang=` only travels when it changes something,
 * so the common-case SMS stays one segment shorter.
 */
export function trackingLink(
  baseUrl: string,
  token: string,
  language: Language,
): string {
  const url = `${baseUrl}/t/${token}`;
  return language === 'lv' ? url : `${url}?lang=${language}`;
}

/**
 * First word only ("Jānis", never "Jānis Bērziņš") — the SMS and the page
 * identify the driver, they do not dox them. `—` when onboarding (#20) has
 * not set a name yet.
 */
export function driverFirstName(displayName: string | null): string {
  const first = displayName?.trim().split(/\s+/)[0];
  return first ? first : '—';
}
