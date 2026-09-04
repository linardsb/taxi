import {
  rideSchema,
  RT,
  RT_EVENT_SCHEMAS,
  type PaymentMethodType,
  type Ride,
} from '@taxi/shared';
import { useRouter } from 'expo-router';
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
import { getLocationRuntime, type DriverSocket } from '@/features/location';
import { runEffects } from '@/lib/run-effects';
import {
  decide,
  initialActiveRide,
  type ActiveRideEffect,
  type ActiveRideEvent,
  type ActiveRideState,
} from './active-ride-state';

export interface ActiveRideContextValue {
  state: ActiveRideState;
  /** Start showing `rideId`; the offer card passes its payment-method snapshot. */
  open(rideId: string, expectedPaymentMethod?: PaymentMethodType): void;
  /** The one primary button: whichever step `ride.status` allows. */
  step(): void;
  reload(): void;
  dismissNotice(): void;
  /** The done / back-to-home button on an ended ride. */
  dismiss(): void;
}

const ActiveRideContext = createContext<ActiveRideContextValue | null>(null);

/** `POST /rides/:id/complete` → `{ ride }`; the api-client keeps zod out, so a hand parser. */
const completeResponse = {
  parse: (input: unknown): { ride: Ride } => ({
    ride: rideSchema.parse((input as { ride?: unknown } | null)?.ride),
  }),
};

const codeOf = (error: unknown) =>
  error instanceof ApiError ? error.code : 'generic';

/**
 * Runs the reducer and executes its effects against the api, the router and
 * the socket the location runtime hands over. Every socket payload is parsed
 * through `RT_EVENT_SCHEMAS` before it reaches the reducer; a parse failure
 * is logged and dropped, never thrown into React.
 */
export function ActiveRideProvider({ children }: { children: ReactNode }) {
  const { state: session, api } = useSession();
  const router = useRouter();
  const t = useT();
  const tRef = useRef(t);
  useEffect(() => {
    tRef.current = t;
  }, [t]);
  const [state, setState] = useState<ActiveRideState>(initialActiveRide);
  const stateRef = useRef(state);
  const runRef = useRef<(effect: ActiveRideEffect) => Promise<void | 'stop'>>(
    () => Promise.resolve(),
  );
  const myDriverId = session.session?.user.id ?? null;
  const myDriverIdRef = useRef(myDriverId);
  useEffect(() => {
    myDriverIdRef.current = myDriverId;
  }, [myDriverId]);

  const dispatch = useCallback(function dispatch(event: ActiveRideEvent) {
    const { state: next, effects } = decide(stateRef.current, event);
    stateRef.current = next;
    setState(next);
    if (effects.length === 0) return;
    void runEffects(
      effects,
      (effect) => runRef.current(effect),
      (error) => dispatch({ type: 'step_failed', code: codeOf(error) }),
    );
  }, []);

  const run = async (effect: ActiveRideEffect): Promise<void | 'stop'> => {
    switch (effect.type) {
      case 'fetch_ride':
        try {
          const ride = await api.request('GET', `/rides/${effect.rideId}`, {
            schema: rideSchema,
          });
          dispatch({ type: 'loaded', ride });
        } catch (error) {
          dispatch({ type: 'load_failed', code: codeOf(error) });
        }
        return;
      case 'post_step':
        try {
          await api.request('POST', `/rides/${effect.rideId}/${effect.step}`);
          dispatch({ type: 'step_done', step: effect.step });
        } catch (error) {
          dispatch({ type: 'step_failed', code: codeOf(error) });
        }
        return;
      case 'post_complete':
        try {
          const { ride } = await api.request(
            'POST',
            `/rides/${effect.rideId}/complete`,
            { schema: completeResponse },
          );
          dispatch({ type: 'completed', ride });
        } catch (error) {
          dispatch({ type: 'step_failed', code: codeOf(error) });
        }
        return;
      case 'route_ride':
        router.replace('/active-ride');
        return;
      case 'route_home':
        router.replace('/home');
        return;
      case 'announce':
        AccessibilityInfo.announceForAccessibility(tRef.current(effect.key));
        return;
    }
  };
  useEffect(() => {
    runRef.current = run;
  });

  // The socket, whenever presence hands one over: `ride:status`,
  // `ride:assigned`, and every `connect` — which triggers the read that
  // re-joins the ride room server-side.
  useEffect(() => {
    let detach: (() => void) | null = null;
    const attach = (socket: DriverSocket | null) => {
      detach?.();
      detach = null;
      if (!socket) return;
      const onStatus = (payload: unknown) => {
        const parsed = RT_EVENT_SCHEMAS[RT.rideStatus].safeParse(payload);
        if (!parsed.success) {
          console.warn('ride:status dropped', parsed.error.issues[0]?.message);
          return;
        }
        dispatch({ type: 'status', event: parsed.data });
      };
      const onAssigned = (payload: unknown) => {
        const parsed = RT_EVENT_SCHEMAS[RT.rideAssigned].safeParse(payload);
        if (!parsed.success) {
          console.warn(
            'ride:assigned dropped',
            parsed.error.issues[0]?.message,
          );
          return;
        }
        const me = myDriverIdRef.current;
        if (me)
          dispatch({ type: 'assigned', event: parsed.data, myDriverId: me });
      };
      const onConnect = () => dispatch({ type: 'socket_connected' });
      socket.on(RT.rideStatus, onStatus);
      socket.on(RT.rideAssigned, onAssigned);
      socket.on('connect', onConnect);
      detach = () => {
        socket.off(RT.rideStatus, onStatus);
        socket.off(RT.rideAssigned, onAssigned);
        socket.off('connect', onConnect);
      };
    };
    const unsubscribe = getLocationRuntime().subscribe({ onSocket: attach });
    return () => {
      unsubscribe();
      detach?.();
    };
  }, [dispatch]);

  // Foreground = the return path from Google Maps / Waze: reconcile.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') dispatch({ type: 'foreground' });
    });
    return () => sub.remove();
  }, [dispatch]);

  const open = useCallback(
    (rideId: string, expectedPaymentMethod?: PaymentMethodType) =>
      dispatch(
        expectedPaymentMethod
          ? { type: 'open', rideId, expectedPaymentMethod }
          : { type: 'open', rideId },
      ),
    [dispatch],
  );
  const step = useCallback(
    () => dispatch({ type: 'step_pressed' }),
    [dispatch],
  );
  const reload = useCallback(
    () => dispatch({ type: 'reload_pressed' }),
    [dispatch],
  );
  const dismissNotice = useCallback(
    () => dispatch({ type: 'notice_dismissed' }),
    [dispatch],
  );
  const dismiss = useCallback(
    () => dispatch({ type: 'dismissed' }),
    [dispatch],
  );

  const value = useMemo<ActiveRideContextValue>(
    () => ({ state, open, step, reload, dismissNotice, dismiss }),
    [state, open, step, reload, dismissNotice, dismiss],
  );
  return (
    <ActiveRideContext.Provider value={value}>
      {children}
    </ActiveRideContext.Provider>
  );
}

export function useActiveRide(): ActiveRideContextValue {
  const value = useContext(ActiveRideContext);
  if (value === null) {
    throw new Error('useActiveRide must be used inside <ActiveRideProvider>');
  }
  return value;
}
