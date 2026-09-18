import { satisfies } from 'semver';

/**
 * #225 — the peer-range violation no other check can see.
 *
 * `expo-router` pulls `@react-navigation/drawer`, whose
 * `react-native-drawer-layout@4.2.10` declares `react-native-reanimated:
 * ">= 2.0.0"` as a *required* peer. pnpm's auto-install-peers resolved that to
 * the newest release, 4.6.0, whose own peer is `react-native-worklets: 0.12.x`
 * — while `expo-modules-core@57.0.14` declares
 * `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` and its C++ compiles against ≤ 0.10.
 * The Android build died in `expo-modules-core`'s CMake with `no member named
 * 'executeSync' in 'worklets::WorkletRuntime'` (`observed` 2026-09-18, EAS build
 * `a47b0b19-e9d1-4c44-b2ea-e473246fb50c`).
 *
 * Nothing fired. pnpm warns on an unmet peer and installs anyway; `expo install
 * --check` only inspects packages an app *declares*, and neither of these is
 * declared anywhere in the workspace; and the gate compiles no Android C++, so
 * `pnpm turbo run typecheck lint test build --force` was green on the broken
 * tree. The fix is a pair of root `pnpm.overrides` pins, and a pin is exactly
 * the kind of claim that goes stale silently — so the condition lives here.
 *
 * Three assertions over a precondition that both pins exist, each with its
 * own failure meaning:
 *
 * 1. Each pin equals Expo SDK 57's own `bundledNativeModules.json` entry — the
 *    set of versions Expo tested together. Bumping `expo` past a version that
 *    moves either entry reds this deliberately: the pin tracks the SDK rather
 *    than freezing at today's digits, and the review is one line of work.
 * 2. The version actually installed equals its pin, so the override is checked
 *    as a mechanism and not merely as a line of JSON.
 * 3. Every *installed* version satisfies every peer range declared against it
 *    anywhere in the tree. This is the invariant #225 broke. It reads installed
 *    versions rather than the pins so that it stays the real check if the pins
 *    are ever removed or replaced by direct dependencies; and it reads ranges
 *    from the published manifests rather than from `pnpm-lock.yaml`, because
 *    pnpm rewrites the lock's recorded peer ranges to match an override — after
 *    the fix the lock says `react-native-worklets: 0.10.1` where
 *    `expo-modules-core` really declares the four-clause range above, so a
 *    lock-sourced check would be vacuous.
 *
 * Consumers are discovered rather than listed. #225 happened because nobody was
 * looking at a package no file named; enumerating three known names here would
 * rebuild that blind spot for the fourth. The walk assumes the hoisted layout
 * `.npmrc` mandates ("Expo requires hoisted node_modules in pnpm monorepos"), so
 * every third-party package sits in the repo-root `node_modules`.
 *
 * It lives in `apps/driver` because that is the app with an `eas.json` and the
 * surface that breaks first, next to #220's `build-config.test.ts`. The pins
 * themselves are workspace-wide and `apps/rider` depends on them equally.
 */

/**
 * `apps/driver`'s tsconfig sets `types: ["jest"]` on purpose — app code has no
 * business reaching for Node APIs, and widening that array for one test file
 * would drop the constraint for every other. So the two `node:fs` functions this
 * file needs come through `jest.requireActual` under narrow local types, and
 * `__dirname` is declared module-locally rather than pulled in as a global.
 */
declare const __dirname: string;

const { readFileSync, readdirSync } = jest.requireActual('node:fs') as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string) => string[];
};

/** Repo root, three levels up from `apps/driver/src`. */
const repoRoot = [__dirname, '..', '..', '..'].join('/');

const readJson = <T>(...segments: string[]): T =>
  JSON.parse(readFileSync([repoRoot, ...segments].join('/'), 'utf8')) as T;

interface PackageManifest {
  version?: string;
  peerDependencies?: Record<string, string>;
}

interface RootManifest {
  pnpm?: { overrides?: Record<string, string> };
}

/** The packages this file pins, and whose peer ranges it therefore checks. */
const PINNED = ['react-native-reanimated', 'react-native-worklets'] as const;

/** Peer ranges declared against `PINNED` packages, keyed by the package declaring them. */
type PeerRangesByPackage = Record<string, Record<string, string>>;

interface PeerViolation {
  consumer: string;
  dependency: string;
  range: string;
  installed: string;
}

/**
 * Every directory in the root `node_modules` that holds a manifest, scoped
 * packages included. `.bin`, `.pnpm` and any other dot-entry are pnpm's own
 * bookkeeping, not packages.
 */
const installedPackageDirs = (): string[] => {
  const root = `${repoRoot}/node_modules`;
  return readdirSync(root)
    .filter((entry) => !entry.startsWith('.'))
    .flatMap((entry) =>
      entry.startsWith('@')
        ? readdirSync(`${root}/${entry}`).map((scoped) => `${entry}/${scoped}`)
        : [entry],
    );
};

/**
 * Peer ranges declared on any `PINNED` package across the installed tree.
 * A directory with no readable manifest is skipped: pnpm leaves stray entries
 * (a partially removed package, a bare scope dir), and a missing file there is
 * not a peer-range statement either way.
 */
