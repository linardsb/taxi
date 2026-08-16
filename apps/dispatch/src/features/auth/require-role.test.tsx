import type { AuthSession, UserRole } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequireRole } from './require-role';
import { saveSession } from './session';

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
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

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('RequireRole', () => {
  it('renders children for an allowed role (expected)', async () => {
    saveSession(session('dispatcher'));

    render(
      <RequireRole roles={['dispatcher', 'admin']}>
        <p>board</p>
      </RequireRole>,
    );

    expect(await screen.findByText('board')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects a wrong-role session to /login without rendering (edge)', async () => {
    saveSession(session('driver'));

    render(
      <RequireRole roles={['dispatcher', 'admin']}>
        <p>board</p>
      </RequireRole>,
    );

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('board')).not.toBeInTheDocument();
  });

  it('redirects when no session exists at all (failure)', async () => {
    render(
      <RequireRole roles={['dispatcher', 'admin']}>
        <p>board</p>
      </RequireRole>,
    );

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('board')).not.toBeInTheDocument();
  });
});
