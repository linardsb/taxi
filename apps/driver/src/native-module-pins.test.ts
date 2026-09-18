import { Range, satisfies } from 'semver';

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
 * 1. Each pin equals the installed Expo SDK's own `bundledNativeModules.json`
 *    entry — the set of versions Expo tested together. Bumping `expo` past a
 *    version that moves either entry reds this deliberately: the pin tracks the
 *    SDK rather than freezing at today's digits, and the review is one line of
 *    work. The comparison is strict equality, which assumes Expo writes an
 *    exact version for these two. It does today, but that is not the file's
 *    habit: 22 of its 123 entries start with a digit and the other 101 are
 *    ranges (`~57.0.16`, `^15.0.2`, …) — `observed` 2026-09-18 at
 *    `expo@57.0.18`. Expo writing `~4.5.1` for the same effective version would
 *    red this on a non-regression; that is a one-line review, not a hole.
 * 2. The version actually installed equals its pin, so the override is checked
 *    as a mechanism and not merely as a line of JSON.
 * 3. Every *installed* version satisfies every peer range declared against it
 *    in the repo-root `node_modules`. This is the invariant #225 broke. It
 *    reads installed versions rather than the pins so that a pin replaced by a
 *    direct dependency is still checked; and it reads ranges from the published
 *    manifests rather than from `pnpm-lock.yaml`, because pnpm rewrites the
 *    lock's recorded peer ranges to match an override — after the fix the lock
 *    says `react-native-worklets: 0.10.1` where `expo-modules-core` really
 *    declares the four-clause range above, so a lock-sourced check would be
 *    vacuous.
 *
 * Assertion 3 is an `expect(…).toEqual([])`, and an empty result is ambiguous
 * on its own, so two structural guards sit under it: one asserts the walk found
 * `expo-modules-core` at all, so "no violations" cannot be "the walk saw
 * nothing"; the other names any peer range semver cannot parse, because
 * `satisfies` swallows an invalid range and returns `false`, which would
 * otherwise surface a `workspace:` or `patch:` spec as a version conflict it is
 * not.
 *
 * Consumers are discovered rather than listed. #225 happened because nobody was
 * looking at a package no file named; enumerating three known names here would
 * rebuild that blind spot for the fourth. The walk reads the repo-root
 * `node_modules` one level deep, scoped packages included, and does not
 * descend. It rests on the hoisted layout `.npmrc` mandates ("Expo requires
 * hoisted node_modules in pnpm monorepos"), under which every third-party
 * package sits at the root — `observed` 2026-09-18: `node_modules/.pnpm` holds
 * exactly one entry, `lock.yaml`, so there are no store directories for a
 * second copy to hide in. What that leaves uncovered, stated rather than
 * implied: a *consumer* nested under another package's `node_modules` would be
 * missed, as would `spikes/gps-harness/node_modules`, which sits outside
 * `pnpm-workspace.yaml` and nothing EAS builds reads. A nested *copy* of either
 * pinned package cannot exist while the overrides collapse each to one version.
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

/** One peer range declared by one package against one of `PINNED`. */
interface DeclaredRange {
  consumer: string;
  dependency: string;
  range: string;
}

interface PeerViolation extends DeclaredRange {
  installed: string;
}

/**
 * Directory entries that are not pnpm's own bookkeeping. `.bin`, `.pnpm` and
 * any other dot-entry are skipped, and an unreadable path yields nothing rather
 * than throwing: a scope that is a file, or a directory removed mid-run, would
 * otherwise red the whole gate on something that is not a peer-range statement.
 * Neither case is present in this tree (`observed` 2026-09-18: no non-directory
 * `node_modules/@*` entry, no dot-entry inside a scope) — this is the safe
 * default, not a fix for a live failure.
 */
const packageEntries = (path: string): string[] => {
  try {
    return readdirSync(path).filter((entry) => !entry.startsWith('.'));
  } catch {
    return [];
  }
};

/**
 * Every directory in the root `node_modules` that may hold a manifest, scoped
 * packages included.
 */
const installedPackageDirs = (): string[] => {
  const root = `${repoRoot}/node_modules`;
  return packageEntries(root).flatMap((entry) =>
    entry.startsWith('@')
      ? packageEntries(`${root}/${entry}`).map((scoped) => `${entry}/${scoped}`)
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

/**
 * The version of each `PINNED` package present in the root `node_modules`.
 * `PackageManifest.version` is optional, so this is `string | undefined` and
 * says so: casting the absence away would let `peerViolations` drop every range
 * declared on that package and pass vacuously.
 */
const installedVersions = (): Record<string, string | undefined> =>
  Object.fromEntries(
    PINNED.map((name) => [
      name,
      readJson<PackageManifest>('node_modules', name, 'package.json').version,
    ]),
  );

/** Stable ordering, so either report can be compared against a literal. */
const byConsumer = (a: DeclaredRange, b: DeclaredRange): number =>
  `${a.consumer}/${a.dependency}`.localeCompare(
    `${b.consumer}/${b.dependency}`,
  );

/** Whether semver can read this range at all. */
const isSemverRange = (range: string): boolean => {
  try {
    new Range(range);
    return true;
  } catch {
    return false;
  }
};

/**
 * Declared ranges semver cannot parse. pnpm's `workspace:`, `catalog:`, `npm:`
 * alias and `patch:` specs all throw in `Range` (`observed` 2026-09-18), and
 * `satisfies` catches that internally and returns `false` — so leaving them to
 * `peerViolations` would red the gate naming a version conflict that does not
 * exist. They get their own name here rather than being skipped: a range
 * nothing can read is a fact about the tree, not a clean result.
 *
 * Not hypothetical. `react-native-gesture-handler@3.2.1` already declares
 * `react-native-worklets` as
 * `patch:react-native-worklets@npm%3A0.12.0-nightly-…` — in `devDependencies`,
 * which this walk does not read (`observed` 2026-09-18). One published package
 * moving a spec of that shape into `peerDependencies` is all it takes.
 */
const unparseableRanges = (peerRanges: PeerRangesByPackage): DeclaredRange[] =>
  Object.entries(peerRanges)
    .flatMap(([consumer, peers]) =>
      Object.entries(peers)
        .filter(([, range]) => !isSemverRange(range))
        .map(([dependency, range]) => ({ consumer, dependency, range })),
    )
    .sort(byConsumer);

/**
 * Every declared range the installed versions do not satisfy. Optionality is
 * not consulted on purpose: `peerDependenciesMeta.optional` governs whether
 * pnpm must *install* the package, not whether the version present is one the
 * consumer compiles against — `expo-modules-core` marks `react-native-worklets`
 * optional and still builds C++ against it, which is #225 in one sentence.
 *
 * Two kinds of range are passed over, each covered by its own assertion rather
 * than by this one: a package with no installed version (nothing to compare,
 * and assertion 3 reds on that tree first) and a range `unparseableRanges`
 * reports.
 */
const peerViolations = (
  versions: Record<string, string | undefined>,
  peerRanges: PeerRangesByPackage,
): PeerViolation[] =>
  Object.entries(peerRanges)
    .flatMap(([consumer, peers]) =>
      Object.entries(peers).flatMap(([dependency, range]) => {
        const installed = versions[dependency];
        if (installed === undefined || !isSemverRange(range)) return [];
        if (satisfies(installed, range)) return [];
        return [{ consumer, dependency, range, installed }];
      }),
    )
    .sort(byConsumer);

/** `PINNED` packages with no entry in root `pnpm.overrides`. */
const missingPins = (overrides: Record<string, string>): string[] =>
  PINNED.filter((name) => overrides[name] === undefined);

describe('native module pins track the installed Expo SDK and satisfy every peer (#225)', () => {
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

  it("each pin equals the installed SDK's bundled version (expected)", () => {
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

  it('the peer-range walk sees the tree at all (edge)', () => {
    // The assertion above is `toEqual([])`, so a walk that found *no* consumers
    // passes it exactly as a clean tree does. `expo-modules-core` is a hard
    // dependency of `expo` and #225's own consumer, which makes it the right
    // canary: it names a package to prove the mechanism, not to enumerate the
    // consumer set the walk exists to discover.
    expect(Object.keys(declaredPeerRanges())).toContain('expo-modules-core');
  });

  it('no declared peer range is unreadable by semver (edge)', () => {
    // `peerViolations` passes over these, so without this they would leave the
    // tree unchecked silently. Red here means a range needs a human, not that a
    // version is wrong.
    expect(unparseableRanges(declaredPeerRanges())).toEqual([]);
  });

  it('a pnpm patch: spec is named as unreadable, not as a version conflict (failure)', () => {
    // The shape `react-native-gesture-handler` already carries in
    // devDependencies. `satisfies` returns `false` for it, so the pre-L2
    // machinery reported it as a version mismatch that does not exist.
    const patched = {
      'react-native-gesture-handler': {
        'react-native-worklets':
          'patch:react-native-worklets@npm%3A0.12.0-nightly#~/.yarn/patches/x.patch',
      },
    };
    expect(unparseableRanges(patched)).toEqual([
      {
        consumer: 'react-native-gesture-handler',
        dependency: 'react-native-worklets',
        range: patched['react-native-gesture-handler']['react-native-worklets'],
      },
    ]);
    expect(
      peerViolations({ 'react-native-worklets': '0.10.1' }, patched),
    ).toEqual([]);
  });

  it('a pinned package with no installed version is passed over (edge)', () => {
    // Characterization, not a regression guard: this returned `[]` before the
    // type change too. The point is that `Record<string, string | undefined>`
    // now says out loud that the range is dropped, where the old cast hid it
    // behind a type that could not be `undefined`. The tree is still covered —
    // assertion 3 (installed equals pin) reds first on any tree that reaches
    // this state.
    expect(
      peerViolations(
        { 'react-native-worklets': undefined },
        { 'expo-modules-core': { 'react-native-worklets': '^0.10.0' } },
      ),
    ).toEqual([]);
  });

  it("the tree #225 shipped is reported against expo-modules-core's real range (failure)", () => {
    // Not a synthetic range: read from the installed manifest, so this case
    // follows expo-modules-core rather than restating a range that can move.
    const range = readJson<PackageManifest>(
      'node_modules',
      'expo-modules-core',
      'package.json',
    ).peerDependencies?.['react-native-worklets'];
    if (range === undefined) {
      throw new Error(
        'expo-modules-core no longer declares a react-native-worklets peer — the #225 case needs rewriting',
      );
    }
    expect(
      peerViolations(
        { 'react-native-worklets': '0.12.1' },
        { 'expo-modules-core': { 'react-native-worklets': range } },
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
