'use client';

import {
  formatMessage,
  trackingViewSchema,
  type Language,
  type TrackingPageState,
  type TrackingView,
} from '@taxi/shared';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef, useState } from 'react';
import { statusLine } from './states';

const POLL_MS = 5_000;
const TERMINAL = new Set<TrackingPageState>([
  'completed',
  'cancelled',
  'expired',
]);

/**
 * The live half of the tracking page: status line, driver card, map and the
 * offline banner, re-fed every 5 s by the same-origin `/t/:token/data` proxy
 * (no CORS, API origin hidden). Initial markup server-renders from the SSR
 * view; Leaflet itself touches `window`, so it loads only inside an effect.
 */
export function TrackingLive({
  token,
  lang,
  initial,
}: Readonly<{ token: string; lang: Language; initial: TrackingView }>) {
  const [view, setView] = useState(initial);
  const [fatal, setFatal] = useState<'expired' | 'not_found' | null>(null);
  const [offline, setOffline] = useState(false);
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(null);

  const mapNode = useRef<HTMLDivElement | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);

  const done = fatal !== null || TERMINAL.has(view.state);

  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/t/${token}/data`, { cache: 'no-store' });
          if (res.status === 410) return setFatal('expired');
          if (res.status === 404) return setFatal('not_found');
          if (!res.ok) return setOffline(true);
          setView(trackingViewSchema.parse(await res.json()));
          setLastSeenAt(new Date());
          setOffline(false);
        } catch {
          setOffline(true); // keep showing the last known data, honestly stamped
        }
      })();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [token, done]);

  // Leaflet is created once a position exists and torn down with the island.
  useEffect(() => {
    const position = view.position;
    if (!position || !mapNode.current || fatal) return;
    let cancelled = false;
    void (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !mapNode.current) return;
      if (!map.current) {
        map.current = L.map(mapNode.current, { zoomControl: false }).setView(
          [position.lat, position.lng],
          15,
        );
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
        }).addTo(map.current);
        marker.current = L.marker([position.lat, position.lng]).addTo(
          map.current,
        );
      } else {
        marker.current?.setLatLng([position.lat, position.lng]);
        map.current.setView([position.lat, position.lng]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view.position, fatal]);

  useEffect(
    () => () => {
      map.current?.remove();
      map.current = null;
      marker.current = null;
    },
    [],
  );

  if (fatal) {
    return (
      <p role="status" style={{ fontSize: 'var(--font-size-lg)' }}>
        {formatMessage(
          lang,
          fatal === 'expired' ? 'page.expired' : 'page.not_found',
        )}
      </p>
    );
  }

  const timeOf = (date: Date) =>
    date.toLocaleTimeString(
      lang === 'lv' ? 'lv-LV' : lang === 'ru' ? 'ru-RU' : 'en-GB',
      { hour: '2-digit', minute: '2-digit' },
    );

  return (
    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
      {/* polite: state changes are announced, the 5 s position churn is not —
          only this line's TEXT changes when the state does. */}
      <p
        aria-live="polite"
        style={{ fontSize: 'var(--font-size-xl)', fontWeight: 600, margin: 0 }}
      >
        {statusLine(lang, view.state)}
      </p>

      {offline && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning)',
            color: 'var(--color-accent-fg)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          {formatMessage(lang, 'page.connection_lost', {
            time: timeOf(lastSeenAt ?? new Date(view.updatedAt)),
          })}
        </p>
      )}

      {view.driverName !== null && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-md)',
            borderRadius: 'var(--radius-lg)',
            background: 'var(--color-bg-surface)',
            border: '1px solid var(--color-border)',
          }}
        >
          {view.driverPhotoUrl ? (
            // Decorative (the name sits beside it). Plain <img>: driver
            // photos have no known host list yet (#20 owns uploads), and
            // next/image requires one.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={view.driverPhotoUrl}
              alt=""
              width={56}
              height={56}
              style={{ borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span
              aria-hidden="true"
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--color-accent)',
                color: 'var(--color-accent-fg)',
                fontSize: 'var(--font-size-lg)',
              }}
            >
              {view.driverName.charAt(0)}
            </span>
          )}
          <div>
            <p style={{ margin: 0, fontSize: 'var(--font-size-md)' }}>
              <span style={{ color: 'var(--color-fg-muted)' }}>
                {formatMessage(lang, 'page.driver')}:{' '}
              </span>
              {view.driverName}
            </p>
            {view.vehiclePlate !== null && (
              <p
                style={{
                  margin: 0,
                  fontSize: 'var(--font-size-lg)',
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    color: 'var(--color-fg-muted)',
                    fontWeight: 400,
                    fontSize: 'var(--font-size-md)',
                  }}
                >
                  {formatMessage(lang, 'page.plate')}:{' '}
                </span>
                {view.vehiclePlate}
              </p>
            )}
          </div>
        </div>
      )}

      {/* The text alternative IS this line — the map below is aria-hidden. */}
      {view.etaMinutes !== null && (
        <p style={{ margin: 0, fontSize: 'var(--font-size-md)' }}>
          {formatMessage(lang, 'page.eta_minutes', { eta: view.etaMinutes })}
        </p>
      )}

      {view.position !== null && (
        <>
          <div
            ref={mapNode}
            aria-hidden="true"
            style={{
              height: 320,
              borderRadius: 'var(--radius-lg)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg-surface)', // placeholder box until tiles land
            }}
          />
          <p
            style={{
              margin: 0,
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-fg-muted)',
            }}
          >
            {/* The position's OWN recorded time (positionOf contract: the
                caller stamps staleness honestly) — NOT the poll clock, which
                would relabel a silent GPS as fresh every 5 s. */}
            {formatMessage(lang, 'page.position_updated', {
              time: timeOf(new Date(view.position.at)),
            })}
          </p>
        </>
      )}
    </div>
  );
}
