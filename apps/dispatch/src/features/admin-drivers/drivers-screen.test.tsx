import { formatMessage } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APPROVAL_LABEL, CATEGORY_LABEL, EMPTY_LIST } from './approval-labels';
import { DriversScreen } from './drivers-screen';
import { detail, DRIVER_A, routeFetch, SESSION_KEY, adminSession } from './test/fixtures';

const { router, search } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
  search: { value: '' },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(search.value),
}));

const lv = (key: Parameters<typeof formatMessage>[1]) => formatMessage('lv', key);

beforeEach(() => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(adminSession));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('DriversScreen', () => {
  it('opens one driver when ?id= is set, Back keeping the filter (expected)', async () => {
    search.value = `approval=rejected&id=${DRIVER_A}`;
    routeFetch([{ path: `/admin/drivers/${DRIVER_A}`, body: detail() }]);
    render(<DriversScreen />);

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Jānis Ozols' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: lv('admin.action.back') })).toHaveAttribute(
      'href',
      '/admin/drivers?approval=rejected',
    );
  });

  it('reads the filter from the URL, and a bad value falls back to pending (edge)', async () => {
    search.value = 'approval=rejected';
    routeFetch([{ path: '/admin/drivers?approval=rejected', body: [] }]);
    const { unmount } = render(<DriversScreen />);
    expect(await screen.findByText(lv(EMPTY_LIST.rejected))).toBeInTheDocument();
    unmount();

    search.value = 'approval=bogus';
    routeFetch([{ path: '/admin/drivers?approval=pending', body: [] }]);
    render(<DriversScreen />);
    expect(await screen.findByText(lv(EMPTY_LIST.pending))).toBeInTheDocument();
  });
});

describe('label maps', () => {
  it('resolve to real catalog text, never the key (edge)', () => {
    for (const key of [
      ...Object.values(APPROVAL_LABEL),
      ...Object.values(CATEGORY_LABEL),
      ...Object.values(EMPTY_LIST),
    ]) {
      expect(lv(key)).not.toBe(key);
    }
  });
});
