import { formatMessage, type DispatchBoardEvent } from '@taxi/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ZoneGrid } from './zone-grid';

type BoardZone = DispatchBoardEvent['zones'][number];
type ZoneEntry = BoardZone['entries'][number];

const entry = (over: Partial<ZoneEntry> = {}): ZoneEntry => ({
  driverId: 'd0000000-0000-4000-8000-000000000001',
  name: 'Jānis Ozols',
  phone: '+37129999001',
  position: 1,
  secondsInZone: 2_820, // 47 min
  status: 'online',
  ...over,
});

const zone = (over: Partial<BoardZone> = {}): BoardZone => ({
  geozoneId: 'e0000000-0000-4000-8000-000000000001',
  slug: 'centrs',
  name: 'Centrs',
  queueModeEnabled: true,
  entries: [entry()],
  ...over,
});

describe('ZoneGrid', () => {
  it('shows each zone’s rank with position, time-in-queue and phone (expected)', () => {
    render(
      <ZoneGrid
        zones={[
          zone({
            entries: [
              entry(),
              entry({
                driverId: 'd0000000-0000-4000-8000-000000000002',
                name: 'Māra Liepa',
                phone: '+37129999002',
                position: 2,
                secondsInZone: 60,
              }),
            ],
          }),
        ]}
      />,
    );

    const row = screen.getByRole('row', { name: /Centrs/ });
    expect(within(row).getByText('1')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
    expect(
      within(row).getByText(
        formatMessage('lv', 'console.zone_time', { minutes: 47 }),
      ),
    ).toBeInTheDocument();
    // Degraded mode means dispatching by voice — the number is never a click away.
    expect(within(row).getByText('+37129999001')).toHaveAttribute(
      'href',
      'tel:+37129999001',
    );
  });

  it('draws a configured zone that nobody is queued in (expected)', () => {
    // The thing `zones-panel.tsx` documented it could not do. An empty rank is
    // where Dina sends the next free car.
    render(
      <ZoneGrid
        zones={[
          zone(),
          zone({
            geozoneId: 'e0000000-0000-4000-8000-000000000002',
            slug: 'lidosta',
            name: 'Lidosta RIX',
            entries: [],
          }),
        ]}
      />,
    );

    const empty = screen.getByRole('row', { name: /Lidosta RIX/ });
    expect(
      within(empty).getByText(formatMessage('lv', 'console.zone_empty')),
    ).toBeInTheDocument();
  });

  it('hides positions in a zone that does not run queue mode (edge)', () => {
    // A rank dispatch does not honour is worse than no rank — it is one
    // drivers will still ring up to argue about.
    render(<ZoneGrid zones={[zone({ queueModeEnabled: false })]} />);

    expect(screen.queryByText('1')).not.toBeInTheDocument();
    expect(
      screen.getByText(formatMessage('lv', 'console.zone_queue_mode_off')),
    ).toBeInTheDocument();
    // The driver is still listed — only the number they cannot rely on is gone.
    expect(screen.getByText('Jānis Ozols')).toBeInTheDocument();
  });

  it('keeps a queued driver who has gone offline, marked as such (edge)', () => {
    render(<ZoneGrid zones={[zone({ entries: [entry({ status: 'offline' })] })]} />);

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        formatMessage('lv', 'console.driver_status_offline'),
      ),
    ).toBeInTheDocument();
  });

  it('announces the position rather than reading out a bare digit (expected)', () => {
    render(<ZoneGrid zones={[zone()]} />);

    expect(
      screen.getByLabelText(
        formatMessage('lv', 'console.zone_queue_position', { position: 1 }),
      ),
    ).toBeInTheDocument();
  });

  it('renders a message, not an empty table, when no zone is configured (failure)', () => {
    render(<ZoneGrid zones={[]} />);

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(
      screen.getByText(formatMessage('lv', 'console.zone_empty')),
    ).toBeInTheDocument();
  });
});
