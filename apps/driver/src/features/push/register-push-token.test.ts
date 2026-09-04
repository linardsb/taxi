import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';
import type { ApiClient } from '@/features/auth';
import {
  installNotificationHandling,
  registerPushToken,
} from './register-push-token';

type Handler = Parameters<typeof Notifications.setNotificationHandler>[0];
type Presented = { shouldShowBanner: boolean; shouldPlaySound: boolean };

/** What the installed handler decides for a notification carrying `data`. */
async function presentationFor(
  data: Record<string, string>,
): Promise<Presented> {
  const handler = jest.mocked(Notifications.setNotificationHandler).mock
    .calls[0]![0] as NonNullable<Handler>;
  return (await handler.handleNotification({
    request: { content: { data } },
  } as unknown as Parameters<
    typeof handler.handleNotification
  >[0])) as Presented;
}

describe('installNotificationHandling (#15)', () => {
  const onTap = jest.fn();
  // The RN mock exposes `currentState` as a plain property, not a getter.
  const appState = AppState as unknown as { currentState: string };
  beforeEach(() => {
    jest.clearAllMocks();
    appState.currentState = 'active';
  });
  afterEach(() => {
    appState.currentState = 'active';
  });

  it('suppresses an offer arriving while the app is active — the socket already showed it (expected)', async () => {
    installNotificationHandling({ onTap });
    expect(await presentationFor({ kind: 'offer' })).toEqual(
      expect.objectContaining({
        shouldShowBanner: false,
        shouldPlaySound: false,
      }),
    );
  });

  it('still shows a backgrounded offer and every nudge (edge)', async () => {
    installNotificationHandling({ onTap });
    appState.currentState = 'background';
    expect(await presentationFor({ kind: 'offer' })).toEqual(
      expect.objectContaining({
        shouldShowBanner: true,
        shouldPlaySound: true,
      }),
    );
    appState.currentState = 'active';
    expect(await presentationFor({ kind: 'offline_nudge' })).toEqual(
      expect.objectContaining({
        shouldShowBanner: true,
        shouldPlaySound: true,
      }),
    );
  });

  it('routes a tap through routeNotification and a foreground receipt through onReceived (expected)', () => {
    const onReceived = jest.fn();
    installNotificationHandling({ onTap, onReceived });

    const tapped = jest.mocked(
      Notifications.addNotificationResponseReceivedListener,
    ).mock.calls[0]![0];
    tapped({
      notification: {
        request: { content: { data: { kind: 'offline_nudge' } } },
      },
    } as unknown as Parameters<typeof tapped>[0]);
    expect(onTap).toHaveBeenCalledWith({ kind: 'gate' });

    const received = jest.mocked(Notifications.addNotificationReceivedListener)
      .mock.calls[0]![0];
    received({
      request: { content: { data: { kind: 'offer', offerId: 'o1' } } },
    } as unknown as Parameters<typeof received>[0]);
    expect(onReceived).toHaveBeenCalledWith({
      kind: 'offer',
      offer: null,
      offerId: 'o1',
      rideId: null,
    });
  });

  it('routes a cold-start tap exactly once per notification, however often the registrar re-installs (failure)', async () => {
    const response = (identifier: string) =>
      ({
        notification: {
          request: { identifier, content: { data: { kind: 'offer' } } },
        },
      }) as unknown as Notifications.NotificationResponse;
    const flush = async () => {
      await Promise.resolve();
      await Promise.resolve();
    };

    // The OS answers with the SAME response on every call after the tap.
    jest
      .mocked(Notifications.getLastNotificationResponseAsync)
      .mockResolvedValue(response('cold-1'));
    installNotificationHandling({ onTap });
    installNotificationHandling({ onTap });
    await flush();
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'offer' }),
    );

    // A genuinely new tap is a new notification and routes again.
    jest
      .mocked(Notifications.getLastNotificationResponseAsync)
      .mockResolvedValue(response('cold-2'));
    installNotificationHandling({ onTap });
    await flush();
    expect(onTap).toHaveBeenCalledTimes(2);
  });
});

const t = () => 'Sakta Cab — tiešsaistē';

function api() {
  const request = jest.fn(() => Promise.resolve(undefined));
  return { client: { request } as unknown as ApiClient, request };
}

describe('registerPushToken', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation();
    (Constants.expoConfig as { extra?: unknown }).extra = {
      eas: { projectId: 'p1' },
    };
    jest.mocked(Notifications.getExpoPushTokenAsync).mockResolvedValue({
      type: 'expo',
      data: 'ExponentPushToken[jestjestjestjestjest]',
    });
  });
  afterEach(() => warn.mockRestore());

  it('mints the token and PUTs it (expected)', async () => {
    const { client, request } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('registered');

    expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({
      projectId: 'p1',
    });
    expect(request).toHaveBeenCalledWith('PUT', '/drivers/me/push-token', {
      body: { token: 'ExponentPushToken[jestjestjestjestjest]' },
    });
  });

  it('does nothing without an EAS projectId — A2 not done yet (edge)', async () => {
    (Constants.expoConfig as { extra?: unknown }).extra = {};
    const { client, request } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('no_project');

    expect(request).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('reports unavailable and never throws when the token cannot be minted (failure)', async () => {
    jest
      .mocked(Notifications.getExpoPushTokenAsync)
      .mockRejectedValueOnce(new Error('no FCM credentials'));
    const { client, request } = api();

    await expect(registerPushToken(client, t)).resolves.toBe('unavailable');

    expect(request).not.toHaveBeenCalled();
    // The provider's message stays on the console, never in a request.
    expect(warn).toHaveBeenCalledWith(
      'push: registration failed',
      'no FCM credentials',
    );
  });
});
