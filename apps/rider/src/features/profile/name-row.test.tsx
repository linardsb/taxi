import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NameRow } from './name-row';

const mockSessionContext = {
  state: { status: 'signedOut', session: null } as unknown,
};
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => mockSessionContext,
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { push } = router.useRouter();

function signedIn(displayName?: string) {
  mockSessionContext.state = {
    status: 'signedIn',
    session: {
      accessToken: 'token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      user: {
        id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
        phone: '+37126123456',
        role: 'rider',
        language: 'lv',
        createdAt: '2026-08-01T00:00:00.000Z',
        ...(displayName ? { displayName } : {}),
      },
    },
  };
}

describe('NameRow (#269)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads the name and opens /name (expected)', async () => {
    signedIn('Anna');
    await render(<NameRow />);

    const row = screen.getByRole('button', {
      name: 'Vārds vadītājam: Anna',
    });
    await act(async () => {
      fireEvent.press(row);
    });

    expect(push).toHaveBeenCalledWith('/name');
  });

  it('says «nav norādīts» when there is no name (edge)', async () => {
    signedIn();
    await render(<NameRow />);

    expect(
      screen.getByRole('button', { name: 'Vārds vadītājam: nav norādīts' }),
    ).toBeTruthy();
  });

  it('renders the empty text while signed out, without throwing (failure)', async () => {
    mockSessionContext.state = { status: 'signedOut', session: null };
    await render(<NameRow />);

    expect(screen.getByTestId('name-row')).toHaveTextContent(
      'Vārds vadītājam: nav norādīts',
    );
  });
});
