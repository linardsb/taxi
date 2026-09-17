import appJson from '../app.json';
import easJson from '../eas.json';

/**
 * #220 — the condition `app.json` cannot state itself.
 *
 * `apps/driver/app.json` turns on `android.usesCleartextTraffic` through
 * `expo-build-properties`. That entry is load-bearing for #141: `expo prebuild`
 * writes no `release/AndroidManifest.xml`, so a release-variant APK inherits
 * `main/`, where the attribute is absent and Android's API-28+ default blocks
 * `http://` — and `features/location/socket.ts` dials `transports:
 * ['websocket']` with no polling fallback, so the failure looks exactly like
 * #141 unfixed.
 *
 * But `app.json` is one static config with no per-profile mechanism, so the flag
 * reaches every Android build it will ever produce, while the decision behind it
 * is narrower — `.claude/plans/driver-device-day-prep.md`, Q2: *"One cleartext
 * setting on an internal-distribution APK is a smaller price than a rebuild per
 * session."* JSON takes no comment, so the condition lives here instead: the day
 * a profile appears that is not internal-distribution, this fails rather than
 * shipping OTP codes and JWTs in the clear — the standard
 * `docs/epics/sakta-cab.architecture.md` set in its TLS/DDoS row, where plain
 * HTTP to the origin was rejected for #13 for exactly that reason.
 *
 * The check is on `distribution` rather than on profile names, because
 * `distribution` is the condition the plan's sentence actually rests on, and EAS
 * applies its `store` default to any profile that omits it. Resolving it follows
 * both routes EAS itself follows — the `extends` chain *and* the platform-specific
 * `android` block, which outranks the profile root. See `resolveDistribution`.
 */

interface BuildProfile {
  distribution?: string;
  extends?: string;
  /** EAS lets the platform block carry its own `distribution`, and it wins. */
  android?: { distribution?: string };
}

interface EasConfig {
  build?: Record<string, BuildProfile>;
}

type PluginEntry = string | [string, Record<string, unknown>?];

interface AppConfig {
  expo?: { plugins?: PluginEntry[] };
}

/** True when this `app.json` enables Android cleartext for every build it produces. */
const cleartextEnabled = (app: AppConfig): boolean =>
  (app.expo?.plugins ?? []).some(
    (entry) =>
      Array.isArray(entry) &&
      entry[0] === 'expo-build-properties' &&
      (entry[1] as { android?: { usesCleartextTraffic?: boolean } } | undefined)
        ?.android?.usesCleartextTraffic === true,
  );

/**
 * A profile's `extends` chain, child first. Stops on a cycle or a dangling
 * parent name — EAS rejects both outright (`resolveProfile` throws at depth ≥ 5
 * and on a missing parent), so this only has to fail safe on a hand-edited file
 * rather than reproduce an error path, and the cycle arm also keeps a loop from
 * blowing the stack mid-gate.
 */
const extendsChain = (
  build: Record<string, BuildProfile>,
  name: string,
): BuildProfile[] => {
  const chain: BuildProfile[] = [];
  const seen = new Set<string>();
  let current: string | undefined = name;
  while (current && !seen.has(current)) {
    const profile: BuildProfile | undefined = build[current];
    if (!profile) break;
    seen.add(current);
    chain.push(profile);
    current = profile.extends;
  }
  return chain;
};

/**
 * A profile's effective Android `distribution`. `undefined` means nothing in the
 * chain declared one — EAS then applies its `store` default — and a cyclic or
 * dangling chain lands here too; all of those are "not internal".
 *
 * Two stages, in EAS's own order (`@expo/eas-json@24.5.0`,
 * `build/build/resolver.js`): the `extends` chain merges child-over-parent
 * (`:37`), with `android` deep-merged key-by-key when both sides carry one
 * (`:54-56`), and only *then* does the platform block beat the profile root
 * (`:11-12`). So an `android.distribution` anywhere in the chain outranks a root
 * `distribution` anywhere in it. Preferring `android` per level instead would let
 * a child's root value beat a parent's `android` one, which EAS does not.
 *
 * Only `android` is read: cleartext is an Android manifest attribute, so
 * `ios.distribution` carries no risk here and flagging it would over-constrain a
 * file the plan wants left alone.
 */
