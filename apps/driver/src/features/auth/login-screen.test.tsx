import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { ApiError } from './api-client';
import { LoginScreen } from './login-screen';

const mockRequest = jest.fn();
jest.mock('./use-session', () => ({
  useSession: () => ({
    state: { status: 'signedOut', session: null },
    api: { request: mockRequest },
    signIn: jest.fn(),
    signOut: jest.fn(),
    onBeforeSignOut: jest.fn(),
  }),
}));

const { push } = jest
  .requireMock<typeof import('expo-router')>('expo-router')
  .useRouter();

const t = (
  key: Parameters<typeof formatMessage>[1],
  params?: Record<string, string | number>,
) => formatMessage('lv', key, params);

describe('LoginScreen', () => {
  beforeEach(() => {
    mockRequest.mockReset();
    (push as jest.Mock).mockReset();
  });

  it('normalises the typed number, requests a code and moves to /verify (expected)', async () => {
    mockRequest.mockResolvedValue({
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
    await render(<LoginScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.login.phone_label')),
      '2 612 3456',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.login.send_code') }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/otp/request',
      expect.objectContaining({
        body: { phone: '+37126123456', role: 'driver' },
      }),
    );
    expect(push).toHaveBeenCalledWith({
      pathname: '/verify',
      params: { phone: '+37126123456', resendAfterSeconds: '60' },
    });
  });

  it('keeps the button disabled until the number is E.164 (edge)', async () => {
    await render(<LoginScreen />);

    // The prefilled `+371` alone is not a number.
    const button = screen.getByRole('button', {
      name: t('driver.login.send_code'),
    });
    expect(button).toBeDisabled();

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.login.phone_label')),
      '+37126123456',
    );
    expect(button).toBeEnabled();
  });

  it('shows the catalog copy and a countdown on 429 resend_too_soon (failure)', async () => {
    mockRequest.mockRejectedValue(new ApiError(429, 'resend_too_soon', 30));
    await render(<LoginScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('driver.login.phone_label')),
      '26123456',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('driver.login.send_code') }),
    );

    await screen.findByText(t('driver.error.resend_too_soon'));
    expect(
      screen.getByText(t('driver.verify.resend_in', { seconds: 30 })),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });
});
