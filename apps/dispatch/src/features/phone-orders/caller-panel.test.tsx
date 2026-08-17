import type { CallerLookup } from '@taxi/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { VenueEntry } from './booking-api';
import { CallerPanel } from './caller-panel';

const PICKUP = {
  location: { lat: 56.9496, lng: 24.1052 },
  address: 'Kaļķu iela 28, Rīga',
};
const DESTINATION = {
  location: { lat: 56.9236, lng: 23.9711 },
  address: 'Lidosta Rīga',
};

const LOOKUP: CallerLookup = {
  userId: '00000000-0000-4000-8000-00000000u001',
  customer: {
    id: '00000000-0000-4000-8000-00000000c001',
    userId: '00000000-0000-4000-8000-00000000u001',
    label: 'Anna B. (regulārā)',
    isVenue: false,
    notes: null,
  },
  savedPlaces: [],
  recentRides: [
    {
      rideId: '00000000-0000-4000-8000-00000000r001',
      pickup: PICKUP,
      destination: DESTINATION,
      bookedAt: new Date('2026-08-01T10:00:00Z'),
    },
  ],
};

const VENUE: VenueEntry = {
  customer: {
    id: '00000000-0000-4000-8000-00000000c002',
    userId: '00000000-0000-4000-8000-00000000u002',
    label: 'Hotel Roma',
    isVenue: true,
    notes: null,
  },
  places: [
    {
      id: '00000000-0000-4000-8000-00000000p001',
      customerId: '00000000-0000-4000-8000-00000000c002',
      kind: 'pickup',
      label: 'Ieeja',
      point: PICKUP,
      placeId: 'place-1',
    },
  ],
};

function renderPanel(
  over: {
    lookup?: CallerLookup | null;
    lookupState?: 'idle' | 'searching' | 'none' | 'failed';
    venues?: VenueEntry[];
  } = {},
) {
  const onUseRecent = vi.fn();
  const onPickVenue = vi.fn();
  const onPhoneChange = vi.fn();
  render(
    <CallerPanel
      phone="+37129999000"
      callerName=""
      lookup={over.lookup ?? null}
      lookupState={over.lookupState ?? 'idle'}
      venues={over.venues ?? []}
      onPhoneChange={onPhoneChange}
      onCallerNameChange={vi.fn()}
      onUseRecent={onUseRecent}
      onPickVenue={onPickVenue}
    />,
  );
  return { onUseRecent, onPickVenue, onPhoneChange };
}

describe('CallerPanel', () => {
  it('shows the caller label and their last jobs (expected)', () => {
    renderPanel({ lookup: LOOKUP });

    expect(screen.getByText('Anna B. (regulārā)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Kaļķu iela 28, Rīga → Lidosta Rīga/,
      }),
    ).toBeInTheDocument();
  });

  it('reuses a past job as pickup and destination, and nothing else (expected)', () => {
    const { onUseRecent } = renderPanel({ lookup: LOOKUP });

    fireEvent.click(screen.getByRole('button', { name: /Kaļķu iela 28/ }));

    // Two addresses, no payment method, no note, no category — evidence F2.2's
    // "Clean jobs" rule, enforced by what this callback CAN carry.
    expect(onUseRecent).toHaveBeenCalledWith(PICKUP, DESTINATION);
  });

  it('quick-books a venue from its fixed pickup (expected)', () => {
    const { onPickVenue } = renderPanel({ venues: [VENUE] });

    fireEvent.click(screen.getByRole('button', { name: /Hotel Roma/ }));

    expect(onPickVenue).toHaveBeenCalledWith(PICKUP);
  });

  it('names an unknown number as a new caller (edge)', () => {
    renderPanel({ lookup: null, lookupState: 'none' });

    expect(screen.getByText('Jauns zvanītājs')).toBeInTheDocument();
  });

  it('shows an app-only rider their history without a label (edge)', () => {
    renderPanel({ lookup: { ...LOOKUP, customer: null } });

    // No `customers` row means no label — but the last jobs are the useful
    // half of the pop and must still be offered.
    expect(screen.queryByText('Anna B. (regulārā)')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Kaļķu iela 28/ }),
    ).toBeInTheDocument();
  });

  it('omits a venue with no saved pickup (edge)', () => {
    renderPanel({ venues: [{ ...VENUE, places: [] }] });

    expect(screen.getByText('Nav saglabātu iestāžu')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Hotel Roma/ }),
    ).not.toBeInTheDocument();
  });

  it('says so when the lookup itself failed (failure)', () => {
    renderPanel({ lookup: null, lookupState: 'failed' });

    expect(screen.getByText('Neizdevās atrast zvanītāju')).toBeInTheDocument();
  });
});