const resolveDistribution = (
  build: Record<string, BuildProfile>,
  name: string,
): string | undefined => {
  const chain = extendsChain(build, name);
  return (
    chain.find((profile) => profile.android?.distribution)?.android
      ?.distribution ??
    chain.find((profile) => profile.distribution)?.distribution
  );
};

/** Every profile whose effective distribution is anything but `internal`. */
const nonInternalProfiles = (eas: EasConfig): string[] => {
  const build = eas.build ?? {};
  return Object.keys(build).filter(
    (name) => resolveDistribution(build, name) !== 'internal',
  );
};

describe('android cleartext stays bound to internal distribution (#220)', () => {
  const app = appJson as unknown as AppConfig;
  const eas = easJson as EasConfig;

  it('app.json still enables cleartext for every android build (expected)', () => {
    // The premise the next case rests on. If this goes false, read the
    // *effective* config before retiring anything — confirm the flag is gone,
    // not merely moved somewhere this static `app.json` read cannot see (an
    // `app.config.ts`, a `withAndroidManifest` plugin, an ejected `android/`
    // tree). A flag that moved is not licence to relax the profile check.
    expect(cleartextEnabled(app)).toBe(true);
  });

  it('every eas.json build profile is internal-distribution (expected)', () => {
    const build = eas.build ?? {};
    const offenders = nonInternalProfiles(eas).map((name) => ({
      profile: name,
      distribution: resolveDistribution(build, name) ?? 'store (EAS default)',
      fix: 'app.json enables cleartext app-wide: this profile must be internal, or the flag must be scoped (#220)',
    }));
    expect(offenders).toEqual([]);
  });

  it('a plugin entry that turns cleartext off is not read as enabled (failure)', () => {
    const entry: PluginEntry = [
      'expo-build-properties',
      { android: { usesCleartextTraffic: false } },
    ];
    expect(
      cleartextEnabled({ expo: { plugins: ['expo-router', entry] } }),
    ).toBe(false);
  });

  it('a profile inherits internal distribution through extends (edge)', () => {
    expect(
      nonInternalProfiles({
        build: {
          preview: { distribution: 'internal' },
          'preview-ru': { extends: 'preview' },
        },
      }),
    ).toEqual([]);
  });

  it('a cyclic extends chain resolves to not-internal instead of recursing (edge)', () => {
    expect(
      nonInternalProfiles({
        build: { a: { extends: 'b' }, b: { extends: 'a' } },
      }),
    ).toEqual(['a', 'b']);
  });

  it('a profile that omits distribution is caught — EAS defaults it to store (failure)', () => {
    expect(
      nonInternalProfiles({
        build: { preview: { distribution: 'internal' }, production: {} },
      }),
    ).toEqual(['production']);
  });

  it('a store profile is caught even when it extends an internal one (failure)', () => {
    expect(
      nonInternalProfiles({
        build: {
          preview: { distribution: 'internal' },
          production: { extends: 'preview', distribution: 'store' },
        },
      }),
    ).toEqual(['production']);
  });

  it('an android-scoped store distribution is caught on the profile itself (failure)', () => {
    expect(
      nonInternalProfiles({
        build: {
          preview: {
            distribution: 'internal',
            android: { distribution: 'store' },
          },
        },
      }),
    ).toEqual(['preview']);
  });

  it('an inherited android store distribution beats a nearer root internal (failure)', () => {
    expect(
      nonInternalProfiles({
        build: {
          base: { android: { distribution: 'store' } },
          preview: { extends: 'base', distribution: 'internal' },
        },
      }),
    ).toEqual(['base', 'preview']);
  });

  it('an android-only internal distribution is not flagged (edge)', () => {
    expect(
      nonInternalProfiles({
        build: { preview: { android: { distribution: 'internal' } } },
      }),
    ).toEqual([]);
  });

  // The mirror of the two cases above: the fix must not over-flag either. A
  // per-level `android ?? root` shortcut returns `store` here and reds the gate
  // on a profile EAS resolves to `internal`.
  it('an inherited android internal beats a nearer root store (edge)', () => {
    expect(
      nonInternalProfiles({
        build: {
          base: { android: { distribution: 'internal' } },
          preview: { extends: 'base', distribution: 'store' },
        },
      }),
    ).toEqual([]);
  });
});
