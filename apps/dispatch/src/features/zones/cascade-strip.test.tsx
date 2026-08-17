import { formatMessage, type DispatchBoardEvent } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CascadeStrip } from './cascade-strip';

type Cascade = NonNullable<DispatchBoardEvent['rides'][number]['cascade']>;

const NOW_MS = Date.parse('2026-08-15T12:00:00.000Z');

const cascade = (over: Partial<Cascade> = {}): Cascade => ({
  offeredToDriverId: 'd0000000-0000-4000-8000-000000000001',
  offeredToName: 'Jānis Ozols',
  expiresAt: new Date(NOW_MS + 12_000).toISOString(),
  nextDriverName: 'Māra Liepa',
  attempts: 1,
  explanation: {
    key: 'explain.geozone_queue',
    params: { zone: 'Āgenskalns', position: 1, minutes: 47, eta: 4 },
  },
  ...over,
});

describe('CascadeStrip', () => {
  it('names the holder, the countdown, who is next and why (expected)', () => {
    render(<CascadeStrip cascade={cascade()} nowMs={NOW_MS} />);

    expect(
      screen.getByText(
        formatMessage('lv', 'console.cascade_offered_to', {
          driver: 'Jānis Ozols',
        }),
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(
      screen.getByText(
        formatMessage('lv', 'console.cascade_next', { driver: 'Māra Liepa' }),
      ),
    ).toBeInTheDocument();
    // The sentence the DRIVER is reading, rendered from the server's key.
    expect(
      screen.getByText('Āgenskalns rinda #1 · zonā 47 min · 4 min attālumā'),
    ).toBeInTheDocument();
  });

  it('re-derives the countdown from the board’s clock, with no timer of its own (expected)', () => {
    const { rerender } = render(
      <CascadeStrip cascade={cascade()} nowMs={NOW_MS} />,
    );
    expect(screen.getByText('12')).toBeInTheDocument();

    // `use-board` already ticks nowMs at 1 Hz; a second timer here would drift
    // against it and the wrong one is the one Dina reads.
    rerender(<CascadeStrip cascade={cascade()} nowMs={NOW_MS + 9_000} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('floors a lapsed offer at 0 rather than counting past it (edge)', () => {
    render(<CascadeStrip cascade={cascade()} nowMs={NOW_MS + 15_000} />);

    // The frame is up to 2 s behind the deadline it carries, so this is an
    // ordinary moment in the cascade — and «-3» reads as a broken board.
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/-\d/)).not.toBeInTheDocument();
  });

  it('says nobody is holding it, with the attempt count, between offers (edge)', () => {
    render(
      <CascadeStrip
        cascade={cascade({
          offeredToDriverId: null,
          offeredToName: null,
          expiresAt: null,
          nextDriverName: null,
          attempts: 3,
          explanation: null,
        })}
        nowMs={NOW_MS}
      />,
    );

    expect(
      screen.getByText(formatMessage('lv', 'console.cascade_unheld')),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        formatMessage('lv', 'console.cascade_attempts', { count: 3 }),
      ),
    ).toBeInTheDocument();
  });

  it('omits “who is next” rather than guessing outside queue mode (edge)', () => {
    render(
      <CascadeStrip
        cascade={cascade({
          nextDriverName: null,
          explanation: { key: 'explain.auto_match', params: { eta: 4 } },
        })}
        nowMs={NOW_MS}
      />,
    );

    expect(screen.queryByText(/Nākamais/)).not.toBeInTheDocument();
    expect(screen.getByText('Tuvākais · 4 min attālumā')).toBeInTheDocument();
  });

  it('drops an unknown explanation key instead of throwing (failure)', () => {
    // An api one deploy ahead of this bundle. The strip loses a sentence; it
    // does not take the ride queue down.
    render(
      <CascadeStrip
        cascade={cascade({
          explanation: { key: 'explain.something_newer', params: {} },
        })}
        nowMs={NOW_MS}
      />,
    );

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.queryByText(/explain\./)).not.toBeInTheDocument();
  });
});
