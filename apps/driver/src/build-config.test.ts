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
 * applies its `store` default to any profile that omits it.
 */

interface BuildProfile {
  distribution?: string;
  extends?: string;
}

interface EasConfig {
  build?: Record<string, BuildProfile>;
}

type PluginEntry = string | [string, Record<string, unknown>?];

interface AppConfig {
  expo?: { plugins?: PluginEntry[] };
}

/** True when the config enables Android cleartext for every build it produces. */
const cleartextEnabled = (app: AppConfig): boolean =>
  (app.expo?.plugins ?? []).some(
    (entry) =>
      Array.isArray(entry) &&
      entry[0] === 'expo-build-properties' &&
      (entry[1] as { android?: { usesCleartextTraffic?: boolean } } | undefined)
        ?.android?.usesCleartextTraffic === true,
  );

/**
 * A profile's effective `distribution`, following `extends`. `undefined` means
 * no ancestor declared one (EAS then applies `store`) or the chain is cyclic —
 * both are "not internal", and the cycle arm also keeps a hand-edited loop from
 * blowing the stack mid-gate.
 */
const resolveDistribution = (
  build: Record<string, BuildProfile>,
  name: string,
  seen: Set<string> = new Set(),
): string | undefined => {
  const profile = build[name];
  if (!profile || seen.has(name)) return undefined;
  if (profile.distribution) return profile.distribution;
  seen.add(name);
  return profile.extends
    ? resolveDistribution(build, profile.extends, seen)
    : undefined;
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
  const eas = easJson as unknown as EasConfig;

  it('app.json still enables cleartext for every android build (expected)', () => {
    // The premise the next case rests on. If this goes false the flag is gone
    // and this whole file should go with it — it is not licence to relax the
    // profile check.
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
});
