import { fireEvent, render, screen } from '@testing-library/react-native';
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

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

describe('HomeScreen', () => {
  beforeEach(() => {
    mockToggle.mockReset();
    mockPresence = initialPresence;
    mockEarningsStatus = 'ready';
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
});
