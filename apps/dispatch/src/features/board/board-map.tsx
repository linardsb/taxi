'use client';

import { formatMessage, type DispatchBoardEvent, type Language } from '@taxi/shared';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef } from 'react';

const LANG: Language = 'lv';

/** Rīga centre — the board map's home view before any driver has a position. */
const RIGA_CENTRE: [number, number] = [56.9496, 24.1052];

type BoardDriver = DispatchBoardEvent['drivers'][number];

/**
 * The driver map — the tracking page's leaflet island pattern, N markers
 * instead of one: type-only static import, runtime import inside the effect,
 * imperative marker updates, unmount-only teardown. `aria-hidden`: the zones
 * panel and phone list ARE the text alternative (console.map_alt says so).
 */
export function BoardMap({ drivers }: Readonly<{ drivers: BoardDriver[] }>) {
  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const markers = useRef(new Map<string, Marker>());

  useEffect(() => {
    if (!mapNode.current) return;
    let cancelled = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapNode.current) return;
      if (!map.current) {
        map.current = L.map(mapNode.current, { zoomControl: false }).setView(
          RIGA_CENTRE,
          12,
        );
        // Leaflet's default attribution prefix is an <a> to leafletjs.com —
        // a focusable element inside an aria-hidden container, which is an
        // AXE violation and a keyboard trap for a screen-reader user (focus
        // lands on a link that is not in the accessibility tree). Dropping
        // the PREFIX keeps the required © OpenStreetMap credit below.
        map.current.attributionControl.setPrefix(false);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
        }).addTo(map.current);
      }

      // Imperative reconciliation: update or add positioned drivers…
      const seen = new Set<string>();
      for (const driver of drivers) {
        if (driver.location === null) continue; // zones panel still lists them
        seen.add(driver.driverId);
        const existing = markers.current.get(driver.driverId);
        if (existing) {
          existing.setLatLng([driver.location.lat, driver.location.lng]);
        } else {
          // A NODE, never a string: leaflet's DivOverlay._updateContent does
          // `node.innerHTML = content` for string content, which would make
          // this the one place a driver's display name is not escaped (React
          // escapes it everywhere else it renders). Nothing writes
          // `displayName` from user input today — #20's driver-onboarding
          // review is the ticket that starts to, in a console whose JWT sits
          // in localStorage by design. `textContent` takes the appendChild
          // branch instead.
          const label = document.createElement('span');
          label.textContent = driver.name;
          markers.current.set(
            driver.driverId,
            L.marker([driver.location.lat, driver.location.lng])
              .addTo(map.current)
              .bindTooltip(label),
          );
        }
      }
      // …and drop markers whose driver left the frame (went offline).
      for (const [driverId, marker] of markers.current) {
        if (seen.has(driverId)) continue;
        marker.remove();
        markers.current.delete(driverId);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drivers]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      markers.current.clear();
    },
    [],
  );

  return (
    <>
      <div
        ref={mapNode}
        aria-hidden="true"
        style={{
          height: 480,
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-bg-surface)', // placeholder until tiles land
        }}
      />
      <p
        style={{
          margin: 0,
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-fg-muted)',
        }}
      >
        {formatMessage(LANG, 'console.map_alt')}
      </p>
    </>
  );
}
