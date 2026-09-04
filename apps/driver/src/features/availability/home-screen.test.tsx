import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { HomeScreen } from './home-screen';
import { initialPresence, type PresenceState } from './presence-state';

const mockToggle = jest.fn();
let mockPresence: PresenceState = initialPresence;
jest.mock('./use-presence', () => ({
  usePresence: () => ({
    state: mockPresence,
    nowMs: 1_800_000_000_000,
    toggle: mockToggle,
    dismissBanner: jest.fn(),
    batteryPrompt: jest.fn(),
  }),
}));

let mockEarningsStatus: 'loading' | 'ready' | 'error' = 'ready';
jest.mock('./use-earnings', () => ({
  useEarnings: () => ({
    earnings:
      mockEarningsStatus === 'ready'
        ? {
            day: '2026-08-31',
            timezone: 'Europe/Riga',
            earnedCents: 8420,
            rideCount: 7,
          }
        : null,
    status: mockEarningsStatus,
    refresh: jest.fn(),
  }),
}));

jest.mock('@/features/onboarding', () => ({
  useMe: () => ({
    me: { profile: {}, vehicles: [{ id: 'v1', plate: 'AB-1234' }] },
    status: 'ready',
  }),
}));

const mockSignOut = jest.fn();
jest.mock('@/features/auth', () => ({
  useSession: () => ({ signOut: mockSignOut, api: { request: jest.fn() } }),
  ApiError: class extends Error {},
}));

// The offers slice's provider is replaced by a controllable value; its VIEWS
// (`QueuePosition`, `offerBannerFor`) stay real, so what home renders is what
// ships (#15).
let mockOffers: import('@/features/offers').OfferState = {
  phase: 'idle',
  pending: null,
  remainingMs: 0,
  banner: null,
  errorCode: null,
  speedMps: null,
  queue: null,
};
const mockDismissOffer = jest.fn();
jest.mock('@/features/offers', () => ({
  ...jest.requireActual<typeof import('@/features/offers')>(
    '@/features/offers',
  ),
  useOffers: () => ({
    state: mockOffers,
    latest: null,
    accept: jest.fn(),
    decline: jest.fn(),
    dismissBanner: mockDismissOffer,
    receive: jest.fn(),
  }),
}));

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

describe('HomeScreen', () => {
  beforeEach(() => {
    mockToggle.mockReset();
    mockDismissOffer.mockReset();
    mockPresence = initialPresence;
    mockEarningsStatus = 'ready';
    mockOffers = { ...mockOffers, banner: null, errorCode: null, queue: null };
  });

  it('renders the LV catalog copy and the toggle dispatches (expected)', async () => {
    await render(<HomeScreen />);

    expect(screen.getByText(t('driver.home.status_offline'))).toBeTruthy();
    expect(
      screen.getByText(t('driver.home.today', { amount: '€84.20', rides: 7 })),
    ).toBeTruthy();
    expect(
      screen.getByText(t('driver.home.vehicle', { plate: 'AB-1234' })),
    ).toBeTruthy();

    const switchEl = screen.getByRole('switch', {
      name: t('driver.home.go_online'),
    });
    expect(switchEl).not.toBeChecked();
    await fireEvent.press(switchEl);
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it("shows the marked-offline banner with the server's time, and its button dispatches too (edge)", async () => {
    mockPresence = {
      ...initialPresence,
      banner: { kind: 'marked_offline', at: '2026-08-31T09:05:00.000Z' },
    };
    await render(<HomeScreen />);

    const at = new Date('2026-08-31T09:05:00.000Z');
    const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(
      screen.getByText(t('driver.home.marked_offline', { time: hhmm })),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.home.go_online') }),
    );
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('renders the ride-scoped banner with no way to dismiss it — the reducer is its only exit (edge — review F1)', async () => {
    mockPresence = {
      ...initialPresence,
      intent: 'online',
      server: 'online',
      streaming: true,
      banner: { kind: 'driver_on_ride' },
    };
    await render(<HomeScreen />);

    expect(screen.getByTestId('banner')).toHaveTextContent(
      t('driver.error.driver_on_ride'),
    );
    // No action and no secondary: `banner_dismissed` has no UI route from
    // this kind, so `server_offline` clearing it is the only way out. Scoped
    // to the banner and label-agnostic — an `action` renders a button under a
    // different label, which a name-matched query misses (review R5).
    expect(
      within(screen.getByTestId('banner')).queryAllByRole('button'),
    ).toHaveLength(0);
    // The toggle stays ON — the tap cost a banner and nothing else.
    expect(
      screen.getByRole('switch', { name: t('driver.home.go_offline') }),
    ).toBeChecked();
  });

  it('renders a dash when earnings fail, with the toggle unaffected, and the pill while online (failure)', async () => {
    mockEarningsStatus = 'error';
    mockPresence = {
      ...initialPresence,
      intent: 'online',
      server: 'online',
      lastAckAt: 1_800_000_000_000 - 3_000,
      lastFixAt: 1_800_000_000_000 - 3_000,
      queued: 2,
    };
    await render(<HomeScreen />);

    expect(screen.getByText('—')).toBeTruthy();
    expect(screen.getByTestId('pill')).toHaveTextContent(
      t('driver.home.pill_live'),
    );
    expect(screen.getByTestId('diagnostics')).toHaveTextContent(
      t('driver.home.queued', { count: 2 }),
      { exact: false },
    );
    expect(
      screen.getByRole('switch', { name: t('driver.home.go_offline') }),
    ).toBeChecked();
  });

  it('shows the queue position under the toggle and links the today card to earnings (#15, expected)', async () => {
    mockOffers = {
      ...mockOffers,
      queue: {
        driverId: 'd0000000-0000-4000-8000-000000000001',
        geozoneId: '00000000-0000-4000-8000-000000000102',
        geozoneSlug: 'rix',
        position: 2,
        size: 5,
        at: '2026-09-04T10:00:00.000Z',
      },
    };
    await render(<HomeScreen />);

    expect(screen.getByTestId('queue-position')).toHaveTextContent(
      t('driver.queue.position', { position: 2, size: 5, zone: 'rix' }),
    );
    const link = screen.getByRole('button', {
      name: t('driver.action.earnings'),
    });
    await fireEvent.press(link);
    const router = jest
      .requireMock<{ useRouter: () => { push: jest.Mock } }>('expo-router')
      .useRouter();
    expect(router.push).toHaveBeenCalledWith('/earnings');
  });

  it('renders the offers banner beside the presence one, and its dismiss reaches the offers slice (#15, edge)', async () => {
    mockOffers = { ...mockOffers, banner: 'error', errorCode: 'offline' };
    await render(<HomeScreen />);

    expect(
      within(screen.getByTestId('offer-banner')).getByText(
        t('driver.error.offline'),
      ),
    ).toBeTruthy();
    await fireEvent.press(
      within(screen.getByTestId('offer-banner')).getByRole('button', {
        name: t('driver.action.done'),
      }),
    );
    expect(mockDismissOffer).toHaveBeenCalledTimes(1);
    // No queue line without an event.
    expect(screen.queryByTestId('queue-position')).toBeNull();
  });
});
