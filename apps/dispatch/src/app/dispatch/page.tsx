'use client';

import {
  formatMessage,
  type BoardRideStatus,
  type Language,
} from '@taxi/shared';
import { useCallback, useState } from 'react';
import {
  AlertsPanel,
  BoardMap,
  ConnectionPill,
  DriverList,
  isPanelStale,
  isStale,
  RideQueue,
  useBoard,
} from '@/features/board';
import { ZoneGrid } from '@/features/zones';
import {
  AssignDialog,
  assignVerb,
  CancelDialog,
  pickupZoneOf,
  useAssign,
} from '@/features/override';
import {
  BookingForm,
  NewOrderButton,
  useNewOrderHotkey,
} from '@/features/phone-orders';

const LANG: Language = 'lv';

/** Which override dialog is open, and on which ride. */
type OverrideTarget =
  | { kind: 'assign'; rideId: string; status: BoardRideStatus }
  | { kind: 'cancel'; rideId: string };

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
  // TWO CLOCKS, BOTH IN SCOPE HERE, AND THEY ARE NOT INTERCHANGEABLE (#238).
  // `nowMs` is the browser's and belongs with `lastFrameAtMs`, which is a
  // `Date.now()` this machine recorded — `isStale` and `isPanelStale` below.
  // `serverNowMs` is the api's and belongs with every timestamp off the wire:
  // `requestedAt`, `lastSeenAt`, `cascade.expiresAt`, so `RideQueue` and
  // `DriverList`. Both are `number`, so nothing but these names stops a
  // future edit from pairing the wrong two.
  const { board, pill, nowMs, serverNowMs, retry, ack } = useBoard();
  const [view, setView] = useState<'zones' | 'map'>('zones');
  const [target, setTarget] = useState<OverrideTarget | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const assignApi = useAssign();
  const { loadRoster, reset } = assignApi;

  const openBookingForm = useCallback(() => setBookingOpen(true), []);
  // Closing keeps the draft: it lives in localStorage, so ⌥N reopens it exactly
  // where the last call left off.
  const closeBookingForm = useCallback(() => setBookingOpen(false), []);
  useNewOrderHotkey(openBookingForm);

  const frame = board.frame;

  /**
   * Every write is refused while the pill says «Bezsaistē», WITH a reason.
   * A dispatcher who force-assigns into a dead socket and sees nothing happen
   * is the exact silent failure #18 was built to eliminate — and the board she
   * would be reading to check is itself stale.
   */
  const disabledReasonKey =
    pill === 'offline' ? ('console.assign_offline_disabled' as const) : null;

  const openAssign = useCallback(
    (ride: { rideId: string; status: BoardRideStatus }) => {
      reset();
      setTarget({ kind: 'assign', rideId: ride.rideId, status: ride.status });
      // Fetched on OPEN, never on the board's cadence — see dispatchRosterSchema.
      void loadRoster();
    },
    [loadRoster, reset],
  );

  const openCancel = useCallback(
    (ride: { rideId: string }) => {
      reset();
      setTarget({ kind: 'cancel', rideId: ride.rideId });
    },
    [reset],
  );
  const flashRideIds = new Set(
    board.alerts.filter((a) => a.kind === 'unclaimed').map((a) => a.rideId),
  );

  /**
   * The plan's Error state (UX → States): the banner + retry belong to
   * STALENESS, not to «Bezsaistē». Gating them on `pill === 'offline'` left
   * the worst case uncovered — handshake fine, emitter broken (a board build
   * throwing every beat), so `connected` is true, no frame ever arrives, and
   * the pill sits at «Atjaunojas…» indefinitely with no age shown and nothing
   * to click, while ride ages keep ticking off the 1 Hz clock and make the
   * panel look alive.
   *
   * Shown while offline (unchanged), or once a frame we HAVE has gone stale.
   * `frame !== null` keeps it off the cold first paint, where the loading
   * state already speaks and there is no "last known data" to caveat.
   */
  const showStaleBanner =
    pill === 'offline' ||
    (frame !== null && isStale(nowMs, board.lastFrameAtMs));
  // «Bezsaistē» would be a lie when the socket is up and merely silent.
  const staleBannerKey =
    pill === 'offline' ? 'console.stale_banner' : 'console.stale_banner_silent';

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
        {/* `-1` so `DialogShell` can land focus here when the row button it
            captured was unmounted by a board frame while the dialog was open.
            Programmatic only — never a tab stop. */}
        <h1 tabIndex={-1} style={{ margin: 0, fontSize: 'var(--font-size-lg)' }}>
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
          {/* Before the pill in the tab order: taking an order is the one
              thing on this screen that cannot wait for a caller to repeat
              themselves. */}
          <NewOrderButton onOpen={openBookingForm} />
          <ConnectionPill pill={pill} />
        </div>
      </header>

      {showStaleBanner && (
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
            {formatMessage(LANG, staleBannerKey, {
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
            serverNowMs={serverNowMs}
            flashRideIds={flashRideIds}
            onAssign={openAssign}
            onCancel={openCancel}
          />
          <div style={{ display: 'grid', gap: 'var(--spacing-lg)' }}>
            {view === 'zones' ? (
              <ZoneGrid zones={frame.zones} />
            ) : (
              <BoardMap drivers={frame.drivers} />
            )}
            {/* OUTSIDE the toggle on purpose (#234). The map is the only other
                place `frame.drivers` reaches the DOM, it is aria-hidden, and
                it is unmounted in the default zones view — so a freshness
                signal inside either branch is invisible in the other.

                `boardStale` is FRAME AGE, not the banner's condition, and the
                two deliberately differ. Per-driver freshness is a ticking
                clock against a frozen field, so a console that has stopped
                receiving would otherwise report every driver as silent —
                that is what this prop is for, and #238's offset does not
                touch it (that fixes WHICH clock ticks, not whether frames
                arrive). But the banner also fires on
                `pill === 'offline'`, and while the pill is «Bezsaistē» the
                read-only poll is refreshing `lastFrameAtMs` every cycle, so
                passing `showStaleBanner` blanked the panel with a
                one-second-old frame (PR #236 review round 2, M2). The window
                is `PANEL_STALE_MS`, wider than the banner's for the reason
                its docblock derives. The banner can be up while the panel
                keeps reading the rows, and that is correct: the operator is
                told the socket is down and the rows are still true. */}
            <DriverList
              drivers={frame.drivers}
              serverNowMs={serverNowMs}
              boardStale={isPanelStale(nowMs, board.lastFrameAtMs)}
            />
            <AlertsPanel alerts={board.alerts} ack={ack} />
          </div>
        </div>
      )}

      {target?.kind === 'assign' && (
        <AssignDialog
          // Remounted per ride, so a dialog opened on the next ride never
          // inherits the previous one's picked driver or typed reason.
          key={target.rideId}
          verb={assignVerb(target.status) ?? 'assign'}
          pickupZoneName={pickupZoneOf(frame, target.rideId)}
          drivers={assignApi.roster}
          loadingRoster={assignApi.loadingRoster}
          submitting={assignApi.submitting}
          errorKey={assignApi.errorKey}
          disabledReasonKey={disabledReasonKey}
          onClearError={reset}
          onClose={() => setTarget(null)}
          onSubmit={(driverId, reason) => {
            const write =
              assignVerb(target.status) === 'reassign'
                ? assignApi.reassign
                : assignApi.assign;
            void write(target.rideId, driverId, reason).then((outcome) => {
              // Closed only on success. A failure keeps the dialog open with
              // the error visible; the board's next frame (≤2 s) has already
              // corrected whatever moved underneath.
              if (outcome.ok) setTarget(null);
            });
          }}
        />
      )}

      {bookingOpen && (
        // NOT keyed and NOT remounted per open: the draft is the whole point,
        // and a fresh mount would restore it from storage anyway — this just
        // avoids the flicker of doing so.
        <BookingForm offline={pill === 'offline'} onClose={closeBookingForm} />
      )}

      {target?.kind === 'cancel' && (
        <CancelDialog
          key={target.rideId}
          submitting={assignApi.submitting}
          errorKey={assignApi.errorKey}
          disabledReasonKey={disabledReasonKey}
          onClose={() => setTarget(null)}
          onConfirm={(reason) => {
            void assignApi.cancel(target.rideId, reason).then((outcome) => {
              if (outcome.ok) setTarget(null);
            });
          }}
        />
      )}
    </main>
  );
}
