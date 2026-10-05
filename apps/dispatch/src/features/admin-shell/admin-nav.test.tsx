import { formatMessage } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminNav } from './admin-nav';

const { replace, pathname } = vi.hoisted(() => ({
  replace: vi.fn(),
  pathname: { value: '/admin/drivers' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => pathname.value,
}));

afterEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe('AdminNav', () => {
  it('marks the current surface with aria-current (expected)', () => {
    pathname.value = '/admin/drivers';
    render(<AdminNav />);

    expect(
      screen.getByRole('navigation', {
        name: formatMessage('lv', 'admin.nav.label'),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: formatMessage('lv', 'admin.nav.drivers') }),
    ).toHaveAttribute('aria-current', 'page');
  });

  it('marks nothing current off a listed surface (edge)', () => {
    pathname.value = '/admin';
    render(<AdminNav />);

    expect(
      screen.getByRole('link', { name: formatMessage('lv', 'admin.nav.drivers') }),
    ).not.toHaveAttribute('aria-current');
  });

  it('logs out: drops the session and goes to /login (expected)', () => {
    window.localStorage.setItem('taxi.console.session', '{}');
    render(<AdminNav />);

    fireEvent.click(
      screen.getByRole('button', { name: formatMessage('lv', 'admin.nav.logout') }),
    );

    expect(window.localStorage.getItem('taxi.console.session')).toBeNull();
    expect(replace).toHaveBeenCalledWith('/login');
  });
});
