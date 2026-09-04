import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { formatMessage, rideSchema, splitFare, type Ride } from '@taxi/shared';
import { ApiError } from '@/features/auth';
import type { RuntimeListener } from '@/features/location';
import { ActiveRideScreen } from './active-ride-screen';
import {
  ActiveRideProvider,
  useActiveRide,
  type ActiveRideContextValue,
} from './use-active-ride';

/**
 * The EFFECT RUNNER and the socket wiring — `active-ride-state.test.ts` owns
 * the decisions. What only a render can reach: the GET on `open`, the GET on
 * every `connect` (the room re-join), the 409 → banner path, the receipt.
 */

const ME = 'd0000000-0000-4000-8000-000000000001';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

const mockRequest = jest.fn();
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => ({
    state: {
      status: 'signedIn',
      session: {
        accessToken: 'token',
        user: { id: 'd0000000-0000-4000-8000-000000000001' },
      },
    },
    api: { request: mockRequest },
    signOut: jest.fn(),
    onBeforeSignOut: () => () => undefined,
  }),
}));

const mockListeners: RuntimeListener[] = [];
const mockRuntime = {
  subscribe: jest.fn((listener: RuntimeListener) => {
    mockListeners.push(listener);
    return () => undefined;
  }),
};
jest.mock('@/features/location', () => ({
  getLocationRuntime: () => mockRuntime,
}));

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

const ride = (over: Partial<Ride> = {}): Ride =>
  rideSchema.parse({
    id: RIDE_ID,
    orderId: '11111111-2222-4333-8444-555555555555',
    status: 'accepted',
    riderId: '99999999-8888-4777-8666-555555555555',
    driverId: ME,
    paymentMethod: 'cash',
    request: {
      riderId: '99999999-8888-4777-8666-555555555555',
      pickup: {
        location: { lat: 56.95, lng: 24.11 },
        address: 'Brīvības iela 1',
      },
      destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
      paymentMethod: 'cash',
    },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: { baseCents: 300, distanceCents: 640, timeCents: 300 },
    },
    createdAt: '2026-09-04T10:00:00.000Z',
    updatedAt: '2026-09-04T10:00:00.000Z',
    ...over,
  });

let ctx: ActiveRideContextValue | null = null;
function Probe() {
  const value = useActiveRide();
  useEffect(() => {
    ctx = value;
  });
  return <Text testID="status">{value.state.ride?.status ?? ''}</Text>;
}

type Handlers = Record<string, (payload?: unknown) => void>;
function makeSocket() {
  const handlers: Handlers = {};
  return {
    handlers,
    socket: {
      on: jest.fn((event: string, handler: (payload?: unknown) => void) => {
        handlers[event] = handler;
      }),
      off: jest.fn(),
    },
  };
}

/** The api as the reducer meets it: a GET answers `current`, steps answer per `steps`. */
function apiAnswers(
  current: () => Ride,
  steps: Record<string, () => Promise<unknown>> = {},
) {
  mockRequest.mockImplementation((method: string, path: string) => {
    if (method === 'GET') return Promise.resolve(current());
    const step = path.split('/').pop() ?? '';
    return steps[step] ? steps[step]() : Promise.resolve(undefined);
  });
}

async function mount() {
  await render(
    <ActiveRideProvider>
      <ActiveRideScreen />
      <Probe />
    </ActiveRideProvider>,
  );
  await waitFor(() => expect(mockRuntime.subscribe).toHaveBeenCalled());
}

