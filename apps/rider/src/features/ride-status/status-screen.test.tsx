import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/features/auth';
import { StatusScreen } from './status-screen';

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

const mockStatus = {
  status: 'requested' as string | null,
  previousStatus: null,
  stillSearching: false,
  connected: true,
  joined: true,
};
jest.mock('./use-ride-status', () => ({
  useRideStatus: () => mockStatus,
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { replace } = router.useRouter();

const RIDE_ID = '2f1b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d';
const t = (
  key: Parameters<typeof formatMessage>[1],
  p?: Record<string, string>,
) => formatMessage('lv', key, p);

describe('StatusScreen', () => {
  let announce: jest.SpyInstance;
  let focusSpy: jest.SpyInstance;
  beforeEach(() => {
    mockRequest.mockReset();
    (replace as jest.Mock).mockReset();
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      rideId: RIDE_ID,
    });
    Object.assign(mockStatus, {
      status: 'requested',
      stillSearching: false,
      connected: true,
      joined: true,
    });
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

  it('speaks the status, moves focus to the header, and shows one header (expected — a11y 1, 6, 7)', async () => {
    await render(<StatusScreen />);

    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('status-line')).toBeTruthy();
    // A rider with the phone in their pocket must hear this without looking.
    expect(announce).toHaveBeenCalledWith(t('rider.status.searching'));
    // ONCE. A second effect announcing the same line under
    // `rider.a11y.status_changed` made every iOS transition speak twice.
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('says "still searching" and NEVER "no drivers" once the minute has passed (edge — E3)', async () => {
    Object.assign(mockStatus, { stillSearching: true });

    await render(<StatusScreen />);

    // `dispatch:unclaimed` goes to Dina's board, not the ride room, so the app
    // has no basis for claiming the search failed.
    expect(screen.getByText(t('rider.status.still_searching'))).toBeTruthy();
    expect(screen.queryByText(/nav atrast|no drivers/i)).toBeNull();
    // The fifth announce trigger in the spec (property 6): the message is
    // useless to a rider who is not looking at the screen unless it is spoken.
    expect(announce).toHaveBeenCalledWith(t('rider.status.still_searching'));
  });

  it('reads a matched ride as matched, whatever the status past requested (edge)', async () => {
    Object.assign(mockStatus, { status: 'accepted' });
    await render(<StatusScreen />);
    expect(screen.getByText(t('rider.status.matched'))).toBeTruthy();
  });

  it('shows a reconnecting line while the socket is down (edge)', async () => {
    Object.assign(mockStatus, { connected: false, joined: false });
    await render(<StatusScreen />);
    expect(screen.getByText(t('rider.status.reconnecting'))).toBeTruthy();
  });

  it('shows it while CONNECTED but not joined to the ride room (failure)', async () => {
    // The join is a separate request from the handshake, so a socket can be up
    // and hear nothing. Reporting the transport alone is what let this screen
    // reassure a rider it was live while no event could reach it.
    Object.assign(mockStatus, { connected: true, joined: false });
    await render(<StatusScreen />);
    expect(screen.getByText(t('rider.status.reconnecting'))).toBeTruthy();
  });

  it('cancels with a null reason and returns to booking (expected)', async () => {
    mockRequest.mockResolvedValue(undefined);
    await render(<StatusScreen />);

    await userEvent.press(
      screen.getByRole('button', { name: t('rider.status.cancel') }),
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/book'));
    // The ACTOR comes from the JWT role; the body carries only the reason.
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      `/rides/${RIDE_ID}/cancel`,
      expect.objectContaining({ body: { reason: null } }),
    );
  });

  it('stays put and says why when the cancel is refused (failure)', async () => {
    mockRequest.mockRejectedValue(new ApiError(409, 'ride_not_cancellable'));
    await render(<StatusScreen />);

    await userEvent.press(
      screen.getByRole('button', { name: t('rider.status.cancel') }),
    );

    // An unmapped code renders `generic`, never the raw code.
    await screen.findByText(t('rider.error.generic'));
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([
    'cancelled_by_driver',
    'cancelled_by_dispatcher',
    'completed',
    'settled',
  ])(
    'offers a way out of a %s ride instead of a cancel that 409s (failure — M6)',
    async (status) => {
      Object.assign(mockStatus, { status });
      await render(<StatusScreen />);

      // `/book/status` is reached by `router.replace`, so there is no back
      // entry — the cancel button was the ONLY control, and on a finished ride
      // its only possible outcome is a 409.
      expect(
        screen.queryByRole('button', { name: t('rider.status.cancel') }),
      ).toBeNull();

      await userEvent.press(
        screen.getByRole('button', { name: t('rider.status.book_again') }),
      );
      await waitFor(() => expect(replace).toHaveBeenCalledWith('/book'));
      expect(mockRequest).not.toHaveBeenCalled();
    },
  );

  it('does not call a completed ride "a car has been found" (edge — M6)', async () => {
    Object.assign(mockStatus, { status: 'completed' });
    await render(<StatusScreen />);

    expect(screen.getByText(t('rider.status.completed'))).toBeTruthy();
    expect(screen.queryByText(t('rider.status.matched'))).toBeNull();
  });
});
