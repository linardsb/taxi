import { type DispatchDriver } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AssignDialog } from './assign-dialog';

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

const OFFLINE = driver({
  driverId: 'd0000000-0000-4000-8000-000000000002',
  name: 'Māra Liepa',
  status: 'offline',
  vehiclePlate: 'CD-5678',
});

function renderDialog(
  over: Partial<React.ComponentProps<typeof AssignDialog>> = {},
) {
  const onSubmit = vi.fn();
  const onClearError = vi.fn();
  const onClose = vi.fn();
  render(
    <AssignDialog
      verb="assign"
      pickupZoneName={null}
      drivers={[driver({}), OFFLINE]}
      loadingRoster={false}
      submitting={false}
      errorKey={null}
      disabledReasonKey={null}
      onSubmit={onSubmit}
      onClearError={onClearError}
      onClose={onClose}
      {...over}
    />,
  );
  return { onSubmit, onClearError, onClose };
}

describe('AssignDialog', () => {
  it('picks a free driver and submits with the reason (expected)', () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByText('Jānis Ozols'));
    fireEvent.change(screen.getByRole('textbox', { name: /Iemesls/ }), {
      target: { value: 'VIP regular' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Apstiprināt' }));

    expect(onSubmit).toHaveBeenCalledWith(
      'd0000000-0000-4000-8000-000000000001',
      'VIP regular',
    );
  });

  it('sends a null reason rather than an empty string (edge)', () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByText('Jānis Ozols'));
    fireEvent.click(screen.getByRole('button', { name: 'Apstiprināt' }));

    expect(onSubmit).toHaveBeenCalledWith(
      'd0000000-0000-4000-8000-000000000001',
      null,
    );
  });

  it('WARNS about an offline driver and still lets the assign through (edge)', () => {
    const { onSubmit } = renderDialog();

    fireEvent.click(screen.getByText('Māra Liepa'));

    // The whole Q1 resolution in one test: a warning plus a second confirm,
    // never a block. #10's force-assign is deliberately unfiltered, and Dina
    // has the driver on the phone whose app just died.
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Māra Liepa nav tiešsaistē',
    );
    const confirm = screen.getByRole('button', { name: 'Apstiprināt' });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    expect(onSubmit).toHaveBeenCalledWith(OFFLINE.driverId, null);
  });

  it('titles itself by verb, so reassign never reads as a fresh assign (edge)', () => {
    renderDialog({ verb: 'reassign' });
    expect(screen.getByRole('dialog')).toHaveAccessibleName(
      'Piešķirt braucienu atkārtoti',
    );
  });

  it('goes back to the picker from the confirm step (edge)', () => {
    renderDialog();

    fireEvent.click(screen.getByText('Jānis Ozols'));
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Atpakaļ' }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('closes on Escape — a dispatcher is never trapped in a dialog (edge)', () => {
    const { onClose } = renderDialog();

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('refuses to submit while the console is offline, WITH a reason (failure)', () => {
    const { onSubmit } = renderDialog({
      disabledReasonKey: 'console.assign_offline_disabled',
    });

    fireEvent.click(screen.getByText('Jānis Ozols'));

    // A write that silently fails behind «Bezsaistē» is the trap #18 exists to
    // prevent — so the button is disabled and the banner says why.
    expect(screen.getByRole('button', { name: 'Apstiprināt' })).toBeDisabled();
    expect(screen.getAllByRole('alert')[0]).toHaveTextContent('Bezsaistē');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('shows the mid-cascade 409 and returns to the picker (failure)', () => {
    renderDialog({ errorKey: 'console.assign_error_ride_not_assignable' });

    expect(screen.getAllByRole('alert')[0]).toHaveTextContent(
      'Brauciens jau ir piešķirts vai atcelts',
    );
    // Back on the picker, not stranded confirming a driver who can no longer
    // take the ride — the board's next frame has already moved under her.
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('blocks a double submit while one is in flight (failure)', () => {
    const { onSubmit } = renderDialog({ submitting: true });

    fireEvent.click(screen.getByText('Jānis Ozols'));
    const confirm = screen.getByRole('button', { name: 'Piešķir…' });
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
