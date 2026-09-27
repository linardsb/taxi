import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { AuthSession } from '@taxi/shared';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { createApiClient } from './api-client';
import * as SecureStore from 'expo-secure-store';
import { clearSession, SESSION_KEY, writeSession } from './session-store';
import {
  SessionProvider,
  useSession,
  type SessionContextValue,
} from './use-session';

const SESSION: AuthSession = {
  accessToken: 'token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    phone: '+37126123456',
    role: 'rider',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

let ctx: SessionContextValue | null = null;
/** Hands the context out through an effect — never a render-time write. */
function Probe() {
  const value = useSession();
  useEffect(() => {
    ctx = value;
  }, [value]);
  return <Text>{value.state.status}</Text>;
}

describe('SessionProvider.signOut', () => {
  it('a 401 inside a sign-out hook joins the sign-out in flight — one hook pass, one request, session cleared (failure — the dead-token path)', async () => {
    await writeSession(SESSION);
    const fetch401 = jest.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
          { status: 401 },
        ),
      ),
    );
    // The real client, wired the way the app wires it: a 401 to a request
    // that carried a token signs out. The hook is the ride-status socket's
    // teardown shape — an api call with the token that just died.
    const api = createApiClient({
      baseUrl: 'http://api',
      getToken: () => 'token',
      onUnauthorized: () => void ctx!.signOut(),
      fetchImpl: fetch401 as unknown as typeof fetch,
    });
    await render(
      <SessionProvider api={api}>
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText('signedIn');
    const hook = jest.fn(async () => {
      await api
        .request('DELETE', '/rides/status-socket')
        .catch(() => undefined);
    });
    ctx!.onBeforeSignOut(hook);

    await act(() => ctx!.signOut());

    expect(hook).toHaveBeenCalledTimes(1);
    expect(fetch401).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText('signedOut')).toBeTruthy());
  });
});

describe('SessionProvider.setDisplayName (#269)', () => {
  const stored = () => SecureStore.getItemAsync(SESSION_KEY);

  async function mountSignedIn() {
    await writeSession(SESSION);
    await render(
      <SessionProvider
        api={createApiClient({
          baseUrl: 'http://api',
          getToken: () => null,
          onUnauthorized: () => undefined,
        })}
      >
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText('signedIn');
  }

  it('writes the name into the live and the stored session (expected)', async () => {
    await mountSignedIn();

    await act(() => ctx!.setDisplayName('Anna'));

    await waitFor(() =>
      expect(ctx!.state.session?.user.displayName).toBe('Anna'),
    );
    expect(await stored()).toContain('"displayName":"Anna"');
  });

  it('removes the key on null rather than storing undefined (edge)', async () => {
    await mountSignedIn();
    await act(() => ctx!.setDisplayName('Anna'));

    await act(() => ctx!.setDisplayName(null));

    await waitFor(() =>
      expect(ctx!.state.session?.user).not.toHaveProperty('displayName'),
    );
    expect(await stored()).not.toContain('displayName');
  });

  it('is a no-op while signed out, with no write (failure)', async () => {
    await clearSession();
    await render(
      <SessionProvider
        api={createApiClient({
          baseUrl: 'http://api',
          getToken: () => null,
          onUnauthorized: () => undefined,
        })}
      >
        <Probe />
      </SessionProvider>,
    );
    await screen.findByText('signedOut');
    const writes = jest.mocked(SecureStore.setItemAsync);
    writes.mockClear();

    await act(() => ctx!.setDisplayName('Anna'));

    expect(writes).not.toHaveBeenCalled();
    expect(await stored()).toBeNull();
  });
});
