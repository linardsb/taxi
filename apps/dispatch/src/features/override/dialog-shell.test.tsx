import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DialogShell } from './dialog-shell';

function renderShell(children: React.ReactNode, onClose = vi.fn()) {
  render(
    <DialogShell title="Dialogs" onClose={onClose}>
      {children}
    </DialogShell>,
  );
  return { onClose };
}

describe('DialogShell', () => {
  it('focuses a leading select on open (expected)', () => {
    renderShell(
      <>
        <select aria-label="Iemesls">
          <option value="a">A</option>
        </select>
        <button type="button">Labi</button>
      </>,
    );

    expect(screen.getByRole('combobox', { name: 'Iemesls' })).toHaveFocus();
  });

  it('wraps Tab from the last button to a first select (edge)', () => {
    renderShell(
      <>
        <select aria-label="Iemesls">
          <option value="a">A</option>
        </select>
        <button type="button">Pirmā</button>
        <button type="button">Pēdējā</button>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Iemesls' });
    const last = screen.getByRole('button', { name: 'Pēdējā' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    expect(select).toHaveFocus();
  });

  it('wraps Shift+Tab from a first select to the last button (edge)', () => {
    renderShell(
      <>
        <select aria-label="Iemesls">
          <option value="a">A</option>
        </select>
        <button type="button">Pēdējā</button>
      </>,
    );
    const select = screen.getByRole('combobox', { name: 'Iemesls' });

    expect(select).toHaveFocus();
    fireEvent.keyDown(select, { key: 'Tab', shiftKey: true });

    expect(screen.getByRole('button', { name: 'Pēdējā' })).toHaveFocus();
  });

  it('skips a disabled select in the trap (edge)', () => {
    renderShell(
      <>
        <select aria-label="Iemesls" disabled>
          <option value="a">A</option>
        </select>
        <button type="button">Pirmā</button>
        <button type="button">Pēdējā</button>
      </>,
    );
    const last = screen.getByRole('button', { name: 'Pēdējā' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    expect(screen.getByRole('button', { name: 'Pirmā' })).toHaveFocus();
  });

  it('closes on Escape (failure-safe exit)', () => {
    const { onClose } = renderShell(<button type="button">Labi</button>);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Labi' }), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalled();
  });
});
