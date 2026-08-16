'use client';

import {
  dispatchBoardEventSchema,
  RT,
  type ClientToServerEmitEvents,
  type DispatchBoardEvent,
  type ServerToClientEvents,
} from '@taxi/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  apiUrl,
  BOARD_SNAPSHOT_STORAGE_KEY,
  clearSession,
  loadSession,
} from '@/features/auth';
import {
  acknowledgeAlert,
  applyDriverLocation,
  applyFrame,
  emptyBoard,
  pillFrom,
  POLL_MS,
  pushOfflineAlert,
  pushSmsFailedAlert,
  pushUnclaimedAlert,
  type BoardState,
  type PillState,
} from './board-state';

/**
 * Declared in the auth slice so `clearSession()` can drop this cache too —
 * it holds driver PII and must not outlive the session. See session.ts.
 */
const SNAPSHOT_KEY = BOARD_SNAPSHOT_STORAGE_KEY;

type ConsoleSocket = Socket<ServerToClientEvents, ClientToServerEmitEvents>;

/** Best-effort — a full quota or private mode must never break the board. */
function persistFrame(frame: DispatchBoardEvent): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(frame));
  } catch {
    /* the live path doesn't depend on persistence */
  }
}

/**
 * The last persisted frame as the INITIAL state — stale-marked
 * (lastFrameAtMs null), so a cold refresh while the API is down still shows
 * the phone list. "The console never traps data." Runs only client-side:
 * the /dispatch layout's guard renders nothing during SSR.
 */
function hydratedBoard(): BoardState {
  if (typeof window === 'undefined') return emptyBoard();
  const raw = window.localStorage.getItem(SNAPSHOT_KEY);
  if (raw === null) return emptyBoard();
  try {
    const frame = dispatchBoardEventSchema.parse(JSON.parse(raw));
    return { ...emptyBoard(), frame };
  } catch {
    window.localStorage.removeItem(SNAPSHOT_KEY);
    return emptyBoard();
  }
}

/**
 * The board's socket lifecycle, in one hook:
 *
 * - Socket.IO's BUILT-IN exponential backoff (500 ms → 30 s), never a
 *   hand-rolled retry loop. `randomizationFactor: 0.5` is ±50% jitter — the
 *   library's maximum, approximating evidence F6.1's "50–100%" (noted
 *   honestly, not claimed as spec-exact).
 * - Snapshot-on-(re)connect ALWAYS: Connection State Recovery is unsupported
 *   on the api's pub/sub Redis adapter, so `socket.recovered` is always false
 *   and a full REST resync is mandatory anyway (evidence F6.2).
 * - The pill derives from FRAME RECEIPT (board-state.pillFrom), never socket
 *   flags alone — the "zero silent staleness" ledger row.
 * - «Bezsaistē» is a UI state, not a stopped socket: reconnection keeps
 *   running underneath while a 5 s read-only poll feeds the board.
 */
export function useBoard(): {
  board: BoardState;
  pill: PillState;
  nowMs: number;
  retry: () => void;
  ack: (alertId: string) => void;
} {
  const router = useRouter();
  const [board, setBoard] = useState<BoardState>(hydratedBoard);
  const [connected, setConnected] = useState(false);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [browserOnline, setBrowserOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const socketRef = useRef<ConsoleSocket | null>(null);
  const pollBusy = useRef(false);

  const fetchSnapshot = useCallback(async () => {
    const session = loadSession();
    if (session === null) return; // the layout guard is already redirecting
    try {
      const res = await fetch(`${apiUrl()}/dispatch/board`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: 'no-store',
      });
      if (res.status === 401 || res.status === 403) {
        clearSession();
        router.replace('/login');
        return;
      }
      if (!res.ok) return; // pill/staleness carry the bad news truthfully
      const frame = dispatchBoardEventSchema.parse(await res.json());
      setBoard((s) => applyFrame(s, frame, Date.now()));
      persistFrame(frame);
    } catch {
      /* unreachable API: the pill is already not claiming live */
    }
  }, [router]);

  // The socket — created once per mount, torn down with it.
  useEffect(() => {
    const session = loadSession();
    if (session === null) return;
    const socket: ConsoleSocket = io(apiUrl(), {
      auth: { token: session.accessToken },
      reconnectionDelay: 500,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setFailedAttempts(0);
      void fetchSnapshot();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', (error) => {
      // The gateway middleware's rejection reads 'unauthorized'; anything
      // else is a network failure and just counts toward «Bezsaistē».
      if (error.message === 'unauthorized') {
        clearSession();
        socket.close();
        router.replace('/login');
        return;
      }
      setFailedAttempts((n) => n + 1);
    });

    socket.on(RT.dispatchBoard, (frame) => {
      setBoard((s) => applyFrame(s, frame, Date.now()));
      persistFrame(frame);
    });
    socket.on(RT.driverLocation, (event) =>
      setBoard((s) => applyDriverLocation(s, event)),
    );
    socket.on(RT.dispatchUnclaimed, (event) =>
      setBoard((s) => pushUnclaimedAlert(s, event)),
    );
    socket.on(RT.dispatchSmsFailed, (event) =>
      setBoard((s) => pushSmsFailedAlert(s, event)),
    );

    return () => {
      socketRef.current = null;
      socket.close();
    };
  }, [fetchSnapshot, router]);

  // navigator.onLine — the fastest honest "offline" signal there is.
  useEffect(() => {
    const on = () => setBrowserOnline(true);
    const off = () => setBrowserOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  // 1 Hz tick so staleness (and ride ages) re-derive without any event.
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const pill = pillFrom({
    connected,
    failedAttempts,
    browserOnline,
    nowMs,
    lastFrameAtMs: board.lastFrameAtMs,
  });

  // One alert per TRANSITION into offline (ISA-18.2: the alarm is the edge,
  // not the state) — micro-blips that never reach «Bezsaistē» stay silent.
  const prevPill = useRef<PillState | null>(null);
  useEffect(() => {
    if (pill === 'offline' && prevPill.current !== 'offline') {
      setBoard((s) => pushOfflineAlert(s, new Date().toISOString()));
    }
    prevPill.current = pill;
  }, [pill]);

  // Read-only polling fallback while offline. The socket keeps retrying
  // underneath; the moment it reconnects the pill flips and this stops.
  useEffect(() => {
    if (pill !== 'offline') return;
    const timer = setInterval(() => {
      if (pollBusy.current) return; // ref-gate, mirrors tracking-map's pattern
      pollBusy.current = true;
      void fetchSnapshot().finally(() => {
        pollBusy.current = false;
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [pill, fetchSnapshot]);

  /** Manual «Mēģināt vēlreiz»: skip the backoff wait, try everything now. */
  const retry = useCallback(() => {
    const socket = socketRef.current;
    if (socket && !socket.connected) socket.connect();
    void fetchSnapshot();
  }, [fetchSnapshot]);

  const ack = useCallback(
    (alertId: string) => setBoard((s) => acknowledgeAlert(s, alertId)),
    [],
  );

  return { board, pill, nowMs, retry, ack };
}
