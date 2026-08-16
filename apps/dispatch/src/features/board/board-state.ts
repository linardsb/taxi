import type {
  DispatchBoardEvent,
  DispatchSmsFailedEvent,
  DispatchUnclaimedEvent,
  DriverLocationEvent,
} from '@taxi/shared';

/**
 * The board's pure state module — every transition the console performs on
 * data, with no socket, no React and no clock of its own (callers pass time,
 * like the api's stores). Kept pure so the reliability rules are cheap to
 * test exhaustively.
 */

/**
 * When the pill stops claiming «Tiešraide»: 2 × BOARD_EMIT_INTERVAL_MS + 1 s
 * allowance (`derived`) — two consecutive missed frames before the claim is
 * withdrawn, worst-case detection lag 5 s. The frame cadence doubles as the
 * staleness heartbeat: no frame in this window ⇒ say so, whatever the socket
 * flags claim ("zero silent staleness").
 */
export const STALE_MS = 5_000;

/** Read-only fallback poll cadence — mirrors the tracking page's POLL_MS. */
export const POLL_MS = 5_000;

/**
 * Failed retries before the pill says «Bezsaistē» (chosen constant, per the
 * plan). Socket.IO keeps retrying forever regardless — offline is a UI state,
 * not a stopped socket.
 */
export const OFFLINE_AFTER_FAILURES = 5;

/** Alert list cap — old alerts fall off the end, newest stay. */
export const ALERTS_CAP = 50;

export type PillState = 'live' | 'reconnecting' | 'offline';

export type BoardAlert =
  | {
      id: string;
      kind: 'unclaimed';
      rideId: string;
      address: string;
      at: string;
    }
  | {
      id: string;
      kind: 'sms_failed';
      rideId: string;
      smsKind: DispatchSmsFailedEvent['kind'];
      at: string;
    }
  | { id: string; kind: 'offline'; at: string };

export interface BoardState {
  frame: DispatchBoardEvent | null;
  /** null = the current frame (if any) was hydrated from storage — stale. */
  lastFrameAtMs: number | null;
  alerts: BoardAlert[];
}

export const emptyBoard = (): BoardState => ({
  frame: null,
  lastFrameAtMs: null,
  alerts: [],
});

/**
 * Wholesale replace — the whole point: no merge, no merge bugs.
 *
 * TWO TRANSPORTS FEED THIS AND NOTHING ELSE ORDERS THEM. On reconnect the
 * console fires `GET /dispatch/board` while the 2 s cadence keeps pushing; a
 * cold api answering the REST call in ~3 s delivers a body built BEFORE a
 * socket frame that already landed. Applied blindly, that older ride set
 * would replace the newer one and be stamped as received *now* — a board
 * three seconds behind under a green «Tiešraide», which is precisely the
 * silent staleness this slice exists to prevent. Same shape when an in-flight
 * fallback poll lands after the socket recovers, and when `retry()` is
 * clicked twice (it calls `fetchSnapshot` outside the poll gate).
 *
 * Ordered on `frame.at` — the SERVER clock, which both transports share
 * (`board.service.ts` takes one `nowMs` before its awaits), so no client
 * clock enters the comparison. Strict `<`, so a re-delivered identical frame
 * still refreshes `lastFrameAtMs` and keeps the pill honest.
 *
 * Only frames received LIVE this session order each other (`lastFrameAtMs
 * !== null`). A frame rehydrated from localStorage is deliberately never a
 * baseline: its `at` can be arbitrarily far ahead of the server's — a restored
 * profile, a clock step, the same origin pointed at another environment — and
 * treating it as one would reject every subsequent frame forever, leaving the
 * pill stuck at «Atjaunojas…». Unlike the bug above, that would not self-heal.
 */
export function applyFrame(
  state: BoardState,
  frame: DispatchBoardEvent,
  atMs: number,
): BoardState {
  if (
    state.frame !== null &&
    state.lastFrameAtMs !== null &&
    Date.parse(frame.at) < Date.parse(state.frame.at)
  ) {
    return state;
  }
  return { ...state, frame, lastFrameAtMs: atMs };
}

/**
 * Position patch between frames. A driver the frame doesn't carry is ignored
 * — the next full frame is ≤2 s away and self-heals whatever this misses.
 */
export function applyDriverLocation(
  state: BoardState,
  event: DriverLocationEvent,
): BoardState {
  if (state.frame === null) return state;
  if (!state.frame.drivers.some((d) => d.driverId === event.driverId)) {
    return state;
  }
  return {
    ...state,
    frame: {
      ...state.frame,
      drivers: state.frame.drivers.map((d) =>
        d.driverId === event.driverId
          ? { ...d, location: event.location, lastSeenAt: event.at }
          : d,
      ),
    },
  };
}

const alertsWith = (state: BoardState, alert: BoardAlert): BoardState =>
  // Same id twice = the same event delivered twice — not a second alarm. A
  // re-alert after the server's 300 s dedupe window carries a new `at`, so it
  // gets a new id and IS a new entry (the client must tolerate that).
  state.alerts.some((a) => a.id === alert.id)
    ? state
    : { ...state, alerts: [alert, ...state.alerts].slice(0, ALERTS_CAP) };

export function pushUnclaimedAlert(
  state: BoardState,
  event: DispatchUnclaimedEvent,
): BoardState {
  return alertsWith(state, {
    id: `unclaimed:${event.rideId}:${event.requestedAt}:${event.unclaimedSeconds}`,
    kind: 'unclaimed',
    rideId: event.rideId,
    address: event.pickup.address,
    at: event.requestedAt,
  });
}

export function pushSmsFailedAlert(
  state: BoardState,
  event: DispatchSmsFailedEvent,
): BoardState {
  return alertsWith(state, {
    id: `sms_failed:${event.rideId}:${event.at}`,
    kind: 'sms_failed',
    rideId: event.rideId,
    smsKind: event.kind,
    at: event.at,
  });
}

export function pushOfflineAlert(state: BoardState, atIso: string): BoardState {
  return alertsWith(state, {
    id: `offline:${atIso}`,
    kind: 'offline',
    at: atIso,
  });
}

export function acknowledgeAlert(state: BoardState, id: string): BoardState {
  return { ...state, alerts: state.alerts.filter((a) => a.id !== id) };
}

/** No frame yet, or the last one is older than the heartbeat allows. */
export function isStale(nowMs: number, lastFrameAtMs: number | null): boolean {
  return lastFrameAtMs === null || nowMs - lastFrameAtMs >= STALE_MS;
}

/**
 * THE pill — one derivation, one place, so the console cannot claim two
 * different truths. `live` requires a FRESH FRAME, never socket flags alone;
 * anything not provably live and not yet given up on is `reconnecting`
 * (which covers "reconnect in progress" — Socket.IO is always retrying).
 */
export function pillFrom(inputs: {
  connected: boolean;
  failedAttempts: number;
  browserOnline: boolean;
  nowMs: number;
  lastFrameAtMs: number | null;
}): PillState {
  if (
    !inputs.browserOnline ||
    (!inputs.connected && inputs.failedAttempts >= OFFLINE_AFTER_FAILURES)
  ) {
    return 'offline';
  }
  if (inputs.connected && !isStale(inputs.nowMs, inputs.lastFrameAtMs)) {
    return 'live';
  }
  return 'reconnecting';
}
