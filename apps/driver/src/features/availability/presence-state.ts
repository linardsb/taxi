import type { DriverStatus } from '@taxi/shared';
import type { PermissionResult } from '@/features/location';
import type { Intent } from './intent-store';

export type Connection = 'live' | 'reconnecting' | 'offline';

export type BannerKind =
  | 'marked_offline'
  | 'foreground_denied'
  | 'background_denied'
  | 'vehicle_required'
  | 'driver_on_ride'
  | 'battery'
  | 'generic';

export interface PresenceState {
  /** What the driver wants. The app owns intent; the server owns fact. */
  intent: Intent;
  /** The last fact the server stated. */
  server: DriverStatus | null;
  streaming: boolean;
  socketConnected: boolean;
  /** A transition is in flight — the toggle shows a spinner and ignores taps. */
  busy: boolean;
  /**
   * One re-assert per disagreement (NOTES "re-assert semantics"): set when
   * the app answers a server `offline` with `PUT status online`, cleared by
   * the next accepted fix. A second disagreement before that flips the UI.
   */
  reasserted: boolean;
  queued: number;
  lastFixAt: number | null;
  lastAckAt: number | null;
  banner: { kind: BannerKind; at?: string } | null;
}

export const initialPresence: PresenceState = {
  intent: 'offline',
  server: null,
  streaming: false,
  socketConnected: false,
  busy: false,
  reasserted: false,
  queued: 0,
  lastFixAt: null,
  lastAckAt: null,
  banner: null,
};

export type PresenceEvent =
  | {
      type: 'cold_launch';
      intent: Intent;
      streaming: boolean;
      markedOfflineAt: string | null;
      queued: number;
      now: string;
    }
  | { type: 'toggle_pressed' }
  | { type: 'permission'; result: PermissionResult }
  | { type: 'server_online' }
  | { type: 'server_offline'; at: string }
  | { type: 'error'; code: string }
  | { type: 'drained' }
  | { type: 'ack_not_online'; at: string }
  | { type: 'socket_connect' }
  | { type: 'socket_disconnect' }
  | { type: 'fix'; at: number }
  | { type: 'ack'; at: number; queued: number }
  | { type: 'queued'; count: number }
  | { type: 'battery_prompt_due' }
  | { type: 'banner_dismissed' };

export type Effect =
  | { type: 'persist_intent'; intent: Intent }
  | { type: 'persist_marked_offline'; at: string | null }
  | { type: 'request_permissions' }
  | { type: 'put_status'; status: Intent }
  | { type: 'start_stream' }
  | { type: 'stop_stream' }
  | { type: 'connect_socket' }
  | { type: 'disconnect_socket' }
  | { type: 'keep_awake'; on: boolean }
  | { type: 'kick_uploader' }
  | { type: 'show_battery_prompt' }
  | { type: 'drain_then_clear' }
  | { type: 'announce'; status: DriverStatus };

export interface Decision {
  state: PresenceState;
  effects: Effect[];
}

const GO_ONLINE: Effect[] = [
  { type: 'put_status', status: 'online' },
  { type: 'start_stream' },
  { type: 'connect_socket' },
  { type: 'keep_awake', on: true },
];

const TEAR_DOWN: Effect[] = [
  { type: 'stop_stream' },
  { type: 'disconnect_socket' },
  { type: 'keep_awake', on: false },
];

const noop = (state: PresenceState): Decision => ({ state, effects: [] });

/** The server won (a 409, or a second `offline` before any fix landed): flip the UI, say why. */
function flipOffline(
  state: PresenceState,
  banner: NonNullable<PresenceState['banner']>,
): Decision {
  return {
    state: {
      ...state,
      intent: 'offline',
      server: 'offline',
      streaming: false,
      busy: false,
      reasserted: false,
      banner,
    },
    effects: [
      { type: 'persist_intent', intent: 'offline' },
      ...(banner.kind === 'marked_offline'
        ? [{ type: 'persist_marked_offline', at: banner.at ?? null } as const]
        : []),
      ...TEAR_DOWN,
      { type: 'announce', status: 'offline' },
    ],
  };
}

/**
 * The whole online/offline policy as a pure reducer — D14 (recovery after a
 * kill), the one-re-assert rule, the drain-before-offline order and the
 * permission gate all live here, where a test can read every effect.
 */
