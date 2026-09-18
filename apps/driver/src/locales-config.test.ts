import { getResolvedLocalesAsync } from '@expo/config-plugins/build/utils/locales';

import appJson from '../app.json';
import enLocale from '../locales/en.json';
import lvLocale from '../locales/lv.json';
import ruLocale from '../locales/ru.json';

/**
 * #232 — the condition `locales/*.json` cannot state itself.
 *
 * `app.json`'s `expo.locales` map exists for **iOS**: it supplies the localized
 * `NSLocation*UsageDescription` strings that go into each `<lang>.lproj/InfoPlist.strings`.
 * Android has no use for them — but `@expo/config-plugins`' Android `withLocales` mod does
 * not know that. It writes *every* key of every locale file into
 * `android/app/src/main/res/values-b+<lang>/strings.xml`
 * (`@expo/config-plugins/build/android/Locales.js`, `setLocalesAsync`) and writes **no
 * default** `values/strings.xml` entry for any of them — the default file carries only
 * `app_name`.
 *
 * Android Lint reads a string that exists in a translation and in no default as
 * `ExtraTranslation`, which is **fatal** in `:app:lintVitalRelease`. That task runs on every
 * release-variant build, so two unscoped keys across three locales failed the whole EAS
 * build with 6 errors (`observed` 2026-09-18, build `edcc579b-122a-47fc-9ffc-cc9c25266053`)
 * — after 1182 s and one build credit, with nothing in the repo able to catch it: the gate
 * compiles no Android resources, and `expo install --check` inspects dependency versions.
 *
 * The fix is `getResolvedLocalesAsync`'s platform scoping
 * (`@expo/config-plugins/build/utils/locales.js`): a locale file's top-level keys are shared,
 * and its `ios` / `android` sub-objects are merged in for that platform only. Keys under
 * `ios` therefore reach `InfoPlist.strings` and never reach Android.
 *
 * So the invariant is: **no key may resolve for Android**. That reads stronger than the
 * defect, and deliberately — Expo's `locales` mechanism has no way to write the default entry
 * an Android string would need, so an Android-facing string here is always an
 * `ExtraTranslation` waiting to happen. The day one is genuinely wanted, it needs a different
 * mechanism (a default `values/strings.xml` through `withStringsXml`, or
 * `expo-localization`'s own catalogs, where every user-facing string in this app already
 * lives) — and this test failing is the prompt to pick one.
 *
 * The locale files are passed as objects rather than as paths. `getLocales` returns a
 * non-string entry as-is, so the resolution under test is identical, and the test carries no
 * dependency on the working directory a runner happens to use.
 */

/** `app.json` is typed loosely here — only the locales map is under test. */
const localeMap = (appJson as { expo?: { locales?: Record<string, string> } })
  .expo?.locales;

/** Same three files `app.json` points at, imported so no path resolution is involved. */
const locales = { lv: lvLocale, ru: ruLocale, en: enLocale };

/** `getResolvedLocalesAsync` takes paths OR inline objects; the inline form needs no root. */
const resolve = (platform: 'ios' | 'android') =>
  getResolvedLocalesAsync(
    '.',
    locales as unknown as Record<string, string>,
    platform,
  );

describe('expo.locales platform scoping (#232)', () => {
  it('covers every locale app.json declares — the precondition the rest reads', () => {
    expect(Object.keys(localeMap ?? {}).sort()).toEqual(
      Object.keys(locales).sort(),
    );
  });

  it('resolves no Android string, so lintVitalRelease sees no ExtraTranslation', async () => {
    const { localesMap } = await resolve('android');

    for (const [lang, strings] of Object.entries(localesMap)) {
      expect({ lang, keys: Object.keys(strings) }).toEqual({ lang, keys: [] });
    }
  });

  it('still resolves the same iOS keys for every locale — the scoping kept them', async () => {
    const { localesMap } = await resolve('ios');

    const langs = Object.keys(localesMap);
    expect(langs.sort()).toEqual(Object.keys(locales).sort());

    // Every locale translates the same key set, and it is not empty: scoping the keys under
    // `ios` must not be confused with deleting them.
    const keySets = langs.map((lang) => Object.keys(localesMap[lang]).sort());
    expect(keySets[0].length).toBeGreaterThan(0);
    for (const keys of keySets) {
      expect(keys).toEqual(keySets[0]);
    }
  });

  it('fails when a key is left unscoped — the defect, reproduced', async () => {
    const { localesMap } = await getResolvedLocalesAsync(
      '.',
      {
        xx: { Unscoped: 'reaches Android', ios: { Scoped: 'does not' } },
      } as unknown as Record<string, string>,
      'android',
    );

    expect(Object.keys(localesMap.xx)).toEqual(['Unscoped']);
  });
});
