import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { useEffect, type ReactNode } from 'react';
import { Text } from 'react-native';
import {
  formatMessage,
  offerPushDataSchema,
  splitFare,
  type RideOfferEvent,
} from '@taxi/shared';
import type { RuntimeListener } from '@/features/location';
import {
  OfferScreen,
  OffersProvider,
  useOffers,
  type OffersContextValue,
} from '@/features/offers';
import { PushRegistrar } from './push-registrar';

/**
 * Where a notification TAP sends the app (#15, F17). The reducer's own
 * dedupe lives in `offer-state.test.ts`; what this file pins is the other
 * half of it — that a tap on a tray entry the card no longer exists for does
 * not move the driver, and that the ids-only push still does.
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
// PARTIAL, not a replacement: this file imports the `@/features/offers`
// barrel, which loads `offer-card-props.ts` → the real `paymentMethodLabel`
// and `pctLabel` (F14 — they live in active-ride now). A full replacement
// leaves both `undefined` for anything here that draws the card. Same shape
// `use-offers.test.tsx` and `earnings/earnings-screen.test.tsx` carry.
jest.mock('@/features/active-ride', () => ({
  ...jest.requireActual<typeof import('@/features/active-ride')>(
    '@/features/active-ride',
  ),
  useActiveRide: () => ({ open: mockOpen, state: {} }),
}));

const mockListeners: RuntimeListener[] = [];
jest.mock('@/features/location', () => ({
  getLocationRuntime: () => ({
    subscribe: (listener: RuntimeListener) => {
      mockListeners.push(listener);
      return () => undefined;
    },
  }),
}));

const OFFER_ID = '7c6b5a49-3827-4160-9504-3f2e1d0c9b8a';
const RIDE_ID = '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c';

const wire = (): RideOfferEvent => {
  const sentAt = Date.now() - 100;
  return {
    id: OFFER_ID,
    rideId: RIDE_ID,
    driverId: 'd0000000-0000-4000-8000-000000000001',
    status: 'pending',
    source: 'auto_match',
    sentAt: new Date(sentAt).toISOString(),
    expiresAt: new Date(sentAt + 20_000).toISOString(),
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
  };
};

const router = jest
  .requireMock<{
    useRouter: () => { navigate: jest.Mock; replace: jest.Mock };
  }>('expo-router')
  .useRouter();

let ctx: OffersContextValue | null = null;
function Probe() {
  const value = useOffers();
  useEffect(() => {
    ctx = value;
  });
  return <Text testID="phase">{value.state.phase}</Text>;
}

/** The tap listener `installNotificationHandling` registers with Expo. */
type TapListener = Parameters<
  typeof Notifications.addNotificationResponseReceivedListener
>[0];
let tap: TapListener | null = null;

async function mount(extra?: ReactNode) {
  await render(
    <OffersProvider>
      <PushRegistrar />
      <Probe />
      {extra}
    </OffersProvider>,
  );
  await waitFor(() => expect(tap).not.toBeNull());
}

/** A tray tap carrying `data` — through the real `routeNotification`. */
async function tapWith(data: unknown) {
  await act(async () => {
    tap?.({
      notification: { request: { content: { data } } },
    } as unknown as Notifications.NotificationResponse);
  });
}

describe('PushRegistrar tap routing (#15)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.length = 0;
    ctx = null;
    tap = null;
    mockRequest.mockResolvedValue(undefined);
    jest
      .mocked(Notifications.addNotificationResponseReceivedListener)
      .mockImplementation((listener) => {
        tap = listener;
        return {
          remove: jest.fn(),
        } as unknown as Notifications.EventSubscription;
      });
  });

  it('a tap for an offer already answered does not move the driver (failure)', async () => {
    await mount();
    await act(async () => ctx!.receive(wire(), 'socket'));
    await act(async () => ctx!.decline());
    await waitFor(() => expect(ctx!.state.phase).toBe('idle'));
    router.navigate.mockClear();
    router.replace.mockClear();

    // The tray entry for a card answered in-app is never dismissed. Before
    // F17 this navigated to `/offer`, which found no card and redirected to
    // `/home` — off the active ride, with no affordance back.
    await tapWith(
      offerPushDataSchema.parse({
        kind: 'offer',
        offerId: OFFER_ID,
        rideId: RIDE_ID,
        offer: JSON.stringify(wire()),
      }),
    );

    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(ctx!.state.phase).toBe('idle');
  });

  it('an ids-only tap still opens the card the socket delivered (expected)', async () => {
    await mount();
    await act(async () => ctx!.receive(wire(), 'socket'));
    router.navigate.mockClear();

    // The size-dropped push carries no `offer`, so nothing is received here —
    // the card is already pending and the tap must still reach it. This is
    // what a gate on `route.offer` rather than on the card would break.
    await tapWith({ kind: 'offer', offerId: OFFER_ID, rideId: RIDE_ID });

    expect(router.navigate).toHaveBeenCalledWith('/offer');
  });

  it('a tap on any other notification goes to the gate (edge)', async () => {
    await mount();
    await tapWith({ kind: 'offline_nudge' });

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  // The guard on this file's `@/features/active-ride` mock (PR #163, L1).
  // Nothing else here draws the card, so a full replacement of that module
  // sat harmless until someone rendered `OfferScreen` — and then failed in a
  // module the test never names. This renders it, so the mock cannot regress
  // silently: both `paymentMethodLabel` (the pill) and `pctLabel` (the
  // you-keep line) resolve through the barrel below.
  it('the card the tap lands on draws through the real active-ride labels (edge)', async () => {
    await mount(<OfferScreen />);
    await act(async () => ctx!.receive(wire(), 'socket'));
    await tapWith({ kind: 'offer', offerId: OFFER_ID, rideId: RIDE_ID });

    expect(router.navigate).toHaveBeenCalledWith('/offer');
    expect(screen.getByTestId('offer-payment')).toHaveTextContent(
      formatMessage('lv', 'driver.offer.payment_cash'),
    );
    // `splitFare(1240, 15%)` nets 1054 cents and keeps 85 — `pctLabel(85)`.
    expect(screen.getByTestId('offer-keep')).toHaveTextContent(
      formatMessage('lv', 'driver.offer.you_keep', {
        amount: '€10.54',
        pct: '85',
      }),
    );
  });
});
