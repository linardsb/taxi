import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CancelDialog } from './cancel-dialog';

function renderDialog(
  over: Partial<React.ComponentProps<typeof CancelDialog>> = {},
) {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  render(
    <CancelDialog
      submitting={false}
      errorKey={null}
      disabledReasonKey={null}
      onConfirm={onConfirm}
      onClose={onClose}
      {...over}
    />,
  );
  return { onConfirm, onClose };
}

describe('CancelDialog', () => {
  it('cancels with the typed reason (expected)', () => {
    const { onConfirm } = renderDialog();

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'zvanītājs pārdomāja' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Atcelt braucienu' }),
    );

    expect(onConfirm).toHaveBeenCalledWith('zvanītājs pārdomāja');
  });

  it('sends null rather than an empty reason (edge)', () => {
    const { onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Atcelt braucienu' }));

    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it('does not put focus on the destructive button (edge)', () => {
    renderDialog();

    // A stray Enter on an accidentally-opened dialog must not kill a live
    // ride, so the shell focuses the reason field first.
    expect(
      screen.getByRole('button', { name: 'Atcelt braucienu' }),
    ).not.toHaveFocus();
    expect(screen.getByRole('textbox')).toHaveFocus();
  });

  it('keeps the ride when Dina backs out (edge)', () => {
    const { onClose, onConfirm } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Nē, atstāt' }));

    expect(onClose).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('refuses to cancel while the console is offline, WITH a reason (failure)', () => {
    const { onConfirm } = renderDialog({
      disabledReasonKey: 'console.assign_offline_disabled',
    });

    const confirm = screen.getByRole('button', { name: 'Atcelt braucienu' });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Bezsaistē');
  });

  it('surfaces a failed cancel rather than closing silently (failure)', () => {
    renderDialog({ errorKey: 'console.cancel_failed' });

    expect(screen.getByRole('alert')).toHaveTextContent('Neizdevās atcelt');
  });
});
