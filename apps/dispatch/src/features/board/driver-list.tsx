'use client';

import {
  formatMessage,
  type DispatchBoardEvent,
  type DriverStatus,
  type Language,
  type MessageKey,
} from '@taxi/shared';
import { ageOf } from './age';
import { driverFreshness, type DriverFreshness } from './board-state';

const LANG: Language = 'lv';

type BoardDriver = DispatchBoardEvent['drivers'][number];

/**
 * Restated rather than imported from `zone-grid.tsx`: that map is
 * module-private to the ZONES slice, and reaching across a slice boundary for
 * a label map costs more than four lines do. Total over `DriverStatus`, so
 * adding a status is a build failure here rather than a blank cell.
 */
const DRIVER_STATUS_KEY: Record<DriverStatus, MessageKey> = {
  online: 'console.driver_status_online',
  on_ride: 'console.driver_status_on_ride',
  offline: 'console.driver_status_offline',
};

const DRIVER_STATUS_COLOR: Record<DriverStatus, string> = {
  online: 'var(--color-success)',
  on_ride: 'var(--color-accent)',
  offline: 'var(--color-fg-muted)',
};

/** Total over the union — a fourth state cannot ship without a string. */
const FRESHNESS_KEY: Record<DriverFreshness, MessageKey> = {
  live: 'console.driver_streaming',
  stale: 'console.driver_silent',
  unknown: 'console.driver_no_signal',
};

/**
 * Colour is carried IN ADDITION TO the label, never instead of it. The label
 * is a full word in every state, so the row survives being read aloud, printed
 * in greyscale, or seen by someone who cannot separate green from amber —
 * which is what #234 AC #2 means by "not colour alone".
 */
const FRESHNESS_COLOR: Record<DriverFreshness, string> = {
  live: 'var(--color-success)',
  stale: 'var(--color-warning)',
  unknown: 'var(--color-fg-muted)',
};

const row: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  gap: 'var(--spacing-sm)',
  padding: 'var(--spacing-xs) var(--spacing-sm)',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-surface)',
  fontSize: 'var(--font-size-sm)',
};

/**
 * THE row's freshness — one derivation for the label and the summary, because
 * two would diverge. It is deliberately NOT `driverFreshness` alone: that
 * function reads `lastSeenAt` and two conditions it cannot see would otherwise
 * render «Raida» with no evidence that anyone is reporting.
 *
 * `location === null` — NEVER GOT A FIX. `lastSeenAt` is the `seen` ZSET
 * score, and `markOnline` seeds it at go-online time in the same MULTI as the
 * SADD with no GEOADD (`redis-driver-location.store.ts:75-79`); only the
 * RECORD script writes a position. So a driver who taps the toggle in an
 * underground car park and never gets a lock arrives with a fresh
 * `lastSeenAt` and no fix at all, and `driverFreshness` calls that `live`.
 * `location === null` is precisely the condition `board-state.ts`'s
 * three-states docblock describes, and it is the one the wire carries.
 *
 * `boardStale` — THE CONSOLE IS THE ONE THAT WENT QUIET. `driverFreshness`
 * compares a ticking `serverNowMs` against a frozen `lastSeenAt`, so a
 * console that has stopped RECEIVING freezes `lastSeenAt` exactly as a driver
 * who has stopped SENDING does. #238's offset changes nothing here: it
 * corrects WHICH clock the ticking side reads, not whether the frozen side is
 * still arriving. Attributing the console's own deafness to the drivers
 * is the same over-claim pointing the other way, and `pillFrom` already
 * refuses to call the board `live` without a fresh frame for this reason. The
 * worst case is a cold refresh with the api unreachable: `hydratedBoard()`
 * restores an arbitrarily old frame deliberately, so without this every row
 * would read «Klusē MM:SS» while every phone streams normally.
 *
 * It is FRAME AGE and not the stale banner's condition (`PANEL_STALE_MS`, not
 * `pill === 'offline' || isStale(…)`). The banner fires the moment the socket
 * gives up; the read-only poll then keeps `lastFrameAtMs` current, so the
 * banner's condition blanked this panel while the board was one second old —
 * the over-claim inverted a third time, and the one state the poll fallback
 * exists for. See `board-state.ts`'s `PANEL_STALE_MS`.
 *
 * ONE CONSEQUENCE, ACCEPTED RATHER THAN PAPERED OVER. A driver is `unknown`
 * from the instant they go online until their first fix lands — a GPS cold
 * start is tens of seconds outdoors and does not finish indoors — so the live
 * region names them at login. That is true rather than noisy: `findNearby`
 * filters candidates on the position, so a driver the console cannot place is
 * one the engine will not offer to either, and phoning them is the correct
 * response. A malformed coordinate also yields `location: null`
 * (`redis-driver-location.store.ts:251-254` validates rather than casts), so a
 * driver who IS reporting a bad fix reads «Nav signāla» — the cautious
 * direction, and the right trade for a signal whose whole purpose is to refuse
 * to say more than it can prove.
 */
