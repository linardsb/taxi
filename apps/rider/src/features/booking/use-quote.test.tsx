import { render, screen, waitFor } from '@testing-library/react-native';
import { useEffect } from 'react';
import { formatMessage, type AddressPoint } from '@taxi/shared';
import { AccessibilityInfo, Text } from 'react-native';
import { ApiError } from '@/features/auth';
import { initialDraft, type BookingDraft } from './booking-draft';
import { useBookingDraft } from './use-booking-draft';
import { useQuote } from './use-quote';

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

const point = (address: string): AddressPoint => ({
  location: { lat: 56.9496, lng: 24.1052 },
  address,
});

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

let seen: BookingDraft = initialDraft('key-0');

function Harness() {
  const { draft, dispatch } = useBookingDraft(() => 'key-1');
  useQuote(draft, dispatch);
  // Through an effect, never a render-time write — the same rule the driver's
  // `use-session.test.tsx` probe follows.
  useEffect(() => {
    seen = draft;
  }, [draft]);
  return <Text>{draft.quoteState}</Text>;
}

/** Both ends set before the hook can fire, so the effect sees a complete draft. */
function Filled() {
  const { draft, dispatch } = useBookingDraft(() => 'key-1');
  useQuote(draft, dispatch);
  useEffect(() => {
    seen = draft;
  }, [draft]);
  useEffect(() => {
    dispatch({ type: 'setPickup', point: point('Brīvības 1') });
    dispatch({
      type: 'setDropoff',
      point: point('Lidosta RIX'),
      placeId: null,
    });
  }, [dispatch]);
  return <Text>{draft.quoteState}</Text>;
}

const t = (
  key: Parameters<typeof formatMessage>[1],
  p?: Record<string, string>,
) => formatMessage('lv', key, p);

describe('useQuote', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    mockRequest.mockReset();
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });
  afterEach(() => announce.mockRestore());

  it('does not quote until BOTH ends are known (edge)', async () => {
    await render(<Harness />);

    expect(mockRequest).not.toHaveBeenCalled();
    expect(screen.getByText('idle')).toBeTruthy();
  });

  it('quotes as soon as both ends are known and announces the total (expected)', async () => {
    mockRequest.mockResolvedValue({ quote: QUOTE });

    await render(<Filled />);

    await waitFor(() => expect(seen.quoteState).toBe('ready'));
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      '/rides/quote',
      expect.objectContaining({
        body: {
          pickup: point('Brīvības 1'),
          destination: point('Lidosta RIX'),
        },
      }),
    );
    // The quote arriving is the one change on this screen the rider did not
    // touch anything to cause, so it has to be spoken.
    expect(announce).toHaveBeenCalledWith(
      t('rider.a11y.quote_arrived', { total: '€8.40' }),
    );
    expect(seen.quote).toEqual(QUOTE);
  });

  it('never sends a paymentMethod — the fare must not depend on how you pay (edge)', async () => {
    mockRequest.mockResolvedValue({ quote: QUOTE });

    await render(<Filled />);

    await waitFor(() => expect(mockRequest).toHaveBeenCalled());
    const body = mockRequest.mock.calls[0]![2].body as Record<string, unknown>;
    expect(body).not.toHaveProperty('paymentMethod');
  });

  it('surfaces a 429 as a failed quote and announces it, without retrying (failure — E2, E4)', async () => {
    mockRequest.mockRejectedValue(new ApiError(429, 'too_many_requests', 30));

    await render(<Filled />);

    await waitFor(() => expect(seen.quoteState).toBe('failed'));
    expect(seen.quoteErrorCode).toBe('too_many_requests');
    expect(seen.quote).toBeNull();
    expect(announce).toHaveBeenCalledWith(t('rider.a11y.quote_failed'));
    // Retrying is what produced the throttle, and the cap it hit is a money
    // control — one request, no automatic second.
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
