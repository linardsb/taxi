import { act, render, screen, waitFor } from '@testing-library/react-native';
import { RT, type AuthSession } from '@taxi/shared';
import { Text } from 'react-native';
import { STILL_SEARCHING_MS, useRideStatus } from './use-ride-status';

const mockRequest = jest.fn();
const mockOnBeforeSignOut = jest.fn(() => jest.fn());
const mockSession: AuthSession = {
  accessToken: 'tok',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    phone: '+37126123456',
    role: 'rider',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};
/**
 * ONE context object, not a fresh literal per call. The real `SessionProvider`
 * memoizes its value and `useCallback`s `signOut`/`onBeforeSignOut`, so the
 * hook's effect deps are stable; a mock that rebuilt them on every render would
 * re-run the effect on its own setState and spin forever.
 */
const mockSessionContext = {
  state: { status: 'signedIn', session: mockSession },
  api: { request: mockRequest },
  signIn: jest.fn(),
  signOut: jest.fn(),
  onBeforeSignOut: mockOnBeforeSignOut,
};
jest.mock('@/features/auth', () => ({
  useSession: () => mockSessionContext,
}));

const mockHandlers = new Map<string, (arg: unknown) => void>();
const mockSocket = {
  // See `socket.test.ts`: returning the object from its own initializer makes
  // tsc infer `any`, and nothing under test chains `.on`.
  on: jest.fn((event: string, fn: (arg: unknown) => void) => {
    mockHandlers.set(event, fn);
  }),
  connect: jest.fn(),
  disconnect: jest.fn(),
  removeAllListeners: jest.fn(),
};
jest.mock('./socket', () => ({ createRiderSocket: () => mockSocket }));

const RIDE_ID = '2f1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';

const rideAt = (status: string) => ({
  id: RIDE_ID,
  status,
  riderId: mockSession.user.id,
  driverId: null,
  paymentMethod: 'cash',
  request: {},
  quote: null,
  createdAt: '2026-09-02T00:00:00.000Z',
  updatedAt: '2026-09-02T00:00:00.000Z',
});

const event = (status: string, previousStatus: string | null) => ({
  rideId: RIDE_ID,
  orderId: '3f1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6e',
  status,
  previousStatus,
  reason: null,
  at: '2026-09-02T00:00:01.000Z',
});

function Probe() {
  const { status, stillSearching, connected } = useRideStatus(RIDE_ID);
  return (
    <Text>{`${status ?? 'none'}|${stillSearching ? 'still' : 'not'}|${
      connected ? 'up' : 'down'
    }`}</Text>
  );
}

describe('useRideStatus', () => {
  beforeEach(() => {
    mockHandlers.clear();
    mockRequest.mockReset();
    mockSocket.connect.mockClear();
    mockSocket.disconnect.mockClear();
    // `rideSchema` parses the read, so a plain object is enough here.
    mockRequest.mockResolvedValue(rideAt('requested'));
  });

  it('reads the ride once on mount, then follows ride:status (expected)', async () => {
    await render(<Probe />);

    // The REST read is also the FIRST frame — the screen has a status before
    // any event arrives, rather than an empty line.
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));
    expect(mockRequest).toHaveBeenCalledWith(
      'GET',
      `/rides/${RIDE_ID}`,
      expect.anything(),
    );
    await screen.findByText('requested|not|down');

    await act(async () => {
      mockHandlers.get('connect')!(undefined);
      mockHandlers.get(RT.rideStatus)!(event('accepted', 'requested'));
    });

    await screen.findByText('accepted|not|up');
  });

  it('refetches on every reconnect but not on the opening connect (edge — E7)', async () => {
    await render(<Probe />);
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1));

    await act(async () => mockHandlers.get('connect')!(undefined));
    // The mount read already ran; a second one here would spend a round trip to
    // learn what it knows.
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockResolvedValue(rideAt('accepted'));
    await act(async () => mockHandlers.get('disconnect')!(undefined));
    await act(async () => mockHandlers.get('connect')!(undefined));

    // A reconnected socket is NOT in the ride room — without this the rider is
    // deaf from the first blip onward.
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(2));
    await screen.findByText('accepted|not|up');
  });

  it('follows a status that moves BACKWARD (edge — E8)', async () => {
    await render(<Probe />);
    await act(async () => {
      mockHandlers.get('connect')!(undefined);
      mockHandlers.get(RT.rideStatus)!(event('accepted', 'requested'));
    });
    await screen.findByText('accepted|not|up');

    // #19's dispatcher release emits `accepted → requested`. A consumer that
    // ratcheted would be wrong on this event.
    await act(async () =>
      mockHandlers.get(RT.rideStatus)!(event('requested', 'accepted')),
    );

    await screen.findByText('requested|not|up');
  });

  it('says "still searching" after a minute in requested, never "no drivers" (edge — E3)', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      await render(<Probe />);
      await waitFor(() => expect(mockRequest).toHaveBeenCalled());
      await screen.findByText('requested|not|down');

      await act(async () => {
        jest.advanceTimersByTime(STILL_SEARCHING_MS);
      });

      await screen.findByText('requested|still|down');
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores an event for a different ride and an unparseable payload (failure)', async () => {
    await render(<Probe />);
    await screen.findByText('requested|not|down');

    await act(async () => {
      mockHandlers.get(RT.rideStatus)!({
        ...event('accepted', 'requested'),
        rideId: '9f1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6f',
      });
      mockHandlers.get(RT.rideStatus)!({ nonsense: true });
    });

    expect(screen.getByText('requested|not|down')).toBeTruthy();
  });

  it('registers a sign-out hook so the socket dies while the token is still valid (edge)', async () => {
    mockOnBeforeSignOut.mockClear();
    await render(<Probe />);

    expect(mockOnBeforeSignOut).toHaveBeenCalledTimes(1);
  });
});
