import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { AppState, Platform } from 'react-native';
import type { ApiClient } from '@/features/auth';
import {
  installNotificationHandling,
  registerPushToken,
  rideIdOf,
} from './register-push-token';

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  requestPermissionsAsync: jest.fn(() =>
    Promise.resolve({ status: 'granted' }),
  ),
  getExpoPushTokenAsync: jest.fn(() =>
    Promise.resolve({ data: 'ExponentPushToken[rider0000000000000]' }),
  ),
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({
    remove: jest.fn(),
  })),
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  AndroidImportance: { MAX: 5 },
}));

const t = ((key: string) => key) as unknown as Parameters<
  typeof registerPushToken
>[1];

function api() {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client = {
    request: (method: string, path: string, init?: { body?: unknown }) => {
      calls.push({ method, path, body: init?.body });
      return Promise.resolve(undefined);
    },
  } as unknown as ApiClient;
  return { client, calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  (Constants as { expoConfig?: unknown }).expoConfig = {
    extra: { eas: { projectId: 'p-1' } },
  };
  (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
    status: 'granted',
  });
  // No cold-start tap unless a case asks for one — `clearAllMocks` clears
  // calls, not the implementation a previous case installed.
  (
    Notifications.getLastNotificationResponseAsync as jest.Mock
  ).mockResolvedValue(null);
  Platform.OS = 'android';
});

