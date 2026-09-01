import { act, render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { ApiError } from '@/features/auth';
import {
  PresenceProvider,
  usePresence,
  type PresenceContextValue,
} from './use-presence';

/**
 * The EFFECT RUNNER, not the reducer — `presence-state.test.ts` owns the
 * decisions. What only a render can reach is `run`'s wiring: whether a
 * rejecting native call escapes to `runEffects` (review F36) and whether the
 * `'stop'` predicate reads the state the chain just wrote (review F32/F48a).
 * Both were untestable while the whole hook was mocked wholesale.
 */

const mockRequest = jest.fn();
// The REAL `ApiError` — `run`'s catch branches on `instanceof`, and a class
// re-declared here would not be the one the hook imports.
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => ({
    state: { status: 'signedIn', session: { accessToken: 'token' } },
    api: { request: mockRequest },
    signOut: jest.fn(),
    onBeforeSignOut: () => () => undefined,
  }),
}));

jest.mock('@/features/onboarding', () => ({
  useMe: () => ({ refetch: jest.fn(() => Promise.resolve(null)) }),
}));

jest.mock('@/features/i18n', () => ({
  useT: () => (key: string) => key,
}));

const mockStartStreaming = jest.fn(() => Promise.resolve());
/** Enough of a socket for `connect_socket` and `teardownSocket` to run. */
const makeSocket = () => ({
  connected: false,
  on: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
});
const mockCreateDriverSocket = jest.fn((_token: string, _opts: unknown) =>
  makeSocket(),
);
const mockEnsurePermissions = jest.fn(() => Promise.resolve('granted'));
const mockRuntime = {
  queue: {
    count: jest.fn(() => Promise.resolve(0)),
    dropOlderThan: jest.fn(() => Promise.resolve(0)),
    clear: jest.fn(() => Promise.resolve()),
  },
  uploader: {
    kick: jest.fn(),
    stop: jest.fn(),
    whenIdle: jest.fn(() => Promise.resolve()),
  },
  setSocket: jest.fn(),
  getSocket: jest.fn(() => null),
  subscribe: jest.fn(() => () => undefined),
};
jest.mock('@/features/location', () => ({
  MAX_REPLAY_AGE_MS: 3_600_000,
  batteryPromptDue: jest.fn(() => Promise.resolve(false)),
  // Resolved at CALL time, not factory time: jest hoists this factory above
  // the `const` below, so naming the spy directly here freezes `undefined`
  // into the module and `connect_socket` throws.
  createDriverSocket: (token: string, opts: unknown) =>
    mockCreateDriverSocket(token, opts),
  ensureLocationPermissions: () => mockEnsurePermissions(),
  getLocationRuntime: () => mockRuntime,
  isStreaming: jest.fn(() => Promise.resolve(false)),
  markBatteryPromptShown: jest.fn(() => Promise.resolve()),
  openBatteryOptimisationSettings: jest.fn(() => Promise.resolve()),
  startStreaming: () => mockStartStreaming(),
  stopStreaming: jest.fn(() => Promise.resolve()),
}));

jest.mock('./intent-store', () => ({
  readIntent: jest.fn(() => Promise.resolve('offline')),
  readMarkedOfflineAt: jest.fn(() => Promise.resolve(null)),
  writeIntent: jest.fn(() => Promise.resolve()),
  writeMarkedOfflineAt: jest.fn(() => Promise.resolve()),
}));

const keepAwake =
  jest.requireMock<typeof import('expo-keep-awake')>('expo-keep-awake');
const writeIntent = jest.mocked(
  jest.requireMock<typeof import('./intent-store')>('./intent-store')
    .writeIntent,
);
const stopStreaming = jest.mocked(
  jest.requireMock<typeof import('@/features/location')>('@/features/location')
    .stopStreaming,
);

/**
 * The go-online half must SUCCEED before the offline put is refused —
 * `streaming: true` is the held branch's whole guard — so the api mock
 * branches on the body. A blanket rejection fails the ONLINE put and neither
 * case below reaches the state it is testing.
 */