describe('ActiveRideProvider (#15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    ctx = null;
  });

  it('open GETs the ride and the screen shows the pickup and the payment pill (expected)', async () => {
    apiAnswers(() => ride());
    await mount();

    await act(async () => ctx!.open(RIDE_ID));

    await screen.findByText(
      t('driver.offer.pickup', { address: 'Brīvības iela 1' }),
    );
    expect(mockRequest).toHaveBeenCalledWith(
      'GET',
      `/rides/${RIDE_ID}`,
      expect.objectContaining({ schema: expect.anything() }),
    );
    expect(screen.getByTestId('ride-payment')).toHaveTextContent(
      t('driver.ride.payment', { method: t('driver.offer.payment_cash') }),
    );
    expect(screen.getByTestId('ride-step')).toHaveTextContent(
      t('driver.ride.step_arriving'),
    );
  });

  it('every socket `connect` re-fires the GET — the room re-join (edge, C1)', async () => {
    apiAnswers(() => ride());
    await mount();
    const { handlers, socket } = makeSocket();
    await act(async () => {
      for (const listener of mockListeners) {
        listener.onSocket?.(
          socket as unknown as Parameters<
            NonNullable<RuntimeListener['onSocket']>
          >[0],
        );
      }
    });
    await act(async () => ctx!.open(RIDE_ID));
    await screen.findByTestId('ride-step');
    const gets = () =>
      mockRequest.mock.calls.filter(([m]: [string]) => m === 'GET').length;
    expect(gets()).toBe(1);

    await act(async () => handlers['connect']!());

    await waitFor(() => expect(gets()).toBe(2));
  });

  it('a 409 on a step shows the api`s code as a banner, keeps the status, and re-reads (failure)', async () => {
    apiAnswers(() => ride(), {
      arriving: () => Promise.reject(new ApiError(409, 'ride_not_accepted')),
    });
    await mount();
    await act(async () => ctx!.open(RIDE_ID));
    await screen.findByTestId('ride-step');

    await fireEvent.press(screen.getByTestId('ride-step'));

    await screen.findByTestId('ride-error');
    expect(
      within(screen.getByTestId('ride-error')).getByText(
        t('driver.error.ride_not_accepted'),
      ),
    ).toBeTruthy();
    expect(screen.getByTestId('status')).toHaveTextContent('accepted');
    // The reconcile read followed the 409.
    expect(
      mockRequest.mock.calls.filter(([m]: [string]) => m === 'GET').length,
    ).toBe(2);
  });

  it('complete renders the receipt from the split the api returned (expected)', async () => {
    const settled = ride({
      status: 'completed',
      split: splitFare(1240, { pct: 15, source: 'platform_base' }),
    });
    apiAnswers(() => ride({ status: 'in_progress' }), {
      complete: () => Promise.resolve({ ride: settled }),
    });
    await mount();
    await act(async () => ctx!.open(RIDE_ID));
    await screen.findByTestId('ride-step');
    expect(screen.getByTestId('ride-step')).toHaveTextContent(
      t('driver.ride.step_complete'),
    );

    await fireEvent.press(screen.getByTestId('ride-step'));

    await screen.findByTestId('receipt');
    expect(screen.getByTestId('receipt-paid')).toHaveTextContent(/€12\.40/);
    expect(screen.getByTestId('receipt-commission')).toHaveTextContent(
      /€1\.86/,
    );
    expect(screen.getByTestId('receipt-net')).toHaveTextContent(/€10\.54/);
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      `/rides/${RIDE_ID}/complete`,
      expect.objectContaining({ schema: expect.anything() }),
    );
  });

  it('a socket ride:status for the open ride is parsed and applied; a release ends it (edge)', async () => {
    apiAnswers(() => ride({ status: 'arriving' }));
    await mount();
    const { handlers, socket } = makeSocket();
    await act(async () => {
      for (const listener of mockListeners) {
        listener.onSocket?.(
          socket as unknown as Parameters<
            NonNullable<RuntimeListener['onSocket']>
          >[0],
        );
      }
    });
    await act(async () => ctx!.open(RIDE_ID));
    await screen.findByTestId('ride-step');

    await act(async () =>
      handlers['ride:status']!({
        rideId: RIDE_ID,
        orderId: '11111111-2222-4333-8444-555555555555',
        status: 'requested',
        previousStatus: 'arriving',
        reason: null,
        at: '2026-09-04T10:05:00.000Z',
      }),
    );

    await screen.findByTestId('ended-banner');
    expect(screen.getByTestId('ended-banner')).toHaveTextContent(
      t('driver.ride.released'),
    );
    expect(screen.queryByTestId('ride-step')).toBeNull();
  });
});
