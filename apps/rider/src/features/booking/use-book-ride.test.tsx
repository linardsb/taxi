import {
  render,
  screen,
  userEvent,
  waitFor,
} from '@testing-library/react-native';
import { IDEMPOTENCY_KEY_HEADER, formatMessage } from '@taxi/shared';
import { AccessibilityInfo, Pressable, Text } from 'react-native';
import { ApiError } from '@/features/auth';
import { initialDraft, type BookingDraft } from './booking-draft';
import { useBookRide } from './use-book-ride';

const mockRequest = jest.fn();
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => ({
    state: { status: 'signedOut', session: null },
    api: { request: mockRequest },
    signIn: jest.fn(),
    signOut: jest.fn(),
    onBeforeSignOut: jest.fn(),
  }),
}));

const point = (address: string) => ({
  location: { lat: 56.9496, lng: 24.1052 },
  address,
});

const DRAFT: BookingDraft = {
  ...initialDraft('11111111-1111-4111-8111-111111111111'),
  pickup: point('Brīvības 1'),
  dropoff: point('Lidosta RIX'),
};

const RIDE = { ride: { id: 'ride-1' }, split: {} };

let lastRideId: string | null | undefined;

function Harness({ draft = DRAFT }: { draft?: BookingDraft }) {
  const { book, busy, error } = useBookRide(draft);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="book"
        onPress={() => void book().then((id) => (lastRideId = id))}
      >
        <Text>{busy ? 'busy' : 'idle'}</Text>
      </Pressable>
      <Text>{error === null ? 'no-error' : formatMessage('lv', error)}</Text>
    </>
  );
}

describe('useBookRide', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    mockRequest.mockReset();
    lastRideId = undefined;
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  it("books with the draft's key and announces it (expected)", async () => {
    mockRequest.mockResolvedValue(RIDE);
    await render(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'book' }));

    await waitFor(() => expect(lastRideId).toBe('ride-1'));
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      '/rides',
      expect.objectContaining({
        headers: { [IDEMPOTENCY_KEY_HEADER]: DRAFT.idempotencyKey },
        body: {
          pickup: DRAFT.pickup,
          destination: DRAFT.dropoff,
          paymentMethod: 'cash',
        },
      }),
    );
    expect(announce).toHaveBeenCalledWith(
      formatMessage('lv', 'rider.a11y.ride_requested'),
    );
  });

  it('retries a 409 with the SAME key and resolves to the ride (edge — E5)', async () => {
    mockRequest
      .mockRejectedValueOnce(
        new ApiError(409, 'idempotent_request_in_progress'),
      )
      .mockResolvedValueOnce(RIDE);
    await render(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'book' }));

    await waitFor(() => expect(lastRideId).toBe('ride-1'));
    expect(mockRequest).toHaveBeenCalledTimes(2);
    // Minting a new key would book a SECOND car — the exact failure
    // `RIDE_IDEMPOTENCY_PENDING` exists to prevent.
    const keys = mockRequest.mock.calls.map(
      (c) =>
        (c[2] as { headers: Record<string, string> }).headers[
          IDEMPOTENCY_KEY_HEADER
        ],
    );
    expect(keys).toEqual([DRAFT.idempotencyKey, DRAFT.idempotencyKey]);
  });

  it('stops after one automatic retry rather than looping against a booking route (edge)', async () => {
    mockRequest.mockRejectedValue(
      new ApiError(409, 'idempotent_request_in_progress'),
    );
    await render(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'book' }));

    await waitFor(() => expect(lastRideId).toBeNull());
    expect(mockRequest).toHaveBeenCalledTimes(2);
    await screen.findByText(
      formatMessage('lv', 'rider.error.idempotent_request_in_progress'),
    );
  });

  it('reports offline and keeps the key so the same tap can be retried (failure — E6)', async () => {
    mockRequest.mockRejectedValue(new ApiError(0, 'offline'));
    await render(<Harness />);

    await userEvent.press(screen.getByRole('button', { name: 'book' }));

    await screen.findByText(formatMessage('lv', 'rider.error.offline'));
    expect(lastRideId).toBeNull();
    // No automatic retry on a network failure, and no new key: the draft still
    // holds the one this attempt used.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(DRAFT.idempotencyKey).toBe('11111111-1111-4111-8111-111111111111');
  });
});
