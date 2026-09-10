import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { formatMessage, splitFare, type RideOfferEvent } from '@taxi/shared';
import { ApiError } from '@/features/auth';
import type { RuntimeListener } from '@/features/location';
import { OfferScreen } from './offer-screen';
import {
  OffersProvider,
  useOffers,
  type OffersContextValue,
} from './use-offers';

/**
 * The EFFECT RUNNER and the socket wiring — `offer-state.test.ts` owns the
 * decisions. The socket is a handler map the runtime hands over, which pins
 * WIRING; delivery is proven by the api's integration specs and Level 4.
 */

const mockRequest = jest.fn();
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => ({
    state: { status: 'signedIn', session: { accessToken: 'token' } },
    api: { request: mockRequest },
    signOut: jest.fn(),
    onBeforeSignOut: () => () => undefined,
  }),
}));

const mockOpen = jest.fn();
// PARTIAL, not a replacement: the card's payment pill goes through the real
// `paymentMethodLabel` (F14 — it lives in active-ride now), so only the hook
// that hands the ride over is faked. Same shape `earnings-screen.test.tsx`
// uses for this module.
jest.mock('@/features/active-ride', () => ({
  ...jest.requireActual<typeof import('@/features/active-ride')>(
    '@/features/active-ride',
  ),
  useActiveRide: () => ({ open: mockOpen, state: {} }),
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

const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

/** A live wire offer: sent just now, expiring in `windowMs`. */
const wire = (
  windowMs = 20_000,
  over: Partial<RideOfferEvent> = {},
): RideOfferEvent => {
  const sentAt = Date.now() - 100;
  return {
    id: OFFER_ID,
    rideId: RIDE_ID,
    driverId: 'd0000000-0000-4000-8000-000000000001',
    status: 'pending',
    source: 'auto_match',
    sentAt: new Date(sentAt).toISOString(),
    expiresAt: new Date(sentAt + windowMs).toISOString(),
    etaSeconds: 240,
    pickup: {
      location: { lat: 56.95, lng: 24.11 },
      address: 'Brīvības iela 1',
    },
    destination: { location: { lat: 56.97, lng: 24.18 }, address: 'Teika' },
    quote: {
      model: 'upfront_fixed',
      currency: 'EUR',
      totalCents: 1240,
      breakdown: {
        baseCents: 300,
        distanceCents: 640,
        timeCents: 300,
        discountCents: 0,
      },
    },
    split: splitFare(1240, { pct: 15, source: 'platform_base' }),
    paymentMethod: 'cash',
    ...over,
  };
};

type Handlers = Record<string, (payload: unknown) => void>;
function makeSocket() {
  const handlers: Handlers = {};
  return {
    handlers,
    socket: {
      on: jest.fn((event: string, handler: (payload: unknown) => void) => {
        handlers[event] = handler;
      }),
      off: jest.fn(),
    },
  };
}

let ctx: OffersContextValue | null = null;
function Probe() {
  const value = useOffers();
  useEffect(() => {
    ctx = value;
  });
  return (
    <>
      <Text testID="phase">{value.state.phase}</Text>
      <Text testID="offer-banner-kind">{value.state.banner ?? ''}</Text>
    </>
  );
}

const player = jest
  .requireMock<{ useAudioPlayer: () => { play: jest.Mock; pause: jest.Mock } }>(
    'expo-audio',
  )
  .useAudioPlayer();
const router = jest
  .requireMock<{
    useRouter: () => { navigate: jest.Mock; replace: jest.Mock };
  }>('expo-router')
  .useRouter();

async function mountWithSocket() {
  const { handlers, socket } = makeSocket();
  await render(
    <OffersProvider>
      <OfferScreen />
      <Probe />
    </OffersProvider>,
  );
  await waitFor(() => expect(mockRuntime.subscribe).toHaveBeenCalled());
  // Presence hands the socket over BEFORE `connect()`; every listener sees it.
  await act(async () => {
    for (const listener of mockListeners) {
      listener.onSocket?.(
        socket as unknown as Parameters<
          NonNullable<RuntimeListener['onSocket']>
        >[0],
      );
    }
  });
  return handlers;
}

describe('OffersProvider (#15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    ctx = null;
  });

  it('an offer emitted on the socket the runtime handed over renders the card, alerts, and accept hands the ride over (expected)', async () => {
    const handlers = await mountWithSocket();
    expect(handlers['ride:offer']).toBeDefined();

    await act(async () => handlers['ride:offer']!(wire()));

    await screen.findByText(/€12\.40/);
    expect(screen.getByTestId('offer-keep')).toHaveTextContent(/€10\.54/);
    expect(player.play).toHaveBeenCalledTimes(1); // alert_start
    expect(router.navigate).toHaveBeenCalledWith('/offer'); // route_offer

    mockRequest.mockResolvedValueOnce({ rideId: RIDE_ID });
    await fireEvent.press(screen.getByTestId('offer-accept'));

    await waitFor(() => expect(mockOpen).toHaveBeenCalledWith(RIDE_ID, 'cash'));
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      `/dispatch/offers/${OFFER_ID}/accept`,
      expect.objectContaining({ schema: expect.anything() }),
    );
    expect(router.replace).toHaveBeenCalledWith('/active-ride');
    expect(player.pause).toHaveBeenCalled(); // alert_stop
    expect(screen.getByTestId('phase')).toHaveTextContent('idle');
  });

  it('an offer that expires clears itself and a later accept posts nothing (edge)', async () => {
    const handlers = await mountWithSocket();
    await act(async () => handlers['ride:offer']!(wire(400)));
    await screen.findByText(/€12\.40/);

    // The provider's 1 s clock runs it out; the sweeper owns the server side.
    await waitFor(
      () => expect(screen.getByTestId('phase')).toHaveTextContent('idle'),
      { timeout: 3_000 },
    );
    expect(screen.getByTestId('offer-banner-kind')).toHaveTextContent(
      'expired',
    );

    await act(async () => ctx!.accept());
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a 409 offer_not_pending on accept clears the card as «taken» without crashing (failure)', async () => {
    const handlers = await mountWithSocket();
    await act(async () => handlers['ride:offer']!(wire()));
    await screen.findByText(/€12\.40/);

    mockRequest.mockRejectedValueOnce(new ApiError(409, 'offer_not_pending'));
    await fireEvent.press(screen.getByTestId('offer-accept'));

    await waitFor(() =>
      expect(screen.getByTestId('offer-banner-kind')).toHaveTextContent(
        'taken',
      ),
    );
    expect(screen.queryByTestId('offer-accept')).toBeNull();
    expect(mockOpen).not.toHaveBeenCalled();
    // The home banner copy this kind maps to exists in the catalog.
    expect(t('driver.offer.revoked_taken')).toBeTruthy();
  });

  it('the push path with the same id after the socket is one card, one alert (edge)', async () => {
    const handlers = await mountWithSocket();
    await act(async () => handlers['ride:offer']!(wire()));
    await screen.findByText(/€12\.40/);

    await act(async () => ctx!.receive(wire(), 'push'));

    expect(screen.getAllByTestId('offer-accept')).toHaveLength(1);
    expect(player.play).toHaveBeenCalledTimes(1);
  });

  it('a revoke and a queue event reach the reducer parsed; junk is dropped with a warning (edge)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    const handlers = await mountWithSocket();
    await act(async () => handlers['ride:offer']!(wire()));
    await screen.findByText(/€12\.40/);

    await act(async () => handlers['driver:queue']!({ not: 'a queue event' }));
    expect(warn).toHaveBeenCalledWith(
      'driver:queue dropped',
      expect.any(String),
    );

    await act(async () =>
      handlers['ride:offer_revoked']!({
        offerId: OFFER_ID,
        rideId: RIDE_ID,
        reason: 'cancelled',
        at: new Date().toISOString(),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('offer-banner-kind')).toHaveTextContent(
        'cancelled',
      ),
    );
    warn.mockRestore();
  });
});
