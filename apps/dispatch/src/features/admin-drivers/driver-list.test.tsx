import { formatMessage } from '@taxi/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverList } from './driver-list';
import {
  adminSession,
  calls,
  DRIVER_A,
  DRIVER_B,
  detail,
  routeFetch,
  SESSION_KEY,
  summary,
} from './test/fixtures';

// ONE router object, as Next's is: the load effect depends on it, so a mock
// minting a new router per render would refetch on every render.
const { router, replace } = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, router: { replace, push: vi.fn() } };
});
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const lv = (key: Parameters<typeof formatMessage>[1]) => formatMessage('lv', key);

const twoPending = [
  summary(DRIVER_A, 'Jānis Ozols', 'AB-1234'),
  summary(DRIVER_B, 'Anna Bērziņa', 'CD-5678'),
];

beforeEach(() => {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(adminSession));
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderList = (onFilterChange = vi.fn()) =>
  render(<DriverList filter="pending" onFilterChange={onFilterChange} />);

const rowOf = (name: string) =>
  screen.getByRole('rowheader', { name }).closest('tr') as HTMLElement;

describe('DriverList', () => {
  it('renders pending rows with plate and category (expected)', async () => {
    routeFetch([{ path: '/admin/drivers?approval=pending', body: twoPending }]);
    renderList();

    expect(screen.getByText(lv('console.loading'))).toBeInTheDocument();
    const row = await screen.findByRole('rowheader', { name: 'Jānis Ozols' });
    expect(row.closest('tr')).toHaveTextContent(
      `AB-1234 · ${lv('admin.category.standard')}`,
    );
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('shows the pending empty state when nobody is waiting (edge)', async () => {
    routeFetch([{ path: '/admin/drivers?approval=pending', body: [] }]);
    renderList();

    expect(await screen.findByText(lv('admin.drivers.empty_pending'))).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('names whose row a repeated button acts on (edge)', async () => {
    routeFetch([{ path: '/admin/drivers', body: twoPending }]);
    renderList();
    await screen.findByRole('rowheader', { name: 'Anna Bērziņa' });

    const approve = within(rowOf('Anna Bērziņa')).getByRole('button', {
      name: lv('admin.action.approve'),
    });
    expect(approve).toHaveAccessibleDescription('Anna Bērziņa');
    // Open carries the filter, so the detail's Back returns to this queue.
    expect(
      within(rowOf('Anna Bērziņa')).getByRole('link', { name: lv('admin.action.open') }),
    ).toHaveAttribute('href', `/admin/drivers?approval=pending&id=${DRIVER_B}`);
  });

  it('approves from the keyboard: the row leaves, focus parks on the heading (expected)', async () => {
    routeFetch([
      { path: '/admin/drivers', body: twoPending },
      {
        method: 'PUT',
        path: `/admin/drivers/${DRIVER_A}/approval`,
        body: detail({ approvalStatus: 'approved' }),
      },
      { path: '/admin/drivers', body: [twoPending[1]] },
    ]);
    renderList();
    await screen.findByRole('rowheader', { name: 'Jānis Ozols' });

    // jsdom has no native Tab order (no user-event here): focus the button
    // directly, prove it is focusable, then activate it as Enter would.
    const approve = within(rowOf('Jānis Ozols')).getByRole('button', {
      name: lv('admin.action.approve'),
    });
    approve.focus();
    expect(document.activeElement).toBe(approve);
    fireEvent.click(approve);

    await vi.waitFor(() =>
      expect(screen.queryByRole('rowheader', { name: 'Jānis Ozols' })).toBeNull(),
    );
    expect(calls()).toContainEqual([
      'PUT',
      expect.stringContaining(`/admin/drivers/${DRIVER_A}/approval`),
      { status: 'approved' },
    ]);
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: lv('admin.drivers.title') }),
      ),
    );
    // The action refetches the queue after dropping the row.
    await vi.waitFor(() =>
      expect(calls().filter(([m]) => m === 'GET')).toHaveLength(2),
    );
  });

  it('keeps the row and alerts when a reject hits an on-ride driver (failure)', async () => {
    routeFetch([
      { path: '/admin/drivers', body: twoPending },
      {
        method: 'PUT',
        path: '/approval',
        status: 409,
        body: { message: 'driver_on_ride', statusCode: 409 },
      },
    ]);
    renderList();
    await screen.findByRole('rowheader', { name: 'Jānis Ozols' });

    fireEvent.click(
      within(rowOf('Jānis Ozols')).getByRole('button', {
        name: lv('admin.action.reject'),
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      lv('admin.error.driver_on_ride'),
    );
    expect(screen.getByRole('rowheader', { name: 'Jānis Ozols' })).toBeInTheDocument();
  });

  it('shows an error with a retry that reloads (failure)', async () => {
    routeFetch([
      { path: '/admin/drivers', status: 500 },
      { path: '/admin/drivers', body: twoPending },
    ]);
    renderList();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      lv('admin.drivers.load_failed'),
    );
    fireEvent.click(screen.getByRole('button', { name: lv('admin.action.retry') }));

    expect(await screen.findByRole('rowheader', { name: 'Jānis Ozols' })).toBeInTheDocument();
  });

  it('drops a non-admin session and bounces to /login (failure)', async () => {
    routeFetch([
      { path: '/admin/drivers', status: 403, body: { message: 'insufficient_role' } },
    ]);
    renderList();

    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('hands a filter change to the caller (expected)', async () => {
    routeFetch([{ path: '/admin/drivers', body: [] }]);
    const onFilterChange = vi.fn();
    renderList(onFilterChange);

    fireEvent.click(screen.getByRole('radio', { name: lv('admin.approval.rejected') }));

    expect(onFilterChange).toHaveBeenCalledWith('rejected');
    expect(
      screen.getByRole('group', { name: lv('admin.drivers.filter') }),
    ).toBeInTheDocument();
  });
});