export function decide(state: PresenceState, event: PresenceEvent): Decision {
  switch (event.type) {
    case 'cold_launch': {
      const base = { ...state, queued: event.queued };
      if (event.intent !== 'online') return noop(base);
      if (event.streaming) {
        // Android kept the service alive across the kill: re-assert, no tap.
        return {
          state: { ...base, intent: 'online', streaming: true, busy: true },
          effects: [
            { type: 'put_status', status: 'online' },
            { type: 'connect_socket' },
            { type: 'keep_awake', on: true },
          ],
        };
      }
      // The process (or the phone) died with the task: the driver taps once.
      return {
        state: {
          ...base,
          intent: 'offline',
          banner: {
            kind: 'marked_offline',
            at: event.markedOfflineAt ?? event.now,
          },
        },
        effects: [{ type: 'persist_intent', intent: 'offline' }],
      };
    }

    case 'toggle_pressed': {
      if (state.busy) return noop(state);
      if (state.intent === 'offline') {
        return {
          state: {
            ...state,
            intent: 'online',
            busy: true,
            reasserted: false,
            banner: null,
          },
          effects: [
            { type: 'persist_intent', intent: 'online' },
            { type: 'persist_marked_offline', at: null },
            { type: 'request_permissions' },
          ],
        };
      }
      // Drain first (≤5 s, best effort), THEN tell the server — or every
      // queued fix comes back `not_online`.
      return {
        state: { ...state, intent: 'offline', busy: true },
        effects: [
          { type: 'persist_intent', intent: 'offline' },
          { type: 'drain_then_clear' },
        ],
      };
    }

    case 'permission': {
      if (state.intent !== 'online') return noop(state);
      if (event.result === 'foreground_denied') {
        return {
          state: {
            ...state,
            intent: 'offline',
            busy: false,
            banner: { kind: 'foreground_denied' },
          },
          effects: [{ type: 'persist_intent', intent: 'offline' }],
        };
      }
      // `background_denied` still goes online — a mounted phone with the
      // screen kept awake streams anyway — with a banner saying what is missing.
      return {
        state: {
          ...state,
          streaming: true,
          banner:
            event.result === 'background_denied'
              ? { kind: 'background_denied' }
              : null,
        },
        effects: [...GO_ONLINE, { type: 'show_battery_prompt' }],
      };
    }

    case 'server_online': {
      const effects: Effect[] =
        state.intent === 'online' ? [{ type: 'kick_uploader' }] : [];
      if (state.server !== 'online')
        effects.push({ type: 'announce', status: 'online' });
      return {
        state: {
          ...state,
          server: 'online',
          busy: false,
          banner: state.banner?.kind === 'marked_offline' ? null : state.banner,
        },
        effects,
      };
    }

    case 'server_offline': {
      if (state.intent !== 'online') {
        return {
          state: { ...state, server: 'offline', busy: false },
          effects:
            state.server === 'offline'
              ? []
              : [{ type: 'announce', status: 'offline' }],
        };
      }
      if (!state.reasserted) {
        return {
          state: { ...state, server: 'offline', reasserted: true, busy: true },
          effects: [{ type: 'put_status', status: 'online' }],
        };
      }
      return flipOffline(state, { kind: 'marked_offline', at: event.at });
    }

    case 'ack_not_online': {
      if (state.intent !== 'online') return noop(state);
      if (!state.reasserted) {
        return {
          state: { ...state, server: 'offline', reasserted: true },
          effects: [{ type: 'put_status', status: 'online' }],
        };
      }
      return flipOffline(state, { kind: 'marked_offline', at: event.at });
    }

    case 'drained': {
      if (state.intent !== 'offline') return noop(state);
      return {
        state,
        effects: [{ type: 'put_status', status: 'offline' }, ...TEAR_DOWN],
      };
    }

    case 'error': {
      if (
        event.code === 'vehicle_required' ||
        event.code === 'driver_on_ride'
      ) {
        return flipOffline(state, { kind: event.code });
      }
      if (event.code === 'offline') {
        // No answer: the pill tells the story, and the reconnect re-asserts.
        return { state: { ...state, busy: false }, effects: [] };
      }
      return {
        state: { ...state, busy: false, banner: { kind: 'generic' } },
        effects: [],
      };
    }

    case 'socket_connect':
      return {
        state: { ...state, socketConnected: true },
        effects:
          state.intent === 'online'
            ? [{ type: 'put_status', status: 'online' }]
            : [],
      };

    case 'socket_disconnect':
      return noop({ ...state, socketConnected: false });

    case 'fix':
      return noop({ ...state, lastFixAt: event.at });

    case 'ack':
      return noop({
        ...state,
        lastAckAt: event.at,
        queued: event.queued,
        reasserted: false,
      });

    case 'queued':
      return noop({ ...state, queued: event.count });

    case 'battery_prompt_due':
      return state.banner
        ? noop(state)
        : noop({ ...state, banner: { kind: 'battery' } });

    case 'banner_dismissed':
      return noop({ ...state, banner: null });
  }
}

/** An ack younger than this reads «Tiešraide». */
export const LIVE_WINDOW_MS = 10_000;
/** …older than this reads «Nav savienojuma» — the dispatch freshness window. */
export const RECONNECTING_WINDOW_MS = 60_000;

/**
 * The connection pill, from RECEIPT (the last ack) — never socket flags
 * (the board's rule). `null` while offline: there is nothing to be
 * truthful about. No ack yet reads as reconnecting: we are waiting.
 */
export function pillFrom(
  state: PresenceState,
  nowMs: number,
): Connection | null {
  if (state.intent !== 'online') return null;
  if (state.lastAckAt === null) return 'reconnecting';
  const age = nowMs - state.lastAckAt;
  if (age <= LIVE_WINDOW_MS) return 'live';
  if (age <= RECONNECTING_WINDOW_MS) return 'reconnecting';
  return 'offline';
}
