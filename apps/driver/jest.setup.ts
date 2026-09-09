/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Native modules, faked once for every colocated test. RNTL cleans up after
 * each test on its own under jest (a global `afterEach` exists here, unlike
 * the dispatch app's vitest run), so no manual `cleanup` is wired.
 *
 * Every `mock*` binding below is read lazily by its factory on first import,
 * which is why the names carry the prefix jest's hoisting requires.
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

// Nothing in a unit test may reach sqlite — the queue tests use the
// in-memory port, and the headless task is driven with a fake queue.
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(() =>
    Promise.reject(
      new Error(
        'expo-sqlite is not available under jest — use InMemoryFixQueue',
      ),
    ),
  ),
}));

jest.mock('expo-location', () => ({
  Accuracy: { BestForNavigation: 6 },
  ActivityType: { AutomotiveNavigation: 2 },
  requestForegroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  requestBackgroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getBackgroundPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  startLocationUpdatesAsync: jest.fn(() => Promise.resolve()),
  stopLocationUpdatesAsync: jest.fn(() => Promise.resolve()),
  hasStartedLocationUpdatesAsync: jest.fn(() => Promise.resolve(false)),
}));

// `defineTask` records the executor so a test can invoke the headless task.
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(false)),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-notifications', () => ({
  AndroidImportance: { MAX: 5 },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getExpoPushTokenAsync: jest.fn(() =>
    Promise.resolve({ data: 'ExponentPushToken[jestjestjestjestjest]' }),
  ),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
}));

// The offer tone and haptics (#15). One player object per test file, so a
// test reads the same `play`/`pause` spies the hook called.
const mockAudioPlayer = {
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  remove: jest.fn(),
  loop: false,
  playing: false,
};
jest.mock('expo-audio', () => ({
  useAudioPlayer: jest.fn(() => mockAudioPlayer),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-haptics', () => ({
  NotificationFeedbackType: {
    Success: 'success',
    Warning: 'warning',
    Error: 'error',
  },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  notificationAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-localization', () => ({
  getLocales: jest.fn(() => [{ languageCode: 'lv' }]),
}));

jest.mock('expo-intent-launcher', () => ({
  ActivityAction: {
    IGNORE_BATTERY_OPTIMIZATION_SETTINGS:
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
  },
  startActivityAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

// One router object per test file, so `useRouter().push` is the same spy a
// test reads back through `jest.requireMock('expo-router').useRouter()`.
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  navigate: jest.fn(),
};
jest.mock('expo-router', () => {
  const { Text } = require('react-native') as typeof import('react-native');
  const React = require('react') as typeof import('react');
  return {
    useRouter: () => mockRouter,
    // `jest.mocked(usePathname).mockReturnValue('/offer')` in a test that
    // needs the offer screen to believe it is already showing.
    usePathname: jest.fn(() => '/home'),
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
 */
const warm = require('react-native') as typeof import('react-native');
void [
  warm.AccessibilityInfo,
  warm.ActivityIndicator,
  warm.AppState,
  warm.Linking,
  warm.Platform,
  warm.Pressable,
  warm.ScrollView,
  warm.StyleSheet,
  warm.Switch,
  warm.Text,
  warm.TextInput,
  warm.View,
];
require('react-native-safe-area-context');
require('@testing-library/react-native');
