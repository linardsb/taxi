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
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
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
