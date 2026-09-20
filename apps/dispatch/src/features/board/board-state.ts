import { DRIVER_LOCATION_TTL_SECONDS } from '@taxi/shared';
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
 * When the DRIVER PANEL stops trusting the frame it is reading. Wider than
 * `STALE_MS` on purpose, and a different question from the banner's.
 *
 * The banner asks *should the operator caveat what is on screen and be offered
 * retry*, and answers yes the moment the socket gives up. The panel asks *is
 * this frame recent enough that a 60 s per-driver judgement is sound* — and
 * while the pill is «Bezsaistē» the read-only poll (`use-board.ts`) is
 * refreshing `lastFrameAtMs` every cycle, so the answer is usually yes. Handing
 * the panel the banner's condition blanked it in exactly the state the
 * fallback was built for: websocket blocked, HTTP fine.
 *
 * `2 × POLL_MS + STALE_MS` = 5 000 + 5 000 + 5 000 = **15 000 ms** (`derived`).
 *
 * The bound it has to clear. Ticks fire every `POLL_MS`, and `pollBusy` SKIPS
 * every tick landing in `(T, T+R]` for a fetch started at `T` taking `R`
 * (the tie at `T+R` counted as skipped — the `finally` and the tick race).
 * The next fetch therefore starts at the first tick after that, so the worst
 * gap between two successful `applyFrame` calls is
 * `POLL_MS × (1 + floor(R / POLL_MS))`.
 *
 * Under the stated condition — `R` no longer than `STALE_MS` — that is
 * `5 000 × (1 + 1)` = **10 000 ms**, leaving 5 000 ms of margin under this
 * constant. Coverage holds while `R < 2 × POLL_MS` and fails at exactly
 * `R = 2 × POLL_MS`, where the gap reaches 15 000 and the comparison is `>=`;
 * an API that slow reads as stale, which is the safe direction.
 *
 * What a 15 s lag costs the signal: `lastSeenAt` is the api's clock and does
 * not move when the frame does, so a late frame only makes the panel
 * UNDER-report freshness — it can say «Klusē» for a driver who has since
 * reported, never «Raida» for one who has not. Worst case a row flips to
 * «Klusē» up to 15 s late, inside the 75 s (`PRESENCE_DARK_AFTER_SECONDS +
 * PRESENCE_SWEEP_INTERVAL_MS`) the sweeper takes to drop the driver anyway.
 */
export const PANEL_STALE_MS = 2 * POLL_MS + STALE_MS;

/**
 * Failed retries before the pill says «Bezsaistē» (chosen constant, per the
 * plan). Socket.IO keeps retrying forever regardless — offline is a UI state,
 * not a stopped socket.
 */
export const OFFLINE_AFTER_FAILURES = 5;

/** Alert list cap — old alerts fall off the end, newest stay. */
export const ALERTS_CAP = 50;

/**
 * The smallest server-clock correction the board will actually apply (#238).
 *
 * WHY A STEP RATHER THAN CONTINUOUS TRACKING. The candidate offset carries
 * network jitter, so re-deriving it from every frame would make ages
 * non-monotonic at 0.5 Hz — a `mm:ss` that walks backwards while a dispatcher
 * is reading it. Moving only on a change of at least this much keeps ages
 * monotonic between corrections, and makes the whole mechanism a NO-OP on a
 * correctly-set machine: the offset starts at 0, and while every candidate is
 * inside ±1 000 ms of 0 it stays 0, so nothing about today's rendering moves.
 * What it does not do is hide a real correction — when the step is taken,
 * every age jumps by it once. That is the intended behaviour and the price of
 * being right afterwards.
 *
 * WHY 1 000 SPECIFICALLY. Every consumer renders at second granularity
 * (`ageOf`'s `mm:ss`, re-derived on `use-board.ts`'s 1 Hz tick), so a residual
 * under one second cannot appear on screen at all. That makes 1 000 ms the
 * smallest step that buys a visible improvement; below it the offset would
 * chase jitter for nothing a dispatcher could see.
 *
 * WHAT IT COSTS, against the true offset `O`. Once settled,
 * `|stored − O| < 1 000 + L` (`derived`: `|stored − candidate| < 1 000` is
 * the step test itself, and `|candidate − O| = L` is the sampling bias
 * derived in `applyFrame`'s docblock below). The 1 000 is under 1.7% of
 * `DRIVER_LOCATION_TTL_SECONDS` (60 s); `L` is NOT quantified here — no run
 * has measured this api's one-way push latency — so that percentage covers
 * the step term only, and the sentence says so rather than implying the
 * bound is fully numeric. Both terms point the SAME way — ages read small —
 * so a driver who has gone quiet can still read «Raida» for that long past
 * the boundary. The error it replaces was unbounded in exactly that
 * direction; bounded beats unbounded, which is the whole claim being made.
 *
 * THE BOUND SURVIVES A DRIFTING CLOCK, and that is a property of comparing
 * against the STORED offset rather than the previous candidate. A browser
 * losing 200 ms a frame produces candidates that each look like jitter, but
 * the difference accumulates against a stored value that is not moving, so
 * the fifth frame trips the step and the offset snaps. Comparing consecutive
 * candidates instead would let such a clock walk away unboundedly with every
 * individual move sub-step. Pinned by the drift case in board-state.test.ts.
 */
