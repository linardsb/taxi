import { formatMessage, type DispatchBoardEvent } from '@taxi/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoardMap } from './board-map';

/**
 * Structural leaflet stub, duplicated per file on purpose (the house
 * convention from the tracking suite). L.marker mints a NEW stub per call —
 * the board keeps one marker per driver, so a shared object would conflate
 * their setLatLng histories.
 */
const mapStub = {
  setView: vi.fn(),
  remove: vi.fn(),
  attributionControl: { setPrefix: vi.fn() },
};
mapStub.setView.mockReturnValue(mapStub);
const markers: Array<{
  setLatLng: ReturnType<typeof vi.fn>;
  addTo: ReturnType<typeof vi.fn>;
  bindTooltip: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}> = [];
vi.mock('leaflet', () => ({
  default: {
    map: () => mapStub,
    tileLayer: () => ({ addTo: vi.fn() }),
    marker: () => {
      const marker = {
        setLatLng: vi.fn(),
        addTo: vi.fn(),
        bindTooltip: vi.fn(),
        remove: vi.fn(),
      };
      marker.addTo.mockReturnValue(marker);
      marker.bindTooltip.mockReturnValue(marker);
      markers.push(marker);
      return marker;
    },
  },
}));

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

afterEach(() => {
  vi.clearAllMocks();
  markers.length = 0;
});

describe('BoardMap', () => {
  it('adds one marker per positioned driver and names the text alternative (expected)', async () => {
    render(
      <BoardMap
        drivers={[
          driver({}),
          driver({
            driverId: 'd0000000-0000-4000-8000-000000000002',
            location: { lat: 56.96, lng: 24.12 },
          }),
        ]}
      />,
    );
    await act(async () => {}); // flush the dynamic import('leaflet')

    expect(markers).toHaveLength(2);
    expect(
      screen.getByText(formatMessage('lv', 'console.map_alt')),
    ).toBeInTheDocument();
  });

  it('skips a driver with no recorded position (edge)', async () => {
    render(
      <BoardMap
        drivers={[driver({ location: null, lastSeenAt: null, zoneName: null })]}
      />,
    );
    await act(async () => {});

    expect(markers).toHaveLength(0);
  });

  it('moves an existing marker and removes a departed driver (edge)', async () => {
    const { rerender } = render(
      <BoardMap
        drivers={[
          driver({}),
          driver({
            driverId: 'd0000000-0000-4000-8000-000000000002',
            location: { lat: 56.96, lng: 24.12 },
          }),
        ]}
      />,
    );
    await act(async () => {});
    expect(markers).toHaveLength(2);

    rerender(
      <BoardMap
        drivers={[driver({ location: { lat: 56.99, lng: 24.2 } })]}
      />,
    );
    await act(async () => {});

    expect(markers[0]!.setLatLng).toHaveBeenCalledWith([56.99, 24.2]);
    expect(markers[1]!.remove).toHaveBeenCalled(); // went offline, marker gone
  });

  it('labels a marker with a NODE, never a string — the tooltip is an innerHTML sink (failure)', async () => {
    // leaflet's DivOverlay._updateContent does `node.innerHTML = content` for
    // string content, so a string here would be the one place a driver's
    // display name renders unescaped. #20 starts populating that field from
    // driver-submitted data.
    render(<BoardMap drivers={[driver({ name: '<img src=x onerror=1>' })]} />);
    await act(async () => {});

    const label = markers[0]!.bindTooltip.mock.calls[0]![0] as HTMLElement;
    expect(label).toBeInstanceOf(HTMLElement);
    expect(label.textContent).toBe('<img src=x onerror=1>');
    expect(label.querySelector('img')).toBeNull(); // never parsed as markup
  });

  it('drops leaflet’s attribution prefix — no focusable link inside aria-hidden (edge)', async () => {
    render(<BoardMap drivers={[driver({})]} />);
    await act(async () => {});

    // The default prefix is an <a> to leafletjs.com; the map container is
    // aria-hidden, so a Tab stop there is unreachable to a screen reader.
    expect(mapStub.attributionControl.setPrefix).toHaveBeenCalledWith(false);
  });

  it('tears the map down on unmount (failure)', async () => {
    const { unmount } = render(<BoardMap drivers={[driver({})]} />);
    await act(async () => {});

    unmount();
    expect(mapStub.remove).toHaveBeenCalled();
  });
});
