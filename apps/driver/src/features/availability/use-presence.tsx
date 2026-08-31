import { driverProfileSchema } from '@taxi/shared';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo, AppState } from 'react-native';
import { ApiError, useSession } from '@/features/auth';
import { useT } from '@/features/i18n';
import {
  batteryPromptDue,
  createDriverSocket,
  ensureLocationPermissions,
  getLocationRuntime,
  isStreaming,
  markBatteryPromptShown,
  openBatteryOptimisationSettings,
  startStreaming,
  stopStreaming,
  type DriverSocket,
} from '@/features/location';
import { useMe } from '@/features/onboarding';
import {
  readIntent,
  readMarkedOfflineAt,
  writeIntent,
  writeMarkedOfflineAt,
} from './intent-store';
import {
  decide,
  initialPresence,
  type Effect,
  type PresenceEvent,
  type PresenceState,
} from './presence-state';

const KEEP_AWAKE_TAG = 'sakta-driver-online';
/** The go-offline grace: how long the drain may take before the server is told. */
const DRAIN_GRACE_MS = 5_000;

export interface PresenceContextValue {
  state: PresenceState;
  /** A 1 s clock while online, for the pill and «pirms N s». */
  nowMs: number;
  toggle(): void;
  dismissBanner(): void;
  /** The battery explainer's two answers. */
  batteryPrompt(open: boolean): void;
}

const PresenceContext = createContext<PresenceContextValue | null>(null);

