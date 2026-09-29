import { formatMessage } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PinDialog } from './pin-dialog';

describe('PinDialog (#275)', () => {
  it('speaks the PIN and the hint from a status region (expected)', () => {
    render(<PinDialog state={{ kind: 'shown', pin: '0042' }} onClose={vi.fn()} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('0042');
    expect(status).toHaveTextContent(formatMessage('lv', 'console.pin_hint'));
  });

  it('shows loading inside the same status region before the PIN lands (edge)', () => {
    render(<PinDialog state={{ kind: 'loading' }} onClose={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(
      formatMessage('lv', 'console.loading'),
    );
  });

  it('renders a failed read as an alert, with no PIN (failure)', () => {
    render(
      <PinDialog
        state={{ kind: 'error', key: 'console.pin_failed' }}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      formatMessage('lv', 'console.pin_failed'),
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('closes from «Aizvērt» (expected)', () => {
    const onClose = vi.fn();
    render(<PinDialog state={{ kind: 'shown', pin: '0042' }} onClose={onClose} />);

    fireEvent.click(
      screen.getByRole('button', {
        name: formatMessage('lv', 'console.booking_close'),
      }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
