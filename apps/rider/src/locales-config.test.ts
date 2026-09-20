import {
  getResolvedLocalesAsync,
  type ExpoConfigLocales,
} from '@expo/config-plugins/build/utils/locales';

import appJson from '../app.json';
import enLocale from '../locales/en.json';
import lvLocale from '../locales/lv.json';
import ruLocale from '../locales/ru.json';

/**
 * #232 in the rider app — the same condition `locales/*.json` cannot state itself.
 *
 * This app carried the identical defect the driver app's `locales-config.test.ts` was written
 * against, and carried it unnoticed because `apps/rider` has no `eas.json` and so has never
 * been through a release-variant Android build. `observed` on PR #233's reviewed head
 * (`a25fa49`): all three files declared `NSLocationWhenInUseUsageDescription` at the **top
 * level**, and `app.json` declared the matching `expo.locales` map — 1 key × 3 locales, which
 * is 3 fatal `ExtraTranslation` errors waiting for the first `:app:lintVitalRelease`, for
 * exactly the reason the driver's 2 keys × 3 locales produced 6.
 *
 * The mechanism, in short: `expo.locales` is an **iOS** map, supplying the localized
 * `NSLocation*UsageDescription` strings for each `<lang>.lproj/InfoPlist.strings`. Android's
 * `withLocales` mod does not know that — it writes every key of every locale file into
 * `values-b+<lang>/strings.xml` and writes no default `values/strings.xml` entry, which
 * Android Lint reads as `ExtraTranslation`, fatal in the vital set. `getResolvedLocalesAsync`
 * scopes by platform: top-level keys are shared, `ios` / `android` sub-objects are merged in
 * for that platform only. The full derivation, with the library line numbers, is in
 * `apps/driver/src/locales-config.test.ts`; it is not repeated here.
 *
 * The invariant is the same and is deliberately stronger than the defect: **no key may
 * resolve for Android.** Expo's `locales` mechanism cannot write the default entry an Android
 * string would need, so an Android-facing string here is always an `ExtraTranslation` waiting
 * to happen. The day one is wanted it needs a different mechanism — and this failing is the
 * prompt to pick one.
 *
 * Two notes carried over deliberately, because they are properties of the approach rather
 * than of the driver app: `@expo/config-plugins` is **not** declared in this app's
 * `package.json`, so the guard resolves the same hoisted copy `expo prebuild` loads (a
 * declared version would be free to drift from it, and the test would then pass while the
 * build failed); and the locale files are passed as objects, which `ExpoConfigLocales`
 * (`{ [k: string]: string | { [k: string]: any } }`) types as public API.
 */

/** `app.json` is typed loosely here — only the locales map and the iOS Info.plist are under test. */
const expoConfig = (
  appJson as {
    expo?: {
      locales?: Record<string, string>;
      ios?: { infoPlist?: Record<string, unknown> };
    };
  }
).expo;

const localeMap = expoConfig?.locales;

/** Same three files `app.json` points at — the paths are asserted below, not assumed. */
const locales = { lv: lvLocale, ru: ruLocale, en: enLocale };

/**
 * The keys these locale files localize. A literal, not a read of `expo.ios.infoPlist`: the
 * two are different sets by design, and asserting one against the other would pass
 * vacuously the day a non-localizable key joins the Info.plist.
 */
const LOCALIZED_IOS_KEYS = ['NSLocationWhenInUseUsageDescription'] as const;

/** `getResolvedLocalesAsync` takes paths OR inline objects; the inline form needs no root. */
const resolve = (platform: 'ios' | 'android') =>
  getResolvedLocalesAsync('.', locales, platform);

describe('expo.locales platform scoping, rider (#232)', () => {
  it('covers every locale app.json declares, at the paths it declares (expected)', () => {
    expect(localeMap).toEqual({
      lv: './locales/lv.json',
      ru: './locales/ru.json',
      en: './locales/en.json',
    });
    expect(Object.keys(localeMap ?? {}).sort()).toEqual(
      Object.keys(locales).sort(),
    );
  });

  it('resolves no Android string, so lintVitalRelease sees no ExtraTranslation (expected)', async () => {
    const { localesMap } = await resolve('android');

    for (const [lang, strings] of Object.entries(localesMap)) {
      expect({ lang, keys: Object.keys(strings) }).toEqual({ lang, keys: [] });
    }
  });

  it('still resolves exactly the declared iOS keys for every locale (edge)', async () => {
    const { localesMap } = await resolve('ios');

    const langs = Object.keys(localesMap);
    expect(langs.sort()).toEqual(Object.keys(locales).sort());

    // Naming the key, not just counting: scoping under `ios` must not be confused with
    // deleting or renaming it. An empty resolution is worse than it looks — iOS
    // `Locales.js:62` does `return`, not `continue`, so one empty locale stops
    // `InfoPlist.strings` being written for every locale after it in iteration order.
    for (const lang of langs) {
      expect({ lang, keys: Object.keys(localesMap[lang]).sort() }).toEqual({
        lang,
        keys: [...LOCALIZED_IOS_KEYS],
      });
    }
  });

  it('localizes only keys app.json also declares in ios.infoPlist (edge)', () => {
    // A localized `InfoPlist.strings` key does nothing unless the matching `Info.plist` key
    // exists, so the two files have to move together.
    const declared = Object.keys(expoConfig?.ios?.infoPlist ?? {});
    for (const key of LOCALIZED_IOS_KEYS) {
      expect({ key, declared: declared.includes(key) }).toEqual({
        key,
        declared: true,
      });
    }
  });

  it('fails when a key is left unscoped — the defect, reproduced (failure)', async () => {
    const unscoped: ExpoConfigLocales = {
      xx: { Unscoped: 'reaches Android', ios: { Scoped: 'does not' } },
    };
    const { localesMap } = await getResolvedLocalesAsync(
      '.',
      unscoped,
      'android',
    );

    expect(Object.keys(localesMap.xx)).toEqual(['Unscoped']);
  });
});
