import { render, screen, waitFor } from '@testing-library/react-native';
import { formatMessage, type AuthSession } from '@taxi/shared';
import { GateScreen } from './gate-screen';

const mockSignOut = jest.fn();
let mockState: {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: AuthSession | null;
};
jest.mock('./use-session', () => ({
  useSession: () => ({
    state: mockState,
    api: { request: jest.fn() },
    signIn: jest.fn(),
    signOut: mockSignOut,
    onBeforeSignOut: jest.fn(),
  }),
}));

const sessionFor = (role: 'rider' | 'driver'): AuthSession => ({
  accessToken: 'tok',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    phone: '+37126123456',
    role,
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
});

const t = (key: Parameters<typeof formatMessage>[1]) =>
  formatMessage('lv', key);

describe('GateScreen', () => {
  beforeEach(() => mockSignOut.mockReset());

  it('sends a signed-in rider straight to the booking screen (expected)', async () => {
    mockState = { status: 'signedIn', session: sessionFor('rider') };

    await render(<GateScreen />);

    expect(screen.getByTestId('redirect')).toHaveTextContent('/book');
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('sends a signed-out visitor to login, and labels the loading spinner (edge)', async () => {
    mockState = { status: 'signedOut', session: null };
    await render(<GateScreen />);
    expect(screen.getByTestId('redirect')).toHaveTextContent('/login');

    mockState = { status: 'loading', session: null };
    await render(<GateScreen />);
    // A bare spinner is silent to a screen reader — the wait has to be spoken.
    expect(screen.getByLabelText(t('rider.loading'))).toBeTruthy();
  });

  it("signs a driver's session out instead of dropping them into a 403 loop (failure)", async () => {
    // The api's rule is that an existing user's stored role wins, so a driver's
    // phone signing in here gets a DRIVER session and every rider route 403s.
    mockState = { status: 'signedIn', session: sessionFor('driver') };

    await render(<GateScreen />);

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    // Generic copy on purpose: naming the driver account would confirm it
    // exists to anyone who can type a phone number.
    expect(screen.getByText(t('rider.error.generic'))).toBeTruthy();
    expect(screen.queryByTestId('redirect')).toBeNull();
  });
});
