import {
  getResolvedLocalesAsync,
  type ExpoConfigLocales,
} from '@expo/config-plugins/build/utils/locales';

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
 * default** `values/strings.xml` entry for any of them. (`android/Locales.js:66` writes only
 * to `values-b+${lang}/`, which is the load-bearing half; that this app's default file then
 * held nothing but `app_name` is `observed` 2026-09-18 on the prebuild recorded at
 * `.claude/reports/emulator-gates-224-report.md:35-38`, and stops being true the day a
 * splash, `google-services.json` or RTL option adds a default string. The mechanism does not
 * depend on it.)
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
 * **`@expo/config-plugins` is deliberately not in this app's `package.json`.** It is a
 * transitive of `expo`, reachable only because `.npmrc` sets `node-linker=hoisted` ("Expo
 * requires hoisted node_modules in pnpm monorepos") — which is exactly what makes the guard
 * worth having, because it resolves the *same* copy `expo prebuild` loads
 * (`node_modules/@expo/config-plugins@57.0.9` from both this app and
 * `@expo/prebuild-config`, `observed` via `require.resolve` from each). Declaring a version
 * here would be free to drift from the one prebuild uses, and the test would then pass while
 * the build failed — the precise failure mode it was written against. The deep
 * `/build/utils/locales` path is outside the package's `exports` contract and so outside its
 * semver promise: that is the accepted cost of testing the real resolver rather than a copy
 * of its logic, and a breaking move shows up here as a red import, not a silent pass.
 *
 * The locale files are passed as objects rather than as paths. `ExpoConfigLocales` is
 * `@expo/config-types`' `{ [k: string]: string | { [k: string]: any } }`, so the inline-object
 * form is typed public API, not a trick — and that package's own doc comment is the contract
 * this file tests: *"Platform-specific locale strings should be nested under `ios` and
 * `android` keys."* Passing objects also keeps the test free of any dependency on the working
 * directory a runner happens to use.
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
 * The keys these locale files localize. Asserted as a literal rather than read from
 * `expo.ios.infoPlist`, which also declares `UIBackgroundModes` and
 * `LSApplicationQueriesSchemes` — those are not localizable strings and must not be here.
 */
const LOCALIZED_IOS_KEYS = [
  'NSLocationAlwaysAndWhenInUseUsageDescription',
  'NSLocationWhenInUseUsageDescription',
] as const;

/** `getResolvedLocalesAsync` takes paths OR inline objects; the inline form needs no root. */
const resolve = (platform: 'ios' | 'android') =>
  getResolvedLocalesAsync('.', locales, platform);

describe('expo.locales platform scoping (#232)', () => {
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

    // Naming the keys, not just counting them: scoping under `ios` must not be confused with
    // deleting or renaming them. An empty resolution is worse than it looks — iOS
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
