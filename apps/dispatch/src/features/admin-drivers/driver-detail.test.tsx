import { formatMessage } from '@taxi/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverDetail } from './driver-detail';
import {
  adminSession,
  calls,
  detail,
  DRIVER_A,
  routeFetch,
  SESSION_KEY,
  vehicle,
  VEHICLE_A,
} from './test/fixtures';

// One router object, as Next's is (see driver-list.test.tsx).
const { router } = vi.hoisted(() => ({
  router: { replace: vi.fn(), push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

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

const loaded = async () => {
  render(<DriverDetail id={DRIVER_A} backHref="/admin/drivers?approval=pending" />);
  await screen.findByRole('heading', { level: 1, name: 'Jānis Ozols' });
};

const lastBody = (method: string) =>
  calls().filter(([m]) => m === method).at(-1)?.[2];

describe('DriverDetail — profile', () => {
  it('clears the commission override with «platform base» (edge)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      { method: 'PATCH', path: `/admin/drivers/${DRIVER_A}`, body: detail() },
    ]);
    await loaded();

    fireEvent.click(
      screen.getByRole('checkbox', { name: lv('admin.driver.commission_platform_base') }),
    );
    fireEvent.click(
      within(screen.getByRole('form', { name: lv('admin.driver.profile') })).getByRole(
        'button',
        { name: lv('admin.action.save') },
      ),
    );

    expect(await screen.findByText(lv('admin.saved'))).toBeInTheDocument();
    // null, not absent: "use the platform base" is a decision the api stores.
    expect(lastBody('PATCH')).toEqual({
      spokenLanguages: ['lv'],
      isFemale: false,
      commissionPctOverride: null,
    });
  });

  it('sends a 0 % override and a changed name, LV comma accepted (expected)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      { method: 'PATCH', path: `/admin/drivers/${DRIVER_A}`, body: detail() },
    ]);
    await loaded();

    fireEvent.change(screen.getByLabelText(lv('admin.driver.display_name')), {
      target: { value: '  Jānis O. ' },
    });
    fireEvent.change(
      screen.getByRole('textbox', { name: lv('admin.driver.commission_override') }),
      { target: { value: '0,0' } },
    );
    fireEvent.click(
      within(screen.getByRole('form', { name: lv('admin.driver.profile') })).getByRole(
        'button',
        { name: lv('admin.action.save') },
      ),
    );

    await screen.findByText(lv('admin.saved'));
    expect(lastBody('PATCH')).toMatchObject({
      displayName: 'Jānis O.',
      commissionPctOverride: 0,
    });
  });

  it('refuses an out-of-range override without calling the api (failure)', async () => {
    routeFetch([{ path: `/admin/drivers/${DRIVER_A}`, body: detail() }]);
    await loaded();

    fireEvent.change(
      screen.getByRole('textbox', { name: lv('admin.driver.commission_override') }),
      { target: { value: '101' } },
    );
    fireEvent.click(
      within(screen.getByRole('form', { name: lv('admin.driver.profile') })).getByRole(
        'button',
        { name: lv('admin.action.save') },
      ),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      lv('admin.error.invalid_input'),
    );
    expect(calls().filter(([m]) => m === 'PATCH')).toHaveLength(0);
  });

  it('keeps the last spoken language ticked (edge)', async () => {
    routeFetch([{ path: `/admin/drivers/${DRIVER_A}`, body: detail() }]);
    await loaded();

    expect(screen.getByRole('checkbox', { name: lv('driver.lang.lv') })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: lv('driver.lang.ru') })).toBeEnabled();
  });
});

describe('DriverDetail — approval', () => {
  it('approves in one tap and shows the new status (expected)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      {
        method: 'PUT',
        path: '/approval',
        body: detail({ approvalStatus: 'approved' }),
      },
    ]);
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: lv('admin.action.approve') }));

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: `${lv('admin.driver.approval')}: ${lv('admin.approval.approved')}`,
      }),
    ).toBeInTheDocument();
    expect(lastBody('PUT')).toEqual({ status: 'approved' });
  });
});

describe('DriverDetail — vehicles', () => {
  it('sets the category, which only the admin can (expected)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      {
        method: 'PATCH',
        path: `/admin/vehicles/${VEHICLE_A}`,
        body: { ...vehicle, category: 'limo' },
      },
    ]);
    await loaded();
    const car = screen.getByRole('form', { name: 'AB-1234' });

    fireEvent.change(within(car).getByLabelText(lv('admin.vehicle.category')), {
      target: { value: 'limo' },
    });
    fireEvent.click(within(car).getByRole('button', { name: lv('admin.action.save') }));

    await within(car).findByText(lv('admin.saved'));
    expect(lastBody('PATCH')).toMatchObject({ category: 'limo', plate: 'AB-1234' });
  });

  it('deletes after confirming, then reloads the driver (expected)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      { method: 'DELETE', path: `/admin/vehicles/${VEHICLE_A}`, status: 204 },
      { path: `/admin/drivers/${DRIVER_A}`, body: detail({ vehicles: [] }) },
    ]);
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: lv('admin.vehicle.delete') }));
    const dialog = screen.getByRole('dialog', {
      name: formatMessage('lv', 'admin.vehicle.delete_confirm', { plate: 'AB-1234' }),
    });
    // Nothing is deleted until the confirm.
    expect(calls().filter(([m]) => m === 'DELETE')).toHaveLength(0);
    fireEvent.click(
      within(dialog).getByRole('button', { name: lv('admin.vehicle.delete') }),
    );

    expect(await screen.findByText(lv('admin.drivers.no_vehicles'))).toBeInTheDocument();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('heading', { level: 1, name: 'Jānis Ozols' }),
      ),
    );
  });

  it('keeps the car and alerts when the driver is on a ride (failure)', async () => {
    routeFetch([
      { path: `/admin/drivers/${DRIVER_A}`, body: detail() },
      {
        method: 'DELETE',
        path: `/admin/vehicles/${VEHICLE_A}`,
        status: 409,
        body: { message: 'driver_on_ride', statusCode: 409 },
      },
    ]);
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: lv('admin.vehicle.delete') }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', {
        name: lv('admin.vehicle.delete'),
      }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      lv('admin.error.driver_on_ride'),
    );
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('form', { name: 'AB-1234' })).toBeInTheDocument();
  });
});

describe('DriverDetail — load', () => {
  it('says the driver was not found on a 404 (failure)', async () => {
    routeFetch([
      {
        path: `/admin/drivers/${DRIVER_A}`,
        status: 404,
        body: { message: 'driver_not_found', statusCode: 404 },
      },
    ]);
    render(<DriverDetail id={DRIVER_A} backHref="/admin/drivers?approval=pending" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      lv('admin.error.driver_not_found'),
    );
  });
});