/**
 * Runs the reducer and executes its effects against the real world: the
 * location runtime, the socket, the api, keep-awake. Effects run in order,
 * one at a time — `put_status` before `start_stream`, drain before the
 * offline put — and every answer comes back in as an event.
 */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const { state: session, api, signOut, onBeforeSignOut } = useSession();
  const { refetch } = useMe();
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [state, setState] = useState<PresenceState>(initialPresence);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const stateRef = useRef(state);
  const socketRef = useRef<DriverSocket | null>(null);
  const runtime = getLocationRuntime();
  const runRef = useRef<(effect: Effect) => Promise<void>>(() =>
    Promise.resolve(),
  );

  const dispatch = useCallback((event: PresenceEvent) => {
    const { state: next, effects } = decide(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (effects.length === 0) return;
    void (async () => {
      for (const effect of effects) await runRef.current(effect);
    })();
  }, []);

  const teardownSocket = useCallback(() => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    socketRef.current = null;
    runtime.setSocket(null);
  }, [runtime]);

  // Only ever invoked from `dispatch`, never in render; re-bound below,
  // after every render, so it sees the current session, api and callbacks.
  const run = async (effect: Effect): Promise<void> => {
    switch (effect.type) {
      case 'persist_intent':
        await writeIntent(effect.intent);
        return;
      case 'persist_marked_offline':
        await writeMarkedOfflineAt(effect.at);
        return;
      case 'request_permissions':
        dispatch({
          type: 'permission',
          result: await ensureLocationPermissions(),
        });
        return;
      case 'put_status':
        try {
          const profile = await api.request('PUT', '/drivers/me/status', {
            body: { status: effect.status },
            schema: driverProfileSchema,
          });
          dispatch(
            profile.status === 'online'
              ? { type: 'server_online' }
              : { type: 'server_offline', at: new Date().toISOString() },
          );
        } catch (e) {
          dispatch({
            type: 'error',
            code: e instanceof ApiError ? e.code : 'generic',
          });
        }
        return;
      case 'start_stream':
        try {
          await startStreaming(tRef.current);
        } catch {
          dispatch({ type: 'error', code: 'generic' });
        }
        return;
      case 'stop_stream':
        await stopStreaming().catch(() => undefined);
        return;
      case 'connect_socket': {
        const token = session.session?.accessToken;
        if (!token) return;
        if (socketRef.current) {
          if (!socketRef.current.connected) socketRef.current.connect();
          return;
        }
        const socket = createDriverSocket(token, {
          onUnauthorized: () => void signOut(),
        });
        socket.on('connect', () => dispatch({ type: 'socket_connect' }));
        socket.on('disconnect', () => dispatch({ type: 'socket_disconnect' }));
        socketRef.current = socket;
        runtime.setSocket(socket);
        socket.connect();
        return;
      }
      case 'disconnect_socket':
        teardownSocket();
        return;
      case 'keep_awake':
        if (effect.on) await activateKeepAwakeAsync(KEEP_AWAKE_TAG);
        else await deactivateKeepAwake(KEEP_AWAKE_TAG);
        return;
      case 'kick_uploader':
        runtime.uploader.kick();
        return;
      case 'show_battery_prompt':
        if (await batteryPromptDue()) dispatch({ type: 'battery_prompt_due' });
        return;
      case 'drain_then_clear':
        runtime.uploader.kick();
        await runtime.uploader.whenIdle(DRAIN_GRACE_MS);
        runtime.uploader.stop();
        dispatch({ type: 'drained' });
        return;
      case 'announce':
        AccessibilityInfo.announceForAccessibility(
          tRef.current(
            effect.status === 'online'
              ? 'driver.home.status_online'
              : 'driver.home.status_offline',
          ),
        );
        return;
    }
  };

  useEffect(() => {
    runRef.current = run;
  });

  // The runtime's events: fixes, acks, the server's `not_online`.
  useEffect(
    () =>
      runtime.subscribe({
        onFix: (at) => dispatch({ type: 'fix', at }),
        onProgress: (stats) =>
          dispatch({ type: 'ack', at: stats.lastAckAt, queued: stats.queued }),
        onServerOffline: () =>
          dispatch({ type: 'ack_not_online', at: new Date().toISOString() }),
      }),
    [runtime, dispatch],
  );

  // Cold launch (D14), once per sign-in.
  useEffect(() => {
    if (session.status !== 'signedIn') return;
    let cancelled = false;
    void Promise.all([
      readIntent(),
      isStreaming().catch(() => false),
      readMarkedOfflineAt(),
      runtime.queue.count().catch(() => 0),
    ]).then(([intent, streaming, markedOfflineAt, queued]) => {
      if (cancelled) return;
      dispatch({
        type: 'cold_launch',
        intent,
        streaming,
        markedOfflineAt,
        queued,
        now: new Date().toISOString(),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [session.status, runtime, dispatch]);

  // Foreground: the server's fact wins a disagreement (through the reducer).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') return;
      void runtime.queue
        .count()
        .then((count) => dispatch({ type: 'queued', count }))
        .catch(() => undefined);
      if (stateRef.current.intent !== 'online') return;
      void refetch().then((me) => {
        if (!me) return;
        dispatch(
          me.profile.status === 'online'
            ? { type: 'server_online' }
            : { type: 'server_offline', at: new Date().toISOString() },
        );
      });
    });
    return () => sub.remove();
  }, [runtime, refetch, dispatch]);

  // Sign-out: go quiet while the token is still valid, then forget everything.
  useEffect(
    () =>
      onBeforeSignOut(async () => {
        const wasOnline = stateRef.current.intent === 'online';
        await stopStreaming().catch(() => undefined);
        teardownSocket();
        await deactivateKeepAwake(KEEP_AWAKE_TAG);
        await writeIntent('offline');
        if (wasOnline) {
          await api
            .request('PUT', '/drivers/me/status', {
              body: { status: 'offline' },
            })
            .catch(() => undefined);
        }
        stateRef.current = initialPresence;
        setState(initialPresence);
      }),
    [onBeforeSignOut, api, teardownSocket],
  );

  // The 1 s clock the pill reads, while online only.
  useEffect(() => {
    if (state.intent !== 'online') return;
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.intent]);

  const toggle = useCallback(
    () => dispatch({ type: 'toggle_pressed' }),
    [dispatch],
  );
  const dismissBanner = useCallback(
    () => dispatch({ type: 'banner_dismissed' }),
    [dispatch],
  );
  const batteryPrompt = useCallback(
    (open: boolean) => {
      void markBatteryPromptShown();
      if (open) void openBatteryOptimisationSettings();
      dispatch({ type: 'banner_dismissed' });
    },
    [dispatch],
  );

  const value = useMemo<PresenceContextValue>(
    () => ({ state, nowMs, toggle, dismissBanner, batteryPrompt }),
    [state, nowMs, toggle, dismissBanner, batteryPrompt],
  );
  return (
    <PresenceContext.Provider value={value}>
      {children}
    </PresenceContext.Provider>
  );
}

export function usePresence(): PresenceContextValue {
  const value = useContext(PresenceContext);
  if (value === null) {
    throw new Error('usePresence must be used inside <PresenceProvider>');
  }
  return value;
}
