import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import type { ApiClient } from '@/features/auth';
import { registerPushToken } from './register-push-token';

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
