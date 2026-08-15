'use client';

import { formatMessage, type Language } from '@taxi/shared';
import { useState } from 'react';
import {
  AlertsPanel,
  BoardMap,
  ConnectionPill,
  RideQueue,
  useBoard,
  ZonesPanel,
} from '@/features/board';

const LANG: Language = 'lv';

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString('lv-LV', {
    hour: '2-digit',
    minute: '2-digit',
  });

/**
 * Dina's board. Monitoring = 0 interactions; the only controls are the view
 * toggle, alert acknowledge/mute, and the offline retry — each one click.
 */
export default function DispatchPage() {
  const { board, pill, nowMs, retry, ack } = useBoard();
  const [view, setView] = useState<'zones' | 'map'>('zones');

  const frame = board.frame;
  const flashRideIds = new Set(
    board.alerts
      .filter((a) => a.kind === 'unclaimed')
      .map((a) => a.rideId),
  );

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    minHeight: 44,
    padding: 'var(--spacing-xs) var(--spacing-md)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-accent)' : 'var(--color-bg-surface)',
    color: active ? 'var(--color-accent-fg)' : 'var(--color-fg)',
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    cursor: 'pointer',
  });

  return (
    <main
      className="console"
      style={{
        minHeight: '100dvh',
        display: 'grid',
        alignContent: 'start',
        gap: 'var(--spacing-lg)',
        padding: 'var(--spacing-lg)',
        background: 'var(--color-bg)',
        color: 'var(--color-fg)',
      }}
    >
      {/* The S9-4 flash. Reduced motion trades the pulse for a static mark. */}
      <style>{`
        @keyframes console-flash { 50% { background: var(--color-warning); } }
        .console-flash { animation: console-flash 1.2s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .console-flash { animation: none; outline: 2px solid var(--color-warning); }
        }
      `}</style>

      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--spacing-md)',
          flexWrap: 'wrap',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
          {formatMessage(LANG, 'console.title')}
        </h1>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--spacing-md)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--spacing-xs)' }}>
            <button
              type="button"
              aria-pressed={view === 'zones'}
              onClick={() => setView('zones')}
              style={toggleStyle(view === 'zones')}
            >
              {formatMessage(LANG, 'console.zones')}
            </button>
            <button
              type="button"
              aria-pressed={view === 'map'}
              onClick={() => setView('map')}
              style={toggleStyle(view === 'map')}
            >
              {formatMessage(LANG, 'console.map')}
            </button>
          </div>
          <ConnectionPill pill={pill} />
        </div>
      </header>

      {pill === 'offline' && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--spacing-md)',
            padding: 'var(--spacing-sm) var(--spacing-md)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-warning)',
            color: 'var(--color-accent-fg)',
            fontSize: 'var(--font-size-sm)',
          }}
        >
          <span>
            {formatMessage(LANG, 'console.stale_banner', {
              time:
                board.lastFrameAtMs !== null
                  ? timeOf(board.lastFrameAtMs)
                  : frame !== null
                    ? timeOf(Date.parse(frame.at))
                    : '—',
            })}
          </span>
          <button
            type="button"
            onClick={retry}
            style={{
              minHeight: 44,
              padding: 'var(--spacing-xs) var(--spacing-md)',
              borderRadius: 'var(--radius-md)',
              border: 'none',
              background: 'var(--color-accent)',
              color: 'var(--color-accent-fg)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            {formatMessage(LANG, 'console.retry')}
          </button>
        </div>
      )}

      {frame === null ? (
        <p role="status" style={{ fontSize: 'var(--font-size-lg)', margin: 0 }}>
          {formatMessage(LANG, 'console.loading')}
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)',
            gap: 'var(--spacing-lg)',
            alignItems: 'start',
          }}
        >
          <RideQueue
            rides={frame.rides}
            nowMs={nowMs}
            flashRideIds={flashRideIds}
          />
          <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
            {view === 'zones' ? (
              <ZonesPanel drivers={frame.drivers} />
            ) : (
              <BoardMap drivers={frame.drivers} />
            )}
            <AlertsPanel alerts={board.alerts} ack={ack} />
          </div>
        </div>
      )}
    </main>
  );
}
