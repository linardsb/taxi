import { formatMessage, type AuthSession, type UserRole } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

const session = (role: UserRole): AuthSession => ({
  accessToken: 'token-abc',
  expiresAt: '2026-09-14T12:00:00.000Z',
  user: {
    id: '99999999-8888-4777-8666-555555555555',
    phone: '+37129999001',
    role,
    language: 'lv',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
});

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
});
const statusOnly = (status: number) => ({
  ok: false,
  status,
  json: async () => ({}),
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Phone step → code step, with the OTP request answered as told. */
async function reachCodeStep() {
  vi.mocked(fetch).mockResolvedValueOnce(
    okJson({ expiresInSeconds: 300, resendAfterSeconds: 30 }) as Response,
  );
  fireEvent.change(
    screen.getByLabelText(formatMessage('lv', 'console.phone')),
    { target: { value: '+37129999001' } },
  );
  fireEvent.click(
    screen.getByRole('button', {
      name: formatMessage('lv', 'console.send_code'),
    }),
  );
  await screen.findByLabelText(formatMessage('lv', 'console.code'));
}

async function submitCode(code = '123456') {
  fireEvent.change(screen.getByLabelText(formatMessage('lv', 'console.code')), {
    target: { value: code },
  });
  fireEvent.click(
    screen.getByRole('button', { name: formatMessage('lv', 'console.sign_in') }),
  );
}

describe('LoginForm', () => {
  it('signs a provisioned dispatcher in and lands on /dispatch (expected)', async () => {
    render(<LoginForm />);
    await reachCodeStep();

    vi.mocked(fetch).mockResolvedValueOnce(
      okJson(session('dispatcher')) as Response,
    );
    await submitCode();

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/dispatch'));
    expect(
      window.localStorage.getItem('taxi.console.session'),
    ).toContain('token-abc');
    // The OTP request rode the rider role — the stored role wins server-side.
    expect(vi.mocked(fetch).mock.calls[0]![1]?.body).toContain('"role":"rider"');
  });

  it('moves focus to the code field on step 2 (edge)', async () => {
    // Step 2 swaps the input IN PLACE with focus parked on the submit button,
    // whose accessible name silently changes «Sūtīt kodu» → «Pieslēgties».
    // Nothing would announce the new field, and it costs a Tab to reach.
    //
    // Retried, not asserted once: `reachCodeStep` waits for the input to be in
    // the DOM, but the focus is applied by a passive effect that React flushes
    // a macrotask later. The assertion is right; only reading it on the commit
    // that inserted the node is wrong, and that gap took `main` red twice (#189).
    render(<LoginForm />);
    await reachCodeStep();

    await vi.waitFor(() =>
      expect(screen.getByLabelText(formatMessage('lv', 'console.code'))).toBe(
        document.activeElement,
      ),
    );
  });

  it('renders the phone placeholder from the catalog, not a literal (edge)', () => {
    render(<LoginForm />);

    expect(
      screen.getByLabelText(formatMessage('lv', 'console.phone')),
    ).toHaveAttribute(
      'placeholder',
      formatMessage('lv', 'console.phone_placeholder'),
    );
  });

  it('rejects a rider session — no_access shown, token DISCARDED (edge)', async () => {
    render(<LoginForm />);
    await reachCodeStep();

    vi.mocked(fetch).mockResolvedValueOnce(okJson(session('rider')) as Response);
    await submitCode();

    expect(
      await screen.findByText(formatMessage('lv', 'console.no_access')),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it('shows wrong_code on a 401 and keeps the code step (failure)', async () => {
    render(<LoginForm />);
    await reachCodeStep();

    vi.mocked(fetch).mockResolvedValueOnce(statusOnly(401) as Response);
    await submitCode('000000');

    expect(
      await screen.findByText(formatMessage('lv', 'console.wrong_code')),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(formatMessage('lv', 'console.code')),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
  });

  it('surfaces a failed OTP request inline and stays on the phone step (failure)', async () => {
    render(<LoginForm />);

    vi.mocked(fetch).mockRejectedValueOnce(new Error('network down'));
    fireEvent.change(
      screen.getByLabelText(formatMessage('lv', 'console.phone')),
      { target: { value: '+37129999001' } },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.send_code'),
      }),
    );

    expect(
      await screen.findByText(formatMessage('lv', 'console.request_failed')),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(formatMessage('lv', 'console.phone')),
    ).toBeInTheDocument();
  });
});
