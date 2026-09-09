import { act, render, waitFor } from '@testing-library/react-native';
import { authSessionSchema } from '@taxi/shared';
import { deactivateKeepAwake } from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import { useEffect } from 'react';
import {
  PresenceProvider,
  usePresence,
  type PresenceContextValue,
} from '@/features/availability';
import type { ApiClient } from './api-client';
import { SESSION_KEY } from './session-store';
import {
  SessionProvider,
  useSession,
  type SessionContextValue,
} from './use-session';

/**
 * #140 — the sign-out ORDER, end to end through the real `SessionProvider`
 * and the real `PresenceProvider`: presence goes quiet while the token is
 * still valid, the queue is cleared whatever a sibling hook did, and the
 * session is cleared LAST. Every fake pushes onto one ledger, so order is a
 * position in an array rather than a set of `toHaveBeenCalled`s.
 */

const mockCalls: string[] = [];
const mockMakeSocket = () => ({
  connected: false,
  on: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(() => {
    mockCalls.push('socket.disconnect');
  }),
  removeAllListeners: jest.fn(),
});
const mockRuntime = {
  queue: {
    count: () => Promise.resolve(0),
    dropOlderThan: () => Promise.resolve(0),
    clear: jest.fn(() => {
      mockCalls.push('queue.clear');
      return Promise.resolve();
    }),
  },
  uploader: {
    kick: jest.fn(),
    stop: jest.fn(() => {
      mockCalls.push('uploader.stop');
    }),
    whenIdle: () => Promise.resolve(),
  },
  setSocket: jest.fn(),
  getSocket: () => null,
  subscribe: () => () => undefined,
};
jest.mock('@/features/location', () => ({
  MAX_REPLAY_AGE_MS: 3_600_000,
  batteryPromptDue: () => Promise.resolve(false),
  createDriverSocket: () => mockMakeSocket(),
  ensureLocationPermissions: () => Promise.resolve('granted'),
  getLocationRuntime: () => mockRuntime,
  isStreaming: () => Promise.resolve(false),
  markBatteryPromptShown: () => Promise.resolve(),
  openBatteryOptimisationSettings: () => Promise.resolve(),
  startStreaming: () => Promise.resolve(),
  stopStreaming: () => {
    mockCalls.push('stopStreaming');
    return Promise.resolve();
  },
}));

jest.mock('../availability/intent-store', () => ({
  readIntent: () => Promise.resolve('offline'),
  readMarkedOfflineAt: () => Promise.resolve(null),
  writeIntent: (intent: string) => {
    mockCalls.push(`writeIntent:${intent}`);
    return Promise.resolve();
  },
  writeMarkedOfflineAt: () => Promise.resolve(),
}));

jest.mock('@/features/onboarding', () => ({
  useMe: () => ({ refetch: () => Promise.resolve(null) }),
}));

const session = authSessionSchema.parse({
  accessToken: 'token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: 'd0000000-0000-4000-8000-000000000001',
    phone: '+37120000000',
    role: 'driver',
    createdAt: '2026-09-04T10:00:00.000Z',
  },
});

/** The presence PUTs, recorded; everything else answers nothing. */
const api: ApiClient = {
  request: jest.fn(
    (method: string, path: string, opts?: { body?: unknown }) => {
      if (method === 'PUT' && path === '/drivers/me/status') {
        const status = (opts?.body as { status: string }).status;
        mockCalls.push(`put:${status}`);
        return Promise.resolve({ userId: session.user.id, status });
      }
      return Promise.resolve(undefined);
    },
  ) as ApiClient['request'],
};

let sessionCtx: SessionContextValue | null = null;
let presenceCtx: PresenceContextValue | null = null;
function Probe() {
  const s = useSession();
  const p = usePresence();
  useEffect(() => {
    sessionCtx = s;
    presenceCtx = p;
  });
  // Stands in for `PushRegistrar`'s `DELETE /drivers/me/push-token` hook: a
  // sibling that REJECTS. `Promise.allSettled` must let presence finish.
  useEffect(
    () =>
      s.onBeforeSignOut(() => {
        mockCalls.push('push.delete');
        return Promise.reject(new Error('network'));
      }),
    [s],
  );
  return null;
}

async function signedInAndOnline() {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation((key: string) => {
    mockCalls.push(`delete:${key}`);
    return Promise.resolve();
  });
  await render(
    <SessionProvider api={api}>
      <PresenceProvider>
        <Probe />
      </PresenceProvider>
    </SessionProvider>,
  );
  await waitFor(() => expect(sessionCtx?.state.status).toBe('signedIn'));

  await act(async () => presenceCtx!.toggle());
  await waitFor(() => expect(mockCalls).toContain('put:online'));
  await waitFor(() => expect(presenceCtx!.state.busy).toBe(false));
  mockCalls.length = 0;
}

const presenceOrder = () =>
  mockCalls.filter((c) => c !== 'push.delete' && !c.startsWith('delete:'));

describe('signOut ordering (#140)', () => {
  beforeEach(() => {
    mockCalls.length = 0;
    jest.mocked(deactivateKeepAwake).mockImplementation(() => {
      mockCalls.push('keepAwake.off');
      return Promise.resolve();
    });
  });

  it('presence goes quiet in order, the queue is cleared although the push DELETE rejected, and the session is cleared last (expected + failure)', async () => {
    await signedInAndOnline();

    await act(() => sessionCtx!.signOut());

    expect(presenceOrder()).toEqual([
      'stopStreaming',
      'socket.disconnect',
      'uploader.stop',
      'queue.clear',
      'keepAwake.off',
      'writeIntent:offline',
      'put:offline',
    ]);
    expect(mockCalls).toContain('push.delete');
    expect(mockCalls[mockCalls.length - 1]).toBe(`delete:${SESSION_KEY}`);
    await waitFor(() => expect(sessionCtx!.state.status).toBe('signedOut'));
  });

  /**
   * The keep-awake hazard at `use-presence.tsx` (`await deactivateKeepAwake`
   * unwrapped inside `onBeforeSignOut`): on Android the call throws when the
   * Activity that took the lock is gone, and the throw skipped the intent
   * write and the offline PUT — the store kept saying «online» and the server
   * was never told, so the next cold launch re-asserted online, on a
   * handed-over phone under a new session.
   *
   * Shipped as `it.failing` with the reviewer's call pending (#15 plan T21);
   * PR #154's review ruled fix-it-here, so `use-presence.tsx` now guards that
   * call the same way the `keep_awake` effect above it already did, and this
   * is a plain `it`. Reverting the `.catch` makes it fail again — verified.
   */
  it('a rejecting deactivateKeepAwake still writes the intent and tells the server (edge — the hazard)', async () => {
    jest.mocked(deactivateKeepAwake).mockImplementation(() => {
      mockCalls.push('keepAwake.off');
      return Promise.reject(new Error('Activity gone'));
    });
    await signedInAndOnline();

    await act(() => sessionCtx!.signOut());

    expect(mockCalls).toContain('writeIntent:offline');
    expect(mockCalls).toContain('put:offline');
  });
});