function rowFreshness(
  driver: BoardDriver,
  serverNowMs: number,
  boardStale: boolean,
): DriverFreshness {
  if (boardStale || driver.location === null) return 'unknown';
  return driverFreshness(serverNowMs, driver.lastSeenAt);
}

/** A driver the board can see, and whether their app is still reporting. */
function DriverRow({
  driver,
  serverNowMs,
  boardStale,
}: Readonly<{ driver: BoardDriver; serverNowMs: number; boardStale: boolean }>) {
  const freshness = rowFreshness(driver, serverNowMs, boardStale);
  return (
    <li style={row}>
      {/* role="img" takes a name; a bare span maps to `generic`, which ARIA
          1.2 puts in the name-PROHIBITED set (see zone-grid.tsx). */}
      <span
        role="img"
        aria-label={formatMessage(LANG, DRIVER_STATUS_KEY[driver.status])}
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          background: DRIVER_STATUS_COLOR[driver.status],
        }}
      />
      <span style={{ fontWeight: 600 }}>{driver.name}</span>
      {/* Dialable, exactly as `zone-grid.tsx:130-141` — and here it matters
          MORE, not less: this panel is the one carrying EVERY online driver,
          so for a driver in no zone queue it is the console's only rendering
          of the number. That driver is the case the feature exists for (an
          `on_ride` driver going dark is never swept), and calling them is the
          single action it leads to. 44px target, as the rule requires. */}
      <a
        href={`tel:${driver.phone}`}
        style={{
          color: 'var(--color-fg-muted)',
          textDecoration: 'none',
          minHeight: 44,
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        {driver.phone}
      </a>
      {driver.zoneName !== null && (
        <span style={{ color: 'var(--color-fg-muted)' }}>
          {driver.zoneName}
        </span>
      )}
      <span
        style={{
          marginLeft: 'auto',
          fontWeight: 600,
          color: FRESHNESS_COLOR[freshness],
        }}
      >
        {formatMessage(LANG, FRESHNESS_KEY[freshness], {
          // Only `console.driver_silent` carries {age}; the other two ignore
          // the extra param, so one call site serves all three states.
          age:
            driver.lastSeenAt === null ? '' : ageOf(serverNowMs, driver.lastSeenAt),
        })}
      </span>
    </li>
  );
}

