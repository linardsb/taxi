/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Native modules, faked once for every colocated test. RNTL cleans up after
 * each test on its own under jest (a global `afterEach` exists here, unlike
 * the dispatch app's vitest run), so no manual `cleanup` is wired.
 *
 * Every `mock*` binding below is read lazily by its factory on first import,
 * which is why the names carry the prefix jest's hoisting requires.
 *
 * The driver app's fakes for `expo-sqlite`, `expo-task-manager`,
 * `expo-notifications`, `expo-keep-awake` and `expo-intent-launcher` are ABSENT
 * on purpose: this app installs none of them. `expo-task-manager` in particular
 * is what pulls background-location capability into a manifest, and the
 * architecture's whole reason for two apps is that this one never has it.
 */

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((key: string) =>
    Promise.resolve(mockSecure.get(key) ?? null),
  ),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecure.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecure.delete(key);
    return Promise.resolve();
  }),
}));

/**
 * AsyncStorage, backed by a Map. Saved addresses are not secrets and a growing
 * list is the wrong fit for SecureStore's iOS value ceiling — so the two stores
 * are faked separately here, exactly as they are separate in the app.
 */
const mockAsync = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn((key: string) =>
      Promise.resolve(mockAsync.get(key) ?? null),
    ),
    setItem: jest.fn((key: string, value: string) => {
      mockAsync.set(key, value);
      return Promise.resolve();
    }),
    removeItem: jest.fn((key: string) => {
      mockAsync.delete(key);
      return Promise.resolve();
    }),
  },
}));

/**
 * FOREGROUND ONLY. `requestBackgroundPermissionsAsync` and
 * `startLocationUpdatesAsync` are deliberately not faked: this app never calls
 * them, and a fake here would make a test that reached for one pass silently.
 */
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 56.9496, longitude: 24.1052 } }),
  ),
  reverseGeocodeAsync: jest.fn(() =>
    Promise.resolve([
      { street: 'Brīvības iela', streetNumber: '45', city: 'Rīga' },
    ]),
  ),
}));

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'lv' }]),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

/**
 * A real v4 uuid — version nibble `4`, variant `8` — because
 * `idempotencyKeySchema` and `addressSearchQuerySchema.session` are both
 * `z.string().uuid()`, and a fake returning `'uuid'` would let a test pass on a
 * value the api 400s.
 *
 * COUNTED rather than random, so a test can assert that two keys differ (the
 * draft's rotation rule) without asserting on entropy.
 */
let mockUuid = 0;
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockUuid += 1;
    return `00000000-0000-4000-8000-${String(mockUuid).padStart(12, '0')}`;
  }),
}));

/**
 * `findNodeHandle`, and ONLY `findNodeHandle`, faked across this suite.
 *
 * WHY: under this renderer it returns `null` even for a ref that IS attached
 * (`observed` — a probe that logged `ref.current` as set still got `null` back).
 * `useScreenFocus` guards that null, so without this fake it silently no-ops in
 * every test, `AccessibilityInfo.setAccessibilityFocus` is never called, and
 * "focus lands on the header on mount" — accessibility property 1, the app's
 * whole differentiator — becomes unassertable. Faking the handle is what makes
 * the hook's real control flow (read ref → find handle → move focus) run end to
 * end; that the OS then puts the cursor there is what the TalkBack walkthrough
 * confirms, and no unit test ever could.
 *
 * A PROXY rather than a spread of `requireActual`: `react-native`'s index is
 * built from lazy getters, and spreading it would evaluate every one — undoing
 * exactly what the warm-up block below is for. Everything except this one
 * function passes straight through to the real module.
 *
 * Handles increment so two headers in one test are distinguishable.
 */
let mockNodeHandle = 0;
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native') as Record<string, unknown>;
  return new Proxy(actual, {
    get: (target: Record<string, unknown>, prop: string | symbol) =>
      prop === 'findNodeHandle'
        ? () => {
            mockNodeHandle += 1;
            return mockNodeHandle;
          }
        : target[prop as string],
  });
});

// One router object per test file, so `useRouter().push` is the same spy a
// test reads back through `jest.requireMock('expo-router').useRouter()`.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  // `navigate`, not `push`, is how the search sheet returns its result: it
  // reuses the `/book` already in the stack instead of pushing a second one.
  navigate: jest.fn(),
};
jest.mock('expo-router', () => {
  const { Text } = require('react-native') as typeof import('react-native');
  const React = require('react') as typeof import('react');
  return {
    useRouter: () => mockRouter,
    useLocalSearchParams: jest.fn(() => ({})),
    Redirect: ({ href }: { href: string }) =>
      React.createElement(Text, { testID: 'redirect' }, String(href)),
    Stack: () => null,
    Link: () => null,
  };
});

/**
 * Warm the transform OUTSIDE any test's clock. jest-expo transforms and
 * evaluates `react-native`'s lazily-required component modules on first
 * access, which otherwise lands inside the first `render()` of every RNTL
 * file: ~3.5 s per file on a cold cache on the dev machine (`observed`,
 * `jest --clearCache` then `--verbose`), and on the 2-vCPU CI runner — cold
 * every run, api and dispatch suites transforming alongside — past a 5 s and
 * then a 20 s `testTimeout` (runs 33402386433, 33407278413). A setup file has
 * no timeout, so touching what the app renders here moves that cost off the
 * test. The getters are what trigger the requires — hence the reads.
 *
 * `AccessibilityInfo` leads the list here rather than trailing it: every screen
 * in this app announces or moves focus through it, so it is on the first render
 * path of every RNTL file.
 */
const warm = require('react-native') as typeof import('react-native');
void [
  warm.AccessibilityInfo,
  warm.ActivityIndicator,
  warm.AppState,
  warm.FlatList,
  warm.Linking,
  warm.Platform,
  warm.Pressable,
  warm.ScrollView,
  warm.StyleSheet,
  warm.Text,
  warm.TextInput,
  warm.View,
];
require('react-native-safe-area-context');
require('@testing-library/react-native');
