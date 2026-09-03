import {
  render,
  screen,
  userEvent,
  waitFor,
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

    // No blocking error: the pickup row reads "Kurp?" and is tappable.
    const pickup = await screen.findByTestId('pickup-row');
    expect(pickup).toBeTruthy();
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
