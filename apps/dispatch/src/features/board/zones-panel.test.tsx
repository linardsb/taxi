import { formatMessage, type DispatchBoardEvent } from '@taxi/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZonesPanel } from './zones-panel';

type BoardDriver = DispatchBoardEvent['drivers'][number];

const driver = (over: Partial<BoardDriver>): BoardDriver => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis Ozols',
  phone: '+37129999001',
  location: { lat: 56.95, lng: 24.11 },
  lastSeenAt: '2026-08-15T12:00:00.000Z',
  zoneName: 'Centrs',
  status: 'online',
  ...over,
});

describe('ZonesPanel', () => {
  it('groups drivers into zone cards with counts, names AND phones (expected)', () => {
    render(
      <ZonesPanel
        drivers={[
          driver({}),
          driver({
            driverId: 'd0000000-0000-4000-8000-000000000002',
            name: 'Māra Liepa',
            phone: '+37129999002',
          }),
          driver({
            driverId: 'd0000000-0000-4000-8000-000000000003',
            name: 'Pēteris Kalns',
            phone: '+37129999003',
            zoneName: 'Lidosta RIX',
          }),
        ]}
      />,
    );

    expect(screen.getByText('Centrs (2)')).toBeInTheDocument();
    expect(screen.getByText('Lidosta RIX (1)')).toBeInTheDocument();
    // Degraded-mode requirement: Dina dispatches by voice — phones visible.
    expect(screen.getByText('+37129999001')).toBeInTheDocument();
    expect(screen.getByText('+37129999003')).toBeInTheDocument();
  });

  it('collects zone-less drivers under «Ārpus zonām» (edge)', () => {
    render(
      <ZonesPanel
        drivers={[driver({ zoneName: null, location: null, lastSeenAt: null })]}
      />,
    );

    expect(
      screen.getByText(`${formatMessage('lv', 'console.zone_none')} (1)`),
    ).toBeInTheDocument();
    expect(screen.getByText('Jānis Ozols')).toBeInTheDocument();
  });

  it('renders the empty state when nobody is online (failure)', () => {
    render(<ZonesPanel drivers={[]} />);
    expect(
      screen.getByText(formatMessage('lv', 'console.zone_empty')),
    ).toBeInTheDocument();
  });
});