const refuseOfflinePutWith =
  (error: ApiError) =>
  (_method: string, _path: string, opts: { body: { status: string } }) =>
    opts.body.status === 'online'
      ? Promise.resolve({ status: 'online' })
      : Promise.reject(error);

let ctx: PresenceContextValue | null = null;
/** Hands the context out through an effect — never a render-time write. */
function Probe() {
  const value = usePresence();
  useEffect(() => {
    ctx = value;
  }, [value]);
  return <Text testID="intent">{value.state.intent}</Text>;
}

/**
 * RNTL's `waitFor` defaults to 1 s. The go-online chain is five effects, each
 * re-entering the reducer, and the file's own `testTimeout` is 20 s — so a
 * longer budget costs nothing when the chain is fast and keeps a slow CI
 * worker from reading as a defect. It is NOT covering a known race: the one
 * stall seen here was the mock-binding bug fixed above, and a real break
 * still fails, just later.
 */
const SETTLE = { timeout: 10_000 };

const mount = async () => {
  await render(
    <PresenceProvider>
      <Probe />
    </PresenceProvider>,
  );
  await screen.findByTestId('intent');
};

beforeEach(() => {
  ctx = null;
  jest.clearAllMocks();
  mockCreateDriverSocket.mockImplementation(makeSocket);
  mockStartStreaming.mockImplementation(() => Promise.resolve());
  mockEnsurePermissions.mockImplementation(() => Promise.resolve('granted'));
  mockRuntime.queue.count.mockImplementation(() => Promise.resolve(0));
  mockRuntime.queue.dropOlderThan.mockImplementation(() => Promise.resolve(0));
});