describe('registerPushToken (#17)', () => {
  it('registers the minted token against the RIDER route (expected)', async () => {
    const { client, calls } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('registered');

    expect(calls).toEqual([
      {
        method: 'PUT',
        path: '/riders/me/push-token',
        body: { token: 'ExponentPushToken[rider0000000000000]' },
      },
    ]);
  });

  it('creates the channel the api actually sends on, BEFORE asking permission (edge)', async () => {
    // Two contracts in one assertion. The channel id must match the api's
    // `channelId: 'presence'`, or Android drops the push into the default
    // channel at default importance. And on Android 13+ the channel has to
    // exist before `requestPermissionsAsync`, or the prompt never shows.
    const { client } = api();

    await registerPushToken(client, t);

    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      'presence',
      expect.objectContaining({ importance: 5 }),
    );
    const channelOrder = (
      Notifications.setNotificationChannelAsync as jest.Mock
    ).mock.invocationCallOrder[0]!;
    const permissionOrder = (Notifications.requestPermissionsAsync as jest.Mock)
      .mock.invocationCallOrder[0]!;
    expect(channelOrder).toBeLessThan(permissionOrder);
  });

  it('a declined permission registers nothing and does not throw (edge)', async () => {
    // The rider then has NO arrival signal while backgrounded — an accepted
    // cost, but never a crash on the booking path.
    (Notifications.requestPermissionsAsync as jest.Mock).mockResolvedValue({
      status: 'denied',
    });
    const { client, calls } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('unavailable');
    expect(calls).toEqual([]);
    expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('a missing EAS projectId is reported, not thrown (edge)', async () => {
    (Constants as { expoConfig?: unknown }).expoConfig = { extra: {} };
    const { client, calls } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('no_project');
    expect(calls).toEqual([]);
  });

  it('a throwing Expo call is swallowed — a rider who cannot push can still book (failure)', async () => {
    (Notifications.getExpoPushTokenAsync as jest.Mock).mockRejectedValue(
      new Error('no FCM credentials'),
    );
    const { client, calls } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('unavailable');
    expect(calls).toEqual([]);
  });
});

describe('installNotificationHandling — foreground presentation (#17)', () => {
  const handler = () =>
    (Notifications.setNotificationHandler as jest.Mock).mock.calls[0]![0]
      .handleNotification as (n: {
      request: { content: { data: unknown } };
    }) => Promise<{ shouldShowBanner: boolean; shouldPlaySound: boolean }>;

  const notification = (data: unknown) => ({ request: { content: { data } } });

  it('suppresses OUR arrival push while the app is active (expected)', async () => {
    // The rider is on `/book/status`, which already reads «Auto ir klāt» and
    // has already announced it. A banner on top is the double-announcement
    // the status screen was explicitly fixed to avoid.
    AppState.currentState = 'active';
    installNotificationHandling(jest.fn());

    const shown = await handler()(
      notification({ kind: 'ride_arrived', rideId: 'r-1' }),
    );

    expect(shown.shouldShowBanner).toBe(false);
    expect(shown.shouldPlaySound).toBe(false);
  });

  it('shows the same push when the app is backgrounded (edge)', async () => {
    // The whole point of #17: this is the ONLY arrival signal a backgrounded
    // rider gets, since #135 stopped their SMS.
    AppState.currentState = 'background';
    installNotificationHandling(jest.fn());

    const shown = await handler()(
      notification({ kind: 'ride_arrived', rideId: 'r-1' }),
    );

    expect(shown.shouldShowBanner).toBe(true);
  });

  it('shows an UNRECOGNISED payload even in the foreground (edge)', async () => {
    // Suppressing on app state alone would silence a future notification
    // kind that has no on-screen equivalent.
    AppState.currentState = 'active';
    installNotificationHandling(jest.fn());

    const shown = await handler()(notification({ kind: 'something_new' }));

    expect(shown.shouldShowBanner).toBe(true);
  });

  it('routes a tapped arrival to its ride, and a junk payload nowhere (failure)', () => {
    const onTap = jest.fn();
    installNotificationHandling(onTap);
    const listener = (
      Notifications.addNotificationResponseReceivedListener as jest.Mock
    ).mock.calls[0]![0] as (r: {
      notification: { request: { content: { data: unknown } } };
    }) => void;

    listener({
      notification: notification({ kind: 'ride_arrived', rideId: 'r-9' }),
    });
    listener({ notification: notification({ nonsense: true }) });

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith('r-9');
  });

  it('routes the tap that LAUNCHED the app, exactly once per notification (failure)', async () => {
    // A killed app is the common case for a rider whose phone slept in their
    // pocket — the very rider #17 exists for. That tap never reaches the
    // listener above; it waits in `getLastNotificationResponseAsync`, which
    // answers with the SAME response on every call, so a re-mounted registrar
    // must not route it a second time on top of wherever they navigated.
    const onTap = jest.fn();
    const response = (identifier: string, data: unknown) =>
      ({
        notification: { request: { identifier, content: { data } } },
      }) as unknown as Notifications.NotificationResponse;
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValue(
      response('rider-cold-1', { kind: 'ride_arrived', rideId: 'r-cold' }),
    );
    installNotificationHandling(onTap);
    installNotificationHandling(onTap);
    await flush();

    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith('r-cold');

    // A genuinely new tap is a new notification and routes again.
    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValue(
      response('rider-cold-2', { kind: 'ride_arrived', rideId: 'r-cold-2' }),
    );
    installNotificationHandling(onTap);
    await flush();

    expect(onTap).toHaveBeenCalledTimes(2);
    expect(onTap).toHaveBeenLastCalledWith('r-cold-2');
  });

  it('a cold-start response carrying an unknown kind routes nowhere (edge)', async () => {
    // Same defensive read as the listener path: `data` is remote input, and a
    // future push kind must not open the status screen on an id that means
    // something else.
    const onTap = jest.fn();
    (
      Notifications.getLastNotificationResponseAsync as jest.Mock
    ).mockResolvedValue({
      notification: {
        request: {
          identifier: 'rider-cold-junk',
          content: { data: { kind: 'ride_cancelled', rideId: 'r-x' } },
        },
      },
    });

    installNotificationHandling(onTap);
    await Promise.resolve();
    await Promise.resolve();

    expect(onTap).not.toHaveBeenCalled();
  });
});

describe('rideIdOf — remote payload, read defensively (#17)', () => {
  it('reads the ride id out of the arrival payload (expected)', () => {
    expect(rideIdOf({ kind: 'ride_arrived', rideId: 'r-1' })).toBe('r-1');
  });

  it('routes nowhere for a kind it has never met (edge)', () => {
    // A future push kind must not open the status screen on a ride id that
    // means something else.
    expect(rideIdOf({ kind: 'ride_cancelled', rideId: 'r-1' })).toBeNull();
  });

  it('refuses every shape that is not a usable id (failure)', () => {
    for (const bad of [
      null,
      undefined,
      'string',
      42,
      {},
      { kind: 'ride_arrived' },
      { kind: 'ride_arrived', rideId: '' },
      { kind: 'ride_arrived', rideId: 7 },
    ]) {
      expect(rideIdOf(bad)).toBeNull();
    }
  });
});
