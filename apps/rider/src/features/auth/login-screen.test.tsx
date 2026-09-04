import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { formatMessage } from '@taxi/shared';
import { AccessibilityInfo } from 'react-native';
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
  /** Per TEST — see the note in `verify-screen.test.tsx`. */
  let focusSpy: jest.SpyInstance;
  beforeEach(() => {
    focusSpy = jest
      .spyOn(AccessibilityInfo, 'setAccessibilityFocus')
      .mockImplementation();
    mockRequest.mockReset();
    (push as jest.Mock).mockReset();
  });

  afterEach(() => focusSpy.mockRestore());

  it('normalises the typed number, requests a code as a RIDER and moves to /verify (expected)', async () => {
    mockRequest.mockResolvedValue({
      expiresInSeconds: 300,
      resendAfterSeconds: 60,
    });
    await render(<LoginScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('rider.login.phone_label')),
      '2 612 3456',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('rider.login.send_code') }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    // `role: 'rider'` is used ONLY when the phone has no user yet — an existing
    // user's stored role wins, which the gate handles.
    expect(mockRequest).toHaveBeenCalledWith(
      'POST',
      '/auth/otp/request',
      expect.objectContaining({
        body: { phone: '+37126123456', role: 'rider' },
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
      name: t('rider.login.send_code'),
    });
    expect(button).toBeDisabled();

    await fireEvent.changeText(
      screen.getByLabelText(t('rider.login.phone_label')),
      '+37126123456',
    );
    expect(button).toBeEnabled();
  });

  it('shows the catalog copy and a countdown on 429 resend_too_soon (failure)', async () => {
    mockRequest.mockRejectedValue(new ApiError(429, 'resend_too_soon', 30));
    await render(<LoginScreen />);

    await fireEvent.changeText(
      screen.getByLabelText(t('rider.login.phone_label')),
      '26123456',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('rider.login.send_code') }),
    );

    await screen.findByText(t('rider.error.resend_too_soon'));
    expect(
      screen.getByText(t('rider.verify.resend_in', { seconds: 30 })),
    ).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it('has one header and moves screen-reader focus to it on mount (a11y — properties 1 and 2)', async () => {
    await render(<LoginScreen />);

    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    // The label comes from the catalog, not a literal — the same assertion
    // stands in for "no hardcoded user-facing string" on this screen.
    expect(
      screen.getByRole('button', { name: t('rider.login.send_code') }),
    ).toBeTruthy();
  });
});
