import { formatMessage } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConnectionPill } from './connection-pill';

describe('ConnectionPill', () => {
  it('claims live only in the live state (expected)', () => {
    render(<ConnectionPill pill="live" />);
    expect(
      screen.getByText(formatMessage('lv', 'console.live')),
    ).toBeInTheDocument();
  });

  it('shows the reconnecting state distinctly (edge)', () => {
    render(<ConnectionPill pill="reconnecting" />);
    expect(
      screen.getByText(formatMessage('lv', 'console.reconnecting')),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(formatMessage('lv', 'console.live')),
    ).not.toBeInTheDocument();
  });

  it('admits being offline — the truthful pill (failure)', () => {
    render(<ConnectionPill pill="offline" />);
    expect(
      screen.getByText(formatMessage('lv', 'console.offline')),
    ).toBeInTheDocument();
  });
});
