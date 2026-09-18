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
 * 3. Every peer range on *either* side of a pinned package is satisfied by the
 *    version installed in the repo-root `node_modules` — both the ranges other
 *    packages declare **on** a pinned package (the invariant #225 broke) and
 *    the ranges a pinned package declares **on something else** (#228). The
 *    second direction exists because a pin freezes the declaring manifest too:
 *    `react-native-reanimated@4.5.1` declares `react-native: "0.83 - 0.86"`, so
 *    a `react-native` bump past 0.86 breaks the same invariant from the other
 *    end while both pins stay exactly where this file put them. It reads
 *    installed versions rather than the pins so that a pin replaced by a direct
 *    dependency is still checked; and it reads ranges from the published
 *    manifests rather than from `pnpm-lock.yaml`, because pnpm rewrites the
 *    lock's recorded peer ranges to match an override — after the fix the lock
 *    says `react-native-worklets: 0.10.1` where `expo-modules-core` really
 *    declares the four-clause range above, so a lock-sourced check would be
 *    vacuous.
 *
 * Assertion 3 is an `expect(…).toEqual([])`, and an empty result is ambiguous
 * on its own, so three structural guards sit under it. The first asserts the
 * walk found both directions — `expo-modules-core` declaring a peer *on* a
 * pinned package, and `react-native-reanimated` declaring one *on*
 * `react-native` — so "no violations" cannot be "the walk saw nothing" on
 * either side. The second names any peer range semver cannot parse, because
 * `satisfies` swallows an invalid range and returns `false`, which would
 * otherwise surface a `workspace:` or `patch:` spec as a version conflict it is
 * not. The third names any collected range whose dependency has no installed
 * version: `peerViolations` drops those, and outside `PINNED` nothing else is
 * watching — assertion 2 covers the two pinned packages and nothing more.
 *
 * Consumers are discovered rather than listed. #225 happened because nobody was
 * looking at a package no file named; enumerating three known names here would
 * rebuild that blind spot for the fourth. The other direction needs no
 * discovery: the declaring packages are `PINNED` by construction, and what the
 * walk finds there is whichever peers those two manifests happen to declare.
 * Together they collect 6 consumers and 6 distinct dependency names, of which
 * 2 consumers (the pinned pair itself) and 4 names (`react`, `react-native`,
 * `@babel/core`, `@react-native/metro-config`) come only from the second
 * direction — `observed` 2026-09-18 on the pinned tree, against 4 and 2 before
 * this widening. The walk reads the repo-root
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

/**
 * Peer ranges with a `PINNED` package on one side or the other, keyed by the
 * package declaring them.
 */
type PeerRangesByPackage = Record<string, Record<string, string>>;

/** One peer range declared by one package, with a `PINNED` package at one end. */
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

/** Whether one directory name is a `PINNED` package. */
const isPinned = (name: string): boolean =>
  (PINNED as readonly string[]).includes(name);

/**
 * Every peer range across the installed tree with a `PINNED` package at one
 * end: the ranges other packages declare **on** a pinned package, and every
 * range the pinned packages themselves declare **on anything** (#228). A
 * directory with no readable manifest is skipped: pnpm leaves stray entries
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
      Object.entries(peers).filter(
        ([dependency]) => isPinned(dependency) || isPinned(dir),
      ),
    );
    if (Object.keys(relevant).length > 0) found[dir] = relevant;
  }
  return found;
};

/** Every package a collected range names as the dependency, deduplicated. */
const peerDependencyNames = (peerRanges: PeerRangesByPackage): string[] =>
  [
    ...new Set(
      Object.values(peerRanges).flatMap((peers) => Object.keys(peers)),
    ),
  ].sort();

/**
 * The version of each named package present in the root `node_modules`.
 * `PackageManifest.version` is optional and a package need not be installed at
 * all, so this is `string | undefined` and says so: casting the absence away
 * would let `peerViolations` drop every range declared against that package and
 * pass vacuously. A missing manifest yields `undefined` rather than throwing,
 * because the widened walk reaches packages nothing in this workspace pins —
 * `uninstalledPeers` is what names that case, and assertion 2 still fails
 * cleanly when a *pinned* package is the one missing.
 */
const installedVersions = (
  names: readonly string[],
): Record<string, string | undefined> =>
  Object.fromEntries(
    names.map((name) => {
      try {
        return [
          name,
          readJson<PackageManifest>('node_modules', name, 'package.json')
            .version,
        ];
      } catch {
        return [name, undefined];
      }
    }),
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
 * than by this one: a dependency with no installed version, which
 * `uninstalledPeers` names, and a range `unparseableRanges` reports.
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

/**
 * Collected ranges whose dependency is not installed at the root at all.
 * `peerViolations` has nothing to compare for these and drops them, and before
 * #228 that was safe to leave unnamed: every dependency it could see was
 * `PINNED`, and assertion 2 reds first on a tree missing one. The widened walk
 * collects ranges against packages this file does not pin — a drop there is
 * silent, so it gets its own name, the same treatment `unparseableRanges` gets.
 *
 * `peerDependenciesMeta.optional` is not consulted, matching `peerViolations`.
 * Neither pinned package declares an optional peer today (`observed`
 * 2026-09-18: both `peerDependenciesMeta` objects are empty), so this reports
 * nothing on the current tree; a published manifest adding an optional peer
 * pnpm then declines to install would red it on a non-regression, and that is a
 * one-line review, not a hole.
 */
const uninstalledPeers = (
  versions: Record<string, string | undefined>,
  peerRanges: PeerRangesByPackage,
): DeclaredRange[] =>
  Object.entries(peerRanges)
    .flatMap(([consumer, peers]) =>
      Object.entries(peers)
        .filter(([dependency]) => versions[dependency] === undefined)
        .map(([dependency, range]) => ({ consumer, dependency, range })),
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
    expect(installedVersions(PINNED)).toEqual(
      Object.fromEntries(PINNED.map((name) => [name, overrides[name]])),
    );
  });

  it('no peer range with a pinned package at either end is violated (expected)', () => {
    const peerRanges = declaredPeerRanges();
    expect(
      peerViolations(
        installedVersions(peerDependencyNames(peerRanges)),
        peerRanges,
      ),
    ).toEqual([]);
  });

  it('the peer-range walk sees both directions of the tree (edge)', () => {
    // The assertion above is `toEqual([])`, so a walk that found *no* consumers
    // passes it exactly as a clean tree does — and a walk that found only one
    // direction passes it too. `expo-modules-core` is a hard dependency of
    // `expo` and #225's own consumer; `react-native-reanimated`'s own
    // `react-native` peer is #228's case. Each names a package to prove the
    // mechanism, not to enumerate the consumer set the walk exists to discover.
    const peerRanges = declaredPeerRanges();
    expect(Object.keys(peerRanges)).toContain('expo-modules-core');
    expect(Object.keys(peerRanges['react-native-reanimated'] ?? {})).toContain(
      'react-native',
    );
  });

  it('every collected range names an installed package (edge)', () => {
    // `peerViolations` drops a range whose dependency is not installed. For a
    // `PINNED` dependency assertion 2 reds on that tree first; for the packages
    // the widened walk reaches (`react-native`, `react`, …) nothing else is
    // watching, so the drop is named here instead of being silent.
    const peerRanges = declaredPeerRanges();
    expect(
      uninstalledPeers(
        installedVersions(peerDependencyNames(peerRanges)),
        peerRanges,
      ),
    ).toEqual([]);
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

  it('a dependency with no installed version is passed over here (edge)', () => {
    // `peerViolations` reports version conflicts, and an absent package is not
    // one, so it drops the range — deliberately, and `Record<string, string |
    // undefined>` says so in the type rather than hiding it behind a cast that
    // could not be `undefined`. What covers the drop depends on which side is
    // missing: assertion 2 (installed equals pin) reds first when it is a
    // `PINNED` package, and `uninstalledPeers` names it when it is not.
    expect(
      peerViolations(
        { 'react-native-worklets': undefined },
        { 'expo-modules-core': { 'react-native-worklets': '^0.10.0' } },
      ),
    ).toEqual([]);
  });

  it('a dependency with no installed version is named by uninstalledPeers (failure)', () => {
    // The other half of the pair above, and the reason the drop is not silent.
    expect(
      uninstalledPeers(
        { 'react-native': undefined },
        { 'react-native-reanimated': { 'react-native': '0.83 - 0.86' } },
      ),
    ).toEqual([
      {
        consumer: 'react-native-reanimated',
        dependency: 'react-native',
        range: '0.83 - 0.86',
      },
    ]);
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

  it("a react-native bump past a pinned package's own range is reported (failure)", () => {
    // #228's shape: the range is declared *by* a pinned package, on a package
    // this file does not pin. Before the widening `declaredPeerRanges` dropped
    // it and every case here stayed green while the peer was violated. The
    // range is a literal rather than a reading of reanimated's manifest — it
    // states what the machinery does with a range of this shape, and must not
    // move when reanimated widens its own; the real manifest is what the
    // walk-sees-both-directions case above binds to.
    expect(
      peerViolations(
        { 'react-native': '0.87.0' },
        { 'react-native-reanimated': { 'react-native': '0.83 - 0.86' } },
      ),
    ).toEqual([
      {
        consumer: 'react-native-reanimated',
        dependency: 'react-native',
        range: '0.83 - 0.86',
        installed: '0.87.0',
      },
    ]);
  });

  it('a peer on a package this file does not track is left to pnpm (edge)', () => {
    // Neither end is `PINNED`, so `declaredPeerRanges` never collects this
    // range — which is why `peerViolations` does not filter by `PINNED` itself
    // and, handed the range directly with no installed version for its
    // dependency, simply has nothing to compare.
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