export const SERVER_OFFSET_STEP_MS = 1_000;

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
  /**
   * api clock minus browser clock, in ms (#238). Add it to a browser `now`
   * to get a server `now`, which is the only kind that may be subtracted from
   * a wire timestamp. 0 until a socket frame says otherwise — see
   * `applyFrame` for why only a SOCKET frame may say so, and
   * `SERVER_OFFSET_STEP_MS` for why it moves in steps.
   */
  serverOffsetMs: number;
  alerts: BoardAlert[];
}

export const emptyBoard = (): BoardState => ({
  frame: null,
  lastFrameAtMs: null,
  serverOffsetMs: 0,
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
 *
 * `source` IS WHERE THE FRAME CAME FROM, AND IT IS NOT DECORATION (#238).
 * `frame.at` is the only api clock reading the console ever gets, so it is
 * what the server-client offset is sampled from — but only a SOCKET frame is
 * a usable sample, and the parameter is required so no future call site can
 * quietly become one.
 *
 * The sampling bias, stated rather than assumed. `frame.at` is stamped at
 * `T` on the api and reaches the browser one-way delay `L` later, so the
 * candidate `Date.parse(frame.at) − atMs` estimates the true offset `O` as
 * `O − L` — low by exactly the transport delay, which makes every corrected
 * age read `L` SMALL. On a socket push `L` is that frame's own trip on an
 * already-open connection. On the HTTP snapshot it is a REST round trip
 * against a possibly cold api, the ~3 s case the paragraph above is entirely
 * about: sampling there would write a −3 000 ms offset onto a perfectly
 * synchronised browser and clear any sane step threshold while doing it. So
 * `'snapshot'` samples nothing and carries the offset through untouched.
 *
 * The consequence of that, also stated: while the pill is «Bezsaistē» only
 * the read-only poll is feeding the board, so the offset FREEZES at its last
 * socket-derived value until the socket returns. That is the right answer —
 * there is no uncontaminated sample to take, and the quantity being held is a
 * clock DIFFERENCE, which does not drift meaningfully across one outage.
 */
export function applyFrame(
  state: BoardState,
  frame: DispatchBoardEvent,
  atMs: number,
  source: FrameSource,
): BoardState {
  if (
    state.frame !== null &&
    state.lastFrameAtMs !== null &&
    Date.parse(frame.at) < Date.parse(state.frame.at)
  ) {
    return state;
  }
  return {
    ...state,
    frame,
    lastFrameAtMs: atMs,
    serverOffsetMs:
      source === 'socket'
        ? steppedOffset(state.serverOffsetMs, frame.at, atMs)
        : state.serverOffsetMs,
  };
}

/** Which transport delivered a frame — only one of them carries a clock. */
export type FrameSource = 'socket' | 'snapshot';

/**
 * The stored offset, moved to the candidate only if the two differ by at
 * least `SERVER_OFFSET_STEP_MS`.
 *
 * A malformed `at` makes the candidate `NaN`, and `Math.abs(NaN) >= x` is
 * `false`, so the stored offset survives untouched — the fail-safe direction,
 * and the same posture `driverFreshness` takes below. Since #237 nothing
 * malformed reaches here from either transport anyway; this is the function
 * answering for itself, as a pure one should.
 */
function steppedOffset(
  current: number,
  frameAt: string,
  atMs: number,
): number {
  const candidate = Date.parse(frameAt) - atMs;
  return Math.abs(candidate - current) >= SERVER_OFFSET_STEP_MS
    ? candidate
    : current;
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
 * The same read against the panel's wider window (`PANEL_STALE_MS`). A
 * hydrated cold refresh (`lastFrameAtMs: null`) is stale here too — there is
 * no frame age to trust at all.
 */
export function isPanelStale(
  nowMs: number,
  lastFrameAtMs: number | null,
): boolean {
  return lastFrameAtMs === null || nowMs - lastFrameAtMs >= PANEL_STALE_MS;
}

/**
 * Per-driver stream freshness — the read `applyDriverLocation` has been
 * writing `lastSeenAt` for with no consumer (#234).
 *
 * THE BOUNDARY IS `DRIVER_LOCATION_TTL_SECONDS`, IMPORTED, NEVER RESTATED. It
 * is the same number `findNearby` filters candidates on, so the board cannot
 * say a driver is reporting while dispatch has already stopped offering to
 * them. See `@taxi/shared`'s `driver-presence.ts`.
 *
 * THREE STATES, NOT TWO. `lastSeenAt: null` is an online driver whose GEO
 * position was never recorded or was dropped — never-streamed is a different
 * fact from stopped-streaming, and it has no age to print. Folding it into
 * `stale` would force the silence label to carry an empty `mm:ss`.
 *
 * `>=`, matching `isStale`'s boundary convention above: exactly at the TTL is
 * already stale, which makes the boundary case deterministic in tests.
 *
 * `Date.parse` returns `NaN` on a malformed string, and `NaN >= x` is `false`
 * — which would silently report `live`. Two independent things now rule that
 * out, and the guard below is deliberately kept as the second. The api parses
 * every emit (`realtime.service.ts:81` runs `RT_EVENT_SCHEMAS[event].parse`,
 * and the field is `z.string().datetime()`), and since #237 so does the
 * console, on all four inbound socket events as well as the two cold-start
 * paths (`use-board.ts`). This function is pure and takes a bare `string`
 * from any caller, so it still owes its own answer: it fails to `unknown`
 * rather than to green «Raida».
 *
 * The caller owns the clock (module header), so nothing here ticks. The page's
 * 1 Hz `serverNowMs` from `useBoard` is what re-derives this.
 *
 * IT IS THE SERVER'S CLOCK ON BOTH SIDES, and the parameter name is the
 * contract (#238). `lastSeenAt` is the api's; a raw browser `Date.now()` here
 * meant a machine two minutes slow reported every driver `live` and two
 * minutes fast reported every driver `stale`, with no bound on either. The
 * caller passes `nowMs + serverOffsetMs`; what that is worth, and what it
 * still costs, is derived at `SERVER_OFFSET_STEP_MS`. Do NOT pass a browser
 * `now` — the compiler cannot tell the two apart, so the name is the only
 * guard this function has.
 *
 * WHAT THIS DERIVATION CANNOT SEE, and so does not decide alone: whether a
 * position was ever recorded (`location`, not `lastSeenAt` — see
 * `driver-list.tsx`'s `rowFreshness`), and whether the CONSOLE has stopped
 * receiving. Both would otherwise read as a driver who is reporting.
 */
export type DriverFreshness = 'live' | 'stale' | 'unknown';

export function driverFreshness(
  serverNowMs: number,
  lastSeenAt: string | null,
): DriverFreshness {
  if (lastSeenAt === null) return 'unknown';
  const ageMs = serverNowMs - Date.parse(lastSeenAt);
  if (Number.isNaN(ageMs)) return 'unknown';
  return ageMs >= DRIVER_LOCATION_TTL_SECONDS * 1000 ? 'stale' : 'live';
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
