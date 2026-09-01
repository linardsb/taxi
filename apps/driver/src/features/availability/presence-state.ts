import type { DriverStatus } from '@taxi/shared';
import type { PermissionResult } from '@/features/location';
import type { Intent } from './intent-store';

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
  // `status` is the `put_status` this refusal answers, when it was one.
  // The reducer must not infer it from state: `driver_on_ride` is thrown
  // by `vehicles.service.ts:90` too, on a path no put started.
  | { type: 'error'; code: string; status?: Intent }
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
  | { type: 'stop_uploader' }
  | { type: 'purge_stale_fixes' }
  | { type: 'show_battery_prompt' }
  | { type: 'drain_then_clear' }
  | { type: 'announce'; status: DriverStatus };

export interface Decision {
  state: PresenceState;
  effects: Effect[];
}

/** The purge goes FIRST: `put_status`'s answer is what kicks the uploader. */
const GO_ONLINE: Effect[] = [
  { type: 'purge_stale_fixes' },
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
 * A `generic` banner never overwrites a permission banner — those carry
 * instructions («grant location», review F34). `background_denied` is on the
 * list too: it is the banner that is up while the driver is *online*, i.e.
 * during the window when generic errors actually arrive (review F42).
 */
const GUIDANCE_KINDS: BannerKind[] = ['foreground_denied', 'background_denied'];

function keepGuidance(
  state: PresenceState,
  fallback: NonNullable<PresenceState['banner']>,
): PresenceState['banner'] {
  return state.banner && GUIDANCE_KINDS.includes(state.banner.kind)
    ? state.banner
    : fallback;
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
            { type: 'purge_stale_fixes' },
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
      // queued fix comes back `not_online`. Nothing after that put is
      // committed before its answer: see `drained` (#141).
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
        // The server may already hold us `online` (a foreground refetch that
        // re-asserted while the dialog was up — the hook skips it while busy,
        // this is the second guard): tell it, or the board shows a driver with
        // no stream until the dark sweep flips them and buzzes their phone.
        const serverOnline = state.server === 'online';
        return {
          state: {
            ...state,
            intent: 'offline',
            busy: serverOnline, // the offline put's answer clears it
            banner: { kind: 'foreground_denied' },
          },
          effects: [
            { type: 'persist_intent', intent: 'offline' },
            ...(serverOnline
              ? [
                  { type: 'put_status', status: 'offline' } as const,
                  ...TEAR_DOWN,
                ]
              : []),
          ],
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
      // `online` or `on_ride` (see `serverStatusEvent`): the server holds us.
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
        // `busy` for the put's RTT: a foreground refetch inside that window
        // read `offline`, saw `reasserted: true` and flipped while the
        // re-assert was about to succeed (review F35).
        return {
          state: { ...state, server: 'offline', reasserted: true, busy: true },
          effects: [{ type: 'put_status', status: 'online' }],
        };
      }
      return flipOffline(state, { kind: 'marked_offline', at: event.at });
    }

    case 'drained': {
      if (state.intent !== 'offline') return noop(state);
      // Everything after the put is conditional on its ANSWER — the
      // uploader stop and the teardown both queue behind it, so a refusal
      // that holds us online skips both and the stream survives. The
      // chain's `'stop'` predicate in `use-presence` is what skips them
      // (#141/F38).
      return {
        state,
        effects: [
          { type: 'put_status', status: 'offline' },
          { type: 'stop_uploader' },
          ...TEAR_DOWN,
        ],
      };
    }

    case 'error': {
      if (
        event.code === 'driver_on_ride' &&
        event.status === 'offline' &&
        state.streaming
      ) {
        // The server refused the OFFLINE put because it holds us on a ride,
        // and we can still prove life — so the tap did nothing except say why
        // (#141/F38). No teardown: the tracking page and the board keep the
        // feed, and `releaseFromRide` does not hand a silent driver back to
        // the swept population with a push nudge. `server: 'online'` is
        // honest — `serverStatusEvent` already maps `on_ride` to online.
        // `persist_intent online` undoes `toggle_pressed`'s write, or a cold
        // launch reads a false «marked offline». `kick_uploader` closes the
        // ≤4 s gap when the pre-put drain ended early (empty queue,
        // `!socket`, `not_online`): a restart of an un-stopped uploader,
        // never a kick over a `stop()` — the stop sits behind the put.
        //
        // `state.streaming` is the whole guard, not padding. Two routes reach
        // here with no stream: the `effect_failed` fold below (it emits the
        // offline put off the PRE-fold `server`, then sets `streaming:
        // false`) and `permission/foreground_denied` with the server already
        // online. Restoring `intent: 'online'` on either rebuilds review
        // F31's ghost toggle. Falling through writes `server: 'offline'`
        // while the server holds `on_ride` — deliberate: with no stream we
        // cannot prove life, and offline is the safe wrong.
        return {
          state: {
            ...state,
            intent: 'online',
            server: 'online',
            busy: false,
            banner: { kind: 'driver_on_ride' },
          },
          effects: [
            { type: 'persist_intent', intent: 'online' },
            { type: 'kick_uploader' },
          ],
        };
      }
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
      if (event.code === 'effect_failed') {
        // A native call in a chain threw (SecureStore, permissions,
        // keep-awake): the chain is half-done, so fold to offline — the one
        // state that is safe to be wrong in. Leaving `intent: 'online'` was a
        // ghost toggle: ON with no permissions and no stream, then a spurious
        // offline nudge (review F31).
        //
        // The fold clears `server` as well as `intent`/`streaming`, so a
        // throw inside the teardown below re-enters here with
        // `anythingUp === false` and emits nothing. That is what closes the
        // loop — the state does, not the network recovering. Without it the
        // `server === 'online'` case re-emitted an identical list on every
        // pass for as long as the offline PUT could not land (review F37).
        // `persist_intent` goes LAST for the same reason: a throwing store
        // cannot block the teardown, and its throw lands on that empty second
        // pass. Omitting it left SecureStore saying `'online'`, which a later
        // cold launch reads as «marked offline» stamped with the launch time
        // (review F44).
        const anythingUp =
          state.intent === 'online' ||
          state.streaming ||
          state.server === 'online';
        return {
          state: {
            ...state,
            intent: 'offline',
            streaming: false,
            server: null,
            busy: false,
            reasserted: false,
            banner: keepGuidance(state, { kind: 'generic' }),
          },
          effects: anythingUp
            ? [
                ...(state.server === 'online'
                  ? [{ type: 'put_status', status: 'offline' } as const]
                  : []),
                ...TEAR_DOWN,
                { type: 'persist_intent', intent: 'offline' },
              ]
            : [],
        };
      }
      return {
        state: {
          ...state,
          busy: false,
          banner: keepGuidance(state, { kind: 'generic' }),
        },
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

/**
 * The server's stated status as a reducer event. `on_ride` is the server
 * HOLDING us — the stream feeds the tracking page and the board — so it reads
 * as online. The api answers a mid-ride `PUT online` re-assert with the
 * `on_ride` profile (only `offline` 409s while held — `setPresence`, review
 * F3), so a foreground refetch or a socket reconnect during a force-assigned
 * ride keeps the stream up instead of flipping the toggle.
 */
export function serverStatusEvent(
  status: DriverStatus,
  at: string,
): PresenceEvent {
  return status === 'offline'
    ? { type: 'server_offline', at }
    : { type: 'server_online' };
}
