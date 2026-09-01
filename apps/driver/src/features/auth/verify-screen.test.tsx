import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { ApiError } from './api-client';
import { VerifyScreen } from './verify-screen';

const mockRequest = jest.fn();
const mockSignIn = jest.fn();
jest.mock('./use-session', () => ({
  useSession: () => ({
    state: { status: 'signedOut', session: null },
    api: { request: mockRequest },
    signIn: mockSignIn,
    signOut: jest.fn(),
    onBeforeSignOut: jest.fn(),
  }),
}));

const router = jest.requireMock<typeof import('expo-router')>('expo-router');
const { replace } = router.useRouter();

const SESSION = {
  accessToken: 'tok',
  expiresAt: '2099-01-01T00:00:00.000Z',
  user: {
    id: '8d1f2c3e-4b5a-6c7d-8e9f-0a1b2c3d4e5f',
    phone: '+37126123456',
    role: 'driver',
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
};

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

describe('VerifyScreen', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    mockSignIn.mockReset();
    (replace as jest.Mock).mockReset();
    (router.useLocalSearchParams as jest.Mock).mockReturnValue({
      phone: '+37126123456',
      resendAfterSeconds: '60',
    });
  });

  it('auto-submits on the sixth digit, signs in and returns to the gate (expected)', async () => {
    mockRequest.mockResolvedValue(SESSION);
    mockSignIn.mockResolvedValue(undefined);
    await render(<VerifyScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.verify.code_label')),
      '12345',
    );
    expect(mockRequest).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByLabelText(t('driver.verify.code_label')),
      '123456',
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/otp/verify',
      expect.objectContaining({
        body: { phone: '+37126123456', code: '123456' },
      }),
    );
    expect(mockSignIn).toHaveBeenCalledWith(SESSION);
  });

  it('keeps resend disabled for the countdown, then enables it (edge)', async () => {
    jest.useFakeTimers({
      doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
    });
    try {
      await render(<VerifyScreen />);
      expect(
        screen.getByRole('button', {
          name: t('driver.verify.resend_in', { seconds: 60 }),
        }),
      ).toBeDisabled();

      await act(async () => {
        jest.advanceTimersByTime(60_000);
      });

      expect(
        screen.getByRole('button', { name: t('driver.verify.resend') }),
      ).toBeEnabled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('clears the field and shows the wrong-code copy on 401 (failure)', async () => {
    mockRequest.mockRejectedValue(new ApiError(401, 'invalid_or_expired_code'));
    await render(<VerifyScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.verify.code_label')),
      '000000',
    );

    await screen.findByText(t('driver.error.invalid_or_expired_code'));
    expect(
      screen.getByLabelText(t('driver.verify.code_label')).props.value,
    ).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });
});