const declaredPeerRanges = (): PeerRangesByPackage => {
  const found: PeerRangesByPackage = {};
  for (const dir of installedPackageDirs()) {
    let manifest: PackageManifest;
    try {
      manifest = readJson<PackageManifest>('node_modules', dir, 'package.json');
    } catch {
      continue;
    }
    const peers = manifest.peerDependencies ?? {};
    const relevant = Object.fromEntries(
      PINNED.filter((name) => peers[name] !== undefined).map((name) => [
        name,
        peers[name],
      ]),
    );
    if (Object.keys(relevant).length > 0) found[dir] = relevant;
  }
  return found;
};

/** The version of each `PINNED` package present in the root `node_modules`. */
const installedVersions = (): Record<string, string> =>
  Object.fromEntries(
    PINNED.map((name) => [
      name,
      readJson<PackageManifest>('node_modules', name, 'package.json').version,
    ]),
  ) as Record<string, string>;

/**
 * Every declared range the installed versions do not satisfy. Optionality is
 * not consulted on purpose: `peerDependenciesMeta.optional` governs whether
 * pnpm must *install* the package, not whether the version present is one the
 * consumer compiles against — `expo-modules-core` marks `react-native-worklets`
 * optional and still builds C++ against it, which is #225 in one sentence.
 */
const peerViolations = (
  versions: Record<string, string>,
  peerRanges: PeerRangesByPackage,
): PeerViolation[] =>
  Object.entries(peerRanges)
    .flatMap(([consumer, peers]) =>
      Object.entries(peers)
        .filter(([dependency]) => versions[dependency] !== undefined)
        .filter(
          ([dependency, range]) => !satisfies(versions[dependency], range),
        )
        .map(([dependency, range]) => ({
          consumer,
          dependency,
          range,
          installed: versions[dependency],
        })),
    )
    .sort((a, b) =>
      `${a.consumer}/${a.dependency}`.localeCompare(
        `${b.consumer}/${b.dependency}`,
      ),
    );

/** `PINNED` packages with no entry in root `pnpm.overrides`. */
const missingPins = (overrides: Record<string, string>): string[] =>
  PINNED.filter((name) => overrides[name] === undefined);

describe('native module pins track Expo SDK 57 and satisfy every peer (#225)', () => {
  const overrides =
    readJson<RootManifest>('package.json').pnpm?.overrides ?? {};
  const bundled = readJson<Record<string, string>>(
    'node_modules',
    'expo',
    'bundledNativeModules.json',
  );

  it('both packages are pinned in root pnpm.overrides (expected)', () => {
    expect(missingPins(overrides)).toEqual([]);
  });

  it("each pin equals Expo SDK 57's bundled version (expected)", () => {
    expect(
      Object.fromEntries(PINNED.map((name) => [name, overrides[name]])),
    ).toEqual(Object.fromEntries(PINNED.map((name) => [name, bundled[name]])));
  });

  it('the installed tree carries the pinned versions (expected)', () => {
    expect(installedVersions()).toEqual(
      Object.fromEntries(PINNED.map((name) => [name, overrides[name]])),
    );
  });

  it('no installed package declares a peer range the tree violates (expected)', () => {
    expect(peerViolations(installedVersions(), declaredPeerRanges())).toEqual(
      [],
    );
  });

  it("the tree #225 shipped is reported against expo-modules-core's real range (failure)", () => {
    // Not a synthetic range: read from the installed manifest, so this case
    // follows expo-modules-core rather than restating a range that can move.
    const range = readJson<PackageManifest>(
      'node_modules',
      'expo-modules-core',
      'package.json',
    ).peerDependencies?.['react-native-worklets'];
    expect(range).toBeDefined();
    expect(
      peerViolations(
        { 'react-native-worklets': '0.12.1' },
        { 'expo-modules-core': { 'react-native-worklets': range as string } },
      ),
    ).toEqual([
      {
        consumer: 'expo-modules-core',
        dependency: 'react-native-worklets',
        range,
        installed: '0.12.1',
      },
    ]);
  });

  it('a version outside one consumer of two is reported once (failure)', () => {
    expect(
      peerViolations(
        { 'react-native-reanimated': '4.5.1' },
        {
          'react-native-drawer-layout': {
            'react-native-reanimated': '>= 2.0.0',
          },
          'some-future-package': { 'react-native-reanimated': '^5.0.0' },
        },
      ),
    ).toEqual([
      {
        consumer: 'some-future-package',
        dependency: 'react-native-reanimated',
        range: '^5.0.0',
        installed: '4.5.1',
      },
    ]);
  });

  it('a peer on a package this file does not track is left to pnpm (edge)', () => {
    expect(
      peerViolations(
        { 'react-native-worklets': '0.10.1' },
        { '@expo/ui': { 'react-native-gesture-handler': '^99.0.0' } },
      ),
    ).toEqual([]);
  });

  it("a '*' range is satisfied by any version (edge)", () => {
    expect(
      peerViolations(
        { 'react-native-worklets': '0.10.1' },
        { '@expo/ui': { 'react-native-worklets': '*' } },
      ),
    ).toEqual([]);
  });

  it('a dropped override is named rather than silently skipped (failure)', () => {
    expect(missingPins({ 'react-native-reanimated': '4.5.1' })).toEqual([
      'react-native-worklets',
    ]);
  });
});