/**
 * The board's driver list — and the first production reader of the
 * `lastSeenAt` that `applyDriverLocation` has been folding in all along
 * (#234).
 *
 * WHY THIS PANEL EXISTS RATHER THAN A PIN DECORATION. `frame.drivers` had one
 * consumer, `BoardMap`, whose container is `aria-hidden` and which is not even
 * mounted in the default zones view. So the board rendered position and no
 * freshness, and a parked driver looked exactly like one whose phone had died
 * — the driver app streams a fix every 4 s whether or not the vehicle moves.
 * The page mounts this OUTSIDE the zones/map toggle on purpose; putting it in
 * either branch would restate the defect for the other view.
 *
 * ONE LIVE REGION, NAMING THE SILENT DRIVERS. It is rendered at all times with
 * changing text rather than mounted when something goes wrong: a region
 * inserted at the same moment its content appears is unreliably announced.
 * The names are SORTED before joining, so the text is a function of the SET
 * and not of `frame.drivers`' order — which is `listOnline`'s, which is
 * `SMEMBERS`', documented as not guaranteed (`driver-location.store.ts:88`).
 * `sort()` is code-unit order, taken for STABILITY rather than for Latvian
 * collation; what it buys is that the same set always produces the same
 * string, not that the list reads alphabetically. With the `mm:ss` kept out
 * deliberately (`tracking-map.tsx` states the same rule), the announcement is
 * then the fresh→silent transition and never the per-second tick. Polite and
 * silent: `AlertsPanel` owns the audible budget, and a quiet driver is a
 * condition to read, not an alarm to buzz.
 *
 * SILENT WHILE THE BOARD ITSELF IS STALE. `boardStale` empties the region
 * rather than unmounting it — the region must stay in the DOM (#234's plan),
 * and naming drivers as silent on the strength of the console's own frame
 * gap would announce a fault the drivers do not have. A dead SOCKET is not
 * that gap: the poll fallback keeps the frame current underneath it, so the
 * region keeps naming silent drivers while «Bezsaistē» is on screen.
 */
export function DriverList({
  drivers,
  serverNowMs,
  boardStale,
}: Readonly<{
  drivers: BoardDriver[];
  serverNowMs: number;
  /**
   * The board has no fresh frame — `isPanelStale(serverNowMs, lastFrameAtMs)` at
   * the mount site, NOT `showStaleBanner`. Frame age only: the banner's
   * condition is wider (it also fires on «Bezsaistē»), and passing it blanked
   * this panel while the read-only poll was keeping the board current. So the
   * banner can be up with this `false`, and the rows are right to keep
   * reading. REQUIRED, not defaulted: an optional `false` would let a future
   * mount site drop the discriminator and silently restore the defect with
   * every test still green.
   */
  boardStale: boolean;
}>) {
  const silent = drivers.filter(
    (d) => rowFreshness(d, serverNowMs, boardStale) !== 'live',
  );

  return (
    <section style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
      <h3
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-fg-muted)',
          textTransform: 'uppercase',
        }}
      >
        {formatMessage(LANG, 'console.drivers_title')} ({drivers.length})
      </h3>

      <p
        aria-live="polite"
        style={{
          margin: 0,
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-warning)',
          fontWeight: 600,
        }}
      >
        {boardStale || silent.length === 0
          ? ''
          : formatMessage(LANG, 'console.drivers_silent_summary', {
              names: silent
                .map((d) => d.name)
                .sort()
                .join(', '),
            })}
      </p>

      {/* NOT `boardStale`-aware, deliberately (PR #236 review round 2, L3).
          «Neviens šoferis nav tiešsaistē» is a present-tense claim, and on a
          stale board the honest one is "we do not know". It is left
          unconditional because the caveat is guaranteed to be on screen
          beside it: `boardStale` is `isPanelStale` (15 s) and the banner is
          `isStale` (5 s) or «Bezsaistē», so the panel's condition is a strict
          SUBSET of the banner's — `boardStale` true implies the frame is
          ≥ 15 s old, which implies the banner. The heading's `(0)` sits next
          to it too. A fourth catalog string would restate what the banner
          already says. If the banner's condition ever narrows, this stops
          being true and the string needs the guard. */}
      {drivers.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 'var(--font-size-sm)',
            color: 'var(--color-fg-muted)',
          }}
        >
          {formatMessage(LANG, 'console.drivers_empty')}
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: 'var(--spacing-xs)',
          }}
        >
          {drivers.map((driver) => (
            <DriverRow
              key={driver.driverId}
              driver={driver}
              serverNowMs={serverNowMs}
              boardStale={boardStale}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
