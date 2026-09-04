import { act, render, screen, waitFor } from '@testing-library/react-native';
import type { AuthSession } from '@taxi/shared';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { createApiClient } from './api-client';
import { writeSession } from './session-store';
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
