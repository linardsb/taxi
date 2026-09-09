import { fireEvent, render, screen } from '@testing-library/react-native';
import { formatMessage, splitFare, type Ride } from '@taxi/shared';
import {
  initialActiveRide,
  type ActiveRideState,
} from '@/features/active-ride';
import { EarningsScreen } from './earnings-screen';

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

let mockEarningsStatus: 'loading' | 'ready' | 'error' = 'ready';
jest.mock('@/features/availability', () => ({
  useEarnings: () => ({
    earnings:
      mockEarningsStatus === 'ready'
        ? {
            day: '2026-09-04',
            timezone: 'Europe/Riga',
            earnedCents: 8420,
            rideCount: 7,
          }
        : null,
    status: mockEarningsStatus,
    refresh: jest.fn(),
  }),
}));

let mockRide: ActiveRideState = initialActiveRide;
jest.mock('@/features/active-ride', () => ({
  ...jest.requireActual<typeof import('@/features/active-ride')>(
    '@/features/active-ride',
  ),
  useActiveRide: () => ({
    state: mockRide,
    open: jest.fn(),
    step: jest.fn(),
    reload: jest.fn(),
    dismissNotice: jest.fn(),
    dismiss: jest.fn(),
  }),
}));

const completedRide = {
  id: '3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c',
  paymentMethod: 'card',
  split: splitFare(1240, { pct: 15, source: 'platform_base' }),
} as unknown as Ride;

describe('EarningsScreen (#15)', () => {
  beforeEach(() => {
    mockEarningsStatus = 'ready';
    mockRide = initialActiveRide;
  });

  it('renders the day total to the cent, NET of commission, and the empty receipt state (expected)', async () => {
    await render(<EarningsScreen />);
    expect(screen.getByTestId('earnings-today')).toHaveTextContent(
      t('driver.earnings.today', { amount: '€84.20', rides: 7 }),
    );
    expect(screen.getByTestId('earnings-empty')).toHaveTextContent(
      t('driver.earnings.none_yet'),
    );
    expect(screen.queryByTestId('receipt')).toBeNull();
  });

  it('shows the receipt of the ride just completed, from its persisted split (expected)', async () => {
    mockRide = {
      ...initialActiveRide,
      rideId: completedRide.id,
      ended: { kind: 'completed', ride: completedRide },
    };
    await render(<EarningsScreen />);
    expect(screen.getByTestId('receipt-net')).toHaveTextContent(
      t('driver.earnings.receipt_net', { amount: '€10.54' }),
    );
    expect(screen.getByTestId('receipt-method')).toHaveTextContent(
      t('driver.ride.payment', { method: t('driver.offer.payment_card') }),
    );
    expect(screen.queryByTestId('earnings-empty')).toBeNull();
  });

  it('a failed total is a dash, never a crash, and the back button pops (failure)', async () => {
    mockEarningsStatus = 'error';
    await render(<EarningsScreen />);
    expect(screen.getByTestId('earnings-today')).toHaveTextContent('—');
    await fireEvent.press(screen.getByTestId('earnings-back'));
    const router = jest
      .requireMock<{ useRouter: () => { back: jest.Mock } }>('expo-router')
      .useRouter();
    expect(router.back).toHaveBeenCalled();
  });
});
