import {
  act,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import * as Location from 'expo-location';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/features/auth';
import { SavedPlacesProvider, clearSavedPlaces } from '@/features/places';
import { BookingScreen } from './booking-screen';

const mockRequest = jest.fn();
const mockSessionContext = {
  state: { status: 'signedOut', session: null },
  api: { request: mockRequest },
  signIn: jest.fn(),
  signOut: jest.fn(),
  onBeforeSignOut: jest.fn(() => jest.fn()),
};
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => mockSessionContext,
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { push, replace } = router.useRouter();

const QUOTE = {
  model: 'upfront_fixed',
  currency: 'EUR',
  totalCents: 840,
  breakdown: {
    baseCents: 200,
    distanceCents: 540,
    timeCents: 100,
    discountCents: 0,
  },
};

const t = (
  key: Parameters<typeof formatMessage>[1],
  p?: Record<string, string | number>,
) => formatMessage('lv', key, p);

const renderScreen = () =>
  render(
    <SavedPlacesProvider>
      <BookingScreen />
    </SavedPlacesProvider>,
  );

/** The dropoff, as the search sheet hands it back — route params are strings. */
const dropoffParams = {
  field: 'dropoff',
  address: 'Lidosta RIX',
  lat: '56.9236',
  lng: '23.9711',
  placeId: 'place-1',
};

describe('BookingScreen', () => {
  let announce: jest.SpyInstance;
  /** Held and restored per TEST — see the note in `verify-screen.test.tsx`. */
  let focusSpy: jest.SpyInstance;
  beforeEach(async () => {
    await clearSavedPlaces();
    mockRequest.mockReset();
    (push as jest.Mock).mockReset();
    (replace as jest.Mock).mockReset();
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({});
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
      { status: 'granted' },
    );
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
    focusSpy = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation();
  });
  afterEach(() => {
    announce.mockRestore();
    focusSpy.mockRestore();
  });

  it('fills the pickup from GPS, quotes on the dropoff, and books (expected)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest
      .mockResolvedValueOnce({ quote: QUOTE })
      .mockResolvedValueOnce({ ride: { id: 'ride-1' }, split: {} });

    await renderScreen();

    // Reverse-geocoded street line, not coordinates, and not a map pin.
    await screen.findByLabelText(/Brīvības iela 45/);
    await screen.findByTestId('quote-card');

    const bookButton = screen.getByRole('button', {
      name: t('rider.book.confirm'),
    });
    expect(bookButton).toBeEnabled();
    await userEvent.press(bookButton);

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith({
        pathname: '/book/status',
        params: { rideId: 'ride-1' },
      }),
    );
    expect(announce).toHaveBeenCalledWith(t('rider.a11y.ride_requested'));
  });

  it('completes with location permission REFUSED — pickup is typed instead (edge — E11, D7)', async () => {
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
      { status: 'denied' },
    );
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest.mockResolvedValue({ quote: QUOTE });

    await renderScreen();

    // No blocking error: the pickup row prompts for an address and is tappable.
    const pickup = await screen.findByTestId('pickup-row');
    expect(pickup).toBeTruthy();

    // Its own empty copy, not the dropoff's — see the both-rows-empty case
    // below for why that matters.
    expect(screen.getByText(t('rider.book.pickup_empty'))).toBeTruthy();
    await userEvent.press(pickup);
    expect(push).toHaveBeenCalledWith({
      pathname: '/book/address',
      params: { field: 'pickup' },
    });
    // And with no pickup there is nothing to quote yet.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('keeps Book disabled until there is a live quote (edge)', async () => {
    await renderScreen();
    await screen.findByLabelText(/Brīvības iela 45/);

    // A pickup alone is not a corridor, so no quote and nothing to agree to.
    expect(
      screen.getByRole('button', { name: t('rider.book.confirm') }),
    ).toBeDisabled();
    expect(screen.queryByTestId('quote-card')).toBeNull();
  });

  it('shows the failure and refuses to book when the quote fails (failure — E2)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest.mockRejectedValue(new Error('maps down'));

    await renderScreen();

    await screen.findByText(t('rider.error.generic'));
    expect(
      screen.getByRole('button', { name: t('rider.book.confirm') }),
    ).toBeDisabled();
  });

  it('names the CAUSE, so offline does not read as a generic failure (failure — E6, the /book Offline state)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest.mockRejectedValue(new ApiError(0, 'offline'));

    await renderScreen();

    // Rendering the announce string here would collapse a 429, a maps outage
    // and a dead network into one sentence — and make this state unreachable.
    await screen.findByText(t('rider.error.offline'));
    expect(screen.queryByText(t('rider.error.generic'))).toBeNull();
  });

  it('gives the two empty rows different copy when BOTH are empty (edge — M7)', async () => {
    // Location refused and no destination yet: the E11 path, one step earlier.
    // This is the only state in which the two empty rows are on screen
    // together, and the one the shared `rider.book.where_to` broke — a screen
    // reader read «Kurp?» twice, told apart only by a trailing role word.
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue(
      { status: 'denied' },
    );
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({});

    await renderScreen();

    const pickup = await screen.findByTestId('pickup-row');
    const dropoff = screen.getByTestId('dropoff-row');
    expect(within(pickup).getByText(t('rider.book.pickup_empty'))).toBeTruthy();
    expect(within(dropoff).getByText(t('rider.book.where_to'))).toBeTruthy();
    expect(t('rider.book.pickup_empty')).not.toBe(t('rider.book.where_to'));
  });

  it('lets a LATE GPS fix land on a pickup the rider chose, and ignores it (failure — H2)', async () => {
    // Held open, so the fix arrives after the rider has already chosen — the
    // real window, which is unbounded in the app: `/book` is PUSHED OVER rather
    // than unmounted while the search sheet is up, so the mount effect's
    // `cancelled` flag never fires.
    let arrive: (fix: unknown) => void = () => undefined;
    (Location.getCurrentPositionAsync as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        arrive = resolve;
      }),
    );
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      field: 'pickup',
      address: 'Stacijas laukums 1',
      lat: '56.9469',
      lng: '24.1206',
    });

    await renderScreen();
    await screen.findByText('Stacijas laukums 1');

    await act(async () => {
      arrive({ coords: { latitude: 56.9496, longitude: 24.1052 } });
    });

    // The device's position must not silently replace an address the rider
    // typed — which would also discard the quote, mint a new key and re-quote
    // a corridor they never chose.
    await waitFor(() =>
      expect(screen.queryByText(/Brīvības iela 45/)).toBeNull(),
    );
    expect(screen.getByText('Stacijas laukums 1')).toBeTruthy();
  });

  it('offers a way OUT of a failed quote, on the same key (failure — H1)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest
      .mockRejectedValueOnce(new ApiError(0, 'offline'))
      .mockResolvedValueOnce({ quote: QUOTE });

    await renderScreen();
    await screen.findByText(t('rider.error.offline'));

    // Re-picking the SAME address cannot rescue this: the route params are
    // byte-identical, so the effect never re-runs and nothing is dispatched.
    // The banner's own action is the only escape that does not require
    // choosing a different destination or killing the app.
    await userEvent.press(
      screen.getByRole('button', { name: t('rider.book.retry') }),
    );

    await screen.findByTestId('quote-card');
    expect(
      screen.getByRole('button', { name: t('rider.book.confirm') }),
    ).toBeEnabled();
  });

  it('names a throttle as a throttle (failure — E4)', async () => {
    (router.useLocalSearchParams as jest.Mock).mockReturnValue(dropoffParams);
    mockRequest.mockRejectedValue(new ApiError(429, 'too_many_requests', 30));

    await renderScreen();

    await screen.findByText(t('rider.error.too_many_requests'));
  });

  it('has one header, moves focus to it, and offers no map anywhere (a11y — properties 1 and 9)', async () => {
    await renderScreen();

    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    // There is no pin to drag and no map to read — the whole point.
    expect(screen.queryByLabelText(/karte|map/i)).toBeNull();
  });
});
