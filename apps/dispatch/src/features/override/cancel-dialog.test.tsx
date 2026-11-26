import { fireEvent, render, screen } from '@testing-library/react';
import { CANCEL_REASONS } from '@taxi/shared';
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

const CONFIRM = 'Atcelt braucienu';

function pickReason(code: string) {
  fireEvent.change(screen.getByRole('combobox', { name: 'Iemesls' }), {
    target: { value: code },
  });
}

describe('CancelDialog', () => {
  it('cancels with the chosen reason code and no note (expected)', () => {
    const { onConfirm } = renderDialog();

    pickReason('dispatcher_rider_request');
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).toHaveBeenCalledWith({
      reasonCode: 'dispatcher_rider_request',
      reasonText: null,
    });
  });

  it('sends the trimmed note alongside the code (expected)', () => {
    const { onConfirm } = renderDialog();

    pickReason('dispatcher_rider_request');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: '  zvanītājs pārdomāja  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).toHaveBeenCalledWith({
      reasonCode: 'dispatcher_rider_request',
      reasonText: 'zvanītājs pārdomāja',
    });
  });

  it('sends null rather than a whitespace-only note (edge)', () => {
    const { onConfirm } = renderDialog();

    pickReason('dispatcher_duplicate_booking');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).toHaveBeenCalledWith({
      reasonCode: 'dispatcher_duplicate_booking',
      reasonText: null,
    });
  });

  it('blocks confirm with no reason, explains why and focuses the select (empty)', () => {
    const { onConfirm } = renderDialog();
    const select = screen.getByRole('combobox', { name: 'Iemesls' });
    expect(select).toHaveAttribute('aria-invalid', 'false');

    // Move focus off the select so the assertion proves the dialog put it back.
    screen.getByRole('textbox').focus();
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Izvēlieties atcelšanas iemeslu',
    );
    expect(select).toHaveAttribute('aria-invalid', 'true');
    expect(select).toHaveAttribute('aria-describedby', 'cancel-reason-error');
    expect(select).toHaveFocus();
  });

  it('clears the missing-reason alert once a reason is chosen (edge)', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    pickReason('dispatcher_rider_request');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Iemesls' })).toHaveAttribute(
      'aria-invalid',
      'false',
    );
  });

  it('blocks an "other" reason without a note and focuses the note (edge)', () => {
    const { onConfirm } = renderDialog();

    pickReason('dispatcher_other');
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Iemeslam 'cits' vajag piezīmi",
    );
    const note = screen.getByRole('textbox');
    expect(note).toHaveAttribute('aria-invalid', 'true');
    expect(note).toHaveFocus();

    // A whitespace-only note does not satisfy it either.
    fireEvent.change(note, { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    expect(onConfirm).not.toHaveBeenCalled();

    fireEvent.change(note, { target: { value: 'sīkāk pa tālruni' } });
    fireEvent.click(screen.getByRole('button', { name: CONFIRM }));
    expect(onConfirm).toHaveBeenCalledWith({
      reasonCode: 'dispatcher_other',
      reasonText: 'sīkāk pa tālruni',
    });
  });

  it('starts on a disabled placeholder so no reason is preselected (edge)', () => {
    renderDialog();
    const select = screen.getByRole('combobox', {
      name: 'Iemesls',
    }) as HTMLSelectElement;

    expect(select.value).toBe('');
    const placeholder = screen.getByRole('option', {
      name: 'Izvēlieties iemeslu',
    }) as HTMLOptionElement;
    expect(placeholder.selected).toBe(true);
    expect(placeholder).toBeDisabled();
  });

  it('offers every dispatcher reason with catalog text, never a raw key (a11y)', () => {
    renderDialog();
    const options = screen.getAllByRole('option') as HTMLOptionElement[];

    // The placeholder plus one option per dispatcher reason.
    expect(options).toHaveLength(CANCEL_REASONS.dispatcher.length + 1);
    for (const option of options) {
      expect(option.textContent?.trim()).toBeTruthy();
      expect(option.textContent).not.toMatch(/^reason\.|^console\./);
    }
    expect(options.map((o) => o.value).slice(1)).toEqual([
      ...CANCEL_REASONS.dispatcher,
    ]);
  });

  it('is reachable as a labelled, required combobox (a11y)', () => {
    renderDialog();

    const select = screen.getByRole('combobox', { name: 'Iemesls' });
    expect(select).toBeRequired();
    expect(select).toHaveAttribute('aria-required', 'true');
  });

  it('does not put focus on the destructive button (edge)', () => {
    renderDialog();

    // A stray Enter on an accidentally-opened dialog must not kill a live
    // ride, so the shell focuses the reason picker first.
    expect(screen.getByRole('button', { name: CONFIRM })).not.toHaveFocus();
    expect(screen.getByRole('combobox', { name: 'Iemesls' })).toHaveFocus();
  });

  it('does not close on a drag that started inside the dialog (edge)', () => {
    const { onClose } = renderDialog();
    const reason = screen.getByRole('textbox');
    const backdrop = screen.getByRole('dialog').parentElement!;

    // Selecting the reason text and releasing past the dialog's edge fires
    // `click` at the backdrop — which used to close the dialog and throw the
    // typed reason away (#120 review L5).
    fireEvent.mouseDown(reason);
    fireEvent.click(backdrop);

    expect(onClose).not.toHaveBeenCalled();

    // A press that genuinely starts on the backdrop still closes it.
    fireEvent.mouseDown(backdrop);
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
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

    pickReason('dispatcher_rider_request');
    const confirm = screen.getByRole('button', { name: CONFIRM });
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Bezsaistē');
  });

  it('disables confirm and marks it busy while submitting (loading)', () => {
    const { onConfirm } = renderDialog({ submitting: true });

    const confirm = screen.getByRole('button', { name: CONFIRM });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute('aria-busy', 'true');

    pickReason('dispatcher_rider_request');
    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('is not busy and is enabled when idle (loading)', () => {
    renderDialog();

    const confirm = screen.getByRole('button', { name: CONFIRM });
    expect(confirm).toBeEnabled();
    expect(confirm).toHaveAttribute('aria-busy', 'false');
  });

  it('surfaces a failed cancel rather than closing silently (failure)', () => {
    renderDialog({ errorKey: 'console.cancel_failed' });

    expect(screen.getByRole('alert')).toHaveTextContent('Neizdevās atcelt');
  });
});
