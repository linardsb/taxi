import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { formatMessage, type MessageKey } from '@taxi/shared';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/features/auth';
import { NameScreen } from './name-screen';

const mockRequest = jest.fn();
const mockSetDisplayName = jest.fn();
const mockSessionContext = {
  state: { status: 'signedOut', session: null } as unknown,
  api: { request: mockRequest },
  signIn: jest.fn(),
  signOut: jest.fn(),
  setDisplayName: mockSetDisplayName,
  onBeforeSignOut: jest.fn(() => jest.fn()),
};
jest.mock('@/features/auth', () => ({
  ...jest.requireActual<typeof import('@/features/auth')>('@/features/auth'),
  useSession: () => mockSessionContext,
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { back } = router.useRouter();

const t = (key: MessageKey) => formatMessage('lv', key);

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

async function type(value: string) {
  await act(async () => {
    fireEvent.changeText(screen.getByLabelText(t('rider.name.label')), value);
  });
}

async function press(label: MessageKey) {
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: t(label) }));
  });
}

describe('NameScreen (#269)', () => {
  let announce: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequest.mockResolvedValue(undefined);
    mockSetDisplayName.mockResolvedValue(undefined);
    announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation();
  });

  afterEach(() => announce.mockRestore());

  it('saves the trimmed name, mirrors it, announces it and goes back (expected)', async () => {
    signedIn();
    await render(<NameScreen />);

    await type('  Anna ');
    await press('rider.name.save');

    expect(mockRequest).toHaveBeenCalledWith('PUT', '/riders/me/display-name', {
      body: { displayName: 'Anna' },
    });
    expect(mockSetDisplayName).toHaveBeenCalledWith('Anna');
    expect(announce).toHaveBeenCalledWith('Vārds saglabāts');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('removes a set name with null (edge)', async () => {
    signedIn('Anna');
    await render(<NameScreen />);

    await press('rider.name.remove');

    expect(mockRequest).toHaveBeenCalledWith('PUT', '/riders/me/display-name', {
      body: { displayName: null },
    });
    expect(mockSetDisplayName).toHaveBeenCalledWith(null);
    expect(announce).toHaveBeenCalledWith('Vārds noņemts');
  });

  it('goes back without a request on a blank Save with no name (edge)', async () => {
    signedIn();
    await render(<NameScreen />);

    // No Remove button without a name to remove.
    expect(
      screen.queryByRole('button', { name: t('rider.name.remove') }),
    ).toBeNull();
    await type('   ');
    await press('rider.name.save');

    expect(mockRequest).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('shows the offline banner, keeps the text and stays on the screen (failure)', async () => {
    signedIn();
    mockRequest.mockRejectedValue(new ApiError(0, 'offline'));
    await render(<NameScreen />);

    await type('Anna');
    await press('rider.name.save');

    expect(screen.getByText(t('rider.error.offline'))).toBeTruthy();
    expect(screen.getByDisplayValue('Anna')).toBeTruthy();
    expect(mockSetDisplayName).not.toHaveBeenCalled();
    expect(back).not.toHaveBeenCalled();
    // The retry sends the same text: the ref kept it.
    mockRequest.mockResolvedValue(undefined);
    await press('rider.name.save');
    expect(mockRequest).toHaveBeenLastCalledWith(
      'PUT',
      '/riders/me/display-name',
      { body: { displayName: 'Anna' } },
    );
  });
});
