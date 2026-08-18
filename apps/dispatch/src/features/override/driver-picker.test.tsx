import { type DispatchDriver } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DriverPicker } from './driver-picker';

const driver = (over: Partial<DispatchDriver>): DispatchDriver => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis Ozols',
  phone: '+37129999001',
  status: 'online',
  vehiclePlate: 'AB-1234',
  zoneName: 'Centrs',
  activeRideId: null,
  ...over,
});

const roster = [
  driver({}),
  driver({
    driverId: 'd0000000-0000-4000-8000-000000000002',
    name: 'Māra Liepa',
    phone: '+37129999002',
    vehiclePlate: 'CD-5678',
    status: 'offline',
    zoneName: null,
  }),
  driver({
    driverId: 'd0000000-0000-4000-8000-000000000003',
    name: 'Pēteris Kalns',
    phone: '+37129999003',
    vehiclePlate: 'EF-9012',
    status: 'on_ride',
    activeRideId: 'ad000000-0000-4000-8000-000000000009',
  }),
];

const renderPicker = (onPick = vi.fn(), drivers = roster) => {
  render(
    <DriverPicker
      drivers={drivers}
      pickupZoneName={null}
      loading={false}
      onPick={onPick}
    />,
  );
  return { onPick, combobox: screen.getByRole('combobox') };
};

describe('DriverPicker', () => {
  it('lists every driver, offline ones included and SELECTABLE (expected)', () => {
    const { onPick } = renderPicker();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(3);
    // S9-2: overriding onto an ineligible driver is the feature. Nothing here
    // may be disabled — the warning belongs to the confirm step.
    for (const option of options) expect(option).not.toBeDisabled();

    fireEvent.click(screen.getByText('Māra Liepa'));
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Māra Liepa' }),
    );
  });

  it('completes a pick from the keyboard alone — ↓ then Enter (expected)', () => {
    const { onPick, combobox } = renderPicker();

    // A dispatcher on a call never reaches for the mouse (evidence F2.4).
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'Enter' });

    expect(onPick).toHaveBeenCalledTimes(1);
    // Online sorts first, so ↓ once lands on the second-ranked driver.
    expect(onPick.mock.calls[0]?.[0].status).not.toBe('online');
  });

  it('tracks the active option with aria-activedescendant (expected)', () => {
    const { combobox } = renderPicker();

    expect(combobox).toHaveAttribute('aria-activedescendant', 'driver-option-0');
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(combobox).toHaveAttribute('aria-activedescendant', 'driver-option-1');
  });

  it('scrolls the active option into view as ArrowDown moves it (expected)', () => {
    const scrollIntoView = vi.fn();
    // jsdom has no layout, so the shared stub in vitest.setup.ts is a no-op —
    // spied here to assert the call is made at all.
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      const { combobox } = renderPicker();
      scrollIntoView.mockClear();

      fireEvent.keyDown(combobox, { key: 'ArrowDown' });

      // The listbox shows ~5 of the roster at a time. Without this the active
      // option walks past the fold while the list stays put, and a sighted
      // keyboard user picks a driver they cannot see (#120 review M7).
      expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' });
      expect(scrollIntoView.mock.instances[0]).toBe(
        screen.getByRole('option', { selected: true }),
      );
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('drops aria-controls when there is no listbox to point at (edge)', () => {
    const { combobox } = renderPicker();

    fireEvent.change(combobox, { target: { value: 'nobody matches this' } });

    // An ARIA id reference resolving to nothing is an axe
    // `aria-valid-attr-value` violation (#120 review L4).
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(combobox).not.toHaveAttribute('aria-controls');
  });

  it('filters on plate and phone, not just name (edge)', () => {
    const { combobox } = renderPicker();

    fireEvent.change(combobox, { target: { value: 'CD-56' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);

    fireEvent.change(combobox, { target: { value: '9003' } });
    expect(screen.getByText('Pēteris Kalns')).toBeInTheDocument();
  });

  it('clamps the active index when filtering shrinks the list under it (edge)', () => {
    const { onPick, combobox } = renderPicker();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.change(combobox, { target: { value: 'Jānis' } });

    // Without the clamp the index still points at row 2 and Enter does
    // nothing, with no feedback at all.
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Jānis Ozols' }),
    );
  });

  it('shows the busy driver as on-a-ride rather than as a phone number (edge)', () => {
    renderPicker();
    expect(screen.getByText('Izpilda braucienu')).toBeInTheDocument();
  });

  it('says so when nothing matches, instead of rendering an empty box (failure)', () => {
    const { combobox } = renderPicker();

    fireEvent.change(combobox, { target: { value: 'nobody' } });

    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('Nav neviena šofera');
  });

  it('does not run off either end of the list (failure)', () => {
    const { onPick, combobox } = renderPicker();

    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(combobox, { key: 'ArrowUp' });
    }
    fireEvent.keyDown(combobox, { key: 'Enter' });
    expect(onPick).toHaveBeenCalledTimes(2);
  });
});