describe('PresenceProvider — the effect runner', () => {
  it('goes online end to end: permissions, put, stream, socket, keep-awake (expected)', async () => {
    mockRequest.mockResolvedValue({ status: 'online' });
    await mount();

    await act(async () => {
      ctx!.toggle();
    });

    // `keep_awake` is last in `GO_ONLINE`, so waiting on it waits on the
    // whole chain.
    await waitFor(
      () => expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1),
      SETTLE,
    );
    expect(mockStartStreaming).toHaveBeenCalledTimes(1);
    expect(mockCreateDriverSocket).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(ctx!.state.intent).toBe('online'), SETTLE);
  });

  it('a rejecting start_stream folds the toggle back OFF and ends the chain — no ghost toggle (failure — review F36)', async () => {
    // The api accepts, so the server now holds the driver…
    mockRequest.mockResolvedValue({ status: 'online' });
    // …and then the location task refuses to start (Android background
    // permission denied is the common way in).
    mockStartStreaming.mockRejectedValue(new Error('no background permission'));
    await mount();

    await act(async () => {
      ctx!.toggle();
    });

    // The fold must reach the UI: ON with no stream is the exact ghost F31
    // was opened to kill, and it earns a spurious offline nudge at 60–75 s.
    await waitFor(() => expect(ctx!.state.intent).toBe('offline'), SETTLE);
    expect(ctx!.state.streaming).toBe(false);
    // …and the chain must END at the throw, not run on. A `catch` here left
    // both of these behind, so the teardown had a socket and a wake-lock to
    // race against.
    expect(mockCreateDriverSocket).not.toHaveBeenCalled();
    expect(keepAwake.activateKeepAwakeAsync).not.toHaveBeenCalled();
    // The offline PUT is the teardown telling the server what the app just
    // decided — the server was holding us.
    await waitFor(
      () =>
        expect(mockRequest).toHaveBeenCalledWith(
          'PUT',
          '/drivers/me/status',
          expect.objectContaining({ body: { status: 'offline' } }),
        ),
      SETTLE,
    );
  });

  it('a throwing socket teardown still persists the offline intent — the fold ends with it (failure — review F37/F44)', async () => {
    mockRequest.mockResolvedValue({ status: 'online' });
    await mount();
    await act(async () => {
      ctx!.toggle();
    });
    await waitFor(
      () => expect(keepAwake.activateKeepAwakeAsync).toHaveBeenCalledTimes(1),
      SETTLE,
    );

    // Online, socket up, server holding us. Now the drain throws — and so
    // does the socket teardown the fold reaches afterwards.
    const socket = mockCreateDriverSocket.mock.results[0].value;
    socket.removeAllListeners.mockImplementation(() => {
      throw new Error('socket already gone');
    });
    mockRuntime.uploader.whenIdle.mockRejectedValueOnce(
      new Error('uploader died'),
    );
    mockRequest.mockResolvedValue({ status: 'offline' });
    // One write so far, the toggle's `persist_intent online`.
    expect(writeIntent.mock.calls).toEqual([['online']]);

    await act(async () => {
      ctx!.toggle();
    });

    // `persist_intent offline` is LAST in the fold, so an unwrapped throw in
    // `disconnect_socket` skipped it — leaving the store on the toggle's own
    // write only. Three = online, the toggle's offline, then the FOLD's,
    // which is the one the wrap buys.
    await waitFor(() => expect(writeIntent).toHaveBeenCalledTimes(3), SETTLE);
    expect(writeIntent).toHaveBeenLastCalledWith('offline');
    expect(ctx!.state.intent).toBe('offline');
  });

  it('a refused online put stops the chain before it rebuilds what the flip tore down (failure — review F32)', async () => {
    mockRequest.mockRejectedValue(new ApiError(409, 'vehicle_required'));
    await mount();

    await act(async () => {
      ctx!.toggle();
    });

    await waitFor(
      () => expect(ctx!.state.banner?.kind).toBe('vehicle_required'),
      SETTLE,
    );
    // `flipOffline` tore down inside the dispatch; if the chain carried on,
    // its `start_stream`/`connect_socket` would rebuild exactly that, and the
    // last native call would win the race.
    expect(mockStartStreaming).not.toHaveBeenCalled();
    expect(mockCreateDriverSocket).not.toHaveBeenCalled();
    expect(ctx!.state.intent).toBe('offline');
  });

  it('a refused offline put mid-ride stops the chain: the location task is never stopped (failure — #141/F38)', async () => {
    mockRequest.mockImplementation(
      refuseOfflinePutWith(new ApiError(409, 'driver_on_ride')),
    );
    await mount();

    await act(async () => {
      ctx!.toggle();
    });
    await waitFor(() => expect(ctx!.state.intent).toBe('online'), SETTLE);

    await act(async () => {
      ctx!.toggle();
    });

    await waitFor(
      () => expect(ctx!.state.banner?.kind).toBe('driver_on_ride'),
      SETTLE,
    );
    // The server is holding us, so the tap did nothing except say why.
    expect(ctx!.state.intent).toBe('online');
    expect(ctx!.state.streaming).toBe(true);
    // …and the chain stopped at the refusal: the stream the passenger's
    // tracking page and Dina's board read is still up, still uploading.
    expect(stopStreaming).not.toHaveBeenCalled();
    expect(mockRuntime.uploader.stop).not.toHaveBeenCalled();
  });

  it('an offline put that fails on the network still tears down (edge — the ordinary go-offline path)', async () => {
    mockRequest.mockImplementation(
      refuseOfflinePutWith(new ApiError(0, 'offline')),
    );
    await mount();

    await act(async () => {
      ctx!.toggle();
    });
    await waitFor(() => expect(ctx!.state.intent).toBe('online'), SETTLE);

    await act(async () => {
      ctx!.toggle();
    });

    // Intent stayed `offline`, so the chain carries on past the put and the
    // teardown it now queues behind runs. Only the chain can show this: the
    // reducer's `error/offline` branch emits no effects at all.
    await waitFor(() => expect(stopStreaming).toHaveBeenCalledTimes(1), SETTLE);
    expect(mockRuntime.uploader.stop).toHaveBeenCalledTimes(1);
    expect(ctx!.state.intent).toBe('offline');
  });
});
